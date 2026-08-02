import io
import re
import statistics
from pathlib import Path

import chess
import chess.engine
import chess.pgn
import pandas as pd

from stats import extract_move_times_from_pgn

from opening_phase_metrics import (
    DEVELOPMENT_CHECK_FULLMOVE,
    center_control_share,
    count_minors_developed,
    move_accuracy_pct,
    opening_phase_end_fullmove,
    win_probability_from_cp as opening_wp_from_cp,
)
from endgame_phase_metrics import (
    ENDGAME_NON_PAWN_MAX,
    MATE_CP_THRESHOLD,
    PIECE_VALUE as EG_PIECE_VALUE,
    MINOR_MAJOR as EG_MINOR_MAJOR,
    WP_BLUNDER_DROP,
    WP_ENDGAME_ADVANTAGE,
    _mean as eg_mean,
    classify_theoretical,
    king_centralization_score,
    king_distance_to_enemy_pawns,
    non_pawn_piece_count,
    user_win_probability as eg_user_wp,
)
from middlegame_phase_metrics import (
    build_middlegame_row,
    has_backward_pawn,
    has_doubled_pawns,
    has_isolated_queen_pawn,
    has_material_win_tactic,
    in_middlegame_ply,
    king_attackers_score,
    open_file_proximity_pct,
    outpost_control_count,
    pawn_island_count,
    pawn_shield_integrity_pct,
    safe_legal_moves_pct,
    space_advantage_pct,
)

EVAL_COMMENT_RE = re.compile(r"\[%eval\s+([^\]]+)\]")

ROOT = Path(__file__).resolve().parent
DEFAULT_ENGINE = ROOT / "bin" / "stockfish" / "stockfish-ubuntu-x86-64-avx2"

PIECE_VALUE = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}

MINOR_MAJOR = {
    chess.KNIGHT,
    chess.BISHOP,
    chess.ROOK,
    chess.QUEEN,
}

ENDGAME_NON_KING_MAX = 10
EARLY_MOVE_MAX = 12
KING_TRADE_DIST = 2
DRAWISH_MIN_FULLMOVE = 40
WP_DISADVANTAGE = 0.2
WP_CRITICAL_DELTA = 0.15
WP_DRAWISH_LO = 0.45
WP_DRAWISH_HI = 0.55
ADVANTAGE_CP = 150
DRAWISH_CP = 40
CRITICAL_SWING_CP = 150
DISADVANTAGE_CP = 241
BLUNDER_CP = 241


def score_to_cp_white(score: chess.engine.PovScore) -> float | None:
    white = score.white()
    if white.is_mate():
        mate = white.mate()
        if mate is None:
            return None
        return 100000.0 if mate > 0 else -100000.0
    cp = white.score(mate_score=100000)
    return None if cp is None else float(cp)


def piece_material_for(board: chess.Board, color: chess.Color) -> int:
    total = 0
    for pt in MINOR_MAJOR:
        total += len(board.pieces(pt, color)) * PIECE_VALUE[pt]
    return total


def piece_material_balance(board: chess.Board, color: chess.Color) -> int:
    return piece_material_for(board, color) - piece_material_for(
        board, not color
    )


def non_king_count(board: chess.Board) -> int:
    return sum(
        len(board.pieces(pt, chess.WHITE)) + len(board.pieces(pt, chess.BLACK))
        for pt in (
            chess.PAWN,
            chess.KNIGHT,
            chess.BISHOP,
            chess.ROOK,
            chess.QUEEN,
        )
    )


def chebyshev(a: int, b: int) -> int:
    return max(
        abs(chess.square_file(a) - chess.square_file(b)),
        abs(chess.square_rank(a) - chess.square_rank(b)),
    )


def is_flank_file(file_idx: int) -> bool:
    return file_idx <= 2 or file_idx >= 5


def max_undefended_hanging_pieces(board: chess.Board, color: chess.Color) -> int:
    best = 0
    for pt in MINOR_MAJOR:
        val = PIECE_VALUE[pt]
        for sq in board.pieces(pt, color):
            if not board.is_attacked_by(not color, sq):
                continue
            if board.is_attacked_by(color, sq):
                continue
            best = max(best, val)
    return best


def threatens_higher_value(
    board: chess.Board, move: chess.Move, color: chess.Color
) -> bool:
    board.push(move)
    try:
        for sq in chess.SQUARES:
            victim = board.piece_at(sq)
            if (
                not victim
                or victim.color == color
                or victim.piece_type == chess.KING
                or victim.piece_type == chess.PAWN
            ):
                continue
            attackers = board.attackers(color, sq)
            if not attackers:
                continue
            v_val = PIECE_VALUE.get(victim.piece_type, 0)
            for atk_sq in attackers:
                atk = board.piece_at(atk_sq)
                if not atk or atk.piece_type == chess.KING:
                    continue
                a_val = PIECE_VALUE.get(atk.piece_type, 0)
                if a_val < v_val:
                    return True
        return False
    finally:
        board.pop()


