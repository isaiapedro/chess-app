#!/usr/bin/env python3
"""Download Eric Bentzen Alpha piece SVGs and emit TypeScript path data."""

from __future__ import annotations

import json
import pathlib
import re
import urllib.request

BASE = "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/alpha"
PIECES = [
    "wK", "wQ", "wR", "wB", "wN", "wP",
    "bK", "bQ", "bR", "bB", "bN", "bP",
]
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "mobile" / "src" / "components" / "pieces"


def parse_paths(svg: str) -> list[dict[str, str]]:
    paths = re.findall(r"<path\s+([^>]+?)\s*/?>", svg)
    parsed: list[dict[str, str]] = []
    for attrs in paths:
        fill_m = re.search(r'fill="([^"]+)"', attrs)
        d_m = re.search(r'\bd="([^"]+)"', attrs)
        if not d_m:
            continue
        parsed.append(
            {
                "d": d_m.group(1),
                "fill": fill_m.group(1) if fill_m else "#000000",
            }
        )
    return parsed


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pieces: dict[str, list[dict[str, str]]] = {}
    for name in PIECES:
        url = f"{BASE}/{name}.svg"
        with urllib.request.urlopen(url, timeout=30) as resp:
            svg = resp.read().decode("utf-8")
        pieces[name] = parse_paths(svg)
        print(f"{name}: {len(pieces[name])} paths")

    lines = [
        "export type AlphaPath = { d: string; fill: string };",
        "export type AlphaPieceKey =",
        '  | "wK" | "wQ" | "wR" | "wB" | "wN" | "wP"',
        '  | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";',
        "",
        'export const ALPHA_VIEWBOX = "0 0 2048 2048";',
        "",
        "export const ALPHA_PIECES: Record<AlphaPieceKey, AlphaPath[]> = {",
    ]
    for name in PIECES:
        lines.append(f"  {name}: [")
        for path in pieces[name]:
            lines.append(
                f"    {{ d: {json.dumps(path['d'])}, fill: {json.dumps(path['fill'])} }},"
            )
        lines.append("  ],")
    lines.append("};")
    lines.append("")
    (OUT_DIR / "alphaPieces.ts").write_text("\n".join(lines), encoding="utf-8")
    (OUT_DIR / "LICENSE.md").write_text(
        "# Alpha Chess Pieces\n\n"
        "Piece set: **Alpha** by Eric Bentzen.\n\n"
        "Source: [lichess-org/lila](https://github.com/lichess-org/lila) "
        "`public/piece/alpha`.\n\n"
        "License note from Lichess COPYING.md: "
        '"free for personal non commercial use" '
        "(see http://www.enpassant.dk/chess/downl/alpha.zip).\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT_DIR / 'alphaPieces.ts'}")


if __name__ == "__main__":
    main()
