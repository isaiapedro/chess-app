import io
import re
import chess
import chess.pgn
import pandas as pd
from eco_names import build_eco_name_map, format_eco_label


def normalize_opening_eco(raw_eco: str) -> str:
    if not raw_eco or raw_eco == "UNK":
        return "UNK"
    return str(raw_eco).strip().upper()


def parse_clk_to_seconds(clk: str) -> float:
    parts = clk.split(":")
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    if len(parts) == 2:
        return int(parts[0]) * 60 + float(parts[1])
    return float(clk)


def parse_time_control(tc: str):
    if not tc or "/" in str(tc):
        return None, 0.0
    tc = str(tc)
    if "+" in tc:
        base, inc = tc.split("+", 1)
        try:
            return float(base), float(inc)
        except ValueError:
            return None, 0.0
    try:
        return float(tc), 0.0
    except ValueError:
        return None, 0.0


def extract_move_times_from_pgn(pgn_str: str, time_control: str, user_color: str):
    if not pgn_str:
        return None
    base, inc = parse_time_control(time_control)
    if base is None:
        tc_match = re.search(r'\[TimeControl "([^"]+)"\]', pgn_str)
        if tc_match:
            base, inc = parse_time_control(tc_match.group(1))
    if base is None:
        return None

    tags = re.findall(r"\[%clk\s+([^\]]+)\]", pgn_str, flags=re.IGNORECASE)
    if len(tags) < 2:
        return None

    try:
        rem_times = [parse_clk_to_seconds(t) for t in tags]
    except ValueError:
        return None

    white_times = []
    black_times = []
    prev_w = base
    prev_b = base
    for i, rem in enumerate(rem_times):
        if i % 2 == 0:
            think = prev_w - rem + inc
            white_times.append(max(think, 0.0))
            prev_w = rem
        else:
            think = prev_b - rem + inc
            black_times.append(max(think, 0.0))
            prev_b = rem

    if user_color == "white":
        user_times, opp_times = white_times, black_times
    else:
        user_times, opp_times = black_times, white_times

    if not user_times or not opp_times:
        return None

    return {
        "user_avg": sum(user_times) / len(user_times),
        "opp_avg": sum(opp_times) / len(opp_times),
        "user_longest": max(user_times),
        "opp_longest": max(opp_times),
        "user_moves": len(user_times),
        "opp_moves": len(opp_times),
        "user_times": user_times,
        "opp_times": opp_times,
    }


# --- BULLET 1: HEADLINE STATS ---
def calculate_headline_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}

    work = df.copy()
    work["created_at"] = pd.to_datetime(work["created_at"], errors="coerce")
    work["result_norm"] = work["result"].astype(str).str.strip()
    sort_cols = ["created_at"]
    ascending = [True]
    if "id" in work.columns:
        sort_cols.append("id")
        ascending.append(True)
    oldest_first = work.sort_values(
        sort_cols, ascending=ascending, kind="mergesort"
    )
    newest_first = oldest_first.iloc[::-1]

    total_games = len(work)
    total_moves = work["move_count"].sum()

    seconds_per_move_map = {
        "bullet": 3,
        "blitz": 8,
        "rapid": 20,
        "classical": 60,
        "daily": 60,
    }
    work["est_seconds"] = work.apply(
        lambda r: r["move_count"]
        * seconds_per_move_map.get(str(r["speed"]).lower(), 8),
        axis=1,
    )
    total_hours = work["est_seconds"].sum() / 3600

    max_win_streak = 0
    curr_win_streak = 0
    max_unbeaten_streak = 0
    curr_unbeaten_streak = 0

    for res in oldest_first["result_norm"]:
        if res == "Win":
            curr_win_streak += 1
            max_win_streak = max(max_win_streak, curr_win_streak)
        else:
            curr_win_streak = 0

        if res in ("Win", "Draw"):
            curr_unbeaten_streak += 1
            max_unbeaten_streak = max(
                max_unbeaten_streak, curr_unbeaten_streak
            )
        else:
            curr_unbeaten_streak = 0

    current_win_streak = 0
    for res in newest_first["result_norm"]:
        if res == "Win":
            current_win_streak += 1
            continue
        break

    day_counts = work["created_at"].dt.day_name().value_counts()
    peak_day = day_counts.index[0] if not day_counts.empty else "N/A"

    hour_counts = work["created_at"].dt.hour.value_counts()
    peak_hour = hour_counts.index[0] if not hour_counts.empty else 0
    peak_hour_str = f"{peak_hour:02d}:00 - {(peak_hour+1)%24:02d}:00"

    return {
        "total_games": total_games,
        "total_moves": int(total_moves),
        "total_hours": round(total_hours, 1),
        "max_win_streak": max_win_streak,
        "max_unbeaten_streak": max_unbeaten_streak,
        "current_win_streak": current_win_streak,
        "peak_day": peak_day,
        "peak_hour": peak_hour_str,
    }


def calculate_activity_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {
            "hourly_activity": [],
            "monthly_activity": [],
            "results_breakdown": {
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "win_rate": 0.0,
            },
        }

    work = df.copy()
    wins = int((work["result"] == "Win").sum())
    draws = int((work["result"] == "Draw").sum())
    losses = int((work["result"] == "Loss").sum())
    total = len(work)
    win_rate = round((wins / total) * 100, 1) if total else 0.0

    hourly_activity = []
    hours = work["created_at"].dt.hour
    for hour in range(24):
        mask = hours == hour
        bucket = work[mask]
        hourly_activity.append(
            {
                "hour": hour,
                "label": str(hour),
                "games": int(len(bucket)),
                "wins": int((bucket["result"] == "Win").sum()),
            }
        )

    monthly_activity = []
    work["month_key"] = work["created_at"].dt.to_period("M")
    for period, group in work.groupby("month_key", sort=True):
        ratings = group["user_rating"].dropna()
        monthly_activity.append(
            {
                "month": period.strftime("%b"),
                "month_key": str(period),
                "games": int(len(group)),
                "wins": int((group["result"] == "Win").sum()),
                "rating": int(ratings.iloc[-1]) if not ratings.empty else None,
            }
        )

    return {
        "hourly_activity": hourly_activity,
        "monthly_activity": monthly_activity,
        "results_breakdown": {
            "wins": wins,
            "draws": draws,
            "losses": losses,
            "win_rate": win_rate,
        },
    }


