import { Chess, type Color, type Square } from "chess.js";
import { HEURISTICS_DOUBLED_PERSIST_PLIES } from "../analysisConfig";
import { resolveEcoFamily } from "../ecoFamilies";
import {
  hasDoubledPawns,
  hasIsolatedQueenPawn,
} from "../middlegamePhase";

const FILES = "abcdefgh";

/** Themes that must persist across plies (same idea as doubled-pawn metrics). */
const PERSIST_STRUCTURE = new Set([
  "iqp",
  "doubled_pawns",
  "hanging_pawns",
  "passed_pawn",
]);

function filePawnCounts(board: Chess, file: number): { w: number; b: number } {
  let w = 0;
  let b = 0;
  for (let r = 0; r < 8; r++) {
    const sq = `${FILES[file]}${r + 1}` as Square;
    const p = board.get(sq);
    if (!p || p.type !== "p") continue;
    if (p.color === "w") w++;
    else b++;
  }
  return { w, b };
}

function hasMajorOnFile(board: Chess, file: number, color: "w" | "b"): boolean {
  for (let r = 0; r < 8; r++) {
    const sq = `${FILES[file]}${r + 1}` as Square;
    const p = board.get(sq);
    if (p && p.color === color && (p.type === "r" || p.type === "q")) return true;
  }
  return false;
}

function countBishops(board: Chess, color: "w" | "b"): number {
  let n = 0;
  const rows = board.board();
  for (const row of rows) {
    for (const p of row) {
      if (p && p.color === color && p.type === "b") n++;
    }
  }
  return n;
}

function hangingCd(board: Chess, color: "w" | "b"): boolean {
  const b = filePawnCounts(board, 1);
  const c = filePawnCounts(board, 2);
  const d = filePawnCounts(board, 3);
  const e = filePawnCounts(board, 4);
  const own = (x: { w: number; b: number }) => (color === "w" ? x.w : x.b);
  return (
    own(c) >= 1 &&
    own(d) >= 1 &&
    own(b) === 0 &&
    own(e) === 0
  );
}

function passedPawnPresent(board: Chess): boolean {
  for (let f = 0; f < 8; f++) {
    for (const color of ["w", "b"] as const) {
      for (let r = 0; r < 8; r++) {
        const sq = `${FILES[f]}${r + 1}` as Square;
        const p = board.get(sq);
        if (!p || p.type !== "p" || p.color !== color) continue;
        const ahead =
          color === "w"
            ? Array.from({ length: 7 - r }, (_, i) => r + 2 + i)
            : Array.from({ length: r }, (_, i) => r - i);
        let blocked = false;
        for (const rank of ahead) {
          for (const df of [-1, 0, 1]) {
            const ff = f + df;
            if (ff < 0 || ff > 7) continue;
            const s2 = `${FILES[ff]}${rank}` as Square;
            const q = board.get(s2);
            if (q?.type === "p" && q.color !== color) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (!blocked) return true;
      }
    }
  }
  return false;
}

/**
 * Instant board scan (may flicker). Prefer StructureThemeTracker for notes.
 */
export function detectStructureThemes(fen: string): string[] {
  const themes: string[] = [];
  try {
    const board = new Chess(fen);
    const colors: Color[] = ["w", "b"];
    if (colors.some((c) => hasIsolatedQueenPawn(board, c))) {
      themes.push("iqp");
    }
    if (colors.some((c) => hasDoubledPawns(board, c))) {
      themes.push("doubled_pawns");
    }
    if (hangingCd(board, "w") || hangingCd(board, "b")) {
      themes.push("hanging_pawns");
    }
    for (let f = 0; f < 8; f++) {
      const { w, b } = filePawnCounts(board, f);
      if (w === 0 && b === 0) {
        if (hasMajorOnFile(board, f, "w") || hasMajorOnFile(board, f, "b")) {
          themes.push(f === 2 ? "open_c_file" : "open_file");
          break;
        }
      }
    }
    const wb = countBishops(board, "w");
    const bb = countBishops(board, "b");
    if ((wb >= 2 && bb < 2) || (bb >= 2 && wb < 2)) {
      themes.push("bishop_pair");
    }
    if (passedPawnPresent(board)) {
      themes.push("passed_pawn");
    }
    let wAdv = 0;
    let bAdv = 0;
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const sq = `${FILES[f]}${r + 1}` as Square;
        const p = board.get(sq);
        if (!p || p.type !== "p") continue;
        if (p.color === "w" && r >= 4) wAdv++;
        if (p.color === "b" && r <= 3) bAdv++;
      }
    }
    if (Math.abs(wAdv - bAdv) >= 3) themes.push("space");
  } catch {
    /* ignore */
  }
  return themes;
}

