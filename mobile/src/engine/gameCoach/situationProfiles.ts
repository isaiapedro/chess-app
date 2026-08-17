/**
 * Situation profiles: thematic positions → soft keys + tip lock.
 * Tier 1: castling wings, closed centre, IQP, rook/pawn endings.
 * Tier 2: Maróczy, Carlsbad, minority, Caro-Slav, Sicilian shells
 * (Hedgehog / Scheveningen / Dragon).
 */

import { Chess, type Color, type Square } from "chess.js";
import { hasIsolatedQueenPawn } from "../middlegamePhase";
import { classifyTheoretical } from "../endgamePhase";
import { squareFile, squareRank, swapColor } from "../styleMetrics";
import {
  classifyRookEndingShape,
  goodVsBadBishopSnap,
  knightVsBishopSnap,
  pawnStormTempoDelta,
  pawnStormTempoSnap,
} from "./tier3Metrics";
import { fileOpennessForSide } from "../phaseTacticalMetrics";

const FILES = "abcdefgh";

function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}` as Square;
}

function hasPawnAt(board: Chess, square: Square, color: Color): boolean {
  const p = board.get(square);
  return Boolean(p && p.type === "p" && p.color === color);
}

export type SituationPhase = "opening" | "middlegame" | "endgame" | "any";

export type SituationProfileId =
  | "opposite_side_castling"
  | "iqp"
  | "closed_center"
  | "maroczy_bind"
  | "carlsbad"
  | "minority_attack"
  | "caro_slav"
  | "hedgehog"
  | "scheveningen"
  | "dragon_formation"
  | "pawn_storm"
  | "knight_vs_bishop"
  | "good_vs_bad_bishop"
  | "rook_ending"
  | "pawn_ending";

export type SituationProfileDef = {
  id: SituationProfileId;
  phase: SituationPhase;
  softKeys: readonly string[];
  /** BoardMetricSnap / input field hints for tip priority. */
  metricHints: readonly string[];
  /** Weight boost when profile active (below why_better primary ~28). */
  lockBoost: number;
};

/** Book-topic profiles → soft keys + priority metrics. */
export const SITUATION_PROFILES: Record<
  SituationProfileId,
  SituationProfileDef
> = {
  opposite_side_castling: {
    id: "opposite_side_castling",
    phase: "any",
    softKeys: [
      "attack.opposite_side_castling",
      "attack.king_safety",
      "attack.initiative",
      "imbalance.space",
    ],
    metricHints: [
      "opposite_side_castling",
      "kingside_advance",
      "queenside_advance",
      "kingside_advance_opponent",
      "queenside_advance_opponent",
      "open_file_utilization",
      "king_attackers_pct",
      "opp_king_attackers_pct",
      "opp_king_uncastled",
      "king_center_file_exposure",
    ],
    lockBoost: 12,
  },
  iqp: {
    id: "iqp",
    phase: "any",
    softKeys: [
      "structure.iqp",
      "piece.blockade",
      "piece.simplification",
      "piece.centralization",
    ],
    metricHints: [
      "blockade_square_control",
      "open_file_utilization",
      "space_advantage_pct",
      "material_balance",
      "opp_king_attackers_pct",
    ],
    lockBoost: 12,
  },
  closed_center: {
    id: "closed_center",
    phase: "any",
    softKeys: [
      "structure.pawn_chain",
      "positional.pawn_break",
      "positional.outpost",
      "piece.coordination",
    ],
    metricHints: [
      "closed_center",
      "center_fluidity_index",
      "pawn_breaks",
      "center_advance",
      "open_file_utilization",
      "mobility",
      "space_advantage_pct",
    ],
    lockBoost: 12,
  },
  maroczy_bind: {
    id: "maroczy_bind",
    phase: "any",
    softKeys: [
      "structure.maroczy_bind",
      "imbalance.space",
      "positional.restriction",
      "positional.pawn_break",
    ],
    metricHints: [
      "maroczy_bind",
      "space_advantage_pct",
      "center_advance",
      "center_advance_opponent",
      "open_file_utilization",
      "mobility",
    ],
    lockBoost: 11,
  },
  carlsbad: {
    id: "carlsbad",
    phase: "any",
    softKeys: [
      "structure.carlsbad",
      "imbalance.space",
      "positional.pawn_break",
      "piece.coordination",
    ],
    metricHints: [
      "carlsbad",
      "queenside_advance",
      "queenside_advance_opponent",
      "open_file_utilization",
      "space_advantage_pct",
    ],
    lockBoost: 11,
  },
  minority_attack: {
    id: "minority_attack",
    phase: "any",
    softKeys: [
      "structure.carlsbad",
      "imbalance.space",
      "positional.pawn_break",
      "piece.coordination",
    ],
    metricHints: [
      "minority_attack",
      "carlsbad",
      "queenside_advance",
      "queenside_advance_opponent",
      "open_file_utilization",
      "space_advantage_pct",
    ],
    lockBoost: 12,
  },
  caro_slav: {
    id: "caro_slav",
    phase: "any",
    softKeys: [
      "structure.caro_slav",
      "structure.pawn_chain",
      "positional.pawn_break",
      "piece.centralization",
    ],
    metricHints: [
      "caro_slav",
      "closed_center",
      "center_advance",
      "space_advantage_pct",
      "open_file_utilization",
    ],
    lockBoost: 11,
  },
  hedgehog: {
    id: "hedgehog",
    phase: "any",
    softKeys: [
      "structure.hedgehog",
      "imbalance.space",
      "positional.pawn_break",
      "piece.coordination",
    ],
    metricHints: [
      "hedgehog",
      "space_advantage_pct",
      "queenside_advance",
      "center_advance",
      "mobility",
      "open_file_utilization",
    ],
    lockBoost: 11,
  },
  scheveningen: {
    id: "scheveningen",
    phase: "any",
    softKeys: [
      "structure.scheveningen",
      "imbalance.space",
      "positional.pawn_break",
      "attack.king_safety",
    ],
    metricHints: [
      "scheveningen",
      "space_advantage_pct",
      "center_advance",
      "open_file_utilization",
      "king_attackers_pct",
      "opp_king_attackers_pct",
    ],
    lockBoost: 11,
  },
  dragon_formation: {
    id: "dragon_formation",
    phase: "any",
    softKeys: [
      "structure.dragon_formation",
      "attack.initiative",
      "positional.color_complexes",
      "imbalance.space",
    ],
    metricHints: [
      "dragon_formation",
      "open_file_utilization",
      "bishop_openness_dark",
      "bishop_openness_light",
      "opp_king_attackers_pct",
      "kingside_advance_opponent",
    ],
    lockBoost: 11,
  },
  pawn_storm: {
    id: "pawn_storm",
    phase: "any",
    softKeys: [
      "attack.opposite_side_castling",
      "attack.initiative",
      "imbalance.space",
      "attack.king_safety",
    ],
    metricHints: [
      "pawn_storm_tempo",
      "pawn_storm_tempo_delta",
      "kingside_advance",
      "queenside_advance",
      "kingside_advance_opponent",
      "queenside_advance_opponent",
      "opposite_side_castling",
    ],
    lockBoost: 12,
  },
  knight_vs_bishop: {
    id: "knight_vs_bishop",
    phase: "any",
    softKeys: [
      "imbalance.knight_vs_bishop",
      "positional.outpost",
      "positional.color_complexes",
      "imbalance.space",
    ],
    metricHints: ["knight_vs_bishop", "closed_center", "mobility"],
    lockBoost: 11,
  },
  good_vs_bad_bishop: {
    id: "good_vs_bad_bishop",
    phase: "any",
    softKeys: [
      "imbalance.good_vs_bad_bishop",
      "positional.color_complexes",
      "imbalance.bishop_pair",
      "positional.pawn_break",
    ],
    metricHints: [
      "good_vs_bad_bishop",
      "bishop_openness_light",
      "bishop_openness_dark",
      "bishop_diagonal_influence_light",
      "bishop_diagonal_influence_dark",
    ],
    lockBoost: 11,
  },
  rook_ending: {
    id: "rook_ending",
    phase: "endgame",
    softKeys: [
      "endgame.theoretical.lucena",
      "endgame.theoretical.philidor",
      "endgame.theoretical.vancura",
      "endgame.strategic.active_king",
      "piece.seventh_rank_invasion",
    ],
    metricHints: [
      "seventh_rank_infiltration",
      "king_attackers_pct",
      "open_file_utilization",
      "material_balance",
    ],
    lockBoost: 14,
  },
  pawn_ending: {
    id: "pawn_ending",
    phase: "endgame",
    softKeys: [
      "endgame.strategic.active_king",
      "endgame.theoretical.triangulation",
      "endgame.strategic.pawn_break",
    ],
    metricHints: [
      "material_balance",
      "mobility",
      "center_advance",
      "space_advantage_pct",
    ],
    lockBoost: 14,
  },
};

export type CastlingWingSnaps = {
  castled_kingside: number;
  castled_queenside: number;
  castled_kingside_opponent: number;
  castled_queenside_opponent: number;
  opposite_side_castling: number;
  closed_center: number;
  blockade_square_control: number;
  maroczy_bind: number;
  carlsbad: number;
  minority_attack: number;
  caro_slav: number;
  hedgehog: number;
  scheveningen: number;
  dragon_formation: number;
  knight_vs_bishop: number;
  good_vs_bad_bishop: number;
  pawn_storm_tempo: number;
  center_fluidity_index: number;
  pawn_storm_tempo_delta: number;
  king_center_file_exposure: number;
};

function kingSquare(board: Chess, color: Color): Square | null {
  const sqs = board.findPiece({ type: "k", color });
  return sqs[0] || null;
}

/** Kingside = g-file, queenside = c-file (post-castle seats). */
export function castlingWingForColor(
  board: Chess,
  color: Color
): { kingside: boolean; queenside: boolean } {
  const k = kingSquare(board, color);
  if (!k) return { kingside: false, queenside: false };
  const file = squareFile(k);
  const homeRank = color === "w" ? 0 : 7;
  if (squareRank(k) !== homeRank) {
    return { kingside: false, queenside: false };
  }
  return {
    kingside: file === 6,
    queenside: file === 2,
  };
}

export function isOppositeSideCastling(board: Chess): boolean {
  const w = castlingWingForColor(board, "w");
  const b = castlingWingForColor(board, "b");
  const wCastle = w.kingside || w.queenside;
  const bCastle = b.kingside || b.queenside;
  if (!wCastle || !bCastle) return false;
  const wk = kingSquare(board, "w");
  const bk = kingSquare(board, "b");
  if (!wk || !bk) return false;
  const wf = squareFile(wk);
  const bf = squareFile(bk);
  if (wf === 3 || wf === 4 || bf === 3 || bf === 4) return false;
  if (w.kingside && b.queenside) return true;
  if (w.queenside && b.kingside) return true;
  return Math.abs(wf - bf) >= 3;
}

function fileHasPawn(board: Chess, file: number, color: Color): boolean {
  for (let rank = 0; rank < 8; rank += 1) {
    const s = sq(file, rank);
    if (!s) continue;
    const p = board.get(s);
    if (p?.type === "p" && p.color === color) return true;
  }
  return false;
}

function headToHeadOnFile(board: Chess, file: number): boolean {
  const whiteRanks: number[] = [];
  const blackRanks: number[] = [];
  for (let rank = 0; rank < 8; rank += 1) {
    const s = sq(file, rank);
    if (!s) continue;
    const p = board.get(s);
    if (!p || p.type !== "p") continue;
    if (p.color === "w") whiteRanks.push(rank);
    else blackRanks.push(rank);
  }
  for (const wr of whiteRanks) {
    for (const br of blackRanks) {
      if (Math.abs(wr - br) === 1) return true;
    }
  }
  return false;
}

function pawnFileCanLever(board: Chess, color: Color, file: number): boolean {
  const forward = color === "w" ? 1 : -1;
  for (let rank = 0; rank < 8; rank += 1) {
    const s = sq(file, rank);
    if (!s) continue;
    const p = board.get(s);
    if (!p || p.type !== "p" || p.color !== color) continue;
    const ahead = sq(file, rank + forward);
    if (ahead && !board.get(ahead)) return true;
    for (const df of [-1, 1]) {
      const cap = sq(file + df, rank + forward);
      if (!cap) continue;
      const t = board.get(cap);
      if (t && t.color !== color) return true;
    }
  }
  return false;
}

export function centerFluidityIndex(board: Chess): number {
  let score = 0;
  for (const file of [3, 4]) {
    const wHas = fileHasPawn(board, file, "w");
    const bHas = fileHasPawn(board, file, "b");
    if (!wHas && !bHas) {
      score += 50;
      continue;
    }
    const locked =
      headToHeadOnFile(board, file) &&
      !pawnFileCanLever(board, "w", file) &&
      !pawnFileCanLever(board, "b", file);
    if (locked) continue;
    if (
      pawnFileCanLever(board, "w", file) ||
      pawnFileCanLever(board, "b", file)
    ) {
      score += 25;
    }
  }
  return Math.max(0, Math.min(100, score));
}

export function kingCenterFileExposure(board: Chess, userColor: Color): number {
  const opp = swapColor(userColor);
  const k = kingSquare(board, opp);
  if (!k) return 0;
  const kf = squareFile(k);
  const wing = castlingWingForColor(board, opp);
  const inCentre = kf === 3 || kf === 4;
  const uncastled = !wing.kingside && !wing.queenside;
  if (!inCentre && !uncastled) return 0;
  let score = 0;
  for (const file of [3, 4]) {
    const kind = fileOpennessForSide(board, file, userColor);
    if (kind === "open") score += 2;
    else if (kind === "semi") score += 1;
    if (kf === file) score += 1;
  }
  return score;
}

export function isClosedCenter(board: Chess): boolean {
  const dOpen =
    !fileHasPawn(board, 3, "w") && !fileHasPawn(board, 3, "b");
  const eOpen =
    !fileHasPawn(board, 4, "w") && !fileHasPawn(board, 4, "b");
  if (dOpen || eOpen) return false;
  return centerFluidityIndex(board) === 0;
}

/**
 * For IQP positions: how many of d4/d5 are occupied or attacked by the side
 * that does NOT own the IQP (blockader), else by user if either has IQP.
 */
export function blockadeSquareControl(
  board: Chess,
  userColor: Color
): number {
  const targets: Square[] = ["d4", "d5"];
  let iqpColor: Color | null = null;
  if (hasIsolatedQueenPawn(board, "w")) iqpColor = "w";
  else if (hasIsolatedQueenPawn(board, "b")) iqpColor = "b";
  const blockader: Color =
    iqpColor != null ? swapColor(iqpColor) : userColor;
  let score = 0;
  for (const t of targets) {
    const p = board.get(t);
    if (p && p.color === blockader) {
      score += 1;
      continue;
    }
    if (board.attackers(t, blockader).length > 0) score += 1;
  }
  return score;
}

/**
 * Maróczy bind: binder pawns on c+e (rank 4 white / 5 black), no binder d-pawn
 * on that rank (avoids big-centre clutter). Soft signal: defender has a d-pawn.
 */
export function isMaroczyBind(board: Chess): boolean {
  return maroczyConfidence(board) > 0;
}

export function maroczyConfidence(board: Chess): number {
  const binder = maroczyBinderColor(board);
  if (!binder) return 0;
  const defender = swapColor(binder);
  const defD =
    binder === "w"
      ? hasPawnAt(board, "d6", defender) || hasPawnAt(board, "d7", defender)
      : hasPawnAt(board, "d3", defender) || hasPawnAt(board, "d2", defender);
  return defD ? 1 : 0.85;
}

/** Color that owns the c+e bind pawns, or null. */
export function maroczyBinderColor(board: Chess): Color | null {
  for (const binder of ["w", "b"] as Color[]) {
    const bindRank = binder === "w" ? 3 : 4;
    const cSq = sq(2, bindRank);
    const eSq = sq(4, bindRank);
    const dSq = sq(3, bindRank);
    if (!cSq || !eSq || !dSq) continue;
    if (!hasPawnAt(board, cSq, binder) || !hasPawnAt(board, eSq, binder)) {
      continue;
    }
    if (hasPawnAt(board, dSq, binder)) continue;
    return binder;
  }
  return null;
}

/**
 * Carlsbad (Exchange QG skeleton): White c3+d4 vs Black c6+d5,
 * without c4/c5 tension that breaks the structure. Mirror allowed.
 */
export function isCarlsbad(board: Chess): boolean {
  return carlsbadConfidence(board) > 0;
}

export function carlsbadConfidence(board: Chess): number {
  const whiteClassic =
    hasPawnAt(board, "d4", "w") &&
    hasPawnAt(board, "c3", "w") &&
    hasPawnAt(board, "d5", "b") &&
    hasPawnAt(board, "c6", "b") &&
    !hasPawnAt(board, "c4", "w") &&
    !hasPawnAt(board, "c5", "b");
  if (whiteClassic) return 1;

  // Exchange skeleton with open c for White: d4/d5 + Black c6, no White c-pawn.
  const whiteOpenC =
    hasPawnAt(board, "d4", "w") &&
    hasPawnAt(board, "d5", "b") &&
    hasPawnAt(board, "c6", "b") &&
    !fileHasPawn(board, 2, "w") &&
    !hasPawnAt(board, "c5", "b");
  if (whiteOpenC) return 0.9;

  return 0;
}

/**
 * Minority attack: Carlsbad skeleton + wing pawn advance (a/b4–5).
 */
export function isMinorityAttack(board: Chess): boolean {
  if (!isCarlsbad(board)) return false;
  if (
    hasPawnAt(board, "b4", "w") ||
    hasPawnAt(board, "b5", "w") ||
    hasPawnAt(board, "a4", "w") ||
    hasPawnAt(board, "a5", "w")
  ) {
    return true;
  }
  if (
    hasPawnAt(board, "b5", "b") ||
    hasPawnAt(board, "b4", "b") ||
    hasPawnAt(board, "a5", "b") ||
    hasPawnAt(board, "a4", "b")
  ) {
    return true;
  }
  return false;
}

/**
 * Caro-Slav solid: Black c6+d5, no …e5, White has e4 and/or d4.
 * Skip when Carlsbad Exchange skeleton already owns the position.
 */
export function isCaroSlav(board: Chess): boolean {
  return caroSlavConfidence(board) > 0;
}

export function caroSlavConfidence(board: Chess): number {
  if (!hasPawnAt(board, "c6", "b") || !hasPawnAt(board, "d5", "b")) return 0;
  if (hasPawnAt(board, "e5", "b")) return 0;
  // Carlsbad Exchange is its own profile.
  if (carlsbadConfidence(board) > 0) return 0;
  const whiteCenter =
    hasPawnAt(board, "e4", "w") || hasPawnAt(board, "d4", "w");
  if (!whiteCenter) return 0;
  // Unpushed / solid e-pawn on e7 or e6 (Caro / Semi-Slav flavour).
  if (hasPawnAt(board, "e7", "b") || hasPawnAt(board, "e6", "b")) return 1;
  return 0.85;
}

function hasPieceAt(
  board: Chess,
  square: Square,
  type: string,
  color: Color
): boolean {
  const p = board.get(square);
  return Boolean(p && p.type === type && p.color === color);
}

/** Open/half-open c-file typical after …cxd4. */
function sicilianCFileCue(board: Chess): boolean {
  const blackC = fileHasPawn(board, 2, "b");
  const whiteC = fileHasPawn(board, 2, "w");
  return !blackC || !whiteC;
}

function hedgehogPawnHits(board: Chess, color: Color): number {
  if (color === "b") {
    return (
      Number(hasPawnAt(board, "a6", "b")) +
      Number(hasPawnAt(board, "b6", "b")) +
      Number(hasPawnAt(board, "d6", "b")) +
      Number(hasPawnAt(board, "e6", "b"))
    );
  }
  return (
    Number(hasPawnAt(board, "a3", "w")) +
    Number(hasPawnAt(board, "b3", "w")) +
    Number(hasPawnAt(board, "d3", "w")) +
    Number(hasPawnAt(board, "e3", "w"))
  );
}

/**
 * Hedgehog: compact a6/b6/d6/e6 (or white mirror), no early …d5.
 */
export function isHedgehog(board: Chess): boolean {
  return hedgehogConfidence(board) > 0;
}

export function hedgehogConfidence(board: Chess): number {
  for (const side of ["b", "w"] as Color[]) {
    const hits = hedgehogPawnHits(board, side);
    if (hits < 3) continue;
    const broke =
      side === "b"
        ? hasPawnAt(board, "d5", "b") || hasPawnAt(board, "c5", "b")
        : hasPawnAt(board, "d4", "w") || hasPawnAt(board, "c4", "w");
    if (broke) continue;
    return hits >= 4 ? 1 : 0.85;
  }
  return 0;
}

/**
 * Dragon: …d6 + …g6 + Bg7 (classic; no …e6 small centre).
 */
export function isDragonFormation(board: Chess): boolean {
  return dragonConfidence(board) > 0;
}

export function dragonConfidence(board: Chess): number {
  // Black Dragon
  if (
    hasPawnAt(board, "d6", "b") &&
    hasPawnAt(board, "g6", "b") &&
    hasPieceAt(board, "g7", "b", "b") &&
    !hasPawnAt(board, "e6", "b")
  ) {
    return sicilianCFileCue(board) || hasPawnAt(board, "e4", "w") ? 1 : 0.85;
  }
  // White reverse Dragon (rare)
  if (
    hasPawnAt(board, "d3", "w") &&
    hasPawnAt(board, "g3", "w") &&
    hasPieceAt(board, "g2", "b", "w") &&
    !hasPawnAt(board, "e3", "w")
  ) {
    return 0.85;
  }
  return 0;
}

/**
 * Scheveningen small centre: …d6 + …e6, not Dragon, not full Hedgehog.
 */
export function isScheveningen(board: Chess): boolean {
  return scheveningenConfidence(board) > 0;
}

export function scheveningenConfidence(board: Chess): number {
  if (hedgehogConfidence(board) > 0) return 0;
  if (dragonConfidence(board) > 0) return 0;
  if (
    hasPawnAt(board, "d6", "b") &&
    hasPawnAt(board, "e6", "b") &&
    !hasPawnAt(board, "g6", "b") &&
    !hasPawnAt(board, "d5", "b")
  ) {
    const cue =
      sicilianCFileCue(board) ||
      hasPawnAt(board, "e4", "w") ||
      !fileHasPawn(board, 2, "b");
    return cue ? 1 : 0.8;
  }
  if (
    hasPawnAt(board, "d3", "w") &&
    hasPawnAt(board, "e3", "w") &&
    !hasPawnAt(board, "g3", "w") &&
    !hasPawnAt(board, "d4", "w")
  ) {
    return 0.8;
  }
  return 0;
}

export type SicilianShellId =
  | "hedgehog"
  | "dragon_formation"
  | "scheveningen";

/**
 * Mutual exclusion: Hedgehog > Dragon > Scheveningen.
 */
export function pickSicilianShell(
  board: Chess,
  themes?: Set<string> | null
): { id: SicilianShellId; confidence: number } | null {
  const t = themes || new Set<string>();
  if (t.has("hedgehog") || hedgehogConfidence(board) > 0) {
    return {
      id: "hedgehog",
      confidence: t.has("hedgehog") ? 1 : hedgehogConfidence(board),
    };
  }
  if (
    t.has("dragon_formation") ||
    t.has("dragon") ||
    dragonConfidence(board) > 0
  ) {
    return {
      id: "dragon_formation",
      confidence:
        t.has("dragon_formation") || t.has("dragon")
          ? 1
          : dragonConfidence(board),
    };
  }
  if (t.has("scheveningen") || scheveningenConfidence(board) > 0) {
    return {
      id: "scheveningen",
      confidence: t.has("scheveningen") ? 1 : scheveningenConfidence(board),
    };
  }
  return null;
}

export function situationCastlingSnaps(
  board: Chess,
  userColor: Color
): CastlingWingSnaps {
  const own = castlingWingForColor(board, userColor);
  const opp = castlingWingForColor(board, swapColor(userColor));
  const shell = pickSicilianShell(board);
  return {
    castled_kingside: own.kingside ? 1 : 0,
    castled_queenside: own.queenside ? 1 : 0,
    castled_kingside_opponent: opp.kingside ? 1 : 0,
    castled_queenside_opponent: opp.queenside ? 1 : 0,
    opposite_side_castling: isOppositeSideCastling(board) ? 1 : 0,
    closed_center: isClosedCenter(board) ? 1 : 0,
    blockade_square_control: blockadeSquareControl(board, userColor),
    maroczy_bind: isMaroczyBind(board) ? 1 : 0,
    carlsbad: isCarlsbad(board) ? 1 : 0,
    minority_attack: isMinorityAttack(board) ? 1 : 0,
    caro_slav: isCaroSlav(board) ? 1 : 0,
    hedgehog: shell?.id === "hedgehog" ? 1 : 0,
    scheveningen: shell?.id === "scheveningen" ? 1 : 0,
    dragon_formation: shell?.id === "dragon_formation" ? 1 : 0,
    knight_vs_bishop: knightVsBishopSnap(board, userColor),
    good_vs_bad_bishop: goodVsBadBishopSnap(board, userColor),
    pawn_storm_tempo: pawnStormTempoSnap(board, userColor),
    center_fluidity_index: centerFluidityIndex(board),
    pawn_storm_tempo_delta: pawnStormTempoDelta(board, userColor),
    king_center_file_exposure: kingCenterFileExposure(board, userColor),
  };
}

export type DetectedSituation = {
  id: SituationProfileId;
  confidence: number;
  softKeys: string[];
  metricHints: string[];
  lockBoost: number;
  /** Side-aware plan facet (IQP owner vs blockader, binder vs cramped, …). */
  role?: SituationRole | null;
};

export type SituationRole =
  | "iqp_owner"
  | "blockader"
  | "binder"
  | "cramped"
  | "minority_attacker"
  | "minority_defender";

/** Preferred soft-key order for a role (intersection with profile keys wins). */
const ROLE_KEY_PRIORITY: Record<SituationRole, readonly string[]> = {
  iqp_owner: [
    "structure.iqp",
    "piece.centralization",
    "piece.simplification",
    "piece.blockade",
  ],
  blockader: [
    "piece.blockade",
    "structure.iqp",
    "piece.simplification",
    "piece.centralization",
  ],
  binder: [
    "structure.maroczy_bind",
    "positional.restriction",
    "imbalance.space",
    "positional.pawn_break",
  ],
  cramped: [
    "positional.pawn_break",
    "imbalance.space",
    "structure.hedgehog",
    "structure.scheveningen",
    "structure.dragon_formation",
    "structure.maroczy_bind",
    "piece.coordination",
  ],
  minority_attacker: [
    "imbalance.space",
    "positional.pawn_break",
    "structure.carlsbad",
    "piece.coordination",
  ],
  minority_defender: [
    "piece.coordination",
    "structure.carlsbad",
    "positional.pawn_break",
    "imbalance.space",
  ],
};

export function applyRoleSoftKeys(
  base: readonly string[],
  role: SituationRole | null | undefined
): string[] {
  if (!role) return [...base];
  const pref = ROLE_KEY_PRIORITY[role] || [];
  return [
    ...pref.filter((k) => base.includes(k)),
    ...base.filter((k) => !pref.includes(k)),
  ];
}

function pushSituation(
  out: DetectedSituation[],
  p: { id: SituationProfileId; softKeys: readonly string[]; metricHints: readonly string[]; lockBoost: number },
  confidence: number,
  role: SituationRole | null = null
): void {
  out.push({
    id: p.id,
    confidence,
    softKeys: applyRoleSoftKeys(p.softKeys, role),
    metricHints: [...p.metricHints],
    lockBoost: p.lockBoost,
    role,
  });
}

function hedgehogOwnerColor(board: Chess): Color | null {
  for (const side of ["b", "w"] as Color[]) {
    if (hedgehogPawnHits(board, side) >= 3) return side;
  }
  return null;
}

function scheveningenOwnerColor(board: Chess): Color | null {
  if (scheveningenConfidence(board) <= 0) return null;
  if (hasPawnAt(board, "d6", "b") && hasPawnAt(board, "e6", "b")) return "b";
  if (hasPawnAt(board, "d3", "w") && hasPawnAt(board, "e3", "w")) return "w";
  return null;
}

function dragonOwnerColor(board: Chess): Color | null {
  if (dragonConfidence(board) <= 0) return null;
  if (
    hasPawnAt(board, "d6", "b") &&
    hasPawnAt(board, "g6", "b") &&
    hasPieceAt(board, "g7", "b", "b")
  ) {
    return "b";
  }
  if (
    hasPawnAt(board, "d3", "w") &&
    hasPawnAt(board, "g3", "w") &&
    hasPieceAt(board, "g2", "b", "w")
  ) {
    return "w";
  }
  return null;
}

function shellRoleForUser(
  owner: Color | null,
  user: Color
): SituationRole | null {
  if (!owner) return null;
  return owner === user ? "cramped" : "binder";
}

function phaseOk(
  profilePhase: SituationPhase,
  phase: SituationPhase | "opening" | "middlegame" | "endgame"
): boolean {
  if (profilePhase === "any") return true;
  return profilePhase === phase;
}

/**
 * Detect active situation profiles at a FEN / phase.
 */
export function detectSituations(args: {
  fen: string;
  phase: "opening" | "middlegame" | "endgame";
  userColor: "white" | "black";
  structureThemes?: string[] | null;
  /** Windowed pawn-storm tempo from PawnStormTracker (optional). */
  pawnStormTempo?: number | null;
}): DetectedSituation[] {
  const out: DetectedSituation[] = [];
  let board: Chess;
  try {
    board = new Chess(args.fen);
  } catch {
    return out;
  }
  const color: Color = args.userColor === "white" ? "w" : "b";
  const themes = new Set(args.structureThemes || []);

  if (
    phaseOk(SITUATION_PROFILES.opposite_side_castling.phase, args.phase) &&
    isOppositeSideCastling(board)
  ) {
    pushSituation(out, SITUATION_PROFILES.opposite_side_castling, 1, null);
  }

  const userIqp = hasIsolatedQueenPawn(board, color);
  const oppIqp = hasIsolatedQueenPawn(board, swapColor(color));
  const hasIqp = themes.has("iqp") && (userIqp || oppIqp);
  if (phaseOk(SITUATION_PROFILES.iqp.phase, args.phase) && hasIqp) {
    let role: SituationRole | null = null;
    if (userIqp && !oppIqp) role = "iqp_owner";
    else if (oppIqp && !userIqp) role = "blockader";
    pushSituation(
      out,
      SITUATION_PROFILES.iqp,
      themes.has("iqp") ? 1 : 0.85,
      role
    );
  }

  if (
    phaseOk(SITUATION_PROFILES.closed_center.phase, args.phase) &&
    isClosedCenter(board)
  ) {
    pushSituation(out, SITUATION_PROFILES.closed_center, 0.9, null);
  }

  const maroczyConf =
    themes.has("maroczy_bind") || themes.has("maroczy")
      ? 1
      : maroczyConfidence(board);
  if (
    phaseOk(SITUATION_PROFILES.maroczy_bind.phase, args.phase) &&
    maroczyConf > 0
  ) {
    const binder = maroczyBinderColor(board);
    const role: SituationRole | null = binder
      ? binder === color
        ? "binder"
        : "cramped"
      : null;
    pushSituation(out, SITUATION_PROFILES.maroczy_bind, maroczyConf, role);
  }

  const carlsbadConf =
    themes.has("carlsbad") ? 1 : carlsbadConfidence(board);
  if (
    phaseOk(SITUATION_PROFILES.carlsbad.phase, args.phase) &&
    carlsbadConf > 0
  ) {
    pushSituation(out, SITUATION_PROFILES.carlsbad, carlsbadConf, null);
  }

  if (
    phaseOk(SITUATION_PROFILES.minority_attack.phase, args.phase) &&
    (themes.has("minority_attack") || isMinorityAttack(board))
  ) {
    const role: SituationRole =
      color === "w" ? "minority_attacker" : "minority_defender";
    pushSituation(
      out,
      SITUATION_PROFILES.minority_attack,
      themes.has("minority_attack") ? 1 : 0.95,
      role
    );
  }

  const caroConf =
    themes.has("caro_slav") || themes.has("caro-slav")
      ? 1
      : caroSlavConfidence(board);
  if (
    phaseOk(SITUATION_PROFILES.caro_slav.phase, args.phase) &&
    caroConf > 0
  ) {
    pushSituation(out, SITUATION_PROFILES.caro_slav, caroConf, null);
  }

  const sicilian = pickSicilianShell(board, themes);
  if (sicilian && phaseOk(SITUATION_PROFILES[sicilian.id].phase, args.phase)) {
    const owner =
      sicilian.id === "hedgehog"
        ? hedgehogOwnerColor(board)
        : sicilian.id === "scheveningen"
          ? scheveningenOwnerColor(board)
          : dragonOwnerColor(board);
    pushSituation(
      out,
      SITUATION_PROFILES[sicilian.id],
      sicilian.confidence,
      shellRoleForUser(owner, color)
    );
  }

  const nvsb = knightVsBishopSnap(board, color);
  if (
    phaseOk(SITUATION_PROFILES.knight_vs_bishop.phase, args.phase) &&
    nvsb !== 0
  ) {
    pushSituation(
      out,
      SITUATION_PROFILES.knight_vs_bishop,
      Math.abs(nvsb) >= 1 ? 0.95 : 0.7,
      null
    );
  }

  const gvbb = goodVsBadBishopSnap(board, color);
  if (
    phaseOk(SITUATION_PROFILES.good_vs_bad_bishop.phase, args.phase) &&
    gvbb !== 0
  ) {
    pushSituation(
      out,
      SITUATION_PROFILES.good_vs_bad_bishop,
      Math.abs(gvbb) >= 1 ? 0.9 : 0.7,
      null
    );
  }

  const staticStorm = pawnStormTempoSnap(board, color);
  const windowStorm =
    args.pawnStormTempo != null && Number.isFinite(args.pawnStormTempo)
      ? Number(args.pawnStormTempo)
      : 0;
  const stormScore =
    Math.abs(windowStorm) >= Math.abs(staticStorm)
      ? windowStorm
      : staticStorm;
  const stormLive =
    Math.abs(stormScore) >= 3 ||
    (isOppositeSideCastling(board) && Math.abs(stormScore) >= 2);
  if (
    phaseOk(SITUATION_PROFILES.pawn_storm.phase, args.phase) &&
    stormLive
  ) {
    pushSituation(
      out,
      SITUATION_PROFILES.pawn_storm,
      Math.min(1, 0.7 + Math.abs(stormScore) * 0.05),
      null
    );
  }

  if (args.phase === "endgame") {
    const hit = classifyTheoretical(board, color);
    const rookShape = classifyRookEndingShape(board);
    if (
      hit?.key === "te_rook_pawn_vs_rook" ||
      hit?.key === "te_rook_vs_pawn" ||
      rookShape
    ) {
      const base = SITUATION_PROFILES.rook_ending;
      const shapeKeys =
        rookShape === "lucena"
          ? [
              "endgame.theoretical.lucena",
              "endgame.strategic.active_king",
              "piece.seventh_rank_invasion",
            ]
          : rookShape === "philidor"
            ? [
                "endgame.theoretical.philidor",
                "endgame.strategic.active_king",
                "piece.seventh_rank_invasion",
              ]
            : rookShape === "vancura"
              ? [
                  "endgame.theoretical.vancura",
                  "endgame.strategic.active_king",
                  "piece.seventh_rank_invasion",
                ]
              : base.softKeys;
      out.push({
        id: base.id,
        confidence: rookShape ? 1 : hit ? 1 : 0.75,
        softKeys: [...shapeKeys],
        metricHints: [...base.metricHints],
        lockBoost: base.lockBoost,
        role: null,
      });
    } else if (hit?.key === "te_pawn_endings") {
      pushSituation(out, SITUATION_PROFILES.pawn_ending, 1, null);
    } else {
      const majors = ["q", "r", "b", "n"] as const;
      let hasRook = false;
      let hasOther = false;
      for (const side of ["w", "b"] as Color[]) {
        for (const pt of majors) {
          const n = board.findPiece({ type: pt, color: side }).length;
          if (pt === "r" && n > 0) hasRook = true;
          if (pt !== "r" && n > 0) hasOther = true;
        }
      }
      if (hasRook && !hasOther) {
        const rookShape2 = classifyRookEndingShape(board);
        const base = SITUATION_PROFILES.rook_ending;
        const shapeKeys =
          rookShape2 === "lucena"
            ? [
                "endgame.theoretical.lucena",
                "endgame.strategic.active_king",
                "piece.seventh_rank_invasion",
              ]
            : rookShape2 === "philidor"
              ? [
                  "endgame.theoretical.philidor",
                  "endgame.strategic.active_king",
                  "piece.seventh_rank_invasion",
                ]
              : rookShape2 === "vancura"
                ? [
                    "endgame.theoretical.vancura",
                    "endgame.strategic.active_king",
                    "piece.seventh_rank_invasion",
                  ]
                : base.softKeys;
        out.push({
          id: base.id,
          confidence: 0.75,
          softKeys: [...shapeKeys],
          metricHints: [...base.metricHints],
          lockBoost: base.lockBoost,
          role: null,
        });
      } else if (!hasRook && !hasOther) {
        const pawns =
          board.findPiece({ type: "p", color: "w" }).length +
          board.findPiece({ type: "p", color: "b" }).length;
        if (pawns > 0) {
          pushSituation(out, SITUATION_PROFILES.pawn_ending, 0.75, null);
        }
      }
    }
  }

  return out;
}

export function softKeysFromSituations(
  situations: DetectedSituation[] | null | undefined
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of situations || []) {
    for (const k of s.softKeys) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export function situationLockBoostForKey(
  keyId: string,
  situations: DetectedSituation[] | null | undefined
): number {
  let best = 0;
  for (const s of situations || []) {
    if (s.softKeys.includes(keyId)) {
      best = Math.max(best, Math.round(s.lockBoost * s.confidence));
    }
  }
  return best;
}

export function formatSituationsShort(
  situations: DetectedSituation[] | null | undefined
): string {
  return (situations || [])
    .map((s) =>
      s.role ? `${s.id}:${s.confidence}:${s.role}` : `${s.id}:${s.confidence}`
    )
    .join(",");
}

export function formatSituationRolesShort(
  situations: DetectedSituation[] | null | undefined
): string {
  return (situations || [])
    .filter((s) => s.role)
    .map((s) => `${s.id}=${s.role}`)
    .join(",");
}

export const SITUATION_STICKY_CAP = 6;

const LIVE_STRUCTURE_SITUATIONS = new Set(["iqp"]);

/**
 * Merge live board detections with prior sticky situations.
 * Live overwrites same id (fresh confidence/role); unseen prior ids keep
 * except IQP, which drops when the live scan has no isolani.
 * Never clears to [] once any situation was carried — new structures add/replace.
 */
export function mergeStickySituations(
  prev: DetectedSituation[] | null | undefined,
  live: DetectedSituation[] | null | undefined
): DetectedSituation[] {
  const liveList = live || [];
  const prevList = prev || [];
  if (!liveList.length && !prevList.length) return [];
  if (!liveList.length) {
    return prevList
      .filter((s) => !LIVE_STRUCTURE_SITUATIONS.has(s.id))
      .slice(0, SITUATION_STICKY_CAP);
  }

  const liveIds = new Set(liveList.map((s) => s.id));
  const out: DetectedSituation[] = [...liveList];
  for (const s of prevList) {
    if (liveIds.has(s.id)) continue;
    if (LIVE_STRUCTURE_SITUATIONS.has(s.id)) continue;
    out.push(s);
    if (out.length >= SITUATION_STICKY_CAP) break;
  }
  return out.slice(0, SITUATION_STICKY_CAP);
}