def is_under_lesser_attack(board: chess.Board, sq: int, color: chess.Color) -> bool:
    piece = board.piece_at(sq)
    if (
        not piece
        or piece.color != color
        or piece.piece_type == chess.KING
        or piece.piece_type == chess.PAWN
    ):
        return False
    v_val = PIECE_VALUE.get(piece.piece_type, 0)
    for atk_sq in board.attackers(not color, sq):
        atk = board.piece_at(atk_sq)
        if not atk or atk.piece_type == chess.KING:
            continue
        if PIECE_VALUE.get(atk.piece_type, 0) < v_val:
            return True
    return False


def can_recapture(board: chess.Board, capture_to_sq: int) -> bool:
    for move in board.legal_moves:
        if move.to_square == capture_to_sq and board.is_capture(move):
            return True
    return False


def parse_eval_token(token: str) -> float | None:
    t = token.strip().split(",")[0].strip()
    if not t:
        return None
    if t.startswith("#"):
        try:
            n = int(t[1:])
            return 100000.0 if n > 0 else -100000.0
        except ValueError:
            return None
    try:
        return float(t) * 100.0
    except ValueError:
        return None


def extract_evals_white_cp_from_pgn(pgn_str: str) -> list[float] | None:
    if not pgn_str:
        return None
    tokens = EVAL_COMMENT_RE.findall(pgn_str)
    if not tokens:
        return None
    cps: list[float] = []
    for tok in tokens:
        cp = parse_eval_token(tok)
        if cp is not None:
            cps.append(cp)
    if not cps:
        return None
    return [0.0] + cps


def _next_cp(
    engine: chess.engine.SimpleEngine | None,
    board: chess.Board,
    limit: chess.engine.Limit | None,
    evals_white_cp: list[float] | None,
    eval_idx: int,
) -> tuple[float | None, int]:
    if evals_white_cp is not None:
        if eval_idx < len(evals_white_cp):
            return evals_white_cp[eval_idx], eval_idx + 1
        return None, eval_idx + 1
    if engine is None or limit is None:
        return None, eval_idx
    info = engine.analyse(board, limit)
    if isinstance(info, list):
        info = info[0]
    return score_to_cp_white(info["score"]), eval_idx


def parse_game_from_row(row: pd.Series) -> chess.pgn.Game | None:
    pgn_str = row.get("pgn_str", "") or ""
    if pgn_str.strip():
        try:
            game = chess.pgn.read_game(io.StringIO(pgn_str))
            if game is not None:
                return game
        except Exception:
            pass

    moves_str = row.get("moves_str", "") or ""
    if not moves_str.strip():
        return None
    game = chess.pgn.Game()
    node = game
    board = game.board()
    for token in moves_str.split():
        try:
            move = board.parse_san(token)
        except Exception:
            break
        node = node.add_variation(move)
        board.push(move)
    return game


