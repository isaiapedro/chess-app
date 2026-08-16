/**
 * Phase / coach-only tactical counters (not shown on Insights metrics tab).
 * pawn_break, defended_pawn, bishop openness (peak), checks/pins, blocking checks/pins.
 */

import { Chess, type Color, type Move, type Square } from "chess.js";
import {
  squareFile,
  squareRank,
  swapColor,
  kingSquare,
  isHangingOrUnderdefended,
} from "./styleMetrics";

const FILES = "abcdefgh";

function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}` as Square;
}

function sameDiagonal(a: Square, b: Square): boolean {
  return (
    Math.abs(squareFile(a) - squareFile(b)) ===
    Math.abs(squareRank(a) - squareRank(b))
  );
}

function betweenOnDiagonal(a: Square, b: Square): Square[] {
  const af = squareFile(a);
  const ar = squareRank(a);
  const bf = squareFile(b);
  const br = squareRank(b);
  if (Math.abs(af - bf) !== Math.abs(ar - br) || af === bf) return [];
  const df = Math.sign(bf - af);
  const dr = Math.sign(br - ar);
  const out: Square[] = [];
  let f = af + df;
  let r = ar + dr;
  while (f !== bf || r !== br) {
    const s = sq(f, r);
    if (s) out.push(s);
    f += df;
    r += dr;
  }
  return out;
}

function enemyPawnAttacksSquare(
  board: Chess,
  target: Square,
  enemy: Color
): boolean {
  const f = squareFile(target);
  const r = squareRank(target);
  const fromRank = enemy === "w" ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    const s = sq(f + df, fromRank);
    if (!s) continue;
    const p = board.get(s);
    if (p && p.type === "p" && p.color === enemy) return true;
  }
  return false;
}

/** Pawn pushed onto a square capturable by an enemy pawn (lever / break). */
export function isPawnBreakMove(
  boardAfter: Chess,
  move: Move,
  color: Color
): boolean {
  if (move.piece !== "p" || move.isCapture()) return false;
  const fromR = squareRank(move.from);
  const toR = squareRank(move.to);
  const forward = color === "w" ? toR > fromR : toR < fromR;
  if (!forward) return false;
  return enemyPawnAttacksSquare(boardAfter, move.to, swapColor(color));
}

/**
 * Move that adds a defender to an underprotected friendly pawn
 * (not by pushing that pawn forward).
 */
export function isDefendedPawnMove(
  boardBefore: Chess,
  boardAfter: Chess,
  move: Move,
  color: Color
): boolean {
  if (move.piece === "p" && !move.isCapture()) {
    // Pushing a pawn forward never counts as "defended instead of push".
    const fromR = squareRank(move.from);
    const toR = squareRank(move.to);
    const forward = color === "w" ? toR > fromR : toR < fromR;
    if (forward) return false;
  }
  const pawns = boardBefore.findPiece({ type: "p", color });
  for (const pawnSq of pawns) {
    if (pawnSq === move.from) continue;
    if (!isHangingOrUnderdefended(boardBefore, pawnSq, color)) continue;
    const afterPiece = boardAfter.get(pawnSq);
    if (!afterPiece || afterPiece.type !== "p" || afterPiece.color !== color) {
      continue;
    }
    if (isHangingOrUnderdefended(boardAfter, pawnSq, color)) continue;
    // Gained a defender (or attackers dropped).
    const beforeDefs = boardBefore.attackers(pawnSq, color).length;
    const afterDefs = boardAfter.attackers(pawnSq, color).length;
    if (afterDefs > beforeDefs) return true;
  }
  return false;
}

function bishopDiagonalClearanceGain(
  boardBefore: Chess,
  boardAfter: Chess,
  bishopSq: Square,
  color: Color,
  movedFrom: Square
): boolean {
  if (!sameDiagonal(bishopSq, movedFrom)) return false;
  const bishop = boardBefore.get(bishopSq);
  if (!bishop || bishop.type !== "b" || bishop.color !== color) return false;
  // Before: mover sat on bishop's diagonal. After: bishop should see further
  // along that ray (more attacks on that diagonal color complex).
  const beforeAttacks = boardBefore
    .moves({ square: bishopSq, verbose: true })
    .filter((m) => sameDiagonal(bishopSq, m.to)).length;
  const afterBishop = boardAfter.get(bishopSq);
  if (!afterBishop || afterBishop.type !== "b") return false;
  const afterAttacks = boardAfter
    .moves({ square: bishopSq, verbose: true })
    .filter((m) => sameDiagonal(bishopSq, m.to)).length;
  return afterAttacks > beforeAttacks;
}

export type UnblockBishopHit = {
  light: boolean;
  dark: boolean;
};

function createsPinAgainst(
  board: Chess,
  attackerColor: Color
): boolean {
  const victimColor = swapColor(attackerColor);
  const king = kingSquare(board, victimColor);
  if (!king) return false;
  for (const pt of ["b", "r", "q"] as const) {
    for (const atkSq of board.findPiece({ type: pt, color: attackerColor })) {
      const ray =
        pt === "b"
          ? sameDiagonal(atkSq, king)
            ? betweenOnDiagonal(atkSq, king)
            : []
          : pt === "r"
            ? squareFile(atkSq) === squareFile(king) ||
              squareRank(atkSq) === squareRank(king)
              ? betweenOnFileOrRank(atkSq, king)
              : []
            : sameDiagonal(atkSq, king)
              ? betweenOnDiagonal(atkSq, king)
              : squareFile(atkSq) === squareFile(king) ||
                  squareRank(atkSq) === squareRank(king)
                ? betweenOnFileOrRank(atkSq, king)
                : [];
      if (ray.length < 1) continue;
      const occupied = ray.filter((s) => board.get(s));
      if (occupied.length !== 1) continue;
      const mid = board.get(occupied[0]!);
      if (!mid || mid.color !== victimColor || mid.type === "k") continue;
      // Absolute-ish pin: king behind the mid piece on the ray.
      return true;
    }
  }
  return false;
}

function betweenOnFileOrRank(a: Square, b: Square): Square[] {
  const af = squareFile(a);
  const ar = squareRank(a);
  const bf = squareFile(b);
  const br = squareRank(b);
  if (af !== bf && ar !== br) return [];
  const df = Math.sign(bf - af);
  const dr = Math.sign(br - ar);
  const out: Square[] = [];
  let f = af + df;
  let r = ar + dr;
  while (f !== bf || r !== br) {
    const s = sq(f, r);
    if (s) out.push(s);
    f += df;
    r += dr;
  }
  return out;
}

/** Move gives check and/or creates a pin on the opponent. */
export function isCheckOrPinMove(
  boardBefore: Chess,
  boardAfter: Chess,
  _move: Move,
  color: Color
): boolean {
  // After our move, turn is opponent; inCheck ⇒ we gave check.
  if (boardAfter.inCheck()) return true;
  const pinBefore = createsPinAgainst(boardBefore, color);
  const pinAfter = createsPinAgainst(boardAfter, color);
  return !pinBefore && pinAfter;
}

/** Only kings + pawns remain (no Q/R/B/N). */
export function isKingAndPawnEnding(board: Chess): boolean {
  for (const color of ["w", "b"] as Color[]) {
    for (const pt of ["q", "r", "b", "n"] as const) {
      if (board.findPiece({ type: pt, color }).length > 0) return false;
    }
  }
  return true;
}

/**
 * Kings within Chebyshev distance ≤ 3 in a K+P ending.
 * Edge-trigger: true when condition holds after the move but not before.
 */
export function gainedOpposition(
  boardBefore: Chess,
  boardAfter: Chess
): boolean {
  if (!isKingAndPawnEnding(boardAfter)) return false;
  const wk = kingSquare(boardAfter, "w");
  const bk = kingSquare(boardAfter, "b");
  if (!wk || !bk) return false;
  const afterDist = Math.max(
    Math.abs(squareFile(wk) - squareFile(bk)),
    Math.abs(squareRank(wk) - squareRank(bk))
  );
  if (afterDist > 3) return false;
  if (!isKingAndPawnEnding(boardBefore)) return true;
  const wk0 = kingSquare(boardBefore, "w");
  const bk0 = kingSquare(boardBefore, "b");
  if (!wk0 || !bk0) return true;
  const beforeDist = Math.max(
    Math.abs(squareFile(wk0) - squareFile(bk0)),
    Math.abs(squareRank(wk0) - squareRank(bk0))
  );
  return beforeDist > 3;
}

/**
 * User rook/queen lands on the 7th rank (White) / 2nd rank (Black).
 * Counts the infiltration move, not lingering on the rank.
 */
export function isSeventhRankInfiltration(
  move: Move,
  color: Color
): boolean {
  if (move.piece !== "r" && move.piece !== "q") return false;
  const targetRank = color === "w" ? 6 : 1;
  const fromRank = squareRank(move.from);
  const toRank = squareRank(move.to);
  return toRank === targetRank && fromRank !== targetRank;
}

/**
 * File open/semi-open relative to `color` (standard chess):
 * - open: no pawns of either side on the file
 * - semi-open: no own pawns, but at least one enemy pawn
 * - closed: own pawn(s) present
 */
export function fileOpennessForSide(
  board: Chess,
  file: number,
  color: Color
): "open" | "semi" | "closed" {
  let mine = 0;
  let theirs = 0;
  const opp = swapColor(color);
  for (let rank = 0; rank < 8; rank += 1) {
    const s = sq(file, rank);
    if (!s) continue;
    const p = board.get(s);
    if (!p || p.type !== "p") continue;
    if (p.color === color) mine += 1;
    else if (p.color === opp) theirs += 1;
  }
  if (mine === 0 && theirs === 0) return "open";
  if (mine === 0 && theirs > 0) return "semi";
  return "closed";
}

export function isOpenOrSemiOpenFile(
  board: Chess,
  file: number,
  color: Color
): boolean {
  const kind = fileOpennessForSide(board, file, color);
  return kind === "open" || kind === "semi";
}

/**
 * Rook/queen utilizes an open or semi-open file for its side.
 * Edge: enters the file, or stays on the file when it newly opens/semi-opens.
 */
export function isOpenFileUtilization(
  boardBefore: Chess,
  boardAfter: Chess,
  move: Move,
  color: Color
): boolean {
  if (move.piece !== "r" && move.piece !== "q") return false;
  const toFile = squareFile(move.to);
  if (!isOpenOrSemiOpenFile(boardAfter, toFile, color)) return false;
  const fromFile = squareFile(move.from);
  if (fromFile !== toFile) return true;
  return !isOpenOrSemiOpenFile(boardBefore, toFile, color);
}

/** Position snap: count of own R/Q on open or semi-open files. */
export function countOpenFileUtilization(
  board: Chess,
  color: Color
): number {
  let n = 0;
  for (const pt of ["r", "q"] as const) {
    for (const pieceSq of board.findPiece({ type: pt, color })) {
      if (isOpenOrSemiOpenFile(board, squareFile(pieceSq), color)) n += 1;
    }
  }
  return n;
}

/** Position snap: count of own R/Q on the 7th (White) / 2nd (Black). */
export function countSeventhRankPresence(
  board: Chess,
  color: Color
): number {
  const targetRank = color === "w" ? 6 : 1;
  let n = 0;
  for (const pt of ["r", "q"] as const) {
    for (const pieceSq of board.findPiece({ type: pt, color })) {
      if (squareRank(pieceSq) === targetRank) n += 1;
    }
  }
  return n;
}

/** a1 is dark: (file + rank) even → dark, odd → light. */
export function isDarkSquare(square: Square): boolean {
  return (squareFile(square) + squareRank(square)) % 2 === 0;
}

const BISHOP_DIAG_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Ray walk from a bishop square.
 * influence = empty squares + enemy piece on ray (capture square)
 * openness = empty squares only (how clear the diagonals are)
 */
export function bishopRayInfluenceOpenness(
  board: Chess,
  bishopSq: Square,
  color: Color
): { influence: number; openness: number } {
  let influence = 0;
  let openness = 0;
  const f0 = squareFile(bishopSq);
  const r0 = squareRank(bishopSq);
  for (const [df, dr] of BISHOP_DIAG_DIRS) {
    let f = f0 + df;
    let r = r0 + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const s = sq(f, r);
      if (!s) break;
      const p = board.get(s);
      if (!p) {
        influence += 1;
        openness += 1;
      } else {
        if (p.color !== color) influence += 1;
        break;
      }
      f += df;
      r += dr;
    }
  }
  return { influence, openness };
}

export type BishopComplexSnaps = {
  bishop_diagonal_influence_light: number;
  bishop_diagonal_influence_dark: number;
  bishop_openness_light: number;
  bishop_openness_dark: number;
  bishop_diagonal_influence_light_opponent: number;
  bishop_diagonal_influence_dark_opponent: number;
  bishop_openness_light_opponent: number;
  bishop_openness_dark_opponent: number;
};

function bishopComplexForSide(
  board: Chess,
  color: Color
): {
  influenceLight: number;
  influenceDark: number;
  opennessLight: number;
  opennessDark: number;
} {
  let influenceLight = 0;
  let influenceDark = 0;
  let opennessLight = 0;
  let opennessDark = 0;
  for (const bSq of board.findPiece({ type: "b", color })) {
    const { influence, openness } = bishopRayInfluenceOpenness(
      board,
      bSq,
      color
    );
    if (isDarkSquare(bSq)) {
      influenceDark += influence;
      opennessDark += openness;
    } else {
      influenceLight += influence;
      opennessLight += openness;
    }
  }
  return { influenceLight, influenceDark, opennessLight, opennessDark };
}

/** Own + opponent light/dark bishop influence & openness snaps. */
export function bishopComplexSnaps(
  board: Chess,
  color: Color
): BishopComplexSnaps {
  const own = bishopComplexForSide(board, color);
  const opp = bishopComplexForSide(board, swapColor(color));
  return {
    bishop_diagonal_influence_light: own.influenceLight,
    bishop_diagonal_influence_dark: own.influenceDark,
    bishop_openness_light: own.opennessLight,
    bishop_openness_dark: own.opennessDark,
    bishop_diagonal_influence_light_opponent: opp.influenceLight,
    bishop_diagonal_influence_dark_opponent: opp.influenceDark,
    bishop_openness_light_opponent: opp.opennessLight,
    bishop_openness_dark_opponent: opp.opennessDark,
  };
}

/** Piece left a friendly bishop's diagonal, opening that bishop. */
export function unblockingBishopHit(
  boardBefore: Chess,
  boardAfter: Chess,
  move: Move,
  color: Color
): UnblockBishopHit {
  const hit = { light: false, dark: false };
  if (move.piece === "b") return hit;
  const bishops = boardBefore.findPiece({ type: "b", color });
  for (const bSq of bishops) {
    if (
      !bishopDiagonalClearanceGain(boardBefore, boardAfter, bSq, color, move.from)
    ) {
      continue;
    }
    if (isDarkSquare(bSq)) hit.dark = true;
    else hit.light = true;
  }
  return hit;
}

/** Files a=0…h=7. Kingside h/g/f; queenside a/b/c; centre f/e/d/c (overlap OK). */
export const KINGSIDE_FILES = [5, 6, 7] as const;
export const QUEENSIDE_FILES = [0, 1, 2] as const;
export const CENTER_FILES = [2, 3, 4, 5] as const;

/**
 * Score for one pawn advanced ≥2 ranks from its start rank.
 * White start rank 2 → rank ≥4; Black start rank 7 → rank ≤5.
 * Depth points: White rank 4→2 … 7→5; Black rank 5→2 … 2→5 (clamped).
 */
export function pawnAdvanceDepthScore(
  color: Color,
  rank0: number
): number | null {
  const chessRank = rank0 + 1;
  if (color === "w") {
    if (chessRank < 4) return null;
    return Math.min(5, Math.max(2, chessRank - 2));
  }
  if (chessRank > 5) return null;
  return Math.min(5, Math.max(2, 7 - chessRank));
}

/**
 * Sum of depth scores for own pawns on `files` that have advanced ≥2 ranks.
 */
export function pawnZoneAdvanceScore(
  board: Chess,
  color: Color,
  files: readonly number[]
): number {
  const want = new Set(files);
  let total = 0;
  for (const pawnSq of board.findPiece({ type: "p", color })) {
    const f = squareFile(pawnSq);
    if (!want.has(f)) continue;
    const score = pawnAdvanceDepthScore(color, squareRank(pawnSq));
    if (score != null) total += score;
  }
  return total;
}

export function queensideAdvanceScore(board: Chess, color: Color): number {
  return pawnZoneAdvanceScore(board, color, QUEENSIDE_FILES);
}

export function kingsideAdvanceScore(board: Chess, color: Color): number {
  return pawnZoneAdvanceScore(board, color, KINGSIDE_FILES);
}

export function centerAdvanceScore(board: Chess, color: Color): number {
  return pawnZoneAdvanceScore(board, color, CENTER_FILES);
}

/** Own + opponent zone advances for BoardMetricSnap-style fields. */
export function zoneAdvanceSnaps(
  board: Chess,
  color: Color
): {
  queenside_advance: number;
  queenside_advance_opponent: number;
  kingside_advance: number;
  kingside_advance_opponent: number;
  center_advance: number;
  center_advance_opponent: number;
} {
  const opp = swapColor(color);
  return {
    queenside_advance: queensideAdvanceScore(board, color),
    queenside_advance_opponent: queensideAdvanceScore(board, opp),
    kingside_advance: kingsideAdvanceScore(board, color),
    kingside_advance_opponent: kingsideAdvanceScore(board, opp),
    center_advance: centerAdvanceScore(board, color),
    center_advance_opponent: centerAdvanceScore(board, opp),
  };
}

/**
 * Resolved a check by interposing (not king flight / capture of checker),
 * or broke a pin by interposing / moving the pinned unit (not king walk-off).
 */
export function isBlockingCheckOrPinMove(
  boardBefore: Chess,
  boardAfter: Chess,
  move: Move,
  color: Color
): boolean {
  const wasInCheck = boardBefore.inCheck() && boardBefore.turn() === color;
  if (wasInCheck) {
    if (boardAfter.inCheck() && boardAfter.turn() !== color) {
      // Still checking somehow — ignore.
    }
    if (!boardAfter.inCheck() || boardAfter.turn() === color) {
      // Check resolved. Count block if not king move and not capture of checker only.
      if (move.piece === "k") return false;
      if (!move.isCapture()) return true;
      // Capture of checker is not "blocking".
      return false;
    }
  }

  const pinBefore = createsPinAgainst(boardBefore, swapColor(color));
  const pinAfter = createsPinAgainst(boardAfter, swapColor(color));
  if (pinBefore && !pinAfter) {
    // King stepping off the pin ray is flight, not a block.
    if (move.piece === "k") return false;
    return true;
  }
  return false;
}

export type PhaseTacticalCounters = {
  pawn_breaks: number;
  defended_pawns: number;
  /** Peak empty-diagonal openness for light-complex bishops. */
  unblocking_bishop_light: number;
  /** Peak empty-diagonal openness for dark-complex bishops. */
  unblocking_bishop_dark: number;
  checks: number;
  blocking_checks: number;
  pawn_moves: number;
  /** Pressure on the user's (defender) king zone. */
  king_attackers_samples: number[];
  king_attackers_rises: number;
  /** Pressure on the opponent's king zone (same formula, swapped color). */
  opp_king_attackers_samples: number[];
  opp_king_attackers_rises: number;
  /** Middlegame+endgame coach-only: R/Q infiltrate 7th (W) / 2nd (B). */
  seventh_rank_infiltration: number;
  /**
   * Middlegame+endgame coach-only: R/Q occupies an open or semi-open file
   * for the side (edge-triggered on enter / file newly open).
   */
  open_file_utilization: number;
  /**
   * Endgame coach-only: entered Chebyshev ≤3 king distance in a K+P ending
   * (no Q/R/B/N). Pawns allowed.
   */
  opposition: number;
};

export function emptyPhaseTacticalCounters(): PhaseTacticalCounters {
  return {
    pawn_breaks: 0,
    defended_pawns: 0,
    unblocking_bishop_light: 0,
    unblocking_bishop_dark: 0,
    checks: 0,
    blocking_checks: 0,
    pawn_moves: 0,
    king_attackers_samples: [],
    king_attackers_rises: 0,
    opp_king_attackers_samples: [],
    opp_king_attackers_rises: 0,
    seventh_rank_infiltration: 0,
    open_file_utilization: 0,
    opposition: 0,
  };
}

export function applyUserTacticalMove(args: {
  counters: PhaseTacticalCounters;
  boardBefore: Chess;
  boardAfter: Chess;
  move: Move;
  color: Color;
  /** Enable middlegame+endgame counters (7th rank, open-file utilization). */
  postOpening?: boolean;
  /** Enable endgame-only counters (opposition). */
  endgame?: boolean;
}): void {
  const {
    counters,
    boardBefore,
    boardAfter,
    move,
    color,
    postOpening,
    endgame,
  } = args;
  if (move.piece === "p") counters.pawn_moves += 1;
  if (isPawnBreakMove(boardAfter, move, color)) counters.pawn_breaks += 1;
  if (isDefendedPawnMove(boardBefore, boardAfter, move, color)) {
    counters.defended_pawns += 1;
  }
  const unblock = unblockingBishopHit(boardBefore, boardAfter, move, color);
  void unblock;
  const openSnap = bishopComplexForSide(boardAfter, color);
  counters.unblocking_bishop_light = Math.max(
    counters.unblocking_bishop_light,
    openSnap.opennessLight
  );
  counters.unblocking_bishop_dark = Math.max(
    counters.unblocking_bishop_dark,
    openSnap.opennessDark
  );
  if (isCheckOrPinMove(boardBefore, boardAfter, move, color)) {
    counters.checks += 1;
  }
  if (isBlockingCheckOrPinMove(boardBefore, boardAfter, move, color)) {
    counters.blocking_checks += 1;
  }
  if (postOpening) {
    if (isSeventhRankInfiltration(move, color)) {
      counters.seventh_rank_infiltration += 1;
    }
    if (isOpenFileUtilization(boardBefore, boardAfter, move, color)) {
      counters.open_file_utilization += 1;
    }
  }
  if (endgame && gainedOpposition(boardBefore, boardAfter)) {
    counters.opposition += 1;
  }
}

export function noteKingAttackersSample(
  counters: PhaseTacticalCounters,
  pct: number,
  side: "own" | "opp" = "own"
): boolean {
  const samples =
    side === "own"
      ? counters.king_attackers_samples
      : counters.opp_king_attackers_samples;
  const prev = samples.length > 0 ? samples[samples.length - 1]! : null;
  samples.push(pct);
  if (prev != null && pct > prev + 0.5) {
    if (side === "own") counters.king_attackers_rises += 1;
    else counters.opp_king_attackers_rises += 1;
    return true;
  }
  return prev == null;
}
