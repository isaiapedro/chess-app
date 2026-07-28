import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
import streamlit as st
from load_data import load_user_data
from stats import (
    calculate_archetype_badges,
    calculate_conditional_stats,
    calculate_endgame_stats,
    calculate_headline_stats,
    calculate_notation_stats,
    calculate_opening_stats,
    normalize_opening_name,
)

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

# Ensure opening family column exists
df_raw["opening_family"] = df_raw["opening_name"].apply(normalize_opening_name)

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

# Filter 4: Opening Family Filter
available_openings = sorted(df_raw["opening_family"].unique().tolist())
opening_filter = st.sidebar.multiselect(
    "📖 Opening Families",
    options=available_openings,
    default=[],
    placeholder="Filter by specific openings...",
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

if opening_filter:
    df = df[df["opening_family"].isin(opening_filter)]

# Display Active Filters Banner
total_games_raw = len(df_raw)
filtered_games = len(df)
pct_retained = (
    (filtered_games / total_games_raw * 100) if total_games_raw > 0 else 0
)

st.caption(
    f"📊 **Active Filter Snapshot:** Displaying **{filtered_games:,}** of **{total_games_raw:,}** games ({pct_retained:.1f}% of total dataset)"
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
badges = calculate_archetype_badges(
    headline, opening, notation, endgame, conditional
)

st.divider()

# ==============================================================================
# SECTION 0: ARCHETYPE BADGES & PERSONALITY TRAITS (BULLET 6)
# ==============================================================================
st.subheader("🎖️ Earned Player Archetypes & Badges")

badge_cols = st.columns(len(badges))
for idx, badge in enumerate(badges):
    with badge_cols[idx]:
        st.info(f"### {badge['emoji']} {badge['title']}\n\n{badge['desc']}")

st.divider()

# ==============================================================================
# SECTION 1: TOP HIGHLIGHT CARDS
# ==============================================================================
st.subheader("📌 Key Performance Summary")

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
    st.markdown("### ♟️ Opening Identity")
    st.metric("Signature White", opening.get("sig_white", "N/A"))
    st.metric("Signature Black", opening.get("sig_black", "N/A"))
    st.metric("Secret Weapon", opening.get("secret_weapon", "N/A"))
    st.metric("Nemesis Opening", opening.get("nemesis", "N/A"))
    st.caption(
        f"Gambits: {opening.get('total_gambits', 0)} played ({opening.get('gambit_win_rate', 0)}% win rate)"
    )

with col3:
    st.markdown("### ⚡ Tactics & Superpowers")
    bias = conditional.get("color_bias", 0)
    bias_str = (
        f"+{bias}% (White)" if bias >= 0 else f"{abs(bias)}% (Black)"
    )
    st.metric(
        "Baseline Win Rate", f"{conditional.get('baseline_win_rate', 0)}%"
    )
    st.metric("Color Advantage", bias_str)
    st.metric(
        "Giant Slayer (+30 ELO)",
        f"{conditional.get('underdog_win_rate', 0)}% Win",
    )
    st.metric(
        "First Blood Rate",
        f"{notation.get('first_blood_pct', 0)}% of games",
    )

st.divider()

# ==============================================================================
# SECTION 2: OVERALL PERFORMANCE & PACE
# ==============================================================================
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

# ==============================================================================
# SECTION 3: OPENING REPERTOIRE
# ==============================================================================
st.subheader("🎯 Opening Analysis")

r3_col1, r3_col2, r3_col3 = st.columns(3)

with r3_col1:
    fig, ax = plt.subplots(figsize=(5, 4))
    top_families = df["opening_family"].value_counts().head(5).index
    df_top_fam = df[df["opening_family"].isin(top_families)]
    sns.countplot(
        data=df_top_fam,
        y="opening_family",
        hue="result",
        ax=ax,
        order=top_families,
    )
    ax.set_title("Top 5 Opening Families Played", fontweight="bold")
    ax.set_ylabel("")
    ax.set_xlabel("Games Count")
    st.pyplot(fig)
    plt.close(fig)

with r3_col2:
    fig, ax = plt.subplots(figsize=(5, 4))
    op_group = opening.get("op_group", pd.DataFrame())
    if not op_group.empty:
        filtered_ops = op_group[op_group["total"] >= 2].sort_values(
            "win_rate", ascending=False
        )
        if not filtered_ops.empty:
            sns.barplot(
                data=filtered_ops.head(5),
                x="win_rate",
                y="opening_family",
                hue="opening_family",
                legend=False,
                ax=ax,
                palette="Greens_r",
            )
    ax.set_title("Highest Win-Rate Openings (Min 2g)", fontweight="bold")
    ax.set_xlim(0, 100)
    ax.set_xlabel("Win Rate (%)")
    ax.set_ylabel("")
    st.pyplot(fig)
    plt.close(fig)

with r3_col3:
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

st.divider()

# ==============================================================================
# SECTION 4: TACTICS, CASTLING & SUPERPOWERS
# ==============================================================================
st.subheader("⚔️ Tactics, Safety & Modifiers")

r4_col1, r4_col2, r4_col3 = st.columns(3)

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

with r4_col3:
    fig, ax = plt.subplots(figsize=(5, 4))
    mod_df = conditional.get("modifiers", pd.DataFrame())
    if not mod_df.empty:
        colors = ["#a6e3a1" if v >= 0 else "#f38ba8" for v in mod_df["Diff"]]
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

st.divider()

# ==============================================================================
# SECTION 5: ENDGAME & TERMINATIONS
# ==============================================================================
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