def analyze_peer_game_metrics(
    row: pd.Series,
    engine: chess.engine.SimpleEngine | None = None,
    depth: int = 14,
    evals_white_cp: list[float] | None = None,
) -> dict | None:
    game = parse_game_from_row(row)
    if game is None:
        return None

    user_is_white = str(row.get("user_color", "white")).lower() == "white"
    user_color = chess.WHITE if user_is_white else chess.BLACK
    result = row.get("result", "")

    board = game.board()
    limit = (
        chess.engine.Limit(depth=depth)
        if engine is not None and evals_white_cp is None
        else None
    )

    evals_white: list[float] = []
    eval_idx = 0
    root_cp, eval_idx = _next_cp(
        engine, board, limit, evals_white_cp, eval_idx
    )
    if root_cp is not None:
        evals_white.append(root_cp)

    territory_own = 0
    territory_opp = 0
    forward_moves = 0
    backward_moves = 0
    lateral_moves = 0
    early_trades = 0
    trades_near_enemy_king = 0
    trades_near_user_king = 0
    higher_threats = 0
    threat_escapes = 0
    user_moves = 0
    early_flank_pushes = 0
    sacrifice_moves = 0
    declined_recaptures = 0
    recapture_chances = 0
    critical_times = []
    disadvantage_times = []
    blunders = 0
    had_disadvantage = False

    had_endgame_advantage = False
    piece_trade_pending = None
    pending_recapture_sq = None

    castle_fullmove = None
    phase_end = opening_phase_end_fullmove(None)
    center_samples = []
    accuracy_samples = []
    tempo_moves = 0
    tempo_wastes = 0
    times_moved = {}
    minors_at_10 = None
    opening_closed = False

    endgame_start_ply = None
    eg_center_scores = []
    eg_king_dists = []
    eg_pawn_diffs = []
    eg_blunders = 0
    eg_piece_trades = 0
    eg_beneficial_trades = 0
    eg_winning_trades = 0
    eg_simplification_trades = 0
    eg_trade_pending = None
    eg_pending_user = False
    eg_pending_wp_before = 0.0
    eg_pending_user_val = 0
    eg_pending_cap_val = 0
    eg_mate_episodes = 0
    eg_mate_converted = 0
    eg_in_mate = False
    eg_mate_clean = False
    eg_theoretical = {}
    eg_theoretical_saved = False
    eg_wp_before_last = None

    mg_attacker = []
    mg_shield = []
    mg_open = []
    mg_safe = []
    mg_outpost = []
    mg_space = []
    mg_islands = []
    mg_had_iqp = False
    mg_had_doubled = False
    mg_had_backward = False
    mg_seen = False
    mg_accuracy = []
    mg_blunders = 0
    mg_pending_opp = False
    mg_pending_opp_tactic = False
    mg_pending_opp_wp = None
    mg_missed_chances = 0
    mg_missed = 0
    mg_missed_tactic_chances = 0
    mg_missed_tactics = 0
    mg_pending_allowed = False
    mg_allowed_chances = 0
    mg_allowed_found = 0

    clock = extract_move_times_from_pgn(
        row.get("pgn_str", ""),
        row.get("time_control", ""),
        row.get("user_color", "white"),
    )
    user_times = (clock or {}).get("user_times") or []

    for ply_idx, node in enumerate(game.mainline()):
        move = node.move
        full_move = ply_idx // 2 + 1
        is_user = board.turn == user_color
        from_sq = move.from_square
        to_sq = move.to_square
        from_rank = chess.square_rank(from_sq)
        to_rank = chess.square_rank(to_sq)
        to_file = chess.square_file(to_sq)

        is_capture = board.is_capture(move)
        captured = board.piece_at(to_sq)
        if not captured and board.is_en_passant(move):
            captured = chess.Piece(chess.PAWN, not board.turn)

        moving_piece = board.piece_at(from_sq)
        bal_before = piece_material_balance(board, user_color)
        eval_before = evals_white[-1] if evals_white else None

        enemy_king = board.king(not user_color)
        user_king = board.king(user_color)

        is_castle = board.is_castling(move)
        cp_before_white = evals_white[-1] if evals_white else None
        wp_before_eg = (
            eg_user_wp(cp_before_white, user_is_white)
            if cp_before_white is not None
            else None
        )
        eg_wp_before_last = wp_before_eg

        if not opening_closed:
            if is_user and is_castle and castle_fullmove is None:
                castle_fullmove = full_move
                phase_end = opening_phase_end_fullmove(castle_fullmove)
            in_phase = full_move <= phase_end
            if is_user and moving_piece is not None and in_phase:
                if moving_piece.piece_type != chess.PAWN:
                    tempo_moves += 1
                    prior = times_moved.get(move.from_square, 0)
                    developed = count_minors_developed(board, user_color)
                    if prior >= 1 and developed < 4:
                        tempo_wastes += 1
                    times_moved[move.to_square] = prior + 1
                    if move.to_square != move.from_square:
                        times_moved[move.from_square] = 0

        if is_user:
            user_move_idx = user_moves
            user_moves += 1

            eval_before_user = None
            if eval_before is not None:
                eval_before_user = (
                    eval_before if user_is_white else -eval_before
                )
                wp_before_style = eg_user_wp(eval_before, user_is_white)
                if wp_before_style <= WP_DISADVANTAGE:
                    had_disadvantage = True
                    if user_move_idx < len(user_times):
                        disadvantage_times.append(user_times[user_move_idx])

            escaping = False
            if moving_piece and is_under_lesser_attack(board, from_sq, user_color):
                escaping = True

            if pending_recapture_sq is not None:
                if can_recapture(board, pending_recapture_sq):
                    recapture_chances += 1
                    if not (
                        board.is_capture(move)
                        and move.to_square == pending_recapture_sq
                    ):
                        declined_recaptures += 1
                pending_recapture_sq = None

            if user_is_white:
                in_opp = to_rank >= 4
                if in_opp:
                    territory_opp += 1
                else:
                    territory_own += 1
                if to_rank > from_rank:
                    forward_moves += 1
                elif to_rank < from_rank:
                    backward_moves += 1
                else:
                    lateral_moves += 1
            else:
                in_opp = to_rank <= 3
                if in_opp:
                    territory_opp += 1
                else:
                    territory_own += 1
                if to_rank < from_rank:
                    forward_moves += 1
                elif to_rank > from_rank:
                    backward_moves += 1
                else:
                    lateral_moves += 1

            if (
                moving_piece
                and moving_piece.piece_type == chess.PAWN
                and full_move <= EARLY_MOVE_MAX
                and is_flank_file(to_file)
                and in_opp
            ):
                early_flank_pushes += 1

            if threatens_higher_value(board, move, user_color):
                higher_threats += 1

            board.push(move)

            if escaping and not is_under_lesser_attack(
                board, to_sq, user_color
            ):
                threat_escapes += 1

            cp, eval_idx = _next_cp(
                engine, board, limit, evals_white_cp, eval_idx
            )
            if cp is not None:
                evals_white.append(cp)

            if eval_before is not None and cp is not None:
                bal_after = piece_material_balance(board, user_color)
                bal_delta = bal_after - bal_before
                hang = max_undefended_hanging_pieces(board, user_color)
                eval_before_user = (
                    eval_before if user_is_white else -eval_before
                )
                eval_after_user = cp if user_is_white else -cp
                eval_delta = eval_after_user - eval_before_user
                offered = max(-bal_delta, hang)
                if offered >= 3 and eval_delta >= -(offered * 100) + 50:
                    sacrifice_moves += 1
                elif offered >= 3 and eval_after_user >= -75:
                    sacrifice_moves += 1

                wp_before_move = eg_user_wp(eval_before, user_is_white)
                wp_after_move = eg_user_wp(cp, user_is_white)
                if wp_before_move - wp_after_move >= WP_BLUNDER_DROP:
                    blunders += 1

                if (
                    abs(wp_after_move - wp_before_move) >= WP_CRITICAL_DELTA
                    and user_move_idx < len(user_times)
                ):
                    critical_times.append(user_times[user_move_idx])

                if wp_after_move <= WP_DISADVANTAGE:
                    had_disadvantage = True

            if cp is not None and non_king_count(board) <= ENDGAME_NON_KING_MAX:
                if eg_user_wp(cp, user_is_white) >= WP_ENDGAME_ADVANTAGE:
                    had_endgame_advantage = True

            if is_capture and captured and captured.piece_type in MINOR_MAJOR:
                if full_move <= EARLY_MOVE_MAX:
                    if (
                        piece_trade_pending is not None
                        and ply_idx - piece_trade_pending <= 2
                    ):
                        early_trades += 1
                        piece_trade_pending = None
                    else:
                        piece_trade_pending = ply_idx

                if (
                    enemy_king is not None
                    and chebyshev(to_sq, enemy_king) <= KING_TRADE_DIST
                ):
                    trades_near_enemy_king += 1
                if (
                    user_king is not None
                    and chebyshev(to_sq, user_king) <= KING_TRADE_DIST
                ):
                    trades_near_user_king += 1
        else:
            if is_capture:
                pending_recapture_sq = to_sq
            else:
                pending_recapture_sq = None

            if is_capture and captured and captured.piece_type in MINOR_MAJOR:
                if full_move <= EARLY_MOVE_MAX:
                    if (
                        piece_trade_pending is not None
                        and ply_idx - piece_trade_pending <= 2
                    ):
                        early_trades += 1
                        piece_trade_pending = None
                    else:
                        piece_trade_pending = ply_idx

                if (
                    enemy_king is not None
                    and chebyshev(to_sq, enemy_king) <= KING_TRADE_DIST
                ):
                    trades_near_enemy_king += 1
                if (
                    user_king is not None
                    and chebyshev(to_sq, user_king) <= KING_TRADE_DIST
                ):
                    trades_near_user_king += 1

            board.push(move)

            cp, eval_idx = _next_cp(
                engine, board, limit, evals_white_cp, eval_idx
            )
            if cp is not None:
                evals_white.append(cp)
                if eg_user_wp(cp, user_is_white) <= WP_DISADVANTAGE:
                    had_disadvantage = True

            if cp is not None and non_king_count(board) <= ENDGAME_NON_KING_MAX:
                if eg_user_wp(cp, user_is_white) >= WP_ENDGAME_ADVANTAGE:
                    had_endgame_advantage = True

        cp_after_white = evals_white[-1] if evals_white else None
        wp_after_eg = (
            eg_user_wp(cp_after_white, user_is_white)
            if cp_after_white is not None
            else None
        )

        if not opening_closed:
            in_phase = full_move <= phase_end
            if (
                minors_at_10 is None
                and full_move == DEVELOPMENT_CHECK_FULLMOVE
                and board.turn == chess.WHITE
            ):
                minors_at_10 = count_minors_developed(board, user_color)
            if in_phase:
                center_samples.append(center_control_share(board, user_color))
            if (
                is_user
                and in_phase
                and cp_before_white is not None
                and cp_after_white is not None
            ):
                before_user = (
                    cp_before_white if user_is_white else -cp_before_white
                )
                after_user = (
                    cp_after_white if user_is_white else -cp_after_white
                )
                accuracy_samples.append(
                    move_accuracy_pct(
                        opening_wp_from_cp(before_user) * 100.0,
                        opening_wp_from_cp(after_user) * 100.0,
                    )
                )
            if (full_move > phase_end and castle_fullmove is not None) or full_move > 40:
                opening_closed = True

        if endgame_start_ply is None and non_pawn_piece_count(board) <= ENDGAME_NON_PAWN_MAX:
            endgame_start_ply = ply_idx

        in_mg = in_middlegame_ply(ply_idx, phase_end, endgame_start_ply)
        if in_mg:
            mg_seen = True
            mg_attacker.append(king_attackers_score(board, user_color))
            shield = pawn_shield_integrity_pct(board, user_color)
            if shield is not None:
                mg_shield.append(shield)
            mg_open.append(open_file_proximity_pct(board, user_color))
            safe = safe_legal_moves_pct(board, user_color)
            if safe is not None:
                mg_safe.append(safe)
            mg_outpost.append(float(outpost_control_count(board, user_color)))
            mg_space.append(space_advantage_pct(board, user_color))
            mg_islands.append(float(pawn_island_count(board, user_color)))
            if has_isolated_queen_pawn(board, user_color):
                mg_had_iqp = True
            if has_doubled_pawns(board, user_color):
                mg_had_doubled = True
            if has_backward_pawn(board, user_color):
                mg_had_backward = True

            if is_user and wp_before_eg is not None and wp_after_eg is not None:
                mg_accuracy.append(
                    move_accuracy_pct(wp_before_eg * 100.0, wp_after_eg * 100.0)
                )
                if wp_before_eg - wp_after_eg >= WP_BLUNDER_DROP:
                    mg_blunders += 1

            if is_user and mg_pending_opp:
                mg_missed_chances += 1
                if mg_pending_opp_tactic:
                    mg_missed_tactic_chances += 1
                missed = (
                    wp_before_eg is not None
                    and wp_after_eg is not None
                    and (
                        wp_before_eg - wp_after_eg >= WP_BLUNDER_DROP
                        or (
                            mg_pending_opp_wp is not None
                            and mg_pending_opp_wp - wp_after_eg >= WP_BLUNDER_DROP
                        )
                    )
                )
                if missed:
                    mg_missed += 1
                    if mg_pending_opp_tactic:
                        mg_missed_tactics += 1
                mg_pending_opp = False
                mg_pending_opp_tactic = False
                mg_pending_opp_wp = None

            if (not is_user) and mg_pending_allowed:
                found = (
                    wp_before_eg is not None
                    and wp_after_eg is not None
                    and wp_before_eg - wp_after_eg >= WP_BLUNDER_DROP * 0.5
                ) or is_capture
                if found:
                    mg_allowed_found += 1
                mg_pending_allowed = False

            if (not is_user) and wp_before_eg is not None and wp_after_eg is not None:
                if wp_after_eg - wp_before_eg >= WP_BLUNDER_DROP:
                    mg_pending_opp = True
                    mg_pending_opp_wp = wp_after_eg
                    mg_pending_opp_tactic = has_material_win_tactic(
                        board, user_color
                    )

            if is_user and wp_before_eg is not None and wp_after_eg is not None:
                if (
                    wp_before_eg - wp_after_eg >= WP_BLUNDER_DROP
                    and has_material_win_tactic(board, not user_color)
                ):
                    mg_allowed_chances += 1
                    mg_pending_allowed = True
        else:
            if (not is_user) and mg_pending_allowed:
                mg_pending_allowed = False
            if is_user and mg_pending_opp:
                mg_pending_opp = False
                mg_pending_opp_tactic = False
                mg_pending_opp_wp = None

        if endgame_start_ply is not None and ply_idx >= endgame_start_ply:
            centr = king_centralization_score(board, user_color)
            if centr is not None:
                eg_center_scores.append(float(centr))
            dist = king_distance_to_enemy_pawns(board, user_color)
            if dist is not None:
                eg_king_dists.append(float(dist))
            eg_pawn_diffs.append(
                float(
                    len(board.pieces(chess.PAWN, user_color))
                    - len(board.pieces(chess.PAWN, not user_color))
                )
            )
            te = classify_theoretical(board, user_color)
            if te:
                if (not te["advantage_only"]) or te["user_has_advantage"]:
                    eg_theoretical[te["key"]] = True
                else:
                    eg_theoretical_saved = True
            if is_user and wp_before_eg is not None and wp_after_eg is not None:
                if wp_before_eg - wp_after_eg >= WP_BLUNDER_DROP:
                    eg_blunders += 1
            captured_type = captured.piece_type if captured else None
            moving_type = moving_piece.piece_type if moving_piece else None
            if (
                is_capture
                and captured_type in EG_MINOR_MAJOR
                and moving_type in EG_MINOR_MAJOR
            ):
                if eg_trade_pending is not None and ply_idx - eg_trade_pending <= 2:
                    eg_piece_trades += 1
                    tw_before = eg_pending_wp_before
                    tw_after = wp_after_eg if wp_after_eg is not None else tw_before
                    if tw_after > tw_before:
                        eg_beneficial_trades += 1
                    if tw_before >= WP_ENDGAME_ADVANTAGE:
                        eg_winning_trades += 1
                        if eg_pending_user:
                            user_gave_more = eg_pending_user_val > eg_pending_cap_val
                        else:
                            user_gave_more = eg_pending_cap_val > eg_pending_user_val
                        if user_gave_more and (tw_before - tw_after) < WP_BLUNDER_DROP:
                            eg_simplification_trades += 1
                    eg_trade_pending = None
                else:
                    eg_trade_pending = ply_idx
                    eg_pending_user = is_user
                    eg_pending_wp_before = wp_before_eg or 0.0
                    eg_pending_user_val = EG_PIECE_VALUE.get(moving_type or 0, 0)
                    eg_pending_cap_val = EG_PIECE_VALUE.get(captured_type or 0, 0)
            if cp_after_white is not None:
                user_cp = cp_after_white if user_is_white else -cp_after_white
                mate_now = user_cp >= MATE_CP_THRESHOLD
                if mate_now and not eg_in_mate:
                    eg_in_mate = True
                    eg_mate_clean = True
                    eg_mate_episodes += 1
                elif eg_in_mate and not mate_now:
                    eg_mate_clean = False
                    eg_in_mate = False

    user_evals = [cp if user_is_white else -cp for cp in evals_white]

    volatility = 0.0
    if len(user_evals) >= 2:
        diffs = [
            abs(user_evals[i] - user_evals[i - 1])
            for i in range(1, len(user_evals))
            if abs(user_evals[i]) < 50000 and abs(user_evals[i - 1]) < 50000
        ]
        if diffs:
            volatility = statistics.mean(diffs)

    drawishless = False
    drawish_ply = DRAWISH_MIN_FULLMOVE * 2 - 1
    if result != "Draw" and len(evals_white) > drawish_ply:
        wp_at_move = eg_user_wp(evals_white[drawish_ply], user_is_white)
        if WP_DRAWISH_LO <= wp_at_move <= WP_DRAWISH_HI:
            drawishless = True

    if not had_disadvantage:
        for cp_white in evals_white:
            if eg_user_wp(cp_white, user_is_white) <= WP_DISADVANTAGE:
                had_disadvantage = True
                break

    recovered = had_disadvantage and result in ("Win", "Draw")
    clock_diff = None
    if clock:
        clock_diff = round(clock["user_avg"] - clock["opp_avg"], 1)

    terr_total = territory_own + territory_opp
    if eg_in_mate and eg_mate_clean and board.is_checkmate():
        winner_is_white = board.turn == chess.BLACK
        user_won = (user_is_white and winner_is_white) or (
            (not user_is_white) and (not winner_is_white)
        )
        if user_won:
            eg_mate_converted += 1
    accidental_stalemate = False
    if endgame_start_ply is not None and board.is_stalemate():
        if eg_wp_before_last is not None and eg_wp_before_last >= WP_ENDGAME_ADVANTAGE:
            accidental_stalemate = True

    if minors_at_10 is None:
        minors_at_10 = count_minors_developed(board, user_color)
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
    opening = {
        "opening_accuracy_pct": accuracy_pct,
        "opening_minors_developed_by_10": float(minors_at_10),
        "opening_center_control_pct": center_pct,
        "opening_castle_fullmove": (
            float(castle_fullmove) if castle_fullmove is not None else None
        ),
        "uncastled": castle_fullmove is None,
        "opening_tempo_waste_rate_pct": tempo_rate,
        "accuracy_moves": len(accuracy_samples),
        "phase_end_fullmove": float(opening_phase_end_fullmove(castle_fullmove)),
        "user_color": str(row.get("user_color") or "white"),
        "opening_eco": row.get("opening_eco"),
        "opening_name": row.get("opening_name"),
        "result": result,
    }

    if endgame_start_ply is None:
        endgame = {
            "reached_endgame": False,
            "result": result,
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
    else:
        endgame = {
            "reached_endgame": True,
            "endgame_start_ply": endgame_start_ply,
            "result": result,
            "theoretical": eg_theoretical,
            "theoretical_saved": eg_theoretical_saved,
            "blunders": eg_blunders,
            "king_centralization": eg_mean(eg_center_scores, 2),
            "king_distance": eg_mean(eg_king_dists, 2),
            "pawn_diff": eg_mean(eg_pawn_diffs, 2),
            "piece_trades": eg_piece_trades,
            "beneficial_trades": eg_beneficial_trades,
            "winning_trades": eg_winning_trades,
            "simplification_trades": eg_simplification_trades,
            "mate_episodes": eg_mate_episodes,
            "mate_converted": eg_mate_converted,
            "accidental_stalemate": accidental_stalemate,
            "mate_move_times": [],
        }

    style = {
        "id": row.get("id"),
        "result": result,
        "win": result == "Win",
        "volatility_cp": round(volatility, 1),
        "sacrifice_moves": sacrifice_moves,
        "had_sacrifice": sacrifice_moves > 0,
        "early_flank_pushes": early_flank_pushes,
        "had_early_flank": early_flank_pushes > 0,
        "had_endgame_advantage": had_endgame_advantage,
        "converted_endgame": had_endgame_advantage and result == "Win",
        "territory_own": territory_own,
        "territory_opp": territory_opp,
        "territory_opp_pct": round((territory_opp / terr_total) * 100, 1)
        if terr_total
        else 0.0,
        "early_trades": early_trades,
        "had_early_trade": early_trades > 0,
        "trades_near_enemy_king": trades_near_enemy_king,
        "trades_near_user_king": trades_near_user_king,
        "forward_moves": forward_moves,
        "backward_moves": backward_moves,
        "lateral_moves": lateral_moves,
        "higher_threats": higher_threats,
        "threat_escapes": threat_escapes,
        "user_moves": user_moves,
        "avg_time_per_move_s": clock["user_avg"] if clock else None,
        "opp_avg_time_per_move_s": clock["opp_avg"] if clock else None,
        "clock_diff_s": clock_diff,
        "drawishless": drawishless,
        "declined_recaptures": declined_recaptures,
        "recapture_chances": recapture_chances,
        "critical_move_times": critical_times,
        "avg_critical_time_s": (
            round(sum(critical_times) / len(critical_times), 1)
            if critical_times
            else None
        ),
        "critical_positions": len(critical_times),
        "had_disadvantage": had_disadvantage,
        "recovered_from_disadvantage": recovered,
        "blunders": blunders,
        "blunder_rate_pct": round((blunders / user_moves) * 100, 1)
        if user_moves
        else 0.0,
        "disadvantage_move_times": disadvantage_times,
        "avg_disadvantage_time_s": (
            round(sum(disadvantage_times) / len(disadvantage_times), 1)
            if disadvantage_times
            else None
        ),
        "disadvantage_positions": len(disadvantage_times),
    }
    middlegame = build_middlegame_row(
        reached=mg_seen,
        result=result,
        attacker_scores=mg_attacker,
        shield_scores=mg_shield,
        open_file_scores=mg_open,
        safe_scores=mg_safe,
        outpost_counts=mg_outpost,
        space_scores=mg_space,
        island_scores=mg_islands,
        had_iqp=mg_had_iqp,
        had_doubled=mg_had_doubled,
        had_backward=mg_had_backward,
        accuracy_samples=mg_accuracy,
        blunders=mg_blunders,
        missed_opp_chances=mg_missed_chances,
        missed_opps=mg_missed,
        missed_tactic_chances=mg_missed_tactic_chances,
        missed_tactics=mg_missed_tactics,
        allowed_chances=mg_allowed_chances,
        allowed_found=mg_allowed_found,
    )

    return {
        "opening": opening,
        "middlegame": middlegame,
        "endgame": endgame,
        "style": style,
    }


def analyze_one_game(
    row: pd.Series,
    engine: chess.engine.SimpleEngine | None = None,
    depth: int = 14,
    evals_white_cp: list[float] | None = None,
) -> dict | None:
    bundle = analyze_peer_game_metrics(
        row, engine=engine, depth=depth, evals_white_cp=evals_white_cp
    )
    return bundle["style"] if bundle else None


def aggregate_style_metrics(rows: list[dict]) -> dict:
    n = len(rows)
    if n == 0:
        return {
            "games": 0,
            "wins": 0,
            "win_rate": 0.0,
            "avg_time_per_move_s": None,
            "games_with_clock": 0,
            "initiative": {},
            "attacking": {},
            "creativity": {},
            "durability": {},
            "per_game": [],
        }

    wins = sum(1 for r in rows if r["win"])
    times = [
        r["avg_time_per_move_s"]
        for r in rows
        if r["avg_time_per_move_s"] is not None
    ]
    eg_adv = [r for r in rows if r["had_endgame_advantage"]]
    eg_conv = [r for r in eg_adv if r["converted_endgame"]]

    def mean(vals):
        return round(sum(vals) / len(vals), 1) if vals else 0.0

    own = sum(r["territory_own"] for r in rows)
    opp = sum(r["territory_opp"] for r in rows)
    terr = own + opp
    fwd = sum(r["forward_moves"] for r in rows)
    back = sum(r["backward_moves"] for r in rows)
    lat = sum(r["lateral_moves"] for r in rows)
    dir_total = fwd + back + lat

    recapture_chances = sum(r["recapture_chances"] for r in rows)
    declined = sum(r["declined_recaptures"] for r in rows)
    critical_all = [
        t for r in rows for t in (r.get("critical_move_times") or [])
    ]
    drawishless_n = sum(1 for r in rows if r.get("drawishless"))
    disadv_games = [r for r in rows if r.get("had_disadvantage")]
    recovered = [r for r in disadv_games if r.get("recovered_from_disadvantage")]
    total_blunders = sum(r.get("blunders", 0) for r in rows)
    total_user_moves = sum(r.get("user_moves", 0) for r in rows)
    clock_diffs = [
        r["clock_diff_s"] for r in rows if r.get("clock_diff_s") is not None
    ]
    disadv_times = [
        t for r in rows for t in (r.get("disadvantage_move_times") or [])
    ]

    return {
        "games": n,
        "wins": wins,
        "win_rate": round((wins / n) * 100, 1),
        "avg_time_per_move_s": mean(times) if times else None,
        "games_with_clock": len(times),
        "initiative": {
            "avg_eval_volatility_cp": mean([r["volatility_cp"] for r in rows]),
            "sacrifice_rate_pct": round(
                (sum(1 for r in rows if r["had_sacrifice"]) / n) * 100, 1
            ),
            "avg_sacrifice_moves": mean([r["sacrifice_moves"] for r in rows]),
            "early_flank_rate_pct": round(
                (sum(1 for r in rows if r["had_early_flank"]) / n) * 100, 1
            ),
            "avg_early_flank_pushes": mean(
                [r["early_flank_pushes"] for r in rows]
            ),
            "endgame_advantage_games": len(eg_adv),
            "endgame_conversion_rate_pct": round(
                (len(eg_conv) / len(eg_adv)) * 100, 1
            )
            if eg_adv
            else None,
            "early_trade_rate_pct": round(
                (sum(1 for r in rows if r["had_early_trade"]) / n) * 100, 1
            ),
            "avg_early_trades": mean([r["early_trades"] for r in rows]),
        },
        "attacking": {
            "avg_higher_value_threats": mean(
                [r["higher_threats"] for r in rows]
            ),
            "avg_threat_escapes": mean([r["threat_escapes"] for r in rows]),
            "avg_trades_near_enemy_king": mean(
                [r["trades_near_enemy_king"] for r in rows]
            ),
            "avg_trades_near_user_king": mean(
                [r["trades_near_user_king"] for r in rows]
            ),
            "territory_opp_pct": round((opp / terr) * 100, 1) if terr else 0.0,
            "territory_own_pct": round((own / terr) * 100, 1) if terr else 0.0,
            "forward_move_pct": round((fwd / dir_total) * 100, 1)
            if dir_total
            else 0.0,
            "backward_move_pct": round((back / dir_total) * 100, 1)
            if dir_total
            else 0.0,
            "lateral_move_pct": round((lat / dir_total) * 100, 1)
            if dir_total
            else 0.0,
        },
        "creativity": {
            "drawishless_games": drawishless_n,
            "drawishless_rate_pct": round((drawishless_n / n) * 100, 1),
            "declined_recapture_rate_pct": round(
                (declined / recapture_chances) * 100, 1
            )
            if recapture_chances
            else 0.0,
            "declined_recaptures": declined,
            "recapture_chances": recapture_chances,
            "avg_declined_recaptures": mean(
                [r["declined_recaptures"] for r in rows]
            ),
            "avg_critical_time_s": mean(critical_all) if critical_all else None,
            "critical_positions": len(critical_all),
            "avg_critical_positions": mean(
                [r["critical_positions"] for r in rows]
            ),
        },
        "durability": {
            "disadvantage_games": len(disadv_games),
            "recovered_games": len(recovered),
            "recovery_rate_pct": round(
                (len(recovered) / len(disadv_games)) * 100, 1
            )
            if disadv_games
            else None,
            "total_blunders": total_blunders,
            "avg_blunders": mean([r.get("blunders", 0) for r in rows]),
            "blunder_rate_pct": round(
                (total_blunders / total_user_moves) * 100, 1
            )
            if total_user_moves
            else 0.0,
            "avg_clock_diff_s": mean(clock_diffs) if clock_diffs else None,
            "avg_disadvantage_time_s": mean(disadv_times)
            if disadv_times
            else None,
            "disadvantage_positions": len(disadv_times),
        },
        "per_game": rows,
    }


def calculate_style_metrics(
    df: pd.DataFrame,
    n: int = 10,
    engine_path: Path | None = None,
    depth: int = 14,
    threads: int = 2,
    hash_mb: int = 32,
    progress_callback=None,
) -> dict:
    engine_path = Path(engine_path) if engine_path else DEFAULT_ENGINE
    if df.empty:
        return aggregate_style_metrics([])
    if not engine_path.exists():
        raise FileNotFoundError(f"Stockfish not found: {engine_path}")

    sample = df.sort_values("created_at").tail(n)
    engine = chess.engine.SimpleEngine.popen_uci(str(engine_path))
    per_game = []
    try:
        engine.configure({"Threads": threads, "Hash": hash_mb})
        total = len(sample)
        for i, (_, row) in enumerate(sample.iterrows(), start=1):
            if progress_callback:
                progress_callback(i, total, row.get("id"))
            stats = analyze_one_game(row, engine=engine, depth=depth)
            if stats:
                per_game.append(stats)
    finally:
        engine.quit()

    return aggregate_style_metrics(per_game)


def calculate_style_metrics_from_evals(
    df: pd.DataFrame,
    progress_callback=None,
) -> dict:
    if df.empty:
        return aggregate_style_metrics([])
    per_game = []
    total = len(df)
    for i, (_, row) in enumerate(df.iterrows(), start=1):
        if progress_callback:
            progress_callback(i, total, row.get("id"))
        evals = extract_evals_white_cp_from_pgn(row.get("pgn_str", "") or "")
        if evals is None:
            continue
        stats = analyze_one_game(row, engine=None, evals_white_cp=evals)
        if stats:
            per_game.append(stats)
    return aggregate_style_metrics(per_game)


def calculate_style_metrics_pgn_only(
    df: pd.DataFrame,
    progress_callback=None,
) -> dict:
    if df.empty:
        return aggregate_style_metrics([])
    per_game = []
    total = len(df)
    for i, (_, row) in enumerate(df.iterrows(), start=1):
        if progress_callback:
            progress_callback(i, total, row.get("id"))
        stats = analyze_one_game(row, engine=None, evals_white_cp=None)
        if stats:
            per_game.append(stats)
    return aggregate_style_metrics(per_game)
