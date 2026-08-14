import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { InteractionManager } from "react-native";
import type { InsightsResponse, RecapResponse } from "../api/types";
import type { StudyGame } from "../engine/analyzeMistakes";
import type { OpeningMixStats } from "../engine/openingMix";
import type { StyleMetricsAggregate } from "../engine/styleMetrics";
import { useAuth } from "./AuthContext";
import { useFilters } from "./FilterContext";
import {
  ensureOpeningMix,
  ensureSession,
  ensureStyleMetrics,
  ensureVaultMetrics,
  rebuildSessionDerived,
  remeshVaultFromBucket,
  type EndgamePhasePayload,
  type MiddlegamePhasePayload,
  type OpeningPhasePayload,
} from "../storage/analyticsLoaders";
import {
  GLOBAL_MAX_GAMES,
} from "../engine/analysisConfig";
import {
  markHeuristicsComplete,
  resetBackgroundWork,
} from "../engine/backgroundWork";
import { agentLog } from "../debug/agentLog";
import { loadBaselineStore, type BaselineStore } from "../data/baselines";
import type { NormalizedGame } from "../data/platformGames";
import {
  buildLocalInsights,
  buildLocalRecap,
} from "../engine/localRecap";
import {
  analyticsPeriodKey,
  studyFiltersKey,
  withoutSpeedFilter,
} from "../storage/studyCacheKeys";

function sortRecentGames(games: StudyGame[]): StudyGame[] {
  return [...games].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
}

function gameInDateRange(
  createdAt: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined
): boolean {
  if (!dateFrom && !dateTo) return true;
  const day = String(createdAt || "").slice(0, 10);
  if (!day) return false;
  const fromDay = dateFrom ? String(dateFrom).slice(0, 10) : "";
  const toDay = dateTo ? String(dateTo).slice(0, 10) : "";
  if (fromDay && day < fromDay) return false;
  if (toDay && day > toDay) return false;
  return true;
}

function filterPeriodGamesBySpeed(
  games: StudyGame[],
  speed: string | null | undefined
): StudyGame[] {
  if (!speed) return games;
  const want = speed.toLowerCase();
  return games.filter(
    (g) => String(g.speed || "").toLowerCase() === want
  );
}

type AnalyticsState = {
  games: StudyGame[];
  gamesLoading: boolean;
  mix: OpeningMixStats | null;
  style: StyleMetricsAggregate | null;
  styleScanned: number;
  styleTotal: number;
  styleComplete: boolean;
  openingPhase: OpeningPhasePayload | null;
  openingPhaseLoading: boolean;
  middlegamePhase: MiddlegamePhasePayload | null;
  middlegamePhaseLoading: boolean;
  endgamePhase: EndgamePhasePayload | null;
  endgamePhaseLoading: boolean;
  recap: RecapResponse | null;
  insights: InsightsResponse | null;
  baselines: BaselineStore | null;
  sessionKey: string | null;
  metricsReady: boolean;
  metricsScanned: number;
  metricsTotal: number;
  refreshAnalytics: (mode?: boolean | "pull") => Promise<void>;
  requestVaultMetrics: (force?: boolean) => void;
};

