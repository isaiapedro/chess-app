from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
import threading
import time

import pandas as pd
from fastapi import HTTPException

from api.schemas import GameFilters
from api.services.serialize import (
    dataframe_to_records,
    study_games_records,
    to_json_safe,
)
from cache import CACHE_BASE, atomic_write_json, cache_file_lock
from load_data import games_store_watermark, load_user_data
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

DEFAULT_GAMES_PAGE_LIMIT = 30
MAX_GAMES_PAGE_LIMIT = 100
MEMO_TTL_SEC = 24 * 60 * 60


def _stats_disk_ttl_sec() -> int:
    raw = os.getenv("STATS_DISK_TTL_SEC")
    if raw is None:
        return 24 * 60 * 60
    try:
        return max(24 * 60 * 60, int(raw))
    except ValueError:
        return 24 * 60 * 60


STATS_DISK_TTL_SEC = _stats_disk_ttl_sec()
STATS_CACHE_DIR = CACHE_BASE / "session_stats"

_memo_lock = threading.Lock()
_key_locks_guard = threading.Lock()
_key_locks: dict[str, threading.Lock] = {}
_raw_memo: dict[str, tuple[float, pd.DataFrame]] = {}
_loaded_memo: dict[str, tuple[float, "LoadedGames"]] = {}
_stats_memo: dict[str, tuple[float, dict]] = {}


@dataclass
class LoadedGames:
    username: str
    filters: GameFilters
    raw_df: pd.DataFrame
    filtered_df: pd.DataFrame


def _day_bucket() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def raw_memo_key(username: str, platform: str, timeframe: str) -> str:
    return f"{platform}|{username.lower()}|{timeframe}|{_day_bucket()}"


def loaded_memo_key(username: str, filters: GameFilters) -> str:
    eco = ",".join(filters.eco) if filters.eco else ""
    return (
        f"{raw_memo_key(username, filters.platform, filters.timeframe)}|"
        f"{filters.speed or ''}|{filters.color or ''}|"
        f"{filters.result or ''}|{eco}|"
        f"{filters.date_from or ''}|{filters.date_to or ''}"
    )


def stats_memo_key(username: str, filters: GameFilters) -> str:
    return f"stats|{loaded_memo_key(username, filters)}"


def _stats_disk_path(key: str):
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return STATS_CACHE_DIR / f"{digest}.json"


def _stats_disk_get(key: str, watermark: int):
    path = _stats_disk_path(key)
    with cache_file_lock(path):
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            return None
    if not isinstance(payload, dict):
        return None
    try:
        saved_at = float(payload.get("saved_at") or 0)
        cached_wm = int(payload.get("watermark") or 0)
    except (TypeError, ValueError):
        return None
    if time.time() - saved_at >= STATS_DISK_TTL_SEC:
        return None
    if cached_wm != int(watermark):
        return None
    stats = payload.get("stats")
    return stats if isinstance(stats, dict) else None


def _stats_disk_set(key: str, watermark: int, stats: dict) -> None:
    path = _stats_disk_path(key)
    payload = {
        "key": key,
        "watermark": int(watermark),
        "saved_at": time.time(),
        "stats": stats,
    }
    with cache_file_lock(path):
        atomic_write_json(path, payload)


def _memo_get(store: dict, key: str):
    with _memo_lock:
        item = store.get(key)
        if item is None:
            return None
        expires_at, value = item
        if time.monotonic() >= expires_at:
            del store[key]
            return None
        return value


def _memo_set(store: dict, key: str, value) -> None:
    with _memo_lock:
        store[key] = (time.monotonic() + MEMO_TTL_SEC, value)


def _key_lock(key: str) -> threading.Lock:
    with _key_locks_guard:
        lock = _key_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _key_locks[key] = lock
        return lock


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


def load_raw_games(
    username: str, timeframe: str, platform: str
) -> pd.DataFrame:
    key = raw_memo_key(username, platform, timeframe)
    cached = _memo_get(_raw_memo, key)
    if cached is not None:
        return cached

    with _key_lock(f"raw:{key}"):
        cached = _memo_get(_raw_memo, key)
        if cached is not None:
            return cached

        raw_df = load_user_data(username, timeframe, platform=platform)
        if raw_df.empty:
            return raw_df

        raw_df = raw_df.copy()
        raw_df["opening_eco"] = raw_df["opening_eco"].apply(normalize_opening_eco)
        _memo_set(_raw_memo, key, raw_df)
        return raw_df


