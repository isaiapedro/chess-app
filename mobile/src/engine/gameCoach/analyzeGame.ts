import { Chess, type Square } from "chess.js";
import {
  COACH_ANALYZE_DEPTH,
  COACH_ANALYZE_MOVETIME,
  COACH_ANALYZE_MULTIPV,
  COACH_CRITICAL_DEPTH,
  COACH_CRITICAL_MOVETIME,
  COACH_CRITICAL_MULTIPV,
} from "../analysisConfig";
import { applyUciMove, fenKey, sanToUci, uciFromMove } from "../chessMoves";
import { formatEval, toWhiteCp } from "../analyzeMistakes";
import { applyForcedMateWhiteCp, bestStmCp } from "../forcedMate";
import type { StudyGame } from "../analyzeMistakes";
import { openingNamesMatch, variationEndPlyFromMap } from "../openingLines";
import {
  analyzeEvalBucketMetrics,
  mergeEndgameHeuristicWithBucket,
} from "../evalBucketMetrics";
import { mergeMiddlegameHeuristicWithBucket } from "../middlegamePhase";
import { analyzeHeuristicGame } from "../heuristicMetricsPass";
import {
  getSharedGameRecord,
  loadPermanentEvalStore,
  upsertSharedGameEvals,
  type GlobalGameRecord,
  type PositionEval,
} from "../globalAnalysis";
import { upsertHeuristicGame } from "../../storage/analyticsLoaders";
import type { MistakeItem } from "../../api/client";
import {
  classifyCoachMark,
  coachMissedFromPending,
  COACH_MARKS_KEEP_OVER_BOOK,
  type CoachMark,
} from "./coachMarkClassify";
import { mergeMultiPvGapLines, rankLinesByStm } from "./tacticSharpness";
import { userWinProbability, WP_INACCURACY_DROP } from "../winProb";
import { shouldDropNoiseCoachMoment } from "./coachMomentNoise";
import { formatOpeningLabel } from "./ecoLabels";
import {
  buildCoachGameMetrics,
  enrichMomentsWithPlies,
  ensureFixedOpeningMoments,
  upsertLiveMoment,
  type CoachGameMetrics,
  type CoachMetricMoment,
} from "./gameMetricsLookup";
import { expandCoachThemes, classifyUserError, shouldComposeNote, acceptKeyNote } from "./noteCompose";
import { composeGameSummaryNote } from "./gameSummary";
import {
  buildCommentRefs,
  type CommentRefs,
} from "./commentRefs";
import { assessPositionPov } from "./positionPov";
import type { VectorRetrieveFn } from "./retrieve";
import {
  collectGameKeys,
  collectGameKeysByPhase,
  PHASE_NOTE_LIMITS,
  type KeyTip,
  type PhaseGameKeys,
  type PhaseName,
} from "./keyRetrieve";
import {
  pickMetricTip,
  shouldAttachMetricTip,
  buildCoachNoteRequest,
  lineComparisonMomentInputs,
  coachRequestMetaInputs,
  durableUnusedStructureThemes,
  openingEvalGapAllowsEngineLine,
  pawnBreakEvalGapAllowsRecommend,
  engineLineSansBudget,
  composePlayedAltLine,
  COACH_NOTE_REQUEST_CONFIG,
  isFixedCheckpointMoment,
  requestAlwaysAttaches,
} from "./metricNotes";
import {
  rankMetricNoteWeights,
  formatWeightBreakdown,
  themesForPly,
} from "./metricNoteWeights";
import {
  mergeOpeningTipPrior,
  type OpeningTipPrior,
} from "./openingJudgmentTip";
import {
  emptyGamePlanState,
  advanceGamePlan,
  formatGamePlanShort,
  markPlanKeysTaught,
  mergeOpeningPlanKeys,
} from "./gamePlanState";
import { detectSituations, mergeStickySituations } from "./situationProfiles";
import type { DetectedSituation } from "./situationProfiles";
import { PawnStormTracker } from "./tier3Metrics";
import { isPawnBreakMove } from "../phaseTacticalMetrics";
import { loadCoachPack, getCoachPackByKey } from "./loadCoachPack";
import { extendEnginePvUci } from "./extendEnginePv";
import {
  detectOpeningFamily,
  resolveOpeningPackKey,
  confirmedStructureThemesByPly,
} from "./structureDetect";
import {
  enrichOpeningCoachMoments,
  type OpeningPeerContext,
} from "./openingCoachInputs";
import {
  enrichMiddlegameCoachMoments,
  enrichLiveMiddlegamePeerGaps,
} from "./middlegameCoachInputs";
import { enrichMiddlegameStrategicMoments } from "./middlegameStructure";
import { enrichEndgameCoachMoments } from "./endgameContext";
import { phaseForCoachMoment } from "./phaseSplits";
import { loadBaselineStore } from "../../data/baselines";
import type { Platform } from "../../api/types";
import type { OpeningGameRow } from "../openingPhase";

const MAX_PRO_THEORY_PLIES = 40;
const BOOK_MIN_LOCAL_PCT = 2;

function normalizeUserColor(raw?: string | null): "white" | "black" {
  const v = String(raw || "white").trim().toLowerCase();
  if (v === "black" || v === "b") return "black";
  return "white";
}

export type EvalFn = (
  fen: string,
  depth?: number,
  multiPv?: number,
  movetimeMs?: number
) => Promise<{
  cpWhite: number;
  bestUci: string | null;
  bestPv?: string[];
  multipv?: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
}>;

export type GameCoachExplorerFn = (
  fen: string,
  source: "lichess" | "masters",
  ratings?: string
) => Promise<{
  moves: Array<{
    uci?: string;
    san?: string;
    white: number;
    draws: number;
    black: number;
  }>;
  white: number;
  draws: number;
  black: number;
  opening?: { eco?: string; name?: string };
  fallback?: boolean;
}>;

export type EngineLine = {
  rank: number;
  san: string;
  cpWhite: number;
  pvSan: string[];
};

export type GameCoachPly = {
  ply: number;
  fullmove: number;
  side: "white" | "black";
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  evalBeforeCp: number | null;
  evalAfterCp: number | null;
  deltaCp: number;
  bestSan: string | null;
  bestPvSan: string[];
  lines: EngineLine[];
  note: string;
  analyzed: boolean;
  mark: CoachMark | null;
  /** Coach-moment refs the note actually uses (filtered). */
  noteRefs?: CommentRefs | null;
};

export type GameCoachResult = {
  gameId: string;
  openingLabel: string;
  analyzedAt: number;
  depth: number;
  plies: GameCoachPly[];
  notesCount: number;
};

export type AnalyzeProgress = {
  ply: number;
  total: number;
  status: string;
};

function phaseForPly(
  ply: number,
  pieceCount: number,
  bounds?: { middlegameStartPly0: number | null; endgameStartPly0: number | null } | null,
  structuralKind?: string | null
): "opening" | "middlegame" | "endgame" {
  return phaseForCoachMoment({
    ply1: ply,
    pieceCount,
    bounds,
    structuralKind,
  });
}

function studyGameFromOptions(args: {
  gameId: string;
  pgn?: string | null;
  moves?: string | null;
  eco?: string | null;
  opening?: string | null;
  userColor: "white" | "black";
  userRating?: number | null;
  speed?: string | null;
  timeControl?: string | null;
}): StudyGame {
  return {
    id: args.gameId,
    created_at: new Date().toISOString(),
    speed: args.speed || "blitz",
    user_color: args.userColor,
    result: "Unknown",
    opening_name: args.opening != null ? args.opening : undefined,
    opening_eco: args.eco != null ? args.eco : undefined,
    opponent_name: "Opponent",
    pgn_str: args.pgn || "",
    moves_str: args.moves || "",
    time_control: args.timeControl != null ? args.timeControl : undefined,
    user_rating: args.userRating ?? undefined,
  };
}


function momentAlignedToPly(
  moment: CoachMetricMoment | null | undefined,
  fenBefore: string,
  san: string
): CoachMetricMoment | null {
  if (!moment) return null;
  if (moment.fen) {
    const a = moment.fen.split(" ")[0] || "";
    const b = fenBefore.split(" ")[0] || "";
    if (a && b && a !== b) return null;
  }
  if (moment.playedSan && moment.playedSan !== san) {
    return null;
  }
  return moment;
}

function severityFromMark(mark: CoachMark | null): CoachMetricMoment["severity"] {
  if (mark === "blunder") return "blunder";
  if (mark === "missed") return "missed";
  if (mark === "mistake") return "mistake";
  return null;
}

function sanFromUci(fen: string, uci: string | null): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const board = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = board.move({
      from: from as never,
      to: to as never,
      promotion: promotion as never,
    });
    return move?.san || null;
  } catch {
    return null;
  }
}

function pvToSan(fen: string, pv: string[] | undefined, max = 14): string[] {
  if (!pv?.length) return [];
  try {
    const board = new Chess(fen);
    const out: string[] = [];
    for (const uci of pv.slice(0, max)) {
      if (!uci || uci.length < 4) break;
      const from = uci.slice(0, 2) as Square;
      const to = uci.slice(2, 4) as Square;
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = board.move({ from, to, promotion: promotion as never });
      if (!move) break;
      out.push(move.san);
    }
    return out;
  } catch {
    return [];
  }
}

