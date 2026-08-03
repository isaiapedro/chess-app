import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
import {
  HEURISTICS_DOUBLED_PERSIST_PLIES,
  HEURISTICS_MG_ATTACKERS_EVERY,
  HEURISTICS_MG_ISLANDS_EVERY,
  HEURISTICS_MG_SAFE_EVERY,
  HEURISTICS_MG_SAMPLE_EVERY,
  HEURISTICS_MG_SPACE_EVERY,
} from "./analysisConfig";
import { ENDGAME_NON_PAWN_MAX, nonPawnPieceCount } from "./endgamePhase";
import {
  moveAccuracyPct,
  openingPhaseEndFullmove,
} from "./openingPhase";
import { inMiddlegamePly, middlegameStartPly } from "./middlegameBounds";
import {
  hasMaterialWinTactic,
  kingSquare,
  parseSans,
  squareFile,
  squareRank,
  STYLE_PIECE_VALUE,
  swapColor,
} from "./styleMetrics";
import {
  userWinProbability,
  classifyEvalDrop,
  isMistakeOrWorse,
  isBlunderSwingUp,
  wpDropPp,
} from "./winProb";

export { inMiddlegamePly, middlegameStartPly } from "./middlegameBounds";

const PIECE_POWER = STYLE_PIECE_VALUE;

export const KING_ATTACKER_POWER_MAX =
  PIECE_POWER.q +
  PIECE_POWER.r * 2 +
  PIECE_POWER.b * 2 +
  PIECE_POWER.n * 2;

export const KING_ATTACKERS_SCORE_MAX =
  KING_ATTACKER_POWER_MAX * KING_ATTACKER_POWER_MAX;
const FILES = "abcdefgh";

export type MiddlegameEvalBucket = {
  accuracy_pct: number | null;
  accuracy_moves: number;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  tactics_made: number;
  missed_opportunity_chances: number;
  missed_opportunities: number;
  missed_tactic_chances: number;
  missed_tactics: number;
  allowed_tactic_chances: number;
  allowed_tactics_found: number;
};

export type MiddlegameGameRow = {
  reached_middlegame: boolean;
  middlegame_start_ply: number | null;
  middlegame_end_ply: number | null;
  middlegame_accuracy_pct: number | null;
  middlegame_accuracy_moves: number;
  middlegame_blunders: number;
  middlegame_mistakes: number;
  middlegame_inaccuracies: number;
  middlegame_missed_opportunity_pct: number | null;
  middlegame_missed_tactic_pct: number | null;
  middlegame_allowed_tactic_pct: number | null;
  middlegame_king_attackers_score: number | null;
  middlegame_pawn_shield_pct: number | null;
  middlegame_open_file_proximity_pct: number | null;
  middlegame_safe_moves_pct: number | null;
  middlegame_outpost_control: number | null;
  middlegame_space_advantage_pct: number | null;
  had_iqp: boolean;
  had_doubled_pawns: boolean;
  had_backward_pawns: boolean;
  middlegame_pawn_islands_avg: number | null;
  result: string;
};

export type MiddlegameMetricsAggregate = {
  games: number;
  middlegame_games: number;
  middlegame_accuracy_pct: number | null;
  middlegame_accuracy_games: number;
  middlegame_blunder_avg: number | null;
  middlegame_mistake_avg: number | null;
  middlegame_inaccuracy_avg: number | null;
  middlegame_missed_opportunity_pct: number | null;
  middlegame_missed_tactic_pct: number | null;
  middlegame_allowed_tactic_pct: number | null;
  middlegame_king_attackers_score: number | null;
  middlegame_pawn_shield_pct: number | null;
  middlegame_open_file_proximity_pct: number | null;
  middlegame_safe_moves_pct: number | null;
  middlegame_outpost_control_avg: number | null;
  middlegame_space_advantage_pct: number | null;
  middlegame_iqp_win_rate_pct: number | null;
  middlegame_doubled_pawns_game_pct: number | null;
  middlegame_backward_pawns_game_pct: number | null;
  middlegame_pawn_islands_avg: number | null;
};

function mean(vals: number[], digits = 1): number | null {
  if (!vals.length) return null;
  const factor = 10 ** digits;
  return (
    Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * factor) /
    factor
  );
}