# --- BULLET 2: OPENING REPERTOIRE ---
def calculate_opening_stats(df: pd.DataFrame, min_games: int = 3) -> dict:
    if df.empty:
        return {}

    df = df.copy()
    df["opening_eco"] = df["opening_eco"].apply(normalize_opening_eco)
    df["opening_variation"] = df["opening_name"].fillna("Unknown")

    white_df = df[df["user_color"] == "white"]
    black_df = df[df["user_color"] == "black"]

    eco_map = build_eco_name_map(df)

    sig_white_eco = (
        white_df["opening_eco"].mode()[0] if not white_df.empty else "N/A"
    )
    sig_black_eco = (
        black_df["opening_eco"].mode()[0] if not black_df.empty else "N/A"
    )
    sig_white = format_eco_label(sig_white_eco, eco_map)
    sig_black = format_eco_label(sig_black_eco, eco_map)

    eco_group = (
        df.groupby("opening_eco")
        .agg(
            total=("id", "count"),
            wins=("result", lambda x: (x == "Win").sum()),
            losses=("result", lambda x: (x == "Loss").sum()),
            draws=("result", lambda x: (x == "Draw").sum()),
        )
        .reset_index()
    )
    eco_group["win_rate"] = (eco_group["wins"] / eco_group["total"]) * 100
    eco_group["eco_label"] = eco_group["opening_eco"].map(
        lambda eco: format_eco_label(eco, eco_map)
    )

    var_group = (
        df.groupby("opening_variation")
        .agg(
            total=("id", "count"),
            wins=("result", lambda x: (x == "Win").sum()),
            losses=("result", lambda x: (x == "Loss").sum()),
            draws=("result", lambda x: (x == "Draw").sum()),
        )
        .reset_index()
    )
    var_group["win_rate"] = (var_group["wins"] / var_group["total"]) * 100
    filtered_vars = var_group[var_group["total"] >= min_games]

    if not filtered_vars.empty:
        best_var = filtered_vars.sort_values(
            "win_rate", ascending=False
        ).iloc[0]
        worst_var = filtered_vars.sort_values(
            "win_rate", ascending=True
        ).iloc[0]
        secret_weapon = (
            f"{best_var['opening_variation']} "
            f"({best_var['win_rate']:.0f}% win | {best_var['total']}g)"
        )
        nemesis = (
            f"{worst_var['opening_variation']} "
            f"({worst_var['win_rate']:.0f}% win | {worst_var['total']}g)"
        )
    else:
        secret_weapon = f"Need min {min_games} games"
        nemesis = f"Need min {min_games} games"

    gambit_mask = df["opening_name"].str.contains(
        "gambit", case=False, na=False
    )
    gambit_df = df[gambit_mask]
    total_gambits = len(gambit_df)
    gambit_wins = (
        (gambit_df["result"] == "Win").sum() if total_gambits > 0 else 0
    )
    gambit_win_rate = (
        (gambit_wins / total_gambits * 100) if total_gambits > 0 else 0.0
    )

    return {
        "sig_white": sig_white,
        "sig_black": sig_black,
        "sig_white_eco": sig_white_eco,
        "sig_black_eco": sig_black_eco,
        "secret_weapon": secret_weapon,
        "nemesis": nemesis,
        "total_gambits": total_gambits,
        "gambit_win_rate": round(gambit_win_rate, 1),
        "op_group": eco_group,
        "var_group": var_group,
        "eco_map": eco_map,
    }


