/**
 * Tier-3 imbalance / storm helpers for BoardMetricSnap + situation profiles.
 * Knight-vs-bishop, good/bad bishop, pawn-storm tempo (static + windowed tracker).
 */

import { Chess, type Color, type Square } from "chess.js";
import {
  kingsideAdvanceScore,
  queensideAdvanceScore,
  isDarkSquare,
  bishopComplexSnaps,
} from "../phaseTacticalMetrics";
import { swapColor } from "../styleMetrics";

function kingWing(
  board: Chess,
  color: Color
): { kingside: boolean; queenside: boolean } {
  const k = board.findPiece({ type: "k", color })[0];
  if (!k) return { kingside: false, queenside: false };
  const file = k.charCodeAt(0) - 97;
  const rank = Number(k[1]) - 1;
  const home = color === "w" ? 0 : 7;
  if (rank !== home) return { kingside: false, queenside: false };
  return { kingside: file === 6, queenside: file === 2 };
}

function oppositeSideCastling(board: Chess): boolean {
  const w = kingWing(board, "w");
  const b = kingWing(board, "b");
  return (
    (w.kingside && b.queenside) ||
    (w.queenside && b.kingside)
  );
}

/**
 * +1 user is the knight side vs opp bishops; -1 user is bishop side; 0 none.
 */
export function knightVsBishopSnap(board: Chess, color: Color): number {
  const opp = swapColor(color);
  const n = board.findPiece({ type: "n", color }).length;
  const b = board.findPiece({ type: "b", color }).length;
  const on = board.findPiece({ type: "n", color: opp }).length;
  const ob = board.findPiece({ type: "b", color: opp }).length;
  if (n >= 1 && b === 0 && ob >= 1 && on === 0) return 1;
  if (b >= 1 && n === 0 && on >= 1 && ob === 0) return -1;
  const rel = n - b - (on - ob);
  if (rel >= 2) return 1;
  if (rel <= -2) return -1;
  return 0;
}

/**
 * +1 good bishop (open diagonals, few same-colour pawns); -1 bad; 0 neutral.
 */
export function goodVsBadBishopSnap(board: Chess, color: Color): number {
  const bishops = board.findPiece({ type: "b", color });
  if (!bishops.length) return 0;
  const complex = bishopComplexSnaps(board, color);
  const openness =
    complex.bishop_openness_light + complex.bishop_openness_dark;
  let sameColorPawns = 0;
  for (const bSq of bishops) {
    const dark = isDarkSquare(bSq);
    for (const pSq of board.findPiece({ type: "p", color })) {
      if (isDarkSquare(pSq) === dark) sameColorPawns += 1;
    }
  }
  sameColorPawns = Math.round(sameColorPawns / bishops.length);
  if (openness >= 6 && sameColorPawns <= 2) return 1;
  if (openness <= 4 && sameColorPawns >= 3) return -1;
  return 0;
}

export function pawnStormTempoDelta(board: Chess, color: Color): number {
  return (
    queensideAdvanceScore(board, color) -
    kingsideAdvanceScore(board, swapColor(color))
  );
}

/**
 * Static race proxy: own hotter wing minus opp hotter wing.
 * Stronger signal under opposite-side castling.
 */
export function pawnStormTempoSnap(board: Chess, color: Color): number {
  const k = kingsideAdvanceScore(board, color);
  const q = queensideAdvanceScore(board, color);
  const kOpp = kingsideAdvanceScore(board, swapColor(color));
  const qOpp = queensideAdvanceScore(board, swapColor(color));
  const opp = kingWing(board, swapColor(color));
  let ownStorm: number;
  let oppStorm: number;
  if (oppositeSideCastling(board)) {
    ownStorm = opp.kingside ? k : opp.queenside ? q : Math.max(k, q);
    const own = kingWing(board, color);
    oppStorm = own.kingside
      ? kOpp
      : own.queenside
        ? qOpp
        : Math.max(kOpp, qOpp);
  } else {
    ownStorm = Math.max(k, q);
    oppStorm = Math.max(kOpp, qOpp);
  }
  return ownStorm - oppStorm;
}

export type PawnStormSample = {
  k: number;
  q: number;
  kOpp: number;
  qOpp: number;
};

/**
 * Windowed wing-rush tempo (own Δ − opp Δ over recent user plies).
 */
export class PawnStormTracker {
  private hist: PawnStormSample[] = [];
  private readonly window: number;

  constructor(window = 4) {
    this.window = Math.max(2, window);
  }

  update(board: Chess, color: Color): number {
    const sample: PawnStormSample = {
      k: kingsideAdvanceScore(board, color),
      q: queensideAdvanceScore(board, color),
      kOpp: kingsideAdvanceScore(board, swapColor(color)),
      qOpp: queensideAdvanceScore(board, swapColor(color)),
    };
    this.hist.push(sample);
    if (this.hist.length > this.window + 1) this.hist.shift();
    if (this.hist.length < 2) return 0;
    const old = this.hist[0]!;
    const kGain = sample.k - old.k - (sample.kOpp - old.kOpp);
    const qGain = sample.q - old.q - (sample.qOpp - old.qOpp);
    return Math.abs(kGain) >= Math.abs(qGain) ? kGain : qGain;
  }

  reset(): void {
    this.hist = [];
  }
}

export type RookEndingShape = "lucena" | "philidor" | "vancura" | null;

function countType(
  board: Chess,
  type: "r" | "p" | "n" | "b" | "q",
  color: Color
): number {
  return board.findPiece({ type, color }).length;
}

function onlyKrPvsKr(board: Chess): {
  strong: Color;
  pawnSq: Square;
} | null {
  for (const strong of ["w", "b"] as Color[]) {
    const weak = swapColor(strong);
    if (countType(board, "q", strong) || countType(board, "q", weak)) continue;
    if (countType(board, "n", strong) || countType(board, "n", weak)) continue;
    if (countType(board, "b", strong) || countType(board, "b", weak)) continue;
    if (countType(board, "r", strong) !== 1 || countType(board, "r", weak) !== 1) {
      continue;
    }
    if (countType(board, "p", weak) !== 0) continue;
    const pawns = board.findPiece({ type: "p", color: strong });
    if (pawns.length !== 1) continue;
    return { strong, pawnSq: pawns[0]! };
  }
  return null;
}

/**
 * Lightweight Lucena / Philidor / Vancura shape for rook+pawn vs rook.
 */
export function classifyRookEndingShape(board: Chess): RookEndingShape {
  const hit = onlyKrPvsKr(board);
  if (!hit) return null;
  const { strong, pawnSq } = hit;
  const file = pawnSq.charCodeAt(0) - 97;
  const rank = Number(pawnSq[1]) - 1;
  const rookPawn = file === 0 || file === 7;
  const nearPromo = strong === "w" ? rank >= 5 : rank <= 2;
  const onSeventh = strong === "w" ? rank === 6 : rank === 1;

  const weak = swapColor(strong);
  const defRook = board.findPiece({ type: "r", color: weak })[0];
  const defRank = defRook ? Number(defRook[1]) - 1 : -1;

  if (rookPawn && nearPromo && defRook) {
    const defFile = defRook.charCodeAt(0) - 97;
    if (Math.abs(defFile - file) >= 2) return "vancura";
  }

  if (onSeventh) return "lucena";

  const philRank = strong === "w" ? 2 : 5;
  if (defRank === philRank && !nearPromo) return "philidor";
  if (!nearPromo && defRook) return "philidor";

  return null;
}
