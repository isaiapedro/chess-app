import { Chess, type Square } from "chess.js";
import {
  COACH_ANALYZE_MULTIPV,
  REFINE_DEPTH,
  REFINE_MOVETIME,
} from "../analysisConfig";
import { applyUciMove, fenKey, sanToUci, uciFromMove } from "../chessMoves";
import { toWhiteCp } from "../analyzeMistakes";
import type { StudyGame } from "../analyzeMistakes";
import { openingNamesMatch, variationEndPlyFromMap } from "../openingLines";
import {
  analyzeEvalBucketMetrics,
} from "../evalBucketMetrics";
import {
  getSharedGameRecord,
  loadPermanentEvalStore,
  upsertSharedGameEvals,
  type GlobalGameRecord,
  type PositionEval,
} from "../globalAnalysis";
import type { MistakeItem } from "../../api/client";
import {
  classifyCoachMark,
  coachMissedFromPending,
  isCoachMistakeOrWorse,
  type CoachMark,
} from "./coachMarks";
import { userWinProbability, WP_INACCURACY_DROP } from "../winProb";
import { formatOpeningLabel } from "./ecoLabels";
import {
  emptyCoachGameMetrics,
  lookupCoachGameMetrics,
  type CoachGameMetrics,
} from "./gameMetricsLookup";
import { composeCoachNote, expandCoachThemes, classifyUserError, shouldComposeNote } from "./noteCompose";
import { composeGameSummaryNote } from "./gameSummary";
import { phasePlanSlotOpen } from "./phasePlans";
import { assessPositionPov } from "./positionPov";
import {
  mergeHybridKnowledgeNuggets,
  type KnowledgeNugget,
  type RetrieveContext,
  type VectorRetrieveFn,
} from "./retrieve";
import { missedForcingLine } from "./tacticalFact";
import {
  detectOpeningFamily,
  StructureThemeTracker,
} from "./structureDetect";
import type { Platform } from "../../api/types";
import { claimNoteText } from "./noteRelevance";
import { claimNoteTopic } from "./noteTopics";

const KING_FILTER = new Set([
  "king_safety",
  "opp_king_exposed",
  "user_king_exposed",
]);

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

const MATE_CP_THRESHOLD = 50000;
const EVAL_CLAMP = 2000;
const MATE_MOVE_SPAN = 100;

function mateMovesFromCp(cp: number): number | null {
  const abs = Math.abs(cp);
  if (abs >= MATE_CP_THRESHOLD) {
    return Math.max(0, Math.min(99, Math.round((100000 - abs) / 1000)));
  }
  if (abs > EVAL_CLAMP) {
    return Math.max(0, Math.round(MATE_MOVE_SPAN - (abs - EVAL_CLAMP)));
  }
  return null;
}

