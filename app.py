import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
import streamlit as st
from load_data import load_user_data
from stats import (
    calculate_archetype_badges,
    calculate_clock_stats,
    calculate_conditional_stats,
    calculate_endgame_stats,
    calculate_headline_stats,
    calculate_notation_stats,
    calculate_opening_mix_stats,
    calculate_opening_stats,
    calculate_positional_stats,
    calculate_imbalance_mobility_stats,
    normalize_opening_eco,
)
from style_metrics import (
    DEFAULT_ENGINE,
    calculate_style_metrics,
)
from baselines import (
    infer_user_band_speed,
    load_baselines,
    population_caption,
)
from eco_names import build_eco_name_map, format_eco_label

# Apply Seaborn dark theme
sns.set_theme(style="darkgrid")

# --- STREAMLIT PAGE CONFIG ---
st.set_page_config(
    page_title="Chess Wrapped Dashboard",
    page_icon="♟️",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.title("🏆 Master Chess Wrapped Dashboard")

# --- SIDEBAR CONTROLS ---
st.sidebar.header("📥 Data Source")
username = st.sidebar.text_input("Username", value="pedroisaia")
platform = st.sidebar.selectbox(
    "Platform", options=["chesscom", "lichess"], index=0
)
timeframe = st.sidebar.selectbox(
    "Timeframe", options=["1 month", "6 months", "1 year"], index=0
)

# Fetch base dataset (cached)
with st.spinner(f"Loading data for '{username}' from {platform.upper()}..."):
    df_raw = load_user_data(username, timeframe, platform=platform)

if df_raw.empty:
    st.warning(
        f"No games found for user '{username}' on {platform.title()} in the selected timeframe."
    )
    st.stop()

# Ensure ECO column is normalized for filters/charts
df_raw["opening_eco"] = df_raw["opening_eco"].apply(normalize_opening_eco)
eco_map = build_eco_name_map(df_raw)

# --- BULLET 7: GLOBAL IN-MEMORY FILTER CONTROLS ---
st.sidebar.divider()
st.sidebar.header("🔍 Global In-Memory Filters")

# Filter 1: Time Control / Speed
available_speeds = ["All"] + sorted(
    [s.title() for s in df_raw["speed"].unique() if pd.notna(s)]
)
speed_filter = st.sidebar.selectbox("🎮 Time Control", options=available_speeds)

# Filter 2: Piece Color
color_filter = st.sidebar.radio(
    "⚪/⬛ Piece Color",
    options=["All", "White", "Black"],
    horizontal=True,
)

# Filter 3: Game Outcome
result_filter = st.sidebar.radio(
    "🏆 Outcome", options=["All", "Wins", "Losses", "Draws"], horizontal=True
)

# Filter 4: ECO Code Filter
available_ecos = sorted(df_raw["opening_eco"].unique().tolist())
eco_label_to_code = {
    format_eco_label(eco, eco_map): eco for eco in available_ecos
}
eco_filter_labels = st.sidebar.multiselect(
    "📖 ECO Codes",
    options=list(eco_label_to_code.keys()),
    default=[],
    placeholder="Filter by ECO / opening...",
)
eco_filter = [eco_label_to_code[label] for label in eco_filter_labels]

# Filter 5: Month / Week / Day
df_raw["_game_month"] = df_raw["created_at"].dt.to_period("M")
df_raw["_game_week"] = df_raw["created_at"].dt.to_period("W-MON")
df_raw["_game_day"] = df_raw["created_at"].dt.day
df_raw["_game_date"] = df_raw["created_at"].dt.date

available_months = sorted(
    df_raw["_game_month"].dropna().unique().tolist(), reverse=True
)
month_labels = ["All"] + [str(m) for m in available_months]
month_filter = st.sidebar.selectbox("📅 Month", options=month_labels, index=0)

if month_filter == "All":
    calendar_scope = df_raw
else:
    month_period = pd.Period(month_filter, freq="M")
    calendar_scope = df_raw[df_raw["_game_month"] == month_period]

week_counts = (
    calendar_scope.groupby("_game_week").size().sort_index(ascending=False)
)
week_label_to_period = {}
week_options = ["All"]
for week_period, n in week_counts.items():
    start = week_period.start_time.date()
    end = week_period.end_time.date()
    label = f"{start.isoformat()} → {end.isoformat()} ({n} games)"
    week_label_to_period[label] = week_period
    week_options.append(label)

week_filter = st.sidebar.selectbox(
    "🗓️ Week",
    options=week_options,
    index=0,
    help="ISO weeks (Mon–Sun). Pick one week to restrict analysis.",
)

if week_filter == "All":
    day_source = calendar_scope
else:
    selected_week = week_label_to_period[week_filter]
    day_source = calendar_scope[calendar_scope["_game_week"] == selected_week]

if month_filter == "All" and week_filter == "All":
    day_counts = (
        day_source.groupby("_game_date").size().sort_index(ascending=False)
    )
    day_options = ["All"] + [
        f"{d.isoformat()} ({n} games)" for d, n in day_counts.items()
    ]
elif week_filter != "All":
    day_counts = (
        day_source.groupby("_game_date").size().sort_index(ascending=True)
    )
    day_options = ["All"] + [
        f"{d.isoformat()} ({n} games)" for d, n in day_counts.items()
    ]
else:
    day_counts = day_source.groupby("_game_day").size().sort_index()
    day_options = ["All"] + [
        f"Day {d} ({n} games)" for d, n in day_counts.items()
    ]

day_filter = st.sidebar.selectbox(
    "📆 Day",
    options=day_options,
    index=0,
    help="Pick one day to restrict analysis to that day's games.",
)

if not day_source.empty:
    scope_bits = []
    if month_filter != "All":
        scope_bits.append(month_filter)
    if week_filter != "All":
        scope_bits.append(week_filter.split(" (")[0])
    scope_txt = " / ".join(scope_bits) if scope_bits else "all loaded data"
    st.sidebar.caption(
        f"{len(day_source):,} games across "
        f"{day_source['_game_date'].nunique()} days in {scope_txt}"
    )

# --- APPLY IN-MEMORY FILTERS TO DATAFRAME ---
df = df_raw.copy()

if speed_filter != "All":
    df = df[df["speed"].str.lower() == speed_filter.lower()]

if color_filter != "All":
    df = df[df["user_color"].str.lower() == color_filter.lower()]

if result_filter != "All":
    res_map = {"Wins": "Win", "Losses": "Loss", "Draws": "Draw"}
    df = df[df["result"] == res_map[result_filter]]

if eco_filter:
    df = df[df["opening_eco"].isin(eco_filter)]

if month_filter != "All":
    df = df[df["_game_month"] == pd.Period(month_filter, freq="M")]

if week_filter != "All":
    df = df[df["_game_week"] == week_label_to_period[week_filter]]

if day_filter != "All":
    if month_filter == "All" or week_filter != "All":
        selected_date = day_filter.split(" (")[0]
        df = df[df["_game_date"].astype(str) == selected_date]
    else:
        selected_day = int(day_filter.split(" ")[1])
        df = df[df["_game_day"] == selected_day]

df = df.drop(
    columns=["_game_month", "_game_week", "_game_day", "_game_date"],
    errors="ignore",
)
df_raw = df_raw.drop(
    columns=["_game_month", "_game_week", "_game_day", "_game_date"],
    errors="ignore",
)

# Display Active Filters Banner
total_games_raw = len(df_raw)
filtered_games = len(df)
pct_retained = (
    (filtered_games / total_games_raw * 100) if total_games_raw > 0 else 0
)

calendar_label = "all days"
if day_filter != "All":
    calendar_label = day_filter.split(" (")[0]
elif week_filter != "All":
    calendar_label = week_filter.split(" (")[0]
elif month_filter != "All":
    calendar_label = f"all days in {month_filter}"

st.caption(
    f"📊 **Active Filter Snapshot:** Displaying **{filtered_games:,}** of "
    f"**{total_games_raw:,}** games ({pct_retained:.1f}% of total dataset) "
    f"— calendar: **{calendar_label}**"
)

if df.empty:
    st.error(
        "⚠️ No games match the active filter criteria. Adjust the sidebar filters to show data."
    )
    st.stop()

# Compute all statistics on filtered dataframe
headline = calculate_headline_stats(df)
opening = calculate_opening_stats(df, min_games=2)
notation = calculate_notation_stats(df)
endgame = calculate_endgame_stats(df)
conditional = calculate_conditional_stats(df)
clock = calculate_clock_stats(df)
eco_map = opening.get("eco_map", eco_map)
badges = calculate_archetype_badges(
    headline, opening, notation, endgame, conditional
)


st.sidebar.divider()
page = st.sidebar.radio(
    "📄 Page",
    options=["Dashboard", "Opening Mix", "Positional"],
    index=0,
    help="Dashboard / Opening Mix / Positional structure prefs.",
)

st.divider()

if page == "Positional":
    positional = calculate_positional_stats(df)

    closed = positional["closed"]
    semi = positional["semi_closed"]
    other = positional["other"]

    st.subheader("🧱 Positional")
    st.caption(
        "Closed = ECO D00–D69. "
        "Semi-closed = A40–44, A51–52, A56–79, A80–99, D70–99, E00–09, E12–99."
    )

    st.markdown("#### Opening Structure Preference")
    p1, p2, p3 = st.columns(3)
    with p1:
        st.metric("Closed — Games", f"{closed['games']:,}")
        st.metric("Closed — Win %", f"{closed['win_rate']}%")
        st.caption(f"Share of sample: {positional['closed_share_pct']}%")
    with p2:
        st.metric("Semi-Closed — Games", f"{semi['games']:,}")
        st.metric("Semi-Closed — Win %", f"{semi['win_rate']}%")
        st.caption(f"Share of sample: {positional['semi_closed_share_pct']}%")
    with p3:
        st.metric("Other — Games", f"{other['games']:,}")
        st.metric("Other — Win %", f"{other['win_rate']}%")
        st.caption(
            f"Open / unclassified share: "
            f"{round(100 - positional['closed_share_pct'] - positional['semi_closed_share_pct'], 1)}%"
        )

    struct_df = pd.DataFrame(
        [
            {
                "Structure": "Closed",
                "Games": closed["games"],
                "Win %": closed["win_rate"],
            },
            {
                "Structure": "Semi-Closed",
                "Games": semi["games"],
                "Win %": semi["win_rate"],
            },
            {
                "Structure": "Other",
                "Games": other["games"],
                "Win %": other["win_rate"],
            },
        ]
    )
    s1, s2 = st.columns(2)
    with s1:
        fig, ax = plt.subplots(figsize=(5, 3.5))
        sns.barplot(
            data=struct_df,
            x="Structure",
            y="Games",
            ax=ax,
            hue="Structure",
            legend=False,
            palette="Blues_d",
        )
        ax.set_title("Games by Structure", fontweight="bold")
        st.pyplot(fig)
        plt.close(fig)
    with s2:
        fig, ax = plt.subplots(figsize=(5, 3.5))
        sns.barplot(
            data=struct_df,
            x="Structure",
            y="Win %",
            ax=ax,
            hue="Structure",
            legend=False,
            palette="Greens_d",
        )
        ax.set_ylim(0, 100)
        ax.set_title("Win % by Structure", fontweight="bold")
        st.pyplot(fig)
        plt.close(fig)

    st.stop()

if page == "Opening Mix":
    mix = calculate_opening_mix_stats(df)
    same = mix["same_openings"]
    diff = mix["different_openings"]
    ortho = mix["orthodox"]
    unortho = mix["unorthodox"]
    baselines_df = load_baselines()
    peer_band, peer_speed = infer_user_band_speed(df, speed_filter)
    mix_total = int(same["games"]) + int(diff["games"])
    same_rate = (
        round((same["games"] / mix_total) * 100, 1) if mix_total else None
    )
    diff_rate = (
        round((diff["games"] / mix_total) * 100, 1) if mix_total else None
    )
    ortho_rate = (
        round((ortho["games"] / mix_total) * 100, 1) if mix_total else None
    )
    unortho_rate = (
        round((unortho["games"] / mix_total) * 100, 1) if mix_total else None
    )

    def _peer(metric: str, user_val, unit: str = ""):
        return population_caption(
            baselines_df, metric, peer_band, peer_speed, user_val, unit
        )

    st.subheader("♟️ Opening Mix")
    st.caption(
        "Same = games in your 4 signature openings "
        "(top ECO for White 1.e4, White 1.d4, Black vs 1.e4, Black vs 1.d4). "
        "Different = everything else. "
        "Orthodox = Italian, Ruy Lopez, Sicilian, French, Caro-Kann, "
        "Queen's Gambit, London System, King's Indian."
    )
    if baselines_df is not None and peer_band and peer_speed:
        st.caption(
            f"Population baseline: Lichess peers in **{peer_band}** · "
            f"**{peer_speed}** (means from stratified dump sample; "
            f"eval metrics from Lichess-analyzed subset only)."
        )
    elif baselines_df is None:
        st.caption(
            "No population baselines loaded. Run "
            "`scripts/run_lichess_baselines_month.py --month YYYY-MM` "
            "to generate `.cache/baselines/opening_mix_lichess_v1`."
        )

    sigs = mix.get("signature_openings") or {}
    if sigs:
        st.markdown("#### Signature Openings (4)")
        sig_cols = st.columns(4)
        for idx, key in enumerate(
            ["white_e4", "white_d4", "black_vs_e4", "black_vs_d4"]
        ):
            sig = sigs.get(key) or {}
            with sig_cols[idx]:
                label = sig.get("label", key)
                eco = sig.get("opening_eco")
                name = sig.get("opening_name") or "N/A"
                if eco:
                    title = format_eco_label(eco, eco_map)
                else:
                    title = name
                st.metric(label, title)
                st.caption(f"{sig.get('games', 0)} games in signature")

    st.markdown("#### Same vs Different Openings")
    o1, o2 = st.columns(2)
    with o1:
        st.metric("Same Openings — Games", f"{same['games']:,}")
        st.metric("Same Openings — Win %", f"{same['win_rate']}%")
        peer = _peer("same_opening_rate", same_rate, "%")
        if peer:
            st.caption(peer)
    with o2:
        st.metric("Different Openings — Games", f"{diff['games']:,}")
        st.metric("Different Openings — Win %", f"{diff['win_rate']}%")
        peer = _peer("different_opening_rate", diff_rate, "%")
        if peer:
            st.caption(peer)

    st.divider()
    st.markdown("#### Orthodox vs Unorthodox")
    o3, o4 = st.columns(2)
    with o3:
        st.metric("Orthodox — Games", f"{ortho['games']:,}")
        st.metric("Orthodox — Win %", f"{ortho['win_rate']}%")
        peer = _peer("orthodox_rate", ortho_rate, "%")
        if peer:
            st.caption(peer)
    with o4:
        st.metric("Unorthodox — Games", f"{unortho['games']:,}")
        st.metric("Unorthodox — Win %", f"{unortho['win_rate']}%")
        peer = _peer("unorthodox_rate", unortho_rate, "%")
        if peer:
            st.caption(peer)

    chart_df = pd.DataFrame(
        [
            {
                "Bucket": "Same",
                "Games": same["games"],
                "Win %": same["win_rate"],
            },
            {
                "Bucket": "Different",
                "Games": diff["games"],
                "Win %": diff["win_rate"],
            },
            {
                "Bucket": "Orthodox",
                "Games": ortho["games"],
                "Win %": ortho["win_rate"],
            },
            {
                "Bucket": "Unorthodox",
                "Games": unortho["games"],
                "Win %": unortho["win_rate"],
            },
        ]
    )
    c1, c2 = st.columns(2)
    with c1:
        fig, ax = plt.subplots(figsize=(5, 3.5))
        sns.barplot(
            data=chart_df,
            x="Bucket",
            y="Games",
            ax=ax,
            hue="Bucket",
            legend=False,
            palette="Blues_d",
        )
        ax.set_title("Games by Bucket", fontweight="bold")
        st.pyplot(fig)
        plt.close(fig)
    with c2:
        fig, ax = plt.subplots(figsize=(5, 3.5))
        sns.barplot(
            data=chart_df,
            x="Bucket",
            y="Win %",
            ax=ax,
            hue="Bucket",
            legend=False,
            palette="Greens_d",
        )
        ax.set_ylim(0, 100)
        ax.set_title("Win % by Bucket", fontweight="bold")
        st.pyplot(fig)
        plt.close(fig)

    st.divider()
    with st.spinner("Scanning material imbalance & pawn mobility…"):
        texture = calculate_imbalance_mobility_stats(df)

    st.markdown("#### Material Imbalance")
    st.caption(
        "From ply 16 onward. Pawn/piece diffs = unequal counts. "
        "Bishop vs knight = opposite B/N skew. "
        "Rook vs two minors = ±1 rook and ∓2 minors."
    )
    m1, m2, m3, m4 = st.columns(4)
    with m1:
        st.metric(
            "Pawn Differential",
            f"{texture['pawn_diff_game_rate_pct']}% games",
        )
        st.caption(
            f"{texture['pawn_diff_position_rate_pct']}% positions · "
            f"avg max |Δpawns| {texture['avg_max_pawn_diff']}"
        )
        peer = _peer(
            "pawn_diff_game_rate_pct",
            texture["pawn_diff_game_rate_pct"],
            "%",
        )
        if peer:
            st.caption(peer)
    with m2:
        st.metric(
            "Piece Differential",
            f"{texture['piece_diff_game_rate_pct']}% games",
        )
        st.caption(
            f"{texture['piece_diff_position_rate_pct']}% positions · "
            f"avg max |Δpieces| {texture['avg_max_piece_diff']}"
        )
        peer = _peer(
            "piece_diff_game_rate_pct",
            texture["piece_diff_game_rate_pct"],
            "%",
        )
        if peer:
            st.caption(peer)
    with m3:
        st.metric(
            "Bishop vs Knight",
            f"{texture['bishop_vs_knight_game_rate_pct']}% games",
        )
        st.caption(
            f"{texture['bishop_vs_knight_position_rate_pct']}% positions"
        )
        peer = _peer(
            "bishop_vs_knight_game_rate_pct",
            texture["bishop_vs_knight_game_rate_pct"],
            "%",
        )
        if peer:
            st.caption(peer)
    with m4:
        st.metric(
            "Rook vs Two Minors",
            f"{texture['rook_vs_two_minors_game_rate_pct']}% games",
        )
        st.caption(
            f"{texture['rook_vs_two_minors_position_rate_pct']}% positions"
        )
        peer = _peer(
            "rook_vs_two_minors_game_rate_pct",
            texture["rook_vs_two_minors_game_rate_pct"],
            "%",
        )
        if peer:
            st.caption(peer)

    imb_df = pd.DataFrame(
        [
            {
                "Type": "Pawn Δ",
                "Games %": texture["pawn_diff_game_rate_pct"],
                "Positions %": texture["pawn_diff_position_rate_pct"],
            },
            {
                "Type": "Piece Δ",
                "Games %": texture["piece_diff_game_rate_pct"],
                "Positions %": texture["piece_diff_position_rate_pct"],
            },
            {
                "Type": "B vs N",
                "Games %": texture["bishop_vs_knight_game_rate_pct"],
                "Positions %": texture["bishop_vs_knight_position_rate_pct"],
            },
            {
                "Type": "R vs 2 minors",
                "Games %": texture["rook_vs_two_minors_game_rate_pct"],
                "Positions %": texture["rook_vs_two_minors_position_rate_pct"],
            },
        ]
    )
    imb_long = imb_df.melt(
        id_vars=["Type"], var_name="Scope", value_name="Rate %"
    )
    fig, ax = plt.subplots(figsize=(7, 3.5))
    sns.barplot(
        data=imb_long,
        x="Type",
        y="Rate %",
        hue="Scope",
        ax=ax,
        palette="Blues_d",
    )
    ax.set_ylim(0, 100)
    ax.set_title("Material Imbalance Frequency", fontweight="bold")
    st.pyplot(fig)
    plt.close(fig)

    st.markdown("#### Pawn Mobility")
    pm1, pm2, pm3 = st.columns(3)
    with pm1:
        st.metric(
            "Locked Positions",
            f"{texture['locked_position_rate_pct']}%",
        )
        st.caption("≤4 legal pawn moves (both sides), ply 16+")
        peer = _peer(
            "locked_position_rate_pct",
            texture["locked_position_rate_pct"],
            "%",
        )
        if peer:
            st.caption(peer)
    with pm2:
        st.metric(
            "Games With Locked State",
            f"{texture['locked_game_rate_pct']}%",
        )
        st.caption(f"{texture['games_scanned']:,} parseable games")
        peer = _peer(
            "locked_game_rate_pct", texture["locked_game_rate_pct"], "%"
        )
        if peer:
            st.caption(peer)
    with pm3:
        st.metric(
            "Pawn Moves / Game",
            f"{texture['avg_pawn_moves']}",
        )
        st.caption(
            f"Your pawn moves avg: {texture['avg_user_pawn_moves']}"
        )
        peer = _peer("avg_pawn_moves", texture["avg_pawn_moves"])
        if peer:
            st.caption(peer)

    st.divider()
    st.subheader("🧠 Style Split — Last 10 Games")
    st.caption(
        "Stockfish 18 · depth 14 · Threads 2 · Hash 32 · MultiPV 1. "
        "Sacrifice / early trades ignore pawns & kings. "
        "Early flank pushes only count into enemy territory "
        "(ranks 5–8 for White, 1–4 for Black)."
    )

    style_n = 10
    last_ids = tuple(
        df.sort_values("created_at").tail(style_n)["id"].astype(str).tolist()
    )
    cache_key = ("style_metrics_v4", last_ids, 14, 2, 32)
    run_style = st.button(
        "Run / refresh Stockfish style analysis",
        type="primary",
        key="run_style_metrics",
    )

    if run_style or (
        st.session_state.get("style_metrics_key") == cache_key
        and "style_metrics" in st.session_state
    ):
        if run_style or st.session_state.get("style_metrics_key") != cache_key:
            if not DEFAULT_ENGINE.exists():
                st.error(
                    f"Stockfish binary missing at `{DEFAULT_ENGINE}`. "
                    "Download SF18 into bin/ first."
                )
            else:
                progress = st.progress(0.0, text="Starting Stockfish…")

                def _on_progress(i, total, game_id):
                    progress.progress(
                        i / max(total, 1),
                        text=f"Analyzing game {i}/{total}: {game_id}",
                    )

                with st.spinner("Analyzing last 10 games (depth 14)…"):
                    style = calculate_style_metrics(
                        df,
                        n=style_n,
                        engine_path=DEFAULT_ENGINE,
                        depth=14,
                        threads=2,
                        hash_mb=32,
                        progress_callback=_on_progress,
                    )
                progress.empty()
                st.session_state["style_metrics"] = style
                st.session_state["style_metrics_key"] = cache_key

        style = st.session_state.get("style_metrics")
        if style and style.get("games", 0) > 0:
            h1, h2 = st.columns(2)
            h1.metric("Games", f"{style['games']}")
            h2.metric("Win Rate", f"{style['win_rate']}%")

            initiative = style.get("initiative") or {}
            attacking = style.get("attacking") or {}

            st.markdown("### Initiative & Maneuver")
            i1, i2, i3 = st.columns(3)
            with i1:
                st.metric(
                    "Eval Volatility",
                    f"{initiative.get('avg_eval_volatility_cp', 0)} cp",
                )
                st.caption("Mean |Δeval| per ply (user POV)")
                peer = _peer(
                    "avg_eval_volatility_cp",
                    initiative.get("avg_eval_volatility_cp"),
                    " cp",
                )
                if peer:
                    st.caption(peer)
            with i2:
                st.metric(
                    "Sacrifice Rate",
                    f"{initiative.get('sacrifice_rate_pct', 0)}%",
                )
                st.caption(
                    f"Games with piece sac "
                    f"(avg {initiative.get('avg_sacrifice_moves', 0)} / game)"
                )
                peer = _peer(
                    "sacrifice_rate_pct",
                    initiative.get("sacrifice_rate_pct"),
                    "%",
                )
                if peer:
                    st.caption(peer)
            with i3:
                st.metric(
                    "Early Flank Pushes",
                    f"{initiative.get('early_flank_rate_pct', 0)}%",
                )
                st.caption(
                    f"Into enemy territory by move {12} "
                    f"(avg {initiative.get('avg_early_flank_pushes', 0)} / game)"
                )
                peer = _peer(
                    "early_flank_rate_pct",
                    initiative.get("early_flank_rate_pct"),
                    "%",
                )
                if peer:
                    st.caption(peer)

            i4, i5 = st.columns(2)
            with i4:
                conv = initiative.get("endgame_conversion_rate_pct")
                st.metric(
                    "Endgame Conversion",
                    "N/A" if conv is None else f"{conv}%",
                )
                st.caption(
                    f"Win % when ≥+1.5 with ≤10 pieces "
                    f"(n={initiative.get('endgame_advantage_games', 0)})"
                )
                peer = _peer("endgame_conversion_rate_pct", conv, "%")
                if peer:
                    st.caption(peer)
            with i5:
                st.metric(
                    "Early Trades",
                    f"{initiative.get('early_trade_rate_pct', 0)}%",
                )
                st.caption(
                    f"Piece trades ≤ move 12 "
                    f"(avg {initiative.get('avg_early_trades', 0)} / game)"
                )
                peer = _peer(
                    "early_trade_rate_pct",
                    initiative.get("early_trade_rate_pct"),
                    "%",
                )
                if peer:
                    st.caption(peer)

            st.markdown("### Attacking & Defending")
            a1, a2, a3, a4 = st.columns(4)
            with a1:
                st.metric(
                    "Higher-Value Threats",
                    f"{attacking.get('avg_higher_value_threats', 0)}",
                )
                st.caption("Avg user moves/game threatening higher piece")
            with a2:
                st.metric(
                    "Threat Escapes",
                    f"{attacking.get('avg_threat_escapes', 0)}",
                )
                st.caption(
                    "Avg moves/game leaving a lesser-value attack on your piece"
                )
                peer = _peer(
                    "avg_threat_escapes", attacking.get("avg_threat_escapes")
                )
                if peer:
                    st.caption(peer)
            with a3:
                st.metric(
                    "Trades Near Enemy King",
                    f"{attacking.get('avg_trades_near_enemy_king', 0)}",
                )
                st.caption("Avg piece captures within 2 of enemy king")
            with a4:
                st.metric(
                    "Trades Near Your King",
                    f"{attacking.get('avg_trades_near_user_king', 0)}",
                )
                st.caption("Avg piece captures within 2 of your king")

            a5, a6, a7 = st.columns(3)
            with a5:
                st.metric(
                    "Opp Territory",
                    f"{attacking.get('territory_opp_pct', 0)}%",
                )
                peer = _peer(
                    "territory_opp_pct",
                    attacking.get("territory_opp_pct"),
                    "%",
                )
                if peer:
                    st.caption(peer)
            with a6:
                st.metric(
                    "Own Territory",
                    f"{attacking.get('territory_own_pct', 0)}%",
                )
            with a7:
                st.metric(
                    "Forward / Backward",
                    f"{attacking.get('forward_move_pct', 0)}% / "
                    f"{attacking.get('backward_move_pct', 0)}%",
                )
                st.caption(
                    f"Lateral {attacking.get('lateral_move_pct', 0)}%"
                )

            dir_df = pd.DataFrame(
                [
                    {
                        "Direction": "Forward",
                        "Share %": attacking.get("forward_move_pct", 0),
                    },
                    {
                        "Direction": "Backward",
                        "Share %": attacking.get("backward_move_pct", 0),
                    },
                    {
                        "Direction": "Lateral",
                        "Share %": attacking.get("lateral_move_pct", 0),
                    },
                ]
            )
            terr_df = pd.DataFrame(
                [
                    {
                        "Zone": "Opp Territory",
                        "Share %": attacking.get("territory_opp_pct", 0),
                    },
                    {
                        "Zone": "Own Territory",
                        "Share %": attacking.get("territory_own_pct", 0),
                    },
                ]
            )
            g1, g2 = st.columns(2)
            with g1:
                fig, ax = plt.subplots(figsize=(5, 3.2))
                sns.barplot(
                    data=terr_df,
                    x="Zone",
                    y="Share %",
                    ax=ax,
                    hue="Zone",
                    legend=False,
                    palette="Blues_d",
                )
                ax.set_ylim(0, 100)
                ax.set_title("Territory Dominance", fontweight="bold")
                st.pyplot(fig)
                plt.close(fig)
            with g2:
                fig, ax = plt.subplots(figsize=(5, 3.2))
                sns.barplot(
                    data=dir_df,
                    x="Direction",
                    y="Share %",
                    ax=ax,
                    hue="Direction",
                    legend=False,
                    palette="Greens_d",
                )
                ax.set_ylim(0, 100)
                ax.set_title("Move Direction", fontweight="bold")
                st.pyplot(fig)
                plt.close(fig)

            creativity = style.get("creativity") or {}
            st.markdown("### Creativity")
            cr1, cr2, cr3 = st.columns(3)
            with cr1:
                st.metric(
                    "Drawishless",
                    f"{creativity.get('drawishless_rate_pct', 0)}%",
                )
                st.caption(
                    f"{creativity.get('drawishless_games', 0)} games with "
                    f"win% in [45, 55] at move 40, not drawn"
                )
                peer = _peer(
                    "drawishless_rate_pct",
                    creativity.get("drawishless_rate_pct"),
                    "%",
                )
                if peer:
                    st.caption(peer)
            with cr2:
                st.metric(
                    "Declined Recaptures",
                    f"{creativity.get('declined_recapture_rate_pct', 0)}%",
                )
                st.caption(
                    f"{creativity.get('declined_recaptures', 0)}/"
                    f"{creativity.get('recapture_chances', 0)} chances "
                    f"(avg {creativity.get('avg_declined_recaptures', 0)} / game)"
                )
                peer = _peer(
                    "declined_recapture_rate_pct",
                    creativity.get("declined_recapture_rate_pct"),
                    "%",
                )
                if peer:
                    st.caption(peer)
            with cr3:
                crit_t = creativity.get("avg_critical_time_s")
                st.metric(
                    "Time on Critical Positions",
                    "N/A" if crit_t is None else f"{crit_t}s",
                )
                st.caption(
                    f"Avg think on |Δwin%|≥15pp moves "
                    f"({creativity.get('critical_positions', 0)} positions; "
                    f"avg {creativity.get('avg_critical_positions', 0)} / game)"
                )
                peer = _peer("avg_critical_time_s", crit_t, "s")
                if peer:
                    st.caption(peer)

            durability = style.get("durability") or {}
            st.markdown("### Durability")
            d1, d2, d3 = st.columns(3)
            with d1:
                rec = durability.get("recovery_rate_pct")
                st.metric(
                    "Recovery after −2.0",
                    "N/A" if rec is None else f"{rec}%",
                )
                st.caption(
                    f"{durability.get('recovered_games', 0)} win/draw of "
                    f"{durability.get('disadvantage_games', 0)} games "
                    f"that hit ≤20% win probability"
                )
                peer = _peer("recovery_rate_pct", rec, "%")
                if peer:
                    st.caption(peer)
            with d2:
                st.metric(
                    "Blunders",
                    f"{durability.get('total_blunders', 0)}",
                )
                st.caption(
                    f"Rate {durability.get('blunder_rate_pct', 0)}% of moves · "
                    f"avg {durability.get('avg_blunders', 0)} / game "
                    f"(≥20pp win-probability drop)"
                )
                peer = _peer("avg_blunders", durability.get("avg_blunders"))
                if peer:
                    st.caption(peer)
            with d3:
                clk = durability.get("avg_clock_diff_s")
                st.metric(
                    "Clock Differential",
                    "N/A" if clk is None else f"{clk:+.1f}s",
                )
                st.caption("Your avg think − opponent avg think / move")
                peer = _peer("avg_clock_diff_s", clk, "s")
                if peer:
                    st.caption(peer)
        elif run_style:
            st.warning("No parseable games in the last-10 sample.")
    else:
        st.info(
            "Click **Run / refresh Stockfish style analysis** to compute "
            "Initiative, Attacking, Creativity, and Durability "
            "on the last 10 games (~40s)."
        )

    st.divider()
    st.markdown("### Time Usage")
    avg_t = mix.get("avg_time_per_move_s")
    style_cached = st.session_state.get("style_metrics") or {}
    durability_cached = style_cached.get("durability") or {}
    creativity_cached = style_cached.get("creativity") or {}
    tu1, tu2, tu3, tu4 = st.columns(4)
    with tu1:
        st.metric(
            "Avg Time / Move",
            "N/A" if avg_t is None else f"{avg_t}s",
        )
        st.caption(
            f"{mix.get('games_with_clock', 0):,} games with clock (filtered)"
        )
        peer = _peer("avg_time_per_move_s", avg_t, "s")
        if peer:
            st.caption(peer)
    with tu2:
        clk = durability_cached.get("avg_clock_diff_s")
        st.metric(
            "Clock Differential",
            "N/A" if clk is None else f"{clk:+.1f}s",
        )
        st.caption("From last-10 Stockfish sample")
        peer = _peer("avg_clock_diff_s", clk, "s")
        if peer:
            st.caption(peer)
    with tu3:
        disadv_t = durability_cached.get("avg_disadvantage_time_s")
        st.metric(
            "Time on Disadvantage",
            "N/A" if disadv_t is None else f"{disadv_t}s",
        )
        st.caption(
            f"Avg think when win probability ≤20% "
            f"({durability_cached.get('disadvantage_positions', 0)} moves)"
        )
        peer = _peer("avg_disadvantage_time_s", disadv_t, "s")
        if peer:
            st.caption(peer)
    with tu4:
        crit_t = creativity_cached.get("avg_critical_time_s")
        st.metric(
            "Time on Critical",
            "N/A" if crit_t is None else f"{crit_t}s",
        )
        st.caption("|Δwin%|≥15pp moves (last-10 sample)")
        peer = _peer("avg_critical_time_s", crit_t, "s")
        if peer:
            st.caption(peer)

    st.stop()

st.subheader("🎖️ Earned Player Archetypes & Badges")

badge_cols = st.columns(len(badges))
for idx, badge in enumerate(badges):
    with badge_cols[idx]:
        st.info(f"### {badge['emoji']} {badge['title']}\n\n{badge['desc']}")

st.divider()

first_blood_games = (
    int((df["first_blood"] == "user").sum())
    if "first_blood" in df.columns
    else 0
)
promo_totals = notation.get("promotions_total", {})
promo_sum = sum(promo_totals.values()) if promo_totals else 0

tab_raw, tab_wr = st.tabs(["Raw Numbers", "Win Rate"])

with tab_raw:
    st.subheader("📌 Volume Summary")

    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown("### 🔥 Volume & Pace")
        st.metric("Total Games Played", f"{headline.get('total_games', 0):,}")
        st.metric("Total Moves Executed", f"{headline.get('total_moves', 0):,}")
        st.metric("Est. Time Played", f"~{headline.get('total_hours', 0)} Hours")
        st.metric(
            "Max Streaks",
            f"Win: {headline.get('max_win_streak', 0)}g | Unbeaten: {headline.get('max_unbeaten_streak', 0)}g",
        )
        st.caption(
            f"Peak Gaming: {headline.get('peak_day', 'N/A')}s around {headline.get('peak_hour', 'N/A')}"
        )

    with col2:
        st.markdown("### ♟️ Opening Identity (ECO)")
        st.metric("Signature White ECO", opening.get("sig_white", "N/A"))
        st.metric("Signature Black ECO", opening.get("sig_black", "N/A"))
        st.metric("Gambits Played", f"{opening.get('total_gambits', 0):,}")
        st.metric(
            "Short Games (≤30)",
            f"{endgame.get('short_games_count', 0):,}",
        )
        st.metric(
            "Marathon Games (>50)",
            f"{endgame.get('marathon_games_count', 0):,}",
        )

    with col3:
        st.markdown("### ⚔️ Tactics Counts")
        st.metric("First Blood Games", f"{first_blood_games:,}")
        st.metric("Promotions", f"{promo_sum:,}")
        st.metric(
            "Underpromotions",
            f"{notation.get('underpromotions', 0):,}",
        )
        st.metric(
            "Knights Captured",
            f"{notation.get('knights_captured', 0):,}",
        )
        st.metric(
            "Bishops Captured",
            f"{notation.get('bishops_captured', 0):,}",
        )
        st.caption(
            f"Queenless early: {notation.get('queenless_pct', 0)}% of parsed games"
        )

    st.divider()
    st.subheader("⏱️ Clock Analysis")
    clk1, clk2, clk3 = st.columns(3)
    with clk1:
        st.metric("My Timeouts", f"{clock.get('user_timeouts', 0):,}")
        st.metric("Opponent Timeouts", f"{clock.get('opp_timeouts', 0):,}")
        st.caption(
            f"Games with clock data: {clock.get('games_with_clock', 0):,}"
        )
    with clk2:
        st.metric(
            "Avg Time / Move (Me)",
            f"{clock.get('avg_time_per_move_user', 0)}s",
        )
        st.metric(
            "Avg Time / Move (Opp)",
            f"{clock.get('avg_time_per_move_opp', 0)}s",
        )
    with clk3:
        st.metric(
            "Avg Longest Move (Me)",
            f"{clock.get('avg_longest_move_user', 0)}s",
        )
        st.metric(
            "Avg Longest Move (Opp)",
            f"{clock.get('avg_longest_move_opp', 0)}s",
        )

    st.divider()
    st.subheader("📈 Rating Progression & Playing Habits")

    r2_col1, r2_col2, r2_col3 = st.columns(3)

    with r2_col1:
        fig, ax = plt.subplots(figsize=(5, 4))
        df_sorted = df.sort_values("created_at")
        sns.lineplot(
            data=df_sorted,
            x="created_at",
            y="user_rating",
            ax=ax,
            color="#2b8cbe",
            linewidth=2,
        )
        ax.set_title("Rating Progression Over Time", fontweight="bold")
        ax.set_xlabel("Date")
        ax.set_ylabel("Rating")
        plt.xticks(rotation=30)
        st.pyplot(fig)
        plt.close(fig)

    with r2_col2:
        fig, ax = plt.subplots(figsize=(5, 4))
        speed_counts = df["speed"].value_counts()
        ax.pie(
            speed_counts,
            labels=[s.title() for s in speed_counts.index],
            autopct="%1.1f%%",
            startangle=140,
            colors=sns.color_palette("pastel"),
            wedgeprops=dict(width=0.4, edgecolor="w"),
        )
        ax.set_title("Time Control Mix Distribution", fontweight="bold")
        st.pyplot(fig)
        plt.close(fig)

    with r2_col3:
        fig, ax = plt.subplots(figsize=(5, 4))
        hourly_df = (
            df.groupby(df["created_at"].dt.hour)
            .size()
            .reindex(range(24), fill_value=0)
        )
        sns.barplot(
            x=hourly_df.index,
            y=hourly_df.values,
            ax=ax,
            hue=hourly_df.index,
            legend=False,
            palette="Blues_d",
        )
        ax.set_title("Activity by Hour of Day", fontweight="bold")
        ax.set_xlabel("Hour (00:00 - 23:00)")
        ax.set_ylabel("Games")
        st.pyplot(fig)
        plt.close(fig)

    st.divider()
    st.subheader("🎯 Opening Volume by ECO")

    r3_col1, r3_col2 = st.columns(2)

    with r3_col1:
        fig, ax = plt.subplots(figsize=(5, 4))
        top_ecos = df["opening_eco"].value_counts().head(5).index
        df_top_eco = df[df["opening_eco"].isin(top_ecos)].copy()
        df_top_eco["eco_label"] = df_top_eco["opening_eco"].map(
            lambda eco: format_eco_label(eco, eco_map)
        )
        label_order = [format_eco_label(eco, eco_map) for eco in top_ecos]
        sns.countplot(
            data=df_top_eco,
            y="eco_label",
            hue="result",
            ax=ax,
            order=label_order,
        )
        ax.set_title("Top 5 ECO Openings Played", fontweight="bold")
        ax.set_ylabel("")
        ax.set_xlabel("Games Count")
        st.pyplot(fig)
        plt.close(fig)

    with r3_col2:
        fig, ax = plt.subplots(figsize=(5, 4))
        sns.countplot(
            data=df,
            x="result",
            hue="user_color",
            ax=ax,
            palette={"white": "#e2e2e2", "black": "#4a4a4a"},
        )
        ax.set_title("Win/Loss Breakdown by Color", fontweight="bold")
        ax.set_xlabel("Outcome")
        ax.set_ylabel("Games Count")
        st.pyplot(fig)
        plt.close(fig)

    var_group = opening.get("var_group", pd.DataFrame())
    if not var_group.empty:
        top_vars = (
            var_group.sort_values("total", ascending=False)
            .head(10)[["opening_variation", "total", "wins", "losses", "draws"]]
            .rename(
                columns={
                    "opening_variation": "Variation",
                    "total": "Games",
                    "wins": "Wins",
                    "losses": "Losses",
                    "draws": "Draws",
                }
            )
        )
        st.subheader("Top Variations by Volume")
        st.dataframe(top_vars, use_container_width=True, hide_index=True)

    st.divider()
    st.subheader("⚔️ Tactics & Safety")

    r4_col1, r4_col2 = st.columns(2)

    with r4_col1:
        fig, ax = plt.subplots(figsize=(5, 4))
        castle_df = pd.DataFrame(
            list(notation.get("castling_counts", {}).items()),
            columns=["Castling", "Games"],
        )
        if not castle_df.empty:
            sns.barplot(
                data=castle_df,
                x="Castling",
                y="Games",
                ax=ax,
                hue="Castling",
                legend=False,
                palette="Blues_d",
            )
        ax.set_title("Castling Habit (King Safety)", fontweight="bold")
        ax.set_xlabel("")
        ax.set_ylabel("Games")
        st.pyplot(fig)
        plt.close(fig)

    with r4_col2:
        fig, ax = plt.subplots(figsize=(5, 4))
        mates = notation.get("checkmate_finishers", {})
        if mates:
            mate_df = pd.DataFrame(
                list(mates.items()), columns=["Piece", "Count"]
            ).sort_values("Count", ascending=False)
            sns.barplot(
                data=mate_df,
                x="Count",
                y="Piece",
                ax=ax,
                hue="Piece",
                legend=False,
                palette="Purples_r",
            )
        ax.set_title("Checkmate Finishers", fontweight="bold")
        ax.set_xlabel("Mates Delivered")
        ax.set_ylabel("")
        st.pyplot(fig)
        plt.close(fig)

    st.divider()
    st.subheader("🏁 Endgame & Terminations")

    r5_col1, r5_col2, r5_col3 = st.columns(3)

    with r5_col1:
        fig, ax = plt.subplots(figsize=(5, 4))
        term_data = []
        for m, c in endgame.get("win_methods", {}).items():
            term_data.append({"Outcome": "Wins", "Method": m, "Count": c})
        for m, c in endgame.get("loss_methods", {}).items():
            term_data.append({"Outcome": "Losses", "Method": m, "Count": c})

        if term_data:
            term_df = pd.DataFrame(term_data)
            sns.barplot(
                data=term_df,
                x="Method",
                y="Count",
                hue="Outcome",
                ax=ax,
                palette={"Wins": "#a6e3a1", "Losses": "#f38ba8"},
            )
        ax.set_title("How Games Ended", fontweight="bold")
        ax.set_xlabel("")
        ax.set_ylabel("Games")
        st.pyplot(fig)
        plt.close(fig)

    with r5_col2:
        fig, ax = plt.subplots(figsize=(5, 4))
        e_types = notation.get("endgame_types", {})
        if e_types:
            e_df = pd.DataFrame(
                list(e_types.items()), columns=["Endgame", "Count"]
            ).sort_values("Count", ascending=False)
            sns.barplot(
                data=e_df,
                x="Count",
                y="Endgame",
                ax=ax,
                hue="Endgame",
                legend=False,
                palette="Purples_r",
            )
        ax.set_title("Endgame Positions Reached", fontweight="bold")
        ax.set_xlabel("Games")
        ax.set_ylabel("")
        st.pyplot(fig)
        plt.close(fig)

    with r5_col3:
        fig, ax = plt.subplots(figsize=(5, 4))
        captures_df = pd.DataFrame(
            [
                {
                    "Piece": "Knights 🐴",
                    "Captured": notation.get("knights_captured", 0),
                },
                {
                    "Piece": "Bishops 🐘",
                    "Captured": notation.get("bishops_captured", 0),
                },
            ]
        )
        sns.barplot(
            data=captures_df,
            x="Piece",
            y="Captured",
            ax=ax,
            hue="Piece",
            legend=False,
            palette="Greens_d",
        )
        ax.set_title("Enemy Minor Pieces Captured", fontweight="bold")
        ax.set_xlabel("")
        ax.set_ylabel("Total Captured")
        st.pyplot(fig)
        plt.close(fig)

with tab_wr:
    st.subheader("📌 Win Rate Highlights")

    bias = conditional.get("color_bias", 0)
    bias_str = (
        f"+{bias}% (White)" if bias >= 0 else f"{abs(bias)}% (Black)"
    )

    wr1, wr2, wr3 = st.columns(3)

    with wr1:
        st.markdown("### 🎯 Core Win Rates")
        st.metric(
            "Baseline Win Rate",
            f"{conditional.get('baseline_win_rate', 0)}%",
        )
        st.metric(
            "White Win Rate",
            f"{conditional.get('white_win_rate', 0)}%",
        )
        st.metric(
            "Black Win Rate",
            f"{conditional.get('black_win_rate', 0)}%",
        )
        st.metric("Color Advantage", bias_str)

    with wr2:
        st.markdown("### ⚔️ Situational")
        st.metric(
            "Underdog (+30 Elo)",
            f"{conditional.get('underdog_win_rate', 0)}%",
        )
        st.metric(
            "Favored (−30 Elo)",
            f"{conditional.get('favored_win_rate', 0)}%",
        )
        st.metric(
            "First Blood (You)",
            f"{conditional.get('fb_user_win_rate', 0)}%",
        )
        st.metric(
            "First Blood (Opp)",
            f"{conditional.get('fb_opp_win_rate', 0)}%",
        )

    with wr3:
        st.markdown("### ♟️ Openings & Length")
        st.metric(
            "Gambit Win Rate",
            f"{opening.get('gambit_win_rate', 0)}%",
        )
        st.metric(
            "Short Games (≤30)",
            f"{endgame.get('short_win_rate', 0)}%",
        )
        st.metric(
            "Marathon Games (>50)",
            f"{endgame.get('marathon_win_rate', 0)}%",
        )
        st.metric("Secret Weapon (Variation)", opening.get("secret_weapon", "N/A"))
        st.metric("Nemesis Variation", opening.get("nemesis", "N/A"))

    st.divider()
    st.subheader("⏱️ Clock Win Rates")
    cwr1, cwr2, cwr3 = st.columns(3)
    with cwr1:
        st.metric(
            "Won on Time (Opp Timeout)",
            f"{clock.get('won_on_time_wr', 0)}%",
        )
        st.metric(
            "Lost on Time (My Timeout)",
            f"{clock.get('lost_on_time_wr', 0)}%",
        )
        st.caption(
            f"Timeout-decided games: {clock.get('timeout_decided_games', 0):,} "
            f"({clock.get('timeout_decided_wr', 0)}% WR)"
        )
    with cwr2:
        st.metric(
            "WR When Slower Avg Move",
            f"{clock.get('slower_avg_wr', 0)}%",
        )
        st.metric(
            "WR When Longer Think Peak",
            f"{clock.get('longer_think_wr', 0)}%",
        )
    with cwr3:
        st.metric(
            "Avg Time / Move (Me)",
            f"{clock.get('avg_time_per_move_user', 0)}s",
        )
        st.metric(
            "Avg Longest Move (Me)",
            f"{clock.get('avg_longest_move_user', 0)}s",
        )
        st.caption(
            f"Opp avg {clock.get('avg_time_per_move_opp', 0)}s / "
            f"longest {clock.get('avg_longest_move_opp', 0)}s"
        )

    st.divider()
    st.subheader("📊 Win Rate Breakdown")

    wr_c1, wr_c2 = st.columns(2)

    with wr_c1:
        fig, ax = plt.subplots(figsize=(5, 4))
        op_group = opening.get("op_group", pd.DataFrame())
        if not op_group.empty:
            filtered_ops = op_group[op_group["total"] >= 2].sort_values(
                "win_rate", ascending=False
            )
            if not filtered_ops.empty:
                plot_ops = filtered_ops.head(5).copy()
                plot_ops["eco_label"] = plot_ops["opening_eco"].map(
                    lambda eco: format_eco_label(eco, eco_map)
                )
                sns.barplot(
                    data=plot_ops,
                    x="win_rate",
                    y="eco_label",
                    hue="eco_label",
                    legend=False,
                    ax=ax,
                    palette="Greens_r",
                )
        ax.set_title("Highest Win-Rate ECO Openings (Min 2g)", fontweight="bold")
        ax.set_xlim(0, 100)
        ax.set_xlabel("Win Rate (%)")
        ax.set_ylabel("")
        st.pyplot(fig)
        plt.close(fig)

    with wr_c2:
        fig, ax = plt.subplots(figsize=(5, 4))
        mod_df = conditional.get("modifiers", pd.DataFrame())
        if not mod_df.empty:
            colors = [
                "#a6e3a1" if v >= 0 else "#f38ba8" for v in mod_df["Diff"]
            ]
            sns.barplot(
                data=mod_df,
                x="Diff",
                y="Condition",
                ax=ax,
                palette=colors,
                hue="Condition",
                legend=False,
            )
            ax.axvline(0, color="gray", linestyle="--", linewidth=1.5)
        ax.set_title(
            f"Win % Shift vs Baseline ({conditional.get('baseline_win_rate', 0)}%)",
            fontweight="bold",
        )
        ax.set_xlabel("Impact Shift (%)")
        ax.set_ylabel("")
        st.pyplot(fig)
        plt.close(fig)

    op_group = opening.get("op_group", pd.DataFrame())
    if not op_group.empty:
        wr_table = (
            op_group[op_group["total"] >= 2]
            .sort_values("total", ascending=False)[
                ["opening_eco", "total", "wins", "losses", "draws", "win_rate"]
            ]
            .copy()
        )
        wr_table["win_rate"] = wr_table["win_rate"].round(1)
        wr_table["Opening"] = wr_table["opening_eco"].map(
            lambda eco: format_eco_label(eco, eco_map)
        )
        wr_table = wr_table[
            ["Opening", "total", "wins", "losses", "draws", "win_rate"]
        ].rename(
            columns={
                "total": "Games",
                "wins": "Wins",
                "losses": "Losses",
                "draws": "Draws",
                "win_rate": "Win %",
            }
        )
        st.subheader("ECO Opening Win Rates")
        st.dataframe(wr_table, use_container_width=True, hide_index=True)

    var_group = opening.get("var_group", pd.DataFrame())
    if not var_group.empty:
        var_table = (
            var_group[var_group["total"] >= 2]
            .sort_values("total", ascending=False)[
                [
                    "opening_variation",
                    "total",
                    "wins",
                    "losses",
                    "draws",
                    "win_rate",
                ]
            ]
            .copy()
        )
        var_table["win_rate"] = var_table["win_rate"].round(1)
        var_table = var_table.rename(
            columns={
                "opening_variation": "Variation",
                "total": "Games",
                "wins": "Wins",
                "losses": "Losses",
                "draws": "Draws",
                "win_rate": "Win %",
            }
        )
        st.subheader("Variation Win Rates")
        st.dataframe(var_table, use_container_width=True, hide_index=True)
