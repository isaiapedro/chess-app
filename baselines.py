from __future__ import annotations

import calendar
import re
import zlib
from pathlib import Path

import pandas as pd

from endgame_phase_metrics import (
    ENDGAME_EVAL_METRIC_KEYS,
    ENDGAME_PGN_METRIC_KEYS,
)
from middlegame_phase_metrics import (
    MIDDLEGAME_EVAL_METRIC_KEYS,
    MIDDLEGAME_PGN_METRIC_KEYS,
)

ROOT = Path(__file__).resolve().parent
BASELINES_DIR = ROOT / ".cache" / "baselines"
RUNS_DIR = BASELINES_DIR / "runs"
DEFAULT_BASELINE_PATH = BASELINES_DIR / "opening_mix_lichess_v1.parquet"
DEFAULT_BASELINE_JSON = BASELINES_DIR / "opening_mix_lichess_v1.json"
MOBILE_BASELINE_JSON = (
    ROOT / "mobile" / "assets" / "baselines" / "opening_mix_lichess_v1.json"
)


def default_run_dir(source_month: str) -> Path:
    return RUNS_DIR / source_month


def cell_file_stem(band: str, speed: str) -> str:
    return f"{band}__{speed}"


def parse_cell_stem(stem: str) -> tuple[str, str]:
    band, speed = stem.split("__", 1)
    return band, speed


def activity_rows_from_bucket(
    by_user: dict[str, list[float]],
) -> list[dict[str, float | str]]:
    rows: list[dict[str, float | str]] = []
    for name, vals in by_user.items():
        rows.append(
            {
                "username": name,
                "games": float(vals[0]),
                "est_seconds": float(vals[1]),
            }
        )
    return rows


def activity_bucket_from_rows(
    rows: list[dict],
) -> dict[str, list[float]]:
    by_user: dict[str, list[float]] = {}
    for row in rows:
        name = str(row.get("username") or "").strip()
        if not name:
            continue
        by_user[name] = [
            float(row.get("games") or 0),
            float(row.get("est_seconds") or 0),
        ]
    return by_user


def estimate_game_seconds_from_tc(tc: str) -> float:
    raw = (tc or "").strip()
    if not raw or raw == "-":
        return 0.0
    try:
        if "+" in raw:
            base_s, inc_s = raw.split("+", 1)
            base = int(base_s)
            inc = int(inc_s)
        else:
            base = int(raw)
            inc = 0
    except ValueError:
        return 0.0
    return float(base + inc * 40)
LICHESS_MONTHLY_URL = (
    "https://database.lichess.org/standard/"
    "lichess_db_standard_rated_{month}.pgn.zst"
)

RATING_BANDS = [
    (800, 999, "800-999"),
    (1000, 1199, "1000-1199"),
    (1200, 1399, "1200-1399"),
    (1400, 1599, "1400-1599"),
    (1600, 1799, "1600-1799"),
    (1800, 1999, "1800-1999"),
    (2000, 2199, "2000-2199"),
    (2200, 2399, "2200-2399"),
    (2400, 4000, "2400+"),
]

SPEEDS = ("bullet", "blitz", "rapid", "classical")

SECONDS_PER_MOVE = {
    "bullet": 3,
    "blitz": 8,
    "rapid": 20,
    "classical": 60,
    "daily": 60,
}

PLAYER_ACTIVITY_SAMPLE_MOD = 32
ACTIVITY_MIN_GAMES = 5

ACTIVITY_METRIC_KEYS = (
    "avg_games_per_player_month",
    "avg_games_per_player_week",
    "avg_games_per_player_day",
    "avg_est_seconds_per_player_month",
    "avg_est_seconds_per_player_week",
    "avg_est_seconds_per_player_day",
)

