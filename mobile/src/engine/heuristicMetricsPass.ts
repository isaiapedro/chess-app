import { Chess, type Color, type Move } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
import {
  HEURISTICS_DOUBLED_PERSIST_PLIES,
  HEURISTICS_EG_KING_EVERY,
  HEURISTICS_EG_THEORETICAL_EVERY,
  HEURISTICS_IDLE_BATCH_SIZE,
  HEURISTICS_MG_ATTACKERS_EVERY,
  HEURISTICS_MG_ISLANDS_EVERY,
  HEURISTICS_MG_SAFE_EVERY,
  HEURISTICS_MG_SAMPLE_EVERY,
  HEURISTICS_MG_SPACE_EVERY,
  HEURISTICS_PLY_YIELD_EVERY,
} from "./analysisConfig";
import {
  classifyTheoretical,
  ENDGAME_NON_PAWN_MAX,
  kingCentralizationScore,
  kingDistanceToEnemyPawns,
  nonPawnPieceCount,
  pawnDiffDeltaForCapture,
  type EndgameGameRow,
  type TheoreticalKey,
} from "./endgamePhase";
import {
  armOpenFileTracker,
  armPawnShieldTracker,
  collectOutpostSquares,
  createOpenFileTracker,
  createPawnShieldTracker,
  heuristicMiddlegameFromPass,
  inMiddlegamePly,
  kingAttackersPct,
  middlegameStartPly,
  openFileTrackerPct,
  pawnIslandCount,
  pawnShieldIntactPct,
  pawnStructureChanged,
  safeLegalMovesPct,
  spaceAdvantagePct,
  stickyPawnFlags,
  updateOpenFileTracker,
  updatePawnShieldTracker,
  type MiddlegameGameRow,
} from "./middlegamePhase";
import {
  centerControlShare,
  countMinorsEverDeveloped,
  DEVELOPMENT_CHECK_FULLMOVE,
  noteMinorLeftHome,
  openingPhaseEndFullmove,
  type OpeningGameRow,
} from "./openingPhase";
import { parseSans } from "./styleMetrics";
import { hasPuzzleDemand, yieldForUi } from "./backgroundWork";

function mean(vals: number[], digits = 1): number | null {
  if (!vals.length) return null;
  const factor = 10 ** digits;
  return (
    Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * factor) /
    factor
  );
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

