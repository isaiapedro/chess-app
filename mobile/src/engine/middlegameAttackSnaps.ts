/**
 * Coach-facing middlegame attack / coordination snaps (BoardMetricSnap).
 * Threshold-based until Lichess baselines catch up.
 */

import { Chess, type Color, type Square } from "chess.js";
import {
  squareFile,
  squareRank,
  swapColor,
  kingSquare,
} from "./styleMetrics";

const FILES = "abcdefgh";
const CENTRAL_FILES = new Set([2, 3, 4, 5]); // c–f
const CENTRAL_RANKS = new Set([2, 3, 4, 5]); // 3–6

function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}` as Square;
}

function kingZoneSquares(ks: Square): Square[] {
  const f = squareFile(ks);
  const r = squareRank(ks);
  const out: Square[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const s = sq(f + df, r + dr);
      if (s) out.push(s);
    }
  }
  return out;
}

function uniqueAttackersOnZone(
  board: Chess,
  zone: Square[],
  color: Color
): number {
  const seen = new Set<string>();
  for (const z of zone) {
    for (const a of board.attackers(z, color)) {
      const p = board.get(a);
      if (!p || p.type === "k") continue;
      seen.add(a);
    }
  }
  return seen.size;
}

function uniqueDefendersOnZone(
  board: Chess,
  zone: Square[],
  color: Color
): number {
  return uniqueAttackersOnZone(board, zone, color);
}

function kingCastled(board: Chess, color: Color): boolean {
  const ks = kingSquare(board, color);
  if (!ks) return false;
  const r = squareRank(ks);
  const back = color === "w" ? 0 : 7;
  if (r !== back) return false;
  const f = squareFile(ks);
  return f === 6 || f === 2 || f === 1 || f === 5;
}

function shieldHoles(board: Chess, color: Color): number {
  const ks = kingSquare(board, color);
  if (!ks) return 0;
  const f = squareFile(ks);
  const r = squareRank(ks);
  const forward = color === "w" ? 1 : -1;
  const files =
    f >= 5 ? [5, 6, 7] : f <= 2 ? [0, 1, 2] : [f - 1, f, f + 1];
  let holes = 0;
  for (const ff of files) {
    const s = sq(ff, r + forward);
    if (!s) {
      holes += 1;
      continue;
    }
    const p = board.get(s);
    if (!(p && p.type === "p" && p.color === color)) holes += 1;
  }
  return holes;
}

function wingAdvanceScore(board: Chess, color: Color, files: number[]): number {
  let score = 0;
  const home = color === "w" ? 1 : 6;
  for (const f of files) {
    for (let r = 0; r < 8; r++) {
      const s = sq(f, r);
      if (!s) continue;
      const p = board.get(s);
      if (!p || p.type !== "p" || p.color !== color) continue;
      const depth = color === "w" ? r - home : home - r;
      if (depth >= 2) score += Math.min(5, depth);
    }
  }
  return score;
}

/** Snaps for BoardMetricSnap merge. */
export function middlegameAttackSnaps(
  board: Chess,
  color: Color
): {
  opp_king_in_centre: number;
  opp_king_uncastled: number;
  king_attack_ratio: number;
  attack_setup: number;
  opp_king_weaknesses: number;
  second_weakness: number;
  queen_centralization: number;
  connected_rooks: number;
  piece_liberation: number;
  side_clamp: number;
  key_square_control: number;
  piece_support: number;
} {
  const opp = swapColor(color);
  const oppK = kingSquare(board, opp);
  const oppZone = oppK ? [...kingZoneSquares(oppK), oppK] : [];
  const attackers = oppZone.length
    ? uniqueAttackersOnZone(board, oppZone, color)
    : 0;
  const defenders = oppZone.length
    ? uniqueDefendersOnZone(board, oppZone, opp)
    : 0;
  const ratio =
    attackers <= 0 ? 0 : Math.round((attackers / Math.max(1, defenders)) * 100) / 100;

  const oppInCentre =
    oppK &&
    CENTRAL_FILES.has(squareFile(oppK)) &&
    CENTRAL_RANKS.has(squareRank(oppK))
      ? 1
      : 0;
  const oppUncastled = oppK && !kingCastled(board, opp) ? 1 : 0;
  const holes = shieldHoles(board, opp);
  const openToward =
    oppK && board.attackers(oppK, color).length >= 1 ? 1 : 0;
  const attackSetup =
    (attackers >= 3 ? 2 : attackers >= 2 ? 1 : 0) +
    (openToward ? 1 : 0) +
    (oppUncastled ? 1 : 0);

  const qSide = wingAdvanceScore(board, color, [0, 1, 2]);
  const kSide = wingAdvanceScore(board, color, [5, 6, 7]);
  const oppQ = wingAdvanceScore(board, opp, [0, 1, 2]);
  const oppKWing = wingAdvanceScore(board, opp, [5, 6, 7]);
  const ownWeakWing = Math.min(qSide, kSide);
  const clamp = Math.max(0, Math.abs(qSide - kSide) - Math.abs(oppQ - oppKWing));
  const secondWeakness =
    (holes >= 2 ? 1 : 0) +
    (ownWeakWing <= 2 && Math.max(qSide, kSide) >= 6 ? 1 : 0) +
    (oppInCentre && attackers >= 2 ? 1 : 0);

  let queenCentral = 0;
  for (const s of board.findPiece({ type: "q", color })) {
    const f = squareFile(s as Square);
    const r = squareRank(s as Square);
    if (CENTRAL_FILES.has(f) && CENTRAL_RANKS.has(r)) queenCentral = 1;
  }

  let connectedRooks = 0;
  const rooks = board.findPiece({ type: "r", color }) as Square[];
  if (rooks.length >= 2) {
    for (let i = 0; i < rooks.length; i++) {
      for (let j = i + 1; j < rooks.length; j++) {
        const a = rooks[i]!;
        const b = rooks[j]!;
        if (board.isAttacked(a, color) && board.attackers(a, color).includes(b)) {
          connectedRooks = 1;
        }
        if (squareFile(a) === squareFile(b) || squareRank(a) === squareRank(b)) {
          connectedRooks = Math.max(connectedRooks, 1);
        }
      }
    }
  }

  let liberation = 0;
  for (const pt of ["b", "n"] as const) {
    for (const s of board.findPiece({ type: pt, color })) {
      const moves = board.moves({ square: s as Square, verbose: true });
      if (moves.length >= 4) liberation += 1;
    }
  }

  let keySquares = 0;
  const outpostRanks = color === "w" ? [3, 4, 5] : [2, 3, 4];
  for (const pt of ["n", "b"] as const) {
    for (const s of board.findPiece({ type: pt, color })) {
      const r = squareRank(s as Square);
      if (!outpostRanks.includes(r)) continue;
      if (board.isAttacked(s as Square, opp)) continue;
      keySquares += 1;
    }
  }

  let supported = 0;
  let total = 0;
  for (const pt of ["n", "b", "r", "q"] as const) {
    for (const s of board.findPiece({ type: pt, color })) {
      total += 1;
      if (board.attackers(s as Square, color).length > 0) supported += 1;
    }
  }
  const pieceSupport =
    total <= 0 ? 0 : Math.round((supported / total) * 100);

  return {
    opp_king_in_centre: oppInCentre,
    opp_king_uncastled: oppUncastled,
    king_attack_ratio: ratio,
    attack_setup: attackSetup,
    opp_king_weaknesses: holes,
    second_weakness: secondWeakness,
    queen_centralization: queenCentral,
    connected_rooks: connectedRooks,
    piece_liberation: liberation,
    side_clamp: clamp,
    key_square_control: keySquares,
    piece_support: pieceSupport,
  };
}
