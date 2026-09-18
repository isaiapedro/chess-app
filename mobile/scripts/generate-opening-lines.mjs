import { Chess } from "chess.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = process.argv[2] || "/tmp/chess-openings";
const outPath = path.join(
  __dirname,
  "../src/engine/openingLines.generated.ts"
);

function normalizeOpeningName(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/defence/g, "defense")
    .replace(/pelikan/g, "pelican")
    .replace(/[’']/g, "'")
    .replace(/[,:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePgnMoves(pgn) {
  return String(pgn || "")
    .replace(/\d+\.(\.\.)?/g, " ")
    .replace(/[+#]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function epdFromFen(fen) {
  return fen.split(" ").slice(0, 4).join(" ");
}

const byName = new Map();
for (const file of ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"]) {
  const full = path.join(srcDir, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing ${full}`);
  }
  for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [eco, name, pgn] = line.split("\t");
    if (!eco || !name || !pgn) continue;
    const moves = parsePgnMoves(pgn);
    const chess = new Chess();
    let ok = true;
    const ucis = [];
    for (const san of moves) {
      let moved;
      try {
        moved = chess.move(san);
      } catch {
        moved = null;
      }
      if (!moved) {
        ok = false;
        break;
      }
      ucis.push(`${moved.from}${moved.to}${moved.promotion || ""}`);
    }
    if (!ok) continue;
    const key = normalizeOpeningName(name);
    const entry = {
      eco: eco.toUpperCase(),
      ply: moves.length,
      epd: epdFromFen(chess.fen()),
      uci: ucis.join(" "),
    };
    const prev = byName.get(key);
    if (!prev || entry.ply > prev.ply) byName.set(key, entry);
  }
}

const obj = Object.fromEntries(byName);
fs.writeFileSync(
  outPath,
  `/* generated from lichess-org/chess-openings — do not edit */
export type OpeningLineRef = {
  eco: string;
  ply: number;
  epd: string;
  uci: string;
};
export const OPENING_LINES_BY_NAME: Record<string, OpeningLineRef> = ${JSON.stringify(
    obj
  )};
`
);
console.log(
  `Wrote ${byName.size} openings → ${outPath} (${Math.round(
    fs.statSync(outPath).size / 1024
  )} KB)`
);
