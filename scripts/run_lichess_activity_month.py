#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from baselines import (
    DEFAULT_BASELINE_PATH,
    PLAYER_ACTIVITY_SAMPLE_MOD,
    RATING_BANDS,
    SPEEDS,
    default_run_dir,
    lichess_month_url,
)

BUILD = ROOT / "scripts" / "build_lichess_activity_baselines.py"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fast full-month activity baselines (games/time per player "
            "month/week/day). Headers-only scan — no 10M cap, no advanced "
            "metrics. Pair with run_lichess_baselines_month.py for style/"
            "opening/eval baselines on a sample."
        )
    )
    parser.add_argument(
        "--month",
        required=True,
        help="Lichess dump month as YYYY-MM",
    )
    parser.add_argument(
        "--input",
        default=None,
        help="Local .pgn / .pgn.zst (default: database.lichess.org URL)",
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        default=None,
        help="Override run root",
    )
    parser.add_argument(
        "--max-games",
        type=int,
        default=None,
        help="Optional cap (default: entire dump)",
    )
    parser.add_argument(
        "--sample-mod",
        type=int,
        default=PLAYER_ACTIVITY_SAMPLE_MOD,
        help=f"Hash-sample 1/N players (default {PLAYER_ACTIVITY_SAMPLE_MOD})",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=2_000_000,
        help="Flush buckets every N games",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume incomplete activity scan",
    )
    parser.add_argument(
        "--merge-into",
        type=Path,
        default=None,
        help=(
            "Splice activity metrics into existing baselines parquet "
            f"(e.g. {DEFAULT_BASELINE_PATH})"
        ),
    )
    parser.add_argument(
        "--sync-mobile",
        action="store_true",
        help="After merge, sync mobile asset JSON",
    )
    args = parser.parse_args()

    month = args.month.strip()
    source = args.input or lichess_month_url(month)
    source_month = f"lichess_db_standard_rated_{month}"
    run_dir = args.run_dir or default_run_dir(source_month)

    bands = ", ".join(label for _, _, label in RATING_BANDS)
    speeds = ", ".join(SPEEDS)
    print(
        f"Full-month ACTIVITY baselines · {month}\n"
        f"  source: {source}\n"
        f"  run:    {run_dir}/activity\n"
        f"  bands:  {bands}\n"
        f"  speeds: {speeds}\n"
        f"  sample_mod={args.sample_mod} "
        f"max_games={args.max_games if args.max_games is not None else 'ALL'}",
        flush=True,
    )

    cmd = [
        sys.executable,
        str(BUILD),
        "--input",
        source,
        "--source-month",
        source_month,
        "--run-dir",
        str(run_dir),
        "--sample-mod",
        str(args.sample_mod),
        "--checkpoint-every",
        str(args.checkpoint_every),
    ]
    if args.max_games is not None:
        cmd.extend(["--max-games", str(args.max_games)])
    if args.resume:
        cmd.append("--resume")
    if args.merge_into is not None:
        cmd.extend(["--merge-into", str(args.merge_into)])
    if args.sync_mobile:
        cmd.append("--sync-mobile")

    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