PGN_METRIC_KEYS = (
    "win_rate",
    "est_seconds_per_game",
    *ACTIVITY_METRIC_KEYS,
    "same_opening_rate",
    "different_opening_rate",
    "orthodox_rate",
    "unorthodox_rate",
    "pawn_diff_game_rate_pct",
    "piece_diff_game_rate_pct",
    "bishop_vs_knight_game_rate_pct",
    "rook_vs_two_minors_game_rate_pct",
    "locked_position_rate_pct",
    "locked_game_rate_pct",
    "avg_pawn_moves",
    "avg_user_pawn_moves",
    "early_flank_rate_pct",
    "early_trade_rate_pct",
    "avg_early_flank_pushes",
    "avg_early_trades",
    "avg_sacrifice_moves",
    "avg_higher_value_threats",
    "avg_threat_escapes",
    "avg_trades_near_enemy_king",
    "avg_trades_near_user_king",
    "territory_opp_pct",
    "territory_own_pct",
    "forward_move_pct",
    "backward_move_pct",
    "declined_recapture_rate_pct",
    "avg_time_per_move_s",
    "avg_clock_diff_s",
    "opening_minors_developed_by_10",
    "opening_center_control_pct",
    "opening_castle_fullmove",
    "opening_uncastled_rate_pct",
    "opening_tempo_waste_rate_pct",
    *MIDDLEGAME_PGN_METRIC_KEYS,
    *ENDGAME_PGN_METRIC_KEYS,
)

EVAL_METRIC_KEYS = (
    "avg_eval_volatility_cp",
    "sacrifice_rate_pct",
    "avg_sacrifice_moves",
    "drawishless_rate_pct",
    "recovery_rate_pct",
    "avg_blunders",
    "endgame_conversion_rate_pct",
    "avg_critical_time_s",
    "avg_disadvantage_time_s",
    "avg_higher_value_threats",
    "avg_trades_near_enemy_king",
    "avg_trades_near_user_king",
    "territory_opp_pct",
    "territory_own_pct",
    "forward_move_pct",
    "backward_move_pct",
    "opening_accuracy_pct",
    *MIDDLEGAME_EVAL_METRIC_KEYS,
    *ENDGAME_EVAL_METRIC_KEYS,
)

OPENING_PGN_METRIC_KEYS = (
    "opening_minors_developed_by_10",
    "opening_center_control_pct",
    "opening_castle_fullmove",
    "opening_uncastled_rate_pct",
    "opening_tempo_waste_rate_pct",
)

OPENING_EVAL_METRIC_KEYS = ("opening_accuracy_pct",)


def rating_band(rating: float | int | None) -> str | None:
    if rating is None:
        return None
    try:
        r = int(rating)
    except (TypeError, ValueError):
        return None
    if r < 800:
        return None
    for lo, hi, label in RATING_BANDS:
        if lo <= r <= hi:
            return label
    return None


def time_control_to_speed(tc: str | None) -> str | None:
    if not tc or tc in ("-", ""):
        return None
    parts = tc.split("+")
    try:
        base = int(parts[0])
        inc = int(parts[1]) if len(parts) > 1 else 0
    except ValueError:
        return None
    total = base + 40 * inc
    if total < 180:
        return "bullet"
    if total < 480:
        return "blitz"
    if total < 1500:
        return "rapid"
    return "classical"


def ensure_baselines_dir() -> Path:
    BASELINES_DIR.mkdir(parents=True, exist_ok=True)
    return BASELINES_DIR


def save_baselines(df: pd.DataFrame, path: Path | None = None) -> Path:
    ensure_baselines_dir()
    out = path or DEFAULT_BASELINE_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.suffix == ".json":
        df.to_json(out, orient="records", indent=2)
    else:
        df.to_parquet(out, index=False)
        json_path = out.with_suffix(".json")
        df.to_json(json_path, orient="records", indent=2)
    return out


def sync_mobile_baseline_asset(
    json_path: Path | None = None,
) -> Path:
    src = Path(json_path) if json_path is not None else DEFAULT_BASELINE_JSON
    if not src.exists() and DEFAULT_BASELINE_PATH.exists():
        df = pd.read_parquet(DEFAULT_BASELINE_PATH)
        src.parent.mkdir(parents=True, exist_ok=True)
        df.to_json(src, orient="records", indent=2)
    if not src.exists():
        raise FileNotFoundError(f"Baseline JSON not found: {src}")
    dest = MOBILE_BASELINE_JSON
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return dest


def lichess_month_url(month: str) -> str:
    label = month.strip()
    if len(label) == 7 and label[4] == "-":
        return LICHESS_MONTHLY_URL.format(month=label)
    raise ValueError(f"Month must be YYYY-MM, got {month!r}")


