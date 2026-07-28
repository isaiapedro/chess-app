import io
import chess
import chess.pgn
import pandas as pd


def normalize_opening_name(raw_name: str) -> str:
    if not raw_name or raw_name == "Unknown":
        return "Unknown"
    return raw_name.split(":")[0].split(",")[0].strip()


# --- BULLET 1: HEADLINE STATS ---
def calculate_headline_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}

    df_sorted = df.sort_values("created_at")

    total_games = len(df)
    total_moves = df["move_count"].sum()

    seconds_per_move_map = {
        "bullet": 3,
        "blitz": 8,
        "rapid": 20,
        "classical": 60,
        "daily": 60,
    }
    df = df.copy()
    df["est_seconds"] = df.apply(
        lambda r: r["move_count"]
        * seconds_per_move_map.get(str(r["speed"]).lower(), 8),
        axis=1,
    )
    total_hours = df["est_seconds"].sum() / 3600

    max_win_streak = 0
    curr_win_streak = 0
    max_unbeaten_streak = 0
    curr_unbeaten_streak = 0

    for res in df_sorted["result"]:
        if res == "Win":
            curr_win_streak += 1
            max_win_streak = max(max_win_streak, curr_win_streak)
        else:
            curr_win_streak = 0

        if res in ["Win", "Draw"]:
            curr_unbeaten_streak += 1
            max_unbeaten_streak = max(
                max_unbeaten_streak, curr_unbeaten_streak
            )
        else:
            curr_unbeaten_streak = 0

    day_counts = df["created_at"].dt.day_name().value_counts()
    peak_day = day_counts.index[0] if not day_counts.empty else "N/A"

    hour_counts = df["created_at"].dt.hour.value_counts()
    peak_hour = hour_counts.index[0] if not hour_counts.empty else 0
    peak_hour_str = f"{peak_hour:02d}:00 - {(peak_hour+1)%24:02d}:00"

    return {
        "total_games": total_games,
        "total_moves": int(total_moves),
        "total_hours": round(total_hours, 1),
        "max_win_streak": max_win_streak,
        "max_unbeaten_streak": max_unbeaten_streak,
        "peak_day": peak_day,
        "peak_hour": peak_hour_str,
    }


# --- BULLET 2: OPENING REPERTOIRE ---
def calculate_opening_stats(df: pd.DataFrame, min_games: int = 3) -> dict:
    if df.empty:
        return {}

    df = df.copy()
    df["opening_family"] = df["opening_name"].apply(normalize_opening_name)

    white_df = df[df["user_color"] == "white"]
    black_df = df[df["user_color"] == "black"]

    sig_white = (
        white_df["opening_family"].mode()[0] if not white_df.empty else "N/A"
    )
    sig_black = (
        black_df["opening_family"].mode()[0] if not black_df.empty else "N/A"
    )

    op_group = (
        df.groupby("opening_family")
        .agg(
            total=("id", "count"),
            wins=("result", lambda x: (x == "Win").sum()),
            losses=("result", lambda x: (x == "Loss").sum()),
            draws=("result", lambda x: (x == "Draw").sum()),
        )
        .reset_index()
    )

    op_group["win_rate"] = (op_group["wins"] / op_group["total"]) * 100
    filtered_ops = op_group[op_group["total"] >= min_games]

    if not filtered_ops.empty:
        best_op_row = filtered_ops.sort_values(
            "win_rate", ascending=False
        ).iloc[0]
        worst_op_row = filtered_ops.sort_values(
            "win_rate", ascending=True
        ).iloc[0]

        secret_weapon = f"{best_op_row['opening_family']} ({best_op_row['win_rate']:.0f}% win | {best_op_row['total']}g)"
        nemesis = f"{worst_op_row['opening_family']} ({worst_op_row['win_rate']:.0f}% win | {worst_op_row['total']}g)"
    else:
        secret_weapon = "Need min 3 games"
        nemesis = "Need min 3 games"

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
        "secret_weapon": secret_weapon,
        "nemesis": nemesis,
        "total_gambits": total_gambits,
        "gambit_win_rate": round(gambit_win_rate, 1),
        "op_group": op_group,
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

    for ply, move in enumerate(moves):
        is_user_turn = (
            (board.turn == chess.WHITE)
            if user_is_white
            else (board.turn == chess.BLACK)
        )

        if first_blood is None and board.is_capture(move):
            first_blood = "user" if is_user_turn else "opponent"

        if is_user_turn and board.is_capture(move):
            captured_piece = board.piece_at(move.to_square)
            if not captured_piece and board.is_en_passant(move):
                captured_piece = chess.Piece(chess.PAWN, not board.turn)

            if captured_piece:
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

    for idx, row in df.iterrows():
        res = parse_game_interactions(row)
        if not res:
            continue

        parsed_count += 1
        total_knights += res["knights_captured"]
        total_bishops += res["bishops_captured"]

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
