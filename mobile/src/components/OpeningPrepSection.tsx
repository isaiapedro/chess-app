import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Chess } from "chess.js";
import { fetchExplorer, fetchMastersPgn, fetchStudyGames, type MistakeItem } from "../api/client";
import { ChessBoard } from "../components/ChessBoard";
import {
  OpeningChoiceSkeleton,
  PageLoadingTransition,
} from "../components/LoadingSkeletons";
import { BrutalButton, EdgeCard, Pill } from "../components/ui";
import { StudyAnalyzeStatus } from "../components/StudyAnalyzeStatus";
import { useFilters } from "../context/FilterContext";
import {
  APPEND_MOMENTS,
  MIN_CONTINUATION_PLIES,
} from "../engine/analysisConfig";
import type { StudyGame } from "../engine/analyzeMistakes";
import { formatEval } from "../engine/analyzeMistakes";
import { pvToSanLine } from "../engine/analyzeMistakes";
import {
  analyzeOpeningMoments,
  averageUserRating,
  filterGamesByOpening,
  formatOpeningWorsenedComment,
  searchOpeningsForColor,
  topOpeningsForColor,
  usesWinrateHeader,
  validateOpeningMove,
  type OpeningChoice,
  type OpeningMoment,
  type OpeningProgress,
  type ThresholdPass,
} from "../engine/analyzeOpenings";
import { resolveFamilyByName } from "../engine/ecoFamilies";
import { useStockfish } from "../engine/StockfishProvider";
import { applyUciMove } from "../engine/chessMoves";
import { cancelStudyPrefetch } from "../engine/studyPrefetch";
import { formatGmGameLabel } from "../engine/resolveContinuation";
import {
  readCache,
  STUDY_ANALYSIS_TTL_MS,
  writeCache,
} from "../storage/cache";
import { studyOpeningCacheKey } from "../storage/studyCacheKeys";
import { colors, font, result, spacing } from "../theme";

type Phase = "color" | "opening" | "analyze" | "quiz";

type OpeningCachePayload = {
  moments: OpeningMoment[];
  pendingCandidates: OpeningMoment[];
  deferredCandidates?: OpeningMoment[];
  scannedGameIds: string[];
  remaining: number;
  thresholdPass?: ThresholdPass;
  baselineAvailable?: boolean;
};

type PendingOpeningBatch = OpeningCachePayload & {
  previousLength: number;
};

function openingHeaderLabel(
  opening: OpeningChoice | null,
  color: "white" | "black" | null
): string {
  const name = opening?.name || "Opening";
  const side = color || "";
  return side ? `${name} · ${side}` : name;
}

