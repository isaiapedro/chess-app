#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import random
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import chess.pgn
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from baselines import (
    ACTIVITY_METRIC_KEYS,
    DEFAULT_BASELINE_PATH,
    ENDGAME_EVAL_METRIC_KEYS,
    ENDGAME_PGN_METRIC_KEYS,
    EVAL_METRIC_KEYS,
    MIDDLEGAME_EVAL_METRIC_KEYS,
    MIDDLEGAME_PGN_METRIC_KEYS,
    OPENING_EVAL_METRIC_KEYS,
    OPENING_PGN_METRIC_KEYS,
    PGN_METRIC_KEYS,
    RATING_BANDS,
    SPEEDS,
    accumulate_player_activity,
    flatten_eval_cell_metrics,
    flatten_pgn_cell_metrics,
    mean_est_seconds_per_game,
    player_activity_from_rows,
    player_activity_metric_fields,
    rating_band,
    save_baselines,
    sync_mobile_baseline_asset,
    time_control_to_speed,
    win_rate_percentile_fields,
)
from endgame_phase_metrics import aggregate_endgame_metrics
from middlegame_phase_metrics import aggregate_middlegame_metrics
from opening_phase_metrics import aggregate_opening_metrics
from stats import (
    calculate_imbalance_mobility_stats,
    calculate_opening_mix_stats,
)
from style_metrics import (
    aggregate_style_metrics,
    analyze_peer_game_metrics,
    extract_evals_white_cp_from_pgn,
)

try:
    import zstandard as zstd
except ImportError as exc:
    raise SystemExit(
        "zstandard is required. Install with: pip install zstandard"
    ) from exc


PLAYER = "player"
OPPONENT = "opponent"


def _header(game: chess.pgn.Game, key: str, default: str = "") -> str:
    return str(game.headers.get(key, default) or default)


def _result_from_pov(result_tag: str, color: str) -> str:
    if result_tag == "1/2-1/2":
        return "Draw"
    if result_tag == "1-0":
        return "Win" if color == "white" else "Loss"
    if result_tag == "0-1":
        return "Win" if color == "black" else "Loss"
    return "Draw"


def _game_to_pgn_str(game: chess.pgn.Game) -> str:
    exporter = chess.pgn.StringExporter(
        headers=True, variations=False, comments=True
    )
    return game.accept(exporter)


def _opening_name(game: chess.pgn.Game) -> str:
    name = _header(game, "Opening")
    if name:
        return name
    eco = _header(game, "ECO")
    return eco if eco else "Unknown"


def player_game_rows(game: chess.pgn.Game, source_month: str) -> list[dict]:
    event = _header(game, "Event")
    rated_tag = _header(game, "Rated").lower()
    is_rated = "Rated" in event or rated_tag in ("true", "1", "yes")
    if not is_rated:
        return []

    variant = _header(game, "Variant", "Standard")
    if variant and variant.lower() not in ("", "standard", "chess"):
        return []

    tc = _header(game, "TimeControl")
    speed = time_control_to_speed(tc)
    if speed not in SPEEDS:
        return []

    try:
        white_elo = int(_header(game, "WhiteElo", "0") or 0)
        black_elo = int(_header(game, "BlackElo", "0") or 0)
    except ValueError:
        return []

    result_tag = _header(game, "Result")
    eco = _header(game, "ECO", "UNK") or "UNK"
    opening_name = _opening_name(game)
    pgn_str = _game_to_pgn_str(game)
    has_eval = extract_evals_white_cp_from_pgn(pgn_str) is not None
    game_id = _header(game, "Site") or _header(game, "UTCDate") or "unknown"
    white_name = _header(game, "White") or "White"
    black_name = _header(game, "Black") or "Black"
    try:
        move_count = sum(1 for _ in game.mainline_moves())
    except Exception:
        move_count = 0
    date_s = _header(game, "UTCDate") or _header(game, "Date") or "1970.01.01"
    time_s = _header(game, "UTCTime") or "00:00:00"
    try:
        created_at = datetime.strptime(
            f"{date_s} {time_s}", "%Y.%m.%d %H:%M:%S"
        )
    except ValueError:
        created_at = datetime(1970, 1, 1)

    rows = []
    for color, elo, name in (
        ("white", white_elo, white_name),
        ("black", black_elo, black_name),
    ):
        band = rating_band(elo)
        if band is None:
            continue
        rows.append(
            {
                "id": f"{game_id}:{color}",
                "created_at": created_at,
                "speed": speed,
                "user_color": color,
                "user_rating": elo,
                "opp_rating": black_elo if color == "white" else white_elo,
                "opponent_name": OPPONENT,
                "result": _result_from_pov(result_tag, color),
                "opening_name": opening_name,
                "opening_eco": eco,
                "move_count": move_count,
                "moves_str": "",
                "pgn_str": pgn_str,
                "time_control": tc,
                "termination": "Normal",
                "opp_termination": "Normal",
                "rating_band": band,
                "has_eval": has_eval,
                "source_month": source_month,
                "username": name or PLAYER,
            }
        )
    return rows