def calculate_clock_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}

    user_timeouts = int(
        (df["termination"].astype(str).str.lower() == "timeout").sum()
    )
    opp_timeouts = 0
    if "opp_termination" in df.columns:
        opp_timeouts = int(
            (df["opp_termination"].astype(str).str.lower() == "timeout").sum()
        )

    user_avgs = []
    opp_avgs = []
    user_longests = []
    opp_longests = []
    clock_rows = []

    for _, row in df.iterrows():
        parsed = extract_move_times_from_pgn(
            row.get("pgn_str", ""),
            row.get("time_control", ""),
            row.get("user_color", "white"),
        )
        if not parsed:
            continue
        user_avgs.append(parsed["user_avg"])
        opp_avgs.append(parsed["opp_avg"])
        user_longests.append(parsed["user_longest"])
        opp_longests.append(parsed["opp_longest"])
        clock_rows.append(
            {
                "result": row.get("result"),
                "user_avg": parsed["user_avg"],
                "opp_avg": parsed["opp_avg"],
                "user_longest": parsed["user_longest"],
                "opp_longest": parsed["opp_longest"],
                "user_timeout": str(row.get("termination", "")).lower()
                == "timeout",
                "opp_timeout": str(row.get("opp_termination", "")).lower()
                == "timeout",
            }
        )

    clock_df = pd.DataFrame(clock_rows) if clock_rows else pd.DataFrame()
    games_with_clock = len(clock_rows)

    def _mean(vals):
        return round(sum(vals) / len(vals), 1) if vals else 0.0

    def _wr_from_df(subset):
        if subset is None or subset.empty:
            return 0.0
        return round(float((subset["result"] == "Win").mean() * 100), 1)

    user_to_mask = df["termination"].astype(str).str.lower() == "timeout"
    if "opp_termination" in df.columns:
        opp_to_mask = (
            df["opp_termination"].astype(str).str.lower() == "timeout"
        )
        timeout_decided = df[user_to_mask | opp_to_mask]
        won_on_time_wr = _wr_from_df(df[opp_to_mask])
        lost_on_time_wr = _wr_from_df(df[user_to_mask])
    else:
        timeout_decided = df[user_to_mask]
        won_on_time_wr = 0.0
        lost_on_time_wr = _wr_from_df(timeout_decided)

    slower_avg_wr = 0.0
    longer_think_wr = 0.0
    if not clock_df.empty:
        slower_avg_wr = _wr_from_df(
            clock_df[clock_df["user_avg"] > clock_df["opp_avg"]]
        )
        longer_think_wr = _wr_from_df(
            clock_df[clock_df["user_longest"] > clock_df["opp_longest"]]
        )

    timeout_decided_wr = _wr_from_df(timeout_decided)

    return {
        "user_timeouts": user_timeouts,
        "opp_timeouts": opp_timeouts,
        "timeout_decided_games": len(timeout_decided),
        "timeout_decided_wr": timeout_decided_wr,
        "games_with_clock": games_with_clock,
        "avg_time_per_move_user": _mean(user_avgs),
        "avg_time_per_move_opp": _mean(opp_avgs),
        "avg_longest_move_user": _mean(user_longests),
        "avg_longest_move_opp": _mean(opp_longests),
        "won_on_time_wr": won_on_time_wr,
        "lost_on_time_wr": lost_on_time_wr,
        "slower_avg_wr": slower_avg_wr,
        "longer_think_wr": longer_think_wr,
    }


# --- BULLET 3: NOTATION & PGN PARSING ---
def parse_game_interactions(row: pd.Series) -> dict:
    pgn_str = row.get("pgn_str", "")
    moves_str = row.get("moves_str", "")
    user_color = row.get("user_color", "white")
    user_is_white = user_color == "white"

    board = chess.Board()
    moves = []

    if pgn_str:
        try:
            game = chess.pgn.read_game(io.StringIO(pgn_str))
            if game:
                moves = list(game.mainline_moves())
        except Exception:
            moves = []

    if not moves and moves_str:
        moves = []
        for san_move in moves_str.split():
            try:
                move = board.parse_san(san_move)
                moves.append(move)
                board.push(move)
            except Exception:
                break
        board.reset()

    if not moves:
        return None

    knights_captured_by_user = 0
    bishops_captured_by_user = 0
    queenless_early = False
    first_blood = None
    castling_choice = "Uncastled"
    promotions = {"Q": 0, "N": 0, "R": 0, "B": 0}
    checkmate_piece = None
    captured_piece_weight_g = 0.0
    piece_weight_g = {
        chess.PAWN: 4.0,
        chess.KNIGHT: 8.0,
        chess.BISHOP: 8.0,
        chess.ROOK: 12.0,
        chess.QUEEN: 16.0,
    }

    for ply, move in enumerate(moves):
        is_user_turn = (
            (board.turn == chess.WHITE)
            if user_is_white
            else (board.turn == chess.BLACK)
        )

        is_capture = board.is_capture(move)

        if first_blood is None and is_capture:
            first_blood = "user" if is_user_turn else "opponent"

        if is_user_turn and is_capture:
            captured_piece = board.piece_at(move.to_square)
            if not captured_piece and board.is_en_passant(move):
                captured_piece = chess.Piece(chess.PAWN, not board.turn)

            if captured_piece:
                captured_piece_weight_g += piece_weight_g.get(
                    captured_piece.piece_type, 0.0
                )
                if captured_piece.piece_type == chess.KNIGHT:
                    knights_captured_by_user += 1
                elif captured_piece.piece_type == chess.BISHOP:
                    bishops_captured_by_user += 1

        if is_user_turn and board.is_castling(move):
            if board.is_kingside_castling(move):
                castling_choice = "Kingside"
            elif board.is_queenside_castling(move):
                castling_choice = "Queenside"

        if is_user_turn and move.promotion:
            promo_sym = chess.piece_symbol(move.promotion).upper()
            promotions[promo_sym] = promotions.get(promo_sym, 0) + 1

        board.push(move)

        if ply <= 30 and not queenless_early:
            white_queens = len(board.pieces(chess.QUEEN, chess.WHITE))
            black_queens = len(board.pieces(chess.QUEEN, chess.BLACK))
            if white_queens == 0 and black_queens == 0:
                queenless_early = True

    queens = len(board.pieces(chess.QUEEN, chess.WHITE)) + len(
        board.pieces(chess.QUEEN, chess.BLACK)
    )
    rooks = len(board.pieces(chess.ROOK, chess.WHITE)) + len(
        board.pieces(chess.ROOK, chess.BLACK)
    )
    bishops = len(board.pieces(chess.BISHOP, chess.WHITE)) + len(
        board.pieces(chess.BISHOP, chess.BLACK)
    )
    knights = len(board.pieces(chess.KNIGHT, chess.WHITE)) + len(
        board.pieces(chess.KNIGHT, chess.BLACK)
    )

    endgame_type = "Middlegame / Early Finish"
    if queens == 0:
        if rooks == 0 and bishops == 0 and knights == 0:
            endgame_type = "Pawn Endgame"
        elif rooks > 0 and bishops == 0 and knights == 0:
            endgame_type = "Rook Endgame"
        elif rooks == 0 and (bishops > 0 or knights > 0):
            endgame_type = "Minor Piece Endgame"
        else:
            endgame_type = "Complex Heavy Endgame"

    if board.is_checkmate():
        winning_side = not board.turn
        if (winning_side == chess.WHITE and user_is_white) or (
            winning_side == chess.BLACK and not user_is_white
        ):
            last_move = moves[-1]
            last_piece = board.piece_at(last_move.to_square)
            if last_piece:
                checkmate_piece = chess.piece_name(
                    last_piece.piece_type
                ).title()

    return {
        "knights_captured": knights_captured_by_user,
        "bishops_captured": bishops_captured_by_user,
        "queenless_early": queenless_early,
        "first_blood": first_blood,
        "castling_choice": castling_choice,
        "promotions": promotions,
        "checkmate_piece": checkmate_piece,
        "endgame_type": endgame_type,
        "captured_piece_weight_g": captured_piece_weight_g,
    }


