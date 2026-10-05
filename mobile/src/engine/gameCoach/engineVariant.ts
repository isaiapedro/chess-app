import { Chess } from "chess.js";
import { applyUciMove, sameMove, sanToUci, uciFromMove } from "../chessMoves";
import { isCoachMistakeOrWorse, type CoachMark } from "./coachMarkClassify";

export type EngineVariantPly = {
  mark: CoachMark | null;
  san: string;
  uci: string;
  fenBefore: string;
  fullmove: number;
  side: "white" | "black";
  bestSan: string | null;
  bestPvSan: string[];
  lines: { san: string; pvSan: string[] }[];
};

export type EngineVariantMove = {
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  fullmove: number;
  side: "white" | "black";
};

export type EngineVariant = {
  plyIndex: number;
  moves: EngineVariantMove[];
};

export type EngineLineArrowNav = {
  plyIndex: number;
  engineCursor: { plyIndex: number; depth: number } | null;
  explore: { depth: number; moves: Array<{ uci: string }> } | null;
};

export function engineLineArrowUci(
  nav: EngineLineArrowNav,
  engineVariants: Array<Pick<EngineVariant, "moves"> | null>
): string | null {
  if (nav.explore) {
    return nav.explore.moves[nav.explore.depth + 1]?.uci || null;
  }
  if (nav.engineCursor) {
    const moves = engineVariants[nav.engineCursor.plyIndex]?.moves;
    return moves?.[nav.engineCursor.depth + 1]?.uci || null;
  }
  if (nav.plyIndex < 0) return null;
  return engineVariants[nav.plyIndex]?.moves[0]?.uci || null;
}

const MAX_VARIANT_PLIES = 7;
const MAX_SKIP = 1;

function stripSanMarks(san: string): string {
  return san.replace(/[?!+#]+$/g, "").trim();
}

function fenSide(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

function fenFullmove(fen: string, fallback: number): number {
  const n = Number(fen.split(" ")[5]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function playSan(board: Chess, san: string) {
  const cleaned = stripSanMarks(san);
  if (!cleaned) return null;
  try {
    return board.move(cleaned);
  } catch {
    return null;
  }
}

export function enginePvSans(ply: EngineVariantPly): string[] {
  if (ply.bestPvSan?.length) return ply.bestPvSan;
  if (ply.lines[0]?.pvSan?.length) return ply.lines[0].pvSan;
  if (ply.bestSan) return [ply.bestSan];
  if (ply.lines[0]?.san) return [ply.lines[0].san];
  return [];
}

export function buildEngineVariant(
  ply: EngineVariantPly,
  plyIndex: number
): EngineVariant | null {
  if (!isCoachMistakeOrWorse(ply.mark)) return null;
  const tokens = enginePvSans(ply);
  const bestSan = ply.bestSan || tokens[0] || "";
  if (!bestSan) return null;
  const bestUci = sanToUci(ply.fenBefore, bestSan);
  if (bestUci.length < 4) return null;
  if (sameMove(ply.fenBefore, ply.uci, bestUci)) return null;

  const board = new Chess(ply.fenBefore);
  const first = applyUciMove(board, bestUci);
  if (!first) return null;

  const moves: EngineVariantMove[] = [
    {
      san: first.san,
      uci: uciFromMove(first),
      fenBefore: ply.fenBefore,
      fenAfter: board.fen(),
      fullmove: fenFullmove(ply.fenBefore, ply.fullmove),
      side: ply.side,
    },
  ];

  let start = 0;
  if (
    tokens.length &&
    stripSanMarks(tokens[0]) === stripSanMarks(bestSan)
  ) {
    start = 1;
  }

  let skips = 0;
  for (const raw of tokens.slice(start)) {
    if (moves.length >= MAX_VARIANT_PLIES) break;
    const fenBefore = board.fen();
    const played = playSan(board, raw);
    if (!played) {
      skips += 1;
      if (skips > MAX_SKIP && moves.length) break;
      continue;
    }
    skips = 0;
    moves.push({
      san: played.san,
      uci: uciFromMove(played),
      fenBefore,
      fenAfter: board.fen(),
      fullmove: fenFullmove(fenBefore, ply.fullmove),
      side: fenSide(fenBefore),
    });
  }

  return { plyIndex, moves };
}

export function buildEngineVariants(
  plies: EngineVariantPly[]
): Array<EngineVariant | null> {
  return plies.map((ply, i) => buildEngineVariant(ply, i));
}
