#!/usr/bin/env python3
from __future__ import annotations

"""
Fast full-month Lichess activity baselines (headers-only).

Scans every game in a monthly dump without SAN parse / PGN export /
style metrics. Uses chess.pgn.read_headers (skips movetext) and estimates
play time from TimeControl. Writes the six avg_games_* / avg_est_seconds_*
metrics per rating_band × speed.

Intended to run separately from build_lichess_baselines.py (advanced
metrics on a capped sample).
"""

import argparse
import io
import json
import os
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import chess.pgn
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from baselines import (
    ACTIVITY_METRIC_KEYS,
    DEFAULT_BASELINE_PATH,
    PLAYER_ACTIVITY_SAMPLE_MOD,
    RATING_BANDS,
    SPEEDS,
    activity_bucket_from_rows,
    activity_rows_from_bucket,
    cell_file_stem,
    default_run_dir,
    estimate_game_seconds_from_tc,
    parse_cell_stem,
    player_activity_metric_fields,
    rating_band,
    save_baselines,
    should_sample_player_activity,
    sync_mobile_baseline_asset,
    time_control_to_speed,
)

try:
    import zstandard as zstd
except ImportError as exc:
    raise SystemExit(
        "zstandard is required. Install with: pip install zstandard"
    ) from exc


META_VERSION = 1
DEFAULT_CHECKPOINT_EVERY = 2_000_000


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def activity_paths(run_dir: Path) -> dict[str, Path]:
    root = Path(run_dir) / "activity"
    return {
        "root": root,
        "meta": root / "meta.json",
        "buckets": root / "buckets",
        "baselines": root / "activity_baselines.parquet",
    }


def ensure_activity_dirs(run_dir: Path) -> dict[str, Path]:
    paths = activity_paths(run_dir)
    paths["buckets"].mkdir(parents=True, exist_ok=True)
    return paths


def atomic_write_json(path: Path, payload: object) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp, path)


def atomic_to_parquet(path: Path, df: pd.DataFrame) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    df.to_parquet(tmp, index=False)
    os.replace(tmp, path)


def open_pgn_stream(path_or_url: str):
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        resp = urllib.request.urlopen(path_or_url)
        if path_or_url.endswith(".zst"):
            dctx = zstd.ZstdDecompressor()
            return dctx.stream_reader(resp)
        return resp
    path = Path(path_or_url)
    raw = path.open("rb")
    if path.suffix == ".zst" or str(path).endswith(".pgn.zst"):
        dctx = zstd.ZstdDecompressor()
        return dctx.stream_reader(raw)
    return raw


def _header_get(headers: chess.pgn.Headers, key: str, default: str = "") -> str:
    return str(headers.get(key, default) or default)


def classify_activity_sides(
    headers: chess.pgn.Headers,
) -> list[tuple[tuple[str, str], str, str]] | None:
    event = _header_get(headers, "Event")
    rated_tag = _header_get(headers, "Rated").lower()
    is_rated = "Rated" in event or rated_tag in ("true", "1", "yes")
    if not is_rated:
        return None

    variant = _header_get(headers, "Variant", "Standard")
    if variant and variant.lower() not in ("", "standard", "chess"):
        return None

    tc = _header_get(headers, "TimeControl")
    speed = time_control_to_speed(tc)
    if speed not in SPEEDS:
        return None

    try:
        white_elo = int(_header_get(headers, "WhiteElo", "0") or 0)
        black_elo = int(_header_get(headers, "BlackElo", "0") or 0)
    except ValueError:
        return None

    sides: list[tuple[tuple[str, str], str, str]] = []
    for elo, name in (
        (white_elo, _header_get(headers, "White") or "White"),
        (black_elo, _header_get(headers, "Black") or "Black"),
    ):
        band = rating_band(elo)
        if band is None:
            continue
        sides.append(((band, speed), name, tc))
    return sides or None


def accumulate_header_activity(
    buckets: dict[tuple[str, str], dict[str, list[float]]],
    key: tuple[str, str],
    username: str,
    tc: str,
    sample_mod: int,
) -> None:
    name = (username or "").strip()
    if not name:
        return
    if sample_mod > 1 and not should_sample_player_activity(name, sample_mod):
        return
    est = estimate_game_seconds_from_tc(tc)
    cell = buckets[key]
    cur = cell.get(name)
    if cur is None:
        cell[name] = [1.0, est]
    else:
        cur[0] += 1.0
        cur[1] += est


