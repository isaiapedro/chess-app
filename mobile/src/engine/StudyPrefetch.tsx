import Constants from "expo-constants";
import React, { useEffect } from "react";
import { InteractionManager } from "react-native";
import { useFilters } from "../context/FilterContext";
import { useScanLog } from "../context/ScanLogContext";
import { agentLog } from "../debug/agentLog";
import { DEBUG_DISABLE_BACKGROUND_JOBS } from "./debugFlags";
import { useStockfish } from "./StockfishProvider";
import { cancelStudyPrefetch, prefetchStudyContent } from "./studyPrefetch";

function debugLog(
  location: string,
  message: string,
  hypothesisId: string,
  data: Record<string, unknown>
) {
  // #region agent log
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0] || "127.0.0.1";
  fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6d2375",
    },
    body: JSON.stringify({
      sessionId: "6d2375",
      runId: "sf-post-ready",
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export function StudyPrefetch() {
  const { queryFilters, refreshToken } = useFilters();
  const { ready, evaluate } = useStockfish();
  const { setScanProgress, clearLog, appendLog } = useScanLog();

  useEffect(() => {
    // #region agent log
    debugLog("StudyPrefetch.tsx:effect", "prefetch effect", "H-bg", {
      ready,
      user: queryFilters.username,
      period: queryFilters.timeframe,
      disabled: DEBUG_DISABLE_BACKGROUND_JOBS,
      runId: "bg-off",
    });
    // #endregion
    if (DEBUG_DISABLE_BACKGROUND_JOBS) {
      console.log("[bg-off] StudyPrefetch skipped");
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
    // #region agent log
    agentLog("G", "StudyPrefetch.tsx:effect", "stockfish ready gate", {
      ready,
      disabled: DEBUG_DISABLE_BACKGROUND_JOBS,
    });
    // #endregion
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
      // #region agent log
      agentLog("G", "StudyPrefetch.tsx:start", "prefetch started", {
        user: queryFilters.username,
      });
      // #endregion
      debugLog("StudyPrefetch.tsx:start", "prefetch started", "H-bg", {
        user: queryFilters.username,
        runId: "bg-off",
      });

      void prefetchStudyContent({
        filters: queryFilters,
        evaluate,
        signal,
        onProgress: (progress) => {
          if (
            progress.gamesDone <= 1 ||
            progress.phase === "done" ||
            progress.phase === "style"
          ) {
            // #region agent log
            agentLog("G", "StudyPrefetch.tsx:progress", "prefetch progress", {
              status: progress.status,
              phase: progress.phase,
              done: progress.gamesDone,
              total: progress.gamesTotal,
            });
            // #endregion
            debugLog("StudyPrefetch.tsx:progress", "prefetch progress", "H-bg", {
              status: progress.status,
              phase: progress.phase,
              done: progress.gamesDone,
              total: progress.gamesTotal,
              runId: "bg-off",
            });
          }
          setScanProgress({
            status: progress.status,
            phase: progress.phase,
            gamesDone: progress.gamesDone,
            gamesTotal: progress.gamesTotal,
            running: progress.phase !== "done",
            log: true,
          });
        },
      })
        .then(() => {
          if (signal.cancelled) return;
          debugLog("StudyPrefetch.tsx:done", "prefetch finished", "H-bg", {
            runId: "bg-off",
          });
          appendLog("Background scan idle", "done");
          setScanProgress({
            status: "Background scan idle",
            phase: "done",
            running: false,
          });
        })
        .catch((err) => {
          if (signal.cancelled) return;
          const message =
            err instanceof Error ? err.message : "Background scan failed";
          debugLog("StudyPrefetch.tsx:catch", "prefetch failed", "H-bg", {
            err: message,
            runId: "bg-off",
          });
          appendLog(message, "error");
          setScanProgress({
            status: message,
            phase: "error",
            running: false,
          });
        });
    });

    return () => {
      signal.cancelled = true;
      cancelStudyPrefetch();
      task.cancel?.();
    };
  }, [
    ready,
    evaluate,
    queryFilters,
    refreshToken,
    setScanProgress,
    clearLog,
    appendLog,
  ]);

  return null;
}
