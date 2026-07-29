import io
from typing import Optional

import chess
import chess.pgn
import pandas as pd
from fastapi import HTTPException

from cache import (
    get_gm_games,
    get_lichess_stats,
    get_player_prep,
    get_position_eval,
)


START_FEN = chess.STARTING_FEN


def _score_cp(pvs: list, side_to_move_white: bool) -> Optional[float]:
    if not pvs:
        return None
    first = pvs[0]
    if "mate" in first and first["mate"] is not None:
        mate = int(first["mate"])
        raw = 100000 - abs(mate) * 1000
        raw = raw if mate > 0 else -raw
    elif "cp" in first and first["cp"] is not None:
        raw = float(first["cp"])
    else:
        return None
    return raw if side_to_move_white else -raw


def _best_uci(pvs: list) -> Optional[str]:
    if not pvs:
        return None
    line = pvs[0].get("moves") or ""
    return line.split()[0] if line else None


def _uci_to_san(board: chess.Board, uci: str) -> Optional[str]:
    try:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            return None
        return board.san(move)
    except Exception:
        return None


def eval_position(fen: str, multi_pv: int = 3) -> dict:
    raw = get_position_eval(fen, multi_pv=multi_pv)
    if not raw:
        raise HTTPException(
            status_code=502, detail="Lichess cloud-eval unavailable for this FEN"
        )
    board = chess.Board(fen)
    pvs = raw.get("pvs") or []
    best_uci = _best_uci(pvs)
    return {
        "fen": fen,
        "depth": raw.get("depth"),
        "knodes": raw.get("knodes"),
        "pvs": pvs,
        "best_uci": best_uci,
        "best_san": _uci_to_san(board, best_uci) if best_uci else None,
        "eval_cp_white": _score_cp(pvs, True),
        "side_to_move": "white" if board.turn == chess.WHITE else "black",
    }


def explorer_position(
    fen: str,
    source: str = "lichess",
    username: Optional[str] = None,
    color: Optional[str] = None,
) -> dict:
    data = None
    if source == "masters":
        data = get_gm_games(fen)
    elif source == "player":
        if not username or not color:
            raise HTTPException(
                status_code=400,
                detail="username and color required for player explorer",
            )
        data = get_player_prep(username, color, fen)
    else:
        data = get_lichess_stats(fen)

    if data is None:
        return _explorer_from_cloud_eval(fen, source)

    moves = []
    for m in data.get("moves") or []:
        moves.append(
            {
                "uci": m.get("uci"),
                "san": m.get("san"),
                "white": m.get("white", 0),
                "draws": m.get("draws", 0),
                "black": m.get("black", 0),
                "averageRating": m.get("averageRating"),
            }
        )

    return {
        "fen": fen,
        "source": source,
        "fallback": False,
        "white": data.get("white", 0),
        "draws": data.get("draws", 0),
        "black": data.get("black", 0),
        "moves": moves[:12],
        "opening": data.get("opening"),
    }


def _explorer_from_cloud_eval(fen: str, source: str) -> dict:
    try:
        ev = eval_position(fen, multi_pv=5)
    except HTTPException as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Explorer ({source}) unavailable (needs LICHESS_TOKEN). "
                f"Cloud-eval fallback also failed: {exc.detail}"
            ),
        ) from exc

    board = chess.Board(fen)
    moves = []
    for pv in ev.get("pvs") or []:
        line = (pv.get("moves") or "").split()
        if not line:
            continue
        uci = line[0]
        san = _uci_to_san(board, uci)
        moves.append(
            {
                "uci": uci,
                "san": san,
                "white": 0,
                "draws": 0,
                "black": 0,
                "averageRating": None,
                "engine": True,
                "cp": pv.get("cp"),
                "mate": pv.get("mate"),
            }
        )

    return {
        "fen": fen,
        "source": f"{source}+cloud-eval",
        "fallback": True,
        "white": 0,
        "draws": 0,
        "black": 0,
        "moves": moves,
        "opening": None,
        "note": "Set LICHESS_TOKEN for full opening explorer stats.",
    }


