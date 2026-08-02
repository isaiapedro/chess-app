import { Chess, type Color, type Move } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
import {
  classifyTheoretical,
  ENDGAME_NON_PAWN_MAX,
  kingCentralizationScore,
  kingDistanceToEnemyPawns,
  nonPawnPieceCount,
  type EndgameGameRow,
  type TheoreticalKey,
} from "./endgamePhase";
import {
  hasBackwardPawn,
  hasDoubledPawns,
  hasIsolatedQueenPawn,
  heuristicMiddlegameFromPass,
  inMiddlegamePly,
  kingAttackersScore,
  middlegameStartPly,
  openFileProximityPct,
  outpostControlCount,
  pawnIslandCount,
  pawnShieldIntegrityPct,
  safeLegalMovesPct,
  spaceAdvantagePct,
  type MiddlegameGameRow,
} from "./middlegamePhase";
import {
  centerControlShare,
  countMinorsDeveloped,
  DEVELOPMENT_CHECK_FULLMOVE,
  openingPhaseEndFullmove,
  type OpeningGameRow,
} from "./openingPhase";
import { parseSans } from "./styleMetrics";

function mean(vals: number[], digits = 1): number | null {
  if (!vals.length) return null;
  const factor = 10 ** digits;
  return (
    Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * factor) /
    factor
  );
}

function pawnDiffForUser(board: Chess, color: Color): number {
  const user = board.findPiece({ type: "p", color }).length;
  const opp = board.findPiece({
    type: "p",
    color: color === "w" ? "b" : "w",
  }).length;
  return user - opp;
}

function emptyEndgame(result: string): EndgameGameRow {
  return {
    reached_endgame: false,
    endgame_start_ply: null,
    blunders: 0,
    king_centralization: null,
    king_distance: null,
    pawn_diff: null,
    piece_trades: 0,
    beneficial_trades: 0,
    winning_trades: 0,
    simplification_trades: 0,
    mate_episodes: 0,
    mate_converted: 0,
    accidental_stalemate: false,
    mate_move_times: [],
    theoretical: {},
    theoretical_saved: false,
    result,
  };
}

export type HeuristicGameMetrics = {
  opening: OpeningGameRow | null;
  middlegame: MiddlegameGameRow | null;
  endgame: EndgameGameRow | null;
};

