import React, { useEffect } from "react";
import { InteractionManager } from "react-native";
import { useAnalytics } from "../context/AnalyticsContext";
import { useAuth } from "../context/AuthContext";
import { useFilters } from "../context/FilterContext";
import { useScanLog } from "../context/ScanLogContext";
import { agentLog } from "../debug/agentLog";
import { DEBUG_DISABLE_BACKGROUND_JOBS } from "./debugFlags";
import { useStockfish } from "./StockfishProvider";
import { cancelStudyPrefetch, prefetchStudyContent } from "./studyPrefetch";

export function StudyPrefetch() {
  const auth = useAuth();
  const { games, gamesLoading } = useAnalytics();
  const { queryFilters, refreshToken } = useFilters();
  const { ready, evaluate } = useStockfish();
  const { setScanProgress, clearLog, appendLog } = useScanLog();

  useEffect(() => {
    agentLog("H-bg", "StudyPrefetch:effect", "prefetch effect", {
      ready,
      user: queryFilters.username,
      period: queryFilters.timeframe,
      disabled: DEBUG_DISABLE_BACKGROUND_JOBS,
    });
    if (!auth.ready || !auth.isLoggedIn || !queryFilters.username.trim()) {
      return;
    }
    if (DEBUG_DISABLE_BACKGROUND_JOBS) {
      agentLog("H-bg", "StudyPrefetch:disabled", "prefetch skipped by debug flag");
      clearLog();
      setScanProgress({
        status: "Background jobs disabled (debug)",
        phase: "done",
        gamesDone: 0,
        gamesTotal: 0,
        running: false,
        log: true,
      });
      return;
    }
    // Local hydration and heuristic scoring own the first useful render. Do not
    // start a CPU-heavy engine scan until that work has produced a game view.
    if (gamesLoading || games.length === 0) return;
    if (!ready) return;

    cancelStudyPrefetch();
    const signal = { cancelled: false };
    clearLog();
    setScanProgress({
      status: "Starting background Stockfish scan…",
      phase: "boot",
      gamesDone: 0,
      gamesTotal: 0,
      running: true,
      log: true,
    });

    const task = InteractionManager.runAfterInteractions(() => {
      if (signal.cancelled) return;
      void (async () => {
        agentLog("H-bg", "StudyPrefetch:start", "prefetch started", {
          user: queryFilters.username,
        });

        try {
          await prefetchStudyContent({
            filters: queryFilters,
            evaluate,
            signal,
            onProgress: (progress) => {
              if (
                progress.gamesDone <= 1 ||
                progress.phase === "done" ||
                progress.phase === "style"
              ) {
                agentLog("H-bg", "StudyPrefetch:progress", "prefetch progress", {
                  status: progress.status,
                  phase: progress.phase,
                  done: progress.gamesDone,
                  total: progress.gamesTotal,
                });
              }
              setScanProgress({
                status: progress.status,
                phase: progress.phase,
                gamesDone: progress.gamesDone,
                gamesTotal: progress.gamesTotal,
                running: progress.phase !== "done",
                log: progress.gamesDone % 1 === 0 || progress.phase === "done",
              });
            },
          });
          if (signal.cancelled) return;
          agentLog("H-bg", "StudyPrefetch:done", "prefetch finished");
          appendLog("Background scan idle", "done");
          setScanProgress({
            status: "Background scan idle",
            phase: "done",
            running: false,
          });
        } catch (err) {
          if (signal.cancelled) return;
          const message =
            err instanceof Error ? err.message : "Background scan failed";
          agentLog("H-bg", "StudyPrefetch:catch", "prefetch failed", {
            err: message,
          });
          appendLog(message, "error");
          setScanProgress({
            status: message,
            phase: "error",
            running: false,
          });
        }
      })();
    });

    return () => {
      signal.cancelled = true;
      cancelStudyPrefetch();
      task.cancel?.();
    };
  }, [
    auth.ready,
    auth.isLoggedIn,
    ready,
    evaluate,
    gamesLoading,
    games.length,
    queryFilters,
    refreshToken,
    setScanProgress,
    clearLog,
    appendLog,
  ]);

  return null;
}