def calculate_notation_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}

    total_knights = 0
    total_bishops = 0
    first_blood_user = 0
    first_blood_total = 0
    queenless_count = 0

    castling_counts = {"Kingside": 0, "Queenside": 0, "Uncastled": 0}
    promotions_total = {"Q": 0, "N": 0, "R": 0, "B": 0}
    checkmate_finishers = {}
    endgame_types = {}
    parsed_count = 0
    captured_piece_weight_g = 0.0

    for idx, row in df.iterrows():
        res = parse_game_interactions(row)
        if not res:
            continue

        parsed_count += 1
        total_knights += res["knights_captured"]
        total_bishops += res["bishops_captured"]
        captured_piece_weight_g += res["captured_piece_weight_g"]

        df.at[idx, "first_blood"] = res["first_blood"]

        if res["queenless_early"]:
            queenless_count += 1

        if res["first_blood"] == "user":
            first_blood_user += 1
            first_blood_total += 1
        elif res["first_blood"] == "opponent":
            first_blood_total += 1

        castling_counts[res["castling_choice"]] = (
            castling_counts.get(res["castling_choice"], 0) + 1
        )

        for p_type, count in res["promotions"].items():
            promotions_total[p_type] = promotions_total.get(p_type, 0) + count

        if res["checkmate_piece"]:
            p = res["checkmate_piece"]
            checkmate_finishers[p] = checkmate_finishers.get(p, 0) + 1

        e_type = res["endgame_type"]
        endgame_types[e_type] = endgame_types.get(e_type, 0) + 1

    total_g = max(parsed_count, 1)
    queenless_pct = round((queenless_count / total_g) * 100, 1)
    first_blood_pct = (
        round((first_blood_user / max(first_blood_total, 1)) * 100, 1)
        if first_blood_total > 0
        else 0.0
    )

    underpromotions = (
        promotions_total.get("N", 0)
        + promotions_total.get("R", 0)
        + promotions_total.get("B", 0)
    )

    return {
        "knights_captured": total_knights,
        "bishops_captured": total_bishops,
        "queenless_pct": queenless_pct,
        "first_blood_pct": first_blood_pct,
        "castling_counts": castling_counts,
        "promotions_total": promotions_total,
        "underpromotions": underpromotions,
        "checkmate_finishers": checkmate_finishers,
        "endgame_types": endgame_types,
        "captured_piece_weight_g": round(captured_piece_weight_g, 1),
    }


# --- BULLET 4: ENDGAME STATS ---
def calculate_endgame_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}

    short_games = df[df["move_count"] <= 30]
    marathon_games = df[df["move_count"] > 50]

    short_win_rate = (
        round((short_games["result"] == "Win").mean() * 100, 1)
        if not short_games.empty
        else 0.0
    )
    marathon_win_rate = (
        round((marathon_games["result"] == "Win").mean() * 100, 1)
        if not marathon_games.empty
        else 0.0
    )

    wins_df = df[df["result"] == "Win"]
    losses_df = df[df["result"] == "Loss"]

    win_methods = wins_df["termination"].value_counts().to_dict()
    loss_methods = losses_df["termination"].value_counts().to_dict()

    return {
        "short_games_count": len(short_games),
        "short_win_rate": short_win_rate,
        "marathon_games_count": len(marathon_games),
        "marathon_win_rate": marathon_win_rate,
        "win_methods": win_methods,
        "loss_methods": loss_methods,
    }


# --- BULLET 5: CONDITIONAL STATS ---
def calculate_conditional_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}

    baseline_win_rate = (df["result"] == "Win").mean() * 100

    white_df = df[df["user_color"] == "white"]
    black_df = df[df["user_color"] == "black"]

    white_win_rate = (
        (white_df["result"] == "Win").mean() * 100 if not white_df.empty else 0
    )
    black_win_rate = (
        (black_df["result"] == "Win").mean() * 100 if not black_df.empty else 0
    )

    color_bias = white_win_rate - black_win_rate

    df_rated = df.dropna(subset=["user_rating", "opp_rating"]).copy()
    if not df_rated.empty:
        df_rated["rating_diff"] = (
            df_rated["opp_rating"] - df_rated["user_rating"]
        )

        higher_rated = df_rated[df_rated["rating_diff"] >= 30]
        lower_rated = df_rated[df_rated["rating_diff"] <= -30]

        underdog_win_rate = (
            (higher_rated["result"] == "Win").mean() * 100
            if not higher_rated.empty
            else 0
        )
        favored_win_rate = (
            (lower_rated["result"] == "Win").mean() * 100
            if not lower_rated.empty
            else 0
        )
    else:
        underdog_win_rate = 0
        favored_win_rate = 0

    if "first_blood" in df.columns:
        fb_user = df[df["first_blood"] == "user"]
        fb_opp = df[df["first_blood"] == "opponent"]

        fb_user_win = (
            (fb_user["result"] == "Win").mean() * 100 if not fb_user.empty else 0
        )
        fb_opp_win = (
            (fb_opp["result"] == "Win").mean() * 100 if not fb_opp.empty else 0
        )
    else:
        fb_user_win = 0
        fb_opp_win = 0

    modifiers = [
        {"Condition": "As White ⚪", "Diff": white_win_rate - baseline_win_rate},
        {"Condition": "As Black ⬛", "Diff": black_win_rate - baseline_win_rate},
        {
            "Condition": "Vs Higher Rated (+30 ELO)",
            "Diff": underdog_win_rate - baseline_win_rate,
        },
        {
            "Condition": "Vs Lower Rated (-30 ELO)",
            "Diff": favored_win_rate - baseline_win_rate,
        },
        {
            "Condition": "Drew First Blood ⚔️",
            "Diff": fb_user_win - baseline_win_rate,
        },
        {
            "Condition": "Opponent First Blood 🛡️",
            "Diff": fb_opp_win - baseline_win_rate,
        },
    ]

    return {
        "baseline_win_rate": round(baseline_win_rate, 1),
        "white_win_rate": round(white_win_rate, 1),
        "black_win_rate": round(black_win_rate, 1),
        "color_bias": round(color_bias, 1),
        "underdog_win_rate": round(underdog_win_rate, 1),
        "favored_win_rate": round(favored_win_rate, 1),
        "fb_user_win_rate": round(fb_user_win, 1),
        "fb_opp_win_rate": round(fb_opp_win, 1),
        "modifiers": pd.DataFrame(modifiers),
    }