export function analyzeHeuristicGame(game: StudyGame): HeuristicGameMetrics {
  const sans = parseSans(game);
  if (!sans.length) {
    return { opening: null, middlegame: null, endgame: null };
  }

  const board = new Chess();
  const userIsWhite =
    String(game.user_color || "white").toLowerCase() === "white";
  const color: Color = userIsWhite ? "w" : "b";
  const result = String(game.result || "");

  let castleFullmove: number | null = null;
  let phaseEnd = openingPhaseEndFullmove(null);
  const centerSamples: number[] = [];
  let tempoMoves = 0;
  let tempoWastes = 0;
  const timesMoved = new Map<string, number>();
  let minorsAt10: number | null = null;
  let openingClosed = false;

  let endgameStartPly: number | null = null;
  const centerScores: number[] = [];
  const kingDists: number[] = [];
  const pawnDiffs: number[] = [];
  const theoretical: Partial<Record<TheoreticalKey, true>> = {};
  let theoreticalSaved = false;

  const mgAttacker: number[] = [];
  const mgShield: number[] = [];
  const mgOpenFile: number[] = [];
  const mgSafe: number[] = [];
  const mgOutpost: number[] = [];
  const mgSpace: number[] = [];
  const mgIslands: number[] = [];
  let mgHadIqp = false;
  let mgHadDoubled = false;
  let mgHadBackward = false;
  let mgSeen = false;
  let mgStart: number | null = null;
  let mgEnd: number | null = null;

  for (let plyIdx = 0; plyIdx < sans.length; plyIdx += 1) {
    let move: Move | null = null;
    try {
      move = board.move(sans[plyIdx]) as Move;
    } catch {
      move = null;
    }
    if (!move) break;
    board.undo();

    const fullMove = Math.floor(plyIdx / 2) + 1;
    const isUser = board.turn() === color;
    const moving = board.get(move.from);
    const isCastle = move.isKingsideCastle() || move.isQueensideCastle();

    if (!openingClosed) {
      if (isUser && isCastle && castleFullmove == null) {
        castleFullmove = fullMove;
        phaseEnd = openingPhaseEndFullmove(castleFullmove);
      }
      const inPhase = fullMove <= phaseEnd;
      if (isUser && moving && inPhase && moving.type !== "p") {
        tempoMoves += 1;
        const prior = timesMoved.get(move.from) || 0;
        const developed = countMinorsDeveloped(board, color);
        if (prior >= 1 && developed < 4) tempoWastes += 1;
        timesMoved.set(move.to, prior + 1);
        if (move.to !== move.from) timesMoved.set(move.from, 0);
      }
    }

    board.move(move);

    if (
      !openingClosed &&
      minorsAt10 == null &&
      fullMove === DEVELOPMENT_CHECK_FULLMOVE &&
      board.turn() === "w"
    ) {
      minorsAt10 = countMinorsDeveloped(board, color);
    }

    if (!openingClosed && fullMove <= phaseEnd) {
      centerSamples.push(centerControlShare(board, color));
    }

    if (
      !openingClosed &&
      ((fullMove > phaseEnd && castleFullmove != null) || fullMove > 40)
    ) {
      openingClosed = true;
    }

    if (
      endgameStartPly == null &&
      nonPawnPieceCount(board) <= ENDGAME_NON_PAWN_MAX
    ) {
      endgameStartPly = plyIdx;
    }

    if (inMiddlegamePly(plyIdx, phaseEnd, endgameStartPly)) {
      mgSeen = true;
      if (mgStart == null) mgStart = middlegameStartPly(phaseEnd);
      mgEnd = endgameStartPly != null ? endgameStartPly : plyIdx + 1;
      mgAttacker.push(kingAttackersScore(board, color));
      const shield = pawnShieldIntegrityPct(board, color);
      if (shield != null) mgShield.push(shield);
      mgOpenFile.push(openFileProximityPct(board, color));
      const safe = safeLegalMovesPct(board, color);
      if (safe != null) mgSafe.push(safe);
      mgOutpost.push(outpostControlCount(board, color));
      mgSpace.push(spaceAdvantagePct(board, color));
      mgIslands.push(pawnIslandCount(board, color));
      if (hasIsolatedQueenPawn(board, color)) mgHadIqp = true;
      if (hasDoubledPawns(board, color)) mgHadDoubled = true;
      if (hasBackwardPawn(board, color)) mgHadBackward = true;
    }

    if (endgameStartPly != null && plyIdx >= endgameStartPly) {
      const centr = kingCentralizationScore(board, color);
      if (centr != null) centerScores.push(centr);
      const dist = kingDistanceToEnemyPawns(board, color);
      if (dist != null) kingDists.push(dist);
      pawnDiffs.push(pawnDiffForUser(board, color));
      const te = classifyTheoretical(board, color);
      if (te) {
        if (!te.advantageOnly || te.userHasAdvantage) {
          theoretical[te.key] = true;
        } else {
          theoreticalSaved = true;
        }
      }
    }
  }

  if (minorsAt10 == null) {
    minorsAt10 = countMinorsDeveloped(board, color);
  }

  const opening: OpeningGameRow = {
    opening_accuracy_pct: null,
    opening_minors_developed_by_10: minorsAt10,
    opening_center_control_pct: mean(centerSamples, 1),
    opening_castle_fullmove: castleFullmove,
    uncastled: castleFullmove == null,
    opening_tempo_waste_rate_pct:
      tempoMoves > 0
        ? Math.round((tempoWastes / tempoMoves) * 1000) / 10
        : null,
    accuracy_moves: 0,
    phase_end_fullmove: openingPhaseEndFullmove(castleFullmove),
    user_color: String(game.user_color || "white"),
    opening_eco: game.opening_eco,
    opening_name: game.opening_name,
    result: game.result,
  };

  const middlegame = heuristicMiddlegameFromPass({
    reached: mgSeen,
    startPly: mgStart,
    endPly: mgEnd,
    attackerScores: mgAttacker,
    shieldScores: mgShield,
    openFileScores: mgOpenFile,
    safeMoveScores: mgSafe,
    outpostCounts: mgOutpost,
    spaceScores: mgSpace,
    islandScores: mgIslands,
    hadIqp: mgHadIqp,
    hadDoubled: mgHadDoubled,
    hadBackward: mgHadBackward,
    result,
  });

  const endgame: EndgameGameRow =
    endgameStartPly == null
      ? emptyEndgame(result)
      : {
          reached_endgame: true,
          endgame_start_ply: endgameStartPly,
          blunders: 0,
          king_centralization: mean(centerScores, 2),
          king_distance: mean(kingDists, 2),
          pawn_diff: mean(pawnDiffs, 2),
          piece_trades: 0,
          beneficial_trades: 0,
          winning_trades: 0,
          simplification_trades: 0,
          mate_episodes: 0,
          mate_converted: 0,
          accidental_stalemate: false,
          mate_move_times: [],
          theoretical,
          theoretical_saved: theoreticalSaved,
          result,
        };

  return { opening, middlegame, endgame };
}

export async function analyzeHeuristicGamesBatched(
  games: StudyGame[],
  options?: {
    batchSize?: number;
    signal?: { cancelled: boolean };
    onPartial?: (
      openingRows: OpeningGameRow[],
      middlegameRows: MiddlegameGameRow[],
      endgameRows: EndgameGameRow[],
      gameIds: string[],
      scanned: number,
      total: number
    ) => void;
  }
): Promise<{
  openingRows: OpeningGameRow[];
  middlegameRows: MiddlegameGameRow[];
  endgameRows: EndgameGameRow[];
  gameIds: string[];
}> {
  const batchSize = options?.batchSize ?? 4;
  const openingRows: OpeningGameRow[] = [];
  const middlegameRows: MiddlegameGameRow[] = [];
  const endgameRows: EndgameGameRow[] = [];
  const gameIds: string[] = [];
  const total = games.length;
  for (let i = 0; i < games.length; i += batchSize) {
    if (options?.signal?.cancelled) break;
    const chunk = games.slice(i, i + batchSize);
    for (const game of chunk) {
      const row = analyzeHeuristicGame(game);
      if (!row.opening || !row.middlegame || !row.endgame) continue;
      openingRows.push(row.opening);
      middlegameRows.push(row.middlegame);
      endgameRows.push(row.endgame);
      gameIds.push(String(game.id));
    }
    const scanned = Math.min(i + batchSize, total);
    options?.onPartial?.(
      [...openingRows],
      [...middlegameRows],
      [...endgameRows],
      [...gameIds],
      scanned,
      total
    );
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  }
  return { openingRows, middlegameRows, endgameRows, gameIds };
}