def open_pgn_stream(path_or_url: str):
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        resp = urllib.request.urlopen(path_or_url)
        if path_or_url.endswith(".zst"):
            dctx = zstd.ZstdDecompressor()
            return dctx.stream_reader(resp), True
        return resp, True
    path = Path(path_or_url)
    raw = path.open("rb")
    if path.suffix == ".zst" or str(path).endswith(".pgn.zst"):
        dctx = zstd.ZstdDecompressor()
        return dctx.stream_reader(raw), True
    return raw, True


def cells_full(pgn_counts: dict, pgn_quota: int) -> bool:
    for _, _, band_label in RATING_BANDS:
        for speed in SPEEDS:
            if pgn_counts[(band_label, speed)] < pgn_quota:
                return False
    return True


def reservoir_push(
    bucket: list[dict], seen: int, row: dict, quota: int
) -> int:
    seen += 1
    if len(bucket) < quota:
        bucket.append(row)
        return seen
    j = random.randrange(seen)
    if j < quota:
        bucket[j] = row
    return seen


def print_cell_coverage(
    pgn_buckets: dict[tuple[str, str], list[dict]],
    eval_buckets: dict[tuple[str, str], list[dict]],
    pgn_seen: dict[tuple[str, str], int],
    eval_seen: dict[tuple[str, str], int],
) -> None:
    print("Cell coverage (band × speed):", flush=True)
    for _, _, band in RATING_BANDS:
        for speed in SPEEDS:
            key = (band, speed)
            print(
                f"  {band:10} {speed:10} "
                f"pgn_kept={len(pgn_buckets.get(key, [])):5} "
                f"pgn_seen={pgn_seen.get(key, 0):7} "
                f"eval_kept={len(eval_buckets.get(key, [])):5} "
                f"eval_seen={eval_seen.get(key, 0):7}",
                flush=True,
            )