# --- BULLET 6: ARCHETYPE BADGES ---
def calculate_archetype_badges(
    headline: dict,
    opening: dict,
    notation: dict,
    endgame: dict,
    conditional: dict,
) -> list:
    badges = []

    if conditional.get("underdog_win_rate", 0) >= 50:
        badges.append(
            {
                "title": "Giant Killer",
                "emoji": "👑",
                "desc": f"Fears no higher rating: {conditional['underdog_win_rate']}% win rate vs +30 ELO opponents.",
            }
        )

    if notation.get("first_blood_pct", 0) >= 50:
        badges.append(
            {
                "title": "First Blood Berserker",
                "emoji": "⚔️",
                "desc": f"Aggressive tactician: Initiates first capture in {notation['first_blood_pct']}% of games.",
            }
        )

    if (
        endgame.get("marathon_win_rate", 0) >= 55
        and endgame.get("marathon_games_count", 0) >= 3
    ):
        badges.append(
            {
                "title": "Endgame Virtuoso",
                "emoji": "♟️",
                "desc": f"Thrives in deep water: {endgame['marathon_win_rate']}% win rate in games >50 moves.",
            }
        )

    if (
        endgame.get("short_win_rate", 0) >= 55
        and endgame.get("short_games_count", 0) >= 3
    ):
        badges.append(
            {
                "title": "Sprint Specialist",
                "emoji": "⚡",
                "desc": f"Lethal early finisher: {endgame['short_win_rate']}% win rate in short games (≤30 moves).",
            }
        )

    if abs(conditional.get("color_bias", 0)) >= 15:
        color_fav = (
            "White ⚪" if conditional["color_bias"] > 0 else "Black ⬛"
        )
        badges.append(
            {
                "title": "Color Specialist",
                "emoji": "☯️",
                "desc": f"Dominant with {color_fav}: Has a +{abs(conditional['color_bias'])}% win rate advantage.",
            }
        )

    if (
        opening.get("total_gambits", 0) >= 3
        and opening.get("gambit_win_rate", 0) >= 50
    ):
        badges.append(
            {
                "title": "Gambit Enjoyer",
                "emoji": "🔥",
                "desc": f"Sacrifices material for momentum: {opening['gambit_win_rate']}% win rate across {opening['total_gambits']} gambit games.",
            }
        )

    peak_hour_str = headline.get("peak_hour", "00:00")
    try:
        start_hour = int(peak_hour_str.split(":")[0])
        if start_hour >= 22 or start_hour <= 4:
            badges.append(
                {
                    "title": "Night Owl",
                    "emoji": "🌙",
                    "desc": f"Plays best under the stars: Peak activity window is {peak_hour_str}.",
                }
            )
    except Exception:
        pass

    if not badges:
        badges.append(
            {
                "title": "Balanced General",
                "emoji": "🧠",
                "desc": "A well-rounded player with consistent stats across all phases of the game.",
            }
        )

    return badges


_ORTHODOX_NAME_RE = re.compile(
    r"italian|giuoco|ruy\s*lopez|spanish\s*opening|sicilian|"
    r"french\s*defen[cs]e|caro[\s-]*kann|queen'?s?\s*gambit|"
    r"london\s*system|king'?s?\s*indian",
    re.IGNORECASE,
)


def _eco_number(eco: str):
    eco = normalize_opening_eco(eco)
    if len(eco) < 2 or not eco[1:].isdigit():
        return None, None
    return eco[0], int(eco[1:])


def is_orthodox_opening(eco: str, opening_name: str = "") -> bool:
    letter, num = _eco_number(eco)
    if letter is not None and num is not None:
        if letter == "C" and (
            0 <= num <= 19 or 50 <= num <= 59 or 60 <= num <= 99
        ):
            return True
        if letter == "B" and 10 <= num <= 99:
            return True
        if letter == "D" and 6 <= num <= 69:
            return True
        if letter == "E" and 60 <= num <= 99:
            return True

    name = str(opening_name or "")
    if _ORTHODOX_NAME_RE.search(name):
        return True
    return False


def _bucket_games_wr(subset: pd.DataFrame) -> dict:
    games = int(len(subset))
    if games == 0:
        return {"games": 0, "wins": 0, "win_rate": 0.0}
    wins = int((subset["result"] == "Win").sum())
    return {
        "games": games,
        "wins": wins,
        "win_rate": round((wins / games) * 100, 1),
    }


