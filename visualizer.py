import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns
from stats import (
    calculate_conditional_stats,
    calculate_endgame_stats,
    calculate_headline_stats,
    calculate_notation_stats,
    calculate_opening_stats,
    normalize_opening_eco,
)
from eco_names import format_eco_label

# Apply dark theme style
sns.set_theme(style="darkgrid")


def render_dashboard(
    df: pd.DataFrame,
    username: str,
    timeframe: str,
    output_filename: str = "dashboard.png",
):
    if df.empty:
        print("No games found for the selected timeframe.")
        return

    df = df.copy()
    df["opening_eco"] = df["opening_eco"].apply(normalize_opening_eco)

    # Calculate statistics across all features
    headline = calculate_headline_stats(df)
    opening = calculate_opening_stats(df, min_games=3)
    notation = calculate_notation_stats(df)
    endgame = calculate_endgame_stats(df)
    conditional = calculate_conditional_stats(df)

    # EXPANDED FLEXIBLE CANVAS: 22" Wide x 40" High with constrained layout
    fig, axes = plt.subplots(5, 3, figsize=(22, 40), layout="constrained")
    fig.suptitle(
        f"🏆 Master Chess Wrapped: {username} ({timeframe})",
        fontsize=26,
        fontweight="bold",
    )

    # Card styling config
    box_props = dict(
        boxstyle="round,pad=1.0", facecolor="#1e1e2e", edgecolor="#89b4fa"
    )

    # ==========================================
    # ROW 1: SUMMARY RECAP CARDS
    # ==========================================

    # Panel 0,0: Volume & Pace Card
    axes[0, 0].axis("off")
    c1_text = (
        f"🔥 VOLUME & PACE SUMMARY 🔥\n"
        f"─────────────────────────────────────────\n"
        f"• Total Games Played: {headline['total_games']:,}\n"
        f"• Total Moves Made:   {headline['total_moves']:,}\n"
        f"• Time Spent Playing: ~{headline['total_hours']} Hours\n"
        f"• Max Win Streak:     {headline['max_win_streak']} Games\n"
        f"• Unbeaten Streak:    {headline['max_unbeaten_streak']} Games\n\n"
        f"• Peak Gaming Day:    {headline['peak_day']}\n"
        f"• Peak Hour Window:   {headline['peak_hour']}\n"
    )
    axes[0, 0].text(
        0.02,
        0.98,
        c1_text,
        transform=axes[0, 0].transAxes,
        fontsize=13,
        verticalalignment="top",
        fontfamily="monospace",
        bbox=dict(
            boxstyle="round,pad=1.0", facecolor="#1e1e2e", edgecolor="#89b4fa"
        ),
        color="#cdd6f4",
    )
    axes[0, 0].set_title(
        "Volume & Pace Overview", fontweight="bold", fontsize=15
    )

    # Panel 0,1: Opening Repertoire Card
    axes[0, 1].axis("off")
    c2_text = (
        f"♟️ OPENING REPERTOIRE ♟️\n"
        f"─────────────────────────────────────────\n"
        f"• Signature White:  {opening['sig_white']}\n"
        f"• Signature Black:  {opening['sig_black']}\n\n"
        f"• Secret Weapon:    {opening['secret_weapon']}\n"
        f"• Nemesis Opening:  {opening['nemesis']}\n\n"
        f"• Gambits Played:   {opening['total_gambits']} Games\n"
        f"• Gambit Win Rate:  {opening['gambit_win_rate']}%\n"
    )
    axes[0, 1].text(
        0.02,
        0.98,
        c2_text,
        transform=axes[0, 1].transAxes,
        fontsize=13,
        verticalalignment="top",
        fontfamily="monospace",
        bbox=dict(
            boxstyle="round,pad=1.0", facecolor="#1e1e2e", edgecolor="#a6e3a1"
        ),
        color="#cdd6f4",
    )
    axes[0, 1].set_title(
        "Opening Identity Summary", fontweight="bold", fontsize=15
    )

    # Panel 0,2: Superpowers & Tactics Card
    axes[0, 2].axis("off")
    bias_str = (
        f"+{conditional['color_bias']}% as White"
        if conditional["color_bias"] >= 0
        else f"{conditional['color_bias']}% as Black"
    )
    c3_text = (
        f"⚡ TACTICS & SUPERPOWERS ⚡\n"
        f"─────────────────────────────────────────\n"
        f"• Baseline Win Rate: {conditional['baseline_win_rate']}%\n"
        f"• Color Advantage:   {bias_str}\n"
        f"• Giant Slayer Win%: {conditional['underdog_win_rate']}% (+30 ELO)\n\n"
        f"• First Blood Rate:  {notation['first_blood_pct']}%\n"
        f"• Short Games (≤30m):{endgame['short_win_rate']}% Win\n"
        f"• Long Games (>50m): {endgame['marathon_win_rate']}% Win\n"
    )
    axes[0, 2].text(
        0.02,
        0.98,
        c3_text,
        transform=axes[0, 2].transAxes,
        fontsize=13,
        verticalalignment="top",
        fontfamily="monospace",
        bbox=dict(
            boxstyle="round,pad=1.0", facecolor="#1e1e2e", edgecolor="#fab387"
        ),
        color="#cdd6f4",
    )
    axes[0, 2].set_title(
        "Tactics & Superpowers Summary", fontweight="bold", fontsize=15
    )

    # ==========================================
    # ROW 2: OVERALL PERFORMANCE & PACE
    # ==========================================

    # Panel 1,0: Rating Progression
    df_sorted = df.sort_values("created_at")
    sns.lineplot(
        data=df_sorted,
        x="created_at",
        y="user_rating",
        ax=axes[1, 0],
        color="#2b8cbe",
        linewidth=2,
    )
    axes[1, 0].set_title(
        "Rating Progression Over Time", fontweight="bold", fontsize=14
    )
    axes[1, 0].set_xlabel("Date")
    axes[1, 0].set_ylabel("Rating")

    # Panel 1,1: Time Control Mix (Donut Chart)
    speed_counts = df["speed"].value_counts()
    axes[1, 1].pie(
        speed_counts,
        labels=[s.title() for s in speed_counts.index],
        autopct="%1.1f%%",
        startangle=140,
        colors=sns.color_palette("pastel"),
        textprops={"fontsize": 12},
        wedgeprops=dict(width=0.4, edgecolor="w"),
    )
    axes[1, 1].set_title(
        "Time Control Mix Distribution", fontweight="bold", fontsize=14
    )

    # Panel 1,2: Hourly Activity Heatmap
    hourly_df = (
        df.groupby(df["created_at"].dt.hour)
        .size()
        .reindex(range(24), fill_value=0)
    )
    sns.barplot(
        x=hourly_df.index,
        y=hourly_df.values,
        ax=axes[1, 2],
        hue=hourly_df.index,
        legend=False,
        palette="Blues_d",
    )
    axes[1, 2].set_title(
        "Activity by Hour of Day (00:00 - 23:00)", fontweight="bold", fontsize=14
    )
    axes[1, 2].set_xlabel("Hour of Day")
    axes[1, 2].set_ylabel("Games Played")

    # ==========================================
    # ROW 3: OPENING PERFORMANCE
    # ==========================================

    # Panel 2,0: Top ECO Openings
    eco_map = opening.get("eco_map", {})
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
        ax=axes[2, 0],
        order=label_order,
    )
    axes[2, 0].set_title(
        "Top 5 ECO Openings Played", fontweight="bold", fontsize=14
    )
    axes[2, 0].set_ylabel("")
    axes[2, 0].set_xlabel("Games Count")

    # Panel 2,1: Highest Win-Rate ECO Openings
    op_group = opening["op_group"]
    filtered_ops = op_group[op_group["total"] >= 3].sort_values(
        "win_rate", ascending=False
    )
    if not filtered_ops.empty:
        plot_ops = filtered_ops.head(5).copy()
        if "eco_label" not in plot_ops.columns:
            plot_ops["eco_label"] = plot_ops["opening_eco"].map(
                lambda eco: format_eco_label(eco, eco_map)
            )
        sns.barplot(
            data=plot_ops,
            x="win_rate",
            y="eco_label",
            hue="eco_label",
            legend=False,
            ax=axes[2, 1],
            palette="Greens_r",
        )
    axes[2, 1].set_title(
        "Highest Win-Rate ECO Openings (Min 3 games)",
        fontweight="bold",
        fontsize=14,
    )
    axes[2, 1].set_xlim(0, 100)
    axes[2, 1].set_xlabel("Win Rate (%)")
    axes[2, 1].set_ylabel("")

    # Panel 2,2: Results by Color
    sns.countplot(
        data=df,
        x="result",
        hue="user_color",
        ax=axes[2, 2],
        palette={"white": "#e2e2e2", "black": "#4a4a4a"},
    )
    axes[2, 2].set_title(
        "Win/Loss Breakdown by Piece Color", fontweight="bold", fontsize=14
    )
    axes[2, 2].set_xlabel("Outcome")
    axes[2, 2].set_ylabel("Games Count")

    # ==========================================
    # ROW 4: TACTICS, CASTLING & SUPERPOWERS
    # ==========================================

    # Panel 3,0: Castling Habit
    castle_df = pd.DataFrame(
        list(notation["castling_counts"].items()),
        columns=["Castling", "Games"],
    )
    sns.barplot(
        data=castle_df,
        x="Castling",
        y="Games",
        ax=axes[3, 0],
        hue="Castling",
        legend=False,
        palette="Blues_d",
    )
    axes[3, 0].set_title(
        "Castling Habit (King Safety)", fontweight="bold", fontsize=14
    )
    axes[3, 0].set_xlabel("")
    axes[3, 0].set_ylabel("Games Count")

    # Panel 3,1: Checkmate Finishers
    mates = notation["checkmate_finishers"]
    if mates:
        mate_df = pd.DataFrame(
            list(mates.items()), columns=["Piece", "Count"]
        ).sort_values("Count", ascending=False)
        sns.barplot(
            data=mate_df,
            x="Count",
            y="Piece",
            ax=axes[3, 1],
            hue="Piece",
            legend=False,
            palette="Purples_r",
        )
    axes[3, 1].set_title(
        "Checkmate Finishers (Delivered Mate)", fontweight="bold", fontsize=14
    )
    axes[3, 1].set_xlabel("Checkmates Delivered")
    axes[3, 1].set_ylabel("")

    # Panel 3,2: Superpowers & Win % Shifts
    mod_df = conditional["modifiers"]
    if not mod_df.empty:
        colors = ["#a6e3a1" if v >= 0 else "#f38ba8" for v in mod_df["Diff"]]
        sns.barplot(
            data=mod_df,
            x="Diff",
            y="Condition",
            ax=axes[3, 2],
            palette=colors,
            hue="Condition",
            legend=False,
        )
        axes[3, 2].axvline(0, color="gray", linestyle="--", linewidth=1.5)
    axes[3, 2].set_title(
        f"Win % Shift vs Baseline ({conditional['baseline_win_rate']}%)",
        fontweight="bold",
        fontsize=14,
    )
    axes[3, 2].set_xlabel("Win Rate Impact (%)")
    axes[3, 2].set_ylabel("")

    # ==========================================
    # ROW 5: ENDGAME & TERMINATIONS
    # ==========================================

    # Panel 4,0: Method of Victory & Defeat
    term_data = []
    for m, c in endgame["win_methods"].items():
        term_data.append({"Outcome": "Wins", "Method": m, "Count": c})
    for m, c in endgame["loss_methods"].items():
        term_data.append({"Outcome": "Losses", "Method": m, "Count": c})

    if term_data:
        term_df = pd.DataFrame(term_data)
        sns.barplot(
            data=term_df,
            x="Method",
            y="Count",
            hue="Outcome",
            ax=axes[4, 0],
            palette={"Wins": "#a6e3a1", "Losses": "#f38ba8"},
        )
    axes[4, 0].set_title(
        "How Games Ended (Wins vs Losses)", fontweight="bold", fontsize=14
    )
    axes[4, 0].set_xlabel("")
    axes[4, 0].set_ylabel("Games Count")

    # Panel 4,1: Endgame Positions Reached
    e_types = notation.get("endgame_types", {})
    if e_types:
        e_df = pd.DataFrame(
            list(e_types.items()), columns=["Endgame", "Count"]
        ).sort_values("Count", ascending=False)
        sns.barplot(
            data=e_df,
            x="Count",
            y="Endgame",
            ax=axes[4, 1],
            hue="Endgame",
            legend=False,
            palette="Purples_r",
        )
    axes[4, 1].set_title(
        "Endgame Positions Reached", fontweight="bold", fontsize=14
    )
    axes[4, 1].set_xlabel("Games Count")
    axes[4, 1].set_ylabel("")

    # Panel 4,2: Minor Piece Captures Breakdown
    captures_df = pd.DataFrame(
        [
            {"Piece": "Knights 🐴", "Captured": notation["knights_captured"]},
            {"Piece": "Bishops 🐘", "Captured": notation["bishops_captured"]},
        ]
    )
    sns.barplot(
        data=captures_df,
        x="Piece",
        y="Captured",
        ax=axes[4, 2],
        hue="Piece",
        legend=False,
        palette="Greens_d",
    )
    axes[4, 2].set_title(
        "Enemy Minor Pieces Captured (PGN)", fontweight="bold", fontsize=14
    )
    axes[4, 2].set_xlabel("")
    axes[4, 2].set_ylabel("Total Captured")

    # Save high-res dashboard
    plt.savefig(output_filename, dpi=300)
    print(
        f"🖼️  Master Dashboard saved cleanly to: ./{output_filename} (22x40 inches @ 300 DPI)"
    )