function parseOpeningCache(
  raw: OpeningCachePayload | OpeningMoment[] | null
): OpeningCachePayload | null {
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

type Props = {
  active?: boolean;
};

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

function toStudyGames(rows: Array<Record<string, unknown>>): StudyGame[] {
  return rows.map((row) => ({
    id: String(row.id || ""),
    created_at: String(row.created_at || ""),
    speed: row.speed ? String(row.speed) : undefined,
    user_color: String(row.user_color || "white"),
    result: String(row.result || ""),
    opening_name: row.opening_name ? String(row.opening_name) : undefined,
    opening_eco: row.opening_eco ? String(row.opening_eco) : undefined,
    opponent_name: row.opponent_name ? String(row.opponent_name) : undefined,
    pgn_str: row.pgn_str ? String(row.pgn_str) : undefined,
    moves_str: row.moves_str ? String(row.moves_str) : undefined,
    user_rating:
      row.user_rating != null && Number.isFinite(Number(row.user_rating))
        ? Number(row.user_rating)
        : undefined,
  }));
}

export function OpeningPrepSection({ active = false }: Props = {}) {
  const { queryFilters, refreshToken } = useFilters();
  const { ready: engineReady, evaluate } = useStockfish();

  const [phase, setPhase] = useState<Phase>("color");
  const [color, setColor] = useState<"white" | "black" | null>(null);
  const [allGames, setAllGames] = useState<StudyGame[]>([]);
  const [topOpenings, setTopOpenings] = useState<OpeningChoice[]>([]);
  const [customOpening, setCustomOpening] = useState("");
  const [draftOpening, setDraftOpening] = useState<OpeningChoice | null>(null);
  const [selectedOpening, setSelectedOpening] = useState<OpeningChoice | null>(
    null
  );
  const [loadingGames, setLoadingGames] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moments, setMoments] = useState<OpeningMoment[]>([]);
  const [idx, setIdx] = useState(0);
  const [scanningMore, setScanningMore] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [remainingGames, setRemainingGames] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [scanExhausted, setScanExhausted] = useState(false);
  const [showScanMore, setShowScanMore] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<OpeningProgress | null>(
    null
  );
  const [analyzeLog, setAnalyzeLog] = useState<string[]>([]);
  const scannedIdsRef = useRef<string[]>([]);
  const pendingCandidatesRef = useRef<OpeningMoment[]>([]);
  const deferredCandidatesRef = useRef<OpeningMoment[]>([]);
  const filteredGamesRef = useRef<StudyGame[]>([]);
  const momentsRef = useRef<OpeningMoment[]>([]);
  const thresholdPassRef = useRef<ThresholdPass>("strict");
  const baselineAvailableRef = useRef(false);
  const completionTargetRef = useRef<"quiz" | "scan" | null>(null);
  const backgroundScanningRef = useRef(false);
  const secondPagePrefetchKeyRef = useRef<string | null>(null);
  const pendingBatchRef = useRef<PendingOpeningBatch | null>(null);
  const visibleBatchStartRef = useRef(0);
  const revealPendingOnCompleteRef = useRef(false);
  const [pendingReady, setPendingReady] = useState(false);
  momentsRef.current = moments;

  const finishLoadingVisual = useCallback(() => {
    const target = completionTargetRef.current;
    completionTargetRef.current = null;
    setAnalysisComplete(false);
    if (target === "quiz") {
      setPhase("quiz");
    } else if (target === "scan") {
      setScanningMore(false);
    }
  }, []);

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
  const lastRefreshRef = useRef(refreshToken);
  const gamesLoadedKeyRef = useRef<string | null>(null);

  const current = moments[idx] || null;

  const openingMatches = useMemo(() => {
    if (!color || customOpening.trim().length < 2) return [];
    if (
      draftOpening &&
      customOpening.trim().toLowerCase() === draftOpening.name.toLowerCase()
    ) {
      return [];
    }
    const topKeys = new Set(topOpenings.map((item) => item.key));
    return searchOpeningsForColor(allGames, color, customOpening, 8).filter(
      (item) => !topKeys.has(item.key)
    );
  }, [allGames, color, customOpening, draftOpening, topOpenings]);

  const fillOpeningSearch = (opening: OpeningChoice) => {
    setDraftOpening(opening);
    setCustomOpening(opening.name);
  };

  useEffect(() => {
    const force = refreshToken !== lastRefreshRef.current;
    lastRefreshRef.current = refreshToken;
    const filtersKey = JSON.stringify(queryFilters);
    if (!force && gamesLoadedKeyRef.current === filtersKey) {
      return;
    }
    if (force) gamesLoadedKeyRef.current = null;
    let alive = true;
    setLoadingGames(true);
    setError(null);
    fetchStudyGames(queryFilters, force)
      .then((rows) => {
        if (!alive) return;
        setAllGames(toStudyGames(rows));
        gamesLoadedKeyRef.current = filtersKey;
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Failed to load games");
      })
      .finally(() => {
        if (alive) setLoadingGames(false);
      });
    return () => {
      alive = false;
    };
  }, [queryFilters, refreshToken]);

  useEffect(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
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

  useEffect(() => {
    return () => {
      cancelRef.current.cancelled = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      playTokenRef.current += 1;
    };
  }, []);

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
      for (let k = 0; k <= i; k += 1) fen = applyUci(fen, moves[k]);
      setPuzzleFen(fen);
      setHighlightUci(moves[i] || null);
      i += 1;
      if (i < moves.length) setTimeout(step, 1200);
      else setSequencePlaying(false);
    };
    setTimeout(step, 500);
  }, []);

  const chooseColor = (side: "white" | "black") => {
    setColor(side);
    setTopOpenings(topOpeningsForColor(allGames, side, 3));
    setSelectedOpening(null);
    setCustomOpening("");
    setDraftOpening(null);
    setAllDone(false);
    setShowScanMore(false);
    setScanExhausted(false);
    setMoments([]);
    setIdx(0);
    pendingBatchRef.current = null;
    setPendingReady(false);
    visibleBatchStartRef.current = 0;
    secondPagePrefetchKeyRef.current = null;
    scannedIdsRef.current = [];
    pendingCandidatesRef.current = [];
    deferredCandidatesRef.current = [];
    filteredGamesRef.current = [];
    thresholdPassRef.current = "strict";
    baselineAvailableRef.current = false;
    setRemainingGames(0);
    setPendingCount(0);
    setError(null);
    setPhase("opening");
  };

  const startAnalysis = async (opening: OpeningChoice, force = false) => {
    if (!color) return;
    cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const signal = cancelRef.current;
    const cacheKey = studyOpeningCacheKey(queryFilters, color, opening.key);

    secondPagePrefetchKeyRef.current = null;
    pendingBatchRef.current = null;
    setPendingReady(false);
    visibleBatchStartRef.current = 0;
    completionTargetRef.current = null;
    setAnalysisComplete(false);
    setSelectedOpening(opening);
    setPhase("analyze");
    setAnalyzeStatus("Loading cached analysis…");
    setError(null);
    setMoments([]);
    setIdx(0);
    setAllDone(false);
    setShowScanMore(false);
    setScanExhausted(false);
    scannedIdsRef.current = [];
    pendingCandidatesRef.current = [];
    deferredCandidatesRef.current = [];
    thresholdPassRef.current = "strict";
    baselineAvailableRef.current = false;
    setPendingCount(0);
    setRemainingGames(0);
    setAnalyzeLog([]);
    setAnalyzeProgress(null);

    if (!force) {
      const cached = parseOpeningCache(
        await readCache<OpeningCachePayload | OpeningMoment[]>(
          cacheKey,
          STUDY_ANALYSIS_TTL_MS
        )
      );
      if (cached?.moments.length) {
        if (signal.cancelled) return;
        setMoments(cached.moments);
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
        setScanExhausted(
          thresholdPassRef.current === "baseline" &&
            cached.remaining <= 0 &&
            !(cached.pendingCandidates || []).length
        );
        const filtered = filterGamesByOpening(allGames, color, opening);
        filteredGamesRef.current = filtered;
        setPhase("quiz");
        setAnalyzeStatus(null);
        return;
      }
    }

    if (!engineReady) {
      setError("Waiting for on-device Stockfish…");
      setPhase("opening");
      setAnalyzeStatus(null);
      return;
    }

    cancelStudyPrefetch();
    setAnalyzeStatus("Filtering games…");

    const filtered = filterGamesByOpening(allGames, color, opening);
    filteredGamesRef.current = filtered;
    if (!filtered.length) {
      setError("No games found for that opening in the current sample.");
      setPhase("opening");
      setAnalyzeStatus(null);
      return;
    }

    const rating = averageUserRating(filtered.length ? filtered : allGames);
    let completed = false;
    try {
      const batch = await analyzeOpeningMoments({
        games: filtered,
        color,
        userRating: rating,
        evaluate,
        signal,
        thresholdPass: "strict",
        fetchMastersPgn: async (gameId) => fetchMastersPgn(gameId),
        fetchExplorer: async (fen, source, ratings) => {
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
        },
        onProgress: (p) => {
          setAnalyzeProgress(p);
          setAnalyzeStatus(p.status);
          if (p.log) setAnalyzeLog((prev) => [...prev.slice(-59), p.log!]);
        },
      });
      if (signal.cancelled) return;
      scannedIdsRef.current = batch.scannedGameIds;
      pendingCandidatesRef.current = batch.pendingCandidates;
      deferredCandidatesRef.current = batch.deferredCandidates;
      setPendingCount(batch.pendingCandidates.length);
      setRemainingGames(batch.remaining);
      thresholdPassRef.current = batch.thresholdPass;
      baselineAvailableRef.current = batch.baselineAvailable;
      setScanExhausted(
        batch.thresholdPass === "baseline" &&
          batch.remaining <= 0 &&
          batch.pendingCandidates.length === 0
      );
      setMoments(batch.moments);
      setIdx(0);
      visibleBatchStartRef.current = 0;
      pendingBatchRef.current = null;
      setPendingReady(false);
      secondPagePrefetchKeyRef.current = null;
      if (!batch.moments.length) {
        setError("No opening improvement moments found. Try another opening.");
        setPhase("opening");
        return;
      }
      await writeCache(cacheKey, {
        moments: batch.moments,
        pendingCandidates: batch.pendingCandidates,
        deferredCandidates: batch.deferredCandidates,
        scannedGameIds: batch.scannedGameIds,
        remaining: batch.remaining,
        thresholdPass: batch.thresholdPass,
        baselineAvailable: batch.baselineAvailable,
      } satisfies OpeningCachePayload);
      completed = true;
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : "Opening analysis failed");
      setPhase("opening");
    } finally {
      if (!signal.cancelled) {
        setAnalyzeStatus(null);
        if (completed) {
          completionTargetRef.current = "quiz";
          setAnalysisComplete(true);
        }
      }
    }
  };

  const continueScanOpenings = async (silent = false) => {
    if (
      !color ||
      !selectedOpening ||
      !engineReady ||
      scanningMore ||
      backgroundScanningRef.current ||
      scanExhausted ||
      (silent && pendingBatchRef.current)
    ) {
      return;
    }
    const canBaseline =
      baselineAvailableRef.current ||
      (thresholdPassRef.current === "strict" &&
        remainingGames <= 0 &&
        pendingCount <= 0);
    if (remainingGames <= 0 && pendingCount <= 0 && !canBaseline) {
      return;
    }
    cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const signal = cancelRef.current;
    const keptMoments = momentsRef.current;
    const nextPass: ThresholdPass = canBaseline ? "baseline" : "strict";
    const carriedCandidates = pendingCandidatesRef.current;
    const carriedDeferred = deferredCandidatesRef.current;
    if (!silent) {
      setShowScanMore(false);
      setAllDone(false);
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
        status:
          nextPass === "baseline"
            ? "Baseline pass · broader threshold…"
            : "Scanning next batch…",
        phase: "scan",
        engine: "Stockfish",
      });
      setAnalyzeStatus(
        nextPass === "baseline"
          ? "Baseline pass · broader threshold…"
          : "Scanning next batch…"
      );
    }
    cancelStudyPrefetch();
    if (silent) {
      backgroundScanningRef.current = true;
    } else {
      completionTargetRef.current = null;
      setAnalysisComplete(false);
      setScanningMore(true);
    }
    const cacheKey = studyOpeningCacheKey(
      queryFilters,
      color,
      selectedOpening.key
    );
    const filtered =
      filteredGamesRef.current.length > 0
        ? filteredGamesRef.current
        : filterGamesByOpening(allGames, color, selectedOpening);
    filteredGamesRef.current = filtered;
    const rating = averageUserRating(filtered.length ? filtered : allGames);

    let completed = false;
    try {
      const batch = await analyzeOpeningMoments({
        games: filtered,
        color,
        userRating: rating,
        evaluate,
        signal,
        excludeGameIds: nextPass === "baseline" ? [] : scannedIdsRef.current,
        existingMoments: keptMoments,
        existingCandidates: carriedCandidates,
        existingDeferred: carriedDeferred,
        appendCount: APPEND_MOMENTS,
        stopOnStrict: nextPass === "strict",
        thresholdPass: nextPass,
        fetchMastersPgn: async (gameId) => fetchMastersPgn(gameId),
        fetchExplorer: async (fen, source, ratings) => {
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
        },
        onProgress: silent
          ? undefined
          : (p) => {
              setAnalyzeProgress(p);
              setAnalyzeStatus(p.status);
              if (p.log) setAnalyzeLog((prev) => [...prev.slice(-59), p.log!]);
            },
      });
      if (signal.cancelled) return;
      scannedIdsRef.current =
        nextPass === "baseline"
          ? batch.scannedGameIds
          : [...scannedIdsRef.current, ...batch.scannedGameIds];
      pendingCandidatesRef.current = batch.pendingCandidates;
      deferredCandidatesRef.current = batch.deferredCandidates;
      setPendingCount(batch.pendingCandidates.length);
      setRemainingGames(batch.remaining);
      thresholdPassRef.current = batch.thresholdPass;
      baselineAvailableRef.current = batch.baselineAvailable;
      setScanExhausted(
        batch.thresholdPass === "baseline" &&
          batch.remaining <= 0 &&
          batch.pendingCandidates.length === 0
      );

      const hasNew = batch.moments.length > keptMoments.length;
      if (silent) {
        if (hasNew) {
          pendingBatchRef.current = {
            moments: batch.moments,
            pendingCandidates: batch.pendingCandidates,
            deferredCandidates: batch.deferredCandidates,
            scannedGameIds: scannedIdsRef.current,
            remaining: batch.remaining,
            thresholdPass: batch.thresholdPass,
            baselineAvailable: batch.baselineAvailable,
            previousLength: keptMoments.length,
          };
          setPendingReady(true);
        }
        await writeCache(cacheKey, {
          moments: keptMoments,
          pendingCandidates: batch.pendingCandidates,
          deferredCandidates: batch.deferredCandidates,
          scannedGameIds: scannedIdsRef.current,
          remaining: batch.remaining,
          thresholdPass: batch.thresholdPass,
          baselineAvailable: batch.baselineAvailable,
        } satisfies OpeningCachePayload);
      } else {
        setMoments(batch.moments);
        visibleBatchStartRef.current = hasNew ? keptMoments.length : 0;
        secondPagePrefetchKeyRef.current = null;
        setIdx(
          hasNew
            ? keptMoments.length
            : Math.max(0, batch.moments.length - 1)
        );
        await writeCache(cacheKey, {
          moments: batch.moments,
          pendingCandidates: batch.pendingCandidates,
          deferredCandidates: batch.deferredCandidates,
          scannedGameIds: scannedIdsRef.current,
          remaining: batch.remaining,
          thresholdPass: batch.thresholdPass,
          baselineAvailable: batch.baselineAvailable,
        } satisfies OpeningCachePayload);
        if (!hasNew) {
          setError("No further opening improvement moments found.");
          if (
            batch.remaining > 0 ||
            batch.pendingCandidates.length > 0 ||
            batch.baselineAvailable
          ) {
            setShowScanMore(true);
          } else {
            setAllDone(true);
          }
        } else {
          setError(null);
        }
      }
      completed = true;
    } catch (e) {
      if (!silent && !signal.cancelled) {
        setError(e instanceof Error ? e.message : "Failed to scan more");
      }
    } finally {
      if (silent) {
        backgroundScanningRef.current = false;
        if (revealPendingOnCompleteRef.current) {
          revealPendingOnCompleteRef.current = false;
          const pending = pendingBatchRef.current;
          if (pending) {
            pendingBatchRef.current = null;
            setPendingReady(false);
            setMoments(pending.moments);
            visibleBatchStartRef.current = pending.previousLength;
            secondPagePrefetchKeyRef.current = null;
            setIdx(pending.previousLength);
            setShowScanMore(false);
            setAllDone(false);
            setError(null);
            void writeCache(cacheKey, {
              moments: pending.moments,
              pendingCandidates: pending.pendingCandidates,
              deferredCandidates: pending.deferredCandidates,
              scannedGameIds: pending.scannedGameIds,
              remaining: pending.remaining,
              thresholdPass: pending.thresholdPass,
              baselineAvailable: pending.baselineAvailable,
            } satisfies OpeningCachePayload);
          }
          setScanningMore(false);
        }
      } else if (!signal.cancelled) {
        if (completed) {
          completionTargetRef.current = "scan";
          setAnalysisComplete(true);
        } else {
          setScanningMore(false);
        }
      }
    }
  };

  const applyPendingOpeningBatch = () => {
    const pending = pendingBatchRef.current;
    if (!pending || !color || !selectedOpening) return false;
    pendingBatchRef.current = null;
    setPendingReady(false);
    setMoments(pending.moments);
    visibleBatchStartRef.current = pending.previousLength;
    secondPagePrefetchKeyRef.current = null;
    setIdx(pending.previousLength);
    setShowScanMore(false);
    setAllDone(false);
    setError(null);
    void writeCache(
      studyOpeningCacheKey(queryFilters, color, selectedOpening.key),
      {
        moments: pending.moments,
        pendingCandidates: pending.pendingCandidates,
        deferredCandidates: pending.deferredCandidates,
        scannedGameIds: pending.scannedGameIds,
        remaining: pending.remaining,
        thresholdPass: pending.thresholdPass,
        baselineAvailable: pending.baselineAvailable,
      } satisfies OpeningCachePayload
    );
    return true;
  };

  const requestScanMoreOpenings = () => {
    if (applyPendingOpeningBatch()) return;
    if (backgroundScanningRef.current) {
      revealPendingOnCompleteRef.current = true;
      setScanningMore(true);
      return;
    }
    void continueScanOpenings(false);
  };

  useEffect(() => {
    if (
      !active ||
      phase !== "quiz" ||
      idx !== visibleBatchStartRef.current + 1 ||
      !color ||
      !selectedOpening ||
      scanningMore ||
      scanExhausted ||
      pendingReady ||
      pendingBatchRef.current
    ) {
      return;
    }
    const canLoadMore =
      remainingGames > 0 ||
      pendingCount > 0 ||
      baselineAvailableRef.current ||
      thresholdPassRef.current === "strict";
    if (!canLoadMore) return;
    const key = `${color}:${selectedOpening.key}:batch:${visibleBatchStartRef.current}`;
    if (secondPagePrefetchKeyRef.current === key) return;
    secondPagePrefetchKeyRef.current = key;
    void continueScanOpenings(true);
  }, [
    active,
    phase,
    idx,
    color,
    selectedOpening,
    scanningMore,
    scanExhausted,
    pendingReady,
    remainingGames,
    pendingCount,
  ]);

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

    const res = validateOpeningMove(current.fen, uci, current);
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
    setUserMoveEval(
      res.verdict === "good" && res.user_score != null
        ? Math.round(res.user_score * 10000) / 100
        : null
    );
    setQuizCorrect(true);
    setQuizFeedback(null);
    setPuzzleMoveSan(res.user_san);
    setPuzzleFen(current.fen);
    setHighlightUci(current.best_uci);
    setSequencePv(
      res.best_pv.length
        ? res.best_pv
        : current.best_uci
          ? [current.best_uci]
          : []
    );
    setSequencePlaying(false);
  };

  const resetFlow = useCallback(() => {
    cancelRef.current.cancelled = true;
    setPhase("color");
    setColor(null);
    setSelectedOpening(null);
    setCustomOpening("");
    setDraftOpening(null);
    setMoments([]);
    setIdx(0);
    setError(null);
    setAllDone(false);
    setShowScanMore(false);
    setScanExhausted(false);
    pendingBatchRef.current = null;
    setPendingReady(false);
    visibleBatchStartRef.current = 0;
    secondPagePrefetchKeyRef.current = null;
    scannedIdsRef.current = [];
    pendingCandidatesRef.current = [];
    deferredCandidatesRef.current = [];
    filteredGamesRef.current = [];
    thresholdPassRef.current = "strict";
    baselineAvailableRef.current = false;
    setRemainingGames(0);
    setPendingCount(0);
    setScanningMore(false);
    setTopOpenings([]);
  }, []);

  const filtersKey = useMemo(() => JSON.stringify(queryFilters), [queryFilters]);
  const lastFiltersKeyRef = useRef(filtersKey);

  useEffect(() => {
    if (lastFiltersKeyRef.current === filtersKey) return;
    lastFiltersKeyRef.current = filtersKey;
    resetFlow();
  }, [filtersKey, resetFlow]);

  useEffect(() => {
    if (!color) return;
    setTopOpenings(topOpeningsForColor(allGames, color, 3));
  }, [allGames, color]);

  if (loadingGames) {
    return <OpeningChoiceSkeleton />;
  }

  if (phase === "color") {
    return (
      <View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.prompt}>Which side do you want to study?</Text>
        <View style={styles.choiceRow}>
          <BrutalButton
            label="White"
            onPress={() => chooseColor("white")}
            style={{ flex: 1 }}
          />
          <BrutalButton
            label="Black"
            onPress={() => chooseColor("black")}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    );
  }

  if (phase === "opening" && color) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Text style={styles.prompt}>
          Pick an opening as {color}
        </Text>
        <Text style={styles.muted}>Your 3 most played openings</Text>
        {topOpenings.map((opening) => (
          <Pressable
            key={opening.key}
            style={styles.openingOption}
            onPress={() => void startAnalysis(opening)}
          >
            <Text style={styles.openingOptionTitle}>
              {opening.name}
            </Text>
            <Text style={styles.openingOptionMeta}>
              {opening.ecoLabel && opening.ecoLabel !== "UNK"
                ? `${opening.ecoLabel} · `
                : ""}
              {opening.games} games
            </Text>
          </Pressable>
        ))}
        {!topOpenings.length ? (
          <Text style={styles.muted}>No openings found for {color}.</Text>
        ) : null}

        <Text style={[styles.muted, { marginTop: spacing.md }]}>
          Or type a different opening
        </Text>
        <TextInput
          value={customOpening}
          onChangeText={(value) => {
            setCustomOpening(value);
            setDraftOpening(null);
          }}
          placeholder="e.g. Sicilian Defense"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {openingMatches.length ? (
          <View style={styles.suggestList}>
            {openingMatches.map((opening) => (
              <Pressable
                key={opening.key}
                style={styles.suggestOption}
                onPress={() => fillOpeningSearch(opening)}
              >
                <Text style={styles.openingOptionTitle}>
                  {opening.name}
                </Text>
                <Text style={styles.openingOptionMeta}>
                  {opening.ecoLabel && opening.ecoLabel !== "UNK"
                    ? `${opening.ecoLabel} · `
                    : ""}
                  {opening.games} games
                </Text>
              </Pressable>
            ))}
          </View>
        ) : customOpening.trim().length >= 2 && !draftOpening ? (
          <Text style={styles.muted}>No matching openings in your games.</Text>
        ) : null}
        <BrutalButton
          label="Study custom opening"
          disabled={!customOpening.trim()}
          onPress={() => {
            if (
              draftOpening &&
              draftOpening.name.toLowerCase() ===
                customOpening.trim().toLowerCase()
            ) {
              void startAnalysis(draftOpening);
              return;
            }
            const typed = customOpening.trim();
            const family = resolveFamilyByName(typed);
            void startAnalysis(
              family
                ? {
                    key: family.key,
                    eco: family.ecoLabel,
                    ecoLabel: family.ecoLabel,
                    name: family.name,
                    games: 0,
                  }
                : {
                    key: typed.toLowerCase(),
                    eco: "UNK",
                    name: typed,
                    games: 0,
                  }
            );
          }}
          style={{ marginTop: spacing.sm }}
        />
        <BrutalButton
          label="← Back"
          ghost
          onPress={() => setPhase("color")}
          style={{ marginTop: spacing.md }}
        />
      </KeyboardAvoidingView>
    );
  }

  if (phase === "analyze" || scanningMore || phase === "quiz") {
    let content: React.ReactNode = null;
    if (showScanMore) {
      content = (
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.openingTitle}>
              {openingHeaderLabel(selectedOpening, color)}
            </Text>
            <BrutalButton label="Change" ghost onPress={resetFlow} />
          </View>
          <View style={styles.center}>
            <BrutalButton
              label="Scan more"
              disabled={!engineReady}
              onPress={requestScanMoreOpenings}
            />
          </View>
        </View>
      );
    } else if (allDone) {
      content = (
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.openingTitle}>
              {openingHeaderLabel(selectedOpening, color)}
            </Text>
            <BrutalButton label="Change" ghost onPress={resetFlow} />
          </View>
          <Text style={[styles.muted, { marginTop: spacing.sm }]}>
            That&apos;s all for today — every candidate position from these games
            has been reviewed.
          </Text>
        </View>
      );
    } else if (!current) {
      content = (
        <View>
          <Text style={styles.muted}>No moments to study.</Text>
          <BrutalButton label="Choose another opening" onPress={resetFlow} />
        </View>
      );
    } else {
      const asMistake = current as MistakeItem;
      const showWinrateHeader = usesWinrateHeader(current);
      const worsenedComment = formatOpeningWorsenedComment(current);

      content = (
        <View>
      <View style={styles.headerRow}>
        <Text style={styles.openingTitle}>
          {openingHeaderLabel(selectedOpening, color)}
        </Text>
        <BrutalButton label="Change" ghost onPress={resetFlow} />
      </View>

      <View style={styles.mistakeHeader}>
        <View style={styles.gameIdentity}>
          <Text style={styles.gameDate}>
            {formatGameDate(asMistake.created_at)}
          </Text>
          <Text style={styles.opponentName}>
            vs {asMistake.opponent_name || "Unknown opponent"}
          </Text>
          <Text style={styles.gameDetails}>
            {asMistake.opening_name ||
              selectedOpening?.name ||
              "Unknown opening"}
          </Text>
          <Text style={styles.gameDetails}>
            {asMistake.speed || "Unknown format"} · Move{" "}
            {asMistake.move_number || Math.floor(asMistake.ply / 2) + 1}
          </Text>
        </View>
        <View style={styles.evalSummary}>
          {showWinrateHeader ? (
            <>
              <Text style={styles.metaLine}>Win rate gap</Text>
              <Text style={styles.evalDrop}>
                {((current.winrate_played ?? 0) * 100).toFixed(0)}% →{" "}
                {((current.winrate_best ?? 0) * 100).toFixed(0)}%
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.metaLine}>Eval</Text>
              <Text style={styles.evalDrop}>
                {formatEval(asMistake.eval_after_cp)} →{" "}
                {formatEval(asMistake.eval_before_cp)}
              </Text>
            </>
          )}
          <Pill
            color={result.loss}
            style={styles.mistakePill}
            textStyle={styles.movePillText}
          >
            Played {current.played_san}
          </Pill>
        </View>
      </View>

      <Text style={styles.prompt}>
        What is the best move for {color}?
      </Text>
      <ChessBoard
        fen={puzzleFen || current.fen}
        orientation={color === "black" ? "black" : "white"}
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
                {!showWinrateHeader && userMoveEval != null
                  ? ` ${userMoveEval.toFixed(0)}%`
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
            <Text style={styles.comment}>Continuation: {continuation}</Text>
          </View>
        ) : null}
        {revealed && current.gm_game ? (
          <Text style={[styles.gmGameLine, { marginTop: spacing.xs }]}>
            GM game: {formatGmGameLabel(current.gm_game)}
          </Text>
        ) : null}
        {revealed && current.frequency_note ? (
          <Text style={[styles.comment, { marginTop: spacing.xs }]}>
            {current.frequency_note}
          </Text>
        ) : null}
        {revealed && current.comment ? (
          <Text style={styles.comment}>{worsenedComment}</Text>
        ) : null}
        {quizFeedback ? (
          <Text
            style={[
              styles.feedback,
              { color: quizCorrect === false ? result.loss : colors.cream },
            ]}
          >
            {quizFeedback}
          </Text>
        ) : null}
        {!revealed ? (
          <BrutalButton
            label="Reveal Best Move"
            onPress={() => {
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
              setContinuation(
                pvToSanLine(
                  current.fen,
                  current.best_pv || [],
                  MIN_CONTINUATION_PLIES
                ) || current.best_san
              );
              setSequencePv(
                current.best_pv?.length
                  ? current.best_pv
                  : [current.best_uci]
              );
            }}
            style={{ marginTop: spacing.sm }}
          />
        ) : null}
      </EdgeCard>

      <View style={styles.navRow}>
        <BrutalButton
          label="← Prev"
          ghost
          onPress={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          style={{ flex: 1 }}
        />
        <Text style={styles.pageCount}>
          {idx + 1}/{moments.length}
        </Text>
        <BrutalButton
          label="Next →"
          ghost
          onPress={() => {
            if (idx >= moments.length - 1) {
              const canScanMore =
                pendingReady ||
                (!scanExhausted &&
                  (remainingGames > 0 ||
                    pendingCount > 0 ||
                    baselineAvailableRef.current ||
                    (thresholdPassRef.current === "strict" &&
                      remainingGames <= 0)));
              if (canScanMore) {
                setShowScanMore(true);
                setAllDone(false);
              } else {
                setShowScanMore(false);
                setAllDone(true);
              }
              return;
            }
            setAllDone(false);
            setShowScanMore(false);
            setIdx((i) => Math.min(moments.length - 1, i + 1));
          }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
      );
    }

    return (
      <PageLoadingTransition
        active={phase === "analyze" || scanningMore}
        contentKey={
          showScanMore
            ? "scan-more"
            : allDone
              ? "all-done"
              : !current
                ? "empty"
                : `batch:${visibleBatchStartRef.current}:${moments.length}`
        }
        loader={
          <View style={styles.center}>
            <StudyAnalyzeStatus
              progress={analyzeProgress}
              logLines={analyzeLog}
              targetMoments={5}
              fallback={
                analyzeStatus ||
                "Scanning opening games against Lichess & Masters…"
              }
              complete={analysisComplete}
              onComplete={finishLoadingVisual}
            />
            {!engineReady ? (
              <Text style={styles.muted}>Waiting for on-device Stockfish…</Text>
            ) : null}
          </View>
        }
      >
        {content}
      </PageLoadingTransition>
    );
  }
}