def baselines_payload(df: pd.DataFrame | None = None) -> dict:
    frame = df if df is not None else load_baselines()
    bands = [label for _, _, label in RATING_BANDS]
    if frame is None or frame.empty:
        return {
            "meta": {
                "available": False,
                "source_month": None,
                "row_count": 0,
                "band_count": len(bands),
                "speed_count": len(SPEEDS),
            },
            "bands": bands,
            "speeds": list(SPEEDS),
            "rows": [],
            "by_cell": {},
        }

    records = frame.to_dict(orient="records")
    months = [
        str(r["source_month"])
        for r in records
        if r.get("source_month") is not None
    ]
    source_month = months[0] if months else None
    by_cell: dict[str, dict[str, dict]] = {}
    for row in records:
        band = str(row.get("rating_band") or "")
        speed = str(row.get("speed") or "")
        metric = str(row.get("metric") or "")
        if not band or not speed or not metric:
            continue
        cell = f"{band}|{speed}"
        bucket = by_cell.setdefault(cell, {})
        mean = row.get("mean")
        entry = {
            "mean": float(mean) if mean is not None and pd.notna(mean) else None,
            "n": int(row["n"]) if pd.notna(row.get("n")) else 0,
            "sample": row.get("sample"),
            "source_month": row.get("source_month"),
        }
        for key in ("p10", "p25", "p50", "p75", "p90"):
            raw = row.get(key)
            if raw is not None and pd.notna(raw):
                entry[key] = float(raw)
        raw_values = row.get("values")
        if raw_values is not None and not (
            isinstance(raw_values, float) and pd.isna(raw_values)
        ):
            if isinstance(raw_values, (list, tuple)):
                entry["values"] = [float(v) for v in raw_values]
            else:
                try:
                    entry["values"] = [float(v) for v in list(raw_values)]
                except TypeError:
                    pass
        bucket[metric] = entry
    return {
        "meta": {
            "available": True,
            "source_month": source_month,
            "row_count": len(records),
            "band_count": len(bands),
            "speed_count": len(SPEEDS),
            "cell_count": len(by_cell),
        },
        "bands": bands,
        "speeds": list(SPEEDS),
        "rows": records,
        "by_cell": by_cell,
    }


def load_baselines(path: Path | None = None) -> pd.DataFrame | None:
    candidates = []
    if path is not None:
        candidates.append(Path(path))
    else:
        candidates.extend([DEFAULT_BASELINE_PATH, DEFAULT_BASELINE_JSON])
    for p in candidates:
        if not p.exists():
            continue
        try:
            if p.suffix == ".json":
                return pd.read_json(p)
            return pd.read_parquet(p)
        except Exception:
            continue
    return None


def lookup_baseline(
    df: pd.DataFrame | None,
    metric: str,
    band: str | None,
    speed: str | None,
) -> dict | None:
    if df is None or not band or not speed:
        return None
    hit = df[
        (df["metric"] == metric)
        & (df["rating_band"] == band)
        & (df["speed"] == speed)
    ]
    if hit.empty:
        return None
    row = hit.iloc[0]
    return {
        "mean": float(row["mean"]) if pd.notna(row["mean"]) else None,
        "n": int(row["n"]) if pd.notna(row["n"]) else 0,
        "source_month": row.get("source_month"),
        "sample": row.get("sample"),
    }


