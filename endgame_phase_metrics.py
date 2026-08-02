from __future__ import annotations

import io
import math
from typing import Any

import chess
import chess.pgn

ENDGAME_NON_PAWN_MAX = 7
MATE_CP_THRESHOLD = 50000
WP_BLUNDER_DROP = 0.2
WP_ENDGAME_ADVANTAGE = 0.7

CENTER_SQUARES = (chess.D4, chess.E4, chess.D5, chess.E5)
PIECE_VALUE = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}
MINOR_MAJOR = (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)

THEORETICAL_KEYS = (
    "te_pawn_endings",
    "te_queen_vs_pawn",
    "te_rook_vs_pawn",
    "te_bishop_pawn_vs_knight",
    "te_opp_bishop_two_pawns",
    "te_pawn_vs_knight",
    "te_two_pawns_vs_rook",
    "te_knight_pawn_vs_bishop",
    "te_rook_pawn_vs_rook",
)

ENDGAME_PGN_METRIC_KEYS = (
    "endgame_king_centralization",
    "endgame_king_distance",
    "endgame_pawn_diff",
    "endgame_stalemate_pct",
    "endgame_theoretical_saved_win_pct",
    "endgame_theoretical_saved_draw_pct",
    *(f"{k}_win_rate_pct" for k in THEORETICAL_KEYS),
    *(f"{k}_draw_rate_pct" for k in THEORETICAL_KEYS),
)

ENDGAME_EVAL_METRIC_KEYS = (
    "endgame_blunder_avg",
    "endgame_beneficial_trade_pct",
    "endgame_simplification_trade_pct",
    "endgame_mate_conversion_pct",
    "endgame_mate_avg_seconds",
)


def win_probability_from_cp(cp_user: float) -> float:
    if abs(cp_user) >= 50000:
        return 0.99 if cp_user > 0 else 0.01
    return 1.0 / (1.0 + 10.0 ** (-(cp_user / 100.0) / 4.0))


def user_win_probability(cp_white: float, user_is_white: bool) -> float:
    user_cp = cp_white if user_is_white else -cp_white
    return win_probability_from_cp(user_cp)


def _mean(vals: list[float], digits: int = 1) -> float | None:
    if not vals:
        return None
    factor = 10**digits
    return round((sum(vals) / len(vals)) * factor) / factor


def non_pawn_piece_count(board: chess.Board) -> int:
    total = 0
    for pt in MINOR_MAJOR:
        total += len(board.pieces(pt, chess.WHITE))
        total += len(board.pieces(pt, chess.BLACK))
    return total


def _side_count(board: chess.Board, color: chess.Color) -> dict[str, Any]:
    bishops = list(board.pieces(chess.BISHOP, color))
    return {
        "q": len(board.pieces(chess.QUEEN, color)),
        "r": len(board.pieces(chess.ROOK, color)),
        "b": len(bishops),
        "n": len(board.pieces(chess.KNIGHT, color)),
        "p": len(board.pieces(chess.PAWN, color)),
        "bishop_sq": bishops,
    }


def _bare(s: dict[str, Any]) -> bool:
    return s["q"] == 0 and s["r"] == 0 and s["b"] == 0 and s["n"] == 0


def _only_n(s: dict[str, Any]) -> bool:
    return s["q"] == 0 and s["r"] == 0 and s["b"] == 0 and s["n"] == 1


def _only_q(s: dict[str, Any]) -> bool:
    return s["q"] == 1 and s["r"] == 0 and s["b"] == 0 and s["n"] == 0


def _only_r(s: dict[str, Any]) -> bool:
    return s["q"] == 0 and s["r"] == 1 and s["b"] == 0 and s["n"] == 0


def _only_b(s: dict[str, Any]) -> bool:
    return s["q"] == 0 and s["r"] == 0 and s["b"] == 1 and s["n"] == 0


def _sq_color(sq: int) -> int:
    return chess.square_color(sq)


def _find_strong_side(w: dict, b: dict, pred) -> chess.Color | None:
    if pred(w, b):
        return chess.WHITE
    if pred(b, w):
        return chess.BLACK
    return None


