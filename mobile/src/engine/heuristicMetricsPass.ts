import { Chess, type Color, type Move } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
import {
  HEURISTICS_STRUCTURE_PERSIST_PLIES,
  HEURISTICS_DOUBLED_PERSIST_PLIES,
  structurePersistStartPly1,
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
  hasIsolatedQueenPawn,
  hasDoubledPawns,
  hasBackwardPawn,
  safeLegalMovesPct,
  spaceAdvantagePct,
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
import { parseSans, swapColor } from "./styleMetrics";
import { hasPuzzleDemand, yieldForUi } from "./backgroundWork";
import {
  applyUserTacticalMove,
  emptyPhaseTacticalCounters,
  noteKingAttackersSample,
  type PhaseTacticalCounters,
} from "./phaseTacticalMetrics";

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

export type HeuristicMetricEvent = {
  /** 1-based ply after the move (0 = initial position before any move). */
  ply: number;
  kind: "set" | "change" | "sample" | "phase";
  field: string;
  value: string | number | boolean;
  prev?: string | number | boolean | null;
};

export type HeuristicGameMetrics = {
  opening: OpeningGameRow | null;
  middlegame: MiddlegameGameRow | null;
  endgame: EndgameGameRow | null;
  events?: HeuristicMetricEvent[];
};

function emitEvent(
  events: HeuristicMetricEvent[] | undefined,
  ply: number,
  kind: HeuristicMetricEvent["kind"],
  field: string,
  value: string | number | boolean,
  prev?: string | number | boolean | null
): void {
  if (!events) return;
  events.push({ ply, kind, field, value, prev });
}

export async function analyzeHeuristicGame(
  game: StudyGame,
  options?: {
    signal?: { cancelled: boolean };
    /** When true, return per-ply insert/change events on `events`. */
    trace?: boolean;
  }
): Promise<HeuristicGameMetrics> {
  const sans = parseSans(game);
  if (!sans.length) {
    return { opening: null, middlegame: null, endgame: null };
  }

  const events: HeuristicMetricEvent[] | undefined = options?.trace
    ? []
    : undefined;

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
  const mgOppAttacker: number[] = [];
  const mgSafe: number[] = [];
  const mgSpace: number[] = [];
  const outpostSeen = new Set<string>();
  const shieldTracker = createPawnShieldTracker();
  const openFileTracker = createOpenFileTracker();
  let mgHadIqp = false;
  let mgHadDoubled = false;
  let mgHadBackward = false;
  let iqpStreak = 0;
  let doubledStreak = 0;
  let backwardStreak = 0;
  let mgSeen = false;
  let mgStart: number | null = null;
  let mgEnd: number | null = null;
  let mgSampleIdx = 0;
  let islandSum = 0;
  let islandScans = 0;
  let lastNonPawnCount: number | null = null;
  let lastCenterSample: number | null = null;
  let lastSpaceSample: number | null = null;
  let lastAttackerSample: number | null = null;
  let lastOppAttackerSample: number | null = null;
  let lastIslandSample: number | null = null;
  let lastShieldPct: number | null = null;
  let lastOpenFilePct: number | null = null;

  const openTac = emptyPhaseTacticalCounters();
  const mgTac = emptyPhaseTacticalCounters();
  const egTac = emptyPhaseTacticalCounters();
  let lastOpenAtk: number | null = null;
  let lastOpenOppAtk: number | null = null;
  let lastEgAtk: number | null = null;
  let lastEgOppAtk: number | null = null;

  if (events) {
    emitEvent(events, 0, "phase", "initial_position", true);
  }

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

    const boardBefore = new Chess(board.fen());
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

    const phaseBucket: "opening" | "middlegame" | "endgame" =
      endgameStartPly != null && plyIdx >= endgameStartPly
        ? "endgame"
        : inMiddlegamePly(plyIdx, phaseEnd, endgameStartPly)
          ? "middlegame"
          : "opening";

    if (isUser) {
      const tac: PhaseTacticalCounters =
        phaseBucket === "endgame"
          ? egTac
          : phaseBucket === "middlegame"
            ? mgTac
            : openTac;
      const beforeCounts = {
        pawn_breaks: tac.pawn_breaks,
        defended_pawns: tac.defended_pawns,
        checks: tac.checks,
        blocking_checks: tac.blocking_checks,
        unblocking_bishop_light: tac.unblocking_bishop_light,
        unblocking_bishop_dark: tac.unblocking_bishop_dark,
        pawn_moves: tac.pawn_moves,
        seventh_rank_infiltration: tac.seventh_rank_infiltration,
        open_file_utilization: tac.open_file_utilization,
        opposition: tac.opposition,
      };
      applyUserTacticalMove({
        counters: tac,
        boardBefore,
        boardAfter: board,
        move,
        color,
        postOpening: phaseBucket !== "opening",
        endgame: phaseBucket === "endgame",
      });
      const prefix =
        phaseBucket === "opening"
          ? "opening"
          : phaseBucket === "middlegame"
            ? "middlegame"
            : "endgame";
      const afterCounts: Record<string, number> = {
        pawn_breaks: tac.pawn_breaks,
        defended_pawns: tac.defended_pawns,
        checks: tac.checks,
        blocking_checks: tac.blocking_checks,
        unblocking_bishop_light: tac.unblocking_bishop_light,
        unblocking_bishop_dark: tac.unblocking_bishop_dark,
        pawn_moves: tac.pawn_moves,
        seventh_rank_infiltration: tac.seventh_rank_infiltration,
        open_file_utilization: tac.open_file_utilization,
        opposition: tac.opposition,
      };
      for (const [field, prev] of Object.entries(beforeCounts)) {
        if (
          phaseBucket === "opening" &&
          (field === "seventh_rank_infiltration" ||
            field === "open_file_utilization" ||
            field === "opposition")
        ) {
          continue;
        }
        if (phaseBucket !== "endgame" && field === "opposition") {
          continue;
        }
        // Opening pawn moves use the dedicated opening-phase counter (avoid double emit).
        if (phaseBucket === "opening" && field === "pawn_moves") {
          continue;
        }
        const next = afterCounts[field];
        if (typeof next === "number" && next !== prev) {
          emitEvent(
            events,
            plyIdx + 1,
            prev === 0 ? "set" : "change",
            `${prefix}_${field}`,
            next,
            prev
          );
        }
      }
    }

    if (!openingClosed) {
      if (isUser && isCastle && castleFullmove == null) {
        castleFullmove = fullMove;
        phaseEnd = openingPhaseEndFullmove(castleFullmove);
        emitEvent(events, plyIdx + 1, "set", "opening_castle_fullmove", castleFullmove);
        emitEvent(events, plyIdx + 1, "change", "phase_end_fullmove", phaseEnd, 15);
      }
      const inPhase = fullMove <= phaseEnd;
      if (isUser && inPhase && move.piece !== "p") {
        tempoMoves += 1;
        const prior = timesMoved.get(move.from) || 0;
        if (prior >= 1 && developedHomes.size < 4) {
          tempoWastes += 1;
          emitEvent(events, plyIdx + 1,
            "change",
            "opening_tempo_wastes",
            tempoWastes,
            tempoWastes - 1
          );
        }
        timesMoved.set(move.to, prior + 1);
        if (move.to !== move.from) timesMoved.set(move.from, 0);
      }
      if (isUser && inPhase && move.piece === "p") {
        pawnMoves += 1;
        emitEvent(events, plyIdx + 1,
          "change",
          "opening_pawn_moves",
          pawnMoves,
          pawnMoves - 1
        );
      }
      if (isUser) {
        const beforeDev = developedHomes.size;
        noteMinorLeftHome(developedHomes, color, move.from, move.piece);
        if (developedHomes.size > beforeDev) {
          emitEvent(events, plyIdx + 1,
            "change",
            "opening_minors_developed",
            developedHomes.size,
            beforeDev
          );
        }
      }
    }

    if (
      !openingClosed &&
      minorsAt10 == null &&
      fullMove === DEVELOPMENT_CHECK_FULLMOVE &&
      board.turn() === "w"
    ) {
      minorsAt10 = countMinorsEverDeveloped(developedHomes);
      emitEvent(events, plyIdx + 1,
        "set",
        "opening_minors_developed_by_10",
        minorsAt10
      );
    }

    if (!openingClosed && fullMove <= phaseEnd) {
      const center = centerControlShare(board, color);
      centerSamples.push(center);
      if (lastCenterSample == null || Math.abs(center - lastCenterSample) >= 5) {
        emitEvent(events, plyIdx + 1,
          lastCenterSample == null ? "set" : "sample",
          "opening_center_control_pct",
          Math.round(center * 10) / 10,
          lastCenterSample
        );
        lastCenterSample = center;
      }
      const openAtk = kingAttackersPct(board, color);
      const openRose = noteKingAttackersSample(openTac, openAtk, "own");
      if (
        lastOpenAtk == null ||
        Math.abs(openAtk - lastOpenAtk) >= 1 ||
        openRose
      ) {
        emitEvent(
          events,
          plyIdx + 1,
          lastOpenAtk == null ? "set" : "sample",
          "opening_king_attackers_score",
          Math.round(openAtk * 10) / 10,
          lastOpenAtk
        );
        lastOpenAtk = openAtk;
      }
      const openOppAtk = kingAttackersPct(board, swapColor(color));
      const openOppRose = noteKingAttackersSample(openTac, openOppAtk, "opp");
      if (
        lastOpenOppAtk == null ||
        Math.abs(openOppAtk - lastOpenOppAtk) >= 1 ||
        openOppRose
      ) {
        emitEvent(
          events,
          plyIdx + 1,
          lastOpenOppAtk == null ? "set" : "sample",
          "opening_opp_king_attackers_score",
          Math.round(openOppAtk * 10) / 10,
          lastOpenOppAtk
        );
        lastOpenOppAtk = openOppAtk;
      }
    }

    if (!openingClosed && fullMove > phaseEnd) {
      openingClosed = true;
      emitEvent(events, plyIdx + 1, "phase", "opening_closed", true);
    }

    if (
      endgameStartPly == null &&
      nonPawnPieceCount(board) <= ENDGAME_NON_PAWN_MAX
    ) {
      endgameStartPly = plyIdx;
      emitEvent(events, plyIdx + 1, "phase", "endgame_start_ply", plyIdx + 1);
    }

    if (inMiddlegamePly(plyIdx, phaseEnd, endgameStartPly)) {
      if (!mgSeen) {
        mgSeen = true;
        mgStart = middlegameStartPly(phaseEnd);
        emitEvent(events, plyIdx + 1, "phase", "middlegame_start_ply", mgStart);
      }
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

      const shieldPct = pawnShieldIntactPct(shieldTracker);
      if (
        shieldPct != null &&
        (lastShieldPct == null || Math.abs(shieldPct - lastShieldPct) >= 5)
      ) {
        emitEvent(events, plyIdx + 1,
          lastShieldPct == null ? "set" : "change",
          "middlegame_pawn_shield_pct",
          Math.round(shieldPct * 10) / 10,
          lastShieldPct
        );
        lastShieldPct = shieldPct;
      }
      const openPct = openFileTrackerPct(openFileTracker);
      if (
        openPct != null &&
        (lastOpenFilePct == null || Math.abs(openPct - lastOpenFilePct) >= 5)
      ) {
        emitEvent(events, plyIdx + 1,
          lastOpenFilePct == null ? "set" : "change",
          "middlegame_open_file_proximity_pct",
          Math.round(openPct * 10) / 10,
          lastOpenFilePct
        );
        lastOpenFilePct = openPct;
      }

      if (hasIsolatedQueenPawn(board, color)) {
        iqpStreak += 1;
        if (
          iqpStreak >= HEURISTICS_STRUCTURE_PERSIST_PLIES &&
          !mgHadIqp
        ) {
          mgHadIqp = true;
          emitEvent(
            events,
            structurePersistStartPly1(plyIdx + 1),
            "set",
            "had_iqp",
            true
          );
        }
      } else {
        iqpStreak = 0;
      }
      if (hasDoubledPawns(board, color)) {
        doubledStreak += 1;
        if (
          doubledStreak >= HEURISTICS_DOUBLED_PERSIST_PLIES &&
          !mgHadDoubled
        ) {
          mgHadDoubled = true;
          emitEvent(
            events,
            structurePersistStartPly1(plyIdx + 1),
            "set",
            "had_doubled_pawns",
            true
          );
        }
      } else {
        doubledStreak = 0;
      }
      if (hasBackwardPawn(board, color)) {
        backwardStreak += 1;
        if (
          backwardStreak >= HEURISTICS_STRUCTURE_PERSIST_PLIES &&
          !mgHadBackward
        ) {
          mgHadBackward = true;
          emitEvent(
            events,
            structurePersistStartPly1(plyIdx + 1),
            "set",
            "had_backward_pawns",
            true
          );
        }
      } else {
        backwardStreak = 0;
      }

      if (mgSampleIdx % HEURISTICS_MG_SAMPLE_EVERY === 0) {
        const beforeOutposts = outpostSeen.size;
        collectOutpostSquares(board, color, outpostSeen);
        if (outpostSeen.size > beforeOutposts) {
          emitEvent(events, plyIdx + 1,
            "change",
            "middlegame_outpost_control",
            outpostSeen.size,
            beforeOutposts
          );
        }
      }

      if (mgSampleIdx % HEURISTICS_MG_ISLANDS_EVERY === 0) {
        const islands = pawnIslandCount(board, color);
        islandSum += islands;
        islandScans += 1;
        if (lastIslandSample == null || islands !== lastIslandSample) {
          emitEvent(events, plyIdx + 1,
            lastIslandSample == null ? "set" : "sample",
            "middlegame_pawn_islands",
            islands,
            lastIslandSample
          );
          lastIslandSample = islands;
        }
      }

      if (mgSampleIdx % HEURISTICS_MG_ATTACKERS_EVERY === 0) {
        const atk = kingAttackersPct(board, color);
        mgAttacker.push(atk);
        const rose = noteKingAttackersSample(mgTac, atk, "own");
        if (
          lastAttackerSample == null ||
          Math.abs(atk - lastAttackerSample) >= 1 ||
          rose
        ) {
          emitEvent(events, plyIdx + 1,
            lastAttackerSample == null ? "set" : "sample",
            "middlegame_king_attackers_score",
            Math.round(atk * 10) / 10,
            lastAttackerSample
          );
          lastAttackerSample = atk;
        }
        const oppAtk = kingAttackersPct(board, swapColor(color));
        mgOppAttacker.push(oppAtk);
        const oppRose = noteKingAttackersSample(mgTac, oppAtk, "opp");
        if (
          lastOppAttackerSample == null ||
          Math.abs(oppAtk - lastOppAttackerSample) >= 1 ||
          oppRose
        ) {
          emitEvent(events, plyIdx + 1,
            lastOppAttackerSample == null ? "set" : "sample",
            "middlegame_opp_king_attackers_score",
            Math.round(oppAtk * 10) / 10,
            lastOppAttackerSample
          );
          lastOppAttackerSample = oppAtk;
        }
      }
      if (mgSampleIdx % HEURISTICS_MG_SPACE_EVERY === 0) {
        const space = spaceAdvantagePct(board, color);
        mgSpace.push(space);
        if (lastSpaceSample == null || Math.abs(space - lastSpaceSample) >= 5) {
          emitEvent(events, plyIdx + 1,
            lastSpaceSample == null ? "set" : "sample",
            "middlegame_space_advantage_pct",
            Math.round(space * 10) / 10,
            lastSpaceSample
          );
          lastSpaceSample = space;
        }
      }
      if (
        mgSampleIdx % HEURISTICS_MG_SAFE_EVERY === 0 &&
        board.turn() === color
      ) {
        const safe = safeLegalMovesPct(board, color);
        if (safe != null) {
          mgSafe.push(safe);
          emitEvent(events, plyIdx + 1,
            "sample",
            "middlegame_safe_moves_pct",
            Math.round(safe * 10) / 10
          );
        }
      }

      mgSampleIdx += 1;
    }

    if (endgameStartPly != null && plyIdx >= endgameStartPly) {
      const beforePawnDiff = pawnDiff;
      pawnDiff += pawnDiffDeltaForCapture(isUser, move.captured);
      if (pawnDiff !== beforePawnDiff) {
        emitEvent(events, plyIdx + 1,
          "change",
          "pawn_diff",
          pawnDiff,
          beforePawnDiff
        );
      }
      if (egKingSampleIdx % HEURISTICS_EG_KING_EVERY === 0) {
        const centr = kingCentralizationScore(board, color);
        if (centr != null) {
          centerScores.push(centr);
          emitEvent(events, plyIdx + 1,
            "sample",
            "king_centralization",
            Math.round(centr * 100) / 100
          );
        }
        const dist = kingDistanceToEnemyPawns(board, color);
        if (dist != null) {
          kingDists.push(dist);
          emitEvent(events, plyIdx + 1,
            "sample",
            "king_distance",
            Math.round(dist * 100) / 100
          );
        }
        const egAtk = kingAttackersPct(board, color);
        const egRose = noteKingAttackersSample(egTac, egAtk, "own");
        if (
          lastEgAtk == null ||
          Math.abs(egAtk - lastEgAtk) >= 1 ||
          egRose
        ) {
          emitEvent(
            events,
            plyIdx + 1,
            lastEgAtk == null ? "set" : "sample",
            "endgame_king_attackers_score",
            Math.round(egAtk * 10) / 10,
            lastEgAtk
          );
          lastEgAtk = egAtk;
        }
        const egOppAtk = kingAttackersPct(board, swapColor(color));
        const egOppRose = noteKingAttackersSample(egTac, egOppAtk, "opp");
        if (
          lastEgOppAtk == null ||
          Math.abs(egOppAtk - lastEgOppAtk) >= 1 ||
          egOppRose
        ) {
          emitEvent(
            events,
            plyIdx + 1,
            lastEgOppAtk == null ? "set" : "sample",
            "endgame_opp_king_attackers_score",
            Math.round(egOppAtk * 10) / 10,
            lastEgOppAtk
          );
          lastEgOppAtk = egOppAtk;
        }
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
            if (!theoretical[te.key]) {
              theoretical[te.key] = true;
              emitEvent(events, plyIdx + 1, "set", `theoretical.${te.key}`, true);
            }
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
    opening_king_attackers_score: mean(openTac.king_attackers_samples, 1),
    opening_king_attackers_rises: openTac.king_attackers_rises,
    opening_opp_king_attackers_score: mean(
      openTac.opp_king_attackers_samples,
      1
    ),
    opening_opp_king_attackers_rises: openTac.opp_king_attackers_rises,
    opening_pawn_breaks: openTac.pawn_breaks,
    opening_defended_pawns: openTac.defended_pawns,
    opening_unblocking_bishop_light: openTac.unblocking_bishop_light,
    opening_unblocking_bishop_dark: openTac.unblocking_bishop_dark,
    opening_checks: openTac.checks,
    opening_blocking_checks: openTac.blocking_checks,
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
    oppAttackerScores: mgOppAttacker,
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
    pawnMoves: mgTac.pawn_moves,
    pawnBreaks: mgTac.pawn_breaks,
    defendedPawns: mgTac.defended_pawns,
    unblockingBishopLight: mgTac.unblocking_bishop_light,
    unblockingBishopDark: mgTac.unblocking_bishop_dark,
    checks: mgTac.checks,
    blockingChecks: mgTac.blocking_checks,
    kingAttackersRises: mgTac.king_attackers_rises,
    oppKingAttackersRises: mgTac.opp_king_attackers_rises,
    seventhRankInfiltration: mgTac.seventh_rank_infiltration,
    openFileUtilization: mgTac.open_file_utilization,
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
          endgame_pawn_moves: egTac.pawn_moves,
          endgame_pawn_breaks: egTac.pawn_breaks,
          endgame_defended_pawns: egTac.defended_pawns,
          endgame_unblocking_bishop_light: egTac.unblocking_bishop_light,
          endgame_unblocking_bishop_dark: egTac.unblocking_bishop_dark,
          endgame_checks: egTac.checks,
          endgame_blocking_checks: egTac.blocking_checks,
          endgame_king_attackers_score: mean(egTac.king_attackers_samples, 1),
          endgame_king_attackers_rises: egTac.king_attackers_rises,
          endgame_opp_king_attackers_score: mean(
            egTac.opp_king_attackers_samples,
            1
          ),
          endgame_opp_king_attackers_rises: egTac.opp_king_attackers_rises,
          endgame_seventh_rank_infiltration: egTac.seventh_rank_infiltration,
          endgame_open_file_utilization: egTac.open_file_utilization,
          endgame_opposition: egTac.opposition,
          result,
        };

  return { opening, middlegame, endgame, events };
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
