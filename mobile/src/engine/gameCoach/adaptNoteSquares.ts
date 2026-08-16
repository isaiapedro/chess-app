import { Chess, type Square } from "chess.js";

export type SquareAdaptContext = {
  text: string;
  fenBefore?: string;
  playedSan?: string;
  bestSan?: string | null;
  bestPvSan?: string[];
  userColor?: "white" | "black";
};

type Sq = string;
type Mode = "identity" | "rank_flip" | "file_flip" | "rotate180";

function normSq(sq: string): Sq {
  return sq.toLowerCase();
}

function flipRank(sq: Sq): Sq {
  const f = sq[0];
  const r = 9 - Number(sq[1]);
  return `${f}${r}`;
}

function flipFile(sq: Sq): Sq {
  const f = String.fromCharCode(
    "a".charCodeAt(0) + ("h".charCodeAt(0) - sq.charCodeAt(0))
  );
  return `${f}${sq[1]}`;
}

function rotate180(sq: Sq): Sq {
  return flipFile(flipRank(sq));
}

function applyMode(sq: Sq, mode: Mode): Sq {
  const s = normSq(sq);
  if (mode === "rank_flip") return flipRank(s);
  if (mode === "file_flip") return flipFile(s);
  if (mode === "rotate180") return rotate180(s);
  return s;
}

