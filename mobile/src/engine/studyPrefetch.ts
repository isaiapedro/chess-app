import {
  fetchExplorer,
  fetchMastersPgn,
  type MistakeItem,
  type QueryFilters,
} from "../api/client";
import { ensureStudyGames } from "../storage/analyticsLoaders";
import {
  refineRecentMistakeCandidates,
  type StudyGame,
} from "./analyzeMistakes";
import {
  ENGINE_LABEL,
  GLOBAL_FIRST_SCAN_MAX_GAMES,
  TARGET_MISTAKE_MOMENTS,
} from "./analysisConfig";
import { candidateKey, consumeCandidates } from "./candidateBucket";
import { DEBUG_DISABLE_BACKGROUND_JOBS } from "./debugFlags";
import {
  createEvalLookup,
  globalScanSessionKey,
  getActiveGlobalScan,
  loadPermanentEvalStore,
  periodReservoirStatus,
  runGlobalPeriodAnalysis,
  type GlobalAnalysisProgress,
  type GlobalAnalysisState,
} from "./globalAnalysis";
import {
  capMistakeMoments,
  filterUnsolvedMoments,
  loadMistakesSession,
  loadSolvedMistakeKeys,
  mergeSessionMoments,
  mistakesSessionId,
  saveMistakesSession,
} from "./mistakeSession";
import { writeCache } from "../storage/cache";
import { readMistakesCacheForPeriod } from "../storage/periodCacheReuse";
import { studyMistakesCacheKey } from "../storage/studyCacheKeys";

let activePrefetchSignal: { cancelled: boolean } | null = null;
let latestGlobalState: GlobalAnalysisState | null = null;

export function cancelStudyPrefetch() {
  if (activePrefetchSignal) {
    activePrefetchSignal.cancelled = true;
    activePrefetchSignal = null;
  }
}

export function isStudyPrefetchActive(sessionKey?: string): boolean {
  if (!activePrefetchSignal || activePrefetchSignal.cancelled) return false;
  const active = getActiveGlobalScan();
  if (!active || active.owner !== "prefetch") return false;
  if (sessionKey && active.sessionKey !== sessionKey) return false;
  return true;
}

export function getPrefetchedGlobalState(): GlobalAnalysisState | null {
  return latestGlobalState;
}

export function resetPrefetchMemory(): void {
  latestGlobalState = null;
  if (activePrefetchSignal) {
    activePrefetchSignal.cancelled = true;
    activePrefetchSignal = null;
  }
}

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

export type MistakesCachePayload = {
  moments: MistakeItem[];
  pendingCandidates: MistakeItem[];
  deferredCandidates?: MistakeItem[];
  scannedGameIds: string[];
  remaining: number;
  thresholdPass?: "strict" | "baseline";
  baselineAvailable?: boolean;
};

function parseMistakesCachePayload(
  raw: MistakesCachePayload | MistakeItem[] | null
): MistakesCachePayload | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return {
      moments: raw,
      pendingCandidates: [],
      scannedGameIds: [...new Set(raw.map((item) => String(item.game_id)))],
      remaining: 0,
    };
  }
  if (!raw.moments?.length) return null;
  return {
    moments: raw.moments,
    pendingCandidates: raw.pendingCandidates || [],
    deferredCandidates: raw.deferredCandidates || [],
    scannedGameIds: raw.scannedGameIds || [
      ...new Set(raw.moments.map((item) => String(item.game_id))),
    ],
    remaining: raw.remaining ?? 0,
    thresholdPass: raw.thresholdPass,
    baselineAvailable: raw.baselineAvailable,
  };
}

function orderMomentsByRecentGames(
  moments: MistakeItem[],
  games: StudyGame[]
): MistakeItem[] {
  const rank = new Map<string, number>();
  [...games]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .forEach((game, index) => {
      rank.set(String(game.id), index);
    });
  return [...moments].sort((a, b) => {
    const ra = rank.get(String(a.game_id)) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(String(b.game_id)) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.ply - b.ply;
  });
}

