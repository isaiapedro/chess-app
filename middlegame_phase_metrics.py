from __future__ import annotations

import chess

PIECE_POWER = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}

MIDDLEGAME_PGN_METRIC_KEYS = (
    "middlegame_king_attackers_score",
    "middlegame_pawn_shield_pct",
    "middlegame_open_file_proximity_pct",
    "middlegame_safe_moves_pct",
    "middlegame_outpost_control_avg",
    "middlegame_space_advantage_pct",
    "middlegame_iqp_win_rate_pct",
    "middlegame_doubled_pawns_game_pct",
    "middlegame_backward_pawns_game_pct",
    "middlegame_pawn_islands_avg",
)

MIDDLEGAME_EVAL_METRIC_KEYS = (
    "middlegame_accuracy_pct",
    "middlegame_blunder_avg",
    "middlegame_mistake_avg",
    "middlegame_inaccuracy_avg",
    "middlegame_missed_opportunity_pct",
    "middlegame_missed_tactic_pct",
    "middlegame_allowed_tactic_pct",
)


def middlegame_start_ply(phase_end_fullmove: int) -> int:
    return phase_end_fullmove * 2


def in_middlegame_ply(
    ply_idx: int,
    phase_end_fullmove: int,
    endgame_start_ply: int | None,
) -> bool:
    start = middlegame_start_ply(phase_end_fullmove)
    if ply_idx < start:
        return False
    if endgame_start_ply is not None and ply_idx >= endgame_start_ply:
        return False
    return True


def _mean(vals: list[float], digits: int = 1) -> float | None:
    if not vals:
        return None
    factor = 10**digits
    return round((sum(vals) / len(vals)) * factor) / factor


def king_zone_squares(king: chess.Square) -> list[chess.Square]:
    f = chess.square_file(king)
    r = chess.square_rank(king)
    out: list[chess.Square] = []
    for df in (-1, 0, 1):
        for dr in (-1, 0, 1):
            if df == 0 and dr == 0:
                continue
            nf, nr = f + df, r + dr
            if 0 <= nf <= 7 and 0 <= nr <= 7:
                out.append(chess.square(nf, nr))
    return out


KING_ATTACKER_POWER_MAX = (
    PIECE_POWER.get(chess.QUEEN, 9)
    + PIECE_POWER.get(chess.ROOK, 5) * 2
    + PIECE_POWER.get(chess.BISHOP, 3) * 2
    + PIECE_POWER.get(chess.KNIGHT, 3) * 2
)
KING_ATTACKERS_SCORE_MAX = KING_ATTACKER_POWER_MAX * KING_ATTACKER_POWER_MAX


def king_attackers_score(board: chess.Board, user_color: chess.Color) -> float:
    king_sqs = board.pieces(chess.KING, user_color)
    if not king_sqs:
        return 0.0
    king = next(iter(king_sqs))
    opp = not user_color
    seen: set[int] = set()
    weight = 0
    for zone_sq in king_zone_squares(king):
        for atk in board.attackers(opp, zone_sq):
            if atk in seen:
                continue
            seen.add(atk)
            piece = board.piece_at(atk)
            if piece is None or piece.piece_type == chess.KING:
                continue
            weight += PIECE_POWER.get(piece.piece_type, 0)
    raw = float(weight * weight)
    return (
        round(min(raw, KING_ATTACKERS_SCORE_MAX) / KING_ATTACKERS_SCORE_MAX * 1000)
        / 10
    )


def _shield_squares(
    king: chess.Square, color: chess.Color
) -> list[chess.Square] | None:
    f = chess.square_file(king)
    r = chess.square_rank(king)
    home = 0 if color == chess.WHITE else 7
    if r != home:
        return None
    pawn_rank = 1 if color == chess.WHITE else 6
    if f >= 5:
        files = (5, 6, 7)
    elif f <= 2:
        files = (0, 1, 2)
    else:
        return None
    return [chess.square(ff, pawn_rank) for ff in files]