def flush_activity_checkpoint(
    paths: dict[str, Path],
    *,
    source_month: str,
    games_seen: int,
    sample_mod: int,
    seed_note: str,
    buckets: dict[tuple[str, str], dict[str, list[float]]],
    complete: bool,
) -> None:
    for key, by_user in buckets.items():
        if not by_user:
            continue
        band, speed = key
        path = paths["buckets"] / f"{cell_file_stem(band, speed)}.parquet"
        rows = activity_rows_from_bucket(by_user)
        atomic_to_parquet(path, pd.DataFrame.from_records(rows))
    meta = {
        "version": META_VERSION,
        "source_month": source_month,
        "games_seen": games_seen,
        "sample_mod": sample_mod,
        "complete": complete,
        "saved_at": utc_now_iso(),
        "note": seed_note,
        "players": {
            f"{band}|{speed}": len(by_user)
            for (band, speed), by_user in buckets.items()
            if by_user
        },
    }
    atomic_write_json(paths["meta"], meta)
    size = sum(p.stat().st_size for p in paths["root"].rglob("*") if p.is_file())
    print(
        f"Activity checkpoint → {paths['root']} "
        f"({size / (1024 * 1024):.1f} MiB, games_seen={games_seen}, "
        f"complete={complete})",
        flush=True,
    )


def load_activity_checkpoint(
    paths: dict[str, Path],
) -> tuple[dict[tuple[str, str], dict[str, list[float]]], dict]:
    meta = json.loads(paths["meta"].read_text(encoding="utf-8"))
    if int(meta.get("version") or 0) != META_VERSION:
        raise SystemExit(
            f"Unsupported activity meta version: {meta.get('version')}"
        )
    buckets: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(dict)
    for path in sorted(paths["buckets"].glob("*.parquet")):
        band, speed = parse_cell_stem(path.stem)
        df = pd.read_parquet(path)
        buckets[(band, speed)] = activity_bucket_from_rows(
            df.to_dict(orient="records")
        )
    return buckets, meta


def build_activity_records(
    buckets: dict[tuple[str, str], dict[str, list[float]]],
    source_month: str,
) -> pd.DataFrame:
    records: list[dict] = []
    for band, speed in sorted(buckets):
        by_user = buckets[(band, speed)]
        if not by_user:
            continue
        fields = player_activity_metric_fields(by_user, source_month)
        for metric in ACTIVITY_METRIC_KEYS:
            dist = fields.get(metric)
            if not isinstance(dist, dict) or dist.get("mean") is None:
                continue
            records.append(
                {
                    "metric": metric,
                    "rating_band": band,
                    "speed": speed,
                    "mean": float(dist["mean"]),
                    "n": int(fields.get("players_n") or 0),
                    "source_month": source_month,
                    "sample": "activity",
                    "p10": dist.get("p10"),
                    "p25": dist.get("p25"),
                    "p50": dist.get("p50"),
                    "p75": dist.get("p75"),
                    "p90": dist.get("p90"),
                    "values": dist.get("values"),
                }
            )
    return pd.DataFrame.from_records(records)


def merge_activity_into_baselines(
    activity_df: pd.DataFrame, baseline_path: Path
) -> Path:
    baseline_path = Path(baseline_path)
    if baseline_path.exists():
        if baseline_path.suffix == ".json":
            existing = pd.read_json(baseline_path)
        else:
            existing = pd.read_parquet(baseline_path)
        keep = existing[~existing["metric"].isin(ACTIVITY_METRIC_KEYS)]
        combined = pd.concat([keep, activity_df], ignore_index=True)
    else:
        combined = activity_df
    return save_baselines(combined, baseline_path)