function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}` as Square;
}

export function kingZoneSquares(king: Square): Square[] {
  const f = squareFile(king);
  const r = squareRank(king);
  const out: Square[] = [];
  for (let df = -1; df <= 1; df += 1) {
    for (let dr = -1; dr <= 1; dr += 1) {
      if (df === 0 && dr === 0) continue;
      const s = sq(f + df, r + dr);
      if (s) out.push(s);
    }
  }
  return out;
}

export function kingAttackersScore(board: Chess, userColor: Color): number {
  const king = kingSquare(board, userColor);
  if (!king) return 0;
  const opp = swapColor(userColor);
  const seen = new Set<string>();
  let weight = 0;
  for (const zoneSq of kingZoneSquares(king)) {
    for (const atk of board.attackers(zoneSq, opp)) {
      if (seen.has(atk)) continue;
      seen.add(atk);
      const piece = board.get(atk);
      if (!piece || piece.type === "k") continue;
      weight += PIECE_POWER[piece.type] || 0;
    }
  }
  return weight * weight;
}

export function kingAttackersPct(board: Chess, userColor: Color): number {
  const raw = kingAttackersScore(board, userColor);
  return (
    Math.round(
      (Math.min(raw, KING_ATTACKERS_SCORE_MAX) / KING_ATTACKERS_SCORE_MAX) *
        1000
    ) / 10
  );
}

function shieldSquares(king: Square, color: Color): Square[] | null {
  const f = squareFile(king);
  const r = squareRank(king);
  const homeRank = color === "w" ? 0 : 7;
  if (r !== homeRank) return null;
  const pawnRank = color === "w" ? 1 : 6;
  if (f >= 5) {
    return [sq(5, pawnRank), sq(6, pawnRank), sq(7, pawnRank)].filter(
      Boolean
    ) as Square[];
  }
  if (f <= 2) {
    return [sq(0, pawnRank), sq(1, pawnRank), sq(2, pawnRank)].filter(
      Boolean
    ) as Square[];
  }
  return null;
}

export function pawnShieldIntegrityPct(
  board: Chess,
  userColor: Color
): number | null {
  const king = kingSquare(board, userColor);
  if (!king) return null;
  const shields = shieldSquares(king, userColor);
  if (!shields) return null;
  const homePawnRank = userColor === "w" ? 1 : 6;
  let score = 100;
  for (const target of shields) {
    const file = squareFile(target);
    let pawnRank: number | null = null;
    for (let rank = 0; rank < 8; rank += 1) {
      const s = sq(file, rank);
      if (!s) continue;
      const p = board.get(s);
      if (p && p.type === "p" && p.color === userColor) {
        pawnRank = rank;
        break;
      }
    }
    if (pawnRank == null) {
      score -= 34;
      continue;
    }
    const advanced =
      userColor === "w"
        ? pawnRank - homePawnRank
        : homePawnRank - pawnRank;
    if (advanced >= 2) score -= 25;
    else if (advanced === 1) score -= 15;
  }
  return Math.max(0, Math.min(100, score));
}

function fileOpenness(
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
  if (mine === 0 || theirs === 0) return "semi";
  return "closed";
}

function opennessScore(kind: "open" | "semi" | "closed"): number {
  if (kind === "open") return 100;
  if (kind === "semi") return 70;
  return 0;
}

function opennessFromPawnCounts(
  mine: number,
  theirs: number
): "open" | "semi" | "closed" {
  if (mine === 0 && theirs === 0) return "open";
  if (mine === 0 || theirs === 0) return "semi";
  return "closed";
}

export type OpenFileTracker = {
  armed: boolean;
  kingFile: number;
  adjFiles: number[];
  rookFile: number | null;
  mine: number[];
  theirs: number[];
  scoreMax: number;
};

export function createOpenFileTracker(): OpenFileTracker {
  return {
    armed: false,
    kingFile: 0,
    adjFiles: [],
    rookFile: null,
    mine: Array.from({ length: 8 }, () => 0),
    theirs: Array.from({ length: 8 }, () => 0),
    scoreMax: 0,
  };
}

function scoreOpenFileFromCounts(tracker: OpenFileTracker): number {
  const kindOf = (file: number) =>
    opennessFromPawnCounts(tracker.mine[file] || 0, tracker.theirs[file] || 0);
  let best = opennessScore(kindOf(tracker.kingFile));
  for (const adj of tracker.adjFiles) {
    const base = opennessScore(kindOf(adj));
    if (base > 0) best = Math.max(best, Math.round(base * 0.5));
  }
  if (tracker.rookFile != null) {
    const base = opennessScore(kindOf(tracker.rookFile));
    if (base > 0) best = Math.max(best, Math.round(base * 0.6));
  }
  return best;
}

export function armOpenFileTracker(
  tracker: OpenFileTracker,
  board: Chess,
  userColor: Color,
  options?: { castled?: boolean }
): void {
  if (tracker.armed) return;
  const king = kingSquare(board, userColor);
  if (!king) return;
  const kf = squareFile(king);
  const opp = swapColor(userColor);
  const mine = Array.from({ length: 8 }, () => 0);
  const theirs = Array.from({ length: 8 }, () => 0);
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 0; rank < 8; rank += 1) {
      const s = sq(file, rank);
      if (!s) continue;
      const p = board.get(s);
      if (!p || p.type !== "p") continue;
      if (p.color === userColor) mine[file] += 1;
      else if (p.color === opp) theirs[file] += 1;
    }
  }
  const castled = options?.castled === true;
  const homeRank = userColor === "w" ? 0 : 7;
  const adj = [kf - 1, kf + 1].filter((f) => f >= 0 && f <= 7);
  let rookFile: number | null = null;
  if (castled && squareRank(king) === homeRank) {
    rookFile = kf >= 5 ? 7 : kf <= 2 ? 0 : null;
  }
  tracker.armed = true;
  tracker.kingFile = kf;
  tracker.adjFiles = adj;
  tracker.rookFile = rookFile;
  tracker.mine = mine;
  tracker.theirs = theirs;
  tracker.scoreMax = scoreOpenFileFromCounts(tracker);
}

export function updateOpenFileTracker(
  tracker: OpenFileTracker,
  move: {
    from: Square;
    to: Square;
    piece: string;
    color: Color;
    captured?: string;
    promotion?: string;
  },
  userColor: Color,
  options?: { castled?: boolean }
): void {
  if (!tracker.armed) return;
  const opp = swapColor(userColor);
  let changed = false;
  if (move.piece === "k" && move.color === userColor) {
    const kf = squareFile(move.to);
    tracker.kingFile = kf;
    tracker.adjFiles = [kf - 1, kf + 1].filter((f) => f >= 0 && f <= 7);
    const castled = options?.castled === true;
    const homeRank = userColor === "w" ? 0 : 7;
    if (castled && squareRank(move.to) === homeRank) {
      tracker.rookFile = kf >= 5 ? 7 : kf <= 2 ? 0 : null;
    } else {
      tracker.rookFile = null;
    }
    changed = true;
  }
  if (move.piece === "p") {
    const fromF = squareFile(move.from);
    const toF = squareFile(move.to);
    if (move.color === userColor) {
      tracker.mine[fromF] = Math.max(0, (tracker.mine[fromF] || 0) - 1);
      if (!move.promotion) tracker.mine[toF] = (tracker.mine[toF] || 0) + 1;
    } else {
      tracker.theirs[fromF] = Math.max(0, (tracker.theirs[fromF] || 0) - 1);
      if (!move.promotion) tracker.theirs[toF] = (tracker.theirs[toF] || 0) + 1;
    }
    changed = true;
  }
  if (move.captured === "p") {
    const toF = squareFile(move.to);
    const capturedColor = move.color === "w" ? "b" : "w";
    if (capturedColor === userColor) {
      tracker.mine[toF] = Math.max(0, (tracker.mine[toF] || 0) - 1);
    } else if (capturedColor === opp) {
      tracker.theirs[toF] = Math.max(0, (tracker.theirs[toF] || 0) - 1);
    }
    changed = true;
  }
  if (!changed) return;
  const next = scoreOpenFileFromCounts(tracker);
  if (next > tracker.scoreMax) tracker.scoreMax = next;
}

export function openFileTrackerPct(tracker: OpenFileTracker): number | null {
  if (!tracker.armed) return null;
  return tracker.scoreMax;
}

export function openFileProximityPct(
  board: Chess,
  userColor: Color,
  options?: { castled?: boolean }
): number {
  const king = kingSquare(board, userColor);
  if (!king) return 0;
  const kf = squareFile(king);
  let best = opennessScore(fileOpenness(board, kf, userColor));
  for (const adj of [kf - 1, kf + 1]) {
    if (adj < 0 || adj > 7) continue;
    const kind = fileOpenness(board, adj, userColor);
    const base = opennessScore(kind);
    if (base > 0) best = Math.max(best, Math.round(base * 0.5));
  }
  const castled = options?.castled === true;
  const homeRank = userColor === "w" ? 0 : 7;
  if (castled && squareRank(king) === homeRank) {
    const rookFile = kf >= 5 ? 7 : kf <= 2 ? 0 : null;
    if (rookFile != null) {
      const kind = fileOpenness(board, rookFile, userColor);
      const base = opennessScore(kind);
      if (base > 0) best = Math.max(best, Math.round(base * 0.6));
    }
  }
  return best;
}

function isAttackedByPawn(
  board: Chess,
  target: Square,
  byColor: Color
): boolean {
  const f = squareFile(target);
  const r = squareRank(target);
  const dirs =
    byColor === "w"
      ? [
          [f - 1, r - 1],
          [f + 1, r - 1],
        ]
      : [
          [f - 1, r + 1],
          [f + 1, r + 1],
        ];
  for (const [af, ar] of dirs) {
    const s = sq(af, ar);
    if (!s) continue;
    const p = board.get(s);
    if (p && p.type === "p" && p.color === byColor) return true;
  }
  return false;
}

export function safeLegalMovesPct(board: Chess, userColor: Color): number | null {
  if (board.turn() !== userColor) return null;
  const moves = board.moves({ verbose: true });
  if (!moves.length) return null;
  const opp = swapColor(userColor);
  let safe = 0;
  for (const m of moves) {
    if (!board.isAttacked(m.to as Square, opp)) safe += 1;
  }
  return Math.round((safe / moves.length) * 1000) / 10;
}

function isOutpostSquare(
  board: Chess,
  target: Square,
  color: Color
): boolean {
  const rank = squareRank(target);
  if (color === "w") {
    if (rank < 3 || rank > 5) return false;
  } else if (rank < 2 || rank > 4) {
    return false;
  }
  if (!isAttackedByPawn(board, target, color)) return false;
  if (isAttackedByPawn(board, target, swapColor(color))) return false;
  return true;
}

export function outpostControlCount(board: Chess, userColor: Color): number {
  let n = 0;
  for (const pt of ["n", "b"] as PieceSymbol[]) {
    for (const s of board.findPiece({ type: pt, color: userColor })) {
      if (isOutpostSquare(board, s, userColor)) n += 1;
    }
  }
  return n;
}

export function spaceAdvantagePct(board: Chess, userColor: Color): number {
  const opp = swapColor(userColor);
  const ranks = [2, 3, 4];
  let good = 0;
  let total = 0;
  for (const file of [2, 3, 4, 5]) {
    for (const rank of ranks) {
      total += 1;
      const s = sq(file, rank);
      if (!s) continue;
      if (isAttackedByPawn(board, s, opp)) continue;
      good += 1;
    }
  }
  return total ? Math.round((good / total) * 1000) / 10 : 0;
}

export function hasIsolatedQueenPawn(board: Chess, color: Color): boolean {
  const dFile = 3;
  let hasD = false;
  for (let rank = 0; rank < 8; rank += 1) {
    const s = sq(dFile, rank);
    if (!s) continue;
    const p = board.get(s);
    if (p && p.type === "p" && p.color === color) {
      hasD = true;
      break;
    }
  }
  if (!hasD) return false;
  for (const adj of [2, 4]) {
    for (let rank = 0; rank < 8; rank += 1) {
      const s = sq(adj, rank);
      if (!s) continue;
      const p = board.get(s);
      if (p && p.type === "p" && p.color === color) return false;
    }
  }
  return true;
}

export function hasDoubledPawns(board: Chess, color: Color): boolean {
  for (let file = 0; file < 8; file += 1) {
    let count = 0;
    for (let rank = 0; rank < 8; rank += 1) {
      const s = sq(file, rank);
      if (!s) continue;
      const p = board.get(s);
      if (p && p.type === "p" && p.color === color) count += 1;
    }
    if (count >= 2) return true;
  }
  return false;
}

export function hasBackwardPawn(board: Chess, color: Color): boolean {
  const dir = color === "w" ? 1 : -1;
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 0; rank < 8; rank += 1) {
      const s = sq(file, rank);
      if (!s) continue;
      const p = board.get(s);
      if (!p || p.type !== "p" || p.color !== color) continue;
      let behindNeighbors = true;
      for (const adj of [file - 1, file + 1]) {
        if (adj < 0 || adj > 7) continue;
        for (let r = 0; r < 8; r += 1) {
          const ns = sq(adj, r);
          if (!ns) continue;
          const np = board.get(ns);
          if (!np || np.type !== "p" || np.color !== color) continue;
          if (color === "w" ? r <= rank : r >= rank) {
            behindNeighbors = false;
          }
        }
      }
      if (!behindNeighbors) continue;
      const ahead = sq(file, rank + dir);
      if (!ahead || board.get(ahead)) continue;
      if (isAttackedByPawn(board, ahead, swapColor(color))) return true;
    }
  }
  return false;
}

export function pawnIslandCount(board: Chess, color: Color): number {
  const filesWith: boolean[] = [];
  for (let file = 0; file < 8; file += 1) {
    let has = false;
    for (let rank = 0; rank < 8; rank += 1) {
      const s = sq(file, rank);
      if (!s) continue;
      const p = board.get(s);
      if (p && p.type === "p" && p.color === color) {
        has = true;
        break;
      }
    }
    filesWith.push(has);
  }
  let islands = 0;
  let inIsland = false;
  for (const has of filesWith) {
    if (has && !inIsland) {
      islands += 1;
      inIsland = true;
    } else if (!has) {
      inIsland = false;
    }
  }
  return islands;
}

export type PawnShieldTracker = {
  armed: boolean;
  files: number[] | null;
  homeRank: number;
  compromised: boolean[];
};

export function createPawnShieldTracker(): PawnShieldTracker {
  return {
    armed: false,
    files: null,
    homeRank: 1,
    compromised: [false, false, false],
  };
}

export function armPawnShieldTracker(
  tracker: PawnShieldTracker,
  board: Chess,
  userColor: Color
): void {
  if (tracker.armed) return;
  const king = kingSquare(board, userColor);
  if (!king) return;
  const f = squareFile(king);
  const r = squareRank(king);
  const homeRank = userColor === "w" ? 0 : 7;
  if (r !== homeRank) return;
  let files: number[] | null = null;
  if (f >= 5) files = [5, 6, 7];
  else if (f <= 2) files = [0, 1, 2];
  if (!files) return;
  const pawnRank = userColor === "w" ? 1 : 6;
  tracker.armed = true;
  tracker.files = files;
  tracker.homeRank = pawnRank;
  tracker.compromised = files.map((file) => {
    const s = sq(file, pawnRank);
    if (!s) return true;
    const p = board.get(s);
    return !(p && p.type === "p" && p.color === userColor);
  });
}

export function updatePawnShieldTracker(
  tracker: PawnShieldTracker,
  move: { from: Square; to: Square; piece: string; color: Color; captured?: string },
  userColor: Color
): void {
  if (!tracker.armed || !tracker.files) return;
  for (let i = 0; i < tracker.files.length; i += 1) {
    if (tracker.compromised[i]) continue;
    const file = tracker.files[i];
    if (
      move.piece === "p" &&
      move.color === userColor &&
      squareFile(move.from) === file &&
      squareRank(move.from) === tracker.homeRank
    ) {
      tracker.compromised[i] = true;
      continue;
    }
    if (move.captured === "p") {
      const capturedColor = move.color === "w" ? "b" : "w";
      if (
        capturedColor === userColor &&
        squareFile(move.to) === file
      ) {
        tracker.compromised[i] = true;
      }
    }
  }
}

export function pawnShieldIntactPct(tracker: PawnShieldTracker): number | null {
  if (!tracker.armed || !tracker.files) return null;
  const intact = tracker.compromised.filter((c) => !c).length;
  return Math.round((intact / tracker.compromised.length) * 1000) / 10;
}

export function collectOutpostSquares(
  board: Chess,
  userColor: Color,
  seen: Set<string>
): void {
  for (const pt of ["n", "b"] as PieceSymbol[]) {
    for (const s of board.findPiece({ type: pt, color: userColor })) {
      if (isOutpostSquare(board, s, userColor)) seen.add(s);
    }
  }
}

export function pawnStructureChanged(move: {
  piece: string;
  captured?: string;
}): boolean {
  return move.piece === "p" || move.captured === "p";
}

export type PawnStructureSnapshot = {
  filesMine: number[];
  ranksMine: number[][];
};

export function snapshotPawnStructure(
  board: Chess,
  color: Color
): PawnStructureSnapshot {
  const filesMine = Array.from({ length: 8 }, () => 0);
  const ranksMine: number[][] = Array.from({ length: 8 }, () => []);
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 0; rank < 8; rank += 1) {
      const s = sq(file, rank);
      if (!s) continue;
      const p = board.get(s);
      if (!p || p.type !== "p" || p.color !== color) continue;
      filesMine[file] += 1;
      ranksMine[file].push(rank);
    }
  }
  return { filesMine, ranksMine };
}

function hasIsolatedQueenPawnFromSnap(snap: PawnStructureSnapshot): boolean {
  if ((snap.filesMine[3] || 0) <= 0) return false;
  return (snap.filesMine[2] || 0) === 0 && (snap.filesMine[4] || 0) === 0;
}

function hasDoubledPawnsFromSnap(snap: PawnStructureSnapshot): boolean {
  return snap.filesMine.some((count) => count >= 2);
}

function hasBackwardPawnFromSnap(
  board: Chess,
  color: Color,
  snap: PawnStructureSnapshot
): boolean {
  const dir = color === "w" ? 1 : -1;
  const opp = swapColor(color);
  for (let file = 0; file < 8; file += 1) {
    for (const rank of snap.ranksMine[file] || []) {
      let behindNeighbors = true;
      for (const adj of [file - 1, file + 1]) {
        if (adj < 0 || adj > 7) continue;
        for (const r of snap.ranksMine[adj] || []) {
          if (color === "w" ? r <= rank : r >= rank) {
            behindNeighbors = false;
            break;
          }
        }
        if (!behindNeighbors) break;
      }
      if (!behindNeighbors) continue;
      const ahead = sq(file, rank + dir);
      if (!ahead || board.get(ahead)) continue;
      if (isAttackedByPawn(board, ahead, opp)) return true;
    }
  }
  return false;
}

function pawnIslandCountFromSnap(snap: PawnStructureSnapshot): number {
  let islands = 0;
  let inIsland = false;
  for (const count of snap.filesMine) {
    const has = count > 0;
    if (has && !inIsland) {
      islands += 1;
      inIsland = true;
    } else if (!has) {
      inIsland = false;
    }
  }
  return islands;
}

function fileOpennessFromSnap(
  snap: PawnStructureSnapshot,
  filesOpp: number[],
  file: number
): "open" | "semi" | "closed" {
  const mine = snap.filesMine[file] || 0;
  const theirs = filesOpp[file] || 0;
  if (mine === 0 && theirs === 0) return "open";
  if (mine === 0 || theirs === 0) return "semi";
  return "closed";
}

export function stickyPawnFlags(
  board: Chess,
  userColor: Color,
  current: { iqp: boolean; doubled: boolean; backward: boolean }
): {
  iqp: boolean;
  doubled: boolean;
  doubledNow: boolean;
  backward: boolean;
} {
  const snap = snapshotPawnStructure(board, userColor);
  const doubledNow = hasDoubledPawnsFromSnap(snap);
  return {
    iqp: current.iqp || hasIsolatedQueenPawnFromSnap(snap),
    doubled: current.doubled,
    doubledNow,
    backward:
      current.backward ||
      hasBackwardPawnFromSnap(board, userColor, snap),
  };
}

export function sampleMiddlegamePosition(
  board: Chess,
  userColor: Color,
  options?: {
    checkIqp?: boolean;
    checkDoubled?: boolean;
    checkBackward?: boolean;
    castled?: boolean;
  }
): {
  attackers: number;
  shield: number | null;
  openFile: number;
  safe: number | null;
  outpost: number;
  space: number;
  islands: number;
  iqp: boolean;
  doubled: boolean;
  backward: boolean;
} {
  const snap = snapshotPawnStructure(board, userColor);
  const oppSnap = snapshotPawnStructure(board, swapColor(userColor));
  const king = kingSquare(board, userColor);
  let openFile = 0;
  if (king) {
    const kf = squareFile(king);
    let best = opennessScore(
      fileOpennessFromSnap(snap, oppSnap.filesMine, kf)
    );
    for (const adj of [kf - 1, kf + 1]) {
      if (adj < 0 || adj > 7) continue;
      const base = opennessScore(
        fileOpennessFromSnap(snap, oppSnap.filesMine, adj)
      );
      if (base > 0) best = Math.max(best, Math.round(base * 0.5));
    }
    const castled = options?.castled === true;
    const homeRank = userColor === "w" ? 0 : 7;
    if (castled && squareRank(king) === homeRank) {
      const rookFile = kf >= 5 ? 7 : kf <= 2 ? 0 : null;
      if (rookFile != null) {
        const base = opennessScore(
          fileOpennessFromSnap(snap, oppSnap.filesMine, rookFile)
        );
        if (base > 0) best = Math.max(best, Math.round(base * 0.6));
      }
    }
    openFile = best;
  }

  return {
    attackers: kingAttackersPct(board, userColor),
    shield: pawnShieldIntegrityPct(board, userColor),
    openFile,
    safe: safeLegalMovesPct(board, userColor),
    outpost: outpostControlCount(board, userColor),
    space: spaceAdvantagePct(board, userColor),
    islands: pawnIslandCountFromSnap(snap),
    iqp:
      options?.checkIqp === false ? false : hasIsolatedQueenPawnFromSnap(snap),
    doubled:
      options?.checkDoubled === false
        ? false
        : hasDoubledPawnsFromSnap(snap),
    backward:
      options?.checkBackward === false
        ? false
        : hasBackwardPawnFromSnap(board, userColor, snap),
  };
}

function emptyRow(result: string): MiddlegameGameRow {
  return {
    reached_middlegame: false,
    middlegame_start_ply: null,
    middlegame_end_ply: null,
    middlegame_accuracy_pct: null,
    middlegame_accuracy_moves: 0,
    middlegame_blunders: 0,
    middlegame_mistakes: 0,
    middlegame_inaccuracies: 0,
    middlegame_missed_opportunity_pct: null,
    middlegame_missed_tactic_pct: null,
    middlegame_allowed_tactic_pct: null,
    middlegame_king_attackers_score: null,
    middlegame_pawn_shield_pct: null,
    middlegame_open_file_proximity_pct: null,
    middlegame_safe_moves_pct: null,
    middlegame_outpost_control: null,
    middlegame_space_advantage_pct: null,
    had_iqp: false,
    had_doubled_pawns: false,
    had_backward_pawns: false,
    middlegame_pawn_islands_avg: null,
    result,
  };
}

export function analyzeMiddlegameGame(
  game: StudyGame,
  evalsWhiteCp?: number[] | null
): MiddlegameGameRow | null {
  const sans = parseSans(game);
  if (!sans.length) return null;

  const board = new Chess();
  const userIsWhite =
    String(game.user_color || "white").toLowerCase() === "white";
  const color: Color = userIsWhite ? "w" : "b";
  const result = String(game.result || "");
  const evals = evalsWhiteCp ? [...evalsWhiteCp] : [];
  let evalIdx = 0;
  const nextEval = (): number | null => {
    if (evalIdx < evals.length) {
      const cp = evals[evalIdx];
      evalIdx += 1;
      return cp;
    }
    return null;
  };

  let lastWhiteCp = nextEval();
  let castleFullmove: number | null = null;
  let phaseEnd = openingPhaseEndFullmove(null);
  let endgameStartPly: number | null = null;

  const attackerScores: number[] = [];
  const safeMoveScores: number[] = [];
  const spaceScores: number[] = [];
  const outpostSeen = new Set<string>();
  const shieldTracker = createPawnShieldTracker();
  const openFileTracker = createOpenFileTracker();
  let islandSum = 0;
  let islandScans = 0;
  const accuracySamples: number[] = [];
  let blunders = 0;
  let mistakes = 0;
  let inaccuracies = 0;
  let hadIqp = false;
  let hadDoubled = false;
  let hadBackward = false;
  let doubledNow = false;
  let doubledStreak = 0;
  let seenMg = false;
  let mgStart: number | null = null;
  let mgEnd: number | null = null;
  let mgSampleIdx = 0;

  let pendingOppBlunder = false;
  let pendingOppTactic = false;
  let pendingOppWp: number | null = null;
  let missedOppChances = 0;
  let missedOpps = 0;
  let missedTacticChances = 0;
  let missedTactics = 0;
  let pendingAllowed = false;
  let allowedChances = 0;
  let allowedFound = 0;

  for (let plyIdx = 0; plyIdx < sans.length; plyIdx += 1) {
    let move = null;
    try {
      move = board.move(sans[plyIdx]);
    } catch {
      move = null;
    }
    if (!move) break;
    board.undo();

    const fullMove = Math.floor(plyIdx / 2) + 1;
    const isUser = board.turn() === color;
    const isCastle = move.isKingsideCastle() || move.isQueensideCastle();
    if (isUser && isCastle && castleFullmove == null) {
      castleFullmove = fullMove;
      phaseEnd = openingPhaseEndFullmove(castleFullmove);
    }

    const cpBeforeWhite = lastWhiteCp;
    const wpBefore =
      cpBeforeWhite != null
        ? userWinProbability(cpBeforeWhite, userIsWhite)
        : null;

    board.move(move);

    const cpAfterWhite = nextEval();
    if (cpAfterWhite != null) lastWhiteCp = cpAfterWhite;
    const wpAfter =
      cpAfterWhite != null
        ? userWinProbability(cpAfterWhite, userIsWhite)
        : null;

    if (
      endgameStartPly == null &&
      nonPawnPieceCount(board) <= ENDGAME_NON_PAWN_MAX
    ) {
      endgameStartPly = plyIdx;
    }

    const inMg = inMiddlegamePly(plyIdx, phaseEnd, endgameStartPly);
    if (!inMg) {
      if (!isUser && pendingAllowed) {
        pendingAllowed = false;
      }
      if (isUser && pendingOppBlunder) {
        pendingOppBlunder = false;
        pendingOppTactic = false;
        pendingOppWp = null;
      }
      continue;
    }

    seenMg = true;
    if (mgStart == null) mgStart = middlegameStartPly(phaseEnd);
    mgEnd = endgameStartPly != null ? endgameStartPly : plyIdx + 1;

    armPawnShieldTracker(shieldTracker, board, color);
    updatePawnShieldTracker(
      shieldTracker,
      {
        from: move.from,
        to: move.to,
        piece: move.piece,
        color: move.color,
        captured: move.captured,
      },
      color
    );
    armOpenFileTracker(openFileTracker, board, color, {
      castled: castleFullmove != null,
    });
    updateOpenFileTracker(
      openFileTracker,
      {
        from: move.from,
        to: move.to,
        piece: move.piece,
        color: move.color,
        captured: move.captured,
        promotion: move.promotion,
      },
      color,
      { castled: castleFullmove != null }
    );

    if (mgSampleIdx % HEURISTICS_MG_SAMPLE_EVERY === 0) {
      if (hasIsolatedQueenPawn(board, color)) hadIqp = true;
      if (hasBackwardPawn(board, color)) hadBackward = true;
      doubledNow = hasDoubledPawns(board, color);
      collectOutpostSquares(board, color, outpostSeen);
    } else if (pawnStructureChanged(move)) {
      if (!hadIqp && hasIsolatedQueenPawn(board, color)) hadIqp = true;
      if (!hadBackward && hasBackwardPawn(board, color)) hadBackward = true;
      doubledNow = hasDoubledPawns(board, color);
    }

    if (doubledNow) {
      doubledStreak += 1;
      if (doubledStreak >= HEURISTICS_DOUBLED_PERSIST_PLIES) hadDoubled = true;
    } else {
      doubledStreak = 0;
    }

    if (mgSampleIdx % HEURISTICS_MG_ISLANDS_EVERY === 0) {
      islandSum += pawnIslandCount(board, color);
      islandScans += 1;
    }

    if (mgSampleIdx % HEURISTICS_MG_ATTACKERS_EVERY === 0) {
      attackerScores.push(kingAttackersPct(board, color));
    }
    if (mgSampleIdx % HEURISTICS_MG_SPACE_EVERY === 0) {
      spaceScores.push(spaceAdvantagePct(board, color));
    }
    if (
      mgSampleIdx % HEURISTICS_MG_SAFE_EVERY === 0 &&
      board.turn() === color
    ) {
      const safe = safeLegalMovesPct(board, color);
      if (safe != null) safeMoveScores.push(safe);
    }
    mgSampleIdx += 1;

    if (isUser && wpBefore != null && wpAfter != null) {
      accuracySamples.push(moveAccuracyPct(wpBefore * 100, wpAfter * 100));
      const kind = classifyEvalDrop(wpBefore, wpAfter);
      if (kind === "blunder") blunders += 1;
      else if (kind === "mistake") mistakes += 1;
      else if (kind === "inaccuracy") inaccuracies += 1;
    }

    if (isUser && pendingOppBlunder) {
      missedOppChances += 1;
      if (pendingOppTactic) missedTacticChances += 1;
      const missed =
        wpBefore != null &&
        wpAfter != null &&
        (isMistakeOrWorse(wpBefore, wpAfter) ||
          (pendingOppWp != null &&
            wpDropPp(pendingOppWp, wpAfter) >= 10));
      if (missed) {
        missedOpps += 1;
        if (pendingOppTactic) missedTactics += 1;
      }
      pendingOppBlunder = false;
      pendingOppTactic = false;
      pendingOppWp = null;
    }

    if (!isUser && pendingAllowed) {
      const found =
        (wpBefore != null &&
          wpAfter != null &&
          wpDropPp(wpBefore, wpAfter) >= 7.5) ||
        move.isCapture();
      if (found) allowedFound += 1;
      pendingAllowed = false;
    }

    if (!isUser && wpBefore != null && wpAfter != null) {
      if (isBlunderSwingUp(wpBefore, wpAfter)) {
        pendingOppBlunder = true;
        pendingOppWp = wpAfter;
        pendingOppTactic = hasMaterialWinTactic(board, color);
      }
    }

    if (isUser && wpBefore != null && wpAfter != null) {
      if (
        classifyEvalDrop(wpBefore, wpAfter) === "blunder" &&
        hasMaterialWinTactic(board, swapColor(color))
      ) {
        allowedChances += 1;
        pendingAllowed = true;
      }
    }
  }

  if (!seenMg) return emptyRow(result);

  return {
    reached_middlegame: true,
    middlegame_start_ply: mgStart,
    middlegame_end_ply: mgEnd,
    middlegame_accuracy_pct: mean(accuracySamples, 1),
    middlegame_accuracy_moves: accuracySamples.length,
    middlegame_blunders: blunders,
    middlegame_mistakes: mistakes,
    middlegame_inaccuracies: inaccuracies,
    middlegame_missed_opportunity_pct: missedOppChances
      ? Math.round((missedOpps / missedOppChances) * 1000) / 10
      : null,
    middlegame_missed_tactic_pct: missedTacticChances
      ? Math.round((missedTactics / missedTacticChances) * 1000) / 10
      : null,
    middlegame_allowed_tactic_pct: allowedChances
      ? Math.round((allowedFound / allowedChances) * 1000) / 10
      : null,
    middlegame_king_attackers_score: mean(attackerScores, 1),
    middlegame_pawn_shield_pct: pawnShieldIntactPct(shieldTracker),
    middlegame_open_file_proximity_pct: openFileTrackerPct(openFileTracker),
    middlegame_safe_moves_pct: mean(safeMoveScores, 1),
    middlegame_outpost_control: outpostSeen.size,
    middlegame_space_advantage_pct: mean(spaceScores, 1),
    had_iqp: hadIqp,
    had_doubled_pawns: hadDoubled,
    had_backward_pawns: hadBackward,
    middlegame_pawn_islands_avg:
      islandScans > 0
        ? Math.round((islandSum / islandScans) * 100) / 100
        : null,
    result,
  };
}

export function aggregateMiddlegameMetrics(
  rows: MiddlegameGameRow[]
): MiddlegameMetricsAggregate {
  const mg = rows.filter((r) => r.reached_middlegame);
  const empty: MiddlegameMetricsAggregate = {
    games: rows.length,
    middlegame_games: 0,
    middlegame_accuracy_pct: null,
    middlegame_accuracy_games: 0,
    middlegame_blunder_avg: null,
    middlegame_mistake_avg: null,
    middlegame_inaccuracy_avg: null,
    middlegame_missed_opportunity_pct: null,
    middlegame_missed_tactic_pct: null,
    middlegame_allowed_tactic_pct: null,
    middlegame_king_attackers_score: null,
    middlegame_pawn_shield_pct: null,
    middlegame_open_file_proximity_pct: null,
    middlegame_safe_moves_pct: null,
    middlegame_outpost_control_avg: null,
    middlegame_space_advantage_pct: null,
    middlegame_iqp_win_rate_pct: null,
    middlegame_doubled_pawns_game_pct: null,
    middlegame_backward_pawns_game_pct: null,
    middlegame_pawn_islands_avg: null,
  };
  if (!mg.length) return { ...empty, games: rows.length };

  const accuracy = mg
    .map((r) => r.middlegame_accuracy_pct)
    .filter((v): v is number => v != null);
  const iqpGames = mg.filter((r) => r.had_iqp);
  const iqpWins = iqpGames.filter((r) => r.result === "Win").length;

  return {
    games: rows.length,
    middlegame_games: mg.length,
    middlegame_accuracy_pct: mean(accuracy, 1),
    middlegame_accuracy_games: accuracy.length,
    middlegame_blunder_avg: mean(
      mg.map((r) => r.middlegame_blunders),
      2
    ),
    middlegame_mistake_avg: mean(
      mg.map((r) => r.middlegame_mistakes),
      2
    ),
    middlegame_inaccuracy_avg: mean(
      mg.map((r) => r.middlegame_inaccuracies),
      2
    ),
    middlegame_missed_opportunity_pct: mean(
      mg
        .map((r) => r.middlegame_missed_opportunity_pct)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_missed_tactic_pct: mean(
      mg
        .map((r) => r.middlegame_missed_tactic_pct)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_allowed_tactic_pct: mean(
      mg
        .map((r) => r.middlegame_allowed_tactic_pct)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_king_attackers_score: mean(
      mg
        .map((r) => r.middlegame_king_attackers_score)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_pawn_shield_pct: mean(
      mg
        .map((r) => r.middlegame_pawn_shield_pct)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_open_file_proximity_pct: mean(
      mg
        .map((r) => r.middlegame_open_file_proximity_pct)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_safe_moves_pct: mean(
      mg
        .map((r) => r.middlegame_safe_moves_pct)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_outpost_control_avg: mean(
      mg
        .map((r) => r.middlegame_outpost_control)
        .filter((v): v is number => v != null),
      2
    ),
    middlegame_space_advantage_pct: mean(
      mg
        .map((r) => r.middlegame_space_advantage_pct)
        .filter((v): v is number => v != null),
      1
    ),
    middlegame_iqp_win_rate_pct: iqpGames.length
      ? Math.round((iqpWins / iqpGames.length) * 1000) / 10
      : null,
    middlegame_doubled_pawns_game_pct: Math.round(
      (mg.filter((r) => r.had_doubled_pawns).length / mg.length) * 1000
    ) / 10,
    middlegame_backward_pawns_game_pct: Math.round(
      (mg.filter((r) => r.had_backward_pawns).length / mg.length) * 1000
    ) / 10,
    middlegame_pawn_islands_avg: mean(
      mg
        .map((r) => r.middlegame_pawn_islands_avg)
        .filter((v): v is number => v != null),
      2
    ),
  };
}

export function mergeMiddlegameHeuristicWithBucket(
  heuristic: MiddlegameGameRow,
  bucket: MiddlegameEvalBucket | null | undefined
): MiddlegameGameRow {
  if (!bucket) return heuristic;
  return {
    ...heuristic,
    middlegame_accuracy_pct: bucket.accuracy_pct,
    middlegame_accuracy_moves: bucket.accuracy_moves,
    middlegame_blunders: bucket.blunders,
    middlegame_mistakes: bucket.mistakes,
    middlegame_inaccuracies: bucket.inaccuracies,
    middlegame_missed_opportunity_pct: bucket.missed_opportunity_chances
      ? Math.round(
          (bucket.missed_opportunities / bucket.missed_opportunity_chances) *
            1000
        ) / 10
      : null,
    middlegame_missed_tactic_pct: bucket.missed_tactic_chances
      ? Math.round(
          (bucket.missed_tactics / bucket.missed_tactic_chances) * 1000
        ) / 10
      : null,
    middlegame_allowed_tactic_pct: bucket.allowed_tactic_chances
      ? Math.round(
          (bucket.allowed_tactics_found / bucket.allowed_tactic_chances) *
            1000
        ) / 10
      : null,
  };
}

export function heuristicMiddlegameFromPass(input: {
  reached: boolean;
  startPly: number | null;
  endPly: number | null;
  attackerScores: number[];
  shieldPct: number | null;
  openFilePct: number | null;
  safeMoveScores: number[];
  outpostUnique: number;
  spaceScores: number[];
  islandAvg: number | null;
  hadIqp: boolean;
  hadDoubled: boolean;
  hadBackward: boolean;
  result: string;
}): MiddlegameGameRow {
  if (!input.reached) return emptyRow(input.result);
  return {
    reached_middlegame: true,
    middlegame_start_ply: input.startPly,
    middlegame_end_ply: input.endPly,
    middlegame_accuracy_pct: null,
    middlegame_accuracy_moves: 0,
    middlegame_blunders: 0,
    middlegame_mistakes: 0,
    middlegame_inaccuracies: 0,
    middlegame_missed_opportunity_pct: null,
    middlegame_missed_tactic_pct: null,
    middlegame_allowed_tactic_pct: null,
    middlegame_king_attackers_score: mean(input.attackerScores, 1),
    middlegame_pawn_shield_pct: input.shieldPct,
    middlegame_open_file_proximity_pct: input.openFilePct,
    middlegame_safe_moves_pct: mean(input.safeMoveScores, 1),
    middlegame_outpost_control: input.outpostUnique,
    middlegame_space_advantage_pct: mean(input.spaceScores, 1),
    had_iqp: input.hadIqp,
    had_doubled_pawns: input.hadDoubled,
    had_backward_pawns: input.hadBackward,
    middlegame_pawn_islands_avg: input.islandAvg,
    result: input.result,
  };
}