def _first_white_move_uci(row: pd.Series) -> str | None:
    pgn_str = row.get("pgn_str", "") or ""
    moves_str = row.get("moves_str", "") or ""

    if pgn_str:
        try:
            game = chess.pgn.read_game(io.StringIO(pgn_str))
            if game:
                moves = list(game.mainline_moves())
                if moves:
                    return moves[0].uci()
        except Exception:
            pass

        match = re.search(r"1\.\s*(e4|d4|c4|Nf3|g3|b3|f4|b4|Nc3|e3|d3)\b", pgn_str)
        if match:
            board = chess.Board()
            try:
                return board.parse_san(match.group(1)).uci()
            except Exception:
                token = match.group(1)
                if token == "e4":
                    return "e2e4"
                if token == "d4":
                    return "d2d4"

    if moves_str:
        board = chess.Board()
        for token in moves_str.split():
            try:
                move = board.parse_san(token)
                return move.uci()
            except Exception:
                continue
    return None


def _opening_context(user_color: str, first_uci: str | None) -> str | None:
    if first_uci == "e2e4":
        pawn = "e4"
    elif first_uci == "d2d4":
        pawn = "d4"
    else:
        return None

    color = str(user_color or "").lower()
    if color == "white":
        return f"white_{pawn}"
    if color == "black":
        return f"black_vs_{pawn}"
    return None


_CONTEXT_LABELS = {
    "white_e4": "White 1.e4",
    "white_d4": "White 1.d4",
    "black_vs_e4": "Black vs 1.e4",
    "black_vs_d4": "Black vs 1.d4",
}


def calculate_opening_mix_stats(df: pd.DataFrame) -> dict:
    empty_bucket = {"games": 0, "wins": 0, "win_rate": 0.0}
    empty_sigs = {
        key: {
            "context": key,
            "label": label,
            "opening_eco": None,
            "opening_name": None,
            "games": 0,
        }
        for key, label in _CONTEXT_LABELS.items()
    }
    if df.empty:
        return {
            "same_openings": empty_bucket.copy(),
            "different_openings": empty_bucket.copy(),
            "orthodox": empty_bucket.copy(),
            "unorthodox": empty_bucket.copy(),
            "avg_time_per_move_s": None,
            "games_with_clock": 0,
            "signature_openings": empty_sigs,
        }

    work = df.copy()
    work["opening_eco"] = work["opening_eco"].apply(normalize_opening_eco)
    work["opening_name"] = work["opening_name"].fillna("Unknown")
    work["_first_uci"] = work.apply(_first_white_move_uci, axis=1)
    work["_context"] = work.apply(
        lambda r: _opening_context(r.get("user_color"), r.get("_first_uci")),
        axis=1,
    )

    signatures = {}
    for context, label in _CONTEXT_LABELS.items():
        bucket = work[work["_context"] == context]
        if bucket.empty:
            signatures[context] = {
                "context": context,
                "label": label,
                "opening_eco": None,
                "opening_name": None,
                "games": 0,
            }
            continue
        eco_mode = bucket["opening_eco"].mode()
        sig_eco = (
            eco_mode.iloc[0]
            if not eco_mode.empty and eco_mode.iloc[0] != "UNK"
            else None
        )
        if sig_eco is None:
            name_mode = bucket["opening_name"].mode()
            sig_name = name_mode.iloc[0] if not name_mode.empty else None
            sig_games = (
                int((bucket["opening_name"] == sig_name).sum())
                if sig_name
                else 0
            )
            signatures[context] = {
                "context": context,
                "label": label,
                "opening_eco": None,
                "opening_name": sig_name,
                "games": sig_games,
            }
        else:
            name_in_eco = bucket[bucket["opening_eco"] == sig_eco][
                "opening_name"
            ].mode()
            signatures[context] = {
                "context": context,
                "label": label,
                "opening_eco": sig_eco,
                "opening_name": (
                    name_in_eco.iloc[0] if not name_in_eco.empty else None
                ),
                "games": int((bucket["opening_eco"] == sig_eco).sum()),
            }

    def _is_same_opening(row) -> bool:
        context = row.get("_context")
        if not context or context not in signatures:
            return False
        sig = signatures[context]
        if sig.get("opening_eco"):
            return row.get("opening_eco") == sig["opening_eco"]
        if sig.get("opening_name"):
            return row.get("opening_name") == sig["opening_name"]
        return False

    same_mask = work.apply(_is_same_opening, axis=1)
    same = _bucket_games_wr(work[same_mask])
    different = _bucket_games_wr(work[~same_mask])

    orthodox_mask = work.apply(
        lambda r: is_orthodox_opening(r["opening_eco"], r["opening_name"]),
        axis=1,
    )
    orthodox = _bucket_games_wr(work[orthodox_mask])
    unorthodox = _bucket_games_wr(work[~orthodox_mask])

    user_avgs = []
    for _, row in work.iterrows():
        parsed = extract_move_times_from_pgn(
            row.get("pgn_str", ""),
            row.get("time_control", ""),
            row.get("user_color", "white"),
        )
        if parsed:
            user_avgs.append(parsed["user_avg"])

    avg_time = (
        round(sum(user_avgs) / len(user_avgs), 1) if user_avgs else None
    )

    return {
        "same_openings": same,
        "different_openings": different,
        "orthodox": orthodox,
        "unorthodox": unorthodox,
        "avg_time_per_move_s": avg_time,
        "games_with_clock": len(user_avgs),
        "signature_openings": signatures,
    }


LOW_PAWN_MOBILITY_MAX = 4
POSITIONAL_SCAN_FROM_PLY = 16


