import { Chess, type Square } from "chess.js";

const FILES = "abcdefgh";

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

function dPawnIsolated(board: Chess, color: "w" | "b"): boolean {
  // IQP: own pawn on d-file, no own pawns on c or e.
  const d = filePawnCounts(board, 3); // d-file
  const ownD = color === "w" ? d.w : d.b;
  if (ownD !== 1) return false;
  const c = filePawnCounts(board, 2);
  const e = filePawnCounts(board, 4);
  const ownC = color === "w" ? c.w : c.b;
  const ownE = color === "w" ? e.w : e.b;
  return ownC === 0 && ownE === 0;
}

function hangingCd(board: Chess, color: "w" | "b"): boolean {
  // Hanging pawns: own pawns on c and d, none on b or e (classic).
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
 * Board-true structure tags only. No ECO/opening guessing.
 */
export function detectStructureThemes(fen: string): string[] {
  const themes: string[] = [];
  try {
    const board = new Chess(fen);
    if (dPawnIsolated(board, "w") || dPawnIsolated(board, "b")) {
      themes.push("iqp");
    }
    if (hangingCd(board, "w") || hangingCd(board, "b")) {
      themes.push("hanging_pawns");
    }
    // Fully open file (no pawns) with a major piece already on it
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
    // Space: crude — more advanced pawns
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
 * Soft signal only: any named/ECO opening unlocks general centre/breaks/development.
 * Do not map openings to named RAG cards — board structure + phase drive retrieval.
 */
export function detectOpeningFamily(
  eco?: string | null,
  opening?: string | null
): string[] {
  const ecoU = String(eco || "").trim();
  const name = String(opening || "").trim();
  if (!ecoU && !name) return [];
  return ["named_opening"];
}