def _iter_game_moves(row: pd.Series) -> list[chess.Move]:
    pgn_str = row.get("pgn_str") or ""
    moves_str = row.get("moves_str") or ""
    if pgn_str:
        try:
            game = chess.pgn.read_game(io.StringIO(pgn_str))
            if game:
                return list(game.mainline_moves())
        except Exception:
            pass
    if moves_str:
        board = chess.Board()
        out = []
        for san in moves_str.split():
            try:
                move = board.parse_san(san)
                out.append(move)
                board.push(move)
            except Exception:
                break
        return out
    return []


def find_critical_mistakes(
    df: pd.DataFrame,
    limit: int = 5,
    max_games: int = 4,
    sample_every: int = 2,
) -> list[dict]:
    if df.empty:
        return []

    candidates = df[df["result"] == "Loss"]
    if candidates.empty:
        candidates = df
    candidates = candidates.sort_values("created_at", ascending=False).head(
        max_games
    )

    found: list[dict] = []

    for _, row in candidates.iterrows():
        moves = _iter_game_moves(row)
        if len(moves) < 6:
            continue

        user_is_white = str(row.get("user_color", "white")).lower() == "white"
        board = chess.Board()
        best_for_game = None

        for ply, move in enumerate(moves):
            is_user_turn = (board.turn == chess.WHITE) == user_is_white
            if not is_user_turn:
                board.push(move)
                continue

            if ply % sample_every != 0 and ply < len(moves) - 1:
                board.push(move)
                continue

            fen_before = board.fen()
            played_san = board.san(move)
            played_uci = move.uci()

            try:
                before = eval_position(fen_before, multi_pv=1)
            except HTTPException:
                board.push(move)
                continue

            board.push(move)
            fen_after = board.fen()
            try:
                after = eval_position(fen_after, multi_pv=1)
            except HTTPException:
                continue

            before_cp = before.get("eval_cp_white")
            after_cp = after.get("eval_cp_white")
            if before_cp is None or after_cp is None:
                continue

            user_before = before_cp if user_is_white else -before_cp
            user_after = after_cp if user_is_white else -after_cp
            drop = user_before - user_after
            if drop < 80:
                continue

            best_san = before.get("best_san")
            best_uci = before.get("best_uci")
            if best_uci and best_uci == played_uci:
                continue

            comment = (
                f"Eval dropped ~{int(drop)} cp after {played_san}. "
                f"Engine preferred {best_san or best_uci or 'N/A'}."
            )
            item = {
                "game_id": row.get("id"),
                "created_at": (
                    row["created_at"].isoformat()
                    if hasattr(row["created_at"], "isoformat")
                    else str(row.get("created_at"))
                ),
                "opening_name": row.get("opening_name"),
                "opening_eco": row.get("opening_eco"),
                "user_color": row.get("user_color"),
                "result": row.get("result"),
                "ply": ply,
                "fen": fen_before,
                "played_uci": played_uci,
                "played_san": played_san,
                "best_uci": best_uci,
                "best_san": best_san,
                "eval_before_cp": round(user_before, 1),
                "eval_after_cp": round(user_after, 1),
                "eval_drop_cp": round(drop, 1),
                "comment": comment,
            }
            if best_for_game is None or drop > best_for_game["eval_drop_cp"]:
                best_for_game = item

        if best_for_game:
            found.append(best_for_game)

    found.sort(key=lambda x: x["eval_drop_cp"], reverse=True)
    return found[:limit]


def validate_quiz_move(fen: str, user_uci: str, best_uci: str) -> dict:
    board = chess.Board(fen)
    try:
        user_move = chess.Move.from_uci(user_uci)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid UCI move")

    legal = user_move in board.legal_moves
    user_san = board.san(user_move) if legal else None
    correct = legal and user_uci == best_uci

    alt_ok = False
    if legal and not correct:
        try:
            multi = eval_position(fen, multi_pv=3)
            top = [
                (pv.get("moves") or "").split()[0]
                for pv in (multi.get("pvs") or [])[:3]
                if pv.get("moves")
            ]
            alt_ok = user_uci in top
            correct = alt_ok
        except HTTPException:
            pass

    return {
        "fen": fen,
        "user_uci": user_uci,
        "user_san": user_san,
        "best_uci": best_uci,
        "correct": correct,
        "legal": legal,
        "accepted_as_top_line": alt_ok,
    }
