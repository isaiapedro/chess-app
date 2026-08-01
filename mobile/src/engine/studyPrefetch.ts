import {
  fetchExplorer,
  fetchMastersPgn,
  fetchStudyGames,
  type MistakeItem,
  type QueryFilters,
} from "../api/client";
import {
  analyzeCriticalMistakes,
  type StudyGame,
} from "./analyzeMistakes";
import {
  analyzeOpeningMoments,
  averageUserRating,
  filterGamesByOpening,
  topOpeningsForColor,
  type OpeningMoment,
} from "./analyzeOpenings";
import { readCache, writeCache, STUDY_ANALYSIS_TTL_MS } from "../storage/cache";
import {
  studyMistakesCacheKey,
  studyOpeningCacheKey,
} from "../storage/studyCacheKeys";

const PREFETCH_OPENING_MOMENTS = 5;
const PREFETCH_TOP_OPENINGS = 3;

let activePrefetchSignal: { cancelled: boolean } | null = null;

export function cancelStudyPrefetch() {
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
    user_rating:
      typeof row.user_rating === "number"
        ? row.user_rating
        : row.user_rating
          ? Number(row.user_rating)
          : undefined,
  }));
}

async function hasMistakesCache(filters: QueryFilters): Promise<boolean> {
  const cached = await readCache<MistakesCachePayload>(
    studyMistakesCacheKey(filters),
    STUDY_ANALYSIS_TTL_MS
  );
  return Boolean(cached?.moments?.length);
}

async function hasOpeningCache(
  filters: QueryFilters,
  color: "white" | "black",
  openingKey: string
): Promise<boolean> {
  const cached = await readCache<OpeningCachePayload>(
    studyOpeningCacheKey(filters, color, openingKey),
    STUDY_ANALYSIS_TTL_MS
  );
  return Boolean(cached?.moments?.length);
}

export async function prefetchStudyContent(options: {
  filters: QueryFilters;
  evaluate: EvalFn;
  signal: { cancelled: boolean };
}): Promise<void> {
  const { filters, evaluate, signal } = options;
  if (signal.cancelled) return;
  activePrefetchSignal = signal;

  const rows = await fetchStudyGames(filters, false);
  if (signal.cancelled) return;
  const games = toStudyGames(rows);
  if (!games.length) return;

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

  const mistakeJob = async () => {
    if (signal.cancelled) return;
    if (await hasMistakesCache(filters)) return;
    const batch = await analyzeCriticalMistakes({
      games,
      evaluate,
      signal,
      thresholdPass: "strict",
      fetchMastersPgn: mastersPgn,
      fetchExplorer: explorer,
    });
    if (signal.cancelled || !batch.moments.length) return;
    await writeCache(studyMistakesCacheKey(filters), {
      moments: batch.moments,
      pendingCandidates: batch.pendingCandidates,
      deferredCandidates: batch.deferredCandidates,
      scannedGameIds: batch.scannedGameIds,
      remaining: batch.remaining,
      thresholdPass: batch.thresholdPass,
      baselineAvailable: batch.baselineAvailable,
    } satisfies MistakesCachePayload);
  };

  const openingJob = async (
    color: "white" | "black",
    opening: ReturnType<typeof topOpeningsForColor>[number]
  ) => {
    if (signal.cancelled) return;
    if (await hasOpeningCache(filters, color, opening.key)) return;
    const filtered = filterGamesByOpening(games, color, opening);
    if (!filtered.length) return;
    const batch = await analyzeOpeningMoments({
      games: filtered,
      color,
      userRating: averageUserRating(filtered.length ? filtered : games),
      evaluate,
      signal,
      thresholdPass: "strict",
      appendCount: PREFETCH_OPENING_MOMENTS,
      fetchMastersPgn: mastersPgn,
      fetchExplorer: explorer,
    });
    if (signal.cancelled || !batch.moments.length) return;
    await writeCache(studyOpeningCacheKey(filters, color, opening.key), {
      moments: batch.moments,
      pendingCandidates: batch.pendingCandidates,
      deferredCandidates: batch.deferredCandidates,
      scannedGameIds: batch.scannedGameIds,
      remaining: batch.remaining,
      thresholdPass: batch.thresholdPass,
      baselineAvailable: batch.baselineAvailable,
    } satisfies OpeningCachePayload);
  };

  const openingJobs: Array<() => Promise<void>> = [];
  for (const color of ["white", "black"] as const) {
    const top = topOpeningsForColor(games, color, PREFETCH_TOP_OPENINGS);
    for (const opening of top) {
      openingJobs.push(() => openingJob(color, opening));
    }
  }

  try {
    await mistakeJob();
    for (const job of openingJobs) {
      if (signal.cancelled) return;
      await job();
    }
  } finally {
    if (activePrefetchSignal === signal) {
      activePrefetchSignal = null;
    }
  }
}
