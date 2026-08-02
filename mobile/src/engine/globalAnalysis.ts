import { Chess, type Move } from "chess.js";
import Constants from "expo-constants";
import type { MistakeItem, QueryFilters } from "../api/client";
import { fetchStudyGames } from "../api/client";
import {
  readCache,
  writeCache,
  PERMANENT_CACHE_TTL_MS,
} from "../storage/cache";
import {
  studyGameEvalsCacheKey,
  studyStyleCacheKey,
} from "../storage/studyCacheKeys";
import {
  ENGINE_LABEL,
  GLOBAL_DEPTH,
  GLOBAL_MAX_GAMES,
  GLOBAL_MULTIPV,
  TARGET_MISTAKE_MOMENTS,
  TARGET_OPENING_MOMENTS,
} from "./analysisConfig";
import { DEBUG_DISABLE_STYLE_METRICS } from "./debugFlags";

function debugScanLog(
  message: string,
  hypothesisId: string,
  data: Record<string, unknown>
) {
  // #region agent log
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0] || "127.0.0.1";
  fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6d2375",
    },
    body: JSON.stringify({
      sessionId: "6d2375",
      runId: "traits-timing",
      hypothesisId,
      location: "globalAnalysis.ts",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  if (hypothesisId === "H-traits") {
    console.log(`[traits] ${message}`, data);
  }
  // #endregion
}
import {
  clampCp,
  toWhiteCp,
  type StudyGame,
} from "./analyzeMistakes";
import {
  candidateKey,
  periodCandidatePools,
  selectRecentPeriodCandidates,
} from "./candidateBucket";
import {
  applyUciMove,
  canonicalUci,
  fenKey,
  uciFromMove,
} from "./chessMoves";
import {
  analyzeEvalBucketMetrics,
  type EndgameEvalBucket,
  type MiddlegameEvalBucket,
} from "./evalBucketMetrics";
import {
  aggregateStyleMetrics,
  createStyleScanSession,
  styleScanConsumeRoot,
  styleScanFinalize,
  styleScanProcessPly,
  type StyleGameRow,
  type StyleMetricsAggregate,
} from "./styleMetrics";

export type PositionEval = {
  cpWhite: number;
  bestUci: string | null;
};

export type GlobalGameRecord = {
  gameId: string;
  evalsWhiteCp: number[];
  positions: Record<string, PositionEval>;
  mistakeCandidates: MistakeItem[];
  openingCandidates: MistakeItem[];
  opening_accuracy_pct?: number | null;
  opening_accuracy_moves?: number;
  endgameEval?: EndgameEvalBucket | null;
  middlegameEval?: MiddlegameEvalBucket | null;
  style?: StyleGameRow | null;
};

export type GlobalAnalysisProgress = {
  gamesTotal: number;
  gamesDone: number;
  currentGame?: string;
  status: string;
  phase: "boot" | "scan" | "style" | "done";
  engine: string;
};

export type GlobalAnalysisState = {
  scannedGameIds: string[];
  games: Record<string, GlobalGameRecord>;
  mistakeCandidates: MistakeItem[];
  openingCandidates: MistakeItem[];
  style: StyleMetricsAggregate | null;
  complete: boolean;
};

type EvalFn = (
  fen: string,
  depth?: number,
  multiPv?: number,
  movetimeMs?: number
) => Promise<{
  cpWhite: number;
  bestUci: string | null;
  bestPv?: string[];
  multipv: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
}>;

const OPENING_PLY_SKIP = 12;
const MAX_OPENING_PLY = 20;
const BASE_MIN_DROP_CP = 100;
const OPENING_MIN_DROP_CP = 100;
const BASE_MIN_PRIORITY = 800;
const MAX_MOMENTS_PER_GAME = 3;

function mistakePriority(
  userBefore: number,
  userAfter: number,
  drop: number
): number {
  let priority = drop;
  if (userBefore >= 50 && userAfter <= -50) {
    priority += 3000;
    priority += Math.min(userBefore, 500);
    priority += Math.min(-userAfter, 500);
  } else if (userBefore >= 0) {
    priority += 800;
  }
  priority += Math.max(0, 500 - Math.abs(userBefore)) * 1.2;
  priority -= Math.max(0, -userBefore - 300) * 1.5;
  return priority;
}

function parseMoves(game: StudyGame): string[] {
  if (game.moves_str?.trim()) {
    return game.moves_str.trim().split(/\s+/).filter(Boolean);
  }
  if (!game.pgn_str?.trim()) return [];
  try {
    const chess = new Chess();
    chess.loadPgn(game.pgn_str, { strict: false });
    return chess.history();
  } catch {
    return [];
  }
}

function applySan(chess: Chess, san: string): Move | null {
  try {
    return chess.move(san);
  } catch {
    return null;
  }
}

function opponentName(game: StudyGame): string {
  if (game.opponent_name && game.opponent_name !== "Unknown") {
    return game.opponent_name;
  }
  if (game.pgn_str) {
    const color =
      String(game.user_color || "white").toLowerCase() === "white"
        ? "Black"
        : "White";
    const match = game.pgn_str.match(new RegExp(`\\[${color} "([^"]+)"\\]`));
    if (match?.[1]) return match[1];
  }
  return "Unknown opponent";
}

function toStudyGames(
  rows: Array<Record<string, unknown>>
): StudyGame[] {
  return rows.map((row) => ({
    id: String(row.id || ""),
    created_at: String(row.created_at || ""),
    speed: row.speed ? String(row.speed) : undefined,
    user_color: String(row.user_color || "white"),
    result: String(row.result || ""),
    opening_name: row.opening_name ? String(row.opening_name) : undefined,
    opening_eco: row.opening_eco ? String(row.opening_eco) : undefined,
    opponent_name: row.opponent_name
      ? String(row.opponent_name)
      : undefined,
    pgn_str: row.pgn_str ? String(row.pgn_str) : undefined,
    moves_str: row.moves_str ? String(row.moves_str) : undefined,
    time_control: row.time_control ? String(row.time_control) : undefined,
    user_rating:
      typeof row.user_rating === "number"
        ? row.user_rating
        : row.user_rating
          ? Number(row.user_rating)
          : undefined,
  }));
}

type PermanentEvalStore = {
  games: Record<string, GlobalGameRecord>;
  consumedMistakeKeys?: string[];
  consumedOpeningKeys?: string[];
};

function emptyVault(): PermanentEvalStore {
  return { games: {}, consumedMistakeKeys: [], consumedOpeningKeys: [] };
}

function emptyState(): GlobalAnalysisState {
  return {
    scannedGameIds: [],
    games: {},
    mistakeCandidates: [],
    openingCandidates: [],
    style: null,
    complete: false,
  };
}

export async function loadPermanentEvalStore(
  filters: Pick<QueryFilters, "username" | "platform">
): Promise<PermanentEvalStore> {
  const cached = await readCache<PermanentEvalStore>(
    studyGameEvalsCacheKey(filters),
    PERMANENT_CACHE_TTL_MS
  );
  return cached || emptyVault();
}

async function savePermanentEvalStore(
  filters: Pick<QueryFilters, "username" | "platform">,
  vault: PermanentEvalStore
): Promise<void> {
  await writeCache(studyGameEvalsCacheKey(filters), vault);
}

function buildPeriodState(
  games: StudyGame[],
  vault: PermanentEvalStore,
  style: StyleMetricsAggregate | null
): GlobalAnalysisState {
  const periodGames: Record<string, GlobalGameRecord> = {};
  const scannedGameIds: string[] = [];
  const mistakeCandidates: MistakeItem[] = [];
  const openingCandidates: MistakeItem[] = [];
  const consumedMistakes = new Set(vault.consumedMistakeKeys || []);
  const consumedOpenings = new Set(vault.consumedOpeningKeys || []);
  for (const game of games) {
    const id = String(game.id);
    const record = vault.games[id];
    if (!record) continue;
    const normalized: GlobalGameRecord = {
      ...record,
      openingCandidates: record.openingCandidates || [],
      mistakeCandidates: record.mistakeCandidates || [],
    };
    periodGames[id] = normalized;
    scannedGameIds.push(id);
    for (const item of normalized.mistakeCandidates) {
      if (!consumedMistakes.has(candidateKey(item))) {
        mistakeCandidates.push(item);
      }
    }
    for (const item of normalized.openingCandidates) {
      if (!consumedOpenings.has(candidateKey(item))) {
        openingCandidates.push(item);
      }
    }
  }
  return {
    scannedGameIds,
    games: periodGames,
    mistakeCandidates,
    openingCandidates,
    style,
    complete: scannedGameIds.length >= games.length && games.length > 0,
  };
}

export async function loadGlobalAnalysisState(
  filters: QueryFilters,
  games?: StudyGame[]
): Promise<GlobalAnalysisState> {
  const vault = await loadPermanentEvalStore(filters);
  if (!games?.length) {
    const ids = Object.keys(vault.games);
    return {
      scannedGameIds: ids,
      games: vault.games,
      mistakeCandidates: ids.flatMap(
        (id) => vault.games[id]?.mistakeCandidates || []
      ),
      openingCandidates: ids.flatMap(
        (id) => vault.games[id]?.openingCandidates || []
      ),
      style: null,
      complete: false,
    };
  }
  return buildPeriodState(games, vault, null);
}

export async function loadStyleMetrics(
  filters: QueryFilters
): Promise<StyleMetricsAggregate | null> {
  return readCache<StyleMetricsAggregate>(
    studyStyleCacheKey(filters),
    PERMANENT_CACHE_TTL_MS
  );
}

export function styleFromVaultRecords(
  games: StudyGame[],
  vault: PermanentEvalStore
): {
  style: StyleMetricsAggregate | null;
  scanned: number;
  total: number;
  periodComplete: boolean;
} {
  const sample = games.slice(0, Math.min(games.length, GLOBAL_MAX_GAMES));
  const total = sample.length;
  const styleRows: StyleGameRow[] = [];
  let scanned = 0;
  for (const game of sample) {
    const record = vault.games[String(game.id)];
    if (!record) continue;
    scanned += 1;
    if (record.style) styleRows.push(record.style);
  }
  const style = styleRows.length ? aggregateStyleMetrics(styleRows) : null;
  return {
    style,
    scanned,
    total,
    periodComplete: total > 0 && scanned >= total,
  };
}

export async function resolveStyleMetricsForPeriod(options: {
  filters: QueryFilters;
  games: StudyGame[];
  signal?: { cancelled?: boolean };
  onPartial?: (style: StyleMetricsAggregate, scanned: number, total: number) => void;
}): Promise<{
  style: StyleMetricsAggregate | null;
  periodComplete: boolean;
  scanned: number;
  total: number;
}> {
  const { filters, games, onPartial } = options;
  const scoped = [...games].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
  const total = scoped.length;
  if (!total) {
    return { style: null, periodComplete: false, scanned: 0, total: 0 };
  }

  const vault = await loadPermanentEvalStore(filters);
  const fromVault = styleFromVaultRecords(scoped, vault);
  if (fromVault.style) {
    await writeCache(studyStyleCacheKey(filters), fromVault.style);
    onPartial?.(fromVault.style, fromVault.scanned, fromVault.total);
  }
  // #region agent log
  debugScanLog("style from vault bucket", "H-style", {
    total: fromVault.total,
    scanned: fromVault.scanned,
    styleGames: fromVault.style?.games ?? 0,
    periodComplete: fromVault.periodComplete,
  });
  // #endregion
  return fromVault;
}

export function lookupPositionEval(
  state: GlobalAnalysisState,
  gameId: string,
  fen: string
): PositionEval | null {
  const game = state.games[gameId];
  if (!game) return null;
  return game.positions[fenKey(fen)] || null;
}

export function createEvalLookup(state: GlobalAnalysisState) {
  return (gameId: string, fen: string): PositionEval | null =>
    lookupPositionEval(state, gameId, fen);
}

async function scanOneGame(
  game: StudyGame,
  evaluate: EvalFn,
  signal?: { cancelled: boolean }
): Promise<GlobalGameRecord | null> {
  const tScan = Date.now();
  const sans = parseMoves(game);
  if (sans.length < 2) {
    return {
      gameId: String(game.id),
      evalsWhiteCp: [],
      positions: {},
      mistakeCandidates: [],
      openingCandidates: [],
      opening_accuracy_pct: null,
      opening_accuracy_moves: 0,
      endgameEval: null,
      middlegameEval: null,
      style: null,
    };
  }

  const chess = new Chess();
  const positions: Record<string, PositionEval> = {};
  const evalsWhiteCp: number[] = [];
  const mistakeCandidates: MistakeItem[] = [];
  const openingCandidates: MistakeItem[] = [];
  const userIsWhite =
    String(game.user_color || "white").toLowerCase() === "white";
  let evalCalls = 0;
  const styleSession = DEBUG_DISABLE_STYLE_METRICS
    ? null
    : createStyleScanSession(game);

  const storeEval = async (fen: string) => {
    const key = fenKey(fen);
    if (positions[key]) {
      return {
        stored: positions[key],
        whiteCp: clampCp(toWhiteCp(fen, positions[key].cpWhite)),
      };
    }
    evalCalls += 1;
    if (evalCalls % 8 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const raw = await evaluate(fen, GLOBAL_DEPTH, GLOBAL_MULTIPV, 0);
    const bestUci = raw.bestUci ? canonicalUci(fen, raw.bestUci) : null;
    const stored = { cpWhite: raw.cpWhite, bestUci };
    positions[key] = stored;
    return {
      stored,
      whiteCp: clampCp(toWhiteCp(fen, raw.cpWhite)),
    };
  };

  let before = await storeEval(chess.fen());
  evalsWhiteCp.push(before.whiteCp);
  if (styleSession) styleScanConsumeRoot(styleSession, before.whiteCp);

  for (let ply = 0; ply < sans.length; ply += 1) {
    if (signal?.cancelled) return null;

    const fenBefore = chess.fen();
    const turnIsWhite = chess.turn() === "w";
    const isUserTurn = turnIsWhite === userIsWhite;
    const played = applySan(chess, sans[ply]);
    if (!played) break;
    const fenAfter = chess.fen();
    const playedUci = uciFromMove(played);
    const playedSan = played.san;

    const after = await storeEval(fenAfter);
    evalsWhiteCp.push(after.whiteCp);
    if (styleSession) {
      styleScanProcessPly(
        styleSession,
        sans[ply],
        before.whiteCp,
        after.whiteCp,
        ply
      );
    }

    if (isUserTurn && !chess.isCheckmate()) {
      const beforeCp = before.whiteCp;
      const afterCp = after.whiteCp;
      const userBefore = userIsWhite ? beforeCp : -beforeCp;
      const userAfter = userIsWhite ? afterCp : -afterCp;
      const drop = userBefore - userAfter;
      const bestUci = before.stored.bestUci || "";
      if (
        bestUci &&
        bestUci !== playedUci &&
        applyUciMove(new Chess(fenBefore), bestUci)
      ) {
        const probe = new Chess(fenBefore);
        const bestMove = applyUciMove(probe, bestUci);
        const bestSan = bestMove?.san || null;
        const baseItem: MistakeItem = {
          game_id: String(game.id),
          created_at: String(game.created_at),
          opening_name: game.opening_name,
          opening_eco: game.opening_eco,
          opponent_name: opponentName(game),
          speed: game.speed,
          user_color: String(game.user_color || "white"),
          result: String(game.result || ""),
          ply,
          move_number: Math.floor(ply / 2) + 1,
          fen: fenBefore,
          played_uci: playedUci,
          played_san: playedSan,
          best_uci: bestUci,
          best_san: bestSan,
          eval_before_cp: Math.round(beforeCp * 10) / 10,
          eval_after_cp: Math.round(afterCp * 10) / 10,
          eval_delta_cp: Math.round((afterCp - beforeCp) * 10) / 10,
          eval_drop_cp: Math.round(drop * 10) / 10,
          comment: `Your position worsened by ~${Math.round(drop)} cp after ${playedSan}.`,
        };

        if (ply < MAX_OPENING_PLY && drop >= OPENING_MIN_DROP_CP) {
          if (openingCandidates.length < MAX_MOMENTS_PER_GAME) {
            const openingItem = {
              ...baseItem,
              priority_score: Math.round(drop * 10) / 10,
            } as MistakeItem & { priority_score: number };
            openingCandidates.push(openingItem);
          }
        }

        if (ply >= OPENING_PLY_SKIP && drop >= BASE_MIN_DROP_CP) {
          const priority = mistakePriority(userBefore, userAfter, drop);
          if (
            priority >= BASE_MIN_PRIORITY &&
            mistakeCandidates.length < MAX_MOMENTS_PER_GAME
          ) {
            const mistakeItem = {
              ...baseItem,
              priority_score: Math.round(priority * 10) / 10,
            } as MistakeItem & { priority_score: number };
            mistakeCandidates.push(mistakeItem);
          }
        }
      }
    }

    before = after;
  }

  const extras = {
    opening_accuracy_pct: null as number | null,
    opening_accuracy_moves: 0,
    endgameEval: null as EndgameEvalBucket | null,
    middlegameEval: null as MiddlegameEvalBucket | null,
  };
  const style = styleSession ? styleScanFinalize(styleSession, extras) : null;

  // #region agent log
  debugScanLog("scanOneGame done", "H1", {
    gameId: String(game.id).slice(0, 12),
    plies: sans.length,
    evalCalls,
    ms: Date.now() - tScan,
    mistakes: mistakeCandidates.length,
    style: Boolean(style),
    fused: true,
  });
  // #endregion

  return {
    gameId: String(game.id),
    evalsWhiteCp,
    positions,
    mistakeCandidates,
    openingCandidates,
    opening_accuracy_pct: extras.opening_accuracy_pct,
    opening_accuracy_moves: extras.opening_accuracy_moves,
    endgameEval: extras.endgameEval,
    middlegameEval: extras.middlegameEval,
    style,
  };
}

export function periodCandidateBuckets(
  state: GlobalAnalysisState,
  periodGameIds: string[],
  limits?: { mistakes?: number; openings?: number }
): {
  mistakes: { batch: MistakeItem[]; reservoir: MistakeItem[] };
  openings: { batch: MistakeItem[]; reservoir: MistakeItem[] };
} {
  const period = new Set(periodGameIds.map(String));
  return {
    mistakes: periodCandidatePools({
      candidates: state.mistakeCandidates,
      periodGameIds: period,
      batchLimit: limits?.mistakes ?? TARGET_MISTAKE_MOMENTS,
    }),
    openings: periodCandidatePools({
      candidates: state.openingCandidates,
      periodGameIds: period,
      batchLimit: limits?.openings ?? TARGET_OPENING_MOMENTS,
    }),
  };
}

export async function periodReservoirStatus(
  filters: QueryFilters,
  games: StudyGame[],
  kind: "mistake" | "opening",
  options?: {
    periodGameIds?: string[];
    pendingCount?: number;
    batchLimit?: number;
  }
): Promise<{
  remaining: number;
  complete: boolean;
  exhausted: boolean;
  batch: MistakeItem[];
  state: GlobalAnalysisState;
}> {
  const state = await loadGlobalAnalysisState(filters, games);
  const periodIds = options?.periodGameIds ?? games.map((g) => String(g.id));
  const pools = periodCandidatePools({
    candidates:
      kind === "mistake" ? state.mistakeCandidates : state.openingCandidates,
    periodGameIds: periodIds,
    batchLimit: options?.batchLimit ?? 0,
  });
  const pending = options?.pendingCount ?? 0;
  return {
    remaining: pools.reservoir.length,
    complete: state.complete,
    exhausted:
      state.complete && pools.reservoir.length <= 0 && pending <= 0,
    batch: pools.batch,
    state,
  };
}

let activeGlobalScanSignal: { cancelled: boolean } | null = null;

export async function runGlobalPeriodAnalysis(options: {
  filters: QueryFilters;
  evaluate: EvalFn;
  signal?: { cancelled: boolean };
  onProgress?: (progress: GlobalAnalysisProgress) => void;
  onGameScanned?: (state: GlobalAnalysisState) => void | Promise<void>;
  earlyMistakeTarget?: number;
  earlyOpeningTarget?: number;
  onEarlyMistakesReady?: (
    candidates: MistakeItem[],
    state: GlobalAnalysisState
  ) => boolean | void | Promise<boolean | void>;
  onEarlyOpeningsReady?: (
    candidates: MistakeItem[],
    state: GlobalAnalysisState
  ) => boolean | void | Promise<boolean | void>;
  games?: StudyGame[];
}): Promise<GlobalAnalysisState> {
  const {
    filters,
    evaluate,
    onProgress,
    onGameScanned,
    onEarlyMistakesReady,
    onEarlyOpeningsReady,
  } = options;
  if (activeGlobalScanSignal && activeGlobalScanSignal !== options.signal) {
    activeGlobalScanSignal.cancelled = true;
  }
  const signal = options.signal || { cancelled: false };
  activeGlobalScanSignal = signal;
  try {
    const earlyMistakeTarget =
      options.earlyMistakeTarget ?? TARGET_MISTAKE_MOMENTS;
    const earlyOpeningTarget =
      options.earlyOpeningTarget ?? TARGET_OPENING_MOMENTS;

    const rows = options.games ? null : await fetchStudyGames(filters, false);
    if (signal.cancelled) return emptyState();
    const games = [...(options.games || toStudyGames(rows || []))]
      .sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      )
      .slice(0, GLOBAL_MAX_GAMES);
    const total = games.length;
    const periodIds = games.map((g) => String(g.id));

    let vault = await loadPermanentEvalStore(filters);
    const cachedCount = games.filter((g) => vault.games[String(g.id)]).length;
    // #region agent log
    debugScanLog("global analysis start", "H1", {
      total,
      cachedCount,
      max: GLOBAL_MAX_GAMES,
      user: filters.username,
    });
    // #endregion

    const report = (
      status: string,
      phase: GlobalAnalysisProgress["phase"],
      gamesDone: number,
      extra?: Partial<GlobalAnalysisProgress>
    ) => {
      onProgress?.({
        gamesTotal: total,
        gamesDone,
        status,
        phase,
        engine: ENGINE_LABEL,
        ...extra,
      });
    };

    let mistakesReady = false;
    let openingsReady = false;

    const emitState = async (partialDone: number) => {
      const state = buildPeriodState(games, vault, null);
      await onGameScanned?.(state);
      if (!mistakesReady && onEarlyMistakesReady) {
        const picks = selectRecentPeriodCandidates({
          candidates: state.mistakeCandidates,
          periodGameIds: periodIds,
          consumedKeys: vault.consumedMistakeKeys,
          limit: earlyMistakeTarget,
        });
        if (picks.length >= earlyMistakeTarget || state.complete) {
          if (picks.length) {
            const accepted = await onEarlyMistakesReady(picks, state);
            if (accepted !== false) {
              mistakesReady = true;
              vault = await loadPermanentEvalStore(filters);
            }
          } else if (state.complete) {
            mistakesReady = true;
          }
        }
      }
      if (!openingsReady && onEarlyOpeningsReady) {
        const picks = selectRecentPeriodCandidates({
          candidates: state.openingCandidates,
          periodGameIds: periodIds,
          consumedKeys: vault.consumedOpeningKeys,
          limit: earlyOpeningTarget,
        });
        if (picks.length >= earlyOpeningTarget || state.complete) {
          if (picks.length) {
            const accepted = await onEarlyOpeningsReady(picks, state);
            if (accepted !== false) {
              openingsReady = true;
              vault = await loadPermanentEvalStore(filters);
            }
          } else if (state.complete) {
            openingsReady = true;
          }
        }
      }
      report(
        mistakesReady || openingsReady
          ? "Candidates ready · scanning continues"
          : "Scanning period games",
        "scan",
        partialDone
      );
    };

    await emitState(cachedCount);

    if (cachedCount < total) {
      report(
        cachedCount
          ? `Scanning ${total - cachedCount} new game${total - cachedCount === 1 ? "" : "s"}`
          : "Starting global Stockfish scan",
        "scan",
        cachedCount
      );
    }

    let done = cachedCount;
    for (const game of games) {
      if (signal.cancelled) {
        return buildPeriodState(games, vault, null);
      }
      const id = String(game.id);
      if (!id) continue;

      const existing = vault.games[id];
      if (
        existing?.evalsWhiteCp?.length &&
        existing.style == null &&
        !DEBUG_DISABLE_STYLE_METRICS
      ) {
        const bucket = analyzeEvalBucketMetrics(game, existing.evalsWhiteCp);
        vault = {
          ...vault,
          games: {
            ...vault.games,
            [id]: {
              ...existing,
              opening_accuracy_pct: bucket.opening_accuracy_pct,
              opening_accuracy_moves: bucket.opening_accuracy_moves,
              endgameEval: bucket.endgameEval,
              middlegameEval: bucket.middlegameEval,
              style: bucket.style,
            },
          },
        };
        await savePermanentEvalStore(filters, vault);
        continue;
      }
      if (existing) continue;

      const label =
        opponentName(game) || game.opening_name || id.slice(0, 8);
      report(`Scanning ${label}`, "scan", done, { currentGame: label });

      const record = await scanOneGame(game, evaluate, signal);
      if (!record) {
        return buildPeriodState(games, vault, null);
      }

      vault = {
        ...vault,
        games: { ...vault.games, [id]: record },
      };
      done += 1;
      await savePermanentEvalStore(filters, vault);
      report(`Scanned ${label}`, "scan", done, { currentGame: label });
      await emitState(done);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    if (signal.cancelled) {
      return buildPeriodState(games, vault, null);
    }

    const state = buildPeriodState(games, vault, null);

    if (!mistakesReady && onEarlyMistakesReady) {
      const picks = selectRecentPeriodCandidates({
        candidates: state.mistakeCandidates,
        periodGameIds: periodIds,
        consumedKeys: vault.consumedMistakeKeys,
        limit: earlyMistakeTarget,
      });
      if (picks.length) await onEarlyMistakesReady(picks, state);
    }
    if (!openingsReady && onEarlyOpeningsReady) {
      const picks = selectRecentPeriodCandidates({
        candidates: state.openingCandidates,
        periodGameIds: periodIds,
        consumedKeys: vault.consumedOpeningKeys,
        limit: earlyOpeningTarget,
      });
      if (picks.length) await onEarlyOpeningsReady(picks, state);
    }

    report("Global analysis complete", "done", state.scannedGameIds.length);
    return buildPeriodState(games, await loadPermanentEvalStore(filters), null);
  } finally {
    if (activeGlobalScanSignal === signal) {
      activeGlobalScanSignal = null;
    }
  }
}

export { toStudyGames };