function collectFreshRecentCandidates(
  games: StudyGame[],
  vault: Awaited<ReturnType<typeof loadPermanentEvalStore>>,
  existingKeys: Set<string>
): MistakeItem[] {
  const consumed = new Set(vault.consumedMistakeKeys || []);
  const recent = [...games]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, GLOBAL_FIRST_SCAN_MAX_GAMES);
  const out: MistakeItem[] = [];
  for (const game of recent) {
    const record = vault.games[String(game.id)];
    if (!record?.mistakeCandidates?.length) continue;
    for (const item of record.mistakeCandidates) {
      const key = candidateKey(item);
      if (consumed.has(key) || existingKeys.has(key)) continue;
      out.push(item);
    }
  }
  return out.sort((a, b) => {
    const byDate = String(b.created_at).localeCompare(String(a.created_at));
    if (byDate !== 0) return byDate;
    return a.ply - b.ply;
  });
}

async function hasMistakesCache(
  filters: QueryFilters,
  periodGames: StudyGame[]
): Promise<boolean> {
  const cached = await readMistakesCacheForPeriod(
    filters,
    periodGames.map((game) => String(game.id))
  );
  return Boolean(cached?.moments?.length);
}

export async function prioritizeRecentMistakesInCache(options: {
  filters: QueryFilters;
  games: StudyGame[];
  evaluate: EvalFn;
  signal?: { cancelled: boolean };
  sessionMoments?: MistakeItem[];
}): Promise<MistakesCachePayload | null> {
  const { filters, games, evaluate, signal } = options;
  if (!games.length || signal?.cancelled) return null;

  const storedSession = await loadMistakesSession(filters);
  const session =
    options.sessionMoments != null
      ? {
          sessionId: mistakesSessionId(),
          moments: options.sessionMoments,
          completedKeys: storedSession?.completedKeys || [],
        }
      : storedSession;
  const solved = await loadSolvedMistakeKeys(filters);

  if (session?.moments.length) {
    if (session.moments.length >= TARGET_MISTAKE_MOMENTS) {
      const capped = capMistakeMoments(session.moments);
      await saveMistakesSession(filters, {
        sessionId: mistakesSessionId(),
        moments: capped,
        completedKeys: session.completedKeys || [],
      });
      const cached = parseMistakesCachePayload(
        await readMistakesCacheForPeriod(
          filters,
          games.map((game) => String(game.id))
        )
      );
      if (!cached) return null;
      return {
        ...cached,
        moments: capped,
      };
    }
  }

  const cached = parseMistakesCachePayload(
    await readMistakesCacheForPeriod(
      filters,
      games.map((game) => String(game.id))
    )
  );
  if (!cached?.moments.length && !session?.moments.length) return null;

  const baseMoments = session?.moments.length
    ? session.moments
    : filterUnsolvedMoments(cached?.moments || [], solved);
  const existingKeys = new Set(baseMoments.map((item) => candidateKey(item)));
  const vault = await loadPermanentEvalStore(filters);
  const fresh = filterUnsolvedMoments(
    collectFreshRecentCandidates(games, vault, existingKeys),
    solved
  );

  let nextMoments = baseMoments;
  let nextPending = cached?.pendingCandidates || [];
  let nextDeferred = cached?.deferredCandidates || [];
  let nextScanned = cached?.scannedGameIds || [];
  let thresholdPass = cached?.thresholdPass;
  let baselineAvailable = cached?.baselineAvailable;
  let changed = false;

  const slots = Math.max(0, TARGET_MISTAKE_MOMENTS - nextMoments.length);
  if (fresh.length && slots > 0 && !signal?.cancelled) {
    const explorer = async (
      fen: string,
      source: "lichess" | "masters",
      ratings?: string
    ) => {
      const res = await fetchExplorer(
        fen,
        source,
        undefined,
        undefined,
        ratings
      );
      return {
        moves: res.moves || [],
        topGames: res.topGames || [],
        white: res.white || 0,
        draws: res.draws || 0,
        black: res.black || 0,
        fallback: res.fallback,
        opening: res.opening,
      };
    };
    const batch = await refineRecentMistakeCandidates({
      candidates: fresh,
      games,
      evaluate,
      signal,
      limit: slots,
      lookupEval: createEvalLookup({
        scannedGameIds: Object.keys(vault.games),
        games: vault.games,
        mistakeCandidates: fresh,
        openingCandidates: [],
        style: null,
        complete: false,
      }),
      fetchMastersPgn: (gameId) => fetchMastersPgn(gameId),
      fetchExplorer: explorer,
    });
    if (signal?.cancelled) return null;
    if (batch.moments.length) {
      await consumeCandidates(filters, "mistake", batch.moments);
      nextMoments = mergeSessionMoments(nextMoments, batch.moments, solved);
      nextPending = batch.pendingCandidates.length
        ? batch.pendingCandidates
        : nextPending;
      nextDeferred = batch.deferredCandidates?.length
        ? batch.deferredCandidates
        : nextDeferred;
      nextScanned = [
        ...new Set([...nextScanned, ...batch.scannedGameIds]),
      ];
      thresholdPass = batch.thresholdPass || thresholdPass;
      baselineAvailable =
        batch.baselineAvailable != null
          ? batch.baselineAvailable
          : baselineAvailable;
      changed = true;
    }
  }

  nextMoments = capMistakeMoments(nextMoments);
  nextPending = filterUnsolvedMoments(nextPending, solved);
  nextDeferred = filterUnsolvedMoments(nextDeferred, solved);
  if (!session?.moments.length) {
    const ordered = orderMomentsByRecentGames(nextMoments, games);
    if (
      ordered.length !== nextMoments.length ||
      ordered.some((item, index) => item !== nextMoments[index])
    ) {
      nextMoments = ordered;
      changed = true;
    }
  } else if (
    nextMoments.length !== baseMoments.length ||
    nextMoments.some((item, index) => item !== baseMoments[index])
  ) {
    changed = true;
  }

  if (!changed && cached) {
    return { ...cached, moments: nextMoments };
  }

  const reservoir = await periodReservoirStatus(filters, games, "mistake", {
    pendingCount: nextPending.length,
  });
  const payload: MistakesCachePayload = {
    moments: nextMoments,
    pendingCandidates: nextPending,
    deferredCandidates: nextDeferred,
    scannedGameIds: nextScanned,
    remaining: reservoir.remaining,
    thresholdPass,
    baselineAvailable,
  };
  await writeCache(studyMistakesCacheKey(filters), payload);
  await saveMistakesSession(filters, {
    sessionId: mistakesSessionId(),
    moments: nextMoments,
    completedKeys: session?.completedKeys || [],
  });
  return payload;
}