export async function analyzeHeuristicGame(
  game: StudyGame,
  options?: { signal?: { cancelled: boolean } }
): Promise<HeuristicGameMetrics> {
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
  let pawnMoves = 0;
  const timesMoved = new Map<string, number>();
  const developedHomes = new Set<string>();
  let minorsAt10: number | null = null;
  let openingClosed = false;

  let endgameStartPly: number | null = null;
  const centerScores: number[] = [];
  const kingDists: number[] = [];
  let pawnDiff = 0;
  let egKingSampleIdx = 0;
  const theoretical: Partial<Record<TheoreticalKey, true>> = {};
  let theoreticalSaved = false;

  const mgAttacker: number[] = [];
  const mgSafe: number[] = [];
  const mgSpace: number[] = [];
  const outpostSeen = new Set<string>();
  const shieldTracker = createPawnShieldTracker();
  const openFileTracker = createOpenFileTracker();
  let mgHadIqp = false;
  let mgHadDoubled = false;
  let mgHadBackward = false;
  let mgSeen = false;
  let mgStart: number | null = null;
  let mgEnd: number | null = null;
  let mgSampleIdx = 0;
  let islandSum = 0;
  let islandScans = 0;
  let lastNonPawnCount: number | null = null;
  let doubledNow = false;
  let doubledStreak = 0;

  for (let plyIdx = 0; plyIdx < sans.length; plyIdx += 1) {
    if (options?.signal?.cancelled) {
      return { opening: null, middlegame: null, endgame: null };
    }
    if (plyIdx > 0 && plyIdx % HEURISTICS_PLY_YIELD_EVERY === 0) {
      await yieldForUi({ heavy: true });
      if (options?.signal?.cancelled) {
        return { opening: null, middlegame: null, endgame: null };
      }
    }

    let move: Move | null = null;
    try {
      move = board.move(sans[plyIdx]) as Move;
    } catch {
      move = null;
    }
    if (!move) break;

    const fullMove = Math.floor(plyIdx / 2) + 1;
    const isUser = move.color === color;
    const isCastle = move.isKingsideCastle() || move.isQueensideCastle();

    if (!openingClosed) {
      if (isUser && isCastle && castleFullmove == null) {
        castleFullmove = fullMove;
        phaseEnd = openingPhaseEndFullmove(castleFullmove);
      }
      const inPhase = fullMove <= phaseEnd;
      if (isUser && inPhase && move.piece !== "p") {
        tempoMoves += 1;
        const prior = timesMoved.get(move.from) || 0;
        if (prior >= 1 && developedHomes.size < 4) tempoWastes += 1;
        timesMoved.set(move.to, prior + 1);
        if (move.to !== move.from) timesMoved.set(move.from, 0);
      }
      if (isUser && inPhase && move.piece === "p") {
        pawnMoves += 1;
      }
      if (isUser) {
        noteMinorLeftHome(developedHomes, color, move.from, move.piece);
      }
    }

    if (
      !openingClosed &&
      minorsAt10 == null &&
      fullMove === DEVELOPMENT_CHECK_FULLMOVE &&
      board.turn() === "w"
    ) {
      minorsAt10 = countMinorsEverDeveloped(developedHomes);
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

      const pawnEvent = pawnStructureChanged(move);
      if (pawnEvent && (!mgHadIqp || !mgHadBackward || !mgHadDoubled)) {
        const flags = stickyPawnFlags(board, color, {
          iqp: mgHadIqp,
          doubled: mgHadDoubled,
          backward: mgHadBackward,
        });
        mgHadIqp = flags.iqp;
        mgHadBackward = flags.backward;
        doubledNow = flags.doubledNow;
      } else if (pawnEvent) {
        const flags = stickyPawnFlags(board, color, {
          iqp: true,
          doubled: mgHadDoubled,
          backward: true,
        });
        doubledNow = flags.doubledNow;
      }

      if (doubledNow) {
        doubledStreak += 1;
        if (doubledStreak >= HEURISTICS_DOUBLED_PERSIST_PLIES) {
          mgHadDoubled = true;
        }
      } else {
        doubledStreak = 0;
      }

      if (mgSampleIdx % HEURISTICS_MG_SAMPLE_EVERY === 0) {
        collectOutpostSquares(board, color, outpostSeen);
      }

      if (mgSampleIdx % HEURISTICS_MG_ISLANDS_EVERY === 0) {
        islandSum += pawnIslandCount(board, color);
        islandScans += 1;
      }

      if (mgSampleIdx % HEURISTICS_MG_ATTACKERS_EVERY === 0) {
        mgAttacker.push(kingAttackersPct(board, color));
      }
      if (mgSampleIdx % HEURISTICS_MG_SPACE_EVERY === 0) {
        mgSpace.push(spaceAdvantagePct(board, color));
      }
      if (
        mgSampleIdx % HEURISTICS_MG_SAFE_EVERY === 0 &&
        board.turn() === color
      ) {
        const safe = safeLegalMovesPct(board, color);
        if (safe != null) mgSafe.push(safe);
      }

      mgSampleIdx += 1;
    }

    if (endgameStartPly != null && plyIdx >= endgameStartPly) {
      pawnDiff += pawnDiffDeltaForCapture(isUser, move.captured);
      if (egKingSampleIdx % HEURISTICS_EG_KING_EVERY === 0) {
        const centr = kingCentralizationScore(board, color);
        if (centr != null) centerScores.push(centr);
        const dist = kingDistanceToEnemyPawns(board, color);
        if (dist != null) kingDists.push(dist);
      }
      const np = nonPawnPieceCount(board);
      const materialChanged =
        lastNonPawnCount == null ||
        np !== lastNonPawnCount ||
        move.captured === "p" ||
        move.piece === "p" ||
        !!move.promotion;
      lastNonPawnCount = np;
      if (
        materialChanged ||
        egKingSampleIdx % HEURISTICS_EG_THEORETICAL_EVERY === 0
      ) {
        const te = classifyTheoretical(board, color);
        if (te) {
          if (!te.advantageOnly || te.userHasAdvantage) {
            theoretical[te.key] = true;
          } else {
            theoreticalSaved = true;
          }
        }
      }
      egKingSampleIdx += 1;
    }
  }

  if (minorsAt10 == null) {
    minorsAt10 = countMinorsEverDeveloped(developedHomes);
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
    opening_pawn_moves: pawnMoves,
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
    shieldPct: pawnShieldIntactPct(shieldTracker),
    openFilePct: openFileTrackerPct(openFileTracker),
    safeMoveScores: mgSafe,
    outpostUnique: outpostSeen.size,
    spaceScores: mgSpace,
    islandAvg:
      islandScans > 0
        ? Math.round((islandSum / islandScans) * 100) / 100
        : null,
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
          pawn_diff: pawnDiff,
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
  const openingRows: OpeningGameRow[] = [];
  const middlegameRows: MiddlegameGameRow[] = [];
  const endgameRows: EndgameGameRow[] = [];
  const gameIds: string[] = [];
  const total = games.length;
  let i = 0;
  while (i < games.length) {
    if (options?.signal?.cancelled) break;
    await yieldForUi({ heavy: true });
    if (options?.signal?.cancelled) break;
    const step = hasPuzzleDemand()
      ? 1
      : options?.batchSize ?? HEURISTICS_IDLE_BATCH_SIZE;
    const chunk = games.slice(i, i + step);
    for (const game of chunk) {
      const row = await analyzeHeuristicGame(game, {
        signal: options?.signal,
      });
      if (!row.opening || !row.middlegame || !row.endgame) continue;
      openingRows.push(row.opening);
      middlegameRows.push(row.middlegame);
      endgameRows.push(row.endgame);
      gameIds.push(String(game.id));
    }
    i += step;
    const scanned = Math.min(i, total);
    options?.onPartial?.(
      [...openingRows],
      [...middlegameRows],
      [...endgameRows],
      [...gameIds],
      scanned,
      total
    );
  }
  return { openingRows, middlegameRows, endgameRows, gameIds };
}
