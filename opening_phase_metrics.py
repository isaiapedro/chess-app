from __future__ import annotations

import io
import math
from collections import defaultdict

import chess
import chess.pgn

OPENING_PHASE_MIN_FULLMOVE = 12
OPENING_PHASE_NEVER_CASTLE_FULLMOVE = 15
DEVELOPMENT_CHECK_FULLMOVE = 10

CENTER_SQUARES = (
    chess.D4,
    chess.E4,
    chess.D5,
    chess.E5,
)

WHITE_MINOR_START = {
    chess.B1,
    chess.G1,
    chess.C1,
    chess.F1,
}
BLACK_MINOR_START = {
    chess.B8,
    chess.G8,
    chess.C8,
    chess.F8,
}

ACCURACY_A = 103.1668
ACCURACY_B = 0.04354
ACCURACY_C = 3.1669

OPENING_PGN_METRIC_KEYS = (
    "opening_minors_developed_by_10",
    "opening_center_control_pct",
    "opening_castle_fullmove",
    "opening_uncastled_rate_pct",
    "opening_tempo_waste_rate_pct",
)

OPENING_EVAL_METRIC_KEYS = ("opening_accuracy_pct",)


def win_probability_from_cp(cp_user: float) -> float:
    if abs(cp_user) >= 50000:
        return 0.99 if cp_user > 0 else 0.01
    return 1.0 / (1.0 + 10.0 ** (-(cp_user / 100.0) / 4.0))


def move_accuracy_pct(win_pct_before: float, win_pct_after: float) -> float:
    delta = win_pct_before - win_pct_after
    raw = ACCURACY_A * math.exp(-ACCURACY_B * delta) - ACCURACY_C
    return max(0.0, min(100.0, raw))


def opening_phase_end_fullmove(castle_fullmove: int | None) -> int:
    if castle_fullmove is None:
        return max(
            OPENING_PHASE_MIN_FULLMOVE, OPENING_PHASE_NEVER_CASTLE_FULLMOVE
        )
    return max(OPENING_PHASE_MIN_FULLMOVE, castle_fullmove)


def _minor_start_squares(color: chess.Color) -> set[int]:
    return WHITE_MINOR_START if color == chess.WHITE else BLACK_MINOR_START


def count_minors_developed(board: chess.Board, color: chess.Color) -> int:
    start = _minor_start_squares(color)
    developed = 0
    for pt in (chess.KNIGHT, chess.BISHOP):
        for sq in board.pieces(pt, color):
            if sq not in start:
                developed += 1
    return min(4, developed)


def center_control_share(board: chess.Board, color: chess.Color) -> float:
    controlled = 0
    for sq in CENTER_SQUARES:
        piece = board.piece_at(sq)
        if piece is not None and piece.color == color:
            controlled += 1
            continue
        if board.is_attacked_by(color, sq):
            controlled += 1
    return (controlled / 4.0) * 100.0


def analyze_opening_game(
    pgn_str: str,
    user_color: str,
    evals_white_cp: list[float] | None = None,
) -> dict | None:
    if not pgn_str or not str(pgn_str).strip():
        return None
    try:
        game = chess.pgn.read_game(io.StringIO(str(pgn_str)))
    except Exception:
        return None
    if game is None:
        return None

    user_is_white = str(user_color or "white").lower() == "white"
    color = chess.WHITE if user_is_white else chess.BLACK
    board = game.board()

    castle_fullmove: int | None = None
    center_samples: list[float] = []
    accuracy_samples: list[float] = []
    tempo_moves = 0
    tempo_wastes = 0
    times_moved: dict[int, int] = defaultdict(int)
    minors_at_10: int | None = None
    eval_idx = 0
    evals = list(evals_white_cp) if evals_white_cp else []

    def next_eval_cp() -> float | None:
        nonlocal eval_idx
        if eval_idx < len(evals):
            cp = float(evals[eval_idx])
            eval_idx += 1
            return cp
        return None

    last_white_cp = next_eval_cp()
    phase_end = opening_phase_end_fullmove(None)

    for ply_idx, node in enumerate(game.mainline()):
        move = node.move
        full_move = ply_idx // 2 + 1
        is_user = board.turn == color
        moving = board.piece_at(move.from_square)
        is_castle = board.is_castling(move)
        cp_before_white = last_white_cp

        if is_user and is_castle and castle_fullmove is None:
            castle_fullmove = full_move
            phase_end = opening_phase_end_fullmove(castle_fullmove)

        in_phase = full_move <= phase_end

        if is_user and moving is not None and in_phase:
            if moving.piece_type != chess.PAWN:
                tempo_moves += 1
                prior = times_moved[move.from_square]
                developed = count_minors_developed(board, color)
                if prior >= 1 and developed < 4:
                    tempo_wastes += 1
                times_moved[move.to_square] = prior + 1
                if move.to_square != move.from_square:
                    times_moved[move.from_square] = 0

        board.push(move)

        if (
            minors_at_10 is None
            and full_move == DEVELOPMENT_CHECK_FULLMOVE
            and board.turn == chess.WHITE
        ):
            minors_at_10 = count_minors_developed(board, color)

        cp_after_white = next_eval_cp()
        if cp_after_white is not None:
            last_white_cp = cp_after_white

        if in_phase:
            center_samples.append(center_control_share(board, color))

        if (
            is_user
            and in_phase
            and cp_before_white is not None
            and cp_after_white is not None
        ):
            before_user = (
                cp_before_white if user_is_white else -cp_before_white
            )
            after_user = cp_after_white if user_is_white else -cp_after_white
            wp_before = win_probability_from_cp(before_user) * 100.0
            wp_after = win_probability_from_cp(after_user) * 100.0
            accuracy_samples.append(move_accuracy_pct(wp_before, wp_after))

        if full_move > phase_end and castle_fullmove is not None:
            break
        if full_move > 40:
            break

    if minors_at_10 is None:
        minors_at_10 = count_minors_developed(board, color)

    tempo_rate = (
        round((tempo_wastes / tempo_moves) * 100, 1) if tempo_moves else None
    )
    center_pct = (
        round(sum(center_samples) / len(center_samples), 1)
        if center_samples
        else None
    )
    accuracy_pct = (
        round(sum(accuracy_samples) / len(accuracy_samples), 1)
        if accuracy_samples
        else None
    )

    return {
        "opening_accuracy_pct": accuracy_pct,
        "opening_minors_developed_by_10": float(minors_at_10),
        "opening_center_control_pct": center_pct,
        "opening_castle_fullmove": (
            float(castle_fullmove) if castle_fullmove is not None else None
        ),
        "uncastled": castle_fullmove is None,
        "opening_tempo_waste_rate_pct": tempo_rate,
        "accuracy_moves": len(accuracy_samples),
        "phase_end_fullmove": float(
            opening_phase_end_fullmove(castle_fullmove)
        ),
    }


