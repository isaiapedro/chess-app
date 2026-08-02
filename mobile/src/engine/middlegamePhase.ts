import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
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
import { userWinProbability, WP_BLUNDER_DROP } from "./winProb";

export { inMiddlegamePly, middlegameStartPly } from "./middlegameBounds";

const PIECE_POWER = STYLE_PIECE_VALUE;
const FILES = "abcdefgh";

export type MiddlegameEvalBucket = {
  accuracy_pct: number | null;
  accuracy_moves: number;
  blunders: number;
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
  let weight = 0;
  for (const zoneSq of kingZoneSquares(king)) {
    for (const atk of board.attackers(zoneSq, opp)) {
      const piece = board.get(atk);
      if (!piece || piece.type === "k") continue;
      const v = PIECE_POWER[piece.type] || 0;
      weight += v;
    }
  }
  return weight * weight;
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
  if (mine === 0 && theirs > 0) return "semi";
  return "closed";
}

function opennessScore(kind: "open" | "semi" | "closed"): number {
  if (kind === "open") return 100;
  if (kind === "semi") return 70;
  return 0;
}

export function openFileProximityPct(
  board: Chess,
  userColor: Color
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
  const homeRank = userColor === "w" ? 0 : 7;
  if (squareRank(king) === homeRank) {
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
    if (!isAttackedByPawn(board, m.to as Square, opp)) safe += 1;
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
  const ranks =
    userColor === "w"
      ? [1, 2, 3, 4]
      : [6, 5, 4, 3];
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

function emptyRow(result: string): MiddlegameGameRow {
  return {
    reached_middlegame: false,
    middlegame_start_ply: null,
    middlegame_end_ply: null,
    middlegame_accuracy_pct: null,
    middlegame_accuracy_moves: 0,
    middlegame_blunders: 0,
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
  const shieldScores: number[] = [];
  const openFileScores: number[] = [];
  const safeMoveScores: number[] = [];
  const outpostCounts: number[] = [];
  const spaceScores: number[] = [];
  const islandScores: number[] = [];
  const accuracySamples: number[] = [];
  let blunders = 0;
  let hadIqp = false;
  let hadDoubled = false;
  let hadBackward = false;
  let seenMg = false;
  let mgStart: number | null = null;
  let mgEnd: number | null = null;

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

    attackerScores.push(kingAttackersScore(board, color));
    const shield = pawnShieldIntegrityPct(board, color);
    if (shield != null) shieldScores.push(shield);
    openFileScores.push(openFileProximityPct(board, color));
    const safe = safeLegalMovesPct(board, color);
    if (safe != null) safeMoveScores.push(safe);
    outpostCounts.push(outpostControlCount(board, color));
    spaceScores.push(spaceAdvantagePct(board, color));
    islandScores.push(pawnIslandCount(board, color));
    if (hasIsolatedQueenPawn(board, color)) hadIqp = true;
    if (hasDoubledPawns(board, color)) hadDoubled = true;
    if (hasBackwardPawn(board, color)) hadBackward = true;

    if (isUser && wpBefore != null && wpAfter != null) {
      accuracySamples.push(moveAccuracyPct(wpBefore * 100, wpAfter * 100));
      if (wpBefore - wpAfter >= WP_BLUNDER_DROP) blunders += 1;
    }

    if (isUser && pendingOppBlunder) {
      missedOppChances += 1;
      if (pendingOppTactic) missedTacticChances += 1;
      const missed =
        wpBefore != null &&
        wpAfter != null &&
        (wpBefore - wpAfter >= WP_BLUNDER_DROP ||
          (pendingOppWp != null &&
            pendingOppWp - wpAfter >= WP_BLUNDER_DROP));
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
          wpBefore - wpAfter >= WP_BLUNDER_DROP * 0.5) ||
        move.isCapture();
      if (found) allowedFound += 1;
      pendingAllowed = false;
    }

    if (!isUser && wpBefore != null && wpAfter != null) {
      if (wpAfter - wpBefore >= WP_BLUNDER_DROP) {
        pendingOppBlunder = true;
        pendingOppWp = wpAfter;
        pendingOppTactic = hasMaterialWinTactic(board, color);
      }
    }

    if (isUser && wpBefore != null && wpAfter != null) {
      if (
        wpBefore - wpAfter >= WP_BLUNDER_DROP &&
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
    middlegame_pawn_shield_pct: mean(shieldScores, 1),
    middlegame_open_file_proximity_pct: mean(openFileScores, 1),
    middlegame_safe_moves_pct: mean(safeMoveScores, 1),
    middlegame_outpost_control: mean(outpostCounts, 2),
    middlegame_space_advantage_pct: mean(spaceScores, 1),
    had_iqp: hadIqp,
    had_doubled_pawns: hadDoubled,
    had_backward_pawns: hadBackward,
    middlegame_pawn_islands_avg: mean(islandScores, 2),
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
  shieldScores: number[];
  openFileScores: number[];
  safeMoveScores: number[];
  outpostCounts: number[];
  spaceScores: number[];
  islandScores: number[];
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
    middlegame_missed_opportunity_pct: null,
    middlegame_missed_tactic_pct: null,
    middlegame_allowed_tactic_pct: null,
    middlegame_king_attackers_score: mean(input.attackerScores, 1),
    middlegame_pawn_shield_pct: mean(input.shieldScores, 1),
    middlegame_open_file_proximity_pct: mean(input.openFileScores, 1),
    middlegame_safe_moves_pct: mean(input.safeMoveScores, 1),
    middlegame_outpost_control: mean(input.outpostCounts, 2),
    middlegame_space_advantage_pct: mean(input.spaceScores, 1),
    had_iqp: input.hadIqp,
    had_doubled_pawns: input.hadDoubled,
    had_backward_pawns: input.hadBackward,
    middlegame_pawn_islands_avg: mean(input.islandScores, 2),
    result: input.result,
  };
}