def classify_theoretical(
    board: chess.Board, user_color: chess.Color = chess.WHITE
) -> dict[str, Any] | None:
    w = _side_count(board, chess.WHITE)
    b = _side_count(board, chess.BLACK)
    total_pawns = w["p"] + b["p"]

    def hit(key: str, advantage_only: bool, strong_side: chess.Color | None):
        return {
            "key": key,
            "advantage_only": advantage_only,
            "user_has_advantage": (
                True if strong_side is None else strong_side == user_color
            ),
        }

    if _bare(w) and _bare(b) and total_pawns > 0:
        return hit("te_pawn_endings", False, None)

    rook_pawn = _find_strong_side(
        w,
        b,
        lambda strong, weak: _only_r(strong)
        and _only_r(weak)
        and strong["p"] >= 1
        and weak["p"] == 0,
    )
    if rook_pawn is not None:
        return hit("te_rook_pawn_vs_rook", False, None)

    if (
        _only_b(w)
        and _only_b(b)
        and w["bishop_sq"]
        and b["bishop_sq"]
        and _sq_color(w["bishop_sq"][0]) != _sq_color(b["bishop_sq"][0])
        and total_pawns == 2
    ):
        if w["p"] > b["p"]:
            strong = chess.WHITE
        elif b["p"] > w["p"]:
            strong = chess.BLACK
        else:
            strong = None
        if strong is not None:
            return hit("te_opp_bishop_two_pawns", True, strong)

    bishop_pawn_vs_n = _find_strong_side(
        w,
        b,
        lambda strong, weak: _only_b(strong)
        and strong["p"] >= 1
        and _only_n(weak)
        and weak["p"] == 0,
    )
    if bishop_pawn_vs_n is not None:
        return hit("te_bishop_pawn_vs_knight", True, bishop_pawn_vs_n)

    knight_pawn_vs_b = _find_strong_side(
        w,
        b,
        lambda strong, weak: _only_n(strong)
        and strong["p"] >= 1
        and _only_b(weak)
        and weak["p"] == 0,
    )
    if knight_pawn_vs_b is not None:
        return hit("te_knight_pawn_vs_bishop", False, None)

    two_pawns_vs_r = _find_strong_side(
        w,
        b,
        lambda strong, weak: _bare(strong)
        and strong["p"] == 2
        and _only_r(weak)
        and weak["p"] == 0,
    )
    if two_pawns_vs_r is not None:
        return hit("te_two_pawns_vs_rook", False, None)

    rook_vs_pawn = _find_strong_side(
        w,
        b,
        lambda strong, weak: _only_r(strong)
        and _bare(weak)
        and weak["p"] >= 1
        and strong["p"] == 0,
    )
    if rook_vs_pawn is not None:
        return hit("te_rook_vs_pawn", True, rook_vs_pawn)

    queen_vs_pawn = _find_strong_side(
        w,
        b,
        lambda strong, weak: _only_q(strong)
        and _bare(weak)
        and weak["p"] >= 1
        and strong["p"] == 0,
    )
    if queen_vs_pawn is not None:
        return hit("te_queen_vs_pawn", True, queen_vs_pawn)

    pawn_vs_knight = _find_strong_side(
        w,
        b,
        lambda strong, weak: _only_n(strong)
        and _bare(weak)
        and weak["p"] >= 1
        and strong["p"] == 0,
    )
    if pawn_vs_knight is not None:
        return hit("te_pawn_vs_knight", False, None)

    return None


def king_centralization_score(
    board: chess.Board, color: chess.Color
) -> float | None:
    king_sq = board.king(color)
    if king_sq is None:
        return None
    best = min(chess.square_distance(king_sq, sq) for sq in CENTER_SQUARES)
    return max(0, 4 - best)


def _is_enemy_passer(
    board: chess.Board, pawn_sq: int, enemy_color: chess.Color
) -> bool:
    file = chess.square_file(pawn_sq)
    rank = chess.square_rank(pawn_sq)
    direction = 1 if enemy_color == chess.WHITE else -1
    promote_rank = 7 if enemy_color == chess.WHITE else 0
    r = rank + direction
    while (direction > 0 and r <= promote_rank) or (
        direction < 0 and r >= promote_rank
    ):
        for df in (-1, 0, 1):
            f = file + df
            if f < 0 or f > 7:
                continue
            sq = chess.square(f, r)
            piece = board.piece_at(sq)
            if (
                piece is not None
                and piece.piece_type == chess.PAWN
                and piece.color != enemy_color
            ):
                return False
        r += direction
    return True