const styles = StyleSheet.create({
  center: { alignItems: "center", paddingVertical: spacing.lg, gap: 10 },
  prompt: {
    color: colors.cream,
    fontFamily: font.display,
    fontSize: 22,
    marginBottom: spacing.md,
  },
  muted: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  error: {
    color: result.loss,
    fontFamily: font.mono,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  choiceRow: { flexDirection: "row", gap: spacing.sm },
  openingOption: {
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  openingOptionTitle: {
    color: colors.cream,
    fontFamily: font.monoBold,
    fontSize: 14,
  },
  openingOptionMeta: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    marginTop: 4,
  },
  suggestList: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    gap: 6,
  },
  suggestOption: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.charcoal,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.cream,
    fontFamily: font.mono,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  openingTitle: {
    flex: 1,
    color: colors.cream,
    fontFamily: font.display,
    fontSize: 20,
  },
  mistakeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  gameIdentity: { flex: 1 },
  gameDate: {
    color: colors.cream,
    fontFamily: font.monoBold,
    fontSize: 13,
  },
  opponentName: {
    color: colors.cream,
    fontFamily: font.mono,
    fontSize: 12,
    marginTop: 2,
  },
  gameDetails: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    marginTop: 2,
  },
  evalSummary: { alignItems: "flex-end", maxWidth: "42%" },
  metaLine: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  evalDrop: {
    color: colors.cream,
    fontFamily: font.monoBold,
    fontSize: 14,
    marginTop: 2,
  },
  mistakePill: { alignSelf: "flex-end", marginTop: 6 },
  movePillText: { textTransform: "none" },
  moveCompare: { flexDirection: "row", gap: spacing.md },
  compareLabel: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  compareValue: {
    fontFamily: font.monoBold,
    fontSize: 18,
  },
  comment: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  gmGameLine: {
    color: colors.cream,
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  feedback: {
    fontFamily: font.mono,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pageCount: {
    color: colors.textDim,
    fontFamily: font.monoBold,
    fontSize: 12,
  },
});