function extractSquaresFromText(text: string): Sq[] {
  const out: Sq[] = [];
  const tokenRe =
    /\b(?:(?:[NBRQK]?[a-h]?[1-8]?x?)([a-h][1-8])(?:(?:=[NBRQ])?[+#]?)|([a-h][1-8]))\b/gi;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text))) {
    const sq = m[1] || m[2];
    if (sq) out.push(normSq(sq));
  }
  return [...new Set(out)];
}

function squaresFromSan(
  fen: string | undefined,
  san: string | null | undefined
): Sq[] {
  if (!san) return [];
  if (!fen) return extractSquaresFromText(san);
  try {
    const board = new Chess(fen);
    const move = board.move(san);
    if (!move) return extractSquaresFromText(san);
    // Destinations drive square motifs; pawn origins (c2→c3) pollute flips.
    if (move.piece === "p") return [normSq(move.to)];
    return [normSq(move.from), normSq(move.to)];
  } catch {
    return extractSquaresFromText(san);
  }
}

function kingSquares(fen: string | undefined): Sq[] {
  if (!fen) return [];
  try {
    const board = new Chess(fen);
    const out: Sq[] = [];
    for (const color of ["w", "b"] as const) {
      for (const sq of board.findPiece({ type: "k", color })) {
        out.push(normSq(sq));
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** f/c/h/g/a/b 2nd & 7th rank pawns still on the board — motif anchors. */
function motifPawnSquares(fen: string | undefined): Sq[] {
  if (!fen) return [];
  const candidates = [
    "f2",
    "f7",
    "c2",
    "c7",
    "h2",
    "h7",
    "g2",
    "g7",
    "a2",
    "a7",
    "b2",
    "b7",
  ];
  try {
    const board = new Chess(fen);
    return candidates.filter((sq) => {
      const p = board.get(sq as Square);
      return Boolean(p && p.type === "p");
    });
  } catch {
    return [];
  }
}

function liveAnchors(ctx: SquareAdaptContext): { strong: Set<Sq>; soft: Set<Sq> } {
  const strong = new Set<Sq>();
  const soft = new Set<Sq>();
  const add = (set: Set<Sq>, xs: Sq[]) => {
    for (const x of xs) if (x) set.add(normSq(x));
  };
  add(strong, squaresFromSan(ctx.fenBefore, ctx.playedSan || null));
  add(strong, squaresFromSan(ctx.fenBefore, ctx.bestSan || null));
  if (ctx.bestPvSan?.length && ctx.fenBefore) {
    try {
      const board = new Chess(ctx.fenBefore);
      for (const san of ctx.bestPvSan.slice(0, 6)) {
        const move = board.move(san);
        if (!move) break;
        strong.add(normSq(move.to));
        if (move.piece !== "p") strong.add(normSq(move.from));
      }
    } catch {
      /* ignore */
    }
  }
  add(strong, kingSquares(ctx.fenBefore));
  add(soft, motifPawnSquares(ctx.fenBefore));
  return { strong, soft };
}

function scoreMode(
  mode: Mode,
  noteSquares: Sq[],
  strong: Set<Sq>,
  soft: Set<Sq>
): number {
  let score = 0;
  for (const sq of noteSquares) {
    const mapped = applyMode(sq, mode);
    if (strong.has(mapped)) {
      // Prefer identity when the engraved square is already live.
      score += mode === "identity" ? 6 : 5;
    } else if (soft.has(mapped)) {
      // Soft pawns only break ties — never outrank a strong identity hit.
      score += 1;
    }
  }
  return score;
}

function chooseMode(
  noteSquares: Sq[],
  strong: Set<Sq>,
  soft: Set<Sq>,
  userColor?: "white" | "black"
): Mode {
  if (!noteSquares.length) return "identity";
  const modes: Mode[] = ["identity", "rank_flip", "file_flip", "rotate180"];
  const scores = new Map<Mode, number>();
  for (const mode of modes) {
    scores.set(mode, scoreMode(mode, noteSquares, strong, soft));
  }
  const identityScore = scores.get("identity") || 0;
  const identityStrongHits = noteSquares.filter((sq) => strong.has(sq)).length;
  const anyStrongHit = noteSquares.some((sq) =>
    modes.some((mode) => strong.has(applyMode(sq, mode)))
  );

  // No live fight squares under any orientation → side default.
  if (!anyStrongHit) {
    return userColor === "black" ? "rank_flip" : "identity";
  }

  let best: Mode = "identity";
  let bestScore = identityScore;
  for (const mode of modes) {
    if (mode === "identity") continue;
    const s = scores.get(mode) || 0;
    const margin = identityStrongHits > 0 ? 3 : 1;
    if (s >= bestScore + margin) {
      bestScore = s;
      best = mode;
    }
  }
  return best;
}

function preserveCase(original: string, mapped: string): string {
  if (original === original.toUpperCase()) return mapped.toUpperCase();
  if (original[0] && original[0] === original[0].toUpperCase()) {
    return mapped[0].toUpperCase() + mapped.slice(1);
  }
  return mapped;
}

function remapSquaresOnce(text: string, mode: Mode): string {
  // One pass: SAN-with-destination OR lone square (non-overlapping).
  const tokenRe =
    /\b(?:([NBRQK]?[a-h]?[1-8]?x?)([a-h][1-8])((?:=[NBRQ])?[+#]?)|([a-h][1-8]))\b/gi;
  return text.replace(
    tokenRe,
    (
      _full,
      prefix: string | undefined,
      dest: string | undefined,
      marks: string | undefined,
      lone: string | undefined
    ) => {
      if (dest && prefix != null) {
        const mapped = applyMode(dest, mode);
        return `${prefix}${preserveCase(dest, mapped)}${marks || ""}`;
      }
      if (lone) {
        return preserveCase(lone, applyMode(lone, mode));
      }
      return _full;
    }
  );
}

/**
 * Remap engraved squares in book notes to the live board orientation.
 * Picks identity / rank-flip / file-flip / 180° from played move + engine line.
 * f7 can become f2, c7, or c2 depending on where the fight is.
 */
export function adaptNoteSquares(ctx: SquareAdaptContext): string {
  const text = (ctx.text || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const noteSquares = extractSquaresFromText(text);
  if (!noteSquares.length) return text;

  const { strong, soft } = liveAnchors(ctx);
  const mode = chooseMode(noteSquares, strong, soft, ctx.userColor);
  if (mode === "identity") return text;
  return remapSquaresOnce(text, mode);
}
