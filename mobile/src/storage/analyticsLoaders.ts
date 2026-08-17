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
  studyGamesHaveMoveSources,
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
  withoutSpeedFilter,
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

/** Replace one game's Metrics-tab heuristics with a more accurate Games-analyze pass. */
export async function upsertHeuristicGame(
  filters: Pick<QueryFilters, "username" | "platform">,
  gameId: string,
  entry: HeuristicGameEntry
): Promise<void> {
  const id = String(gameId || "").trim();
  if (!id || !filters.username?.trim()) return;
  if (!entry.opening || !entry.middlegame || !entry.endgame) return;
  const store = await loadHeuristicStore(filters);
  store.games[id] = {
    opening: entry.opening,
    middlegame: entry.middlegame,
    endgame: entry.endgame,
  };
  await saveHeuristicStore(filters, store);
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
  if (
    from &&
    to &&
    String(from).slice(0, 10) === String(to).slice(0, 10)
  ) {
    return INSIGHTS_RECENT_TTL_MS;
  }
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
    if (!studyGamesHaveMoveSources(cached)) continue;
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

function filterStudyGamesByView(
  games: StudyGame[],
  filters: QueryFilters
): StudyGame[] {
  if (!filters.speed && !filters.color && !filters.result) {
    return games;
  }
  return toStudyGameList(
    filterNormalizedGames(games as NormalizedGame[], filters)
  );
}

function derivedMatchesGames(
  recap: RecapResponse | null | undefined,
  insights: InsightsResponse | null | undefined,
  gamesCount: number
): boolean {
  if (!recap || !insights) return false;
  const recapN = Number(recap.meta?.games_count ?? -1);
  const insightsN = Number(insights.meta?.games_count ?? -1);
  return recapN === gamesCount && insightsN === gamesCount;
}

async function bundleFromUnifiedStore(
  period: QueryFilters,
  options?: { rebuildDerived?: boolean }
): Promise<SessionBundle | null> {
  await yieldForUi({ heavy: true });
  const stored = await loadLocalGamesPage(period, {
    network: false,
    limit: GAMES_FIRST_PAGE_SIZE,
    offset: 0,
  });
  if (!stored.allFiltered.length) return null;
  const games = toStudyGameList(stored.allFiltered);
  const allFiltered = stored.allFiltered;
  const gamesCount = games.length;

  if (!options?.rebuildDerived) {
    const ttl = analyticsTtlMs(period);
    const [recap, insights] = await Promise.all([
      readCache<RecapResponse>(analyticsRecapCacheKey(period), ttl),
      readCache<InsightsResponse>(analyticsInsightsCacheKey(period), ttl),
    ]);
    if (derivedMatchesGames(recap, insights, gamesCount)) {
      return {
        games,
        recap: recap!,
        insights: insights!,
      };
    }
  }

  await yieldForUi({ heavy: true });
  const recap = buildLocalRecap(period, allFiltered);
  await yieldForUi({ heavy: true });
  const insights = buildLocalInsights(period, allFiltered);
  return {
    games,
    recap,
    insights,
  };
}

export async function rebuildSessionDerived(
  filters: QueryFilters
): Promise<SessionBundle | null> {
  const period = withoutSpeedFilter(filters);
  const bundle = await bundleFromUnifiedStore(period, { rebuildDerived: true });
  if (!bundle) return null;
  await writeSessionCaches(period, bundle);
  return bundle;
}

export type SessionLoadMode = boolean | "recent";

export async function ensureSession(
  filters: QueryFilters,
  mode: SessionLoadMode = false
): Promise<SessionBundle> {
  const forceNetwork = mode === true;
  const pullRecent = mode === "recent" || forceNetwork;
  const period = withoutSpeedFilter(filters);
  const fk = filtersKey(period);
  const inflightMode = forceNetwork ? "force" : pullRecent ? "recent" : "soft";
  return takeInflight(`session:${fk}:${inflightMode}`, async () => {
    if (!period.username.trim()) {
      const bundle: SessionBundle = {
        games: [],
        recap: emptyRecap(period),
        insights: emptyInsights(period),
      };
      return bundle;
    }

    if (!pullRecent) {
      const ttl = analyticsTtlMs(period);
      const gamesKey = analyticsStudyGamesCacheKey(period);
      const [cachedGames, cachedRecap, cachedInsights] = await Promise.all([
        readCache<StudyGame[]>(gamesKey, Math.max(ttl, GAMES_TTL_MS)),
        readCache<RecapResponse>(analyticsRecapCacheKey(period), ttl),
        readCache<InsightsResponse>(analyticsInsightsCacheKey(period), ttl),
      ]);
      if (
        cachedGames?.length &&
        studyGamesHaveMoveSources(cachedGames) &&
        derivedMatchesGames(cachedRecap, cachedInsights, cachedGames.length)
      ) {
        return {
          games: cachedGames,
          recap: cachedRecap!,
          insights: cachedInsights!,
        };
      }

      const fromStore = await bundleFromUnifiedStore(period, {
        rebuildDerived: false,
      });
      if (fromStore) {
        if (studyGamesHaveMoveSources(fromStore.games)) {
          await writeSessionCaches(period, fromStore);
        }
        return fromStore;
      }
      const remeshed = await tryRemeshSessionFromRelated(period);
      if (remeshed) return remeshed;

      // Soft never hits network — pull/force own that. Open UI from empty.
      return {
        games: [],
        recap: emptyRecap(period),
        insights: emptyInsights(period),
      };
    }

    await yieldForUi({ heavy: true });
    await loadLocalGamesPage(period, {
      force: forceNetwork,
      network: true,
      limit: GAMES_FIRST_PAGE_SIZE,
      offset: 0,
    });
    await yieldForUi({ heavy: true });
    const fromStore = await bundleFromUnifiedStore(period, {
      rebuildDerived: true,
    });
    if (fromStore) {
      await writeSessionCaches(period, fromStore);
      return fromStore;
    }
    return {
      games: [],
      recap: emptyRecap(period),
      insights: emptyInsights(period),
    };
  });
}

export async function ensureStudyGames(
  filters: QueryFilters,
  mode: SessionLoadMode = false
): Promise<StudyGame[]> {
  const forceNetwork = mode === true;
  const pullRecent = mode === "recent" || forceNetwork;
  const period = withoutSpeedFilter(filters);
  const fk = filtersKey(filters);
  const inflightMode = forceNetwork ? "force" : pullRecent ? "recent" : "soft";
  return takeInflight(`games:${fk}:${inflightMode}`, async () => {
    if (!filters.username.trim()) return [];
    const session = await ensureSession(
      period,
      forceNetwork ? true : pullRecent ? "recent" : false
    );
    return filterStudyGamesByView(session.games, filters);
  });
}

export async function ensureStudyGamesUpTo(
  filters: QueryFilters,
  maxGames = GLOBAL_MAX_GAMES,
  forceNetwork = false
): Promise<StudyGame[]> {
  const period = withoutSpeedFilter(filters);
  const fk = filtersKey(filters);
  const cap = Math.max(0, Math.min(maxGames, GAMES_PAGE_SIZE));
  return takeInflight(`games-up-to:${fk}:${cap}:${forceNetwork}`, async () => {
    if (!filters.username.trim()) return [];
    if (!forceNetwork) {
      const stored = await loadLocalGamesPage(filters, {
        network: false,
        limit: cap,
        offset: 0,
      });
      const fromStore = toStudyGameList(stored.allFiltered.slice(0, cap));
      if (fromStore.length) {
        if (!filters.speed && !filters.color && !filters.result) {
          await writeCache(analyticsStudyGamesCacheKey(period), fromStore);
        }
        return fromStore;
      }
      return [];
    }
    const page = await loadLocalGamesPage(filters, {
      force: forceNetwork,
      network: true,
      limit: cap,
      offset: 0,
    });
    const games = toStudyGameList(page.allFiltered.slice(0, cap));
    if (!filters.speed && !filters.color && !filters.result) {
      await writeCache(analyticsStudyGamesCacheKey(period), games);
    }
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
  const period = withoutSpeedFilter(filters);
  const key = analyticsRecapCacheKey(period);
  return takeInflight(`recap:${filtersKey(filters)}:${forceNetwork}`, async () => {
    const session = await ensureSession(period, forceNetwork);
    if (!filters.speed && !filters.color && !filters.result) {
      if (!forceNetwork) {
        const cached = await readCache<RecapResponse>(
          key,
          analyticsTtlMs(period)
        );
        if (cached) return cached;
      }
      return session.recap;
    }
    const filtered = filterNormalizedGames(
      session.games as NormalizedGame[],
      filters
    );
    return buildLocalRecap(filters, filtered);
  });
}

export async function ensureInsights(
  filters: QueryFilters,
  forceNetwork = false
): Promise<InsightsResponse> {
  const period = withoutSpeedFilter(filters);
  const key = analyticsInsightsCacheKey(period);
  return takeInflight(
    `insights:${filtersKey(filters)}:${forceNetwork}`,
    async () => {
      const session = await ensureSession(period, forceNetwork);
      if (!filters.speed && !filters.color && !filters.result) {
        if (!forceNetwork) {
          const cached = await readCache<InsightsResponse>(
            key,
            analyticsTtlMs(period)
          );
          if (cached) return cached;
        }
        return session.insights;
      }
      const filtered = filterNormalizedGames(
        session.games as NormalizedGame[],
        filters
      );
      return buildLocalInsights(filters, filtered);
    }
  );
}
