import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Chess } from "chess.js";
import { fetchExplorer, fetchMastersPgn, type MistakeItem } from "../api/client";
import {
  ensureStudyGames,
  ensureStudyGamesUpTo,
} from "../storage/analyticsLoaders";
import { ChessBoard } from "../components/ChessBoard";
import { OpeningPrepSection } from "../components/OpeningPrepSection";
import { StudyAnalyzeStatus } from "../components/StudyAnalyzeStatus";
import { PageLoadingTransition } from "../components/LoadingSkeletons";
import {
  BrutalButton,
  DisplayTitle,
  EdgeCard,
  Pill,
} from "../components/ui";
import { useFilters } from "../context/FilterContext";
import {
  GLOBAL_FIRST_SCAN_MAX_GAMES,
  GLOBAL_MAX_GAMES,
  TARGET_MISTAKE_MOMENTS,
} from "../engine/analysisConfig";
import {
  beginPuzzleBatch,
  endPuzzleBatch,
} from "../engine/backgroundWork";
import {
  formatEval,
  displayCp,
  refineRecentMistakeCandidates,
  validateMoveLocal,
  type AnalyzeProgress,
  type StudyGame,
  type ThresholdPass,
} from "../engine/analyzeMistakes";
import { applyUciMove } from "../engine/chessMoves";
import { consumeCandidates } from "../engine/candidateBucket";
import {
  createEvalLookup,
  getActiveGlobalScan,
  globalScanSessionKey,
  joinActiveGlobalScanIfOwned,
  periodReservoirStatus,
  runGlobalPeriodAnalysis,
  type GlobalAnalysisState,
} from "../engine/globalAnalysis";
import { cancelStudyPrefetch } from "../engine/studyPrefetch";
import { useStockfish } from "../engine/StockfishProvider";
import { formatGmGameLabel } from "../engine/resolveContinuation";
import {
  readCache,
  STUDY_ANALYSIS_TTL_MS,
  writeCache,
} from "../storage/cache";
import { readMistakesCacheForPeriod } from "../storage/periodCacheReuse";
import { studyMistakesCacheKey } from "../storage/studyCacheKeys";
import { colors, font, result, spacing } from "../theme";

type Mode = "mistakes" | "repertoire";

type MistakesCachePayload = {
  moments: MistakeItem[];
  pendingCandidates: MistakeItem[];
  deferredCandidates?: MistakeItem[];
  scannedGameIds: string[];
  remaining: number;
  thresholdPass?: ThresholdPass;
  baselineAvailable?: boolean;
};

type PendingMistakesBatch = MistakesCachePayload & {
  previousLength: number;
};

function parseMistakesCache(
  raw: MistakesCachePayload | MistakeItem[] | null
): MistakesCachePayload | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return {
      moments: raw,
      pendingCandidates: [],
      scannedGameIds: [...new Set(raw.map((item) => String(item.game_id)))],
      remaining: 0,
    };
  }
  if (raw.moments) {
    return {
      moments: raw.moments,
      pendingCandidates: raw.pendingCandidates || [],
      deferredCandidates: raw.deferredCandidates || [],
      scannedGameIds: raw.scannedGameIds || [],
      remaining: raw.remaining ?? 0,
      thresholdPass: raw.thresholdPass || "strict",
      baselineAvailable: Boolean(raw.baselineAvailable),
    };
  }
  return null;
}