def _pct(part: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round((part / total) * 100, 1)


def _style_flat_shared(style: dict | None) -> dict[str, float | None]:
    if not style:
        return {}
    initiative = style.get("initiative") or {}
    attacking = style.get("attacking") or {}
    creativity = style.get("creativity") or {}
    durability = style.get("durability") or {}
    return {
        "win_rate": style.get("win_rate"),
        "early_flank_rate_pct": initiative.get("early_flank_rate_pct"),
        "early_trade_rate_pct": initiative.get("early_trade_rate_pct"),
        "avg_early_flank_pushes": initiative.get("avg_early_flank_pushes"),
        "avg_early_trades": initiative.get("avg_early_trades"),
        "avg_sacrifice_moves": initiative.get("avg_sacrifice_moves"),
        "avg_higher_value_threats": attacking.get("avg_higher_value_threats"),
        "avg_threat_escapes": attacking.get("avg_threat_escapes"),
        "avg_trades_near_enemy_king": attacking.get(
            "avg_trades_near_enemy_king"
        ),
        "avg_trades_near_user_king": attacking.get("avg_trades_near_user_king"),
        "territory_opp_pct": attacking.get("territory_opp_pct"),
        "territory_own_pct": attacking.get("territory_own_pct"),
        "forward_move_pct": attacking.get("forward_move_pct"),
        "backward_move_pct": attacking.get("backward_move_pct"),
        "declined_recapture_rate_pct": creativity.get(
            "declined_recapture_rate_pct"
        ),
        "avg_clock_diff_s": durability.get("avg_clock_diff_s"),
        "avg_time_per_move_s": style.get("avg_time_per_move_s"),
    }


def flatten_pgn_cell_metrics(
    mix: dict,
    texture: dict,
    style: dict | None,
    est_seconds_per_game: float | None = None,
    opening: dict | None = None,
    middlegame: dict | None = None,
    endgame: dict | None = None,
) -> dict[str, float | None]:
    same = mix.get("same_openings") or {}
    diff = mix.get("different_openings") or {}
    ortho = mix.get("orthodox") or {}
    unortho = mix.get("unorthodox") or {}
    total = int(same.get("games", 0) or 0) + int(diff.get("games", 0) or 0)
    out: dict[str, float | None] = {
        "same_opening_rate": _pct(int(same.get("games", 0) or 0), total),
        "different_opening_rate": _pct(int(diff.get("games", 0) or 0), total),
        "orthodox_rate": _pct(int(ortho.get("games", 0) or 0), total),
        "unorthodox_rate": _pct(int(unortho.get("games", 0) or 0), total),
        "pawn_diff_game_rate_pct": texture.get("pawn_diff_game_rate_pct"),
        "piece_diff_game_rate_pct": texture.get("piece_diff_game_rate_pct"),
        "bishop_vs_knight_game_rate_pct": texture.get(
            "bishop_vs_knight_game_rate_pct"
        ),
        "rook_vs_two_minors_game_rate_pct": texture.get(
            "rook_vs_two_minors_game_rate_pct"
        ),
        "locked_position_rate_pct": texture.get("locked_position_rate_pct"),
        "locked_game_rate_pct": texture.get("locked_game_rate_pct"),
        "avg_pawn_moves": texture.get("avg_pawn_moves"),
        "avg_user_pawn_moves": texture.get("avg_user_pawn_moves"),
        "avg_time_per_move_s": mix.get("avg_time_per_move_s"),
        "est_seconds_per_game": est_seconds_per_game,
    }
    out.update(_style_flat_shared(style))
    if mix.get("avg_time_per_move_s") is not None:
        out["avg_time_per_move_s"] = mix.get("avg_time_per_move_s")
    if opening:
        for key in OPENING_PGN_METRIC_KEYS:
            if opening.get(key) is not None:
                out[key] = opening.get(key)
    if middlegame:
        for key in MIDDLEGAME_PGN_METRIC_KEYS:
            if middlegame.get(key) is not None:
                out[key] = middlegame.get(key)
    if endgame:
        for key in ENDGAME_PGN_METRIC_KEYS:
            if endgame.get(key) is not None:
                out[key] = endgame.get(key)
    return out


def flatten_eval_cell_metrics(
    style: dict,
    opening: dict | None = None,
    middlegame: dict | None = None,
    endgame: dict | None = None,
) -> dict[str, float | None]:
    initiative = style.get("initiative") or {}
    creativity = style.get("creativity") or {}
    durability = style.get("durability") or {}
    out = _style_flat_shared(style)
    out.update(
        {
            "avg_eval_volatility_cp": initiative.get("avg_eval_volatility_cp"),
            "sacrifice_rate_pct": initiative.get("sacrifice_rate_pct"),
            "endgame_conversion_rate_pct": initiative.get(
                "endgame_conversion_rate_pct"
            ),
            "drawishless_rate_pct": creativity.get("drawishless_rate_pct"),
            "avg_critical_time_s": creativity.get("avg_critical_time_s"),
            "recovery_rate_pct": durability.get("recovery_rate_pct"),
            "avg_blunders": durability.get("avg_blunders"),
            "avg_disadvantage_time_s": durability.get(
                "avg_disadvantage_time_s"
            ),
        }
    )
    if opening and opening.get("opening_accuracy_pct") is not None:
        out["opening_accuracy_pct"] = opening.get("opening_accuracy_pct")
    if middlegame:
        for key in MIDDLEGAME_EVAL_METRIC_KEYS:
            if middlegame.get(key) is not None:
                out[key] = middlegame.get(key)
    if endgame:
        for key in ENDGAME_EVAL_METRIC_KEYS:
            if endgame.get(key) is not None:
                out[key] = endgame.get(key)
    return out


def player_win_rate_distribution(
    rows: list[dict], min_games: int = 5
) -> list[float]:
    from collections import defaultdict

    agg: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for row in rows:
        name = str(row.get("username") or "").strip()
        if not name:
            continue
        result = str(row.get("result") or "")
        bucket = agg[name]
        if result == "Win":
            bucket[0] += 1
        elif result == "Draw":
            bucket[1] += 1
        elif result == "Loss":
            bucket[2] += 1
    rates: list[float] = []
    for wins, draws, losses in agg.values():
        total = wins + draws + losses
        if total >= min_games:
            rates.append(round((wins / total) * 100, 1))
    return rates


def percentile_at(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return float(sorted_vals[0])
    rank = (p / 100.0) * (len(sorted_vals) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = rank - lo
    return round(
        sorted_vals[lo] * (1.0 - frac) + sorted_vals[hi] * frac, 1
    )


def win_rate_percentile_fields(rows: list[dict]) -> dict[str, float | None]:
    rates = sorted(player_win_rate_distribution(rows))
    if not rates:
        wins = sum(1 for r in rows if r.get("result") == "Win")
        n = len(rows)
        mean = round((wins / n) * 100, 1) if n else None
        return {
            "mean": mean,
            "p10": None,
            "p25": None,
            "p50": mean,
            "p75": None,
            "p90": None,
            "players_n": 0,
        }
    return {
        "mean": round(sum(rates) / len(rates), 1),
        "p10": percentile_at(rates, 10),
        "p25": percentile_at(rates, 25),
        "p50": percentile_at(rates, 50),
        "p75": percentile_at(rates, 75),
        "p90": percentile_at(rates, 90),
        "players_n": len(rates),
    }


def mean_est_seconds_per_game(rows: list[dict], speed: str) -> float | None:
    secs = SECONDS_PER_MOVE.get(str(speed).lower(), 8)
    values = []
    for row in rows:
        moves = row.get("move_count")
        try:
            n = int(moves or 0)
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            values.append(n * secs)
    if not values:
        return None
    return round(sum(values) / len(values), 1)


def days_in_source_month(source_month: str) -> int:
    match = re.search(r"(20\d{2})-(\d{2})", source_month or "")
    if not match:
        return 30
    year = int(match.group(1))
    month = int(match.group(2))
    if month < 1 or month > 12:
        return 30
    return calendar.monthrange(year, month)[1]


def should_sample_player_activity(
    username: str, sample_mod: int = PLAYER_ACTIVITY_SAMPLE_MOD
) -> bool:
    name = (username or "").strip()
    if not name:
        return False
    return zlib.crc32(name.encode("utf-8")) % sample_mod == 0


def row_est_seconds(row: dict, speed: str | None = None) -> float:
    spd = str(speed or row.get("speed") or "").lower()
    secs = SECONDS_PER_MOVE.get(spd, 8)
    try:
        moves = int(row.get("move_count") or 0)
    except (TypeError, ValueError):
        moves = 0
    if moves <= 0:
        return 0.0
    return float(moves * secs)


def accumulate_player_activity(
    by_user: dict[str, list[float]],
    row: dict,
    sample_mod: int = PLAYER_ACTIVITY_SAMPLE_MOD,
    hash_sample: bool = True,
) -> None:
    name = str(row.get("username") or "").strip()
    if not name:
        return
    if hash_sample and not should_sample_player_activity(name, sample_mod):
        return
    est = row_est_seconds(row)
    bucket = by_user.get(name)
    if bucket is None:
        by_user[name] = [1.0, est]
    else:
        bucket[0] += 1.0
        bucket[1] += est


def player_activity_from_rows(
    rows: list[dict],
    sample_mod: int = PLAYER_ACTIVITY_SAMPLE_MOD,
    hash_sample: bool = False,
) -> dict[str, list[float]]:
    by_user: dict[str, list[float]] = {}
    for row in rows:
        accumulate_player_activity(
            by_user, row, sample_mod=sample_mod, hash_sample=hash_sample
        )
    return by_user


def player_activity_metric_fields(
    by_user: dict[str, list[float]],
    source_month: str,
    min_games: int = ACTIVITY_MIN_GAMES,
) -> dict[str, object]:
    empty: dict[str, object] = {key: None for key in ACTIVITY_METRIC_KEYS}
    empty["players_n"] = 0
    if not by_user:
        return empty
    active = {
        name: vals
        for name, vals in by_user.items()
        if float(vals[0]) >= min_games
    }
    if not active:
        return empty
    games = [vals[0] for vals in active.values()]
    secs = [vals[1] for vals in active.values()]
    n = len(games)
    days = max(1, days_in_source_month(source_month))
    weeks = days / 7.0

    def dist(values: list[float], digits: int) -> dict[str, object]:
        ordered = sorted(float(v) for v in values)
        rounded = [round(v, digits) for v in ordered]
        return {
            "mean": round(sum(ordered) / len(ordered), digits),
            "p10": percentile_at(ordered, 10),
            "p25": percentile_at(ordered, 25),
            "p50": percentile_at(ordered, 50),
            "p75": percentile_at(ordered, 75),
            "p90": percentile_at(ordered, 90),
            "values": rounded,
        }

    games_week = [g / weeks for g in games]
    games_day = [g / days for g in games]
    secs_week = [s / weeks for s in secs]
    secs_day = [s / days for s in secs]
    return {
        "avg_games_per_player_month": dist(games, 2),
        "avg_games_per_player_week": dist(games_week, 2),
        "avg_games_per_player_day": dist(games_day, 3),
        "avg_est_seconds_per_player_month": dist(secs, 1),
        "avg_est_seconds_per_player_week": dist(secs_week, 1),
        "avg_est_seconds_per_player_day": dist(secs_day, 1),
        "players_n": n,
    }


def infer_user_band_speed(
    df: pd.DataFrame, speed_filter: str | None
) -> tuple[str | None, str | None]:
    if df is None or df.empty:
        return None, None
    work = df
    speed_col = "speed" if "speed" in work.columns else None
    if (
        speed_filter
        and speed_filter != "All"
        and speed_col is not None
    ):
        needle = speed_filter.lower()
        work = work[work[speed_col].astype(str).str.lower() == needle]
    if work.empty:
        work = df
    speed = None
    if speed_filter and speed_filter != "All":
        speed = speed_filter.lower()
    elif speed_col is not None and not work[speed_col].isna().all():
        mode = work[speed_col].astype(str).str.lower().mode()
        speed = str(mode.iloc[0]) if len(mode) else None
    band = None
    if "user_rating" in work.columns:
        ratings = pd.to_numeric(work["user_rating"], errors="coerce").dropna()
        if not ratings.empty:
            band = rating_band(float(ratings.median()))
    return band, speed


def format_delta(user_val: float | None, mean_val: float | None) -> str:
    if user_val is None or mean_val is None:
        return ""
    delta = user_val - mean_val
    sign = "+" if delta >= 0 else ""
    return f"{sign}{delta:.1f}"


def population_caption(
    baselines: pd.DataFrame | None,
    metric: str,
    band: str | None,
    speed: str | None,
    user_val: float | None,
    unit: str = "",
) -> str | None:
    hit = lookup_baseline(baselines, metric, band, speed)
    if not hit or hit.get("mean") is None:
        return None
    mean = hit["mean"]
    delta = format_delta(user_val, mean)
    month = hit.get("source_month") or "?"
    sample = hit.get("sample") or "pgn"
    parts = [
        f"Lichess peers {band} · {speed}: mean {mean}{unit}",
        f"n={hit['n']}",
    ]
    if user_val is not None and delta:
        parts.append(f"Δ {delta}{unit}")
    parts.append(f"{month} ({sample})")
    return " · ".join(parts)
