import type { QueryFilters } from "../api/client";
import {
  GAMES_FIRST_PAGE_SIZE,
  GAMES_PAGE_SIZE,
} from "../api/client";
import { GLOBAL_MAX_GAMES } from "../engine/analysisConfig";
import type { InsightsResponse, RecapResponse } from "../api/types";
import type { StudyGame } from "../engine/analyzeMistakes";
import {
  filterNormalizedGames,
  loadLocalGamesPage,
  toStudyGameList,
  type NormalizedGame,
} from "../data/platformGames";
import { yieldForUi } from "../engine/backgroundWork";
import {
  buildLocalInsights,
  buildLocalRecap,
} from "../engine/localRecap";
import {
  mergeEndgameHeuristicWithBucket,
} from "../engine/evalBucketMetrics";
import {
  loadPermanentEvalStore,
  resolveStyleMetricsForPeriod,
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
  INSIGHTS_TTL_MS,
  INSIGHTS_RECENT_TTL_MS,
  PERMANENT_CACHE_TTL_MS,
  clearInflightByPrefix,
  readCache,
  takeInflight,
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
  studyHeuristicsStoreCacheKey,
  relatedPeriodFilters,
} from "./studyCacheKeys";

type HeuristicGameEntry = {
  opening: OpeningGameRow;
  middlegame: MiddlegameGameRow;
  endgame: EndgameGameRow;
};

type HeuristicStore = {
  games: Record<string, HeuristicGameEntry>;
};

type PeriodHeuristicCache = {
  openingRows: OpeningGameRow[];
  middlegameRows: MiddlegameGameRow[];
  endgameRows: EndgameGameRow[];
  gameIds: string[];
};

function emptyHeuristicStore(): HeuristicStore {
  return { games: {} };
}

async function loadHeuristicStore(
  filters: Pick<QueryFilters, "username" | "platform">
): Promise<HeuristicStore> {
  const cached = await readCache<HeuristicStore>(
    studyHeuristicsStoreCacheKey(filters),
    PERMANENT_CACHE_TTL_MS
  );
  return cached?.games ? cached : emptyHeuristicStore();
}

async function saveHeuristicStore(
  filters: Pick<QueryFilters, "username" | "platform">,
  store: HeuristicStore
): Promise<void> {
  await writeCache(studyHeuristicsStoreCacheKey(filters), store);
}

function mergeHeuristicRowsIntoStore(
  store: HeuristicStore,
  openingRows: OpeningGameRow[],
  middlegameRows: MiddlegameGameRow[],
  endgameRows: EndgameGameRow[],
  gameIds: string[]
): HeuristicStore {
  const games = { ...store.games };
  for (let i = 0; i < gameIds.length; i += 1) {
    const id = gameIds[i];
    const opening = openingRows[i];
    const middlegame = middlegameRows[i];
    const endgame = endgameRows[i];
    if (!id || !opening || !middlegame || !endgame) continue;
    games[id] = { opening, middlegame, endgame };
  }
  return { games };
}

function sliceHeuristicStoreForPeriod(
  store: HeuristicStore,
  periodGames: StudyGame[]
): PeriodHeuristicCache {
  const openingRows: OpeningGameRow[] = [];
  const middlegameRows: MiddlegameGameRow[] = [];
  const endgameRows: EndgameGameRow[] = [];
  const gameIds: string[] = [];
  for (const game of periodGames) {
    const id = String(game.id);
    const entry = store.games[id];
    if (!entry) continue;
    openingRows.push(entry.opening);
    middlegameRows.push(entry.middlegame);
    endgameRows.push(entry.endgame);
    gameIds.push(id);
  }
  return { openingRows, middlegameRows, endgameRows, gameIds };
}

function missingHeuristicGames(
  store: HeuristicStore,
  periodGames: StudyGame[]
): StudyGame[] {
  return periodGames.filter((game) => !store.games[String(game.id)]);
}

function filtersKey(filters: QueryFilters): string {
  return studyFiltersKey(filters);
}

function analyticsTtlMs(filters: QueryFilters): number {
  if (filters.timeframe === "1 month") return INSIGHTS_RECENT_TTL_MS;
  const from = filters.dateFrom || null;
  const to = filters.dateTo || null;
  if (from && to && from === to) return INSIGHTS_RECENT_TTL_MS;
  return INSIGHTS_TTL_MS;
}

