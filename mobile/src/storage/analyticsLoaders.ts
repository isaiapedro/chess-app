import type { QueryFilters } from "../api/client";
import {
  fetchInsights,
  fetchRecap,
  fetchStudyGames,
} from "../api/client";
import type { InsightsResponse, RecapResponse } from "../api/types";
import type { StudyGame } from "../engine/analyzeMistakes";
import {
  mergeEndgameHeuristicWithBucket,
} from "../engine/evalBucketMetrics";
import {
  loadPermanentEvalStore,
  resolveStyleMetricsForPeriod,
  toStudyGames,
} from "../engine/globalAnalysis";
import {
  analyzeHeuristicGamesBatched,
} from "../engine/heuristicMetricsPass";
import {
  calculateOpeningMixStats,
  type OpeningMixStats,
} from "../engine/openingMix";
import {
  aggregateOpeningMetrics,
  topOpeningsBySide,
  type OpeningGameRow,
  type OpeningMetricsAggregate,
  type OpeningSideCard,
} from "../engine/openingPhase";
import {
  aggregateEndgameMetrics,
  type EndgameGameRow,
  type EndgameMetricsAggregate,
} from "../engine/endgamePhase";
import {
  aggregateMiddlegameMetrics,
  mergeMiddlegameHeuristicWithBucket,
  type MiddlegameGameRow,
  type MiddlegameMetricsAggregate,
} from "../engine/middlegamePhase";
import type { StyleMetricsAggregate } from "../engine/styleMetrics";
import {
  STUDY_ANALYSIS_TTL_MS,
  GAMES_TTL_MS,
  readCache,
  writeCache,
} from "./cache";
import {
  analyticsEndgamePhaseCacheKey,
  analyticsInsightsCacheKey,
  analyticsMiddlegamePhaseCacheKey,
  analyticsOpeningMixCacheKey,
  analyticsOpeningPhaseCacheKey,
  analyticsRecapCacheKey,
  analyticsStudyGamesCacheKey,
  analyticsVaultHeuristicsCacheKey,
  studyFiltersKey,
} from "./studyCacheKeys";

type InflightMap = Map<string, Promise<unknown>>;

const inflight: InflightMap = new Map();

function filtersKey(filters: QueryFilters): string {
  return studyFiltersKey(filters);
}

function takeInflight<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = factory().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function clearAnalyticsInflight(): void {
  inflight.clear();
}

export async function ensureStudyGames(
  filters: QueryFilters,
  forceNetwork = false
): Promise<StudyGame[]> {
  const key = analyticsStudyGamesCacheKey(filters);
  return takeInflight(`games:${filtersKey(filters)}:${forceNetwork}`, async () => {
    if (!forceNetwork) {
      const cached = await readCache<StudyGame[]>(key, GAMES_TTL_MS);
      if (cached?.length) return cached;
    }
    const rows = await fetchStudyGames(filters, forceNetwork);
    const games = toStudyGames(rows);
    await writeCache(key, games);
    return games;
  });
}

export async function ensureOpeningMix(
  filters: QueryFilters,
  games?: StudyGame[],
  force = false
): Promise<OpeningMixStats> {
  const key = analyticsOpeningMixCacheKey(filters);
  return takeInflight(`mix:${filtersKey(filters)}:${force}`, async () => {
    if (!force) {
      const cached = await readCache<OpeningMixStats>(
        key,
        STUDY_ANALYSIS_TTL_MS
      );
      if (cached) return cached;
    }
    const list = games ?? (await ensureStudyGames(filters, false));
    const mix = calculateOpeningMixStats(
      list.map((g) => ({
        opening_eco: g.opening_eco,
        opening_name: g.opening_name,
        user_color: g.user_color,
        result: g.result,
        moves_str: g.moves_str,
        pgn_str: g.pgn_str,
      }))
    );
    await writeCache(key, mix);
    return mix;
  });
}

export type OpeningPhasePayload = {
  aggregate: OpeningMetricsAggregate;
  sides: { white: OpeningSideCard[]; black: OpeningSideCard[] };
  analyzedCount: number;
  totalGames: number;
};