def pawn_shield_integrity_pct(
    board: chess.Board, user_color: chess.Color
) -> float | None:
    king_sqs = board.pieces(chess.KING, user_color)
    if not king_sqs:
        return None
    king = next(iter(king_sqs))
    shields = _shield_squares(king, user_color)
    if shields is None:
        return None
    home_pawn_rank = 1 if user_color == chess.WHITE else 6
    score = 100.0
    for target in shields:
        file = chess.square_file(target)
        pawn_rank = None
        for rank in range(8):
            sq = chess.square(file, rank)
            piece = board.piece_at(sq)
            if (
                piece
                and piece.piece_type == chess.PAWN
                and piece.color == user_color
            ):
                pawn_rank = rank
                break
        if pawn_rank is None:
            score -= 34
            continue
        advanced = (
            pawn_rank - home_pawn_rank
            if user_color == chess.WHITE
            else home_pawn_rank - pawn_rank
        )
        if advanced >= 2:
            score -= 25
        elif advanced == 1:
            score -= 15
    return max(0.0, min(100.0, score))


def _file_openness(
    board: chess.Board, file: int, color: chess.Color
) -> str:
    mine = 0
    theirs = 0
    opp = not color
    for rank in range(8):
        piece = board.piece_at(chess.square(file, rank))
        if piece is None or piece.piece_type != chess.PAWN:
            continue
        if piece.color == color:
            mine += 1
        elif piece.color == opp:
            theirs += 1
    if mine == 0 and theirs == 0:
        return "open"
    if mine == 0 or theirs == 0:
        return "semi"
    return "closed"


def _openness_score(kind: str) -> float:
    if kind == "open":
        return 100.0
    if kind == "semi":
        return 70.0
    return 0.0


def open_file_proximity_pct(
    board: chess.Board, user_color: chess.Color, *, castled: bool = False
) -> float:
    king_sqs = board.pieces(chess.KING, user_color)
    if not king_sqs:
        return 0.0
    king = next(iter(king_sqs))
    kf = chess.square_file(king)
    best = _openness_score(_file_openness(board, kf, user_color))
    for adj in (kf - 1, kf + 1):
        if 0 <= adj <= 7:
            base = _openness_score(_file_openness(board, adj, user_color))
            if base > 0:
                best = max(best, round(base * 0.5))
    home = 0 if user_color == chess.WHITE else 7
    if castled and chess.square_rank(king) == home:
        rook_file = 7 if kf >= 5 else 0 if kf <= 2 else None
        if rook_file is not None:
            base = _openness_score(
                _file_openness(board, rook_file, user_color)
            )
            if base > 0:
                best = max(best, round(base * 0.6))
    return float(best)


def is_attacked_by_pawn(
    board: chess.Board, target: chess.Square, by_color: chess.Color
) -> bool:
    f = chess.square_file(target)
    r = chess.square_rank(target)
    if by_color == chess.WHITE:
        dirs = ((f - 1, r - 1), (f + 1, r - 1))
    else:
        dirs = ((f - 1, r + 1), (f + 1, r + 1))
    for af, ar in dirs:
        if 0 <= af <= 7 and 0 <= ar <= 7:
            piece = board.piece_at(chess.square(af, ar))
            if (
                piece
                and piece.piece_type == chess.PAWN
                and piece.color == by_color
            ):
                return True
    return False


def safe_legal_moves_pct(
    board: chess.Board, user_color: chess.Color
) -> float | None:
    if board.turn != user_color:
        return None
    moves = list(board.legal_moves)
    if not moves:
        return None
    opp = not user_color
    safe = 0
    for move in moves:
        if not is_attacked_by_pawn(board, move.to_square, opp):
            safe += 1
    return round((safe / len(moves)) * 100, 1)


def is_outpost_square(
    board: chess.Board, target: chess.Square, color: chess.Color
) -> bool:
    rank = chess.square_rank(target)
    if color == chess.WHITE:
        if rank < 3 or rank > 5:
            return False
    elif rank < 2 or rank > 4:
        return False
    if not is_attacked_by_pawn(board, target, color):
        return False
    if is_attacked_by_pawn(board, target, not color):
        return False
    return True


