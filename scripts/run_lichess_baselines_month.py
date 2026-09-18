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
    RATING_BANDS,
    SPEEDS,
    default_run_dir,
    lichess_month_url,
)

BUILD = ROOT / "scripts" / "build_lichess_baselines.py"
MAX_GAMES_POPULATION = 10_000_000


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Build population baselines for one full Lichess month across "
            "all rating bands and time formats. Writes layered checkpoints "
            "under .cache/baselines/runs/<month>/ then final "
            "opening_mix_lichess_v1.{{parquet,json}}."
        )
    )
    parser.add_argument(
        "--month",
        required=True,
        help="Lichess dump month as YYYY-MM (e.g. 2024-12)",
    )
    parser.add_argument(
        "--input",
        default=None,
        help="Local .pgn / .pgn.zst path (skips download URL)",
    )
    parser.add_argument(
        "--pgn-quota",
        type=int,
        default=20000,
        help="Reservoir size per rating_band×speed for PGN metrics",
    )
    parser.add_argument(
        "--eval-quota",
        type=int,
        default=8000,
        help="Reservoir size per cell for [%%eval] metrics",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Reservoir RNG seed",
    )
    parser.add_argument(
        "--max-games",
        type=int,
        default=MAX_GAMES_POPULATION,
        help=(
            "Stop after N games "
            f"(default {MAX_GAMES_POPULATION} for population analysis)"
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_BASELINE_PATH,
        help="Output parquet path under .cache/baselines/",
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        default=None,
        help="Override run root (default: .cache/baselines/runs/<source_month>/)",
    )
    parser.add_argument(
        "--phase",
        choices=("all", "sample", "metrics", "export"),
        default="all",
        help="Pipeline phase (default all)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume incomplete sample/metrics from run dir",
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=500_000,
        help="Flush sample layers every N games (0=only at end)",
    )
    parser.add_argument(
        "--no-sync-mobile",
        action="store_true",
        help="Do not copy JSON into mobile/assets/baselines/",
    )
    args = parser.parse_args()

    month = args.month.strip()
    source = args.input or lichess_month_url(month)
    source_month = f"lichess_db_standard_rated_{month}"
    run_dir = args.run_dir or default_run_dir(source_month)

    bands = ", ".join(label for _, _, label in RATING_BANDS)
    speeds = ", ".join(SPEEDS)
    print(
        f"Full-month baselines · {month}\n"
        f"  source: {source}\n"
        f"  run:    {run_dir}\n"
        f"  phase:  {args.phase}"
        f"{' (resume)' if args.resume else ''}\n"
        f"  bands:  {bands}\n"
        f"  speeds: {speeds}\n"
        f"  pgn_quota={args.pgn_quota} eval_quota={args.eval_quota}\n"
        f"  output: {args.output}",
        flush=True,
    )

    cmd = [
        sys.executable,
        str(BUILD),
        "--input",
        source,
        "--source-month",
        source_month,
        "--full-month",
        "--pgn-quota",
        str(args.pgn_quota),
        "--eval-quota",
        str(args.eval_quota),
        "--seed",
        str(args.seed),
        "--output",
        str(args.output),
        "--run-dir",
        str(run_dir),
        "--phase",
        args.phase,
        "--checkpoint-every",
        str(args.checkpoint_every),
    ]
    if args.resume:
        cmd.append("--resume")
    if args.max_games is not None:
        cmd.extend(["--max-games", str(args.max_games)])
    if args.no_sync_mobile:
        cmd.append("--no-sync-mobile")

    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