def king_distance_to_enemy_pawns(
    board: chess.Board, color: chess.Color
) -> float | None:
    king_sq = board.king(color)
    if king_sq is None:
        return None
    enemy = not color
    pawns = list(board.pieces(chess.PAWN, enemy))
    if not pawns:
        return None
    best = math.inf
    promote_rank = 7 if enemy == chess.WHITE else 0
    for pawn in pawns:
        best = min(best, chess.square_distance(king_sq, pawn))
        if _is_enemy_passer(board, pawn, enemy):
            target = chess.square(chess.square_file(pawn), promote_rank)
            best = min(best, chess.square_distance(king_sq, target))
    return None if best is math.inf else float(best)


def analyze_endgame_game(
    pgn_str: str,
    user_color: str,
    evals_white_cp: list[float] | None = None,
    result: str | None = None,
) -> dict | None:
    if not pgn_str or not str(pgn_str).strip():
        return None
    game = chess.pgn.read_game(io.StringIO(pgn_str))
    if game is None:
        return None

    board = game.board()
    user_is_white = str(user_color or "white").lower() == "white"
    color = chess.WHITE if user_is_white else chess.BLACK
    game_result = result if result is not None else str(game.headers.get("Result") or "")
    if game_result == "1-0":
        mapped = "Win" if user_is_white else "Loss"
    elif game_result == "0-1":
        mapped = "Win" if not user_is_white else "Loss"
    elif game_result in ("1/2-1/2", "1/2"):
        mapped = "Draw"
    else:
        mapped = str(result or "")

    evals = list(evals_white_cp or [])
    eval_idx = 0

    def next_eval() -> float | None:
        nonlocal eval_idx
        if eval_idx < len(evals):
            cp = evals[eval_idx]
            eval_idx += 1
            return float(cp)
        return None

    last_white_cp = next_eval()
    endgame_start_ply: int | None = None
    center_scores: list[float] = []
    king_dists: list[float] = []
    pawn_diffs: list[float] = []
    blunders = 0
    piece_trades = 0
    beneficial_trades = 0
    winning_trades = 0
    simplification_trades = 0
    piece_trade_pending: int | None = None
    pending_trade_is_user = False
    pending_wp_before = 0.0
    pending_user_piece_val = 0
    pending_captured_val = 0
    mate_episodes = 0
    mate_converted = 0
    in_mate_episode = False
    mate_episode_clean = False
    theoretical: dict[str, bool] = {}
    theoretical_saved = False
    wp_before_last: float | None = None
    ply_idx = -1

    for move in game.mainline_moves():
        ply_idx += 1
        is_user = board.turn == color
        moving = board.piece_at(move.from_square)
        captured_piece = board.piece_at(move.to_square)
        is_capture = board.is_capture(move)
        cp_before = last_white_cp
        wp_before = (
            user_win_probability(cp_before, user_is_white)
            if cp_before is not None
            else None
        )
        wp_before_last = wp_before

        moving_type = moving.piece_type if moving else None
        captured_type = None
        if is_capture:
            if board.is_en_passant(move):
                captured_type = chess.PAWN
            elif captured_piece is not None:
                captured_type = captured_piece.piece_type

        board.push(move)
        cp_after = next_eval()
        if cp_after is not None:
            last_white_cp = cp_after
        wp_after = (
            user_win_probability(last_white_cp, user_is_white)
            if last_white_cp is not None
            else None
        )

        if endgame_start_ply is None and non_pawn_piece_count(board) <= ENDGAME_NON_PAWN_MAX:
            endgame_start_ply = ply_idx

        in_endgame = endgame_start_ply is not None and ply_idx >= endgame_start_ply
        if not in_endgame:
            continue

        centr = king_centralization_score(board, color)
        if centr is not None:
            center_scores.append(float(centr))
        dist = king_distance_to_enemy_pawns(board, color)
        if dist is not None:
            king_dists.append(float(dist))
        user_pawns = len(board.pieces(chess.PAWN, color))
        opp_pawns = len(board.pieces(chess.PAWN, not color))
        pawn_diffs.append(float(user_pawns - opp_pawns))

        te = classify_theoretical(board, color)
        if te:
            if (not te["advantage_only"]) or te["user_has_advantage"]:
                theoretical[te["key"]] = True
            else:
                theoretical_saved = True

        if is_user and wp_before is not None and wp_after is not None:
            if wp_before - wp_after >= WP_BLUNDER_DROP:
                blunders += 1

        if (
            is_capture
            and captured_type in MINOR_MAJOR
            and moving_type in MINOR_MAJOR
        ):
            if (
                piece_trade_pending is not None
                and ply_idx - piece_trade_pending <= 2
            ):
                piece_trades += 1
                trade_wp_before = pending_wp_before
                trade_wp_after = wp_after if wp_after is not None else trade_wp_before
                if trade_wp_after > trade_wp_before:
                    beneficial_trades += 1
                if trade_wp_before >= WP_ENDGAME_ADVANTAGE:
                    winning_trades += 1
                    if pending_trade_is_user:
                        user_gave_more = (
                            pending_user_piece_val > pending_captured_val
                        )
                    else:
                        user_gave_more = (
                            pending_captured_val > pending_user_piece_val
                        )
                    drop = trade_wp_before - trade_wp_after
                    if user_gave_more and drop < WP_BLUNDER_DROP:
                        simplification_trades += 1
                piece_trade_pending = None
            else:
                piece_trade_pending = ply_idx
                pending_trade_is_user = is_user
                pending_wp_before = wp_before or 0.0
                pending_user_piece_val = PIECE_VALUE.get(moving_type or 0, 0)
                pending_captured_val = PIECE_VALUE.get(captured_type or 0, 0)

        if last_white_cp is not None:
            user_cp = last_white_cp if user_is_white else -last_white_cp
            mate_now = user_cp >= MATE_CP_THRESHOLD
            if mate_now and not in_mate_episode:
                in_mate_episode = True
                mate_episode_clean = True
                mate_episodes += 1
            elif in_mate_episode and not mate_now:
                mate_episode_clean = False
                in_mate_episode = False

    if in_mate_episode and mate_episode_clean and board.is_checkmate():
        winner_is_white = board.turn == chess.BLACK
        user_won = (user_is_white and winner_is_white) or (
            (not user_is_white) and (not winner_is_white)
        )
        if user_won:
            mate_converted += 1

    accidental_stalemate = False
    if endgame_start_ply is not None and board.is_stalemate():
        if (
            wp_before_last is not None
            and wp_before_last >= WP_ENDGAME_ADVANTAGE
        ):
            accidental_stalemate = True

    if endgame_start_ply is None:
        return {
            "reached_endgame": False,
            "result": mapped,
            "theoretical": {},
            "theoretical_saved": False,
            "blunders": 0,
            "king_centralization": None,
            "king_distance": None,
            "pawn_diff": None,
            "piece_trades": 0,
            "beneficial_trades": 0,
            "winning_trades": 0,
            "simplification_trades": 0,
            "mate_episodes": 0,
            "mate_converted": 0,
            "accidental_stalemate": False,
            "mate_move_times": [],
        }

    return {
        "reached_endgame": True,
        "endgame_start_ply": endgame_start_ply,
        "result": mapped,
        "theoretical": theoretical,
        "theoretical_saved": theoretical_saved,
        "blunders": blunders,
        "king_centralization": _mean(center_scores, 2),
        "king_distance": _mean(king_dists, 2),
        "pawn_diff": _mean(pawn_diffs, 2),
        "piece_trades": piece_trades,
        "beneficial_trades": beneficial_trades,
        "winning_trades": winning_trades,
        "simplification_trades": simplification_trades,
        "mate_episodes": mate_episodes,
        "mate_converted": mate_converted,
        "accidental_stalemate": accidental_stalemate,
        "mate_move_times": [],
    }