function sansAfterIndex(
  moves: { san: string }[],
  index: number,
  maxPly = 6
): string[] {
  const out: string[] = [];
  for (let j = index + 1; j < moves.length && out.length < maxPly; j += 1) {
    const san = moves[j]?.san;
    if (san) out.push(san);
  }
  return out;
}

function explorerMoveGames(m: {
  white?: number;
  draws?: number;
  black?: number;
}): number {
  return (m.white || 0) + (m.draws || 0) + (m.black || 0);
}

function explorerContainsMove(
  moves: Array<{
    uci?: string;
    san?: string;
    white: number;
    draws: number;
    black: number;
  }>,
  uci: string,
  san: string
): boolean {
  const normSan = san.replace(/[+#?!]+$/g, "");
  const hit =
    moves.find((m) => m.uci === uci) ||
    moves.find((m) => (m.san || "").replace(/[+#?!]+$/g, "") === normSan);
  return Boolean(hit && explorerMoveGames(hit) > 0);
}

function explorerMoveShare(
  moves: Array<{
    uci?: string;
    san?: string;
    white: number;
    draws: number;
    black: number;
  }>,
  uci: string,
  san: string
): { games: number; pct: number; rank: number | null } {
  const normSan = san.replace(/[+#?!]+$/g, "");
  const total = moves.reduce((s, m) => s + explorerMoveGames(m), 0);
  if (total <= 0) return { games: 0, pct: 0, rank: null };
  const ranked = [...moves].sort(
    (a, b) =>
      explorerMoveGames(b) - explorerMoveGames(a) ||
      String(a.san || "").localeCompare(String(b.san || ""))
  );
  const idx = ranked.findIndex(
    (m) =>
      m.uci === uci ||
      (m.san || "").replace(/[+#?!]+$/g, "") === normSan
  );
  if (idx < 0) return { games: 0, pct: 0, rank: null };
  const games = explorerMoveGames(ranked[idx]);
  return {
    games,
    pct: (games / total) * 100,
    rank: idx + 1,
  };
}

function moveStillInBook(
  lichessMoves: Array<{
    uci?: string;
    san?: string;
    white: number;
    draws: number;
    black: number;
  }>,
  mastersMoves: Array<{
    uci?: string;
    san?: string;
    white: number;
    draws: number;
    black: number;
  }>,
  uci: string,
  san: string
): boolean {
  const li = explorerMoveShare(lichessMoves, uci, san);
  const ma = explorerMoveShare(mastersMoves, uci, san);
  const best = li.pct >= ma.pct ? li : ma;
  if (best.games <= 0) return false;
  if (best.pct + 1e-9 < BOOK_MIN_LOCAL_PCT) return false;
  return true;
}

function evalSignCrosses(beforeCp: number, afterCp: number): boolean {
  const eps = 25;
  if (Math.abs(beforeCp) < eps || Math.abs(afterCp) < eps) return false;
  return Math.sign(beforeCp) !== Math.sign(afterCp);
}

/**
 * Opening-puzzle theory end (1-based ply), matching analyzeOpenings:
 * map variation leaf, else explorer named-opening leaf, else frequency book.
 */
async function professionalTheoryEndPly(
  skeleton: Array<{ ply: number; fenBefore: string; uci: string; san: string }>,
  fetchExplorer: GameCoachExplorerFn,
  openingName?: string | null,
  signal?: { cancelled: boolean },
  onProgress?: (status: string) => void
): Promise<{
  namedEndPly: number | null;
  freqEndPly: number | null;
  available: boolean;
}> {
  let namedEndPly: number | null = null;
  let freqEndPly: number | null = null;
  let explorerNamed = false;
  let freqAlive = true;
  const limit = Math.min(skeleton.length, MAX_PRO_THEORY_PLIES);
  const gameOpeningName = String(openingName || "");
  try {
    for (let i = 0; i < limit; i += 1) {
      if (signal?.cancelled) break;
      const sk = skeleton[i];
      onProgress?.(`Opening theory · move ${Math.ceil(sk.ply / 2)}`);
      const [lichess, masters] = await Promise.all([
        fetchExplorer(sk.fenBefore, "lichess"),
        fetchExplorer(sk.fenBefore, "masters"),
      ]);

      if (gameOpeningName && !explorerNamed) {
        const explorerOpeningName =
          lichess.opening?.name || masters.opening?.name || null;
        if (openingNamesMatch(explorerOpeningName, gameOpeningName)) {
          // fenBefore already named leaf → last book move was previous ply
          // (same as analyzeOpenings compoundStartPly = 0-based i → 1-based end = i)
          namedEndPly = i > 0 ? i : null;
          explorerNamed = true;
        }
      }

      if (freqAlive) {
        const known = moveStillInBook(
          lichess.moves || [],
          masters.moves || [],
          sk.uci,
          sk.san
        );
        if (!known) {
          freqAlive = false;
        } else {
          freqEndPly = sk.ply;
        }
      }

      if (explorerNamed && !freqAlive) break;
    }
    return {
      namedEndPly,
      freqEndPly,
      available: true,
    };
  } catch {
    return { namedEndPly: null, freqEndPly: null, available: false };
  }
}

function resolveBookEndPly(args: {
  mapEndPly: number | null;
  namedEndPly: number | null;
  freqEndPly: number | null;
  proAvailable: boolean;
}): number | null {
  // Same priority as opening puzzles: named map/line first, then explorer name.
  if (args.mapEndPly != null) return args.mapEndPly;
  if (args.namedEndPly != null) return args.namedEndPly;
  if (args.proAvailable && args.freqEndPly != null) return args.freqEndPly;
  return null;
}

/**
 * Book stays quiet: no +/- eval flip, no WP swing into the 5–10pp+ band.
 */
function trimBookEndByWinProb(
  plies: GameCoachPly[],
  theoryEndPly: number | null,
  userIsWhite: boolean
): number | null {
  if (theoryEndPly == null || theoryEndPly <= 0) return null;
  let end = theoryEndPly;
  for (const p of plies) {
    if (p.ply > theoryEndPly) break;
    if (p.evalBeforeCp == null || p.evalAfterCp == null) continue;

    const beforeUser = userIsWhite ? p.evalBeforeCp : -p.evalBeforeCp;
    const afterUser = userIsWhite ? p.evalAfterCp : -p.evalAfterCp;
    if (evalSignCrosses(beforeUser, afterUser)) {
      end = p.ply - 1;
      break;
    }

    const wpBefore = userWinProbability(p.evalBeforeCp, userIsWhite);
    const wpAfter = userWinProbability(p.evalAfterCp, userIsWhite);
    const absDelta = Math.abs(wpAfter - wpBefore);
    if (absDelta + 1e-9 >= WP_INACCURACY_DROP) {
      end = p.ply - 1;
      break;
    }
  }
  return end > 0 ? end : null;
}

export function linesFromEval(
  fen: string,
  result: {
    cpWhite: number;
    bestUci: string | null;
    bestPv?: string[];
    multipv?: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
  }
): EngineLine[] {
  const rows =
    result.multipv && result.multipv.length
      ? [...result.multipv]
      : result.bestUci
        ? [{ uci: result.bestUci, cpWhite: result.cpWhite, pv: result.bestPv }]
        : [];
  const mapped = rows.map((row) => {
    const pvSan = pvToSan(fen, row.pv?.length ? row.pv : row.uci ? [row.uci] : []);
    return {
      san: pvSan[0] || sanFromUci(fen, row.uci) || row.uci || "—",
      cpWhite: toWhiteCp(fen, row.cpWhite),
      pvSan,
    };
  });
  return rankLinesByStm(fen, mapped)
    .slice(0, 3)
    .map((line, i) => ({
      rank: i + 1,
      ...line,
    }));
}

type EngineEvalResult = {
  cpWhite: number;
  bestUci: string | null;
  bestPv?: string[];
  multipv?: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
};

function evalFromSharedPosition(hit: PositionEval): EngineEvalResult {
  const stored =
    hit.multipv && hit.multipv.length
      ? [...hit.multipv].sort((a, b) => b.cpWhite - a.cpWhite)
      : hit.bestUci
        ? [{ uci: hit.bestUci, cpWhite: hit.cpWhite, pv: [hit.bestUci] }]
        : [];
  const best = stored[0];
  const stmBest = bestStmCp([
    hit.cpWhite,
    ...stored.map((row) => row.cpWhite),
  ]);
  const bestUci = best?.uci || hit.bestUci || null;
  const pv = best?.pv?.length
    ? best.pv
    : bestUci
      ? [bestUci]
      : [];
  return {
    cpWhite: stmBest,
    bestUci,
    bestPv: pv,
    multipv: stored,
  };
}

/** Vault stores engine STM scores in `cpWhite`; coach plies use White-POV. */
function stmCpFromWhite(fen: string, whiteCp: number): number {
  const turn = fen.split(" ")[1];
  return turn === "b" ? -whiteCp : whiteCp;
}

function whiteCpFromSeries(
  series: number[] | undefined,
  index: number
): number | null {
  if (!series || index < 0 || index >= series.length) return null;
  const v = series[index];
  return Number.isFinite(v) ? v : null;
}

const OPENING_CANDIDATE_MAX_PLY = 20;
const MISTAKE_CANDIDATE_MIN_PLY = 12;
const CANDIDATE_MIN_DROP_CP = 100;
const MAX_VAULT_CANDIDATES = 3;

function buildVaultProductFromPlies(args: {
  gameId: string;
  pgn?: string | null;
  moves?: string | null;
  eco?: string | null;
  opening?: string | null;
  userColor?: string | null;
  plies: GameCoachPly[];
  positions: Record<string, PositionEval>;
}): {
  positions: Record<string, PositionEval>;
  evalsWhiteCp: number[];
  mistakeCandidates: MistakeItem[];
  openingCandidates: MistakeItem[];
  opening_accuracy_pct: number | null;
  opening_accuracy_moves: number;
  endgameEval: GlobalGameRecord["endgameEval"];
  middlegameEval: GlobalGameRecord["middlegameEval"];
  style: GlobalGameRecord["style"];
} {
  const positions: Record<string, PositionEval> = { ...args.positions };
  const evalsWhiteCp: number[] = [];
  const openingCandidates: MistakeItem[] = [];
  const mistakeCandidates: MistakeItem[] = [];
  const userColor = normalizeUserColor(args.userColor);

  if (args.plies.length) {
    const start = args.plies[0];
    if (start.evalBeforeCp != null) {
      evalsWhiteCp.push(start.evalBeforeCp);
      const key = fenKey(start.fenBefore);
      if (!positions[key]) {
        positions[key] = {
          cpWhite: stmCpFromWhite(start.fenBefore, start.evalBeforeCp),
          bestUci: null,
        };
      }
    }
  }

  for (const ply of args.plies) {
    if (ply.evalAfterCp != null) evalsWhiteCp.push(ply.evalAfterCp);

    const beforeKey = fenKey(ply.fenBefore);
    if (ply.evalBeforeCp != null) {
      const prev = positions[beforeKey];
      const bestUci =
        prev?.bestUci ||
        (ply.bestSan ? sanToUci(ply.fenBefore, ply.bestSan) : null) ||
        null;
      const fromLines =
        ply.lines?.length >= 2
          ? ply.lines.slice(0, 3).map((line) => {
              const uci =
                sanToUci(ply.fenBefore, line.san) ||
                (line.pvSan?.[0]
                  ? sanToUci(ply.fenBefore, line.pvSan[0])
                  : null) ||
                "";
              return {
                uci,
                cpWhite: stmCpFromWhite(ply.fenBefore, line.cpWhite),
                pv: line.pvSan?.length
                  ? undefined
                  : uci
                    ? [uci]
                    : undefined,
              };
            }).filter((row) => row.uci)
          : undefined;
      positions[beforeKey] = {
        cpWhite: stmCpFromWhite(ply.fenBefore, ply.evalBeforeCp),
        bestUci,
        multipv:
          (fromLines && fromLines.length >= 2
            ? fromLines
            : prev?.multipv) || undefined,
      };
    }

    const afterKey = fenKey(ply.fenAfter);
    if (ply.evalAfterCp != null && !positions[afterKey]) {
      positions[afterKey] = {
        cpWhite: stmCpFromWhite(ply.fenAfter, ply.evalAfterCp),
        bestUci: null,
      };
    }

    const isUser = ply.side === userColor;
    if (
      !isUser ||
      ply.evalBeforeCp == null ||
      ply.evalAfterCp == null ||
      ply.mark == null
    ) {
      continue;
    }
    const userIsWhite = userColor === "white";
    const userBefore = userIsWhite ? ply.evalBeforeCp : -ply.evalBeforeCp;
    const userAfter = userIsWhite ? ply.evalAfterCp : -ply.evalAfterCp;
    const drop = userBefore - userAfter;
    if (drop < CANDIDATE_MIN_DROP_CP) continue;
    if (
      ply.mark !== "inaccuracy" &&
      ply.mark !== "mistake" &&
      ply.mark !== "blunder" &&
      ply.mark !== "missed"
    ) {
      continue;
    }

    const zeroBasedPly = Math.max(0, ply.ply - 1);
    const item: MistakeItem = {
      game_id: args.gameId,
      created_at: "",
      opening_name: args.opening || undefined,
      opening_eco: args.eco || undefined,
      user_color: userColor,
      result: "",
      ply: zeroBasedPly,
      move_number: ply.fullmove,
      fen: ply.fenBefore,
      played_uci: ply.uci,
      played_san: ply.san,
      best_uci: positions[beforeKey]?.bestUci || null,
      best_san: ply.bestSan,
      eval_before_cp: Math.round(ply.evalBeforeCp * 10) / 10,
      eval_after_cp: Math.round(ply.evalAfterCp * 10) / 10,
      eval_delta_cp: Math.round((ply.evalAfterCp - ply.evalBeforeCp) * 10) / 10,
      eval_drop_cp: Math.round(drop * 10) / 10,
      comment: `Your position worsened by ~${Math.round(drop)} cp after ${ply.san}.`,
    };

    if (
      zeroBasedPly < OPENING_CANDIDATE_MAX_PLY &&
      openingCandidates.length < MAX_VAULT_CANDIDATES
    ) {
      openingCandidates.push(item);
    }
    if (
      zeroBasedPly >= MISTAKE_CANDIDATE_MIN_PLY &&
      mistakeCandidates.length < MAX_VAULT_CANDIDATES
    ) {
      mistakeCandidates.push(item);
    }
  }

  const stubGame = {
    id: args.gameId,
    created_at: "",
    opening_name: args.opening,
    opening_eco: args.eco,
    user_color: userColor,
    result: "",
    pgn_str: args.pgn,
    moves_str: args.moves,
  } as StudyGame;
  const bucket = analyzeEvalBucketMetrics(stubGame, evalsWhiteCp);

  return {
    positions,
    evalsWhiteCp,
    mistakeCandidates,
    openingCandidates,
    opening_accuracy_pct: bucket.opening_accuracy_pct,
    opening_accuracy_moves: bucket.opening_accuracy_moves,
    endgameEval: bucket.endgameEval,
    middlegameEval: bucket.middlegameEval,
    style: bucket.style,
  };
}

export function parseGamePlies(pgnOrMoves: string): Array<{
  ply: number;
  fullmove: number;
  side: "white" | "black";
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
}> {
  const board = new Chess();
  const raw = (pgnOrMoves || "").trim();
  if (!raw) return [];

  try {
    if (raw.includes("[") || /^\s*1\./.test(raw)) {
      board.loadPgn(raw, { strict: false });
    } else {
      for (const tok of raw.split(/\s+/)) {
        if (!tok || /^\d+\.+$/.test(tok) || tok === "*" || /^\d-\d/.test(tok)) {
          continue;
        }
        if (!board.move(tok)) return [];
      }
    }
  } catch {
    return [];
  }

  const history = board.history({ verbose: true });
  const walk = new Chess();
  return history.map((move, index) => {
    const fenBefore = walk.fen();
    const fullmove = Number(fenBefore.split(" ")[5] || 1);
    const side = move.color === "w" ? "white" : ("black" as const);
    const uci = uciFromMove(move);
    walk.move(move);
    return {
      ply: index + 1,
      fullmove,
      side,
      san: move.san,
      uci,
      fenBefore,
      fenAfter: walk.fen(),
    };
  });
}

/**
 * Analyze a user-selected game with Stockfish 18 + structure/phase RAG.
 */
export async function analyzeSelectedGame(options: {
  gameId: string;
  pgn?: string | null;
  moves?: string | null;
  eco?: string | null;
  opening?: string | null;
  userColor?: string | null;
  platform?: Platform;
  username?: string;
  /** User rating for peer baseline cell (rating×speed). */
  userRating?: number | null;
  speed?: string | null;
  timeControl?: string | null;
  metrics?: CoachGameMetrics | null;
  evaluate: EvalFn;
  depth?: number;
  multiPv?: number;
  movetimeMs?: number;
  fetchExplorer?: GameCoachExplorerFn;
  /** Optional vector RAG (API). Soft-falls back to theme pack. */
  retrieveKnowledge?: VectorRetrieveFn;
  onProgress?: (p: AnalyzeProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<GameCoachResult> {
  void options.retrieveKnowledge;
  const depth = options.depth ?? COACH_ANALYZE_DEPTH;
  const multiPv = options.multiPv ?? COACH_ANALYZE_MULTIPV;
  const movetimeMs = options.movetimeMs ?? COACH_ANALYZE_MOVETIME;
  const source = options.pgn || options.moves || "";
  const skeleton = parseGamePlies(source);
  const openingLabel = formatOpeningLabel(options.eco, options.opening);
  const openingTags = detectOpeningFamily(options.eco, options.opening);
  const mapEndPly = variationEndPlyFromMap(
    options.opening,
    options.eco,
    skeleton.map((s) => s.san)
  );
  const userColor = normalizeUserColor(options.userColor);
  const usedTips = new Set<string>();
  const plies: GameCoachPly[] = [];
  let prevEval: number | null = null;
  let userPlyCount = 0;
      let pendingOppChance = false;
  let pendingOppWp: number | null = null;
  let pendingOppKind: "mistake" | "blunder" | null = null;
  const structureByPly = confirmedStructureThemesByPly(
    skeleton.map((s) => ({
      fenBefore: s.fenBefore,
      fenAfter: s.fenAfter,
    }))
  );
  const sfPawnStormTracker = new PawnStormTracker(4);
  const userIsWhite = userColor === "white";
  const usedKeyTips: KeyTip[] = [];
  const selectedNotes: string[] = [];
  const usedNoteIds = new Set<string>();
  const structureThemeUsed = new Set<string>();
  let openingPriorTopics: OpeningTipPrior | null = null;
  const phaseNoteCounts: Record<PhaseName, number> = {
    opening: 0,
    middlegame: 0,
    endgame: 0,
  };

  // ——— Pass A: recalculate heuristics + bundled peers (tips later) ———
  options.onProgress?.({
    ply: 0,
    total: skeleton.length,
    status: "Recalculating game metrics…",
  });
  const studyGame = studyGameFromOptions({
    gameId: options.gameId,
    pgn: options.pgn,
    moves: options.moves,
    eco: options.eco,
    opening: options.opening,
    userColor,
    userRating: options.userRating,
    speed: options.speed,
    timeControl: options.timeControl,
  });
  const heuristicRows = await analyzeHeuristicGame(studyGame, {
    signal: options.signal,
  });

  const sharedPositions: Record<string, PositionEval> = {};
  const collectedPositions: Record<string, PositionEval> = {};
  let vaultSeries: number[] = [];
  let vaultRecord: GlobalGameRecord | null = null;
  if (options.platform && options.username) {
    try {
      const vault = await loadPermanentEvalStore({
        platform: options.platform,
        username: options.username,
      });
      vaultRecord = getSharedGameRecord(vault, options.gameId);
      if (vaultRecord?.positions) {
        Object.assign(sharedPositions, vaultRecord.positions);
      }
      if (vaultRecord?.evalsWhiteCp?.length) {
        vaultSeries = vaultRecord.evalsWhiteCp;
      }
    } catch {
      /* vault optional */
    }
  }

  let metrics: CoachGameMetrics =
    heuristicRows.opening && heuristicRows.middlegame && heuristicRows.endgame
      ? buildCoachGameMetrics({
          record: vaultRecord,
          heuristics: {
            opening: heuristicRows.opening,
            middlegame: heuristicRows.middlegame,
            endgame: heuristicRows.endgame,
          },
          userColor,
        })
      : buildCoachGameMetrics({
          record: vaultRecord,
          heuristics: null,
          userColor,
        });
  enrichMomentsWithPlies(metrics.momentsByPly, skeleton);
  ensureFixedOpeningMoments(metrics.momentsByPly, userIsWhite, skeleton.length, {
    eco: options.eco || null,
    opening: options.opening || null,
  });

  const openingRow: OpeningGameRow | null = heuristicRows.opening;
  const baselines = await loadBaselineStore();
  const peerRatingRaw = options.userRating;
  const peerRating =
    peerRatingRaw == null || peerRatingRaw === ("" as unknown)
      ? null
      : Number(peerRatingRaw);
  const peerCtx: OpeningPeerContext = {
    baselines,
    rating: Number.isFinite(peerRating as number) ? peerRating : null,
    speed: options.speed ?? null,
    timeControl: options.timeControl ?? null,
  };
  enrichOpeningCoachMoments({
    momentsByPly: metrics.momentsByPly,
    opening: openingRow,
    userColor,
    badAccuracyMoves: vaultRecord?.openingCandidates?.length ?? null,
    peer: peerCtx,
    openingName:
      formatOpeningLabel(options.eco, options.opening) ||
      options.opening ||
      null,
  });
  enrichMiddlegameCoachMoments({
    momentsByPly: metrics.momentsByPly,
    middlegame: heuristicRows.middlegame,
    peer: peerCtx,
    styleExtras: {
      brilliant_moves: null,
      excellent_moves: null,
      important_moves: null,
    },
  });
  enrichMiddlegameStrategicMoments({
    momentsByPly: metrics.momentsByPly,
    userColor: userIsWhite ? "w" : "b",
  });
  enrichEndgameCoachMoments({
    momentsByPly: metrics.momentsByPly,
    userColor: userIsWhite ? "w" : "b",
    eg: heuristicRows.endgame,
    style: null,
  });

  const openingKeyId: string | null = resolveOpeningPackKey(
    options.eco,
    options.opening
  );
  let gamePlan = emptyGamePlanState(openingKeyId);
  let stickySituations: DetectedSituation[] = [];

  // Pack keys loaded in Pass C after line metrics stamped.

  const resolveEval = async (
    fen: string,
    evalDepth: number,
    evalMultiPv: number,
    evalMovetimeMs: number = movetimeMs,
    force = false
  ): Promise<EngineEvalResult> => {
    const key = fenKey(fen);
    const hit = sharedPositions[key] || collectedPositions[key];
    // Vault/study scans often store MultiPV 1. Important needs ≥2 lines —
    // re-run Stockfish when the caller asked for MultiPV and vault is thin.
    const hitLines = hit?.multipv?.length ?? (hit?.bestUci ? 1 : 0);
    if (
      !force &&
      hit &&
      (evalMultiPv <= 1 || hitLines >= Math.min(2, evalMultiPv))
    ) {
      return evalFromSharedPosition(hit);
    }
    const raw = await options.evaluate(
      fen,
      evalDepth,
      evalMultiPv,
      evalMovetimeMs
    );
    const bestUci = raw.bestUci || null;
    const multipv = (raw.multipv || [])
      .slice(0, Math.max(1, evalMultiPv))
      .map((row) => ({
        uci: row.uci,
        cpWhite: row.cpWhite,
        pv: row.pv,
      }));
    const stmBest = bestStmCp([
      raw.cpWhite,
      ...multipv.map((row) => row.cpWhite),
    ]);
    collectedPositions[key] = {
      cpWhite: stmBest,
      bestUci,
      multipv: multipv.length ? multipv : undefined,
    };
    sharedPositions[key] = collectedPositions[key];
    return {
      cpWhite: stmBest,
      bestUci,
      bestPv: raw.bestPv,
      multipv: raw.multipv,
    };
  };

  let namedEndPly: number | null = null;
  let freqEndPly: number | null = null;
  let proAvailable = false;
  // Local opening map already decides book end — skip Lichess/masters explorer walk.
  if (options.fetchExplorer && skeleton.length && mapEndPly == null) {
    options.onProgress?.({
      ply: 0,
      total: skeleton.length,
      status: "Checking opening theory…",
    });
    const pro = await professionalTheoryEndPly(
      skeleton,
      options.fetchExplorer,
      options.opening,
      options.signal,
      (status) =>
        options.onProgress?.({
          ply: 0,
          total: skeleton.length,
          status,
        })
    );
    proAvailable = pro.available;
    namedEndPly = pro.namedEndPly;
    freqEndPly = pro.freqEndPly;
  }

  for (let i = 0; i < skeleton.length; i++) {
    if (options.signal?.cancelled) break;
    const sk = skeleton[i];
    const isUserPly = sk.side === userColor;
    let momentAtPly = isUserPly
      ? momentAlignedToPly(
          metrics.momentsByPly[sk.ply] || null,
          sk.fenBefore,
          sk.san
        )
      : null;
    const sample = true;
    options.onProgress?.({
      ply: i + 1,
      total: skeleton.length,
      status: `Evaluating ${sk.fullmove}${sk.side === "white" ? "." : "..."} ${sk.san}`,
    });

    let evalBefore: number | null =
      whiteCpFromSeries(vaultSeries, sk.ply - 1) ?? prevEval;
    let evalAfter: number | null = whiteCpFromSeries(vaultSeries, sk.ply);
    let bestSan: string | null = null;
    let bestPvSan: string[] = [];
    let lines: EngineLine[] = [];
    let deltaCp = 0;
    let note = "";
    let analyzed = false;
    let mark: CoachMark | null = null;

    try {
      const beforeKey = fenKey(sk.fenBefore);
      const afterKey = fenKey(sk.fenAfter);
      const hasBeforePos = Boolean(
        sharedPositions[beforeKey] || collectedPositions[beforeKey]
      );
      const hasAfterPos = Boolean(
        sharedPositions[afterKey] || collectedPositions[afterKey]
      );

      if (sample) {
        const before = await resolveEval(sk.fenBefore, depth, multiPv);
        evalBefore = toWhiteCp(sk.fenBefore, before.cpWhite);
        bestSan = sanFromUci(sk.fenBefore, before.bestUci);
        bestPvSan = pvToSan(
          sk.fenBefore,
          before.bestPv,
          engineLineSansBudget()
        );
        lines = linesFromEval(sk.fenBefore, before);
      } else if (hasBeforePos) {
        const hit =
          sharedPositions[beforeKey] || collectedPositions[beforeKey];
        if (hit) {
          const fromHit = evalFromSharedPosition(hit);
          if (hit.bestUci) bestSan = sanFromUci(sk.fenBefore, hit.bestUci);
          bestPvSan = pvToSan(
            sk.fenBefore,
            fromHit.bestPv,
            engineLineSansBudget()
          );
          lines = linesFromEval(sk.fenBefore, fromHit);
        }
      }

      let afterEval: EngineEvalResult | null = null;
      if (evalAfter == null || hasAfterPos) {
        afterEval = await resolveEval(sk.fenAfter, depth, multiPv);
        evalAfter = applyForcedMateWhiteCp(
          sk.fenAfter,
          toWhiteCp(sk.fenAfter, afterEval.cpWhite)
        );
      } else if (isUserPly) {
        afterEval = await resolveEval(sk.fenAfter, depth, multiPv);
        evalAfter = applyForcedMateWhiteCp(
          sk.fenAfter,
          toWhiteCp(sk.fenAfter, afterEval.cpWhite)
        );
      }
      analyzed = evalAfter != null;

      if (evalBefore != null && evalAfter != null) {
        const loss =
          sk.side === "white"
            ? evalBefore - evalAfter
            : evalAfter - evalBefore;
        deltaCp = Math.max(0, Math.round(loss));
      }

      let playedBest = Boolean(bestSan && bestSan === sk.san);
      if (isUserPly) userPlyCount += 1;

      let missedOpportunity = false;
      let missedAfterOpp: "mistake" | "blunder" | null = null;
      let pendingPeakForMissed: number | null = null;
      if (
        isUserPly &&
        pendingOppChance &&
        pendingOppWp != null &&
        evalBefore != null &&
        evalAfter != null
      ) {
        pendingPeakForMissed = pendingOppWp;
        missedOpportunity = coachMissedFromPending({
          wpBefore: userWinProbability(evalBefore, userIsWhite),
          wpAfter: userWinProbability(evalAfter, userIsWhite),
          pendingPeakWp: pendingOppWp,
          playedBest: Boolean(bestSan && bestSan === sk.san),
        });
        if (missedOpportunity) missedAfterOpp = pendingOppKind;
        pendingOppChance = false;
        pendingOppWp = null;
        pendingOppKind = null;
      } else if (isUserPly && pendingOppChance) {
        pendingOppChance = false;
        pendingOppWp = null;
        pendingOppKind = null;
      }

      mark =
        evalBefore != null && evalAfter != null
          ? classifyCoachMark({
              side: sk.side,
              evalBeforeCp: evalBefore,
              evalAfterCp: evalAfter,
              playedBest,
              lines,
              fenBefore: sk.fenBefore,
              playedSan: sk.san,
              missedOpportunity,
            })
          : null;

      const pieceCountEarly = sk.fenAfter.split(" ")[0].replace(/\d/g, "").length;
      const phaseEarly = phaseForPly(
        sk.ply,
        pieceCountEarly,
        metrics.phaseBounds,
        momentAtPly?.structuralKind
      );

      const criticalBad =
        isUserPly &&
        !playedBest &&
        (mark === "blunder" || mark === "mistake" || mark === "missed");
      const metricCoachCall =
        criticalBad ||
        (isUserPly && isFixedCheckpointMoment(momentAtPly)) ||
        (isUserPly && mark === "brilliant");

      const runStrongEngine = async () => {
        options.onProgress?.({
          ply: i + 1,
          total: skeleton.length,
          status: `Deepening ${sk.fullmove}${sk.side === "white" ? "." : "..."} ${sk.san}`,
        });
        const deepBefore = await resolveEval(
          sk.fenBefore,
          COACH_CRITICAL_DEPTH,
          COACH_CRITICAL_MULTIPV,
          COACH_CRITICAL_MOVETIME,
          true
        );
        const shallowLines = lines.slice();
        evalBefore = toWhiteCp(sk.fenBefore, deepBefore.cpWhite);
        bestSan = sanFromUci(sk.fenBefore, deepBefore.bestUci);
        const extendedBeforePv = await extendEnginePvUci({
          fen: sk.fenBefore,
          pvUci: deepBefore.bestPv || [],
          evaluate: options.evaluate,
          depth: COACH_CRITICAL_DEPTH,
          movetimeMs: COACH_CRITICAL_MOVETIME,
          signal: options.signal,
        });
        bestPvSan = pvToSan(
          sk.fenBefore,
          extendedBeforePv,
          engineLineSansBudget()
        );
        lines = mergeMultiPvGapLines(
          shallowLines,
          linesFromEval(sk.fenBefore, {
            ...deepBefore,
            bestPv: extendedBeforePv,
          }),
          sk.fenBefore
        );

        const deepAfter = await resolveEval(
          sk.fenAfter,
          COACH_CRITICAL_DEPTH,
          COACH_CRITICAL_MULTIPV,
          COACH_CRITICAL_MOVETIME,
          true
        );
        const extendedAfterPv = await extendEnginePvUci({
          fen: sk.fenAfter,
          pvUci: deepAfter.bestPv || [],
          evaluate: options.evaluate,
          depth: COACH_CRITICAL_DEPTH,
          movetimeMs: COACH_CRITICAL_MOVETIME,
          signal: options.signal,
        });
        afterEval = { ...deepAfter, bestPv: extendedAfterPv };
        evalAfter = applyForcedMateWhiteCp(
          sk.fenAfter,
          toWhiteCp(sk.fenAfter, deepAfter.cpWhite)
        );
        if (evalBefore != null && evalAfter != null) {
          const loss =
            sk.side === "white"
              ? evalBefore - evalAfter
              : evalAfter - evalBefore;
          deltaCp = Math.max(0, Math.round(loss));
        }

        if (vaultSeries.length > 0 && evalBefore != null && evalAfter != null) {
          const beforeIdx = sk.ply - 1;
          if (beforeIdx >= 0 && beforeIdx < vaultSeries.length) {
            vaultSeries[beforeIdx] = evalBefore;
          }
          if (sk.ply < vaultSeries.length) {
            vaultSeries[sk.ply] = evalAfter;
          }
        }

        playedBest = Boolean(bestSan && bestSan === sk.san);
      };

      let usedStrongEngine = false;
      if (metricCoachCall) {
        await runStrongEngine();
        usedStrongEngine = true;
        if (
          criticalBad &&
          pendingPeakForMissed != null &&
          evalBefore != null &&
          evalAfter != null
        ) {
          missedOpportunity = coachMissedFromPending({
            wpBefore: userWinProbability(evalBefore, userIsWhite),
            wpAfter: userWinProbability(evalAfter, userIsWhite),
            pendingPeakWp: pendingPeakForMissed,
            playedBest,
          });
          if (!missedOpportunity) missedAfterOpp = null;
        }
        // Reclassify after deepen — praise/brilliant must use deep evals too.
        mark = classifyCoachMark({
          side: sk.side,
          evalBeforeCp: evalBefore,
          evalAfterCp: evalAfter,
          playedBest,
          lines,
          fenBefore: sk.fenBefore,
          playedSan: sk.san,
          missedOpportunity,
        });
      }

      const playedContSans = afterEval?.bestPv?.length
        ? pvToSan(
            sk.fenAfter,
            afterEval.bestPv,
            Math.max(1, engineLineSansBudget() - 1)
          )
        : [];
      const trapContSans = sansAfterIndex(skeleton, i, 6);
      const factContSans = trapContSans.length ? trapContSans : playedContSans;
      const playedAltLine = composePlayedAltLine({
        playedSan: sk.san,
        continuationSans: playedContSans,
      });

      if (criticalBad) {
        const severity = severityFromMark(mark) || "mistake";
        const prevLive = metrics.momentsByPly[sk.ply];
        const keepStructural =
          prevLive?.structuralKind === "decisive_pawn_break" ||
          isFixedCheckpointMoment(prevLive)
            ? prevLive!.structuralKind
            : null;
        const previewReq = buildCoachNoteRequest({
          ply: sk.ply,
          phase: phaseEarly,
          mark,
          moment: prevLive || null,
          deltaCp,
          fenBefore: sk.fenBefore,
          fenAfter: sk.fenAfter,
          bestPvSan,
          lines,
          playedLineSans: playedAltLine,
          playedSan: sk.san,
          playedContinuationSans: factContSans,
          userColor,
          evalBeforeCp: evalBefore,
          evalAfterCp: evalAfter,
        });
        const lineInputs = previewReq
          ? lineComparisonMomentInputs(previewReq)
          : bestPvSan.length
            ? { engine_line: bestPvSan.join(" ") }
            : {};
        momentAtPly = upsertLiveMoment(metrics.momentsByPly, {
          ply: sk.ply,
          moveNumber: sk.fullmove,
          severity,
          dropCp: Math.max(
            deltaCp,
            severity === "blunder" ? 300 : 150,
            prevLive?.dropCp || 0
          ),
          playedSan: sk.san,
          bestSan,
          fen: sk.fenBefore,
          evalBeforeCp: evalBefore ?? undefined,
          evalAfterCp: evalAfter ?? undefined,
          source: "live",
          structuralKind: keepStructural || undefined,
          inputs: {
            ...(prevLive?.inputs || {}),
            ...lineInputs,
            critical_mark: mark || "mistake",
            ...(missedAfterOpp ? { missed_after_opp: missedAfterOpp } : {}),
          },
        });
      } else if (isUserPly && mark === "brilliant") {
        const praiseDrop = mark === "brilliant" ? 35 : 28;
        momentAtPly = upsertLiveMoment(metrics.momentsByPly, {
          ply: sk.ply,
          moveNumber: sk.fullmove,
          severity: null,
          dropCp: Math.max(momentAtPly?.dropCp || 0, praiseDrop),
          playedSan: sk.san,
          bestSan,
          fen: sk.fenBefore,
          evalBeforeCp: evalBefore ?? undefined,
          evalAfterCp: evalAfter ?? undefined,
          source: momentAtPly?.source || "live",
          inputs: {
            ...(momentAtPly?.inputs || {}),
            praise_mark: mark,
          },
        });
      } else if (isUserPly && momentAtPly) {
        const enrichLineCompare =
          !playedBest &&
          (momentAtPly.structuralKind === "opening_name" ||
            (momentAtPly.structuralKind === "opening_aggregate" &&
              openingEvalGapAllowsEngineLine({
                mark,
                deltaCp,
                fenBefore: sk.fenBefore,
                userColor,
                evalBeforeCp: evalBefore,
                evalAfterCp: evalAfter,
              })));
        const enrichReq = enrichLineCompare
          ? buildCoachNoteRequest({
              ply: sk.ply,
              phase: phaseEarly,
              mark,
              moment: momentAtPly,
              deltaCp,
              fenBefore: sk.fenBefore,
              fenAfter: sk.fenAfter,
              bestPvSan,
              lines,
              playedLineSans: playedAltLine,
              playedSan: sk.san,
              playedContinuationSans: factContSans,
              userColor,
              evalBeforeCp: evalBefore,
              evalAfterCp: evalAfter,
            })
          : null;
        const lineInputs = enrichReq
          ? lineComparisonMomentInputs(enrichReq)
          : {};
        // Quiet opening checkpoint / best move: never stamp engine-vs-played noise.
        // Pawn-break keeps horizon structure Δ even when the break was best.
        if (
          (momentAtPly.structuralKind === "opening_aggregate" &&
            !enrichLineCompare) ||
          (playedBest &&
            (momentAtPly.structuralKind === "opening_name" ||
              momentAtPly.structuralKind === "opening_aggregate"))
        ) {
          if (momentAtPly.inputs) {
            const cleaned = { ...momentAtPly.inputs };
            delete cleaned.engine_line;
            delete cleaned.engine_line_metrics;
            delete cleaned.played_line;
            delete cleaned.played_line_metrics;
            delete cleaned.engine_vs_played;
            delete cleaned.why_better;
            delete cleaned.metric_keys;
            delete cleaned.primary_metric_keys;
            delete cleaned.primary_field;
            delete cleaned.metric_signals;
            momentAtPly = { ...momentAtPly, inputs: cleaned };
          }
        }
        momentAtPly = upsertLiveMoment(metrics.momentsByPly, {
          ...momentAtPly,
          fen: momentAtPly.fen || sk.fenBefore,
          playedSan: momentAtPly.playedSan || sk.san,
          bestSan:
            momentAtPly.structuralKind === "opening_aggregate" &&
            !enrichLineCompare
              ? momentAtPly.bestSan
              : momentAtPly.bestSan || bestSan,
          source: momentAtPly.source,
          inputs: {
            ...(momentAtPly.inputs || {}),
            ...lineInputs,
          },
        });
      }

      // Middlegame: decisive pawn break (structure lever — not only best move).
      if (isUserPly && phaseEarly === "middlegame" && evalBefore != null) {
        try {
          const afterBoard = new Chess(sk.fenAfter);
          const probe = new Chess(sk.fenBefore);
          const mv = probe.move(sk.san);
          if (
            mv &&
            isPawnBreakMove(afterBoard, mv, userIsWhite ? "w" : "b")
          ) {
            if (!usedStrongEngine) {
              await runStrongEngine();
              usedStrongEngine = true;
              playedBest = Boolean(bestSan && bestSan === sk.san);
            }
            const openingTheme = metrics.themesByPhase.opening[0] || null;
            const breakContSans =
              afterEval?.bestPv?.length
                ? pvToSan(
                    sk.fenAfter,
                    afterEval.bestPv,
                    Math.max(1, engineLineSansBudget() - 1)
                  )
                : playedContSans;
            const breakAltLine = composePlayedAltLine({
              playedSan: sk.san,
              continuationSans: breakContSans,
            });
            momentAtPly = upsertLiveMoment(metrics.momentsByPly, {
              ply: sk.ply,
              moveNumber: sk.fullmove,
              severity: null,
              dropCp: Math.max(momentAtPly?.dropCp || 0, 40),
              playedSan: sk.san,
              bestSan,
              fen: sk.fenBefore,
              evalBeforeCp: evalBefore ?? undefined,
              evalAfterCp: evalAfter ?? undefined,
              source: momentAtPly?.source || "structural",
              structuralKind: "decisive_pawn_break",
              inputs: {
                opening: options.opening || openingTheme,
                eco: options.eco || null,
                pawn_break: true,
                played_best: playedBest,
                engine_recommend: pawnBreakEvalGapAllowsRecommend({
                  mark,
                  deltaCp,
                  userColor,
                  evalBeforeCp: evalBefore,
                  evalAfterCp: evalAfter,
                  playedBest,
                }),
                san: sk.san,
              },
            });
            const breakReq = buildCoachNoteRequest({
              ply: sk.ply,
              phase: phaseEarly,
              mark,
              moment: momentAtPly,
              deltaCp,
              fenBefore: sk.fenBefore,
              fenAfter: sk.fenAfter,
              bestPvSan,
              lines,
              playedLineSans: breakAltLine,
              playedSan: sk.san,
              playedContinuationSans: factContSans.length
                ? factContSans
                : breakContSans,
              userColor,
              evalBeforeCp: evalBefore,
              evalAfterCp: evalAfter,
            });
            if (breakReq) {
              momentAtPly = upsertLiveMoment(metrics.momentsByPly, {
                ...momentAtPly,
                inputs: {
                  ...(momentAtPly.inputs || {}),
                  ...lineComparisonMomentInputs({
                    ...breakReq,
                    bestSan,
                    phase: phaseEarly,
                    openingKeyId,
                    openingName: options.opening || null,
                  }),
                  ...coachRequestMetaInputs(breakReq),
                },
              });
            }
          }
        } catch {
          /* ignore illegal probe */
        }
      }

      // Opponent WP gift → pending missed-mark only (no coach moment / tip).
      if (
        !isUserPly &&
        evalBefore != null &&
        evalAfter != null
      ) {
        const wpBeforeUser = userWinProbability(evalBefore, userIsWhite);
        const wpAfterUser = userWinProbability(evalAfter, userIsWhite);
        if (wpAfterUser - wpBeforeUser >= 0.1) {
          pendingOppChance = true;
          pendingOppWp = wpAfterUser;
          pendingOppKind =
            wpAfterUser - wpBeforeUser >= 0.2 ? "blunder" : "mistake";
        }
      }

      const structure = structureByPly[i] || [];
      let stormTempo = 0;
      if (isUserPly) {
        try {
          const afterBoard = new Chess(sk.fenAfter);
          stormTempo = sfPawnStormTracker.update(
            afterBoard,
            userIsWhite ? "w" : "b"
          );
        } catch {
          stormTempo = 0;
        }
      }

      if (sample && isUserPly) {
        const pieceCount = sk.fenAfter.split(" ")[0].replace(/\d/g, "").length;
        const phase = phaseForPly(
          sk.ply,
          pieceCount,
          metrics.phaseBounds,
          momentAtPly?.structuralKind
        );
        const moment = momentAtPly;
        const phaseThemesEarly = metrics.themesByPhase[phase] || [];
        const liveSituations = detectSituations({
          fen: sk.fenAfter,
          phase,
          userColor,
          structureThemes: structure,
          pawnStormTempo: stormTempo,
        });
        stickySituations = mergeStickySituations(
          stickySituations,
          liveSituations
        );
        const planSituations = stickySituations;
        const unusedStructure = durableUnusedStructureThemes({
          windowedStructure: structure,
          situations: planSituations,
          structureThemeUsed,
          phaseThemesFallback: phaseThemesEarly,
        });
        const noteRequest = buildCoachNoteRequest({
          ply: sk.ply,
          phase,
          mark,
          moment,
          deltaCp,
          fenBefore: sk.fenBefore,
          fenAfter: sk.fenAfter,
          bestPvSan,
          lines,
          playedLineSans: playedAltLine,
          playedSan: sk.san,
          playedContinuationSans: factContSans,
          userColor,
          evalBeforeCp: evalBefore,
          evalAfterCp: evalAfter,
          unusedStructureThemes: unusedStructure,
          structureThemes: structure,
          pawnStormTempo: stormTempo,
          situations: planSituations,
        });
        if (noteRequest && moment) {
          const lineInputs = lineComparisonMomentInputs(noteRequest);
          const metaInputs = coachRequestMetaInputs(noteRequest);
          if (
            Object.keys(lineInputs).length ||
            Object.keys(metaInputs).length
          ) {
            moment.inputs = {
              ...(moment.inputs || {}),
              ...lineInputs,
              ...metaInputs,
            };
            if (!moment.bestSan && bestSan) {
              moment.bestSan = bestSan;
            }
            metrics.momentsByPly[sk.ply] = moment;
            momentAtPly = moment;
          }
        }
        void structure;
      }
      note = "";
    } catch {
      analyzed = false;
      note = "";
      mark = null;
    }

    prevEval = evalAfter ?? evalBefore ?? prevEval;

    plies.push({
      ...sk,
      evalBeforeCp: evalBefore,
      evalAfterCp: evalAfter,
      deltaCp,
      bestSan,
      bestPvSan,
      lines,
      note,
      analyzed,
      mark,
    });

    await new Promise((r) => setTimeout(r, 0));
  }

  // Opp gifts never become coach moments (strip legacy / accidental injects).
  for (const [plyKey, m] of Object.entries(metrics.momentsByPly)) {
    if (m.structuralKind !== "opponent_mistake") continue;
    if (m.inputs?.critical_mark) {
      delete m.structuralKind;
      metrics.momentsByPly[Number(plyKey)] = m;
    } else {
      delete metrics.momentsByPly[Number(plyKey)];
    }
  }

  // Drop already-decided mate conversions / non-deviations.
  // Keep live blunders — including equal → mate-in-N.
  for (const [ply, m] of Object.entries(metrics.momentsByPly)) {
    if (shouldDropNoiseCoachMoment(m)) {
      delete metrics.momentsByPly[Number(ply)];
    }
  }

  // Rebuild metrics with eval buckets + style (move effects already in heuristics).
  const evalsCp: number[] = [];
  if (plies.length) {
    evalsCp.push(plies[0]!.evalBeforeCp ?? 0);
    for (const p of plies) {
      evalsCp.push(p.evalAfterCp ?? evalsCp[evalsCp.length - 1]!);
    }
  }
  const evalMetrics = analyzeEvalBucketMetrics(studyGame, evalsCp);
  const openingMerged = heuristicRows.opening
    ? {
        ...heuristicRows.opening,
        opening_accuracy_pct:
          evalMetrics.opening_accuracy_pct ??
          heuristicRows.opening.opening_accuracy_pct,
        accuracy_moves:
          evalMetrics.opening_accuracy_moves ||
          heuristicRows.opening.accuracy_moves,
      }
    : null;
  const mergedMg =
    heuristicRows.middlegame && evalMetrics.middlegameEval
      ? mergeMiddlegameHeuristicWithBucket(
          heuristicRows.middlegame,
          evalMetrics.middlegameEval
        )
      : heuristicRows.middlegame;
  const mergedEg =
    heuristicRows.endgame && evalMetrics.endgameEval
      ? mergeEndgameHeuristicWithBucket(
          heuristicRows.endgame,
          evalMetrics.endgameEval
        )
      : heuristicRows.endgame;
  const liveMoments = { ...metrics.momentsByPly };
  if (openingMerged && mergedMg && mergedEg) {
    metrics = buildCoachGameMetrics({
      record: {
        evalsWhiteCp: evalsCp,
        openingCandidates: vaultRecord?.openingCandidates,
        mistakeCandidates: vaultRecord?.mistakeCandidates,
        opening_accuracy_pct: evalMetrics.opening_accuracy_pct,
        opening_accuracy_moves: evalMetrics.opening_accuracy_moves,
        middlegameEval: evalMetrics.middlegameEval,
        endgameEval: evalMetrics.endgameEval,
        style: evalMetrics.style,
      },
      heuristics: {
        opening: openingMerged,
        middlegame: mergedMg,
        endgame: mergedEg,
      },
      userColor,
    });
    for (const [ply, m] of Object.entries(liveMoments)) {
      metrics.momentsByPly[Number(ply)] = m;
    }
    enrichOpeningCoachMoments({
      momentsByPly: metrics.momentsByPly,
      opening: openingMerged,
      userColor,
      badAccuracyMoves: vaultRecord?.openingCandidates?.length ?? null,
      peer: peerCtx,
      openingName:
        formatOpeningLabel(options.eco, options.opening) ||
        options.opening ||
        null,
    });
    enrichMiddlegameCoachMoments({
      momentsByPly: metrics.momentsByPly,
      middlegame: mergedMg,
      peer: peerCtx,
      styleExtras: {
        brilliant_moves: evalMetrics.style?.brilliant_moves ?? null,
        excellent_moves: evalMetrics.style?.excellent_moves ?? null,
        important_moves: evalMetrics.style?.important_moves ?? null,
      },
    });
    enrichLiveMiddlegamePeerGaps({
      momentsByPly: metrics.momentsByPly,
      middlegame: mergedMg,
      peer: peerCtx,
    });
    enrichMiddlegameStrategicMoments({
      momentsByPly: metrics.momentsByPly,
      userColor: userIsWhite ? "w" : "b",
    });
    enrichEndgameCoachMoments({
      momentsByPly: metrics.momentsByPly,
      userColor: userIsWhite ? "w" : "b",
      eg: mergedEg || heuristicRows.endgame,
      style: evalMetrics.style,
    });
  }

  const theoryEndPly = resolveBookEndPly({
    mapEndPly,
    namedEndPly,
    freqEndPly,
    proAvailable,
  });
  const bookEndPly = trimBookEndByWinProb(plies, theoryEndPly, userIsWhite);
  if (bookEndPly != null) {
    for (const ply of plies) {
      if (ply.ply > bookEndPly) continue;
      if (ply.mark && COACH_MARKS_KEEP_OVER_BOOK.has(ply.mark)) continue;
      ply.mark = "book";
    }
  }

  // ——— Pass C: soft keys / themes / pack tips (after full metric context) ———
  options.onProgress?.({
    ply: skeleton.length,
    total: skeleton.length,
    status: "Selecting coach comments…",
  });
  const coachPack = await loadCoachPack();
  const packByKey = getCoachPackByKey();
  const phaseKeys: PhaseGameKeys = collectGameKeysByPhase({
    entries: coachPack.entries,
    byKey: packByKey,
    eco: options.eco,
    opening: options.opening,
    themesByPhase: metrics.themesByPhase,
    globalThemes: metrics.globalThemes,
  });
  const gameKeys = collectGameKeys({
    entries: coachPack.entries,
    byKey: packByKey,
    eco: options.eco,
    opening: options.opening,
    themesByPhase: metrics.themesByPhase,
    globalThemes: metrics.globalThemes,
  });
  if (openingKeyId) {
    const hit =
      packByKey?.get(openingKeyId) ||
      coachPack.entries.find((e) => (e.keyId || e.id) === openingKeyId);
    if (hit) {
      phaseKeys.opening = [
        hit,
        ...phaseKeys.opening.filter(
          (e) => (e.keyId || e.id) !== openingKeyId
        ),
      ];
    }
  }

  const pawnStormTracker = new PawnStormTracker(4);
  for (let i = 0; i < plies.length; i += 1) {
    if (options.signal?.cancelled) break;
    const ply = plies[i]!;
    const isUserPly = ply.side === userColor;
    if (!isUserPly) {
      continue;
    }
    const structure = structureByPly[i] || [];
    let stormTempo = 0;
    try {
      const afterBoard = new Chess(ply.fenAfter);
      stormTempo = pawnStormTracker.update(
        afterBoard,
        userColor === "white" ? "w" : "b"
      );
    } catch {
      stormTempo = 0;
    }
    const pieceCount = ply.fenAfter.split(" ")[0].replace(/\d/g, "").length;
    const moment = metrics.momentsByPly[ply.ply] || null;
    const phase = phaseForPly(
      ply.ply,
      pieceCount,
      metrics.phaseBounds,
      moment?.structuralKind
    );
    const playedBest = Boolean(ply.bestSan && ply.bestSan === ply.san);
    const pov = assessPositionPov(ply.fenAfter, userColor);
    const provisionalThemes = [
      ...structure,
      ...(pov.kingMotifLive ? pov.themes : []),
      ...openingTags,
      ...metrics.themesByPhase[phase],
    ];
    const errorKind = classifyUserError({
      fenBefore: ply.fenBefore,
      playedSan: ply.san,
      bestSan: ply.bestSan,
      bestPvSan: ply.bestPvSan,
      deltaCp: ply.deltaCp,
      themes: provisionalThemes,
      userColor,
      moment,
      pov,
      coachMark: ply.mark,
    });
    const phaseThemes = metrics.themesByPhase[phase] || [];
    const liveSituations = detectSituations({
      fen: ply.fenAfter,
      phase,
      userColor,
      structureThemes: structure,
      pawnStormTempo: stormTempo,
    });
    stickySituations = mergeStickySituations(
      stickySituations,
      liveSituations
    );
    const planSituations = stickySituations;
    const unusedStructure = durableUnusedStructureThemes({
      windowedStructure: structure,
      situations: planSituations,
      structureThemeUsed,
      phaseThemesFallback: phaseThemes,
    });
    const playedLineToks = String(moment?.inputs?.played_line || "")
      .split(/\s+/)
      .filter(Boolean);
    const trapContSans = sansAfterIndex(plies, i, 6);
    gamePlan = advanceGamePlan(gamePlan, {
      situations: planSituations,
      structureThemes: structure,
      phase,
    });
    const noteRequest = buildCoachNoteRequest({
      ply: ply.ply,
      phase,
      mark: ply.mark,
      moment,
      deltaCp: ply.deltaCp,
      fenBefore: ply.fenBefore,
      fenAfter: ply.fenAfter,
      bestPvSan: ply.bestPvSan,
      lines: ply.lines,
      playedSan: ply.san,
      playedLineSans: playedLineToks.length ? playedLineToks : undefined,
      playedContinuationSans: trapContSans,
      userColor,
      evalBeforeCp: ply.evalBeforeCp,
      evalAfterCp: ply.evalAfterCp,
      unusedStructureThemes: unusedStructure,
      structureThemes: structure,
      pawnStormTempo: stormTempo,
      situations: planSituations,
    });
    const noteWorthy = shouldComposeNote({
      perspective: "user",
      deltaCp: ply.deltaCp,
      playedBest,
      moment,
      structure,
      errorKind,
      mark: ply.mark,
      ply: ply.ply,
      userPlyCount: Math.ceil(ply.ply / 2),
    });
    const metricTipOk = shouldAttachMetricTip({
      phase,
      moment,
      mark: ply.mark,
      deltaCp: ply.deltaCp,
      phaseThemes,
      structureThemeUsed,
      request: noteRequest,
    });
    if (!metricTipOk) continue;

    const metricsThemes = [
      ...metrics.themesByPhase[phase],
      ...(moment || ply.deltaCp >= 50 ? metrics.globalThemes : []),
    ];
    const themes = expandCoachThemes({
      structure,
      openingTags,
      phase,
      deltaCp: ply.deltaCp,
      playedBest,
      metricsThemes,
      moment,
      perspective: "user",
      errorKind,
      noteWorthy: noteWorthy || metricTipOk,
      pov,
      fenBefore: ply.fenBefore,
      playedSan: ply.san,
      bestSan: ply.bestSan,
      usedTips,
    });
    void noteWorthy;
    // Always-attach coach calls (praise / bad / structural / fixed) skip phase cap.
    const alwaysCall =
      (noteRequest != null && requestAlwaysAttaches(noteRequest.kind)) ||
      isFixedCheckpointMoment(moment);
    if (
      !alwaysCall &&
      phaseNoteCounts[phase] >= PHASE_NOTE_LIMITS[phase]
    ) {
      continue;
    }

    const tip = pickMetricTip({
      entries: phaseKeys[phase],
      byKey: packByKey,
      metrics,
      phase,
      mark: ply.mark,
      deltaCp: ply.deltaCp,
      moment,
      openingKeyId,
      eco: options.eco,
      opening: options.opening,
      themes,
      excludeNoteIds: usedNoteIds,
      structureThemeUsed,
      allowStructureQuiet: false,
      request: noteRequest,
      userColor,
      priorTopics: openingPriorTopics,
      gamePlan,
      onOpeningTipUsed: (meta) => {
        openingPriorTopics = mergeOpeningTipPrior(openingPriorTopics, meta);
        gamePlan = mergeOpeningPlanKeys(
          gamePlan,
          meta.softKeys,
          openingKeyId
        );
      },
    });
    if (!tip) continue;
    if (tip.keyIds?.length || tip.keyId) {
      gamePlan = markPlanKeysTaught(
        gamePlan,
        tip.keyIds?.length ? tip.keyIds : tip.keyId ? [tip.keyId] : []
      );
    }
    if (moment) {
      const ids =
        tip.keyIds?.length
          ? tip.keyIds.slice(0, 3)
          : tip.keyId
            ? [tip.keyId]
            : [];
      const metaStamp = coachRequestMetaInputs(noteRequest);
      if (ids.length || Object.keys(metaStamp).length) {
        moment.inputs = {
          ...(moment.inputs || {}),
          ...metaStamp,
          ...(ids.length
            ? {
                key_id: ids[0]!,
                key_ids: ids.join(","),
                game_plan: formatGamePlanShort(gamePlan) || null,
              }
            : {
                game_plan: formatGamePlanShort(gamePlan) || null,
              }),
        };
      }
    }
    const tipHasSquares = /\b[a-h][1-8]\b/i.test(tip.text || "");
    const note = acceptKeyNote(tip.text, usedTips, {
      themes,
      fenBefore: tipHasSquares ? ply.fenBefore : undefined,
      san: tipHasSquares ? ply.san : undefined,
      bestSan: tipHasSquares ? ply.bestSan : undefined,
      bestPvSan: tipHasSquares ? ply.bestPvSan : undefined,
      userColor,
      phase,
      noteId: tip.noteId,
    });
    if (!note) continue;
    tip.text = note;
    ply.note = note;
    const weightTop = rankMetricNoteWeights({
      phase,
      themes: themesForPly({
        metrics,
        phase,
        moment,
        deltaCp: ply.deltaCp,
        request: noteRequest,
      }),
      mark: ply.mark,
      deltaCp: ply.deltaCp,
      moment,
      openingKeyId,
      eco: options.eco,
      opening: options.opening,
      limit: 8,
      request: noteRequest,
      gamePlan,
    }).map((w) => ({
      keyId: w.keyId,
      weight: w.weight,
      formatted: formatWeightBreakdown(w),
    }));
    ply.noteRefs = buildCommentRefs({
      tipText: note,
      keyIds: tip.keyIds || (tip.keyId ? [tip.keyId] : []),
      tipMeta: tip.tipMeta || null,
      weightTop,
      softKeysPool: tip.tipMeta?.softKeys || tip.keyIds || [],
      inputs: {
        ...(moment?.inputs || {}),
        ...(noteRequest?.inputs || {}),
      },
      situations: noteRequest?.situations || null,
      tacticalFact: noteRequest?.tacticalFact || null,
      primaryField:
        typeof noteRequest?.inputs?.primary_field === "string"
          ? noteRequest.inputs.primary_field
          : null,
      primarySoftKeys: tip.tipMeta?.softKeys || null,
    });
    usedKeyTips.push(tip);
    phaseNoteCounts[phase] += 1;
    if (tip.noteId) usedNoteIds.add(tip.noteId);
    selectedNotes.push(note);
    for (const t of structure) structureThemeUsed.add(t);
  }

  if (plies.length) {
    const last = plies[plies.length - 1]!;
    const summary = composeGameSummaryNote({
      plies,
      userColor,
      metrics,
      openingLabel,
      openingPackKey: openingKeyId,
      usedKeyTips,
      gameKeys,
      selectedNotes,
    });
    last.note = summary;
    last.noteRefs = buildCommentRefs({
      tipText: summary,
      tipMeta: {
        topics: ["summary", "eval:swing"],
        softKeys: [],
        metrics: ["eval:swing"],
        clauses: [],
      },
      keyIds: usedKeyTips
        .flatMap((t) => t.keyIds || (t.keyId ? [t.keyId] : []))
        .slice(0, 5),
      weightTop: [],
      softKeysPool: [],
      inputs: {},
    });
  }

  if (options.platform && options.username && plies.length) {
    const filters = {
      platform: options.platform,
      username: options.username,
    };
    try {
      if (openingMerged && mergedMg && mergedEg) {
        await upsertHeuristicGame(filters, options.gameId, {
          opening: openingMerged,
          middlegame: mergedMg,
          endgame: mergedEg,
        });
      }
    } catch {
      /* heuristics store write optional */
    }
    try {
      const product = buildVaultProductFromPlies({
        gameId: options.gameId,
        pgn: options.pgn,
        moves: options.moves,
        eco: options.eco,
        opening: options.opening,
        userColor: options.userColor,
        plies,
        positions: { ...sharedPositions, ...collectedPositions },
      });
      await upsertSharedGameEvals(filters, options.gameId, {
        positions: product.positions,
        evalsWhiteCp: product.evalsWhiteCp,
        mistakeCandidates: product.mistakeCandidates,
        openingCandidates: product.openingCandidates,
        opening_accuracy_pct: product.opening_accuracy_pct,
        opening_accuracy_moves: product.opening_accuracy_moves,
        endgameEval: product.endgameEval ?? evalMetrics.endgameEval,
        middlegameEval: product.middlegameEval ?? evalMetrics.middlegameEval,
        style: product.style ?? evalMetrics.style,
        preferExistingMeta: false,
      });
    } catch {
      /* vault write optional */
    }
  }

  return {
    gameId: options.gameId,
    openingLabel,
    analyzedAt: Date.now(),
    depth,
    plies,
    notesCount: plies.filter((p) => p.note).length,
  };
}

export function buildReplayPlies(pgnOrMoves: string): GameCoachPly[] {
  return parseGamePlies(pgnOrMoves).map((p) => ({
    ...p,
    evalBeforeCp: null,
    evalAfterCp: null,
    deltaCp: 0,
    bestSan: null,
    bestPvSan: [],
    lines: [],
    note: "",
    analyzed: false,
    mark: null,
  }));
}

export function applyUciOnFen(fen: string, uci: string): string | null {
  const board = new Chess(fen);
  if (!applyUciMove(board, uci)) return null;
  return board.fen();
}

export { formatEval };