const AnalyticsContext = createContext<AnalyticsState | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { queryFilters, refreshToken } = useFilters();
  const [games, setGames] = useState<StudyGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [mix, setMix] = useState<OpeningMixStats | null>(null);
  const [style, setStyle] = useState<StyleMetricsAggregate | null>(null);
  const [styleScanned, setStyleScanned] = useState(0);
  const [styleTotal, setStyleTotal] = useState(0);
  const [styleComplete, setStyleComplete] = useState(false);
  const [openingPhase, setOpeningPhase] = useState<OpeningPhasePayload | null>(
    null
  );
  const [openingPhaseLoading, setOpeningPhaseLoading] = useState(true);
  const [middlegamePhase, setMiddlegamePhase] =
    useState<MiddlegamePhasePayload | null>(null);
  const [middlegamePhaseLoading, setMiddlegamePhaseLoading] = useState(true);
  const [endgamePhase, setEndgamePhase] = useState<EndgamePhasePayload | null>(
    null
  );
  const [endgamePhaseLoading, setEndgamePhaseLoading] = useState(true);
  const [recap, setRecap] = useState<RecapResponse | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [baselines, setBaselines] = useState<BaselineStore | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const gamesRef = useRef<StudyGame[]>([]);
  const periodGamesRef = useRef<StudyGame[]>([]);
  const recapSignalRef = useRef({ cancelled: false });
  const vaultSignalRef = useRef({ cancelled: false });
  const sessionKeyRef = useRef<string | null>(null);
  const hydratedPeriodKeyRef = useRef<string | null>(null);
  const lastStyleRefreshKey = useRef<string | null>(null);
  const vaultRequestedRef = useRef(false);
  const vaultRunningRef = useRef(false);
  const vaultRunIdRef = useRef(0);
  const metricsRunIdRef = useRef(0);
  const coldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshVaultMetrics = useCallback(
    async (loadedGames: StudyGame[], options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      if (vaultRunningRef.current && !force) return;
      const runId = ++vaultRunIdRef.current;
      vaultRunningRef.current = true;
      vaultSignalRef.current.cancelled = true;
      vaultSignalRef.current = { cancelled: false };
      const signal = vaultSignalRef.current;
      const scoped = sortRecentGames(loadedGames);
      setOpeningPhaseLoading(true);
      setMiddlegamePhaseLoading(true);
      setEndgamePhaseLoading(true);
      // #region agent log
      const vaultT0 = Date.now();
      agentLog("A", "AnalyticsContext.tsx:refreshVaultMetrics", "vault heuristics start", {
        force,
        games: scoped.length,
      });
      // #endregion

      try {
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });
        if (signal.cancelled || vaultRunIdRef.current !== runId) return;

        const payload = await ensureVaultMetrics(queryFilters, {
          games: scoped,
          force,
          signal,
          onPartial: (partial) => {
            if (signal.cancelled || vaultRunIdRef.current !== runId) return;
            setOpeningPhase(partial.opening);
            setMiddlegamePhase(partial.middlegame);
            setEndgamePhase(partial.endgame);
            const openingDone =
              partial.opening.totalGames === 0 ||
              partial.opening.analyzedCount >= partial.opening.totalGames;
            const middlegameDone =
              partial.middlegame.totalGames === 0 ||
              partial.middlegame.analyzedCount >= partial.middlegame.totalGames;
            const endgameDone =
              partial.endgame.totalGames === 0 ||
              partial.endgame.analyzedCount >= partial.endgame.totalGames;
            setOpeningPhaseLoading(!openingDone);
            setMiddlegamePhaseLoading(!middlegameDone);
            setEndgamePhaseLoading(!endgameDone);
            // #region agent log
            if (
              partial.opening.analyzedCount <= 3 ||
              partial.opening.analyzedCount % 20 === 0 ||
              partial.opening.analyzedCount >= partial.opening.totalGames
            ) {
              agentLog("C", "AnalyticsContext.tsx:vaultPartial", "heuristic partial", {
                analyzed: partial.opening.analyzedCount,
                total: partial.opening.totalGames,
                elapsedMs: Date.now() - vaultT0,
              });
            }
            // #endregion
          },
        });
        if (signal.cancelled || vaultRunIdRef.current !== runId) return;
        setOpeningPhase(payload.opening);
        setOpeningPhaseLoading(false);
        setMiddlegamePhase(payload.middlegame);
        setMiddlegamePhaseLoading(false);
        setEndgamePhase(payload.endgame);
        setEndgamePhaseLoading(false);
        markHeuristicsComplete();
        // #region agent log
        agentLog("C", "AnalyticsContext.tsx:heuristicsDone", "single-pass heuristics done", {
          opening: payload.opening.analyzedCount,
          middlegame: payload.middlegame.analyzedCount,
          endgame: payload.endgame.analyzedCount,
          styleScanned: payload.style.scanned,
          elapsedMs: Date.now() - vaultT0,
        });
        // #endregion
      } finally {
        if (vaultRunIdRef.current === runId) {
          vaultRunningRef.current = false;
        }
      }
    },
    [queryFilters]
  );

  const clearPhaseMetrics = useCallback(() => {
    setMix(null);
    setStyle(null);
    setStyleScanned(0);
    setStyleTotal(0);
    setStyleComplete(true);
    setOpeningPhase(null);
    setMiddlegamePhase(null);
    setEndgamePhase(null);
    setOpeningPhaseLoading(false);
    setMiddlegamePhaseLoading(false);
    setEndgamePhaseLoading(false);
    markHeuristicsComplete();
  }, []);

  const remeshViewMetrics = useCallback(
    async (
      filters: typeof queryFilters,
      loadedGames: StudyGame[],
      viewKey: string
    ) => {
      const scoped = sortRecentGames(loadedGames);
      if (sessionKeyRef.current !== viewKey) return false;
      if (!scoped.length) {
        clearPhaseMetrics();
        return true;
      }
      setOpeningPhaseLoading(true);
      setMiddlegamePhaseLoading(true);
      setEndgamePhaseLoading(true);
      setStyleComplete(false);
      setStyleTotal(Math.min(scoped.length, GLOBAL_MAX_GAMES));
      const styleGames = scoped.slice(0, GLOBAL_MAX_GAMES);
      const [remeshed, styleResolved, mixData] = await Promise.all([
        remeshVaultFromBucket(filters, scoped),
        ensureStyleMetrics(filters, { games: styleGames }),
        ensureOpeningMix(filters, scoped, false),
      ]);
      if (sessionKeyRef.current !== viewKey) return false;
      if (remeshed) {
        setOpeningPhase(remeshed.opening);
        setOpeningPhaseLoading(false);
        setMiddlegamePhase(remeshed.middlegame);
        setMiddlegamePhaseLoading(false);
        setEndgamePhase(remeshed.endgame);
        setEndgamePhaseLoading(false);
      } else {
        setOpeningPhase(null);
        setMiddlegamePhase(null);
        setEndgamePhase(null);
        setOpeningPhaseLoading(false);
        setMiddlegamePhaseLoading(false);
        setEndgamePhaseLoading(false);
      }
      setStyle(styleResolved.style);
      setStyleScanned(styleResolved.scanned);
      setStyleTotal(styleResolved.total);
      setStyleComplete(styleResolved.periodComplete);
      setMix(mixData);
      lastStyleRefreshKey.current = viewKey;
      // #region agent log
      agentLog("A", "AnalyticsContext.tsx:remeshViewMetrics", "filter remesh only", {
        viewKey,
        games: scoped.length,
        remeshed: Boolean(remeshed),
        opening: remeshed?.opening.analyzedCount ?? 0,
        styleScanned: styleResolved.scanned,
      });
      // #endregion
      return Boolean(remeshed);
    },
    [clearPhaseMetrics]
  );

  const refreshVaultRemesh = useCallback(
    async (loadedGames: StudyGame[]) => {
      const viewKey = sessionKeyRef.current || studyFiltersKey(queryFilters);
      return remeshViewMetrics(queryFilters, loadedGames, viewKey);
    },
    [queryFilters, remeshViewMetrics]
  );

  const requestVaultMetrics = useCallback(
    (force = false) => {
      vaultRequestedRef.current = true;
      // #region agent log
      agentLog("F", "AnalyticsContext.tsx:requestVaultMetrics", "vault requested", {
        force,
        games: gamesRef.current.length,
      });
      // #endregion
      const list = gamesRef.current;
      if (!list.length) return;
      if (force) {
        void refreshVaultMetrics(list, { force: true });
        return;
      }
      void refreshVaultRemesh(list);
    },
    [refreshVaultMetrics, refreshVaultRemesh]
  );

  const applyFilterView = useCallback(
    (filters: typeof queryFilters, periodGames: StudyGame[]) => {
      const viewKey = studyFiltersKey(filters);
      const dateFiltered =
        filters.dateFrom || filters.dateTo
          ? periodGames.filter((game) =>
              gameInDateRange(
                String(game.created_at || ""),
                filters.dateFrom,
                filters.dateTo
              )
            )
          : periodGames;
      const filtered = sortRecentGames(
        filterPeriodGamesBySpeed(dateFiltered, filters.speed)
      );
      const asNorm = filtered as NormalizedGame[];
      sessionKeyRef.current = viewKey;
      setSessionKey(viewKey);
      gamesRef.current = filtered;
      setGames(filtered);
      setRecap(buildLocalRecap(filters, asNorm));
      setInsights(buildLocalInsights(filters, asNorm));
      setGamesLoading(false);
      lastStyleRefreshKey.current = null;
      vaultSignalRef.current.cancelled = true;
      vaultSignalRef.current = { cancelled: false };
      vaultRunIdRef.current += 1;
      vaultRunningRef.current = false;
      if (!filtered.length) {
        clearPhaseMetrics();
        return;
      }
      vaultRequestedRef.current = true;
      void remeshViewMetrics(filters, filtered, viewKey);
    },
    [clearPhaseMetrics, remeshViewMetrics]
  );

  const lastRefreshTokenRef = useRef(refreshToken);

  const refreshAnalytics = useCallback(
    async (mode: boolean | "pull" = false) => {
      const pullOnly = mode === "pull";
      const forceNetwork = mode === true;
      const periodKey = analyticsPeriodKey(queryFilters);
      const viewKey = studyFiltersKey(queryFilters);
      const prevViewKey = sessionKeyRef.current;
      const prevPeriodKey = hydratedPeriodKeyRef.current;
      const periodChanged =
        prevPeriodKey !== null && prevPeriodKey !== periodKey;

      if (pullOnly) {
        try {
          const periodFilters = withoutSpeedFilter(queryFilters);
          const prevIds = new Set(
            periodGamesRef.current.map((g) => String(g.id))
          );
          const session = await ensureSession(periodFilters, "recent");
          const periodGames = sortRecentGames(session.games);
          const newGames = periodGames.filter(
            (g) => !prevIds.has(String(g.id))
          );
          periodGamesRef.current = periodGames;
          hydratedPeriodKeyRef.current = periodKey;
          const viewGames = sortRecentGames(
            filterPeriodGamesBySpeed(periodGames, queryFilters.speed)
          );
          // #region agent log
          agentLog("E", "AnalyticsContext.tsx:refreshAnalytics", "pull recent games", {
            periodKey,
            viewKey,
            periodGames: periodGames.length,
            viewGames: viewGames.length,
            newGames: newGames.length,
            speed: queryFilters.speed || "all",
          });
          // #endregion
          sessionKeyRef.current = viewKey;
          setSessionKey(viewKey);
          gamesRef.current = viewGames;
          setGames(viewGames);
          setGamesLoading(false);
          lastStyleRefreshKey.current = viewKey;

          InteractionManager.runAfterInteractions(() => {
            if (recapSignalRef.current.cancelled) return;
            void (async () => {
              const derived = await rebuildSessionDerived(periodFilters);
              if (recapSignalRef.current.cancelled) return;
              if (derived) {
                const speedActive = Boolean(queryFilters.speed);
                setRecap(
                  speedActive
                    ? buildLocalRecap(queryFilters, viewGames as NormalizedGame[])
                    : derived.recap
                );
                setInsights(
                  speedActive
                    ? buildLocalInsights(
                        queryFilters,
                        viewGames as NormalizedGame[]
                      )
                    : derived.insights
                );
              }
              if (newGames.length && viewGames.length) {
                void refreshVaultMetrics(viewGames, { force: false });
                void ensureStyleMetrics(queryFilters, {
                  games: viewGames.slice(0, GLOBAL_MAX_GAMES),
                }).then((resolved) => {
                  if (sessionKeyRef.current !== viewKey) return;
                  setStyle(resolved.style);
                  setStyleScanned(resolved.scanned);
                  setStyleTotal(resolved.total);
                  setStyleComplete(resolved.periodComplete);
                });
                void ensureOpeningMix(queryFilters, viewGames, true).then(
                  (mixData) => {
                    if (sessionKeyRef.current !== viewKey) return;
                    setMix(mixData);
                  }
                );
              }
            })();
          });
        } catch {
          setGamesLoading(false);
        }
        return;
      }

      if (!forceNetwork && hydratedPeriodKeyRef.current === periodKey) {
        if (prevViewKey === viewKey) return;
        // #region agent log
        agentLog("E", "AnalyticsContext.tsx:refreshAnalytics", "speed-only remesh", {
          periodKey,
          viewKey,
          periodGames: periodGamesRef.current.length,
        });
        // #endregion
        applyFilterView(queryFilters, periodGamesRef.current);
        return;
      }

      const runId = ++metricsRunIdRef.current;
      recapSignalRef.current.cancelled = true;
      if (coldTimerRef.current) {
        clearTimeout(coldTimerRef.current);
        coldTimerRef.current = null;
      }
      recapSignalRef.current = { cancelled: false };
      const recapSignal = recapSignalRef.current;
      const sameUserPlatform =
        prevViewKey != null &&
        prevViewKey.split("|").slice(0, 2).join("|") ===
          viewKey.split("|").slice(0, 2).join("|");

      // #region agent log
      agentLog("E", "AnalyticsContext.tsx:refreshAnalytics", "session refresh start", {
        periodChanged,
        forceNetwork,
        periodKey,
        viewKey,
      });
      // #endregion

      sessionKeyRef.current = viewKey;
      setSessionKey(viewKey);
      setGamesLoading(true);
      lastStyleRefreshKey.current = null;

      if (periodChanged && !forceNetwork && sameUserPlatform) {
        const prevPeriodGames = periodGamesRef.current;
        const filteredPrev =
          prevPeriodGames.length &&
          (queryFilters.dateFrom || queryFilters.dateTo)
            ? sortRecentGames(
                prevPeriodGames.filter((game) =>
                  gameInDateRange(
                    String(game.created_at || ""),
                    queryFilters.dateFrom,
                    queryFilters.dateTo
                  )
                )
              )
            : prevPeriodGames.length
              ? sortRecentGames(prevPeriodGames)
              : [];
        if (filteredPrev.length) {
          periodGamesRef.current = filteredPrev;
          hydratedPeriodKeyRef.current = periodKey;
          applyFilterView(queryFilters, filteredPrev);
        } else {
          setOpeningPhaseLoading(true);
          setMiddlegamePhaseLoading(true);
          setEndgamePhaseLoading(true);
        }
        vaultSignalRef.current.cancelled = true;
        vaultSignalRef.current = { cancelled: false };
        vaultRunIdRef.current += 1;
        vaultRunningRef.current = false;
      } else if (forceNetwork || periodChanged) {
        hydratedPeriodKeyRef.current = null;
        resetBackgroundWork();
        vaultSignalRef.current.cancelled = true;
        vaultSignalRef.current = { cancelled: false };
        vaultRunIdRef.current += 1;
        vaultRunningRef.current = false;
        if (forceNetwork) {
          periodGamesRef.current = [];
          gamesRef.current = [];
          setGames([]);
        }
        setMix(null);
        setStyle(null);
        setStyleScanned(0);
        setStyleTotal(0);
        setStyleComplete(false);
        setOpeningPhase(null);
        setMiddlegamePhase(null);
        setEndgamePhase(null);
        setOpeningPhaseLoading(true);
        setMiddlegamePhaseLoading(true);
        setEndgamePhaseLoading(true);
        setRecap(null);
        setInsights(null);
        vaultRequestedRef.current = false;
      }

      try {
        const periodFilters = withoutSpeedFilter(queryFilters);
        const sessionT0 = Date.now();

        if (forceNetwork) {
          const session = await ensureSession(periodFilters, true);
          // #region agent log
          agentLog("E", "AnalyticsContext.tsx:refreshAnalytics", "ensureSession done", {
            ms: Date.now() - sessionT0,
            games: session.games.length,
            periodKey,
            mode: "force",
          });
          // #endregion
          if (metricsRunIdRef.current !== runId || recapSignal.cancelled) {
            if (metricsRunIdRef.current === runId) setGamesLoading(false);
            return;
          }

          const periodGames = sortRecentGames(session.games);
          periodGamesRef.current = periodGames;
          const viewGames = sortRecentGames(
            filterPeriodGamesBySpeed(periodGames, queryFilters.speed)
          );
          gamesRef.current = viewGames;
          setGames(viewGames);
          const speedActive = Boolean(queryFilters.speed);
          setRecap(
            speedActive
              ? buildLocalRecap(queryFilters, viewGames as NormalizedGame[])
              : session.recap
          );
          setInsights(
            speedActive
              ? buildLocalInsights(queryFilters, viewGames as NormalizedGame[])
              : session.insights
          );
          setGamesLoading(false);
          hydratedPeriodKeyRef.current = periodKey;
          lastStyleRefreshKey.current = viewKey;

          void loadBaselineStore(false).then((peerStore) => {
            if (metricsRunIdRef.current !== runId) return;
            if (peerStore) setBaselines(peerStore);
          });

          if (!viewGames.length) {
            clearPhaseMetrics();
            return;
          }

          vaultRequestedRef.current = true;
          setStyleTotal(Math.min(viewGames.length, GLOBAL_MAX_GAMES));
          void refreshVaultMetrics(viewGames, { force: false });
          void ensureOpeningMix(queryFilters, viewGames, false).then(
            (mixData) => {
              if (metricsRunIdRef.current !== runId) return;
              setMix(mixData);
            }
          );
          return;
        }

        const soft = await ensureSession(periodFilters, false);
        if (metricsRunIdRef.current !== runId || recapSignal.cancelled) {
          if (metricsRunIdRef.current === runId) setGamesLoading(false);
          return;
        }

        const softPeriod = sortRecentGames(soft.games);
        periodGamesRef.current = softPeriod;
        const softView = sortRecentGames(
          filterPeriodGamesBySpeed(softPeriod, queryFilters.speed)
        );
        const softHasGames = softView.length > 0;
        if (softHasGames) {
          gamesRef.current = softView;
          setGames(softView);
          setRecap(soft.recap);
          setInsights(soft.insights);
          setGamesLoading(false);
          hydratedPeriodKeyRef.current = periodKey;
          lastStyleRefreshKey.current = viewKey;
        }

        // #region agent log
        agentLog("E", "AnalyticsContext.tsx:refreshAnalytics", "soft paint done", {
          ms: Date.now() - sessionT0,
          games: softView.length,
          periodKey,
        });
        // #endregion

        void loadBaselineStore(false).then((peerStore) => {
          if (metricsRunIdRef.current !== runId) return;
          if (peerStore) setBaselines(peerStore);
        });

        const prevIds = new Set(softPeriod.map((g) => String(g.id)));
        const speedActive = Boolean(queryFilters.speed);
        const coldDelayMs = softHasGames ? 1800 : 0;
        if (coldTimerRef.current) clearTimeout(coldTimerRef.current);
        coldTimerRef.current = setTimeout(() => {
          coldTimerRef.current = null;
          InteractionManager.runAfterInteractions(() => {
            if (metricsRunIdRef.current !== runId || recapSignal.cancelled) {
              return;
            }
            void (async () => {
              try {
                const session = await ensureSession(periodFilters, "recent");
                if (metricsRunIdRef.current !== runId || recapSignal.cancelled) {
                  if (metricsRunIdRef.current === runId) setGamesLoading(false);
                  return;
                }

                const periodGames = sortRecentGames(session.games);
                const viewGames = sortRecentGames(
                  filterPeriodGamesBySpeed(periodGames, queryFilters.speed)
                );
                const newGames = periodGames.filter(
                  (g) => !prevIds.has(String(g.id))
                );
                const gamesChanged =
                  newGames.length > 0 ||
                  periodGames.length !== softPeriod.length;

                periodGamesRef.current = periodGames;
                gamesRef.current = viewGames;
                setGames(viewGames);
                setRecap(
                  speedActive
                    ? buildLocalRecap(
                        queryFilters,
                        viewGames as NormalizedGame[]
                      )
                    : session.recap
                );
                setInsights(
                  speedActive
                    ? buildLocalInsights(
                        queryFilters,
                        viewGames as NormalizedGame[]
                      )
                    : session.insights
                );
                setGamesLoading(false);
                hydratedPeriodKeyRef.current = periodKey;
                lastStyleRefreshKey.current = viewKey;

                // #region agent log
                agentLog(
                  "E",
                  "AnalyticsContext.tsx:coldBackground",
                  "recent merge done",
                  {
                    ms: Date.now() - sessionT0,
                    games: viewGames.length,
                    newGames: newGames.length,
                    gamesChanged,
                    periodKey,
                  }
                );
                // #endregion

                if (!viewGames.length) {
                  clearPhaseMetrics();
                  return;
                }

                if (!gamesChanged && softHasGames) {
                  setOpeningPhaseLoading(false);
                  setMiddlegamePhaseLoading(false);
                  setEndgamePhaseLoading(false);
                  if (!vaultRequestedRef.current) {
                    vaultRequestedRef.current = true;
                    lastStyleRefreshKey.current = viewKey;
                    void remeshViewMetrics(queryFilters, viewGames, viewKey);
                  }
                  return;
                }

                setOpeningPhaseLoading(true);
                setMiddlegamePhaseLoading(true);
                setEndgamePhaseLoading(true);

                vaultRequestedRef.current = true;
                lastStyleRefreshKey.current = viewKey;
                if (periodChanged && sameUserPlatform) {
                  await remeshViewMetrics(queryFilters, viewGames, viewKey);
                } else {
                  setStyleTotal(Math.min(viewGames.length, GLOBAL_MAX_GAMES));
                  void refreshVaultMetrics(viewGames, { force: false });
                  void ensureOpeningMix(queryFilters, viewGames, false).then(
                    (mixData) => {
                      if (metricsRunIdRef.current !== runId) return;
                      setMix(mixData);
                    }
                  );
                }

                // #region agent log
                agentLog(
                  "F",
                  "AnalyticsContext.tsx:coldBackground",
                  "insights + vault scheduled",
                  {
                    periodGames: periodGames.length,
                    viewGames: viewGames.length,
                    vaultRequested: vaultRequestedRef.current,
                  }
                );
                // #endregion
              } catch {
                if (metricsRunIdRef.current === runId) {
                  setGamesLoading(false);
                  setOpeningPhaseLoading(false);
                  setMiddlegamePhaseLoading(false);
                  setEndgamePhaseLoading(false);
                }
              }
            })();
          });
        }, coldDelayMs);
      } catch {
        if (metricsRunIdRef.current !== runId) return;
        setGamesLoading(false);
        setOpeningPhaseLoading(false);
        setMiddlegamePhaseLoading(false);
        setEndgamePhaseLoading(false);
      }
    },
    [
      queryFilters,
      refreshVaultMetrics,
      applyFilterView,
      remeshViewMetrics,
      clearPhaseMetrics,
    ]
  );

  useEffect(() => {
    if (!auth.ready) return;
    if (auth.isLoggedIn && !queryFilters.username.trim()) return;
    const force = lastRefreshTokenRef.current !== refreshToken;
    lastRefreshTokenRef.current = refreshToken;
    void refreshAnalytics(force);
    return () => {
      recapSignalRef.current.cancelled = true;
      if (coldTimerRef.current) {
        clearTimeout(coldTimerRef.current);
        coldTimerRef.current = null;
      }
    };
  }, [
    auth.ready,
    auth.isLoggedIn,
    queryFilters.username,
    refreshAnalytics,
    refreshToken,
  ]);

  useEffect(() => {
    if (!sessionKey || gamesLoading) return;
    if (!games.length) return;
    if (lastStyleRefreshKey.current === sessionKey) return;
    lastStyleRefreshKey.current = sessionKey;
    void refreshVaultRemesh(games);
  }, [sessionKey, games, gamesLoading, refreshVaultRemesh]);

  const noGames = !gamesLoading && games.length === 0;
  const openingReady =
    !!openingPhase &&
    !openingPhaseLoading &&
    (openingPhase.totalGames === 0 ||
      openingPhase.analyzedCount >= openingPhase.totalGames);
  const middlegameReady =
    !!middlegamePhase &&
    !middlegamePhaseLoading &&
    (middlegamePhase.totalGames === 0 ||
      middlegamePhase.analyzedCount >= middlegamePhase.totalGames);
  const endgameReady =
    !!endgamePhase &&
    !endgamePhaseLoading &&
    (endgamePhase.totalGames === 0 ||
      endgamePhase.analyzedCount >= endgamePhase.totalGames);

  const metricsTotal =
    openingPhase?.totalGames ||
    middlegamePhase?.totalGames ||
    endgamePhase?.totalGames ||
    0;

  const metricsScanned = Math.max(
    openingPhase?.analyzedCount ?? 0,
    middlegamePhase?.analyzedCount ?? 0,
    endgamePhase?.analyzedCount ?? 0
  );

  const metricsReady =
    !!insights &&
    !gamesLoading &&
    mix != null &&
    (noGames || (openingReady && middlegameReady && endgameReady));

  const value = useMemo<AnalyticsState>(
    () => ({
      games,
      gamesLoading,
      mix,
      style,
      styleScanned,
      styleTotal,
      styleComplete,
      openingPhase,
      openingPhaseLoading,
      middlegamePhase,
      middlegamePhaseLoading,
      endgamePhase,
      endgamePhaseLoading,
      recap,
      insights,
      baselines,
      sessionKey,
      metricsReady,
      metricsScanned,
      metricsTotal,
      refreshAnalytics,
      requestVaultMetrics,
    }),
    [
      games,
      gamesLoading,
      mix,
      style,
      styleScanned,
      styleTotal,
      styleComplete,
      openingPhase,
      openingPhaseLoading,
      middlegamePhase,
      middlegamePhaseLoading,
      endgamePhase,
      endgamePhaseLoading,
      recap,
      insights,
      baselines,
      sessionKey,
      metricsReady,
      metricsScanned,
      metricsTotal,
      refreshAnalytics,
      requestVaultMetrics,
    ]
  );

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics(): AnalyticsState {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) {
    throw new Error("useAnalytics must be used within AnalyticsProvider");
  }
  return ctx;
}