def outpost_control_count(
    board: chess.Board, user_color: chess.Color
) -> int:
    n = 0
    for pt in (chess.KNIGHT, chess.BISHOP):
        for sq in board.pieces(pt, user_color):
            if is_outpost_square(board, sq, user_color):
                n += 1
    return n


def space_advantage_pct(
    board: chess.Board, user_color: chess.Color
) -> float:
    opp = not user_color
    ranks = (1, 2, 3, 4) if user_color == chess.WHITE else (6, 5, 4, 3)
    good = 0
    total = 0
    for file in (2, 3, 4, 5):
        for rank in ranks:
            total += 1
            sq = chess.square(file, rank)
            if is_attacked_by_pawn(board, sq, opp):
                continue
            good += 1
    return round((good / total) * 100, 1) if total else 0.0


def has_isolated_queen_pawn(
    board: chess.Board, color: chess.Color
) -> bool:
    d_file = 3
    has_d = False
    for rank in range(8):
        piece = board.piece_at(chess.square(d_file, rank))
        if (
            piece
            and piece.piece_type == chess.PAWN
            and piece.color == color
        ):
            has_d = True
            break
    if not has_d:
        return False
    for adj in (2, 4):
        for rank in range(8):
            piece = board.piece_at(chess.square(adj, rank))
            if (
                piece
                and piece.piece_type == chess.PAWN
                and piece.color == color
            ):
                return False
    return True


def has_doubled_pawns(board: chess.Board, color: chess.Color) -> bool:
    for file in range(8):
        count = 0
        for rank in range(8):
            piece = board.piece_at(chess.square(file, rank))
            if (
                piece
                and piece.piece_type == chess.PAWN
                and piece.color == color
            ):
                count += 1
        if count >= 2:
            return True
    return False


def has_backward_pawn(board: chess.Board, color: chess.Color) -> bool:
    direction = 1 if color == chess.WHITE else -1
    for file in range(8):
        for rank in range(8):
            sq = chess.square(file, rank)
            piece = board.piece_at(sq)
            if (
                piece is None
                or piece.piece_type != chess.PAWN
                or piece.color != color
            ):
                continue
            behind_neighbors = True
            for adj in (file - 1, file + 1):
                if adj < 0 or adj > 7:
                    continue
                for r in range(8):
                    np = board.piece_at(chess.square(adj, r))
                    if (
                        np is None
                        or np.piece_type != chess.PAWN
                        or np.color != color
                    ):
                        continue
                    if color == chess.WHITE:
                        if r <= rank:
                            behind_neighbors = False
                    elif r >= rank:
                        behind_neighbors = False
            if not behind_neighbors:
                continue
            ahead_rank = rank + direction
            if ahead_rank < 0 or ahead_rank > 7:
                continue
            ahead = chess.square(file, ahead_rank)
            if board.piece_at(ahead) is not None:
                continue
            if is_attacked_by_pawn(board, ahead, not color):
                return True
    return False


def pawn_island_count(board: chess.Board, color: chess.Color) -> int:
    files_with = []
    for file in range(8):
        has = False
        for rank in range(8):
            piece = board.piece_at(chess.square(file, rank))
            if (
                piece
                and piece.piece_type == chess.PAWN
                and piece.color == color
            ):
                has = True
                break
        files_with.append(has)
    islands = 0
    in_island = False
    for has in files_with:
        if has and not in_island:
            islands += 1
            in_island = True
        elif not has:
            in_island = False
    return islands


def max_undefended_hanging(
    board: chess.Board, color: chess.Color
) -> int:
    best = 0
    opp = not color
    for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
        val = PIECE_POWER[pt]
        for sq in board.pieces(pt, color):
            if not board.is_attacked_by(opp, sq):
                continue
            if board.is_attacked_by(color, sq):
                continue
            best = max(best, val)
    return best