def sample_games(
    path_or_url: str,
    source_month: str,
    pgn_quota: int,
    eval_quota: int,
    max_games: int | None,
    full_month: bool = False,
    seed: int | None = 42,
) -> tuple[
    dict[tuple[str, str], list[dict]],
    dict[tuple[str, str], list[dict]],
    dict[tuple[str, str], dict[str, list[float]]],
]:
    if seed is not None:
        random.seed(seed)

    pgn_buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    eval_buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    pgn_seen: dict[tuple[str, str], int] = defaultdict(int)
    eval_seen: dict[tuple[str, str], int] = defaultdict(int)
    activity_buckets: dict[tuple[str, str], dict[str, list[float]]] = (
        defaultdict(dict)
    )

    stream, _ = open_pgn_stream(path_or_url)
    text = io.TextIOWrapper(stream, encoding="utf-8", errors="replace")
    games_seen = 0
    progress_every = 50000 if full_month else 5000
    try:
        while True:
            if max_games is not None and games_seen >= max_games:
                break
            if not full_month and cells_full(pgn_seen, pgn_quota):
                break
            game = chess.pgn.read_game(text)
            if game is None:
                break
            games_seen += 1
            if games_seen % progress_every == 0:
                filled_pgn = sum(
                    1
                    for _, _, band in RATING_BANDS
                    for speed in SPEEDS
                    if len(pgn_buckets[(band, speed)]) >= pgn_quota
                )
                filled_eval = sum(
                    1
                    for _, _, band in RATING_BANDS
                    for speed in SPEEDS
                    if len(eval_buckets[(band, speed)]) >= eval_quota
                )
                tracked = sum(len(v) for v in activity_buckets.values())
                print(
                    f"scanned={games_seen} "
                    f"pgn_cells_full={filled_pgn}/36 "
                    f"eval_cells_full={filled_eval}/36 "
                    f"activity_players={tracked} "
                    f"mode={'full-month' if full_month else 'early-fill'}",
                    flush=True,
                )

            for row in player_game_rows(game, source_month):
                key = (row["rating_band"], row["speed"])
                accumulate_player_activity(activity_buckets[key], row)
                if full_month:
                    pgn_seen[key] = reservoir_push(
                        pgn_buckets[key], pgn_seen[key], row, pgn_quota
                    )
                    if row["has_eval"]:
                        eval_seen[key] = reservoir_push(
                            eval_buckets[key],
                            eval_seen[key],
                            row,
                            eval_quota,
                        )
                else:
                    if pgn_seen[key] < pgn_quota:
                        pgn_buckets[key].append(row)
                        pgn_seen[key] += 1
                    if row["has_eval"] and eval_seen[key] < eval_quota:
                        eval_buckets[key].append(row)
                        eval_seen[key] += 1
    finally:
        text.close()

    print(
        f"Done sampling. games_seen={games_seen} "
        f"pgn_kept={sum(len(v) for v in pgn_buckets.values())} "
        f"eval_kept={sum(len(v) for v in eval_buckets.values())} "
        f"activity_players={sum(len(v) for v in activity_buckets.values())}",
        flush=True,
    )
    print_cell_coverage(pgn_buckets, eval_buckets, pgn_seen, eval_seen)
    return pgn_buckets, eval_buckets, activity_buckets