export type SessionBundle = {
  games: StudyGame[];
  recap: RecapResponse;
  insights: InsightsResponse;
};

export function clearAnalyticsInflight(): void {
  clearInflightByPrefix("session:");
  clearInflightByPrefix("games:");
  clearInflightByPrefix("games-up-to:");
  clearInflightByPrefix("local-ingest:");
  clearInflightByPrefix("mix:");
  clearInflightByPrefix("vault-heuristics:");
  clearInflightByPrefix("recap:");
  clearInflightByPrefix("insights:");
  clearInflightByPrefix("study-games:");
  clearInflightByPrefix("rtc:");
  clearInflightByPrefix("baselines:");
}

async function writeSessionCaches(
  filters: QueryFilters,
  bundle: SessionBundle
): Promise<void> {
  await Promise.all([
    writeCache(analyticsStudyGamesCacheKey(filters), bundle.games),
    writeCache(analyticsRecapCacheKey(filters), bundle.recap),
    writeCache(analyticsInsightsCacheKey(filters), bundle.insights),
  ]);
}

function emptyRecap(filters: QueryFilters): RecapResponse {
  return buildLocalRecap(filters, []);
}

function emptyInsights(filters: QueryFilters): InsightsResponse {
  return buildLocalInsights(filters, []);
}

async function tryRemeshSessionFromRelated(
  filters: QueryFilters
): Promise<SessionBundle | null> {
  for (const related of relatedPeriodFilters(filters)) {
    const cached = await readCache<StudyGame[]>(
      analyticsStudyGamesCacheKey(related),
      GAMES_TTL_MS
    );
    if (!cached?.length) continue;
    await yieldForUi({ heavy: true });
    const filtered = filterNormalizedGames(
      cached as NormalizedGame[],
      filters
    ).sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at))
    );
    const bundle: SessionBundle = {
      games: toStudyGameList(filtered),
      recap: buildLocalRecap(filters, filtered),
      insights: buildLocalInsights(filters, filtered),
    };
    await writeSessionCaches(filters, bundle);
    return bundle;
  }
  return null;
}

export async function ensureSession(
  filters: QueryFilters,
  forceNetwork = false
): Promise<SessionBundle> {
  const fk = filtersKey(filters);
  const mode = forceNetwork ? "force" : "soft";
  return takeInflight(`session:${fk}:${mode}`, async () => {
    const gamesKey = analyticsStudyGamesCacheKey(filters);
    const recapKey = analyticsRecapCacheKey(filters);
    const insightsKey = analyticsInsightsCacheKey(filters);

    if (!filters.username.trim()) {
      const bundle: SessionBundle = {
        games: [],
        recap: emptyRecap(filters),
        insights: emptyInsights(filters),
      };
      return bundle;
    }

    if (!forceNetwork) {
      const analyticsTtl = analyticsTtlMs(filters);
      const [games, recap, insights] = await Promise.all([
        readCache<StudyGame[]>(gamesKey, GAMES_TTL_MS),
        readCache<RecapResponse>(recapKey, analyticsTtl),
        readCache<InsightsResponse>(insightsKey, analyticsTtl),
      ]);
      if (games != null && recap && insights) {
        return { games, recap, insights };
      }
      const remeshed = await tryRemeshSessionFromRelated(filters);
      if (remeshed) return remeshed;
    }

    await yieldForUi({ heavy: true });
    const page = await loadLocalGamesPage(filters, {
      force: forceNetwork,
      limit: GAMES_FIRST_PAGE_SIZE,
      offset: 0,
    });
    await yieldForUi({ heavy: true });
    const allFiltered: NormalizedGame[] = page.allFiltered;
    const periodGames = toStudyGameList(allFiltered);
    await yieldForUi({ heavy: true });
    const recap = buildLocalRecap(filters, allFiltered);
    await yieldForUi({ heavy: true });
    const insights = buildLocalInsights(filters, allFiltered);
    const bundle: SessionBundle = {
      games: periodGames,
      recap,
      insights,
    };
    await writeSessionCaches(filters, bundle);
    return bundle;
  });
}

export async function ensureStudyGames(
  filters: QueryFilters,
  forceNetwork = false
): Promise<StudyGame[]> {
  const key = analyticsStudyGamesCacheKey(filters);
  const fk = filtersKey(filters);
  return takeInflight(`games:${fk}`, async () => {
    if (!filters.username.trim()) return [];
    if (!forceNetwork) {
      const cached = await readCache<StudyGame[]>(key, GAMES_TTL_MS);
      if (cached?.length) return cached;
    }
    const session = await ensureSession(filters, forceNetwork);
    return session.games;
  });
}