def is_closed_eco(eco: str) -> bool:
    letter, num = _eco_number(eco)
    return letter == "D" and num is not None and 0 <= num <= 69


def is_semi_closed_eco(eco: str) -> bool:
    letter, num = _eco_number(eco)
    if letter is None or num is None:
        return False
    if letter == "A":
        return (
            40 <= num <= 44
            or 51 <= num <= 52
            or 56 <= num <= 79
            or 80 <= num <= 99
        )
    if letter == "D":
        return 70 <= num <= 99
    if letter == "E":
        return 0 <= num <= 9 or 12 <= num <= 99
    return False


def _count_piece(board: chess.Board, piece_type: chess.PieceType, color: chess.Color) -> int:
    return len(board.pieces(piece_type, color))


def _pawn_mobility_both(board: chess.Board) -> int:
    total = 0
    for color in (chess.WHITE, chess.BLACK):
        probe = board.copy(stack=False)
        probe.turn = color
        for move in probe.legal_moves:
            piece = probe.piece_at(move.from_square)
            if piece and piece.piece_type == chess.PAWN:
                total += 1
    return total


def _parse_moves_for_positional(row: pd.Series):
    pgn_str = row.get("pgn_str", "") or ""
    moves_str = row.get("moves_str", "") or ""
    moves = []
    if pgn_str:
        try:
            game = chess.pgn.read_game(io.StringIO(pgn_str))
            if game:
                moves = list(game.mainline_moves())
        except Exception:
            moves = []
    if not moves and moves_str:
        board = chess.Board()
        for token in moves_str.split():
            try:
                move = board.parse_san(token)
                moves.append(move)
                board.push(move)
            except Exception:
                break
    return moves


def _is_bishop_vs_knight(board: chess.Board) -> bool:
    bw = _count_piece(board, chess.BISHOP, chess.WHITE)
    bb = _count_piece(board, chess.BISHOP, chess.BLACK)
    nw = _count_piece(board, chess.KNIGHT, chess.WHITE)
    nb = _count_piece(board, chess.KNIGHT, chess.BLACK)
    return (bw > bb and nw < nb) or (bw < bb and nw > nb)


def _is_rook_vs_two_minors(board: chess.Board) -> bool:
    rw = _count_piece(board, chess.ROOK, chess.WHITE)
    rb = _count_piece(board, chess.ROOK, chess.BLACK)
    mw = _count_piece(board, chess.KNIGHT, chess.WHITE) + _count_piece(
        board, chess.BISHOP, chess.WHITE
    )
    mb = _count_piece(board, chess.KNIGHT, chess.BLACK) + _count_piece(
        board, chess.BISHOP, chess.BLACK
    )
    rook_diff = rw - rb
    minor_diff = mw - mb
    return abs(rook_diff) == 1 and abs(minor_diff) == 2 and rook_diff == -(
        minor_diff // 2
    )


def _scan_structure_texture(row: pd.Series) -> dict:
    empty = {
        "scanned_positions": 0,
        "locked_positions": 0,
        "had_locked": False,
        "pawn_diff_positions": 0,
        "had_pawn_diff": False,
        "piece_diff_positions": 0,
        "had_piece_diff": False,
        "bishop_vs_knight_positions": 0,
        "had_bishop_vs_knight": False,
        "rook_vs_two_minors_positions": 0,
        "had_rook_vs_two_minors": False,
        "max_pawn_diff": 0,
        "max_piece_diff": 0,
        "pawn_moves": 0,
        "user_pawn_moves": 0,
    }
    moves = _parse_moves_for_positional(row)
    if not moves:
        return empty

    user_is_white = str(row.get("user_color", "white")).lower() == "white"
    user_color = chess.WHITE if user_is_white else chess.BLACK

    board = chess.Board()
    scanned = 0
    locked = 0
    pawn_diff_pos = 0
    piece_diff_pos = 0
    bvsn_pos = 0
    rv2m_pos = 0
    max_pawn_diff = 0
    max_piece_diff = 0
    pawn_moves = 0
    user_pawn_moves = 0

    for ply, move in enumerate(moves):
        moving = board.piece_at(move.from_square)
        if moving and moving.piece_type == chess.PAWN:
            pawn_moves += 1
            if board.turn == user_color:
                user_pawn_moves += 1

        board.push(move)
        if ply + 1 < POSITIONAL_SCAN_FROM_PLY:
            continue

        scanned += 1
        pw = _count_piece(board, chess.PAWN, chess.WHITE)
        pb = _count_piece(board, chess.PAWN, chess.BLACK)
        pawn_diff = abs(pw - pb)
        max_pawn_diff = max(max_pawn_diff, pawn_diff)
        if pawn_diff >= 1:
            pawn_diff_pos += 1

        pieces_w = sum(
            _count_piece(board, pt, chess.WHITE)
            for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
        )
        pieces_b = sum(
            _count_piece(board, pt, chess.BLACK)
            for pt in (chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN)
        )
        piece_diff = abs(pieces_w - pieces_b)
        max_piece_diff = max(max_piece_diff, piece_diff)
        if piece_diff >= 1:
            piece_diff_pos += 1

        if _is_bishop_vs_knight(board):
            bvsn_pos += 1
        if _is_rook_vs_two_minors(board):
            rv2m_pos += 1

        mobility = _pawn_mobility_both(board)
        if mobility <= LOW_PAWN_MOBILITY_MAX:
            locked += 1

    return {
        "scanned_positions": scanned,
        "locked_positions": locked,
        "had_locked": locked > 0,
        "pawn_diff_positions": pawn_diff_pos,
        "had_pawn_diff": pawn_diff_pos > 0,
        "piece_diff_positions": piece_diff_pos,
        "had_piece_diff": piece_diff_pos > 0,
        "bishop_vs_knight_positions": bvsn_pos,
        "had_bishop_vs_knight": bvsn_pos > 0,
        "rook_vs_two_minors_positions": rv2m_pos,
        "had_rook_vs_two_minors": rv2m_pos > 0,
        "max_pawn_diff": max_pawn_diff,
        "max_piece_diff": max_piece_diff,
        "pawn_moves": pawn_moves,
        "user_pawn_moves": user_pawn_moves,
    }