def _metrics_from_sample(
    rows: list[dict], with_evals: bool
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    opening_rows: list[dict] = []
    middlegame_rows: list[dict] = []
    endgame_rows: list[dict] = []
    style_rows: list[dict] = []
    for row in rows:
        evals = None
        if with_evals:
            evals = extract_evals_white_cp_from_pgn(str(row.get("pgn_str") or ""))
            if evals is None:
                continue
        bundle = analyze_peer_game_metrics(
            pd.Series(row), evals_white_cp=evals
        )
        if not bundle or not bundle.get("style"):
            continue
        opening = bundle.get("opening")
        middlegame = bundle.get("middlegame")
        endgame = bundle.get("endgame")
        style = bundle["style"]
        if opening:
            opening_rows.append(opening)
        if middlegame:
            middlegame_rows.append(middlegame)
        if endgame:
            endgame_rows.append(endgame)
        style_rows.append(style)
    return opening_rows, middlegame_rows, endgame_rows, style_rows


def build_baseline_rows(
    pgn_buckets: dict,
    eval_buckets: dict,
    source_month: str,
    activity_buckets: dict | None = None,
) -> pd.DataFrame:
    records = []
    activity_buckets = activity_buckets or {}
    keys = sorted(
        set(pgn_buckets) | set(eval_buckets) | set(activity_buckets)
    )
    for band, speed in keys:
        pgn_rows = pgn_buckets.get((band, speed), [])
        eval_rows = eval_buckets.get((band, speed), [])
        activity_users = activity_buckets.get((band, speed)) or {}
        if not activity_users and pgn_rows:
            activity_users = player_activity_from_rows(
                pgn_rows, hash_sample=False
            )
        print(
            f"metrics {band} {speed}: pgn={len(pgn_rows)} "
            f"eval={len(eval_rows)} activity_players={len(activity_users)}",
            flush=True,
        )
        if pgn_rows:
            pgn_df = pd.DataFrame(pgn_rows)
            mix = calculate_opening_mix_stats(pgn_df)
            texture = calculate_imbalance_mobility_stats(pgn_df)
            (
                opening_sample,
                middlegame_sample,
                endgame_sample,
                style_sample,
            ) = _metrics_from_sample(pgn_rows, with_evals=False)
            style_pgn = aggregate_style_metrics(style_sample)
            est_secs = mean_est_seconds_per_game(pgn_rows, speed)
            opening_pgn = aggregate_opening_metrics(opening_sample)
            middlegame_pgn = aggregate_middlegame_metrics(middlegame_sample)
            endgame_pgn = aggregate_endgame_metrics(endgame_sample)
            flat = flatten_pgn_cell_metrics(
                mix,
                texture,
                style_pgn,
                est_seconds_per_game=est_secs,
                opening=opening_pgn,
                middlegame=middlegame_pgn,
                endgame=endgame_pgn,
            )
            wr_dist = win_rate_percentile_fields(pgn_rows)
            if wr_dist.get("mean") is not None:
                flat["win_rate"] = wr_dist["mean"]
            activity = player_activity_metric_fields(
                activity_users, source_month
            )
            for key in ACTIVITY_METRIC_KEYS:
                dist = activity.get(key)
                if isinstance(dist, dict) and dist.get("mean") is not None:
                    flat[key] = dist["mean"]
            n = len(pgn_rows)
            for metric in PGN_METRIC_KEYS:
                val = flat.get(metric)
                if val is None:
                    continue
                row = {
                    "metric": metric,
                    "rating_band": band,
                    "speed": speed,
                    "mean": float(val),
                    "n": n,
                    "source_month": source_month,
                    "sample": "pgn",
                }
                if metric == "win_rate":
                    row["n"] = int(wr_dist.get("players_n") or n)
                    row["p10"] = wr_dist.get("p10")
                    row["p25"] = wr_dist.get("p25")
                    row["p50"] = wr_dist.get("p50")
                    row["p75"] = wr_dist.get("p75")
                    row["p90"] = wr_dist.get("p90")
                if metric in ACTIVITY_METRIC_KEYS:
                    dist = activity.get(metric)
                    row["n"] = int(activity.get("players_n") or 0)
                    row["sample"] = "activity"
                    if isinstance(dist, dict):
                        row["p10"] = dist.get("p10")
                        row["p25"] = dist.get("p25")
                        row["p50"] = dist.get("p50")
                        row["p75"] = dist.get("p75")
                        row["p90"] = dist.get("p90")
                if metric in OPENING_PGN_METRIC_KEYS:
                    if metric == "opening_castle_fullmove":
                        row["n"] = int(opening_pgn.get("castled_games") or 0)
                    else:
                        row["n"] = int(opening_pgn.get("games") or 0)
                    row["sample"] = "opening"
                if metric in MIDDLEGAME_PGN_METRIC_KEYS:
                    row["n"] = int(middlegame_pgn.get("middlegame_games") or 0)
                    row["sample"] = "middlegame"
                if metric in ENDGAME_PGN_METRIC_KEYS:
                    row["n"] = int(endgame_pgn.get("endgame_games") or 0)
                    row["sample"] = "endgame"
                records.append(row)
        elif activity_users:
            activity = player_activity_metric_fields(
                activity_users, source_month
            )
            for metric in ACTIVITY_METRIC_KEYS:
                dist = activity.get(metric)
                if not isinstance(dist, dict) or dist.get("mean") is None:
                    continue
                records.append(
                    {
                        "metric": metric,
                        "rating_band": band,
                        "speed": speed,
                        "mean": float(dist["mean"]),
                        "n": int(activity.get("players_n") or 0),
                        "source_month": source_month,
                        "sample": "activity",
                        "p10": dist.get("p10"),
                        "p25": dist.get("p25"),
                        "p50": dist.get("p50"),
                        "p75": dist.get("p75"),
                        "p90": dist.get("p90"),
                    }
                )
        if eval_rows:
            (
                opening_eval_rows,
                middlegame_eval_rows,
                endgame_eval_rows,
                style_eval_rows,
            ) = _metrics_from_sample(eval_rows, with_evals=True)
            style_eval = aggregate_style_metrics(style_eval_rows)
            opening_eval = aggregate_opening_metrics(opening_eval_rows)
            middlegame_eval = aggregate_middlegame_metrics(middlegame_eval_rows)
            endgame_eval = aggregate_endgame_metrics(endgame_eval_rows)
            flat_eval = flatten_eval_cell_metrics(
                style_eval,
                opening=opening_eval,
                middlegame=middlegame_eval,
                endgame=endgame_eval,
            )
            n_eval = int(style_eval.get("games") or 0)
            for metric in EVAL_METRIC_KEYS:
                val = flat_eval.get(metric)
                if val is None:
                    continue
                row = {
                    "metric": metric,
                    "rating_band": band,
                    "speed": speed,
                    "mean": float(val),
                    "n": n_eval,
                    "source_month": source_month,
                    "sample": "eval",
                }
                if metric in OPENING_EVAL_METRIC_KEYS:
                    row["n"] = int(opening_eval.get("accuracy_games") or 0)
                    row["sample"] = "opening_eval"
                if metric in MIDDLEGAME_EVAL_METRIC_KEYS:
                    row["n"] = int(
                        middlegame_eval.get("middlegame_accuracy_games")
                        or middlegame_eval.get("middlegame_games")
                        or 0
                    )
                    row["sample"] = "middlegame_eval"
                if metric in ENDGAME_EVAL_METRIC_KEYS:
                    row["n"] = int(endgame_eval.get("endgame_games") or 0)
                    row["sample"] = "endgame_eval"
                records.append(row)
    return pd.DataFrame.from_records(records)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Build Opening Mix population baselines from a Lichess "
            "monthly PGN dump (.pgn or .pgn.zst)."
        )
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Local path or URL to .pgn / .pgn.zst",
    )
    parser.add_argument(
        "--source-month",
        default=None,
        help="Label stored in artifact (default: inferred from filename)",
    )
    parser.add_argument("--pgn-quota", type=int, default=5000)
    parser.add_argument("--eval-quota", type=int, default=2000)
    parser.add_argument(
        "--full-month",
        action="store_true",
        help=(
            "Scan entire dump; reservoir-sample up to quotas per "
            "rating_band×speed cell (covers whole month, all cells)."
        ),
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="RNG seed for full-month reservoir sampling",
    )
    parser.add_argument(
        "--max-games",
        type=int,
        default=None,
        help="Stop after scanning this many games (debug)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_BASELINE_PATH,
        help="Output parquet path (JSON sidecar written alongside)",
    )
    parser.add_argument(
        "--sync-mobile",
        action="store_true",
        default=True,
        help="Also write JSON into mobile/assets/baselines/ (default on)",
    )
    parser.add_argument(
        "--no-sync-mobile",
        action="store_true",
        help="Skip copying JSON into the mobile app assets",
    )
    args = parser.parse_args()

    source_month = args.source_month
    if not source_month:
        name = Path(args.input.split("?")[0]).name
        source_month = name.replace(".pgn.zst", "").replace(".pgn", "")

    mode = "full-month reservoir" if args.full_month else "early-fill"
    print(
        f"Sampling from {args.input} "
        f"(mode={mode}, pgn_quota={args.pgn_quota}, "
        f"eval_quota={args.eval_quota})",
        flush=True,
    )
    print(
        "Grid: all rating bands × bullet/blitz/rapid/classical. "
        "Eval metrics use Lichess [%eval] games only.",
        flush=True,
    )

    pgn_buckets, eval_buckets, activity_buckets = sample_games(
        args.input,
        source_month,
        args.pgn_quota,
        args.eval_quota,
        args.max_games,
        full_month=args.full_month,
        seed=args.seed,
    )
    if not pgn_buckets and not eval_buckets and not activity_buckets:
        print("No games sampled.", file=sys.stderr)
        return 1

    df = build_baseline_rows(
        pgn_buckets,
        eval_buckets,
        source_month,
        activity_buckets=activity_buckets,
    )
    if df.empty:
        print("No metrics produced.", file=sys.stderr)
        return 1

    out = save_baselines(df, args.output)
    print(f"Wrote {len(df)} baseline rows → {out}", flush=True)
    print(f"JSON sidecar → {out.with_suffix('.json')}", flush=True)
    if args.sync_mobile and not args.no_sync_mobile:
        mobile_path = sync_mobile_baseline_asset(out.with_suffix(".json"))
        print(f"Mobile asset → {mobile_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
