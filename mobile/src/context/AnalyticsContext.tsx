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
import { useScanLog } from "./ScanLogContext";
import {
  ensureOpeningMix,
  ensureSession,
  ensureStyleMetrics,
  ensureVaultMetrics,
  remeshVaultFromBucket,
  type EndgamePhasePayload,
  type MiddlegamePhasePayload,
  type OpeningPhasePayload,
} from "../storage/analyticsLoaders";
import {
  GLOBAL_FIRST_SCAN_MAX_GAMES,
  GLOBAL_MAX_GAMES,
} from "../engine/analysisConfig";
import {
  markHeuristicsComplete,
  resetBackgroundWork,
} from "../engine/backgroundWork";
import { agentLog } from "../debug/agentLog";
import { loadBaselineStore, type BaselineStore } from "../data/baselines";
import { studyFiltersKey } from "../storage/studyCacheKeys";
import { HEURISTICS_FIRST_WAVE_GAMES } from "../engine/analysisConfig";

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
  if (dateFrom && day < dateFrom) return false;
  if (dateTo && day > dateTo) return false;
  return true;
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
  refreshAnalytics: (forceNetwork?: boolean) => Promise<void>;
  requestVaultMetrics: (force?: boolean) => void;
};

const AnalyticsContext = createContext<AnalyticsState | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { queryFilters, refreshToken } = useFilters();
  const { phase } = useScanLog();
  const scanReady = phase === "done" || phase === "error";
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
  const recapSignalRef = useRef({ cancelled: false });
  const vaultSignalRef = useRef({ cancelled: false });
  const sessionKeyRef = useRef<string | null>(null);
  const hydratedKeyRef = useRef<string | null>(null);
  const lastStyleRefreshKey = useRef<string | null>(null);
  const vaultRequestedRef = useRef(false);
  const vaultRunningRef = useRef(false);
  const vaultRunIdRef = useRef(0);
  const metricsRunIdRef = useRef(0);

  const refreshStyleFromBucket = useCallback(
    async (loadedGames: StudyGame[]) => {
      const scoped = sortRecentGames(loadedGames).slice(0, GLOBAL_MAX_GAMES);
      const resolved = await ensureStyleMetrics(queryFilters, {
        games: scoped,
      });
      setStyle(resolved.style);
      setStyleScanned(resolved.scanned);
      setStyleTotal(resolved.total);
      setStyleComplete(resolved.periodComplete);
      // #region agent log
      agentLog("A", "AnalyticsContext.tsx:styleFromBucket", "style loaded from vault", {
        scanned: resolved.scanned,
        total: resolved.total,
        complete: resolved.periodComplete,
      });
      // #endregion
    },
    [queryFilters]
  );

  const refreshVaultRemesh = useCallback(
    async (loadedGames: StudyGame[]) => {
      const scoped = sortRecentGames(loadedGames);
      const remeshed = await remeshVaultFromBucket(queryFilters, scoped);
      if (!remeshed) return;
      setOpeningPhase(remeshed.opening);
      setOpeningPhaseLoading(false);
      setMiddlegamePhase(remeshed.middlegame);
      setMiddlegamePhaseLoading(false);
      setEndgamePhase(remeshed.endgame);
      setEndgamePhaseLoading(false);
      // #region agent log
      agentLog("A", "AnalyticsContext.tsx:remeshVault", "vault remesh from bucket", {
        opening: remeshed.opening.analyzedCount,
        middlegame: remeshed.middlegame.analyzedCount,
        endgame: remeshed.endgame.analyzedCount,
      });
      // #endregion
    },
    [queryFilters]
  );

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
            const waveTarget = Math.min(
              HEURISTICS_FIRST_WAVE_GAMES,
              partial.opening.totalGames || HEURISTICS_FIRST_WAVE_GAMES
            );
            if (partial.opening.analyzedCount >= waveTarget) {
              markHeuristicsComplete();
            }
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
      void refreshVaultMetrics(list, { force });
    },
    [refreshVaultMetrics]
  );

  const refreshAnalytics = useCallback(
    async (_forceNetwork = false) => {
      const runId = ++metricsRunIdRef.current;
      recapSignalRef.current.cancelled = true;
      recapSignalRef.current = { cancelled: false };
      const recapSignal = recapSignalRef.current;
      const key = studyFiltersKey(queryFilters);
      const prevKey = sessionKeyRef.current;
      const sessionChanged = prevKey !== null && prevKey !== key;

      if (hydratedKeyRef.current === key) {
        return;
      }

      // #region agent log
      agentLog("E", "AnalyticsContext.tsx:refreshAnalytics", "session refresh start", {
        sessionChanged,
        key,
      });
      // #endregion

      sessionKeyRef.current = key;
      setSessionKey(key);
      setGamesLoading(true);
      setOpeningPhaseLoading(true);
      setMiddlegamePhaseLoading(true);
      setEndgamePhaseLoading(true);
      lastStyleRefreshKey.current = null;
      if (sessionChanged) {
        hydratedKeyRef.current = null;
        resetBackgroundWork();
        vaultSignalRef.current.cancelled = true;
        vaultSignalRef.current = { cancelled: false };
        const sameIdentity =
          prevKey != null &&
          prevKey.split("|").slice(0, 4).join("|") ===
            key.split("|").slice(0, 4).join("|");
        const prevGames = gamesRef.current;
        const filteredPrev =
          sameIdentity &&
          prevGames.length &&
          (queryFilters.dateFrom || queryFilters.dateTo)
            ? sortRecentGames(
                prevGames.filter((game) =>
                  gameInDateRange(
                    String(game.created_at || ""),
                    queryFilters.dateFrom,
                    queryFilters.dateTo
                  )
                )
              )
            : [];
        if (filteredPrev.length) {
          gamesRef.current = filteredPrev;
          setGames(filteredPrev);
        } else {
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
        setRecap(null);
        setInsights(null);
        vaultRequestedRef.current = false;
      }

      try {
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });
        if (metricsRunIdRef.current !== runId) return;
        const [session, peerStore] = await Promise.all([
          ensureSession(queryFilters, false),
          loadBaselineStore(false),
        ]);
        if (metricsRunIdRef.current !== runId || recapSignal.cancelled) return;

        const periodGames = sortRecentGames(session.games);
        gamesRef.current = periodGames;
        setGames(periodGames);
        setRecap(session.recap);
        setInsights(session.insights);
        if (peerStore) setBaselines(peerStore);
        setGamesLoading(false);
        if (!periodGames.length) {
          markHeuristicsComplete();
          setOpeningPhaseLoading(false);
          setMiddlegamePhaseLoading(false);
          setEndgamePhaseLoading(false);
        }
        setStyleTotal(Math.min(periodGames.length, GLOBAL_MAX_GAMES));
        const evalQueue = Math.min(
          periodGames.length,
          GLOBAL_FIRST_SCAN_MAX_GAMES
        );

        const mixData = await ensureOpeningMix(
          queryFilters,
          periodGames,
          false
        );
        if (metricsRunIdRef.current !== runId) return;
        setMix(mixData);
        hydratedKeyRef.current = key;

        // #region agent log
        agentLog(
          "F",
          "AnalyticsContext.tsx:refreshAnalytics",
          "session bundle done, starting vault",
          {
            periodGames: periodGames.length,
            evalQueue,
            vaultRequested: vaultRequestedRef.current,
          }
        );
        // #endregion

        vaultRequestedRef.current = true;
        void refreshVaultMetrics(periodGames, { force: false });
      } catch {
        if (metricsRunIdRef.current !== runId) return;
        setGamesLoading(false);
        setOpeningPhaseLoading(false);
        setMiddlegamePhaseLoading(false);
        setEndgamePhaseLoading(false);
      }
    },
    [queryFilters, refreshVaultMetrics]
  );

  useEffect(() => {
    if (!auth.ready) return;
    void refreshAnalytics(false);
    return () => {
      recapSignalRef.current.cancelled = true;
    };
  }, [auth.ready, refreshAnalytics, refreshToken]);

  useEffect(() => {
    if (!scanReady || !sessionKey || gamesLoading) return;
    if (!games.length) return;
    if (lastStyleRefreshKey.current === sessionKey) return;
    lastStyleRefreshKey.current = sessionKey;
    void refreshStyleFromBucket(games);
    void refreshVaultRemesh(games);
  }, [
    scanReady,
    sessionKey,
    games,
    gamesLoading,
    refreshStyleFromBucket,
    refreshVaultRemesh,
  ]);

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

  const metricsTotal = Math.max(
    openingPhase?.totalGames ?? 0,
    middlegamePhase?.totalGames ?? 0,
    endgamePhase?.totalGames ?? 0,
    styleTotal,
    games.length,
    0
  );

  const metricsScanned = useMemo(() => {
    const parts: number[] = [];
    if (openingPhase) parts.push(openingPhase.analyzedCount);
    if (middlegamePhase) parts.push(middlegamePhase.analyzedCount);
    if (endgamePhase) parts.push(endgamePhase.analyzedCount);
    if (!parts.length) return 0;
    return Math.min(...parts);
  }, [openingPhase, middlegamePhase, endgamePhase]);

  const metricsReady =
    !!insights &&
    !gamesLoading &&
    mix != null &&
    (noGames || (openingReady && middlegameReady && endgameReady));

  useEffect(() => {
    // #region agent log
    const id = setInterval(() => {
      agentLog("D", "AnalyticsContext.tsx:heartbeat", "js heartbeat", {
        metricsReady,
        styleComplete,
        openingLoading: openingPhaseLoading,
        middlegameLoading: middlegamePhaseLoading,
        endgameLoading: endgamePhaseLoading,
        styleScanned,
        styleTotal,
        openingAnalyzed: openingPhase?.analyzedCount ?? null,
        middlegameAnalyzed: middlegamePhase?.analyzedCount ?? null,
        endgameAnalyzed: endgamePhase?.analyzedCount ?? null,
        scanPhase: phase,
      });
    }, 2000);
    return () => clearInterval(id);
    // #endregion
  }, [
    metricsReady,
    styleComplete,
    openingPhaseLoading,
    middlegamePhaseLoading,
    endgamePhaseLoading,
    styleScanned,
    styleTotal,
    openingPhase,
    middlegamePhase,
    endgamePhase,
    phase,
  ]);

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
