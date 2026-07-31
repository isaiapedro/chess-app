from dataclasses import dataclass

import pandas as pd
from fastapi import HTTPException

from api.schemas import GameFilters
from api.services.serialize import dataframe_to_records, to_json_safe
from load_data import load_user_data
from stats import (
    calculate_activity_stats,
    calculate_archetype_badges,
    calculate_clock_stats,
    calculate_conditional_stats,
    calculate_endgame_stats,
    calculate_headline_stats,
    calculate_notation_stats,
    calculate_opening_stats,
    normalize_opening_eco,
)


@dataclass
class LoadedGames:
    username: str
    filters: GameFilters
    raw_df: pd.DataFrame
    filtered_df: pd.DataFrame


def apply_filters(df: pd.DataFrame, filters: GameFilters) -> pd.DataFrame:
    out = df.copy()

    if filters.speed:
        out = out[out["speed"].astype(str).str.lower() == filters.speed.lower()]

    if filters.color:
        out = out[
            out["user_color"].astype(str).str.lower() == filters.color.lower()
        ]

    if filters.result:
        out = out[out["result"] == filters.result]

    if filters.eco:
        out = out[out["opening_eco"].isin(filters.eco)]

    if filters.date_from is not None:
        out = out[out["created_at"].dt.date >= filters.date_from]

    if filters.date_to is not None:
        out = out[out["created_at"].dt.date <= filters.date_to]

    return out


def load_and_filter(username: str, filters: GameFilters) -> LoadedGames:
    raw_df = load_user_data(
        username, filters.timeframe, platform=filters.platform
    )
    if raw_df.empty:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No games found for user '{username}' on "
                f"{filters.platform} in timeframe '{filters.timeframe}'."
            ),
        )

    raw_df = raw_df.copy()
    raw_df["opening_eco"] = raw_df["opening_eco"].apply(normalize_opening_eco)
    filtered_df = apply_filters(raw_df, filters)

    return LoadedGames(
        username=username,
        filters=filters,
        raw_df=raw_df,
        filtered_df=filtered_df,
    )


def filters_meta(filters: GameFilters) -> dict:
    return {
        "platform": filters.platform,
        "timeframe": filters.timeframe,
        "speed": filters.speed,
        "color": filters.color,
        "result": filters.result,
        "eco": filters.eco,
        "date_from": filters.date_from.isoformat() if filters.date_from else None,
        "date_to": filters.date_to.isoformat() if filters.date_to else None,
    }


def build_meta(username: str, filters: GameFilters, games_count: int) -> dict:
    return {
        "username": username,
        "platform": filters.platform,
        "timeframe": filters.timeframe,
        "games_count": games_count,
        "filters": filters_meta(filters),
    }


def build_comparisons(headline: dict, notation: dict) -> dict:
    total_hours = float(headline.get("total_hours") or 0)
    total_moves = int(headline.get("total_moves") or 0)
    return {
        "books_read": round(total_hours / 8, 1),
        "movies_watched": round(total_hours / 2, 1),
        "km_walked": round(total_moves * 0.001, 2),
        "captured_piece_weight_g": round(
            float(notation.get("captured_piece_weight_g") or 0), 1
        ),
    }


def build_rating_series(df: pd.DataFrame) -> list[dict]:
    if df.empty or "user_rating" not in df.columns:
        return []
    series = (
        df[["created_at", "user_rating"]]
        .dropna(subset=["user_rating"])
        .sort_values("created_at")
    )
    return dataframe_to_records(series)


def build_rating_summary(df: pd.DataFrame) -> dict:
    series = build_rating_series(df)
    if not series:
        return {"peak": None, "current": None, "change": None}
    ratings = [int(point["user_rating"]) for point in series if point.get("user_rating") is not None]
    if not ratings:
        return {"peak": None, "current": None, "change": None}
    return {
        "peak": max(ratings),
        "current": ratings[-1],
        "change": ratings[-1] - ratings[0],
    }