def load_and_filter(username: str, filters: GameFilters) -> LoadedGames:
    key = loaded_memo_key(username, filters)
    cached = _memo_get(_loaded_memo, key)
    if cached is not None:
        return cached

    with _key_lock(f"loaded:{key}"):
        cached = _memo_get(_loaded_memo, key)
        if cached is not None:
            return cached

        raw_df = load_raw_games(username, filters.timeframe, filters.platform)
        if raw_df.empty:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No games found for user '{username}' on "
                    f"{filters.platform} in timeframe '{filters.timeframe}'."
                ),
            )

        filtered_df = apply_filters(raw_df, filters)
        loaded = LoadedGames(
            username=username,
            filters=filters,
            raw_df=raw_df,
            filtered_df=filtered_df,
        )
        _memo_set(_loaded_memo, key, loaded)
        return loaded


def stats_for_loaded(loaded: LoadedGames) -> dict:
    key = stats_memo_key(loaded.username, loaded.filters)
    cached = _memo_get(_stats_memo, key)
    if cached is not None:
        return cached

    with _key_lock(key):
        cached = _memo_get(_stats_memo, key)
        if cached is not None:
            return cached

        watermark = games_store_watermark(
            loaded.filters.platform, loaded.username
        )
        disk = _stats_disk_get(key, watermark)
        if disk is not None:
            _memo_set(_stats_memo, key, disk)
            return disk

        stats = to_json_safe(compute_all_stats(loaded.filtered_df))
        if not isinstance(stats, dict):
            stats = {}
        _memo_set(_stats_memo, key, stats)
        _stats_disk_set(key, watermark, stats)
        return stats


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


def build_rating_series_by_speed(df: pd.DataFrame) -> dict[str, list[dict]]:
    if df.empty or "user_rating" not in df.columns or "speed" not in df.columns:
        return {}
    out: dict[str, list[dict]] = {}
    work = df.copy()
    work["speed_key"] = work["speed"].astype(str).str.lower().str.strip()
    for speed, group in work.groupby("speed_key"):
        key = str(speed).strip()
        if not key or key in {"nan", "none", ""}:
            continue
        series = build_rating_series(group)
        if series:
            out[key] = series
    return out


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


def page_games_df(
    df: pd.DataFrame,
    limit: int | None = DEFAULT_GAMES_PAGE_LIMIT,
    offset: int = 0,
) -> tuple[pd.DataFrame, int]:
    total = len(df)
    if df.empty:
        return df, total
    work = df.sort_values("created_at", ascending=False)
    start = max(0, int(offset or 0))
    if limit is None:
        return work.iloc[start:], total
    size = max(1, min(int(limit), MAX_GAMES_PAGE_LIMIT))
    return work.iloc[start : start + size], total


def games_payload(
    loaded: LoadedGames,
    include_pgn: bool = False,
    limit: int | None = DEFAULT_GAMES_PAGE_LIMIT,
    offset: int = 0,
) -> dict:
    page_df, total = page_games_df(loaded.filtered_df, limit=limit, offset=offset)
    games = study_games_records(page_df, include_moves=include_pgn)
    return {
        "username": loaded.username,
        "platform": loaded.filters.platform,
        "timeframe": loaded.filters.timeframe,
        "count": len(games),
        "total": total,
        "limit": None if limit is None else max(1, min(int(limit), MAX_GAMES_PAGE_LIMIT)),
        "offset": max(0, int(offset or 0)),
        "has_more": max(0, int(offset or 0)) + len(games) < total,
        "games": games,
    }


def recap_payload(loaded: LoadedGames) -> dict:
    stats = stats_for_loaded(loaded)
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
        "rating_series_by_speed": build_rating_series_by_speed(
            loaded.filtered_df
        ),
        "rating_summary": build_rating_summary(loaded.filtered_df),
        "activity": {
            "hourly_activity": activity.get("hourly_activity") or [],
            "monthly_activity": activity.get("monthly_activity") or [],
        },
        "results": activity.get("results_breakdown")
        or {"wins": 0, "draws": 0, "losses": 0, "win_rate": 0.0},
    }


def insights_payload(loaded: LoadedGames) -> dict:
    stats = stats_for_loaded(loaded)
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


def session_payload(
    loaded: LoadedGames,
    include_pgn: bool = False,
    limit: int | None = DEFAULT_GAMES_PAGE_LIMIT,
    offset: int = 0,
) -> dict:
    stats_for_loaded(loaded)
    return {
        "games": games_payload(
            loaded, include_pgn=include_pgn, limit=limit, offset=offset
        ),
        "recap": recap_payload(loaded),
        "insights": insights_payload(loaded),
    }


def build_session(
    username: str,
    filters: GameFilters,
    include_pgn: bool = False,
    limit: int | None = DEFAULT_GAMES_PAGE_LIMIT,
    offset: int = 0,
) -> dict:
    loaded = load_and_filter(username, filters)
    return session_payload(
        loaded, include_pgn=include_pgn, limit=limit, offset=offset
    )