function formatEval(cp: number | null): string {
  if (cp == null) return "n/a";
  const moves = mateMovesFromCp(cp);
  if (moves != null) {
    if (moves === 0) return "Checkmate";
    return `Mate in ${moves}`;
  }
  return `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}

function phaseForPly(ply: number, pieceCount: number): "opening" | "middlegame" | "endgame" {
  if (ply <= 16 && pieceCount >= 28) return "opening";
  if (pieceCount <= 12) return "endgame";
  return "middlegame";
}

function shouldSamplePly(ply: number, totalPlies: number): boolean {
  if (totalPlies <= 0) return false;
  if (ply <= 24) return true;
  if (ply >= totalPlies - 1) return true;
  return ply % 2 === 0;
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
      ? result.multipv
      : result.bestUci
        ? [{ uci: result.bestUci, cpWhite: result.cpWhite, pv: result.bestPv }]
        : [];
  return rows.slice(0, 3).map((row, i) => {
    const pvSan = pvToSan(fen, row.pv?.length ? row.pv : row.uci ? [row.uci] : []);
    return {
      rank: i + 1,
      san: pvSan[0] || sanFromUci(fen, row.uci) || row.uci || "—",
      cpWhite: toWhiteCp(fen, row.cpWhite),
      pvSan,
    };
  });
}

type EngineEvalResult = {
  cpWhite: number;
  bestUci: string | null;
  bestPv?: string[];
  multipv?: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
};

function evalFromSharedPosition(hit: PositionEval): EngineEvalResult {
  const pv = hit.bestUci ? [hit.bestUci] : [];
  return {
    cpWhite: hit.cpWhite,
    bestUci: hit.bestUci,
    bestPv: pv,
    multipv: hit.bestUci
      ? [{ uci: hit.bestUci, cpWhite: hit.cpWhite, pv }]
      : [],
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
      const bestUci =
        positions[beforeKey]?.bestUci ||
        (ply.bestSan ? sanToUci(ply.fenBefore, ply.bestSan) : null) ||
        null;
      positions[beforeKey] = {
        cpWhite: stmCpFromWhite(ply.fenBefore, ply.evalBeforeCp),
        bestUci,
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
  const depth = options.depth ?? REFINE_DEPTH;
  const multiPv = options.multiPv ?? COACH_ANALYZE_MULTIPV;
  const movetimeMs = options.movetimeMs ?? REFINE_MOVETIME;
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
  const usedKnowledge = new Set<string>();
  const usedTips = new Set<string>();
  const plies: GameCoachPly[] = [];
  let prevEval: number | null = null;
  let userPlyCount = 0;
  let pendingOppChance = false;
  let pendingOppWp: number | null = null;
  const structureTracker = new StructureThemeTracker();
  const userIsWhite = userColor === "white";

  let metrics = options.metrics || null;
  if (!metrics && options.platform && options.username) {
    try {
      metrics = await lookupCoachGameMetrics({
        platform: options.platform,
        username: options.username,
        gameId: options.gameId,
        userColor,
      });
    } catch {
      metrics = emptyCoachGameMetrics();
    }
  }
  if (!metrics) metrics = emptyCoachGameMetrics();

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

  const resolveEval = async (
    fen: string,
    evalDepth: number,
    evalMultiPv: number
  ): Promise<EngineEvalResult> => {
    const key = fenKey(fen);
    const hit = sharedPositions[key] || collectedPositions[key];
    if (hit) {
      return evalFromSharedPosition(hit);
    }
    const raw = await options.evaluate(
      fen,
      evalDepth,
      evalMultiPv,
      movetimeMs
    );
    const bestUci = raw.bestUci || null;
    collectedPositions[key] = { cpWhite: raw.cpWhite, bestUci };
    sharedPositions[key] = collectedPositions[key];
    return {
      cpWhite: raw.cpWhite,
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
    const momentAtPly = isUserPly ? metrics.momentsByPly[sk.ply] || null : null;
    const sample =
      shouldSamplePly(sk.ply, skeleton.length) || Boolean(momentAtPly);
    options.onProgress?.({
      ply: i + 1,
      total: skeleton.length,
      status: sample
        ? `Evaluating ${sk.fullmove}${sk.side === "white" ? "." : "..."} ${sk.san}`
        : "Replaying…",
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
        // Vault hit returns immediately; SF only when fen missing from vault.
        const before = await resolveEval(sk.fenBefore, depth, multiPv);
        if (evalBefore == null) {
          evalBefore = toWhiteCp(sk.fenBefore, before.cpWhite);
        }
        bestSan = sanFromUci(sk.fenBefore, before.bestUci);
        bestPvSan = pvToSan(sk.fenBefore, before.bestPv);
        lines = linesFromEval(sk.fenBefore, before);
      } else if (hasBeforePos) {
        const hit =
          sharedPositions[beforeKey] || collectedPositions[beforeKey];
        if (hit?.bestUci) bestSan = sanFromUci(sk.fenBefore, hit.bestUci);
      }

      if (evalAfter == null || hasAfterPos) {
        const after = await resolveEval(sk.fenAfter, depth, 1);
        evalAfter = toWhiteCp(sk.fenAfter, after.cpWhite);
      }
      analyzed = evalAfter != null;

      if (evalBefore != null && evalAfter != null) {
        const loss =
          sk.side === "white"
            ? evalBefore - evalAfter
            : evalAfter - evalBefore;
        deltaCp = Math.max(0, Math.round(loss));
      }

      const playedBest = Boolean(bestSan && bestSan === sk.san);
      if (isUserPly) userPlyCount += 1;

      let missedOpportunity = false;
      if (
        isUserPly &&
        pendingOppChance &&
        pendingOppWp != null &&
        evalBefore != null &&
        evalAfter != null
      ) {
        const wpBeforeUser = userWinProbability(evalBefore, userIsWhite);
        const wpAfterUser = userWinProbability(evalAfter, userIsWhite);
        missedOpportunity = coachMissedFromPending({
          wpBefore: wpBeforeUser,
          wpAfter: wpAfterUser,
          pendingPeakWp: pendingOppWp,
        });
        pendingOppChance = false;
        pendingOppWp = null;
      } else if (isUserPly && pendingOppChance) {
        pendingOppChance = false;
        pendingOppWp = null;
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
        }
      }

      const structure = structureTracker.update(sk.fenBefore, sk.fenAfter);

      if (sample) {
        const pieceCount = sk.fenAfter.split(" ")[0].replace(/\d/g, "").length;
        const phase = phaseForPly(sk.ply, pieceCount);
        const pov = assessPositionPov(sk.fenAfter, userColor);
        const moment = momentAtPly;
        const perspective = isUserPly ? "user" : "opponent";
        const provisionalThemes = [
          ...structure,
          ...(pov.kingMotifLive ? pov.themes : []),
          ...openingTags,
          ...(isUserPly ? metrics.themesByPhase[phase] : []),
        ];
        const errorKind = isUserPly
          ? classifyUserError({
              fenBefore: sk.fenBefore,
              playedSan: sk.san,
              bestSan,
              bestPvSan,
              deltaCp,
              themes: provisionalThemes,
              userColor,
              moment,
              pov,
            })
          : null;
        const noteWorthy = shouldComposeNote({
          perspective,
          deltaCp,
          playedBest,
          moment,
          structure,
          errorKind,
          ply: sk.ply,
          userPlyCount,
        });
        const wantPhasePlan =
          isUserPly && phasePlanSlotOpen(phase, sk.ply);
        if (!noteWorthy && !wantPhasePlan) {
          note = "";
        } else {
          const metricsThemes = isUserPly
            ? moment || deltaCp >= 80 || playedBest
              ? [
                  ...metrics.themesByPhase[phase],
                  ...(moment ? metrics.globalThemes : []),
                ]
              : []
            : [];
          const themes = expandCoachThemes({
            structure,
            openingTags,
            phase,
            deltaCp,
            playedBest,
            metricsThemes,
            moment,
            perspective,
            errorKind,
            noteWorthy: noteWorthy || wantPhasePlan,
            pov,
            fenBefore: sk.fenBefore,
            playedSan: sk.san,
            bestSan,
            usedTips,
          });
          const ragThemes = themes.filter((t) => {
            if (!KING_FILTER.has(t)) return true;
            return (
              themes.includes("opp_king_exposed") ||
              themes.includes("user_king_exposed") ||
              themes.includes("attack") ||
              pov.kingMotifLive
            );
          });
          const highLive =
            pov.kingMotifLive ||
            themes.some((t) =>
              [
                "attack",
                "forcing_moves",
                "tactics",
                "missed_opportunity",
                "imbalances",
                "king_safety",
              ].includes(t)
            );
          const wantCount =
            noteWorthy &&
            ((!isUserPly && deltaCp >= 80) ||
              (isUserPly && (errorKind || moment || playedBest || deltaCp < 40)))
              ? !isUserPly || highLive
                ? 2
                : 1
              : 0;
          const retrieveCtx: RetrieveContext = {
            themes: ragThemes.length ? ragThemes : themes,
            phase,
            wantCount,
            strict: true,
            fen: sk.fenBefore,
            san: sk.san,
            bestSan,
            eco: options.eco,
            opening: options.opening,
            recentSans: skeleton.slice(0, i + 1).map((p) => p.san),
          };
          const nuggets: KnowledgeNugget[] =
            wantCount > 0
              ? await mergeHybridKnowledgeNuggets(
                  retrieveCtx,
                  usedKnowledge,
                  options.retrieveKnowledge || null
                )
              : [];
          note = composeCoachNote({
            side: sk.side,
            userColor,
            san: sk.san,
            fenBefore: sk.fenBefore,
            fenAfter: sk.fenAfter,
            deltaCp,
            bestSan,
            bestPvSan,
            themes,
            concepts: nuggets.map((n) => n.text),
            usedTips,
            openingLabel,
            openingTags,
            ply: sk.ply,
            phase,
            metrics,
            moment,
            errorKind,
            pov,
            playedBest,
            userPlyCount,
            evalBeforeWhite: evalBefore,
            evalAfterWhite: evalAfter,
            opponentReplySan: skeleton[i + 1]?.san ?? null,
          });
        }
      }
    } catch {
      analyzed = false;
      note = "";
      mark = null;
    }

    prevEval = evalAfter ?? evalBefore ?? prevEval;

    // Opponent missed a forcing shot that existed because of the prior user
    // blunder → put "walks into …" on the user move; opponent only "misses".
    if (!isUserPly && plies.length) {
      const forcing = missedForcingLine({
        playedSan: sk.san,
        bestSan,
        bestPvSan,
        deltaCp,
      });
      const prev = plies[plies.length - 1];
      if (
        forcing &&
        prev &&
        prev.side === userColor &&
        isCoachMistakeOrWorse(prev.mark)
      ) {
        const walkIn = `${prev.san} walks into ${forcing}.`;
        prev.note = walkIn;
        claimNoteText(walkIn, usedTips);
        claimNoteTopic(usedTips, "tactic");
        // One tactic topic per game — teach it on the user blunder, not again on the miss.
        note = "";
      }
    }

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

  const theoryEndPly = resolveBookEndPly({
    mapEndPly,
    namedEndPly,
    freqEndPly,
    proAvailable,
  });
  const bookEndPly = trimBookEndByWinProb(plies, theoryEndPly, userIsWhite);
  if (bookEndPly != null) {
    for (const ply of plies) {
      if (ply.ply <= bookEndPly) ply.mark = "book";
    }
  }

  if (plies.length) {
    plies[plies.length - 1].note = composeGameSummaryNote({
      plies,
      userColor,
      metrics,
      openingLabel,
    });
  }

  if (options.platform && options.username && plies.length) {
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
      await upsertSharedGameEvals(
        { platform: options.platform, username: options.username },
        options.gameId,
        {
          positions: product.positions,
          evalsWhiteCp: product.evalsWhiteCp,
          mistakeCandidates: product.mistakeCandidates,
          openingCandidates: product.openingCandidates,
          opening_accuracy_pct: product.opening_accuracy_pct,
          opening_accuracy_moves: product.opening_accuracy_moves,
          endgameEval: product.endgameEval,
          middlegameEval: product.middlegameEval,
          style: product.style,
          // Keep Study/Insights candidates/metrics if they already scanned deeper meta
          preferExistingMeta: Boolean(
            vaultRecord?.mistakeCandidates?.length ||
              vaultRecord?.openingCandidates?.length ||
              vaultRecord?.style
          ),
        }
      );
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