export async function ensureStudyGamesUpTo(
  filters: QueryFilters,
  maxGames = GLOBAL_MAX_GAMES,
  forceNetwork = false
): Promise<StudyGame[]> {
  const key = analyticsStudyGamesCacheKey(filters);
  const fk = filtersKey(filters);
  const cap = Math.max(0, Math.min(maxGames, GAMES_PAGE_SIZE));
  return takeInflight(`games-up-to:${fk}:${cap}:${forceNetwork}`, async () => {
    if (!filters.username.trim()) return [];
    if (!forceNetwork) {
      const cached = await readCache<StudyGame[]>(key, GAMES_TTL_MS);
      if (cached && cached.length >= cap) {
        return cached.slice(0, cap);
      }
    }
    const page = await loadLocalGamesPage(filters, {
      force: forceNetwork,
      limit: cap,
      offset: 0,
    });
    const games = toStudyGameList(page.allFiltered.slice(0, cap));
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

async function seedHeuristicStoreFromPeriodCache(
  filters: QueryFilters,
  store: HeuristicStore
): Promise<HeuristicStore> {
  const cached = await readCache<PeriodHeuristicCache>(
    analyticsVaultHeuristicsCacheKey(filters),
    STUDY_ANALYSIS_TTL_MS
  );
  if (
    !cached?.gameIds?.length ||
    !cached.openingRows?.length ||
    cached.middlegameRows == null ||
    cached.endgameRows == null
  ) {
    return store;
  }
  return mergeHeuristicRowsIntoStore(
    store,
    cached.openingRows,
    cached.middlegameRows,
    cached.endgameRows,
    cached.gameIds
  );
}

async function seedHeuristicStoreFromRelatedCaches(
  filters: QueryFilters,
  store: HeuristicStore
): Promise<HeuristicStore> {
  let next = await seedHeuristicStoreFromPeriodCache(filters, store);
  for (const related of relatedPeriodFilters(filters)) {
    next = await seedHeuristicStoreFromPeriodCache(related, next);
  }
  return next;
}

function buildVaultPayloadFromRows(
  rows: PeriodHeuristicCache,
  vault: Awaited<ReturnType<typeof loadPermanentEvalStore>>,
  totalGames: number,
  analyzedCount?: number
): VaultMetricsPayload {
  const scanned = analyzedCount ?? rows.gameIds.length;
  const openingRows = mergeOpeningWithVault(
    rows.openingRows,
    rows.gameIds,
    vault
  );
  const middlegameRows = mergeMiddlegameRowsWithVault(
    rows.middlegameRows,
    rows.gameIds,
    vault
  );
  const endgameRows = mergeEndgameRowsWithVault(
    rows.endgameRows,
    rows.gameIds,
    vault
  );
  const phases = buildPhasePayloads(
    openingRows,
    middlegameRows,
    endgameRows,
    scanned,
    totalGames
  );
  return { ...phases, style: emptyStyle(totalGames) };
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
    await yieldForUi({ heavy: true });
    const vault = await loadPermanentEvalStore(filters);
    await yieldForUi({ heavy: true });
    let store = await loadHeuristicStore(filters);
    await yieldForUi({ heavy: true });
    const seeded = await seedHeuristicStoreFromRelatedCaches(filters, store);
    if (seeded !== store) {
      store = seeded;
      await saveHeuristicStore(filters, store);
    }

    if (!force) {
      const covered = sliceHeuristicStoreForPeriod(store, games);
      if (
        games.length === 0 ||
        missingHeuristicGames(store, games).length === 0
      ) {
        const payload = buildVaultPayloadFromRows(
          covered,
          vault,
          games.length
        );
        options?.onPartial?.(payload);
        await writeCache(key, covered);
        await writeCache(analyticsOpeningPhaseCacheKey(filters), payload.opening);
        await writeCache(
          analyticsMiddlegamePhaseCacheKey(filters),
          payload.middlegame
        );
        await writeCache(analyticsEndgamePhaseCacheKey(filters), payload.endgame);
        return payload;
      }
    }

    const toAnalyze = force ? games : missingHeuristicGames(store, games);
    const already = force
      ? { openingRows: [], middlegameRows: [], endgameRows: [], gameIds: [] }
      : sliceHeuristicStoreForPeriod(store, games);

    options?.onPartial?.(
      buildVaultPayloadFromRows(
        already,
        vault,
        games.length,
        already.gameIds.length
      )
    );

    if (!toAnalyze.length) {
      const payload = buildVaultPayloadFromRows(already, vault, games.length);
      options?.onPartial?.(payload);
      return payload;
    }

    const {
      openingRows: newOpening,
      middlegameRows: newMiddlegame,
      endgameRows: newEndgame,
      gameIds: newIds,
    } = await analyzeHeuristicGamesBatched(toAnalyze, {
      signal: options?.signal,
      onPartial: (openingRows, middlegameRows, endgameRows, ids, scanned) => {
        const merged: PeriodHeuristicCache = {
          openingRows: [...already.openingRows, ...openingRows],
          middlegameRows: [...already.middlegameRows, ...middlegameRows],
          endgameRows: [...already.endgameRows, ...endgameRows],
          gameIds: [...already.gameIds, ...ids],
        };
        options?.onPartial?.(
          buildVaultPayloadFromRows(
            merged,
            vault,
            games.length,
            already.gameIds.length + scanned
          )
        );
      },
    });

    if (options?.signal?.cancelled) {
      const partial = sliceHeuristicStoreForPeriod(store, games);
      return buildVaultPayloadFromRows(
        partial,
        vault,
        games.length,
        partial.gameIds.length
      );
    }

    store = mergeHeuristicRowsIntoStore(
      store,
      newOpening,
      newMiddlegame,
      newEndgame,
      newIds
    );
    await saveHeuristicStore(filters, store);

    const rows = sliceHeuristicStoreForPeriod(store, games);
    await writeCache(key, rows);

    const payload = buildVaultPayloadFromRows(rows, vault, games.length);
    await writeCache(analyticsOpeningPhaseCacheKey(filters), payload.opening);
    await writeCache(
      analyticsMiddlegamePhaseCacheKey(filters),
      payload.middlegame
    );
    await writeCache(analyticsEndgamePhaseCacheKey(filters), payload.endgame);

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
  let store = await loadHeuristicStore(filters);
  const seeded = await seedHeuristicStoreFromRelatedCaches(filters, store);
  if (seeded !== store) {
    store = seeded;
    await saveHeuristicStore(filters, store);
  }
  const rows = sliceHeuristicStoreForPeriod(store, list);
  if (!rows.gameIds.length) {
    const key = analyticsVaultHeuristicsCacheKey(filters);
    const cached = await readCache<PeriodHeuristicCache>(
      key,
      STUDY_ANALYSIS_TTL_MS
    );
    if (
      !cached?.openingRows?.length ||
      !cached.gameIds?.length ||
      cached.middlegameRows == null
    ) {
      return null;
    }
    const vault = await loadPermanentEvalStore(filters);
    const payload = buildVaultPayloadFromRows(cached, vault, list.length);
    await writeCache(analyticsOpeningPhaseCacheKey(filters), payload.opening);
    await writeCache(
      analyticsMiddlegamePhaseCacheKey(filters),
      payload.middlegame
    );
    await writeCache(analyticsEndgamePhaseCacheKey(filters), payload.endgame);
    return {
      opening: payload.opening,
      middlegame: payload.middlegame,
      endgame: payload.endgame,
    };
  }

  const vault = await loadPermanentEvalStore(filters);
  const payload = buildVaultPayloadFromRows(rows, vault, list.length);
  await writeCache(analyticsOpeningPhaseCacheKey(filters), payload.opening);
  await writeCache(
    analyticsMiddlegamePhaseCacheKey(filters),
    payload.middlegame
  );
  await writeCache(analyticsEndgamePhaseCacheKey(filters), payload.endgame);
  return {
    opening: payload.opening,
    middlegame: payload.middlegame,
    endgame: payload.endgame,
  };
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
      const cached = await readCache<RecapResponse>(
        key,
        analyticsTtlMs(filters)
      );
      if (cached) return cached;
    }
    const session = await ensureSession(filters, forceNetwork);
    return session.recap;
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
        const cached = await readCache<InsightsResponse>(
          key,
          analyticsTtlMs(filters)
        );
        if (cached) return cached;
      }
      const session = await ensureSession(filters, forceNetwork);
      return session.insights;
    }
  );
}