def analyze_endgame_from_row(
    row: dict, evals_white_cp: list[float] | None = None
) -> dict | None:
    return analyze_endgame_game(
        str(row.get("pgn_str") or ""),
        str(row.get("user_color") or "white"),
        evals_white_cp,
        result=str(row.get("result") or ""),
    )


def aggregate_endgame_metrics(rows: list[dict]) -> dict[str, Any]:
    end_rows = [r for r in rows if r.get("reached_endgame")]
    empty = {
        "games": len(rows),
        "endgame_games": 0,
        "endgame_blunder_avg": None,
        "endgame_theoretical_saved_win_pct": None,
        "endgame_theoretical_saved_draw_pct": None,
        "endgame_king_centralization": None,
        "endgame_king_distance": None,
        "endgame_pawn_diff": None,
        "endgame_beneficial_trade_pct": None,
        "endgame_simplification_trade_pct": None,
        "endgame_mate_conversion_pct": None,
        "endgame_stalemate_pct": None,
        "endgame_mate_avg_seconds": None,
    }
    for key in THEORETICAL_KEYS:
        empty[f"{key}_win_rate_pct"] = None
        empty[f"{key}_draw_rate_pct"] = None
    if not end_rows:
        return empty

    total_trades = sum(int(r.get("piece_trades") or 0) for r in end_rows)
    beneficial = sum(int(r.get("beneficial_trades") or 0) for r in end_rows)
    winning_trades = sum(int(r.get("winning_trades") or 0) for r in end_rows)
    simplifications = sum(
        int(r.get("simplification_trades") or 0) for r in end_rows
    )
    mate_eps = sum(int(r.get("mate_episodes") or 0) for r in end_rows)
    mate_conv = sum(int(r.get("mate_converted") or 0) for r in end_rows)
    stalemates = sum(1 for r in end_rows if r.get("accidental_stalemate"))
    mate_times = [
        float(t)
        for r in end_rows
        for t in (r.get("mate_move_times") or [])
        if t is not None
    ]
    saved_rows = [r for r in end_rows if r.get("theoretical_saved")]
    saved_wins = sum(1 for r in saved_rows if r.get("result") == "Win")
    saved_draws = sum(1 for r in saved_rows if r.get("result") == "Draw")

    out: dict[str, Any] = {
        "games": len(rows),
        "endgame_games": len(end_rows),
        "endgame_blunder_avg": _mean(
            [float(r.get("blunders") or 0) for r in end_rows], 1
        ),
        "endgame_theoretical_saved_win_pct": (
            round((saved_wins / len(saved_rows)) * 1000) / 10
            if saved_rows
            else None
        ),
        "endgame_theoretical_saved_draw_pct": (
            round((saved_draws / len(saved_rows)) * 1000) / 10
            if saved_rows
            else None
        ),
        "endgame_king_centralization": _mean(
            [
                float(r["king_centralization"])
                for r in end_rows
                if r.get("king_centralization") is not None
            ],
            2,
        ),
        "endgame_king_distance": _mean(
            [
                float(r["king_distance"])
                for r in end_rows
                if r.get("king_distance") is not None
            ],
            2,
        ),
        "endgame_pawn_diff": _mean(
            [
                float(r["pawn_diff"])
                for r in end_rows
                if r.get("pawn_diff") is not None
            ],
            2,
        ),
        "endgame_beneficial_trade_pct": (
            round((beneficial / total_trades) * 1000) / 10
            if total_trades > 0
            else None
        ),
        "endgame_simplification_trade_pct": (
            round((simplifications / winning_trades) * 1000) / 10
            if winning_trades > 0
            else None
        ),
        "endgame_mate_conversion_pct": (
            round((mate_conv / mate_eps) * 1000) / 10 if mate_eps > 0 else None
        ),
        "endgame_stalemate_pct": round((stalemates / len(end_rows)) * 1000)
        / 10,
        "endgame_mate_avg_seconds": _mean(mate_times, 1),
    }

    for key in THEORETICAL_KEYS:
        tagged = [
            r
            for r in end_rows
            if (r.get("theoretical") or {}).get(key)
        ]
        if not tagged:
            out[f"{key}_win_rate_pct"] = None
            out[f"{key}_draw_rate_pct"] = None
            continue
        wins = sum(1 for r in tagged if r.get("result") == "Win")
        draws = sum(1 for r in tagged if r.get("result") == "Draw")
        out[f"{key}_win_rate_pct"] = round((wins / len(tagged)) * 1000) / 10
        out[f"{key}_draw_rate_pct"] = round((draws / len(tagged)) * 1000) / 10

    return out
