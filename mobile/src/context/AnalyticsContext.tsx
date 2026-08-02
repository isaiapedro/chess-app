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
import { useFilters } from "./FilterContext";
import { useScanLog } from "./ScanLogContext";
import {
  clearAnalyticsInflight,
  ensureInsights,
  ensureOpeningMix,
  ensureRecap,
  ensureStudyGames,
  ensureStyleMetrics,
  ensureVaultMetrics,
  remeshVaultFromBucket,
  type EndgamePhasePayload,
  type MiddlegamePhasePayload,
  type OpeningPhasePayload,
} from "../storage/analyticsLoaders";
import { GLOBAL_MAX_GAMES } from "../engine/analysisConfig";
import { agentLog } from "../debug/agentLog";
import { loadBaselineStore, type BaselineStore } from "../data/baselines";
import { studyFiltersKey } from "../storage/studyCacheKeys";

function sortRecentGames(games: StudyGame[]): StudyGame[] {
  return [...games].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
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
  refreshAnalytics: (forceNetwork?: boolean) => Promise<void>;
  requestVaultMetrics: (force?: boolean) => void;
};

const AnalyticsContext = createContext<AnalyticsState | null>(null);

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { queryFilters, refreshToken } = useFilters();
  const { phase, gamesTotal: evalGamesTotal, setScanProgress } = useScanLog();
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
  const lastStyleRefreshKey = useRef<string | null>(null);
  const vaultRequestedRef = useRef(false);
  const vaultRunningRef = useRef(false);
  const vaultRunIdRef = useRef(0);
  const metricsRunIdRef = useRef(0);
  const evalGamesTotalRef = useRef(evalGamesTotal);
  evalGamesTotalRef.current = evalGamesTotal;

  const refreshRecap = useCallback(
    async (forceNetwork = false) => {
      recapSignalRef.current.cancelled = true;
      recapSignalRef.current = { cancelled: false };
      const signal = recapSignalRef.current;
      const key = studyFiltersKey(queryFilters);
      const sessionChanged =
        sessionKeyRef.current !== null && sessionKeyRef.current !== key;
      sessionKeyRef.current = key;
      setSessionKey(key);
      if (forceNetwork || sessionChanged) {
        setRecap(null);
      }

      try {
        const [recapData, peerStore] = await Promise.all([
          ensureRecap(queryFilters, forceNetwork),
          loadBaselineStore(forceNetwork),
        ]);
        if (signal.cancelled) return;
        setRecap(recapData);
        setBaselines(peerStore);
      } catch {
        /* keep prior recap on soft failure */
      }
    },
    [queryFilters]
  );

  const refreshStyleFromBucket = useCallback(
    async (loadedGames: StudyGame[]) => {
      const scoped = sortRecentGames(loadedGames);
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

  const refreshMetrics = useCallback(
    async (forceNetwork = false) => {
      const runId = ++metricsRunIdRef.current;
      // #region agent log
      agentLog("E", "AnalyticsContext.tsx:refreshMetrics", "refreshMetrics start", {
        forceNetwork,
      });
      // #endregion
      const key = studyFiltersKey(queryFilters);
      const sessionChanged =
        sessionKeyRef.current !== null && sessionKeyRef.current !== key;
      sessionKeyRef.current = key;
      setSessionKey(key);
      setGamesLoading(true);
      setOpeningPhaseLoading(true);
      setMiddlegamePhaseLoading(true);
      setEndgamePhaseLoading(true);
      if (forceNetwork) clearAnalyticsInflight();
      lastStyleRefreshKey.current = null;
      if (forceNetwork || sessionChanged) {
        vaultSignalRef.current.cancelled = true;
        vaultSignalRef.current = { cancelled: false };
        setGames([]);
        setMix(null);
        setStyle(null);
        setStyleScanned(0);
        setStyleTotal(0);
        setStyleComplete(false);
        setOpeningPhase(null);
        setMiddlegamePhase(null);
        setEndgamePhase(null);
        setInsights(null);
        vaultRequestedRef.current = false;
      }

      try {
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });
        if (metricsRunIdRef.current !== runId) return;
        const [loadedGames, peerStore, insightsData] = await Promise.all([
          ensureStudyGames(queryFilters, forceNetwork),
          loadBaselineStore(forceNetwork),
          ensureInsights(queryFilters, forceNetwork),
        ]);
        if (metricsRunIdRef.current !== runId) return;

        const scoped = sortRecentGames(loadedGames);
        gamesRef.current = scoped;
        setGames(scoped);
        setBaselines(peerStore);
        setInsights(insightsData);
        setGamesLoading(false);
        setStyleTotal(scoped.length);
        const evalQueue = Math.min(scoped.length, GLOBAL_MAX_GAMES);
        if (evalGamesTotalRef.current <= 0 && evalQueue > 0) {
          setScanProgress({
            status: `Queued evaluation of ${evalQueue} games`,
            phase: "boot",
            gamesDone: 0,
            gamesTotal: evalQueue,
            running: true,
            log: false,
          });
        }

        const mixData = await ensureOpeningMix(
          queryFilters,
          scoped,
          forceNetwork
        );
        if (metricsRunIdRef.current !== runId) return;
        setMix(mixData);

        // #region agent log
        agentLog(
          "F",
          "AnalyticsContext.tsx:refreshMetrics",
          "lite metrics done, starting vault",
          {
            games: scoped.length,
            evalQueue,
            vaultRequested: vaultRequestedRef.current,
          }
        );
        // #endregion

        vaultRequestedRef.current = true;
        void refreshVaultMetrics(scoped, {
          force: forceNetwork || sessionChanged,
        });
      } catch {
        if (metricsRunIdRef.current !== runId) return;
        setGamesLoading(false);
        setOpeningPhaseLoading(false);
        setMiddlegamePhaseLoading(false);
        setEndgamePhaseLoading(false);
      }
    },
    [queryFilters, refreshVaultMetrics, setScanProgress]
  );

  const refreshAnalytics = useCallback(
    async (forceNetwork = false) => {
      await Promise.all([
        refreshRecap(forceNetwork),
        refreshMetrics(forceNetwork),
      ]);
    },
    [refreshRecap, refreshMetrics]
  );

  useEffect(() => {
    void refreshRecap(false);
    return () => {
      recapSignalRef.current.cancelled = true;
    };
  }, [refreshRecap, refreshToken]);

  useEffect(() => {
    void refreshMetrics(false);
  }, [refreshMetrics, refreshToken]);

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