function formatGameDate(value?: string): string {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function applyUci(fen: string, uci?: string | null): string {
  if (!uci) return fen;
  const game = new Chess(fen);
  if (!applyUciMove(game, uci)) return fen;
  return game.fen();
}

export function StudyScreen() {
  const { queryFilters, refreshToken } = useFilters();
  const { ready: engineReady, error: engineError, evaluate } = useStockfish();
  const [mode, setMode] = useState<Mode>("mistakes");

  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loadingMistakes, setLoadingMistakes] = useState(false);
  const [scanningMore, setScanningMore] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [mistakesError, setMistakesError] = useState<string | null>(null);
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(
    null
  );
  const finishLoadingVisual = useCallback(() => {
    setAnalysisComplete(false);
    setLoadingMistakes(false);
    setScanningMore(false);
  }, []);
  const [analyzeLog, setAnalyzeLog] = useState<string[]>([]);
  const [remainingGames, setRemainingGames] = useState(0);
  const [periodComplete, setPeriodComplete] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [scanExhausted, setScanExhausted] = useState(false);
  const [showScanMore, setShowScanMore] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [quizCorrect, setQuizCorrect] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [userMoveEval, setUserMoveEval] = useState<number | null>(null);
  const [puzzleFen, setPuzzleFen] = useState<string | null>(null);
  const [puzzleMoveSan, setPuzzleMoveSan] = useState<string | null>(null);
  const [highlightUci, setHighlightUci] = useState<string | null>(null);
  const [guessUci, setGuessUci] = useState<string | null>(null);
  const [sequencePv, setSequencePv] = useState<string[]>([]);
  const [sequencePlaying, setSequencePlaying] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const playTokenRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedCacheKeyRef = useRef<string | null>(null);
  const lastRefreshRef = useRef(refreshToken);
  const studyGamesRef = useRef<StudyGame[]>([]);
  const scannedIdsRef = useRef<string[]>([]);
  const thresholdPassRef = useRef<ThresholdPass>("strict");
  const baselineAvailableRef = useRef(false);
  const pendingCandidatesRef = useRef<MistakeItem[]>([]);
  const deferredCandidatesRef = useRef<MistakeItem[]>([]);
  const backgroundScanningRef = useRef(false);
  const secondPagePrefetchKeyRef = useRef<string | null>(null);
  const pendingBatchRef = useRef<PendingMistakesBatch | null>(null);
  const visibleBatchStartRef = useRef(0);
  const revealPendingOnCompleteRef = useRef(false);
  const [pendingReady, setPendingReady] = useState(false);

  const current = mistakes[idx] || null;
  const mistakesCacheKey = studyMistakesCacheKey(queryFilters);

  useEffect(() => {
    const quizActive =
      mode === "mistakes" &&
      Boolean(current) &&
      !loadingMistakes &&
      !scanningMore &&
      !showScanMore &&
      !allDone;
    if (!quizActive) return;
    beginPuzzleBatch();
    return () => {
      endPuzzleBatch();
    };
  }, [
    mode,
    current,
    loadingMistakes,
    scanningMore,
    showScanMore,
    allDone,
  ]);

  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    playTokenRef.current += 1;
    setPuzzleFen(current?.fen || null);
    setPuzzleMoveSan(null);
    setQuizFeedback(null);
    setQuizCorrect(null);
    setRevealed(false);
    setContinuation(null);
    setUserMoveEval(null);
    setHighlightUci(null);
    setGuessUci(null);
    setSequencePv([]);
    setSequencePlaying(false);
  }, [current?.game_id, current?.ply, current?.fen]);

  const playContinuation = useCallback((startFen: string, pv: string[]) => {
    const token = ++playTokenRef.current;
    const moves = pv.filter(Boolean);
    if (!moves.length) return;
    setSequencePlaying(true);
    setPuzzleFen(startFen);
    setHighlightUci(null);
    setGuessUci(null);
    let i = 0;
    const step = () => {
      if (playTokenRef.current !== token) return;
      let fen = startFen;
      for (let k = 0; k <= i; k += 1) {
        fen = applyUci(fen, moves[k]);
      }
      setPuzzleFen(fen);
      setHighlightUci(moves[i] || null);
      i += 1;
      if (i < moves.length) {
        setTimeout(step, 1200);
      } else {
        setSequencePlaying(false);
      }
    };
    setTimeout(step, 500);
  }, []);

  const resetQuizChrome = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    playTokenRef.current += 1;
    setQuizFeedback(null);
    setQuizCorrect(null);
    setRevealed(false);
    setContinuation(null);
    setUserMoveEval(null);
    setHighlightUci(null);
    setGuessUci(null);
    setPuzzleMoveSan(null);
    setSequencePv([]);
    setSequencePlaying(false);
  }, []);

  const mistakesRef = useRef<MistakeItem[]>([]);
  mistakesRef.current = mistakes;

  const pushProgress = useCallback((progress: AnalyzeProgress) => {
    setAnalyzeProgress(progress);
    setAnalyzeStatus(progress.status);
    if (progress.log) {
      setAnalyzeLog((prev) => [...prev.slice(-59), progress.log!]);
    }
  }, []);

  const syncMistakeReservoir = useCallback(
    async (games: StudyGame[], pendingLen: number) => {
      const status = await periodReservoirStatus(
        queryFilters,
        games,
        "mistake",
        { pendingCount: pendingLen }
      );
      setRemainingGames(status.remaining);
      setPeriodComplete(status.complete);
      setScanExhausted(status.exhausted);
      return status;
    },
    [queryFilters]
  );

  const loadMistakes = useCallback(async (force = false) => {
    const hydrateFromCache = async () => {
      const games = await ensureStudyGames(queryFilters, false);
      studyGamesRef.current = games;
      const cached = parseMistakesCache(
        await readMistakesCacheForPeriod(
          queryFilters,
          games.map((game) => String(game.id))
        )
      );
      if (!cached?.moments.length) return false;
      setMistakes(cached.moments);
      setIdx(0);
      visibleBatchStartRef.current = 0;
      pendingBatchRef.current = null;
      setPendingReady(false);
      secondPagePrefetchKeyRef.current = null;
      scannedIdsRef.current = cached.scannedGameIds;
      pendingCandidatesRef.current = cached.pendingCandidates || [];
      deferredCandidatesRef.current = cached.deferredCandidates || [];
      setPendingCount((cached.pendingCandidates || []).length);
      setRemainingGames(cached.remaining);
      thresholdPassRef.current = cached.thresholdPass || "strict";
      baselineAvailableRef.current = Boolean(cached.baselineAvailable);
      setShowScanMore(false);
      setMistakesError(null);
      loadedCacheKeyRef.current = mistakesCacheKey;
      setLoadingMistakes(false);
      setAnalyzeStatus(null);
      setAnalyzeProgress(null);
      void syncMistakeReservoir(
        games,
        (cached.pendingCandidates || []).length
      );
      return true;
    };

    if (!engineReady && !force) {
      if (await hydrateFromCache()) return;
    }
    if (!engineReady) {
      setMistakesError(engineError || "Waiting for on-device Stockfish…");
      return;
    }
    if (
      !force &&
      loadedCacheKeyRef.current === mistakesCacheKey
    ) {
      return;
    }
    if (!force) {
      if (await hydrateFromCache()) return;
    }

    cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const signal = cancelRef.current;
    const sessionKey = globalScanSessionKey(queryFilters);

    secondPagePrefetchKeyRef.current = null;
    pendingBatchRef.current = null;
    setPendingReady(false);
    visibleBatchStartRef.current = 0;
    setAnalysisComplete(false);
    setLoadingMistakes(true);
    setMistakesError(null);
    setQuizFeedback(null);
    setQuizCorrect(null);
    setRevealed(false);
    setScanExhausted(false);
    setPeriodComplete(false);
    setShowScanMore(false);
    setAnalyzeLog([]);
    setAnalyzeProgress(null);
    setAnalyzeStatus("Loading recent games…");
    let completed = false;
    let heldPuzzleSlot = false;
    try {
      const games = await ensureStudyGames(queryFilters, force);
      studyGamesRef.current = games;

      if (!force) {
        const active = getActiveGlobalScan();
        if (
          active &&
          active.sessionKey === sessionKey &&
          active.owner === "prefetch"
        ) {
          setAnalyzeStatus("Waiting for background scan…");
        }
        const joined = await joinActiveGlobalScanIfOwned({
          sessionKey,
          owners: ["prefetch"],
          signal,
          until: async () => {
            const cached = parseMistakesCache(
              await readCache<MistakesCachePayload | MistakeItem[]>(
                mistakesCacheKey,
                STUDY_ANALYSIS_TTL_MS
              )
            );
            return Boolean(cached?.moments.length);
          },
        });
        if (signal.cancelled) return;
        if (joined) {
          const afterPrefetch = parseMistakesCache(
            await readCache<MistakesCachePayload | MistakeItem[]>(
              mistakesCacheKey,
              STUDY_ANALYSIS_TTL_MS
            )
          );
          if (afterPrefetch?.moments.length) {
            setMistakes(afterPrefetch.moments);
            setIdx(0);
            visibleBatchStartRef.current = 0;
            pendingBatchRef.current = null;
            setPendingReady(false);
            secondPagePrefetchKeyRef.current = null;
            scannedIdsRef.current = afterPrefetch.scannedGameIds;
            pendingCandidatesRef.current = afterPrefetch.pendingCandidates || [];
            deferredCandidatesRef.current = afterPrefetch.deferredCandidates || [];
            setPendingCount((afterPrefetch.pendingCandidates || []).length);
            setRemainingGames(afterPrefetch.remaining);
            thresholdPassRef.current = afterPrefetch.thresholdPass || "strict";
            baselineAvailableRef.current = Boolean(afterPrefetch.baselineAvailable);
            setShowScanMore(false);
            setMistakesError(null);
            loadedCacheKeyRef.current = mistakesCacheKey;
            setLoadingMistakes(false);
            setAnalyzeStatus(null);
            setAnalyzeProgress(null);
            setAnalysisComplete(true);
            completed = true;
            void syncMistakeReservoir(
              games,
              (afterPrefetch.pendingCandidates || []).length
            );
            return;
          }
        }
      }

      cancelStudyPrefetch();
      beginPuzzleBatch();
      heldPuzzleSlot = true;
      setAnalyzeStatus("Global Stockfish scan…");
      let delivered = false;
      const latestStateRef = {
        current: null as GlobalAnalysisState | null,
      };
      const partialBatchRef = {
        current: null as Awaited<
          ReturnType<typeof refineRecentMistakeCandidates>
        > | null,
      };
      const applyBatch = async (
        batch: Awaited<ReturnType<typeof refineRecentMistakeCandidates>>,
        candidates: MistakeItem[]
      ) => {
        await consumeCandidates(queryFilters, "mistake", candidates);
        if (signal.cancelled) return;
        scannedIdsRef.current = batch.scannedGameIds;
        pendingCandidatesRef.current = batch.pendingCandidates;
        deferredCandidatesRef.current = batch.deferredCandidates;
        setPendingCount(batch.pendingCandidates.length);
        thresholdPassRef.current = batch.thresholdPass;
        baselineAvailableRef.current = batch.baselineAvailable;
        const reservoir = await syncMistakeReservoir(
          games,
          batch.pendingCandidates.length
        );
        setMistakes(batch.moments);
        setIdx(0);
        visibleBatchStartRef.current = 0;
        pendingBatchRef.current = null;
        setPendingReady(false);
        secondPagePrefetchKeyRef.current = null;
        loadedCacheKeyRef.current = mistakesCacheKey;
        if (batch.moments.length) {
          await writeCache(mistakesCacheKey, {
            moments: batch.moments,
            pendingCandidates: batch.pendingCandidates,
            deferredCandidates: batch.deferredCandidates,
            scannedGameIds: batch.scannedGameIds,
            remaining: reservoir.remaining,
            thresholdPass: batch.thresholdPass,
            baselineAvailable: batch.baselineAvailable,
          } satisfies MistakesCachePayload);
          setMistakesError(null);
          setLoadingMistakes(false);
          setAnalysisComplete(true);
          delivered = true;
          completed = true;
          if (heldPuzzleSlot) {
            endPuzzleBatch();
            heldPuzzleSlot = false;
          }
        }
      };

      await runGlobalPeriodAnalysis({
        filters: queryFilters,
        evaluate,
        signal,
        games,
        owner: "study",
        sessionKey,
        maxGames: GLOBAL_FIRST_SCAN_MAX_GAMES,
        onProgress: (p) => {
          if (delivered) return;
          setAnalyzeStatus(p.status);
          setAnalyzeProgress({
            gamesScanned: p.gamesDone,
            positionsChecked: 0,
            found: 0,
            candidates: 0,
            selected: 0,
            status: p.status,
            phase: p.phase === "done" ? "refine" : "scan",
            engine: p.engine,
            currentGame: p.currentGame,
          });
        },
        onGameScanned: (state) => {
          latestStateRef.current = state;
        },
        onEarlyMistakesReady: async (candidates, state) => {
          if (signal.cancelled || delivered) return false;
          setAnalyzeStatus("Refining recent candidates…");
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
            fetchMastersPgn: async (gameId) => fetchMastersPgn(gameId),
            fetchExplorer: async (fen, source) => {
              const res = await fetchExplorer(fen, source);
              return {
                moves: res.moves || [],
                topGames: res.topGames || [],
              };
            },
            onProgress: pushProgress,
          });
          if (signal.cancelled) return false;
          partialBatchRef.current = batch;
          if (batch.moments.length >= TARGET_MISTAKE_MOMENTS) {
            await applyBatch(batch, batch.moments);
          }
          return true;
        },
      });
      if (signal.cancelled) return;
      const partialBatch = partialBatchRef.current;
      const latestState = latestStateRef.current;
      if (
        !delivered &&
        partialBatch &&
        partialBatch.moments.length < TARGET_MISTAKE_MOMENTS &&
        latestState?.mistakeCandidates?.length
      ) {
        setAnalyzeStatus("Refining remaining candidates…");
        const batch = await refineRecentMistakeCandidates({
          candidates: latestState.mistakeCandidates,
          games,
          evaluate,
          signal,
          limit: TARGET_MISTAKE_MOMENTS,
          existingMoments: partialBatch.moments,
          lookupEval: createEvalLookup(latestState),
          fetchMastersPgn: async (gameId) => fetchMastersPgn(gameId),
          fetchExplorer: async (fen, source) => {
            const res = await fetchExplorer(fen, source);
            return {
              moves: res.moves || [],
              topGames: res.topGames || [],
            };
          },
          onProgress: pushProgress,
        });
        if (!signal.cancelled) partialBatchRef.current = batch;
      }
      const finalBatch = partialBatchRef.current;
      if (!delivered && finalBatch?.moments.length) {
        await applyBatch(finalBatch, finalBatch.moments);
      }
      if (!delivered) {
        setMistakesError("No critical swings found in recent games.");
        setShowScanMore(true);
        completed = true;
      }
    } catch (e) {
      if (signal.cancelled) return;
      setMistakes([]);
      setMistakesError(e instanceof Error ? e.message : "Failed to analyze");
    } finally {
      if (heldPuzzleSlot) endPuzzleBatch();
      if (!signal.cancelled) {
        if (completed) {
          setAnalysisComplete(true);
        } else {
          setLoadingMistakes(false);
        }
      }
    }
  }, [
    engineReady,
    engineError,
    evaluate,
    queryFilters,
    mistakesCacheKey,
    pushProgress,
    syncMistakeReservoir,
  ]);

  const continueScanMistakes = useCallback(async (silent = false) => {
    if (
      !engineReady ||
      scanningMore ||
      backgroundScanningRef.current ||
      scanExhausted ||
      (silent && pendingBatchRef.current)
    ) {
      return;
    }
    cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const signal = cancelRef.current;
    const keptMoments = mistakesRef.current;
    const carriedCandidates = pendingCandidatesRef.current;
    if (!silent) {
      setShowScanMore(false);
      setAllDone(false);
      resetQuizChrome();
    }
    pendingCandidatesRef.current = [];
    setPendingCount(0);
    if (!silent) {
      setAnalyzeLog([]);
      setAnalyzeProgress({
        gamesScanned: 0,
        positionsChecked: 0,
        found: 0,
        candidates: 0,
        selected: 0,
        status: "Scanning next batch…",
        phase: "scan",
        engine: "Stockfish",
      });
      setAnalyzeStatus("Scanning next batch…");
    }
    cancelStudyPrefetch();
    beginPuzzleBatch();
    if (silent) {
      backgroundScanningRef.current = true;
    } else {
      setAnalysisComplete(false);
      setScanningMore(true);
    }
    let completed = false;
    try {
      let games = studyGamesRef.current;
      if (games.length < GLOBAL_MAX_GAMES) {
        games = await ensureStudyGamesUpTo(
          queryFilters,
          GLOBAL_MAX_GAMES,
          false
        );
        studyGamesRef.current = games;
      }

      const refineOpts = {
        games,
        evaluate,
        signal,
        limit: TARGET_MISTAKE_MOMENTS,
        existingMoments: keptMoments,
        fetchMastersPgn: async (gameId: string) => fetchMastersPgn(gameId),
        fetchExplorer: async (fen: string, source: "masters" | "lichess") => {
          const res = await fetchExplorer(fen, source);
          return {
            moves: res.moves || [],
            topGames: res.topGames || [],
          };
        },
        onProgress: silent ? undefined : pushProgress,
      };

      let batch: Awaited<
        ReturnType<typeof refineRecentMistakeCandidates>
      > | null = null;
      let taken: MistakeItem[] = [];

      const vault = await periodReservoirStatus(
        queryFilters,
        games,
        "mistake",
        {
          pendingCount: carriedCandidates.length,
          batchLimit: Number.MAX_SAFE_INTEGER,
        }
      );

      if (vault.batch.length || carriedCandidates.length) {
        batch = await refineRecentMistakeCandidates({
          ...refineOpts,
          candidates: [...carriedCandidates, ...vault.batch],
          lookupEval: createEvalLookup(vault.state),
        });
        taken = batch.moments.slice(keptMoments.length);
        await consumeCandidates(queryFilters, "mistake", taken);
      } else if (!vault.complete) {
        const early: {
          batch: Awaited<
            ReturnType<typeof refineRecentMistakeCandidates>
          > | null;
          taken: MistakeItem[];
        } = { batch: null, taken: [] };
        await runGlobalPeriodAnalysis({
          filters: queryFilters,
          evaluate,
          signal,
          games,
          owner: "study",
          sessionKey: globalScanSessionKey(queryFilters),
          continueScan: true,
          onEarlyMistakesReady: async (candidates, state) => {
            if (signal.cancelled || early.batch) return false;
            const pool = state.mistakeCandidates.length
              ? state.mistakeCandidates
              : candidates;
            early.batch = await refineRecentMistakeCandidates({
              ...refineOpts,
              candidates: [...carriedCandidates, ...pool],
              lookupEval: createEvalLookup(state),
            });
            early.taken = early.batch.moments.slice(keptMoments.length);
            await consumeCandidates(queryFilters, "mistake", early.taken);
            return true;
          },
        });
        batch = early.batch;
        taken = early.taken;
      } else {
        setScanExhausted(true);
        setRemainingGames(0);
        setPeriodComplete(true);
        if (!silent) {
          setShowScanMore(false);
          setAllDone(true);
        }
        return;
      }

      if (signal.cancelled || !batch) return;
      scannedIdsRef.current = [
        ...scannedIdsRef.current,
        ...batch.scannedGameIds,
      ];
      pendingCandidatesRef.current = batch.pendingCandidates;
      deferredCandidatesRef.current = batch.deferredCandidates;
      setPendingCount(batch.pendingCandidates.length);
      thresholdPassRef.current = batch.thresholdPass;
      baselineAvailableRef.current = batch.baselineAvailable;
      const reservoir = await syncMistakeReservoir(
        games,
        batch.pendingCandidates.length
      );

      const hasNew = batch.moments.length > keptMoments.length;
      if (silent) {
        if (hasNew) {
          pendingBatchRef.current = {
            moments: batch.moments,
            pendingCandidates: batch.pendingCandidates,
            deferredCandidates: batch.deferredCandidates,
            scannedGameIds: scannedIdsRef.current,
            remaining: reservoir.remaining,
            thresholdPass: batch.thresholdPass,
            baselineAvailable: batch.baselineAvailable,
            previousLength: keptMoments.length,
          };
          setPendingReady(true);
        }
        await writeCache(mistakesCacheKey, {
          moments: keptMoments,
          pendingCandidates: batch.pendingCandidates,
          deferredCandidates: batch.deferredCandidates,
          scannedGameIds: scannedIdsRef.current,
          remaining: reservoir.remaining,
          thresholdPass: batch.thresholdPass,
          baselineAvailable: batch.baselineAvailable,
        } satisfies MistakesCachePayload);
      } else {
        setMistakes(batch.moments);
        visibleBatchStartRef.current = hasNew ? keptMoments.length : 0;
        secondPagePrefetchKeyRef.current = null;
        setIdx(
          hasNew
            ? keptMoments.length
            : Math.max(0, batch.moments.length - 1)
        );
        await writeCache(mistakesCacheKey, {
          moments: batch.moments,
          pendingCandidates: batch.pendingCandidates,
          deferredCandidates: batch.deferredCandidates,
          scannedGameIds: scannedIdsRef.current,
          remaining: reservoir.remaining,
          thresholdPass: batch.thresholdPass,
          baselineAvailable: batch.baselineAvailable,
        } satisfies MistakesCachePayload);
        if (!hasNew) {
          setMistakesError("No further critical swings found.");
          if (!reservoir.exhausted || batch.baselineAvailable) {
            setShowScanMore(true);
          } else {
            setAllDone(true);
          }
        } else {
          setMistakesError(null);
        }
      }
      completed = true;
    } catch (e) {
      if (!silent && !signal.cancelled) {
        setMistakesError(e instanceof Error ? e.message : "Failed to scan more");
      }
    } finally {
      endPuzzleBatch();
      if (silent) {
        backgroundScanningRef.current = false;
        if (revealPendingOnCompleteRef.current) {
          revealPendingOnCompleteRef.current = false;
          const pending = pendingBatchRef.current;
          if (pending) {
            pendingBatchRef.current = null;
            setPendingReady(false);
            setMistakes(pending.moments);
            visibleBatchStartRef.current = pending.previousLength;
            secondPagePrefetchKeyRef.current = null;
            setIdx(pending.previousLength);
            setShowScanMore(false);
            setAllDone(false);
            setMistakesError(null);
            resetQuizChrome();
            void writeCache(mistakesCacheKey, {
              moments: pending.moments,
              pendingCandidates: pending.pendingCandidates,
              deferredCandidates: pending.deferredCandidates,
              scannedGameIds: pending.scannedGameIds,
              remaining: pending.remaining,
              thresholdPass: pending.thresholdPass,
              baselineAvailable: pending.baselineAvailable,
            } satisfies MistakesCachePayload);
          }
          setScanningMore(false);
        }
      } else if (!signal.cancelled) {
        if (completed) {
          setAnalysisComplete(true);
        } else {
          setScanningMore(false);
        }
      }
    }
  }, [
    engineReady,
    scanningMore,
    scanExhausted,
    evaluate,
    queryFilters,
    mistakesCacheKey,
    pushProgress,
    resetQuizChrome,
    syncMistakeReservoir,
  ]);

  const applyPendingMistakesBatch = useCallback(() => {
    const pending = pendingBatchRef.current;
    if (!pending) return false;
    pendingBatchRef.current = null;
    setPendingReady(false);
    setMistakes(pending.moments);
    visibleBatchStartRef.current = pending.previousLength;
    secondPagePrefetchKeyRef.current = null;
    setIdx(pending.previousLength);
    setShowScanMore(false);
    setAllDone(false);
    setMistakesError(null);
    resetQuizChrome();
    void writeCache(mistakesCacheKey, {
      moments: pending.moments,
      pendingCandidates: pending.pendingCandidates,
      deferredCandidates: pending.deferredCandidates,
      scannedGameIds: pending.scannedGameIds,
      remaining: pending.remaining,
      thresholdPass: pending.thresholdPass,
      baselineAvailable: pending.baselineAvailable,
    } satisfies MistakesCachePayload);
    return true;
  }, [mistakesCacheKey, resetQuizChrome]);

  const requestScanMoreMistakes = useCallback(() => {
    if (applyPendingMistakesBatch()) return;
    if (backgroundScanningRef.current) {
      revealPendingOnCompleteRef.current = true;
      setScanningMore(true);
      return;
    }
    void continueScanMistakes(false);
  }, [applyPendingMistakesBatch, continueScanMistakes]);

  useEffect(() => {
    const force = refreshToken !== lastRefreshRef.current;
    lastRefreshRef.current = refreshToken;
    if (mode !== "mistakes") return;
    void loadMistakes(force);
  }, [mode, loadMistakes, refreshToken]);

  useEffect(() => {
    if (loadedCacheKeyRef.current && loadedCacheKeyRef.current !== mistakesCacheKey) {
      loadedCacheKeyRef.current = null;
      setMistakes([]);
      setIdx(0);
      scannedIdsRef.current = [];
      pendingCandidatesRef.current = [];
      deferredCandidatesRef.current = [];
      thresholdPassRef.current = "strict";
      baselineAvailableRef.current = false;
      setPendingCount(0);
      setRemainingGames(0);
      setScanExhausted(false);
    }
  }, [mistakesCacheKey]);

  useEffect(() => {
    return () => {
      cancelRef.current.cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      playTokenRef.current += 1;
    };
  }, []);

  const onQuizMove = async (uci: string, san: string, nextFen: string) => {
    if (!current?.best_uci || revealed) return;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setPuzzleFen(nextFen);
    setPuzzleMoveSan(san);
    setGuessUci(uci);
    setQuizFeedback("Checking…");
    setQuizCorrect(null);
    try {
      const res = await validateMoveLocal(
        evaluate,
        current.fen,
        uci,
        current.best_uci,
        current.best_pv,
        {
          gapCp: Math.abs(
            (current.eval_before_cp ?? 0) - (current.eval_after_cp ?? 0)
          ),
          playedUci: current.played_uci,
        }
      );

      if (res.verdict === "illegal") {
        setQuizFeedback("Illegal move — try again.");
        setPuzzleFen(current.fen);
        setPuzzleMoveSan(null);
        setGuessUci(null);
        return;
      }

      if (res.verdict === "retry") {
        setQuizCorrect(false);
        setQuizFeedback("Not quite — try a different move.");
        setContinuation(null);
        setUserMoveEval(null);
        retryTimerRef.current = setTimeout(() => {
          setPuzzleFen(current.fen);
          setGuessUci(null);
          setQuizFeedback("Not quite — try a different move.");
        }, 1600);
        return;
      }

      setRevealed(true);
      setContinuation(res.best_continuation_san);
      setUserMoveEval(res.verdict === "good" ? res.user_eval_cp : null);
      setQuizCorrect(true);
      setQuizFeedback(null);
      setPuzzleMoveSan(res.user_san);
      setPuzzleFen(current.fen);
      setHighlightUci(current.best_uci);
      setSequencePv(res.best_pv.length ? res.best_pv : current.best_uci ? [current.best_uci] : []);
      setSequencePlaying(false);
    } catch (e) {
      setQuizFeedback(e instanceof Error ? e.message : "Validate failed");
      setPuzzleFen(current.fen);
      setPuzzleMoveSan(null);
      setGuessUci(null);
    }
  };

  const canScanMoreMistakes =
    pendingReady ||
    (!scanExhausted &&
      (remainingGames > 0 || pendingCount > 0 || !periodComplete));

  const nextMistake = () => {
    if (idx >= mistakes.length - 1) {
      if (canScanMoreMistakes) {
        resetQuizChrome();
        setShowScanMore(true);
        setAllDone(false);
      } else {
        resetQuizChrome();
        setShowScanMore(false);
        setAllDone(true);
      }
      return;
    }
    setAllDone(false);
    setShowScanMore(false);
    resetQuizChrome();
    setIdx((i) => Math.min(i + 1, Math.max(mistakes.length - 1, 0)));
  };

  const prevMistake = () => {
    setAllDone(false);
    setShowScanMore(false);
    resetQuizChrome();
    setIdx((i) => Math.max(i - 1, 0));
  };

  const evalBefore = current?.eval_before_cp ?? 0;
  const evalAfter = current?.eval_after_cp ?? 0;
  const whiteShare = Math.max(
    8,
    Math.min(92, 50 + displayCp(evalBefore) / 4)
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
      <DisplayTitle size={30}>Study Board</DisplayTitle>

      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, mode === "mistakes" ? styles.tabActive : styles.tabIdle]}
          onPress={() => setMode("mistakes")}
        >
          <Text style={styles.tabText}>Critical Mistakes</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, mode === "repertoire" ? styles.tabActive : styles.tabIdle]}
          onPress={() => setMode("repertoire")}
        >
          <Text style={styles.tabText}>Opening Prep</Text>
        </Pressable>
      </View>

      <View style={mode === "mistakes" ? undefined : styles.hiddenTab}>
        <PageLoadingTransition
          active={loadingMistakes || scanningMore}
          contentKey={
            showScanMore
              ? "scan-more"
              : allDone
                ? "all-done"
                : mistakesError
                  ? `error:${mistakesError}`
                  : mistakes.length === 0
                    ? "empty"
                    : `batch:${visibleBatchStartRef.current}:${mistakes.length}`
          }
          loader={
            <View style={styles.center}>
              <StudyAnalyzeStatus
                progress={analyzeProgress}
                logLines={analyzeLog}
                targetMoments={TARGET_MISTAKE_MOMENTS}
                fallback={analyzeStatus || "Starting on-device analysis…"}
                complete={analysisComplete}
                onComplete={finishLoadingVisual}
              />
            </View>
          }
        >
          {mistakesError ? (
            <Text style={styles.error}>{mistakesError}</Text>
          ) : null}
          {!mistakesError && mistakes.length === 0 ? (
            <Text style={styles.muted}>
              No critical swings found in recent games. Try a wider timeframe.
            </Text>
          ) : null}
          {showScanMore && canScanMoreMistakes ? (
            <View style={styles.center}>
              <BrutalButton
                label="Scan more"
                disabled={!engineReady}
                onPress={requestScanMoreMistakes}
              />
            </View>
          ) : null}
          {allDone ? (
            <View style={[styles.center, { marginTop: spacing.sm, gap: spacing.md }]}>
              <Text style={styles.muted}>
                That&apos;s all for today — every candidate position from these
                games has been reviewed.
              </Text>
              <BrutalButton
                label="Go Back"
                onPress={() => {
                  setAllDone(false);
                  setShowScanMore(false);
                }}
              />
            </View>
          ) : null}

          {current && !showScanMore && !allDone ? (
            <View>
              <View style={styles.mistakeHeader}>
                <View style={styles.gameIdentity}>
                  <Text style={styles.gameDate}>{formatGameDate(current.created_at)}</Text>
                  <Text style={styles.opponentName}>
                    vs {current.opponent_name || "Unknown opponent"}
                  </Text>
                  <Text style={styles.gameDetails}>
                    {current.speed || "Unknown format"} · Move{" "}
                    {current.move_number || Math.floor(current.ply / 2) + 1}
                  </Text>
                  <Text style={styles.openingLine}>
                    {current.opening_eco} {current.opening_name || "Unknown opening"}
                  </Text>
                </View>
                <View style={styles.evalSummary}>
                  <Text style={[styles.metaLine, styles.evalAlign]}>Eval</Text>
                  <Text style={styles.evalDrop}>
                    {formatEval(evalAfter)} → {formatEval(evalBefore)}
                  </Text>
                  <Text style={styles.evalGain}>
                    {Math.abs(evalBefore) > 2000 || Math.abs(evalAfter) > 2000
                      ? "Mating attack"
                      : `+${(Math.abs(displayCp(evalBefore) - displayCp(evalAfter)) / 100).toFixed(2)} improvement`}
                  </Text>
                  <View style={styles.evalAlign}>
                    <Pill
                      color={result.loss}
                      style={styles.mistakePill}
                      textStyle={styles.movePillText}
                    >
                      Played {current.played_san}
                    </Pill>
                  </View>
                </View>
              </View>

              <View style={styles.evalBarTrack}>
                <View style={[styles.evalBarFill, { width: `${whiteShare}%` }]} />
              </View>

              <Text style={styles.prompt}>
                What is the best move for{" "}
                {current.user_color === "black" ? "black" : "white"}?
              </Text>
              <ChessBoard
                fen={puzzleFen || current.fen}
                orientation={current.user_color === "black" ? "black" : "white"}
                interactive={!revealed}
                onMove={(uci, san, nextFen) => void onQuizMove(uci, san, nextFen)}
                highlightUci={highlightUci || (revealed ? current.best_uci : null)}
                guessUci={guessUci}
              />

              {revealed && sequencePv.length > 0 ? (
                <BrutalButton
                  label={sequencePlaying ? "Playing sequence…" : "Show sequence"}
                  disabled={sequencePlaying}
                  onPress={() => playContinuation(current.fen, sequencePv)}
                  style={{ marginTop: spacing.md }}
                />
              ) : null}

              <EdgeCard style={{ marginTop: spacing.md }}>
                <View style={styles.moveCompare}>
                  {puzzleMoveSan ? (
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.compareLabel,
                          {
                            color:
                              quizCorrect === false
                                ? result.loss
                                : quizCorrect
                                  ? result.win
                                  : colors.cream,
                          },
                        ]}
                      >
                        Puzzle Move
                      </Text>
                      <Text
                        style={[
                          styles.compareValue,
                          {
                            color:
                              quizCorrect === false
                                ? result.loss
                                : quizCorrect
                                  ? result.win
                                  : colors.cream,
                          },
                        ]}
                      >
                        {puzzleMoveSan}
                        {userMoveEval != null
                          ? ` ${formatEval(userMoveEval)}`
                          : ""}
                      </Text>
                    </View>
                  ) : null}
                  {revealed ? (
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.compareLabel, { color: result.win }]}>
                        Best Move
                      </Text>
                      <Text style={[styles.compareValue, { color: result.win }]}>
                        {current.best_san || current.best_uci}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {revealed && continuation ? (
                  <View style={{ marginTop: spacing.sm }}>
                    <Text style={styles.comment}>
                      Continuation: {continuation}
                    </Text>
                  </View>
                ) : null}
                {revealed && current.gm_game ? (
                  <Text style={[styles.gmGameLine, { marginTop: spacing.xs }]}>
                    GM game: {formatGmGameLabel(current.gm_game)}
                  </Text>
                ) : null}
                {revealed && current.comment ? (
                  <Text style={styles.comment}>{current.comment}</Text>
                ) : null}
                {quizFeedback ? (
                  <Text
                    style={[
                      styles.feedback,
                      {
                        color:
                          quizCorrect === false ? result.loss : colors.cream,
                      },
                    ]}
                  >
                    {quizFeedback}
                  </Text>
                ) : null}
                {!revealed ? (
                  <BrutalButton
                    label="Reveal Best Move"
                    onPress={async () => {
                      if (!current.best_uci) return;
                      if (retryTimerRef.current) {
                        clearTimeout(retryTimerRef.current);
                        retryTimerRef.current = null;
                      }
                      setRevealed(true);
                      setQuizCorrect(null);
                      setQuizFeedback(null);
                      setPuzzleFen(current.fen);
                      setPuzzleMoveSan(current.best_san || current.best_uci);
                      setUserMoveEval(null);
                      setHighlightUci(current.best_uci);
                      setSequencePlaying(false);
                      try {
                        const res = await validateMoveLocal(
                          evaluate,
                          current.fen,
                          current.best_uci,
                          current.best_uci,
                          current.best_pv
                        );
                        setContinuation(res.best_continuation_san);
                        setSequencePv(
                          res.best_pv.length
                            ? res.best_pv
                            : current.best_pv?.length
                              ? current.best_pv
                              : [current.best_uci]
                        );
                      } catch {
                        setContinuation(null);
                        setSequencePv(
                          current.best_pv?.length
                            ? current.best_pv
                            : [current.best_uci]
                        );
                      }
                    }}
                    style={{ marginTop: spacing.sm }}
                  />
                ) : null}
              </EdgeCard>

              <View style={styles.navRow}>
                <BrutalButton label="← Prev" ghost onPress={prevMistake} disabled={idx === 0} style={{ flex: 1 }} />
                <Text style={styles.pageCount}>
                  {idx + 1}/{mistakes.length}
                </Text>
                <BrutalButton
                  label="Next →"
                  ghost
                  onPress={nextMistake}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : null}
        </PageLoadingTransition>
      </View>
      <View style={mode === "repertoire" ? undefined : styles.hiddenTab}>
        <OpeningPrepSection active={mode === "repertoire"} />
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hiddenTab: { display: "none" },
  content: { padding: spacing.md, paddingBottom: 100 },
  tabRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
  },
  tabActive: {
    backgroundColor: colors.red,
    borderColor: colors.text,
    borderWidth: 2,
    shadowColor: colors.shadowGray,
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  tabIdle: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 2,
  },
  tabText: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  center: { alignItems: "center", gap: 8, paddingVertical: 24 },
  muted: {
    color: colors.textDim,
    textAlign: "center",
    fontFamily: font.sans,
    fontSize: 12,
  },
  error: {
    color: colors.red,
    marginBottom: 8,
    fontFamily: font.mono,
  },
  mistakeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  gameIdentity: {
    flex: 1,
  },
  gameDate: {
    color: colors.red,
    fontFamily: font.monoBold,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  opponentName: {
    color: colors.text,
    fontFamily: font.displayMedium,
    fontSize: 20,
    marginBottom: 3,
  },
  gameDetails: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 4,
    textTransform: "capitalize",
  },
  openingLine: {
    color: colors.cream,
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 4,
  },
  metaLine: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  evalSummary: {
    width: 118,
    alignItems: "flex-end",
    gap: 4,
  },
  evalAlign: {
    alignSelf: "flex-end",
    width: "100%",
    alignItems: "flex-end",
    textAlign: "right",
  },
  evalDrop: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 14,
    textAlign: "right",
    width: "100%",
    fontVariant: ["tabular-nums"],
  },
  evalGain: {
    color: result.win,
    fontFamily: font.monoBold,
    fontSize: 12,
    marginBottom: 2,
    textAlign: "right",
    width: "100%",
  },
  mistakePill: {
    alignSelf: "flex-end",
  },
  movePillText: {
    textTransform: "none",
  },
  evalBarTrack: {
    height: 4,
    backgroundColor: result.loss,
    marginBottom: spacing.md,
  },
  evalBarFill: {
    height: 4,
    backgroundColor: result.win,
  },
  prompt: {
    color: colors.text,
    fontFamily: font.displayMedium,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  moveCompare: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.sm },
  compareLabel: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  compareValue: {
    fontFamily: font.display,
    fontSize: 22,
  },
  feedback: {
    marginTop: spacing.sm,
    fontFamily: font.monoBold,
    fontSize: 12,
  },
  comment: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 20,
    fontFamily: font.sans,
    fontSize: 12,
  },
  gmGameLine: {
    color: colors.cream,
    marginTop: 4,
    lineHeight: 18,
    fontFamily: font.mono,
    fontSize: 11,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pageCount: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 12,
    minWidth: 40,
    textAlign: "center",
  },
  sourceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: spacing.sm,
  },
  openingTitle: {
    color: colors.cream,
    fontFamily: font.displayMedium,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  quizGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quizOption: {
    width: "48%",
    flexGrow: 1,
    minWidth: "46%",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  quizOptionText: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 18,
  },
  moveRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moveSan: {
    color: colors.text,
    fontFamily: font.displayMedium,
    fontSize: 16,
  },
  moveMeta: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 12,
    marginTop: 2,
  },
  moveWr: {
    fontFamily: font.display,
    fontSize: 16,
  },
});