export type EndgamePhasePayload = {
  aggregate: EndgameMetricsAggregate;
  analyzedCount: number;
  totalGames: number;
};

export type MiddlegamePhasePayload = {
  aggregate: MiddlegameMetricsAggregate;
  analyzedCount: number;
  totalGames: number;
};

export type VaultMetricsPayload = {
  opening: OpeningPhasePayload;
  middlegame: MiddlegamePhasePayload;
  endgame: EndgamePhasePayload;
  style: {
    style: StyleMetricsAggregate | null;
    scanned: number;
    total: number;
    periodComplete: boolean;
  };
};

function mergeOpeningWithVault(
  rows: OpeningGameRow[],
  gameIds: string[],
  vault: Awaited<ReturnType<typeof loadPermanentEvalStore>>
): OpeningGameRow[] {
  return rows.map((row, idx) => {
    const rec = vault.games[gameIds[idx] || ""];
    if (rec?.opening_accuracy_pct == null) return row;
    return {
      ...row,
      opening_accuracy_pct: rec.opening_accuracy_pct,
      accuracy_moves: rec.opening_accuracy_moves ?? row.accuracy_moves,
    };
  });
}

function mergeEndgameRowsWithVault(
  rows: Parameters<typeof mergeEndgameHeuristicWithBucket>[0][],
  gameIds: string[],
  vault: Awaited<ReturnType<typeof loadPermanentEvalStore>>
) {
  return rows.map((row, idx) => {
    const rec = vault.games[gameIds[idx] || ""];
    return mergeEndgameHeuristicWithBucket(row, rec?.endgameEval);
  });
}

function mergeMiddlegameRowsWithVault(
  rows: MiddlegameGameRow[],
  gameIds: string[],
  vault: Awaited<ReturnType<typeof loadPermanentEvalStore>>
): MiddlegameGameRow[] {
  return rows.map((row, idx) => {
    const rec = vault.games[gameIds[idx] || ""];
    return mergeMiddlegameHeuristicWithBucket(row, rec?.middlegameEval);
  });
}

function buildPhasePayloads(
  openingRows: OpeningGameRow[],
  middlegameRows: MiddlegameGameRow[],
  endgameRows: EndgameGameRow[],
  analyzedCount: number,
  totalGames: number
): Pick<VaultMetricsPayload, "opening" | "middlegame" | "endgame"> {
  return {
    opening: {
      aggregate: aggregateOpeningMetrics(openingRows),
      sides: topOpeningsBySide(openingRows, 5, 3),
      analyzedCount,
      totalGames,
    },
    middlegame: {
      aggregate: aggregateMiddlegameMetrics(middlegameRows),
      analyzedCount,
      totalGames,
    },
    endgame: {
      aggregate: aggregateEndgameMetrics(endgameRows),
      analyzedCount,
      totalGames,
    },
  };
}

function emptyStyle(total: number) {
  return {
    style: null as StyleMetricsAggregate | null,
    scanned: 0,
    total,
    periodComplete: false,
  };
}

