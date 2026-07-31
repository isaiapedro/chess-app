import io
import os
from typing import Optional

import chess
import chess.pgn
import pandas as pd
from fastapi import HTTPException

from cache import (
    _dbg,
    get_gm_games,
    get_lichess_stats,
    get_masters_pgn,
    get_player_prep,
    get_position_eval,
)


START_FEN = chess.STARTING_FEN
MAX_CONSECUTIVE_EVAL_FAILURES = 6
OPENING_PLY_SKIP = 12


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


PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}
LOCAL_DEPTH = 2
LOCAL_NODE_BUDGET = 6000
MATE_SCORE = 30000


class _NodeBudget:
    def __init__(self, limit: int):
        self.remaining = limit

    def spend(self) -> None:
        self.remaining -= 1

    @property
    def exhausted(self) -> bool:
        return self.remaining <= 0


PAWN_PST = [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, -20, -20, 10, 10, 5,
    5, -5, -10, 0, 0, -10, -5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5,
    10, 10, 20, 30, 30, 20, 10, 10,
    50, 50, 50, 50, 50, 50, 50, 50,
    0, 0, 0, 0, 0, 0, 0, 0,
]
KNIGHT_PST = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
]
BISHOP_PST = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
]
ROOK_PST = [
    0, 0, 5, 10, 10, 5, 0, 0,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    5, 10, 10, 10, 10, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
]
QUEEN_PST = [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -10, 5, 5, 5, 5, 5, 0, -10,
    0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
]
KING_PST = [
    20, 30, 10, 0, 0, 10, 30, 20,
    20, 20, 0, 0, 0, 0, 20, 20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
]
PIECE_SQUARE_TABLES = {
    chess.PAWN: PAWN_PST,
    chess.KNIGHT: KNIGHT_PST,
    chess.BISHOP: BISHOP_PST,
    chess.ROOK: ROOK_PST,
    chess.QUEEN: QUEEN_PST,
    chess.KING: KING_PST,
}


def _material_cp(board: chess.Board) -> int:
    score = 0
    for square, piece in board.piece_map().items():
        value = PIECE_VALUES.get(piece.piece_type, 0)
        table = PIECE_SQUARE_TABLES[piece.piece_type]
        if piece.color == chess.WHITE:
            score += value + table[square]
        else:
            score -= value + table[chess.square_mirror(square)]
    return score if board.turn == chess.WHITE else -score


def _quiescence(
    board: chess.Board, alpha: int, beta: int, budget: _NodeBudget
) -> int:
    stand_pat = _material_cp(board)
    if stand_pat >= beta or budget.exhausted:
        return stand_pat
    alpha = max(alpha, stand_pat)

    for move in board.generate_legal_captures():
        if budget.exhausted:
            break
        budget.spend()
        board.push(move)
        score = -_quiescence(board, -beta, -alpha, budget)
        board.pop()
        if score >= beta:
            return beta
        alpha = max(alpha, score)
    return alpha


def _negamax(
    board: chess.Board, depth: int, alpha: int, beta: int, budget: _NodeBudget
) -> int:
    if board.is_checkmate():
        return -MATE_SCORE
    if board.is_stalemate() or board.is_insufficient_material():
        return 0
    if depth <= 0 or budget.exhausted:
        return _quiescence(board, alpha, beta, budget)

    best = -MATE_SCORE
    for move in board.legal_moves:
        if budget.exhausted:
            break
        budget.spend()
        board.push(move)
        score = -_negamax(board, depth - 1, -beta, -alpha, budget)
        board.pop()
        best = max(best, score)
        alpha = max(alpha, score)
        if alpha >= beta:
            break
    return best