def calculate_positional_stats(df: pd.DataFrame) -> dict:
    empty_bucket = {"games": 0, "wins": 0, "win_rate": 0.0}
    if df.empty:
        return {
            "closed": empty_bucket.copy(),
            "semi_closed": empty_bucket.copy(),
            "other": empty_bucket.copy(),
            "closed_share_pct": 0.0,
            "semi_closed_share_pct": 0.0,
        }

    work = df.copy()
    work["opening_eco"] = work["opening_eco"].apply(normalize_opening_eco)
    closed_mask = work["opening_eco"].apply(is_closed_eco)
    semi_mask = work["opening_eco"].apply(is_semi_closed_eco)
    other_mask = ~(closed_mask | semi_mask)

    closed = _bucket_games_wr(work[closed_mask])
    semi = _bucket_games_wr(work[semi_mask])
    other = _bucket_games_wr(work[other_mask])
    total = len(work)

    return {
        "closed": closed,
        "semi_closed": semi,
        "other": other,
        "closed_share_pct": round((closed["games"] / total) * 100, 1)
        if total
        else 0.0,
        "semi_closed_share_pct": round((semi["games"] / total) * 100, 1)
        if total
        else 0.0,
    }


def calculate_imbalance_mobility_stats(df: pd.DataFrame) -> dict:
    empty = {
        "games_scanned": 0,
        "positions_scanned": 0,
        "pawn_diff_position_rate_pct": 0.0,
        "pawn_diff_game_rate_pct": 0.0,
        "avg_max_pawn_diff": 0.0,
        "piece_diff_position_rate_pct": 0.0,
        "piece_diff_game_rate_pct": 0.0,
        "avg_max_piece_diff": 0.0,
        "bishop_vs_knight_position_rate_pct": 0.0,
        "bishop_vs_knight_game_rate_pct": 0.0,
        "rook_vs_two_minors_position_rate_pct": 0.0,
        "rook_vs_two_minors_game_rate_pct": 0.0,
        "locked_position_rate_pct": 0.0,
        "locked_game_rate_pct": 0.0,
        "avg_pawn_moves": 0.0,
        "avg_user_pawn_moves": 0.0,
    }
    if df.empty:
        return empty

    positions_scanned = 0
    pawn_diff_positions = 0
    piece_diff_positions = 0
    bvsn_positions = 0
    rv2m_positions = 0
    locked_positions = 0

    games_scanned = 0
    games_pawn_diff = 0
    games_piece_diff = 0
    games_bvsn = 0
    games_rv2m = 0
    games_locked = 0
    max_pawn_diffs = []
    max_piece_diffs = []
    pawn_moves_list = []
    user_pawn_moves_list = []

    for _, row in df.iterrows():
        scan = _scan_structure_texture(row)
        if scan["scanned_positions"] <= 0 and scan["pawn_moves"] <= 0:
            continue
        games_scanned += 1
        positions_scanned += scan["scanned_positions"]
        pawn_diff_positions += scan["pawn_diff_positions"]
        piece_diff_positions += scan["piece_diff_positions"]
        bvsn_positions += scan["bishop_vs_knight_positions"]
        rv2m_positions += scan["rook_vs_two_minors_positions"]
        locked_positions += scan["locked_positions"]
        max_pawn_diffs.append(scan["max_pawn_diff"])
        max_piece_diffs.append(scan["max_piece_diff"])
        pawn_moves_list.append(scan["pawn_moves"])
        user_pawn_moves_list.append(scan["user_pawn_moves"])
        if scan["had_pawn_diff"]:
            games_pawn_diff += 1
        if scan["had_piece_diff"]:
            games_piece_diff += 1
        if scan["had_bishop_vs_knight"]:
            games_bvsn += 1
        if scan["had_rook_vs_two_minors"]:
            games_rv2m += 1
        if scan["had_locked"]:
            games_locked += 1

    def rate(num, den):
        return round((num / den) * 100, 1) if den else 0.0

    def mean(vals):
        return round(sum(vals) / len(vals), 1) if vals else 0.0

    return {
        "games_scanned": games_scanned,
        "positions_scanned": positions_scanned,
        "pawn_diff_position_rate_pct": rate(
            pawn_diff_positions, positions_scanned
        ),
        "pawn_diff_game_rate_pct": rate(games_pawn_diff, games_scanned),
        "avg_max_pawn_diff": mean(max_pawn_diffs),
        "piece_diff_position_rate_pct": rate(
            piece_diff_positions, positions_scanned
        ),
        "piece_diff_game_rate_pct": rate(games_piece_diff, games_scanned),
        "avg_max_piece_diff": mean(max_piece_diffs),
        "bishop_vs_knight_position_rate_pct": rate(
            bvsn_positions, positions_scanned
        ),
        "bishop_vs_knight_game_rate_pct": rate(games_bvsn, games_scanned),
        "rook_vs_two_minors_position_rate_pct": rate(
            rv2m_positions, positions_scanned
        ),
        "rook_vs_two_minors_game_rate_pct": rate(games_rv2m, games_scanned),
        "locked_position_rate_pct": rate(locked_positions, positions_scanned),
        "locked_game_rate_pct": rate(games_locked, games_scanned),
        "avg_pawn_moves": mean(pawn_moves_list),
        "avg_user_pawn_moves": mean(user_pawn_moves_list),
    }