export async function ensureVaultMetrics(
  filters: QueryFilters,
  options?: {
    games?: StudyGame[];
    force?: boolean;
    signal?: { cancelled: boolean };
    onPartial?: (payload: VaultMetricsPayload) => void;
  }
): Promise<VaultMetricsPayload> {
  const force = options?.force ?? false;
  const key = analyticsVaultHeuristicsCacheKey(filters);
  return takeInflight(`vault-heuristics:${filtersKey(filters)}:${force}`, async () => {
    const games = options?.games ?? (await ensureStudyGames(filters, false));
    const vault = await loadPermanentEvalStore(filters);

    if (!force) {
      const cached = await readCache<{
        openingRows: OpeningGameRow[];
        middlegameRows: MiddlegameGameRow[];
        endgameRows: Parameters<typeof mergeEndgameHeuristicWithBucket>[0][];
        gameIds: string[];
      }>(key, STUDY_ANALYSIS_TTL_MS);
      if (
        cached?.openingRows?.length &&
        cached.middlegameRows?.length != null &&
        cached.gameIds?.length
      ) {
        const openingRows = mergeOpeningWithVault(
          cached.openingRows,
          cached.gameIds,
          vault
        );
        const middlegameRows = mergeMiddlegameRowsWithVault(
          cached.middlegameRows,
          cached.gameIds,
          vault
        );
        const endgameRows = mergeEndgameRowsWithVault(
          cached.endgameRows,
          cached.gameIds,
          vault
        );
        const phases = buildPhasePayloads(
          openingRows,
          middlegameRows,
          endgameRows,
          games.length,
          games.length
        );
        const payload = { ...phases, style: emptyStyle(games.length) };
        options?.onPartial?.(payload);
        return payload;
      }
    }

    const {
      openingRows: rawOpening,
      middlegameRows: rawMiddlegame,
      endgameRows: rawEndgame,
      gameIds,
    } = await analyzeHeuristicGamesBatched(games, {
      signal: options?.signal,
      onPartial: (openingRows, middlegameRows, endgameRows, ids, scanned, total) => {
        const mergedOpening = mergeOpeningWithVault(openingRows, ids, vault);
        const mergedMiddlegame = mergeMiddlegameRowsWithVault(
          middlegameRows,
          ids,
          vault
        );
        const mergedEndgame = mergeEndgameRowsWithVault(
          endgameRows,
          ids,
          vault
        );
        const phases = buildPhasePayloads(
          mergedOpening,
          mergedMiddlegame,
          mergedEndgame,
          scanned,
          total
        );
        options?.onPartial?.({
          ...phases,
          style: emptyStyle(total),
        });
      },
    });

    if (options?.signal?.cancelled) {
      return {
        ...buildPhasePayloads([], [], [], 0, games.length),
        style: emptyStyle(games.length),
      };
    }

    await writeCache(key, {
      openingRows: rawOpening,
      middlegameRows: rawMiddlegame,
      endgameRows: rawEndgame,
      gameIds,
    });

    const openingRows = mergeOpeningWithVault(rawOpening, gameIds, vault);
    const middlegameRows = mergeMiddlegameRowsWithVault(
      rawMiddlegame,
      gameIds,
      vault
    );
    const endgameRows = mergeEndgameRowsWithVault(rawEndgame, gameIds, vault);

    const phases = buildPhasePayloads(
      openingRows,
      middlegameRows,
      endgameRows,
      games.length,
      games.length
    );
    await writeCache(analyticsOpeningPhaseCacheKey(filters), phases.opening);
    await writeCache(
      analyticsMiddlegamePhaseCacheKey(filters),
      phases.middlegame
    );
    await writeCache(analyticsEndgamePhaseCacheKey(filters), phases.endgame);

    const payload = { ...phases, style: emptyStyle(games.length) };
    options?.onPartial?.(payload);
    return payload;
  });
}

export async function remeshVaultFromBucket(
  filters: QueryFilters,
  games?: StudyGame[]
): Promise<{
  opening: OpeningPhasePayload;
  middlegame: MiddlegamePhasePayload;
  endgame: EndgamePhasePayload;
} | null> {
  const list = games ?? (await ensureStudyGames(filters, false));
  const key = analyticsVaultHeuristicsCacheKey(filters);
  const cached = await readCache<{
    openingRows: OpeningGameRow[];
    middlegameRows: MiddlegameGameRow[];
    endgameRows: Parameters<typeof mergeEndgameHeuristicWithBucket>[0][];
    gameIds: string[];
  }>(key, STUDY_ANALYSIS_TTL_MS);
  if (
    !cached?.openingRows?.length ||
    !cached.gameIds?.length ||
    cached.middlegameRows == null
  ) {
    return null;
  }

  const vault = await loadPermanentEvalStore(filters);
  const openingRows = mergeOpeningWithVault(
    cached.openingRows,
    cached.gameIds,
    vault
  );
  const middlegameRows = mergeMiddlegameRowsWithVault(
    cached.middlegameRows,
    cached.gameIds,
    vault
  );
  const endgameRows = mergeEndgameRowsWithVault(
    cached.endgameRows,
    cached.gameIds,
    vault
  );
  const phases = buildPhasePayloads(
    openingRows,
    middlegameRows,
    endgameRows,
    list.length,
    list.length
  );
  await writeCache(analyticsOpeningPhaseCacheKey(filters), phases.opening);
  await writeCache(
    analyticsMiddlegamePhaseCacheKey(filters),
    phases.middlegame
  );
  await writeCache(analyticsEndgamePhaseCacheKey(filters), phases.endgame);
  return phases;
}

