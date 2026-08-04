#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import os
import random
import sys
import traceback
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
    activity_bucket_from_rows,
    activity_rows_from_bucket,
    cell_file_stem,
    default_run_dir,
    estimate_game_seconds_from_tc,
    flatten_eval_cell_metrics,
    flatten_pgn_cell_metrics,
    mean_est_seconds_per_game,
    parse_cell_stem,
    player_activity_from_rows,
    player_activity_metric_fields,
    rating_band,
    save_baselines,
    should_sample_player_activity,
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
MAX_GAMES_POPULATION = 10_000_000
DEFAULT_CHECKPOINT_EVERY = 500_000
META_VERSION = 2

SAMPLE_ROW_COLUMNS = [
    "id",
    "created_at",
    "speed",
    "user_color",
    "user_rating",
    "opp_rating",
    "opponent_name",
    "result",
    "opening_name",
    "opening_eco",
    "move_count",
    "moves_str",
    "pgn_str",
    "time_control",
    "termination",
    "opp_termination",
    "rating_band",
    "has_eval",
    "source_month",
    "username",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run_paths(run_dir: Path) -> dict[str, Path]:
    run_dir = Path(run_dir)
    return {
        "run": run_dir,
        "dump": run_dir / "01_dump",
        "samples": run_dir / "02_samples",
        "samples_pgn": run_dir / "02_samples" / "pgn",
        "samples_eval": run_dir / "02_samples" / "eval",
        "samples_activity": run_dir / "02_samples" / "activity",
        "samples_meta": run_dir / "02_samples" / "meta.json",
        "metrics": run_dir / "03_metrics",
        "metrics_cells": run_dir / "03_metrics" / "cells",
        "metrics_done": run_dir / "03_metrics" / "done.json",
        "baselines": run_dir / "04_baselines",
    }


def ensure_run_dirs(run_dir: Path) -> dict[str, Path]:
    paths = run_paths(run_dir)
    for key in (
        "dump",
        "samples_pgn",
        "samples_eval",
        "samples_activity",
        "metrics_cells",
        "baselines",
    ):
        paths[key].mkdir(parents=True, exist_ok=True)
    return paths


def atomic_write_text(path: Path, text: str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def atomic_write_json(path: Path, payload: object) -> None:
    atomic_write_text(path, json.dumps(payload, indent=2, sort_keys=True))


def atomic_to_parquet(path: Path, df: pd.DataFrame) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    df.to_parquet(tmp, index=False)
    os.replace(tmp, path)


def _header_get(headers: chess.pgn.Headers, key: str, default: str = "") -> str:
    return str(headers.get(key, default) or default)


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


def _opening_name(headers: chess.pgn.Headers) -> str:
    name = _header_get(headers, "Opening")
    if name:
        return name
    eco = _header_get(headers, "ECO")
    return eco if eco else "Unknown"


def _parse_created_at(headers: chess.pgn.Headers) -> datetime:
    date_s = _header_get(headers, "UTCDate") or _header_get(headers, "Date")
    date_s = date_s or "1970.01.01"
    time_s = _header_get(headers, "UTCTime") or "00:00:00"
    try:
        return datetime.strptime(f"{date_s} {time_s}", "%Y.%m.%d %H:%M:%S")
    except ValueError:
        return datetime(1970, 1, 1)


def classify_headers(
    headers: chess.pgn.Headers,
) -> dict | None:
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

    sides = []
    for color, elo, name in (
        ("white", white_elo, _header_get(headers, "White") or "White"),
        ("black", black_elo, _header_get(headers, "Black") or "Black"),
    ):
        band = rating_band(elo)
        if band is None:
            continue
        sides.append(
            {
                "color": color,
                "elo": elo,
                "name": name,
                "band": band,
                "key": (band, speed),
            }
        )
    if not sides:
        return None

    return {
        "speed": speed,
        "tc": tc,
        "white_elo": white_elo,
        "black_elo": black_elo,
        "result_tag": _header_get(headers, "Result"),
        "eco": _header_get(headers, "ECO", "UNK") or "UNK",
        "opening_name": _opening_name(headers),
        "game_id": (
            _header_get(headers, "Site")
            or _header_get(headers, "UTCDate")
            or "unknown"
        ),
        "created_at": _parse_created_at(headers),
        "sides": sides,
    }


def read_header_block(
    stream: io.TextIOBase,
) -> chess.pgn.Headers | None:
    headers = chess.pgn.Headers()
    found = False
    while True:
        pos = stream.tell() if stream.seekable() else None
        line = stream.readline()
        if not line:
            return headers if found else None
        if not found and (line.isspace() or line.startswith("%")):
            continue
        if line.startswith("["):
            found = True
            match = chess.pgn.TAG_REGEX.match(line)
            if match:
                headers[match.group(1)] = match.group(2)
            continue
        if found:
            if pos is not None and stream.seekable():
                stream.seek(pos)
            else:
                stream._unread_movetext_line = line  # type: ignore[attr-defined]
            return headers
        return None


def read_movetext_block(stream: io.TextIOBase) -> str:
    lines: list[str] = []
    unread = getattr(stream, "_unread_movetext_line", None)
    if unread is not None:
        stream._unread_movetext_line = None  # type: ignore[attr-defined]
        if unread and not unread.isspace():
            lines.append(unread)
    while True:
        line = stream.readline()
        if not line:
            break
        if line.isspace():
            if lines:
                break
            continue
        if line.startswith("%"):
            continue
        lines.append(line)
    return "".join(lines)


def headers_to_pgn_text(headers: chess.pgn.Headers, movetext: str) -> str:
    parts = [f'[{key} "{value}"]' for key, value in headers.items()]
    parts.append("")
    parts.append(movetext.strip())
    parts.append("")
    parts.append("")
    return "\n".join(parts)


def game_from_headers_movetext(
    headers: chess.pgn.Headers, movetext: str
) -> chess.pgn.Game | None:
    text = headers_to_pgn_text(headers, movetext)
    return chess.pgn.read_game(io.StringIO(text))


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


def reservoir_offer(seen: int, quota: int) -> tuple[int, bool, int | None]:
    seen += 1
    if seen <= quota:
        return seen, True, None
    j = random.randrange(seen)
    if j < quota:
        return seen, True, j
    return seen, False, None


def cells_full(pgn_counts: dict, pgn_quota: int) -> bool:
    for _, _, band_label in RATING_BANDS:
        for speed in SPEEDS:
            if pgn_counts[(band_label, speed)] < pgn_quota:
                return False
    return True


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


def rows_from_parsed_game(
    game: chess.pgn.Game,
    meta: dict,
    source_month: str,
    has_eval: bool,
) -> list[dict]:
    try:
        move_count = sum(1 for _ in game.mainline_moves())
    except Exception:
        move_count = 0
    pgn_str = _game_to_pgn_str(game)
    rows = []
    for side in meta["sides"]:
        color = side["color"]
        rows.append(
            {
                "id": f"{meta['game_id']}:{color}",
                "created_at": meta["created_at"],
                "speed": meta["speed"],
                "user_color": color,
                "user_rating": side["elo"],
                "opp_rating": (
                    meta["black_elo"] if color == "white" else meta["white_elo"]
                ),
                "opponent_name": OPPONENT,
                "result": _result_from_pov(meta["result_tag"], color),
                "opening_name": meta["opening_name"],
                "opening_eco": meta["eco"],
                "move_count": move_count,
                "moves_str": "",
                "pgn_str": pgn_str,
                "time_control": meta["tc"],
                "termination": "Normal",
                "opp_termination": "Normal",
                "rating_band": side["band"],
                "has_eval": has_eval,
                "source_month": source_month,
                "username": side["name"] or PLAYER,
            }
        )
    return rows


def accumulate_activity_header(
    activity_buckets: dict,
    meta: dict,
    side: dict,
) -> None:
    key = side["key"]
    est = estimate_game_seconds_from_tc(meta["tc"])
    name = str(side["name"] or "").strip()
    if not name:
        return
    if not should_sample_player_activity(name):
        return
    bucket = activity_buckets[key]
    cur = bucket.get(name)
    if cur is None:
        bucket[name] = [1.0, est]
    else:
        cur[0] += 1.0
        cur[1] += est


def write_dump_source(paths: dict[str, Path], input_path: str, source_month: str) -> None:
    info = {
        "input": input_path,
        "source_month": source_month,
        "saved_at": utc_now_iso(),
    }
    local = Path(input_path)
    if local.exists():
        st = local.stat()
        info["size_bytes"] = st.st_size
        info["mtime"] = datetime.fromtimestamp(
            st.st_mtime, timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
    atomic_write_json(paths["dump"] / "source.json", info)


def encode_counts(counts: dict[tuple[str, str], int]) -> dict[str, int]:
    return {f"{band}|{speed}": int(n) for (band, speed), n in counts.items()}


def decode_counts(payload: dict | None) -> dict[tuple[str, str], int]:
    out: dict[tuple[str, str], int] = defaultdict(int)
    for key, value in (payload or {}).items():
        band, speed = key.split("|", 1)
        out[(band, speed)] = int(value)
    return out


def sample_rows_to_frame(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=SAMPLE_ROW_COLUMNS)
    frame = pd.DataFrame.from_records(rows)
    for col in SAMPLE_ROW_COLUMNS:
        if col not in frame.columns:
            frame[col] = None
    if "created_at" in frame.columns:
        frame["created_at"] = pd.to_datetime(frame["created_at"])
    return frame[SAMPLE_ROW_COLUMNS]


def flush_sample_layers(
    paths: dict[str, Path],
    *,
    source_month: str,
    games_seen: int,
    pgn_quota: int,
    eval_quota: int,
    seed: int | None,
    full_month: bool,
    pgn_buckets: dict,
    eval_buckets: dict,
    pgn_seen: dict,
    eval_seen: dict,
    activity_buckets: dict,
    complete: bool,
) -> None:
    for key, rows in pgn_buckets.items():
        if not rows:
            continue
        band, speed = key
        path = paths["samples_pgn"] / f"{cell_file_stem(band, speed)}.parquet"
        atomic_to_parquet(path, sample_rows_to_frame(rows))
    for key, rows in eval_buckets.items():
        if not rows:
            continue
        band, speed = key
        path = paths["samples_eval"] / f"{cell_file_stem(band, speed)}.parquet"
        atomic_to_parquet(path, sample_rows_to_frame(rows))
    for key, by_user in activity_buckets.items():
        if not by_user:
            continue
        band, speed = key
        path = (
            paths["samples_activity"] / f"{cell_file_stem(band, speed)}.parquet"
        )
        act_rows = activity_rows_from_bucket(by_user)
        atomic_to_parquet(path, pd.DataFrame.from_records(act_rows))

    rng_state = random.getstate()
    meta = {
        "version": META_VERSION,
        "source_month": source_month,
        "games_seen": games_seen,
        "pgn_quota": pgn_quota,
        "eval_quota": eval_quota,
        "seed": seed,
        "full_month": full_month,
        "complete": complete,
        "saved_at": utc_now_iso(),
        "pgn_seen": encode_counts(pgn_seen),
        "eval_seen": encode_counts(eval_seen),
        "rng_state": list(rng_state[1]) if rng_state else None,
        "rng_version": rng_state[0] if rng_state else None,
        "rng_gauss": rng_state[2] if rng_state else None,
    }
    atomic_write_json(paths["samples_meta"], meta)
    size = sum(
        p.stat().st_size
        for p in paths["samples"].rglob("*")
        if p.is_file()
    )
    print(
        f"Sample checkpoint → {paths['samples']} "
        f"({size / (1024 * 1024):.1f} MiB, games_seen={games_seen}, "
        f"complete={complete})",
        flush=True,
    )


def load_sample_layers(paths: dict[str, Path]) -> dict:
    meta_path = paths["samples_meta"]
    if not meta_path.exists():
        raise SystemExit(f"Missing sample meta: {meta_path}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if int(meta.get("version") or 0) != META_VERSION:
        raise SystemExit(
            f"Unsupported sample meta version in {meta_path}: "
            f"{meta.get('version')}"
        )

    pgn_buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    eval_buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    activity_buckets: dict[tuple[str, str], dict[str, list[float]]] = (
        defaultdict(dict)
    )

    for path in sorted(paths["samples_pgn"].glob("*.parquet")):
        band, speed = parse_cell_stem(path.stem)
        df = pd.read_parquet(path)
        rows = df.to_dict(orient="records")
        for row in rows:
            if hasattr(row.get("created_at"), "to_pydatetime"):
                row["created_at"] = row["created_at"].to_pydatetime()
        pgn_buckets[(band, speed)] = rows

    for path in sorted(paths["samples_eval"].glob("*.parquet")):
        band, speed = parse_cell_stem(path.stem)
        df = pd.read_parquet(path)
        rows = df.to_dict(orient="records")
        for row in rows:
            if hasattr(row.get("created_at"), "to_pydatetime"):
                row["created_at"] = row["created_at"].to_pydatetime()
        eval_buckets[(band, speed)] = rows

    for path in sorted(paths["samples_activity"].glob("*.parquet")):
        band, speed = parse_cell_stem(path.stem)
        df = pd.read_parquet(path)
        activity_buckets[(band, speed)] = activity_bucket_from_rows(
            df.to_dict(orient="records")
        )

    rng_state = None
    if meta.get("rng_state") is not None:
        rng_state = (
            meta.get("rng_version") or 3,
            tuple(meta["rng_state"]),
            meta.get("rng_gauss"),
        )

    return {
        "source_month": meta["source_month"],
        "games_seen": int(meta.get("games_seen") or 0),
        "pgn_quota": int(meta["pgn_quota"]),
        "eval_quota": int(meta["eval_quota"]),
        "seed": meta.get("seed"),
        "full_month": bool(meta.get("full_month")),
        "complete": bool(meta.get("complete")),
        "pgn_buckets": pgn_buckets,
        "eval_buckets": eval_buckets,
        "activity_buckets": activity_buckets,
        "pgn_seen": decode_counts(meta.get("pgn_seen")),
        "eval_seen": decode_counts(meta.get("eval_seen")),
        "rng_state": rng_state,
    }


def load_metrics_done(paths: dict[str, Path]) -> set[tuple[str, str]]:
    path = paths["metrics_done"]
    if not path.exists():
        return set()
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = set()
    for item in raw:
        band, speed = item.split("|", 1)
        out.add((band, speed))
    return out


def save_metrics_done(paths: dict[str, Path], done: set[tuple[str, str]]) -> None:
    payload = sorted(f"{band}|{speed}" for band, speed in done)
    atomic_write_json(paths["metrics_done"], payload)


def load_all_metric_cells(paths: dict[str, Path]) -> pd.DataFrame:
    frames = []
    for path in sorted(paths["metrics_cells"].glob("*.parquet")):
        frames.append(pd.read_parquet(path))
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def sample_games(
    path_or_url: str,
    source_month: str,
    pgn_quota: int,
    eval_quota: int,
    max_games: int | None,
    full_month: bool = False,
    seed: int | None = 42,
    paths: dict[str, Path] | None = None,
    checkpoint_every: int = DEFAULT_CHECKPOINT_EVERY,
    resume_state: dict | None = None,
) -> tuple[
    dict[tuple[str, str], list[dict]],
    dict[tuple[str, str], list[dict]],
    dict[tuple[str, str], dict[str, list[float]]],
]:
    if resume_state is not None:
        pgn_buckets = resume_state["pgn_buckets"]
        eval_buckets = resume_state["eval_buckets"]
        pgn_seen = resume_state["pgn_seen"]
        eval_seen = resume_state["eval_seen"]
        activity_buckets = resume_state["activity_buckets"]
        skip_until = int(resume_state["games_seen"])
        if resume_state.get("rng_state") is not None:
            random.setstate(resume_state["rng_state"])
        elif seed is not None:
            random.seed(seed)
        print(
            f"Resuming sampling after games_seen={skip_until} "
            f"(fast-forward dump, then continue)",
            flush=True,
        )
    else:
        if seed is not None:
            random.seed(seed)
        pgn_buckets = defaultdict(list)
        eval_buckets = defaultdict(list)
        pgn_seen = defaultdict(int)
        eval_seen = defaultdict(int)
        activity_buckets = defaultdict(dict)
        skip_until = 0

    stream, _ = open_pgn_stream(path_or_url)
    text = io.TextIOWrapper(stream, encoding="utf-8", errors="replace")
    games_seen = 0
    progress_every = 50000 if full_month else 5000
    last_checkpoint_at = skip_until
    parsed_kept = 0
    skipped_lottery = 0

    def maybe_checkpoint(force: bool = False) -> None:
        nonlocal last_checkpoint_at
        if paths is None:
            return
        if not force and (
            checkpoint_every <= 0
            or games_seen - last_checkpoint_at < checkpoint_every
        ):
            return
        flush_sample_layers(
            paths,
            source_month=source_month,
            games_seen=games_seen,
            pgn_quota=pgn_quota,
            eval_quota=eval_quota,
            seed=seed,
            full_month=full_month,
            pgn_buckets=pgn_buckets,
            eval_buckets=eval_buckets,
            pgn_seen=pgn_seen,
            eval_seen=eval_seen,
            activity_buckets=activity_buckets,
            complete=False,
        )
        last_checkpoint_at = games_seen

    try:
        while True:
            if max_games is not None and games_seen >= max_games:
                break
            if not full_month and cells_full(pgn_seen, pgn_quota):
                break

            headers = read_header_block(text)
            if headers is None:
                break
            movetext = read_movetext_block(text)
            games_seen += 1

            if games_seen <= skip_until:
                if games_seen % progress_every == 0:
                    print(
                        f"fast-forward scanned={games_seen}/{skip_until}",
                        flush=True,
                    )
                continue

            if games_seen % progress_every == 0:
                filled_pgn = sum(
                    1
                    for _, _, band in RATING_BANDS
                    for speed in SPEEDS
                    if len(pgn_buckets.get((band, speed), [])) >= pgn_quota
                )
                filled_eval = sum(
                    1
                    for _, _, band in RATING_BANDS
                    for speed in SPEEDS
                    if len(eval_buckets.get((band, speed), [])) >= eval_quota
                )
                tracked = sum(len(v) for v in activity_buckets.values())
                print(
                    f"scanned={games_seen} "
                    f"pgn_cells_full={filled_pgn}/36 "
                    f"eval_cells_full={filled_eval}/36 "
                    f"activity_players={tracked} "
                    f"parsed_kept={parsed_kept} "
                    f"lottery_skip={skipped_lottery} "
                    f"mode={'full-month' if full_month else 'early-fill'}",
                    flush=True,
                )
                maybe_checkpoint()

            meta = classify_headers(headers)
            if meta is None:
                continue

            has_eval = "%eval" in movetext
            for side in meta["sides"]:
                accumulate_activity_header(activity_buckets, meta, side)

            pgn_wins: list[tuple[dict, int | None]] = []
            eval_wins: list[tuple[dict, int | None]] = []
            for side in meta["sides"]:
                key = side["key"]
                if full_month:
                    pgn_seen[key], pgn_keep, pgn_idx = reservoir_offer(
                        pgn_seen[key], pgn_quota
                    )
                    if pgn_keep:
                        pgn_wins.append((side, pgn_idx))
                    if has_eval:
                        eval_seen[key], eval_keep, eval_idx = reservoir_offer(
                            eval_seen[key], eval_quota
                        )
                        if eval_keep:
                            eval_wins.append((side, eval_idx))
                else:
                    if pgn_seen[key] < pgn_quota:
                        pgn_seen[key] += 1
                        pgn_wins.append((side, None))
                    if has_eval and eval_seen[key] < eval_quota:
                        eval_seen[key] += 1
                        eval_wins.append((side, None))

            if not pgn_wins and not eval_wins:
                skipped_lottery += 1
                continue

            game = game_from_headers_movetext(headers, movetext)
            if game is None:
                continue
            parsed_kept += 1
            rows = rows_from_parsed_game(
                game, meta, source_month, has_eval=has_eval
            )
            row_by_color = {row["user_color"]: row for row in rows}

            for side, replace_idx in pgn_wins:
                row = row_by_color.get(side["color"])
                if row is None:
                    continue
                key = side["key"]
                bucket = pgn_buckets[key]
                if replace_idx is None:
                    bucket.append(row)
                else:
                    bucket[replace_idx] = row

            for side, replace_idx in eval_wins:
                row = row_by_color.get(side["color"])
                if row is None:
                    continue
                key = side["key"]
                bucket = eval_buckets[key]
                if replace_idx is None:
                    bucket.append(row)
                else:
                    bucket[replace_idx] = row
    finally:
        text.close()

    print(
        f"Done sampling. games_seen={games_seen} "
        f"pgn_kept={sum(len(v) for v in pgn_buckets.values())} "
        f"eval_kept={sum(len(v) for v in eval_buckets.values())} "
        f"activity_players={sum(len(v) for v in activity_buckets.values())} "
        f"parsed_kept={parsed_kept} lottery_skip={skipped_lottery}",
        flush=True,
    )
    print_cell_coverage(pgn_buckets, eval_buckets, pgn_seen, eval_seen)
    if paths is not None:
        flush_sample_layers(
            paths,
            source_month=source_month,
            games_seen=games_seen,
            pgn_quota=pgn_quota,
            eval_quota=eval_quota,
            seed=seed,
            full_month=full_month,
            pgn_buckets=pgn_buckets,
            eval_buckets=eval_buckets,
            pgn_seen=pgn_seen,
            eval_seen=eval_seen,
            activity_buckets=activity_buckets,
            complete=True,
        )
    return pgn_buckets, eval_buckets, activity_buckets


def _metrics_from_sample(
    rows: list[dict], with_evals: bool
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    opening_rows: list[dict] = []
    middlegame_rows: list[dict] = []
    endgame_rows: list[dict] = []
    style_rows: list[dict] = []
    errors = 0
    for idx, row in enumerate(rows):
        try:
            evals = None
            if with_evals:
                evals = extract_evals_white_cp_from_pgn(
                    str(row.get("pgn_str") or "")
                )
                if evals is None:
                    continue
            bundle = analyze_peer_game_metrics(
                pd.Series(row), evals_white_cp=evals
            )
        except Exception as exc:
            errors += 1
            if errors <= 5:
                print(
                    f"  warn: metrics skip game "
                    f"{row.get('id', idx)}: {type(exc).__name__}: {exc}",
                    flush=True,
                )
                if errors == 5:
                    print(
                        "  warn: further per-game errors suppressed",
                        flush=True,
                    )
            continue
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
    if errors:
        print(
            f"  skipped {errors}/{len(rows)} games due to metric errors",
            flush=True,
        )
    return opening_rows, middlegame_rows, endgame_rows, style_rows


def build_cell_metric_records(
    band: str,
    speed: str,
    pgn_rows: list[dict],
    eval_rows: list[dict],
    activity_users: dict[str, list[float]],
    source_month: str,
) -> list[dict]:
    cell_records: list[dict] = []
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
        activity = player_activity_metric_fields(activity_users, source_month)
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
            cell_records.append(row)
    elif activity_users:
        activity = player_activity_metric_fields(activity_users, source_month)
        for metric in ACTIVITY_METRIC_KEYS:
            dist = activity.get(metric)
            if not isinstance(dist, dict) or dist.get("mean") is None:
                continue
            cell_records.append(
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
            cell_records.append(row)
    return cell_records


def build_baseline_rows(
    pgn_buckets: dict,
    eval_buckets: dict,
    source_month: str,
    activity_buckets: dict | None = None,
    paths: dict[str, Path] | None = None,
) -> pd.DataFrame:
    activity_buckets = activity_buckets or {}
    keys = sorted(
        set(pgn_buckets) | set(eval_buckets) | set(activity_buckets)
    )
    done = load_metrics_done(paths) if paths is not None else set()
    if done:
        print(
            f"Resuming metrics: {len(done)} cells already done "
            f"→ {paths['metrics_done']}",
            flush=True,
        )

    for band, speed in keys:
        if (band, speed) in done:
            print(f"metrics {band} {speed}: skip (checkpoint)", flush=True)
            continue
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
        try:
            cell_records = build_cell_metric_records(
                band,
                speed,
                pgn_rows,
                eval_rows,
                activity_users,
                source_month,
            )
        except Exception:
            print(
                f"ERROR metrics {band} {speed} — other cells kept, "
                f"re-run to resume:\n{traceback.format_exc()}",
                flush=True,
            )
            raise

        if paths is not None:
            cell_path = (
                paths["metrics_cells"]
                / f"{cell_file_stem(band, speed)}.parquet"
            )
            atomic_to_parquet(
                cell_path, pd.DataFrame.from_records(cell_records)
            )
            done.add((band, speed))
            save_metrics_done(paths, done)
            print(
                f"  metrics checkpoint → {cell_path} "
                f"({len(cell_records)} rows)",
                flush=True,
            )

    if paths is not None:
        return load_all_metric_cells(paths)
    records = []
    for band, speed in keys:
        records.extend(
            build_cell_metric_records(
                band,
                speed,
                pgn_buckets.get((band, speed), []),
                eval_buckets.get((band, speed), []),
                activity_buckets.get((band, speed)) or {},
                source_month,
            )
        )
    return pd.DataFrame.from_records(records)


def export_baselines(
    paths: dict[str, Path],
    output: Path,
    sync_mobile: bool,
) -> int:
    df = load_all_metric_cells(paths)
    if df.empty:
        print("No metrics cells to export.", file=sys.stderr)
        return 1
    out_run = paths["baselines"] / output.name
    save_baselines(df, out_run)
    out = save_baselines(df, output)
    print(f"Wrote {len(df)} baseline rows → {out}", flush=True)
    print(f"JSON sidecar → {out.with_suffix('.json')}", flush=True)
    print(f"Run copy → {out_run}", flush=True)
    if sync_mobile:
        mobile_path = sync_mobile_baseline_asset(out.with_suffix(".json"))
        print(f"Mobile asset → {mobile_path}", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Build Opening Mix population baselines from a Lichess "
            "monthly PGN dump (.pgn or .pgn.zst) with layered checkpoints."
        )
    )
    parser.add_argument(
        "--input",
        default=None,
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
            "rating_band×speed cell"
        ),
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--max-games",
        type=int,
        default=MAX_GAMES_POPULATION,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_BASELINE_PATH,
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        default=None,
        help="Run root (default: .cache/baselines/runs/<source_month>/)",
    )
    parser.add_argument(
        "--phase",
        choices=("all", "sample", "metrics", "export"),
        default="all",
        help="Pipeline phase to run",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume incomplete sample/metrics from --run-dir",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=DEFAULT_CHECKPOINT_EVERY,
        help="Flush sample layers every N games (0=only at end)",
    )
    parser.add_argument("--sync-mobile", action="store_true", default=True)
    parser.add_argument("--no-sync-mobile", action="store_true")
    args = parser.parse_args()

    source_month = args.source_month
    if not source_month:
        if args.input:
            name = Path(args.input.split("?")[0]).name
            source_month = name.replace(".pgn.zst", "").replace(".pgn", "")
        elif args.run_dir:
            source_month = Path(args.run_dir).name
        else:
            parser.error("Need --source-month, --input, or --run-dir")

    run_dir = Path(args.run_dir) if args.run_dir else default_run_dir(source_month)
    paths = ensure_run_dirs(run_dir)
    print(f"Run dir → {run_dir}", flush=True)

    sync_mobile = args.sync_mobile and not args.no_sync_mobile
    phase = args.phase

    if phase in ("all", "sample"):
        resume_state = None
        skip_sample = False
        if args.resume and paths["samples_meta"].exists():
            loaded = load_sample_layers(paths)
            if loaded["complete"]:
                print(
                    f"Sample layer already complete "
                    f"(games_seen={loaded['games_seen']})",
                    flush=True,
                )
                if phase == "sample":
                    return 0
                skip_sample = True
            else:
                resume_state = loaded
        if not skip_sample:
            if not args.input:
                parser.error("--input required for sample phase")
            write_dump_source(paths, args.input, source_month)
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
            sample_games(
                args.input,
                source_month,
                args.pgn_quota,
                args.eval_quota,
                args.max_games,
                full_month=args.full_month,
                seed=args.seed,
                paths=paths,
                checkpoint_every=args.checkpoint_every,
                resume_state=resume_state,
            )
        if phase == "sample":
            return 0

    if phase in ("all", "metrics"):
        state = load_sample_layers(paths)
        source_month = state["source_month"]
        print(
            f"Computing metrics from {paths['samples']} "
            f"(games_seen={state['games_seen']}, complete={state['complete']})",
            flush=True,
        )
        df = build_baseline_rows(
            state["pgn_buckets"],
            state["eval_buckets"],
            source_month,
            activity_buckets=state["activity_buckets"],
            paths=paths,
        )
        if df.empty:
            print("No metrics produced.", file=sys.stderr)
            return 1
        if phase == "metrics":
            print(
                f"Metrics layer ready → {paths['metrics']} ({len(df)} rows)",
                flush=True,
            )
            return 0

    if phase in ("all", "export"):
        return export_baselines(paths, args.output, sync_mobile)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