def has_material_win_tactic(
    board: chess.Board, color: chess.Color
) -> bool:
    if board.turn != color:
        return False
    if max_undefended_hanging(board, not color) > 0:
        return True
    for move in board.legal_moves:
        if not board.is_capture(move):
            continue
        captured = board.piece_at(move.to_square)
        if captured is None and board.is_en_passant(move):
            captured = chess.Piece(chess.PAWN, not board.turn)
        if captured is None:
            continue
        gain = PIECE_POWER.get(captured.piece_type, 0)
        if gain < 1:
            continue
        dest = move.to_square
        if not board.is_attacked_by(not color, dest):
            return True
        defenders = board.attackers(not color, dest)
        min_def = 99
        for d in defenders:
            dp = board.piece_at(d)
            if dp is None:
                continue
            min_def = min(min_def, PIECE_POWER.get(dp.piece_type, 99))
        attacker = board.piece_at(move.from_square)
        a_val = PIECE_POWER.get(attacker.piece_type, 0) if attacker else 0
        if gain > a_val or (gain >= a_val and a_val <= min_def):
            return True
    return False


def empty_middlegame_row(result: str) -> dict:
    return {
        "reached_middlegame": False,
        "middlegame_accuracy_pct": None,
        "middlegame_accuracy_moves": 0,
        "middlegame_blunders": 0,
        "middlegame_mistakes": 0,
        "middlegame_inaccuracies": 0,
        "middlegame_missed_opportunity_pct": None,
        "middlegame_missed_tactic_pct": None,
        "middlegame_allowed_tactic_pct": None,
        "middlegame_king_attackers_score": None,
        "middlegame_pawn_shield_pct": None,
        "middlegame_open_file_proximity_pct": None,
        "middlegame_safe_moves_pct": None,
        "middlegame_outpost_control": None,
        "middlegame_space_advantage_pct": None,
        "had_iqp": False,
        "had_doubled_pawns": False,
        "had_backward_pawns": False,
        "middlegame_pawn_islands_avg": None,
        "result": result,
    }


def build_middlegame_row(
    *,
    reached: bool,
    result: str,
    attacker_scores: list[float],
    shield_scores: list[float],
    open_file_scores: list[float],
    safe_scores: list[float],
    outpost_counts: list[float],
    space_scores: list[float],
    island_scores: list[float],
    had_iqp: bool,
    had_doubled: bool,
    had_backward: bool,
    accuracy_samples: list[float],
    blunders: int,
    mistakes: int = 0,
    inaccuracies: int = 0,
    missed_opp_chances: int,
    missed_opps: int,
    missed_tactic_chances: int,
    missed_tactics: int,
    allowed_chances: int,
    allowed_found: int,
) -> dict:
    if not reached:
        return empty_middlegame_row(result)
    return {
        "reached_middlegame": True,
        "middlegame_accuracy_pct": _mean(accuracy_samples, 1),
        "middlegame_accuracy_moves": len(accuracy_samples),
        "middlegame_blunders": blunders,
        "middlegame_mistakes": mistakes,
        "middlegame_inaccuracies": inaccuracies,
        "middlegame_missed_opportunity_pct": (
            round((missed_opps / missed_opp_chances) * 100, 1)
            if missed_opp_chances
            else None
        ),
        "middlegame_missed_tactic_pct": (
            round((missed_tactics / missed_tactic_chances) * 100, 1)
            if missed_tactic_chances
            else None
        ),
        "middlegame_allowed_tactic_pct": (
            round((allowed_found / allowed_chances) * 100, 1)
            if allowed_chances
            else None
        ),
        "middlegame_king_attackers_score": _mean(attacker_scores, 1),
        "middlegame_pawn_shield_pct": _mean(shield_scores, 1),
        "middlegame_open_file_proximity_pct": _mean(open_file_scores, 1),
        "middlegame_safe_moves_pct": _mean(safe_scores, 1),
        "middlegame_outpost_control": _mean(outpost_counts, 2),
        "middlegame_space_advantage_pct": _mean(space_scores, 1),
        "had_iqp": had_iqp,
        "had_doubled_pawns": had_doubled,
        "had_backward_pawns": had_backward,
        "middlegame_pawn_islands_avg": _mean(island_scores, 2),
        "result": result,
    }


