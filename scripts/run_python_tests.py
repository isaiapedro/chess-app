"""Run the standalone Python metric checks with strict diagnostic handling.

The metric modules use python-chess's PGN parser, which writes malformed-PGN
diagnostics to stderr instead of raising in every case. Treat stderr as a test
failure so fixtures cannot silently pass after an illegal SAN or parse warning.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TEST_FILES = (
    "test_observability.py",
    "test_opening_phase_metrics.py",
    "test_endgame_phase_metrics.py",
    "test_baselines_activity.py",
)


def main() -> int:
    failed = False
    for filename in TEST_FILES:
        result = subprocess.run(
            [sys.executable, str(ROOT / filename)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.stdout:
            print(result.stdout, end="")
        if result.returncode:
            print(f"{filename}: exited with {result.returncode}", file=sys.stderr)
            failed = True
        if result.stderr.strip():
            print(f"{filename}: unexpected stderr:", file=sys.stderr)
            print(result.stderr, end="", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