/**
 * Only emit iqp / doubled / hanging / passer after they persist
 * for HEURISTICS_DOUBLED_PERSIST_PLIES consecutive positions.
 */
export class StructureThemeTracker {
  private streaks = new Map<string, number>();

  update(fen: string): string[] {
    const raw = detectStructureThemes(fen);
    const rawSet = new Set(raw);
    const out: string[] = [];

    for (const theme of PERSIST_STRUCTURE) {
      if (rawSet.has(theme)) {
        const n = (this.streaks.get(theme) || 0) + 1;
        this.streaks.set(theme, n);
        if (n >= HEURISTICS_DOUBLED_PERSIST_PLIES) out.push(theme);
      } else {
        this.streaks.set(theme, 0);
      }
    }

    for (const t of raw) {
      if (!PERSIST_STRUCTURE.has(t)) out.push(t);
    }
    return out;
  }
}

/**
 * Soft opening themes for RAG + phase plans (from ECO family / name).
 */
export function detectOpeningFamily(
  eco?: string | null,
  opening?: string | null
): string[] {
  const tags: string[] = [];
  const ecoU = String(eco || "").trim().toUpperCase();
  const name = String(opening || "").toLowerCase();
  if (!ecoU && !name) return [];

  tags.push("named_opening");
  tags.push("opening_plan");

  const fam = resolveEcoFamily(ecoU || null, opening || null);
  const key = fam?.key || "";
  if (key.includes("sicilian") || name.includes("sicilian")) {
    tags.push("opening_sicilian");
    if (name.includes("najdorf")) tags.push("opening_najdorf");
    if (name.includes("dragon")) tags.push("opening_dragon");
    if (name.includes("scheveningen")) tags.push("opening_scheveningen");
  }
  if (key.includes("french") || name.includes("french")) {
    tags.push("opening_french");
    tags.push("opening_french_defence");
  }
  if (key.includes("caro") || name.includes("caro")) {
    tags.push("opening_caro_kann");
  }
  if (
    key.includes("qgd") ||
    key.includes("qga") ||
    key.includes("slav") ||
    name.includes("queen's gambit") ||
    name.includes("queens gambit") ||
    name.includes("qgd") ||
    name.includes("slav")
  ) {
    tags.push("opening_queens_gambit");
    tags.push("opening_qgd");
  }
  if (key.includes("kings-indian") || name.includes("king's indian") || name.includes("kings indian")) {
    tags.push("opening_kings_indian");
    tags.push("opening_indian");
  }
  if (key.includes("grunfeld") || name.includes("grünfeld") || name.includes("grunfeld")) {
    tags.push("opening_indian");
  }
  if (key.includes("london") || name.includes("london")) {
    tags.push("opening_london");
  }
  if (key.includes("ruy") || name.includes("ruy lopez") || name.includes("spanish")) {
    tags.push("opening_ruy_lopez");
  }
  if (key.includes("italian") || name.includes("italian") || name.includes("giuoco")) {
    tags.push("opening_italian");
  }
  if (key.includes("scandinavian") || name.includes("scandinavian") || name.includes("center counter")) {
    tags.push("opening_scandinavian");
  }
  if (key.includes("petroff") || name.includes("petroff") || name.includes("russian")) {
    tags.push("opening_petroff");
  }
  if (key.includes("english") || name.includes("english opening") || name === "english") {
    tags.push("opening_english");
  }
  if (name.includes("najdorf")) tags.push("opening_najdorf");
  if (name.includes("dragon")) tags.push("opening_dragon");

  return [...new Set(tags)];
}