def aggregate_middlegame_metrics(rows: list[dict]) -> dict:
    mg = [r for r in rows if r.get("reached_middlegame")]
    empty = {
        "games": len(rows),
        "middlegame_games": 0,
        "middlegame_accuracy_pct": None,
        "middlegame_accuracy_games": 0,
        "middlegame_blunder_avg": None,
        "middlegame_mistake_avg": None,
        "middlegame_inaccuracy_avg": None,
        "middlegame_missed_opportunity_pct": None,
        "middlegame_missed_tactic_pct": None,
        "middlegame_allowed_tactic_pct": None,
        "middlegame_king_attackers_score": None,
        "middlegame_pawn_shield_pct": None,
        "middlegame_open_file_proximity_pct": None,
        "middlegame_safe_moves_pct": None,
        "middlegame_outpost_control_avg": None,
        "middlegame_space_advantage_pct": None,
        "middlegame_iqp_win_rate_pct": None,
        "middlegame_doubled_pawns_game_pct": None,
        "middlegame_backward_pawns_game_pct": None,
        "middlegame_pawn_islands_avg": None,
    }
    if not mg:
        return empty

    accuracy = [
        r["middlegame_accuracy_pct"]
        for r in mg
        if r.get("middlegame_accuracy_pct") is not None
    ]
    iqp_games = [r for r in mg if r.get("had_iqp")]
    iqp_wins = sum(1 for r in iqp_games if r.get("result") == "Win")
    n = len(mg)

    def mean_key(key: str, digits: int = 1):
        vals = [r[key] for r in mg if r.get(key) is not None]
        return _mean(vals, digits)

    return {
        "games": len(rows),
        "middlegame_games": n,
        "middlegame_accuracy_pct": _mean(accuracy, 1),
        "middlegame_accuracy_games": len(accuracy),
        "middlegame_blunder_avg": _mean(
            [float(r.get("middlegame_blunders") or 0) for r in mg], 2
        ),
        "middlegame_mistake_avg": _mean(
            [float(r.get("middlegame_mistakes") or 0) for r in mg], 2
        ),
        "middlegame_inaccuracy_avg": _mean(
            [float(r.get("middlegame_inaccuracies") or 0) for r in mg], 2
        ),
        "middlegame_missed_opportunity_pct": mean_key(
            "middlegame_missed_opportunity_pct"
        ),
        "middlegame_missed_tactic_pct": mean_key(
            "middlegame_missed_tactic_pct"
        ),
        "middlegame_allowed_tactic_pct": mean_key(
            "middlegame_allowed_tactic_pct"
        ),
        "middlegame_king_attackers_score": mean_key(
            "middlegame_king_attackers_score"
        ),
        "middlegame_pawn_shield_pct": mean_key("middlegame_pawn_shield_pct"),
        "middlegame_open_file_proximity_pct": mean_key(
            "middlegame_open_file_proximity_pct"
        ),
        "middlegame_safe_moves_pct": mean_key("middlegame_safe_moves_pct"),
        "middlegame_outpost_control_avg": mean_key(
            "middlegame_outpost_control", 2
        ),
        "middlegame_space_advantage_pct": mean_key(
            "middlegame_space_advantage_pct"
        ),
        "middlegame_iqp_win_rate_pct": (
            round((iqp_wins / len(iqp_games)) * 100, 1) if iqp_games else None
        ),
        "middlegame_doubled_pawns_game_pct": round(
            (sum(1 for r in mg if r.get("had_doubled_pawns")) / n) * 100, 1
        ),
        "middlegame_backward_pawns_game_pct": round(
            (sum(1 for r in mg if r.get("had_backward_pawns")) / n) * 100, 1
        ),
        "middlegame_pawn_islands_avg": mean_key(
            "middlegame_pawn_islands_avg", 2
        ),
    }
