import { Chess, type Move } from "chess.js";
import Constants from "expo-constants";
import type { MistakeItem, QueryFilters } from "../api/client";
import {
  loadLocalGamesPage,
  toStudyGameList,
} from "../data/platformGames";
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
  EVAL_VAULT_SAVE_EVERY,
  GLOBAL_FIRST_SCAN_MAX_GAMES,
  GLOBAL_MAX_GAMES,
  GLOBAL_MULTIPV,
  resolveScanGameLimit,
  SCAN_DEPTH,
  TARGET_MISTAKE_MOMENTS,
  TARGET_OPENING_MOMENTS,
} from "./analysisConfig";
import { waitForPuzzleIdle, yieldForUi } from "./backgroundWork";
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
    opp_rating:
      typeof row.opp_rating === "number"
        ? row.opp_rating
        : row.opp_rating
          ? Number(row.opp_rating)
          : undefined,
    move_count:
      typeof row.move_count === "number"
        ? row.move_count
        : row.move_count
          ? Number(row.move_count)
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
  const disk = await loadPermanentEvalStore(filters);
  const mergedMistakes = [
    ...new Set([
      ...(disk.consumedMistakeKeys || []),
      ...(vault.consumedMistakeKeys || []),
    ]),
  ];
  const mergedOpenings = [
    ...new Set([
      ...(disk.consumedOpeningKeys || []),
      ...(vault.consumedOpeningKeys || []),
    ]),
  ];
  await writeCache(studyGameEvalsCacheKey(filters), {
    ...vault,
    games: { ...disk.games, ...vault.games },
    consumedMistakeKeys: mergedMistakes,
    consumedOpeningKeys: mergedOpenings,
  } satisfies PermanentEvalStore);
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
  const firstWave = Math.min(total, GLOBAL_FIRST_SCAN_MAX_GAMES);
  return {
    style,
    scanned,
    total,
    periodComplete: firstWave > 0 && scanned >= firstWave,
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
  signal?: { cancelled: boolean },
  onPly?: (ply: number, totalPlies: number) => void | Promise<void>
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
      await yieldForUi({ heavy: true });
    } else {
      await waitForPuzzleIdle();
    }
    const raw = await evaluate(fen, SCAN_DEPTH, GLOBAL_MULTIPV, 0);
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
  await onPly?.(0, sans.length);

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

    if (ply === 0 || (ply + 1) % 4 === 0 || ply + 1 === sans.length) {
      await onPly?.(ply + 1, sans.length);
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

export type GlobalScanOwner = "prefetch" | "study" | "opening";

type ActiveGlobalScan = {
  owner: GlobalScanOwner;
  sessionKey: string;
  signal: { cancelled: boolean };
  waiters: Array<() => void>;
};

let activeGlobalScan: ActiveGlobalScan | null = null;

export function globalScanSessionKey(
  filters: Pick<
    QueryFilters,
    "username" | "platform" | "timeframe" | "speed" | "dateFrom" | "dateTo"
  >
): string {
  return [
    String(filters.username || "").toLowerCase(),
    String(filters.platform || ""),
    String(filters.timeframe || ""),
    String(filters.speed || ""),
    String(filters.dateFrom || ""),
    String(filters.dateTo || ""),
  ].join("|");
}

export function getActiveGlobalScan(): {
  owner: GlobalScanOwner;
  sessionKey: string;
  signal: { cancelled: boolean };
} | null {
  if (!activeGlobalScan || activeGlobalScan.signal.cancelled) return null;
  return {
    owner: activeGlobalScan.owner,
    sessionKey: activeGlobalScan.sessionKey,
    signal: activeGlobalScan.signal,
  };
}

export function isGlobalScanActiveFor(sessionKey: string): boolean {
  const active = getActiveGlobalScan();
  return Boolean(active && active.sessionKey === sessionKey);
}

function notifyScanWaiters(scan: ActiveGlobalScan): void {
  const waiters = scan.waiters.splice(0);
  for (const waiter of waiters) waiter();
}

export function waitForActiveGlobalScan(options: {
  sessionKey: string;
  signal?: { cancelled: boolean };
}): Promise<"done" | "cancelled" | "absent"> {
  const active = activeGlobalScan;
  if (
    !active ||
    active.sessionKey !== options.sessionKey ||
    active.signal.cancelled
  ) {
    return Promise.resolve(
      active && active.sessionKey === options.sessionKey ? "done" : "absent"
    );
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: "done" | "cancelled") => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    active.waiters.push(() => finish("done"));
    const poll = () => {
      if (settled) return;
      if (options.signal?.cancelled) {
        finish("cancelled");
        return;
      }
      if (!activeGlobalScan || activeGlobalScan !== active) {
        finish("done");
        return;
      }
      setTimeout(poll, 100);
    };
    setTimeout(poll, 100);
  });
}

