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
  averageUserRating,
  filterGamesByOpening,
  refineRecentOpeningCandidates,
  topOpeningsForColor,
  type OpeningMoment,
} from "./analyzeOpenings";
import {
  ENGINE_LABEL,
  GLOBAL_FIRST_SCAN_MAX_GAMES,
  TARGET_MISTAKE_MOMENTS,
  TARGET_OPENING_MOMENTS,
} from "./analysisConfig";
import { consumeCandidates } from "./candidateBucket";
import { DEBUG_DISABLE_BACKGROUND_JOBS } from "./debugFlags";
import {
  createEvalLookup,
  globalScanSessionKey,
  getActiveGlobalScan,
  periodReservoirStatus,
  runGlobalPeriodAnalysis,
  type GlobalAnalysisProgress,
  type GlobalAnalysisState,
} from "./globalAnalysis";
import { writeCache } from "../storage/cache";
import {
  readMistakesCacheForPeriod,
  readOpeningCacheForPeriod,
} from "../storage/periodCacheReuse";
import {
  studyMistakesCacheKey,
  studyOpeningCacheKey,
} from "../storage/studyCacheKeys";

const PREFETCH_TOP_OPENINGS = 3;

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

type MistakesCachePayload = {
  moments: MistakeItem[];
  pendingCandidates: MistakeItem[];
  deferredCandidates?: MistakeItem[];
  scannedGameIds: string[];
  remaining: number;
  thresholdPass?: "strict" | "baseline";
  baselineAvailable?: boolean;
};

type OpeningCachePayload = {
  moments: OpeningMoment[];
  pendingCandidates: OpeningMoment[];
  deferredCandidates?: OpeningMoment[];
  scannedGameIds: string[];
  remaining: number;
  thresholdPass?: "strict" | "baseline";
  baselineAvailable?: boolean;
};

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

async function hasOpeningCache(
  filters: QueryFilters,
  color: "white" | "black",
  openingKey: string,
  periodGames: StudyGame[]
): Promise<boolean> {
  const cached = await readOpeningCacheForPeriod(
    filters,
    color,
    openingKey,
    periodGames.map((game) => String(game.id))
  );
  return Boolean(cached?.moments?.length);
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
  const games = [...loaded]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, GLOBAL_FIRST_SCAN_MAX_GAMES);
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
  let mistakesDone = await hasMistakesCache(filters, games);
  const openingDone = new Set<string>();

  const openingPlans: Array<{
    color: "white" | "black";
    opening: ReturnType<typeof topOpeningsForColor>[number];
    games: StudyGame[];
  }> = [];
  for (const color of ["white", "black"] as const) {
    const top = topOpeningsForColor(games, color, PREFETCH_TOP_OPENINGS);
    for (const opening of top) {
      if (await hasOpeningCache(filters, color, opening.key, games)) {
        openingDone.add(`${color}:${opening.key}`);
        continue;
      }
      const filtered = filterGamesByOpening(games, color, opening);
      if (filtered.length) {
        openingPlans.push({ color, opening, games: filtered });
      }
    }
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
        await writeCache(studyMistakesCacheKey(filters), {
          moments: batch.moments,
          pendingCandidates: batch.pendingCandidates,
          deferredCandidates: batch.deferredCandidates,
          scannedGameIds: batch.scannedGameIds,
          remaining: reservoir.remaining,
          thresholdPass: batch.thresholdPass,
          baselineAvailable: batch.baselineAvailable,
        } satisfies MistakesCachePayload);
        mistakesDone = true;
        return true;
      },
      onEarlyOpeningsReady: async (_candidates, state) => {
        if (signal.cancelled || !openingPlans.length) return false;
        let anyAccepted = false;
        for (const plan of openingPlans) {
          const planKey = `${plan.color}:${plan.opening.key}`;
          if (openingDone.has(planKey) || signal.cancelled) continue;
          const periodIds = new Set(plan.games.map((g) => String(g.id)));
          const scoped = state.openingCandidates.filter((item) =>
            periodIds.has(String(item.game_id))
          );
          const overall = state.openingCandidates;
          if (!scoped.length && !overall.length) continue;
          const batch = await refineRecentOpeningCandidates({
            candidates: scoped.length ? scoped : overall,
            games: scoped.length ? plan.games : games,
            fallbackCandidates: scoped.length ? overall : undefined,
            fallbackGames: scoped.length ? games : undefined,
            color: plan.color,
            userRating: averageUserRating(plan.games),
            evaluate,
            signal,
            limit: TARGET_OPENING_MOMENTS,
            lookupEval: createEvalLookup(state),
            fetchMastersPgn: mastersPgn,
            fetchExplorer: explorer,
          });
          await consumeCandidates(filters, "opening", batch.moments);
          if (signal.cancelled || !batch.moments.length) continue;
          openingDone.add(planKey);
          anyAccepted = true;
          const reservoir = await periodReservoirStatus(
            filters,
            games,
            "opening",
            {
              periodGameIds: [...periodIds],
              pendingCount: batch.pendingCandidates.length,
            }
          );
          await writeCache(
            studyOpeningCacheKey(filters, plan.color, plan.opening.key),
            {
              moments: batch.moments,
              pendingCandidates: batch.pendingCandidates,
              deferredCandidates: batch.deferredCandidates,
              scannedGameIds: batch.scannedGameIds,
              remaining: reservoir.remaining,
              thresholdPass: batch.thresholdPass,
              baselineAvailable: batch.baselineAvailable,
            } satisfies OpeningCachePayload
          );
        }
        return anyAccepted;
      },
    });
    if (signal.cancelled) return;
    latestGlobalState = globalState;
  } finally {
    if (activePrefetchSignal === signal) {
      activePrefetchSignal = null;
    }
  }
}

export type { StudyGame };