def scan_activity(
    path_or_url: str,
    source_month: str,
    *,
    max_games: int | None,
    sample_mod: int,
    paths: dict[str, Path],
    checkpoint_every: int,
    resume: bool,
) -> dict[tuple[str, str], dict[str, list[float]]]:
    buckets: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(dict)
    skip_until = 0
    if resume and paths["meta"].exists():
        buckets, meta = load_activity_checkpoint(paths)
        if meta.get("complete"):
            print(
                f"Activity scan already complete "
                f"(games_seen={meta.get('games_seen')})",
                flush=True,
            )
            return buckets
        skip_until = int(meta.get("games_seen") or 0)
        print(
            f"Resuming activity scan after games_seen={skip_until}",
            flush=True,
        )

    raw = open_pgn_stream(path_or_url)
    text = io.TextIOWrapper(raw, encoding="utf-8", errors="replace")
    games_seen = 0
    kept_sides = 0
    last_checkpoint = skip_until
    progress_every = 100_000

    try:
        while True:
            if max_games is not None and games_seen >= max_games:
                break
            headers = chess.pgn.read_headers(text)
            if headers is None:
                break
            games_seen += 1
            if games_seen <= skip_until:
                if games_seen % progress_every == 0:
                    print(
                        f"fast-forward scanned={games_seen}/{skip_until}",
                        flush=True,
                    )
                continue

            sides = classify_activity_sides(headers)
            if sides is not None:
                for key, name, tc in sides:
                    accumulate_header_activity(
                        buckets, key, name, tc, sample_mod
                    )
                    kept_sides += 1

            if games_seen % progress_every == 0:
                players = sum(len(v) for v in buckets.values())
                print(
                    f"scanned={games_seen} eligible_sides={kept_sides} "
                    f"activity_players={players} sample_mod={sample_mod}",
                    flush=True,
                )
                if (
                    checkpoint_every > 0
                    and games_seen - last_checkpoint >= checkpoint_every
                ):
                    flush_activity_checkpoint(
                        paths,
                        source_month=source_month,
                        games_seen=games_seen,
                        sample_mod=sample_mod,
                        seed_note="headers-only TC estimate",
                        buckets=buckets,
                        complete=False,
                    )
                    last_checkpoint = games_seen
    finally:
        text.close()

    players = sum(len(v) for v in buckets.values())
    print(
        f"Done activity scan. games_seen={games_seen} "
        f"activity_players={players} sample_mod={sample_mod}",
        flush=True,
    )
    flush_activity_checkpoint(
        paths,
        source_month=source_month,
        games_seen=games_seen,
        sample_mod=sample_mod,
        seed_note="headers-only TC estimate",
        buckets=buckets,
        complete=True,
    )
    return buckets


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fast full-month activity baselines from a Lichess dump "
            "(headers-only; no advanced metrics, no 10M default cap)."
        )
    )
    parser.add_argument("--input", required=True, help="Local .pgn / .pgn.zst")
    parser.add_argument(
        "--source-month",
        default=None,
        help="Label (default: inferred from filename)",
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        default=None,
        help="Run root (default: .cache/baselines/runs/<source_month>/)",
    )
    parser.add_argument(
        "--max-games",
        type=int,
        default=None,
        help="Optional cap (default: scan entire dump)",
    )
    parser.add_argument(
        "--sample-mod",
        type=int,
        default=PLAYER_ACTIVITY_SAMPLE_MOD,
        help=(
            "Hash-sample 1/N usernames for memory "
            f"(default {PLAYER_ACTIVITY_SAMPLE_MOD}; use 1 for all)"
        ),
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=DEFAULT_CHECKPOINT_EVERY,
        help="Flush activity buckets every N games (0=only at end)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume incomplete activity scan from run-dir",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Activity-only parquet path (default under run-dir/activity/)",
    )
    parser.add_argument(
        "--merge-into",
        type=Path,
        default=None,
        help=(
            "Replace activity metrics inside an existing baselines parquet "
            f"(default off; pass {DEFAULT_BASELINE_PATH.name} to splice)"
        ),
    )
    parser.add_argument(
        "--sync-mobile",
        action="store_true",
        help="After --merge-into, sync JSON into mobile/assets/baselines/",
    )
    args = parser.parse_args()

    source_month = args.source_month
    if not source_month:
        name = Path(args.input.split("?")[0]).name
        source_month = name.replace(".pgn.zst", "").replace(".pgn", "")

    run_dir = Path(args.run_dir) if args.run_dir else default_run_dir(source_month)
    paths = ensure_activity_dirs(run_dir)
    print(f"Activity run → {paths['root']}", flush=True)
    print(
        f"Scanning {args.input} (headers-only, max_games="
        f"{args.max_games if args.max_games is not None else 'ALL'}, "
        f"sample_mod={args.sample_mod})",
        flush=True,
    )

    buckets = scan_activity(
        args.input,
        source_month,
        max_games=args.max_games,
        sample_mod=max(1, args.sample_mod),
        paths=paths,
        checkpoint_every=args.checkpoint_every,
        resume=args.resume,
    )
    df = build_activity_records(buckets, source_month)
    if df.empty:
        print("No activity metrics produced.", file=sys.stderr)
        return 1

    out = Path(args.output) if args.output else paths["baselines"]
    save_baselines(df, out)
    print(f"Wrote {len(df)} activity rows → {out}", flush=True)
    print(f"JSON sidecar → {out.with_suffix('.json')}", flush=True)

    if args.merge_into is not None:
        merged = merge_activity_into_baselines(df, args.merge_into)
        print(f"Merged activity into → {merged}", flush=True)
        if args.sync_mobile:
            mobile = sync_mobile_baseline_asset(merged.with_suffix(".json"))
            print(f"Mobile asset → {mobile}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