export async function ensureOpeningPhase(
  filters: QueryFilters,
  options?: {
    games?: StudyGame[];
    force?: boolean;
    signal?: { cancelled: boolean };
    onPartial?: (payload: OpeningPhasePayload) => void;
  }
): Promise<OpeningPhasePayload> {
  const vault = await ensureVaultMetrics(filters, {
    games: options?.games,
    force: options?.force,
    signal: options?.signal,
    onPartial: (payload) => options?.onPartial?.(payload.opening),
  });
  return vault.opening;
}

export async function ensureMiddlegamePhase(
  filters: QueryFilters,
  options?: {
    games?: StudyGame[];
    force?: boolean;
    signal?: { cancelled: boolean };
    onPartial?: (payload: MiddlegamePhasePayload) => void;
  }
): Promise<MiddlegamePhasePayload> {
  const vault = await ensureVaultMetrics(filters, {
    games: options?.games,
    force: options?.force,
    signal: options?.signal,
    onPartial: (payload) => options?.onPartial?.(payload.middlegame),
  });
  return vault.middlegame;
}

export async function ensureEndgamePhase(
  filters: QueryFilters,
  options?: {
    games?: StudyGame[];
    force?: boolean;
    signal?: { cancelled: boolean };
    onPartial?: (payload: EndgamePhasePayload) => void;
  }
): Promise<EndgamePhasePayload> {
  const vault = await ensureVaultMetrics(filters, {
    games: options?.games,
    force: options?.force,
    signal: options?.signal,
    onPartial: (payload) => options?.onPartial?.(payload.endgame),
  });
  return vault.endgame;
}

export async function ensureStyleMetrics(
  filters: QueryFilters,
  options?: {
    games?: StudyGame[];
    force?: boolean;
    signal?: { cancelled: boolean };
    onPartial?: (
      style: StyleMetricsAggregate,
      scanned: number,
      total: number
    ) => void;
  }
): Promise<{
  style: StyleMetricsAggregate | null;
  scanned: number;
  total: number;
  periodComplete: boolean;
}> {
  const games = options?.games ?? (await ensureStudyGames(filters, false));
  return resolveStyleMetricsForPeriod({
    filters,
    games,
    signal: options?.signal,
    onPartial: options?.onPartial,
  });
}

export async function ensureRecap(
  filters: QueryFilters,
  forceNetwork = false
): Promise<RecapResponse> {
  const key = analyticsRecapCacheKey(filters);
  return takeInflight(`recap:${filtersKey(filters)}:${forceNetwork}`, async () => {
    if (!forceNetwork) {
      const cached = await readCache<RecapResponse>(key, 15 * 60 * 1000);
      if (cached) return cached;
    }
    const data = await fetchRecap(filters, forceNetwork);
    await writeCache(key, data);
    return data;
  });
}

export async function ensureInsights(
  filters: QueryFilters,
  forceNetwork = false
): Promise<InsightsResponse> {
  const key = analyticsInsightsCacheKey(filters);
  return takeInflight(
    `insights:${filtersKey(filters)}:${forceNetwork}`,
    async () => {
      if (!forceNetwork) {
        const cached = await readCache<InsightsResponse>(key, 15 * 60 * 1000);
        if (cached) return cached;
      }
      const data = await fetchInsights(filters, forceNetwork);
      await writeCache(key, data);
      return data;
    }
  );
}