def analyze_opening_from_row(
    row: dict,
    evals_white_cp: list[float] | None = None,
) -> dict | None:
    return analyze_opening_game(
        str(row.get("pgn_str") or ""),
        str(row.get("user_color") or "white"),
        evals_white_cp,
    )


def aggregate_opening_metrics(rows: list[dict]) -> dict[str, float | None]:
    empty = {
        "opening_accuracy_pct": None,
        "opening_minors_developed_by_10": None,
        "opening_center_control_pct": None,
        "opening_castle_fullmove": None,
        "opening_uncastled_rate_pct": None,
        "opening_tempo_waste_rate_pct": None,
        "games": 0,
        "castled_games": 0,
        "accuracy_games": 0,
    }
    if not rows:
        return empty

    def mean(vals: list[float]) -> float | None:
        if not vals:
            return None
        return round(sum(vals) / len(vals), 1)

    accuracy = [
        float(r["opening_accuracy_pct"])
        for r in rows
        if r.get("opening_accuracy_pct") is not None
    ]
    minors = [
        float(r["opening_minors_developed_by_10"])
        for r in rows
        if r.get("opening_minors_developed_by_10") is not None
    ]
    center = [
        float(r["opening_center_control_pct"])
        for r in rows
        if r.get("opening_center_control_pct") is not None
    ]
    castles = [
        float(r["opening_castle_fullmove"])
        for r in rows
        if r.get("opening_castle_fullmove") is not None
    ]
    tempo = [
        float(r["opening_tempo_waste_rate_pct"])
        for r in rows
        if r.get("opening_tempo_waste_rate_pct") is not None
    ]
    uncastled_n = sum(1 for r in rows if r.get("uncastled"))
    n = len(rows)
    return {
        "opening_accuracy_pct": mean(accuracy),
        "opening_minors_developed_by_10": mean(minors),
        "opening_center_control_pct": mean(center),
        "opening_castle_fullmove": mean(castles),
        "opening_uncastled_rate_pct": (
            round((uncastled_n / n) * 100, 1) if n else None
        ),
        "opening_tempo_waste_rate_pct": mean(tempo),
        "games": n,
        "castled_games": len(castles),
        "accuracy_games": len(accuracy),
    }


def top_openings_by_side(
    rows: list[dict],
    limit: int = 5,
    min_games: int = 3,
) -> dict[str, list[dict]]:
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in rows:
        color = str(row.get("user_color") or "white").lower()
        if color not in ("white", "black"):
            continue
        eco = str(row.get("opening_eco") or "").strip().upper() or "UNK"
        name = str(row.get("opening_name") or eco or "Unknown")
        buckets[(color, f"{eco}|{name}")].append(row)

    out: dict[str, list[dict]] = {"white": [], "black": []}
    for color in ("white", "black"):
        items = []
        for (c, key_name), group in buckets.items():
            if c != color or len(group) < min_games:
                continue
            eco, _, name = key_name.partition("|")
            agg = aggregate_opening_metrics(group)
            wins = sum(1 for g in group if str(g.get("result")) == "Win")
            items.append(
                {
                    "opening_eco": eco,
                    "opening_name": name or eco,
                    "games": len(group),
                    "win_rate": round((wins / len(group)) * 100, 1),
                    "opening_accuracy_pct": agg["opening_accuracy_pct"],
                    "opening_minors_developed_by_10": agg[
                        "opening_minors_developed_by_10"
                    ],
                    "opening_center_control_pct": agg[
                        "opening_center_control_pct"
                    ],
                    "opening_castle_fullmove": agg["opening_castle_fullmove"],
                    "opening_uncastled_rate_pct": agg[
                        "opening_uncastled_rate_pct"
                    ],
                    "opening_tempo_waste_rate_pct": agg[
                        "opening_tempo_waste_rate_pct"
                    ],
                }
            )
        items.sort(key=lambda x: (-int(x["games"]), str(x["opening_name"])))
        out[color] = items[:limit]
    return out