export async function prefetchStudyContent(options: {
  filters: QueryFilters;
  evaluate: EvalFn;
  signal: { cancelled: boolean };
  onProgress?: (progress: GlobalAnalysisProgress) => void;
}): Promise<void> {
  const { filters, evaluate, signal, onProgress } = options;
  if (DEBUG_DISABLE_BACKGROUND_JOBS) {
    onProgress?.({
      status: "Background jobs disabled (debug)",
      phase: "done",
      gamesDone: 0,
      gamesTotal: 0,
      engine: ENGINE_LABEL,
    });
    return;
  }
  if (signal.cancelled) return;
  activePrefetchSignal = signal;

  const loaded = await ensureStudyGames(filters, false);
  if (signal.cancelled) return;
  const allGames = [...loaded].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
  const games = allGames.slice(0, GLOBAL_FIRST_SCAN_MAX_GAMES);
  if (!games.length) {
    onProgress?.({
      status: "No games to scan",
      phase: "done",
      gamesDone: 0,
      gamesTotal: 0,
      engine: ENGINE_LABEL,
    });
    return;
  }

  onProgress?.({
    status: `Preparing scan of ${games.length} games`,
    phase: "boot",
    gamesDone: 0,
    gamesTotal: games.length,
    engine: ENGINE_LABEL,
  });

  const explorer = async (
    fen: string,
    source: "lichess" | "masters",
    ratings?: string
  ) => {
    const res = await fetchExplorer(
      fen,
      source,
      undefined,
      undefined,
      ratings
    );
    return {
      moves: res.moves || [],
      topGames: res.topGames || [],
      white: res.white || 0,
      draws: res.draws || 0,
      black: res.black || 0,
      fallback: res.fallback,
      opening: res.opening,
    };
  };

  const mastersPgn = async (gameId: string) => fetchMastersPgn(gameId);
  let mistakesDone = await hasMistakesCache(filters, allGames);

  if (mistakesDone) {
    onProgress?.({
      status: "Prioritizing recent games in puzzle queue",
      phase: "boot",
      gamesDone: 0,
      gamesTotal: games.length,
      engine: ENGINE_LABEL,
    });
    await prioritizeRecentMistakesInCache({
      filters,
      games: allGames,
      evaluate,
      signal,
    });
    if (signal.cancelled) return;
  }

  try {
    const globalState = await runGlobalPeriodAnalysis({
      filters,
      evaluate,
      signal,
      games,
      owner: "prefetch",
      sessionKey: globalScanSessionKey(filters),
      maxGames: GLOBAL_FIRST_SCAN_MAX_GAMES,
      onProgress,
      onGameScanned: (state) => {
        latestGlobalState = state;
      },
      onEarlyMistakesReady: async (candidates, state) => {
        if (signal.cancelled || mistakesDone) return false;
        const pool = state.mistakeCandidates.length
          ? state.mistakeCandidates
          : candidates;
        const batch = await refineRecentMistakeCandidates({
          candidates: pool,
          games,
          evaluate,
          signal,
          limit: TARGET_MISTAKE_MOMENTS,
          lookupEval: createEvalLookup(state),
          fetchMastersPgn: mastersPgn,
          fetchExplorer: explorer,
        });
        if (signal.cancelled || !batch.moments.length) return false;
        await consumeCandidates(filters, "mistake", batch.moments);
        const reservoir = await periodReservoirStatus(
          filters,
          games,
          "mistake",
          { pendingCount: batch.pendingCandidates.length }
        );
        const solved = await loadSolvedMistakeKeys(filters);
        const existingSession = await loadMistakesSession(filters);
        const fresh = orderMomentsByRecentGames(
          filterUnsolvedMoments(batch.moments, solved),
          allGames
        );
        const moments = existingSession?.moments.length
          ? mergeSessionMoments(existingSession.moments, fresh, solved)
          : capMistakeMoments(fresh);
        const pending = filterUnsolvedMoments(batch.pendingCandidates, solved);
        const deferred = filterUnsolvedMoments(
          batch.deferredCandidates || [],
          solved
        );
        await writeCache(studyMistakesCacheKey(filters), {
          moments,
          pendingCandidates: pending,
          deferredCandidates: deferred,
          scannedGameIds: batch.scannedGameIds,
          remaining: reservoir.remaining,
          thresholdPass: batch.thresholdPass,
          baselineAvailable: batch.baselineAvailable,
        } satisfies MistakesCachePayload);
        await saveMistakesSession(filters, {
          sessionId: mistakesSessionId(),
          moments,
          completedKeys: existingSession?.completedKeys || [],
        });
        mistakesDone = true;
        return true;
      },
    });
    if (signal.cancelled) return;
    latestGlobalState = globalState;

    if (mistakesDone) {
      await prioritizeRecentMistakesInCache({
        filters,
        games: allGames,
        evaluate,
        signal,
      });
    }
  } finally {
    if (activePrefetchSignal === signal) {
      activePrefetchSignal = null;
    }
  }
}

export type { StudyGame };
