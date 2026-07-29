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
    calculate_opening_stats,
    normalize_opening_eco,
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

st.divider()

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