export async function joinActiveGlobalScanIfOwned(options: {
  sessionKey: string;
  owners: GlobalScanOwner[];
  signal?: { cancelled: boolean };
  until?: () => boolean | Promise<boolean>;
}): Promise<boolean> {
  const active = getActiveGlobalScan();
  if (
    !active ||
    active.sessionKey !== options.sessionKey ||
    !options.owners.includes(active.owner)
  ) {
    return false;
  }
  if (options.until) {
    while (!options.signal?.cancelled) {
      if (await options.until()) return true;
      const current = getActiveGlobalScan();
      if (
        !current ||
        current.sessionKey !== options.sessionKey ||
        !options.owners.includes(current.owner)
      ) {
        return Boolean(await options.until());
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
    return false;
  }
  const result = await waitForActiveGlobalScan(options);
  return result === "done";
}

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
  owner?: GlobalScanOwner;
  sessionKey?: string;
  continueScan?: boolean;
  maxGames?: number;
}): Promise<GlobalAnalysisState> {
  const {
    filters,
    evaluate,
    onProgress,
    onGameScanned,
    onEarlyMistakesReady,
    onEarlyOpeningsReady: _onEarlyOpeningsReady,
  } = options;
  const owner = options.owner || "study";
  const sessionKey = options.sessionKey || globalScanSessionKey(filters);
  const signal = options.signal || { cancelled: false };
  if (activeGlobalScan && activeGlobalScan.signal !== signal) {
    activeGlobalScan.signal.cancelled = true;
    const previous = activeGlobalScan;
    activeGlobalScan = null;
    notifyScanWaiters(previous);
  }
  activeGlobalScan = { owner, sessionKey, signal, waiters: [] };
  try {
    const earlyMistakeTarget =
      options.earlyMistakeTarget ?? TARGET_MISTAKE_MOMENTS;

    let sourceGames = options.games;
    if (options.continueScan) {
      const page = await loadLocalGamesPage(filters, {
        limit: GLOBAL_MAX_GAMES,
        offset: 0,
      });
      sourceGames = toStudyGameList(page.allFiltered.slice(0, GLOBAL_MAX_GAMES));
    } else if (!sourceGames) {
      const page = await loadLocalGamesPage(filters, {
        limit: GLOBAL_FIRST_SCAN_MAX_GAMES,
        offset: 0,
      });
      sourceGames = page.games;
    }
    if (signal.cancelled) return emptyState();
    const sortedGames = [...sourceGames]
      .sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      )
      .slice(0, GLOBAL_MAX_GAMES);
    let vault = await loadPermanentEvalStore(filters);
    const periodCachedCount = sortedGames.filter(
      (g) => vault.games[String(g.id)]
    ).length;
    const scanLimit = resolveScanGameLimit({
      periodCachedCount,
      continueScan: options.continueScan,
      maxGames: options.maxGames,
    });
    const games = sortedGames.slice(0, scanLimit);
    const total = games.length;
    const periodIds = games.map((g) => String(g.id));
    const cachedCount = games.filter((g) => vault.games[String(g.id)]).length;
    // #region agent log
    debugScanLog("global analysis start", "H1", {
      total,
      cachedCount,
      max: scanLimit,
      firstSession: periodCachedCount <= 0 && !options.continueScan,
      owner,
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
    let unsavedMutations = 0;
    const persistVault = async (force = false) => {
      if (unsavedMutations <= 0 && !force) return;
      await savePermanentEvalStore(filters, vault);
      unsavedMutations = 0;
    };
    const noteVaultDirty = async () => {
      unsavedMutations += 1;
      if (unsavedMutations >= EVAL_VAULT_SAVE_EVERY) {
        await persistVault(true);
      }
    };
    const mergeVaultConsumed = async () => {
      const disk = await loadPermanentEvalStore(filters);
      vault = {
        ...vault,
        consumedMistakeKeys: [
          ...new Set([
            ...(vault.consumedMistakeKeys || []),
            ...(disk.consumedMistakeKeys || []),
          ]),
        ],
        consumedOpeningKeys: [
          ...new Set([
            ...(vault.consumedOpeningKeys || []),
            ...(disk.consumedOpeningKeys || []),
          ]),
        ],
      };
    };

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
            report(
              "Deep-refining first mistake batch…",
              "style",
              partialDone
            );
            const accepted = await onEarlyMistakesReady(picks, state);
            if (accepted !== false) {
              mistakesReady = true;
              await mergeVaultConsumed();
              await persistVault(true);
            }
          } else if (state.complete) {
            mistakesReady = true;
          }
        }
      }
      report(
        mistakesReady
          ? "First puzzle batch ready · filling eval buffer"
          : "Scanning period games",
        "scan",
        partialDone
      );
    };

    const runDeferredEarlyRefines = async () => {
      if (mistakesReady || !onEarlyMistakesReady) return;
      await emitState(
        buildPeriodState(games, vault, null).scannedGameIds.length
      );
    };

    await emitState(cachedCount);

    if (cachedCount >= total && total > 0) {
      await runDeferredEarlyRefines();
      report("Period games already evaluated", "done", total);
      return buildPeriodState(
        games,
        await loadPermanentEvalStore(filters),
        null
      );
    }

    report(
      cachedCount
        ? `Scanning ${total - cachedCount} new game${total - cachedCount === 1 ? "" : "s"}`
        : "Starting global Stockfish scan",
      "scan",
      cachedCount
    );

    let done = cachedCount;

    for (const game of games) {
      if (signal.cancelled) {
        await persistVault(true);
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
        await noteVaultDirty();
        continue;
      }
      if (existing) continue;

      await waitForPuzzleIdle();
      if (signal.cancelled) {
        await persistVault(true);
        return buildPeriodState(games, vault, null);
      }

      const label =
        opponentName(game) || game.opening_name || id.slice(0, 8);
      report(`Scanning ${label}`, "scan", done, { currentGame: label });

      const record = await scanOneGame(game, evaluate, signal, async (ply, totalPlies) => {
        if (signal.cancelled) return;
        const frac = totalPlies > 0 ? ply / totalPlies : 0;
        const moveNo = Math.max(1, Math.ceil(ply / 2) || 1);
        report(
          `Scanning ${label} · move ${moveNo}`,
          "scan",
          done + frac,
          { currentGame: label }
        );
      });
      if (!record) {
        await persistVault(true);
        return buildPeriodState(games, vault, null);
      }

      vault = {
        ...vault,
        games: { ...vault.games, [id]: record },
      };
      done += 1;
      await noteVaultDirty();
      report(`Scanned ${label}`, "scan", done, { currentGame: label });
      await emitState(done);
      await yieldForUi({ heavy: true });
    }

    if (signal.cancelled) {
      await persistVault(true);
      return buildPeriodState(games, vault, null);
    }

    await persistVault(true);
    await runDeferredEarlyRefines();

    report(
      "Global analysis complete",
      "done",
      buildPeriodState(games, vault, null).scannedGameIds.length
    );
    await persistVault(true);
    return buildPeriodState(games, vault, null);
  } finally {
    if (activeGlobalScan?.signal === signal) {
      const done = activeGlobalScan;
      activeGlobalScan = null;
      notifyScanWaiters(done);
    }
  }
}

export { toStudyGames };