def build_factors(conditional: dict) -> dict:
    if not conditional:
        return {"baseline_win_rate": 0.0, "driving": [], "costing": []}

    baseline = float(conditional.get("baseline_win_rate") or 0)
    modifiers = conditional.get("modifiers") or []
    if isinstance(modifiers, pd.DataFrame):
        modifiers = dataframe_to_records(modifiers)

    driving = []
    costing = []
    for row in modifiers:
        condition = str(row.get("Condition") or row.get("condition") or "")
        diff = float(row.get("Diff") if row.get("Diff") is not None else row.get("diff") or 0)
        win_rate = round(baseline + diff, 1)
        item = {
            "condition": condition,
            "win_rate": win_rate,
            "diff": round(diff, 1),
        }
        if diff > 0:
            driving.append(item)
        elif diff < 0:
            costing.append(item)

    driving.sort(key=lambda x: x["diff"], reverse=True)
    costing.sort(key=lambda x: x["diff"])
    return {
        "baseline_win_rate": baseline,
        "driving": driving,
        "costing": costing,
    }


def compute_all_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {
            "headline": {},
            "opening": {},
            "notation": {},
            "endgame": {},
            "conditional": {},
            "clock": {},
            "activity": calculate_activity_stats(df),
            "badges": [],
        }

    work = df.copy()
    headline = calculate_headline_stats(work)
    opening = calculate_opening_stats(work, min_games=2)
    notation = calculate_notation_stats(work)
    endgame = calculate_endgame_stats(work)
    conditional = calculate_conditional_stats(work)
    clock = calculate_clock_stats(work)
    activity = calculate_activity_stats(work)
    badges = calculate_archetype_badges(
        headline, opening, notation, endgame, conditional
    )
    return {
        "headline": headline,
        "opening": opening,
        "notation": notation,
        "endgame": endgame,
        "conditional": conditional,
        "clock": clock,
        "activity": activity,
        "badges": badges,
    }


def games_payload(
    loaded: LoadedGames, include_pgn: bool = False
) -> dict:
    drop = [] if include_pgn else ["pgn_str"]
    return {
        "username": loaded.username,
        "platform": loaded.filters.platform,
        "timeframe": loaded.filters.timeframe,
        "count": len(loaded.filtered_df),
        "games": dataframe_to_records(loaded.filtered_df, drop_columns=drop),
    }


def recap_payload(loaded: LoadedGames) -> dict:
    stats = compute_all_stats(loaded.filtered_df)
    headline = to_json_safe(stats["headline"])
    activity = to_json_safe(stats["activity"]) or {}
    return {
        "meta": build_meta(
            loaded.username, loaded.filters, len(loaded.filtered_df)
        ),
        "headline": headline,
        "badges": to_json_safe(stats["badges"]),
        "comparisons": build_comparisons(
            headline, to_json_safe(stats["notation"]) or {}
        ),
        "rating_series": build_rating_series(loaded.filtered_df),
        "rating_summary": build_rating_summary(loaded.filtered_df),
        "activity": {
            "hourly_activity": activity.get("hourly_activity") or [],
            "monthly_activity": activity.get("monthly_activity") or [],
        },
        "results": activity.get("results_breakdown")
        or {"wins": 0, "draws": 0, "losses": 0, "win_rate": 0.0},
    }


def insights_payload(loaded: LoadedGames) -> dict:
    stats = compute_all_stats(loaded.filtered_df)
    notation = to_json_safe(stats["notation"])
    opening = to_json_safe(stats["opening"])
    if isinstance(opening, dict):
        opening.pop("eco_map", None)
    conditional = to_json_safe(stats["conditional"]) or {}

    return {
        "meta": build_meta(
            loaded.username, loaded.filters, len(loaded.filtered_df)
        ),
        "style": {
            "clock": to_json_safe(stats["clock"]),
            "conditional": conditional,
            "first_blood_pct": notation.get("first_blood_pct", 0) if notation else 0,
            "castling_counts": (
                notation.get("castling_counts", {}) if notation else {}
            ),
        },
        "factors": build_factors(conditional),
        "openings": opening,
        "middlegames": {
            "knights_captured": (
                notation.get("knights_captured", 0) if notation else 0
            ),
            "bishops_captured": (
                notation.get("bishops_captured", 0) if notation else 0
            ),
            "queenless_pct": notation.get("queenless_pct", 0) if notation else 0,
            "promotions_total": (
                notation.get("promotions_total", {}) if notation else {}
            ),
            "underpromotions": (
                notation.get("underpromotions", 0) if notation else 0
            ),
            "checkmate_finishers": (
                notation.get("checkmate_finishers", {}) if notation else {}
            ),
        },
        "endgames": {
            **(to_json_safe(stats["endgame"]) or {}),
            "endgame_types": (
                notation.get("endgame_types", {}) if notation else {}
            ),
        },
    }