def _local_eval(fen: str, multi_pv: int = 3) -> dict:
    board = chess.Board(fen)
    budget = _NodeBudget(LOCAL_NODE_BUDGET)
    scored: list[tuple[int, chess.Move]] = []

    for move in board.legal_moves:
        budget.spend()
        board.push(move)
        score = -_negamax(board, LOCAL_DEPTH - 1, -MATE_SCORE, MATE_SCORE, budget)
        board.pop()
        scored.append((score, move))

    if not scored:
        raise HTTPException(status_code=422, detail="No legal moves in this position")

    scored.sort(key=lambda item: item[0], reverse=True)
    white_pov = 1 if board.turn == chess.WHITE else -1
    return {
        "depth": LOCAL_DEPTH,
        "knodes": None,
        "pvs": [
            {"cp": score * white_pov, "moves": move.uci()}
            for score, move in scored[: max(1, multi_pv)]
        ],
    }


def eval_position(fen: str, multi_pv: int = 3) -> dict:
    raw = get_position_eval(fen, multi_pv=multi_pv)
    engine = "lichess-cloud"
    if not raw:
        raw = _local_eval(fen, multi_pv=multi_pv)
        engine = "local"
    board = chess.Board(fen)
    pvs = raw.get("pvs") or []
    best_uci = _best_uci(pvs)
    return {
        "fen": fen,
        "engine": engine,
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
    ratings: Optional[str] = None,
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
        resolved = ratings or "1600,1800,2000"
        data = get_lichess_stats(fen, ratings=resolved)

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

    top_games = []
    for game in data.get("topGames") or []:
        top_games.append(
            {
                "id": game.get("id"),
                "uci": game.get("uci"),
                "winner": game.get("winner"),
                "year": game.get("year"),
                "white": game.get("white"),
                "black": game.get("black"),
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
        "topGames": top_games,
        "opening": data.get("opening"),
        "ratings": ratings,
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
        "topGames": [],
        "opening": None,
        "note": (
            None
            if (os.environ.get("LICHESS_TOKEN") or os.environ.get("LICHESS_API_TOKEN"))
            else "Set LICHESS_TOKEN for full opening explorer stats."
        ),
    }


def masters_game_pgn(game_id: str) -> dict:
    data = get_masters_pgn(game_id)
    if not data or not data.get("pgn"):
        raise HTTPException(status_code=404, detail="Masters game not found")
    return {"id": game_id, "pgn": data["pgn"]}


EVAL_CLAMP_CP = 2000


def _clamp_cp(value: float) -> float:
    return max(-EVAL_CLAMP_CP, min(EVAL_CLAMP_CP, value))


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


def _opponent_name(row: pd.Series) -> str:
    stored = row.get("opponent_name")
    if pd.notna(stored) and str(stored):
        return str(stored)

    pgn_str = row.get("pgn_str") or ""
    if not pgn_str:
        return "Unknown opponent"

    try:
        game = chess.pgn.read_game(io.StringIO(pgn_str))
        if not game:
            return "Unknown opponent"
        opponent_color = (
            "Black"
            if str(row.get("user_color", "white")).lower() == "white"
            else "White"
        )
        return game.headers.get(opponent_color, "Unknown opponent")
    except Exception:
        return "Unknown opponent"


def _mistake_priority(user_before: float, user_after: float, drop: float) -> float:
    priority = drop

    if user_before >= 50 and user_after <= -50:
        priority += 3000
        priority += min(user_before, 500)
        priority += min(-user_after, 500)
    elif user_before >= 0:
        priority += 800

    priority += max(0, 500 - abs(user_before)) * 1.2
    priority -= max(0, -user_before - 300) * 1.5
    return priority


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
    eval_calls = 0
    consecutive_failures = 0
    aborted = False

    for _, row in candidates.iterrows():
        if aborted:
            break
        moves = _iter_game_moves(row)
        if len(moves) < 6:
            continue

        user_is_white = str(row.get("user_color", "white")).lower() == "white"
        board = chess.Board()
        best_for_game = None
        user_move_index = -1

        for ply, move in enumerate(moves):
            is_user_turn = (board.turn == chess.WHITE) == user_is_white
            if not is_user_turn:
                board.push(move)
                continue

            user_move_index += 1
            if ply < OPENING_PLY_SKIP:
                board.push(move)
                continue

            if user_move_index % sample_every != 0 and ply < len(moves) - 1:
                board.push(move)
                continue

            fen_before = board.fen()
            played_san = board.san(move)
            played_uci = move.uci()

            try:
                eval_calls += 1
                before = eval_position(fen_before, multi_pv=1)
                consecutive_failures = 0
            except HTTPException:
                consecutive_failures += 1
                board.push(move)
                if consecutive_failures >= MAX_CONSECUTIVE_EVAL_FAILURES:
                    aborted = True
                    break
                continue

            board.push(move)
            fen_after = board.fen()
            try:
                eval_calls += 1
                after = eval_position(fen_after, multi_pv=1)
                consecutive_failures = 0
            except HTTPException:
                consecutive_failures += 1
                if consecutive_failures >= MAX_CONSECUTIVE_EVAL_FAILURES:
                    aborted = True
                    break
                continue

            before_cp = before.get("eval_cp_white")
            after_cp = after.get("eval_cp_white")
            if before_cp is None or after_cp is None:
                continue

            user_before = _clamp_cp(before_cp if user_is_white else -before_cp)
            user_after = _clamp_cp(after_cp if user_is_white else -after_cp)
            drop = user_before - user_after
            if drop < 80:
                continue
            priority_score = _mistake_priority(user_before, user_after, drop)

            best_san = before.get("best_san")
            best_uci = before.get("best_uci")
            if best_uci and best_uci == played_uci:
                continue

            comment = (
                f"Your position worsened by ~{int(drop)} cp after {played_san}. "
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
                "opponent_name": _opponent_name(row),
                "speed": row.get("speed"),
                "user_color": row.get("user_color"),
                "result": row.get("result"),
                "ply": ply,
                "move_number": (ply // 2) + 1,
                "fen": fen_before,
                "played_uci": played_uci,
                "played_san": played_san,
                "best_uci": best_uci,
                "best_san": best_san,
                "eval_before_cp": round(_clamp_cp(before_cp), 1),
                "eval_after_cp": round(_clamp_cp(after_cp), 1),
                "eval_delta_cp": round(
                    _clamp_cp(after_cp) - _clamp_cp(before_cp), 1
                ),
                "eval_drop_cp": round(drop, 1),
                "priority_score": round(priority_score, 1),
                "comment": comment,
            }
            if (
                best_for_game is None
                or priority_score > best_for_game["priority_score"]
            ):
                best_for_game = item

        if best_for_game:
            found.append(best_for_game)

    # region agent log
    _dbg(
        {
            "hypothesisId": "H3",
            "location": "api/services/study.py:find_critical_mistakes",
            "message": "mistake scan finished",
            "data": {
                "games_scanned": int(len(candidates)),
                "eval_calls": eval_calls,
                "consecutive_failures": consecutive_failures,
                "aborted": aborted,
                "mistakes_found": len(found),
            },
        }
    )
    # endregion

    found.sort(key=lambda x: x["priority_score"], reverse=True)
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
    centipawn_loss = None
    if legal and not correct:
        try:
            multi = eval_position(fen, multi_pv=5)
            scored_moves = {}
            for pv in multi.get("pvs") or []:
                line = (pv.get("moves") or "").split()
                if line and pv.get("cp") is not None:
                    scored_moves[line[0]] = float(pv["cp"])

            best_score = scored_moves.get(best_uci)
            user_score = scored_moves.get(user_uci)
            if best_score is not None and user_score is not None:
                if board.turn == chess.WHITE:
                    centipawn_loss = best_score - user_score
                else:
                    centipawn_loss = user_score - best_score
                alt_ok = centipawn_loss <= 50
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
        "centipawn_loss": (
            round(max(0, centipawn_loss), 1)
            if centipawn_loss is not None
            else None
        ),
    }
