import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  Vibration,
  View,
} from "react-native";
import { Chess } from "chess.js";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ChessBoard } from "../components/ChessBoard";
import { GameEvalGraph } from "../components/GameEvalGraph";
import { OpponentAvatar } from "../components/OpponentAvatar";
import {
  BrutalButton,
  DisplayTitle,
  EdgeCard,
} from "../components/ui";
import { FadeFromBlank } from "../components/LoadingSkeletons";
import { useFilters } from "../context/FilterContext";
import { useAnalytics } from "../context/AnalyticsContext";
import { useTabSwipe } from "../context/TabSwipeContext";
import {
  analyzeSelectedGame,
  buildReplayPlies,
  formatEval,
  linesFromEval,
  stampAccuracyMarks,
  type EngineLine,
  type GameCoachPly,
  type GameCoachResult,
} from "../engine/gameCoach/analyzeGame";
import { formatCommentRefsCompact } from "../engine/gameCoach/commentRefs";
import {
  loadCachedGameAnalysis,
  saveCachedGameAnalysis,
} from "../engine/gameCoach/analysisCache";
import {
  COACH_MARK_COLORS,
  COACH_MARK_LABELS,
  COACH_MARK_ORDER,
  COACH_MARK_SOURCES,
  COACH_THEORY_LEAVE_MARKS,
  countCoachMarksBySide,
  sideAccuracyPct,
} from "../engine/gameCoach/coachMarks";
import { formatOpeningLabel } from "../engine/gameCoach/ecoLabels";
import { formatOpponentName } from "../data/opponentAvatar";
import { computePhaseSplits } from "../engine/gameCoach/phaseSplits";
import { useStockfish } from "../engine/StockfishProvider";
import {
  COACH_ANALYZE_DEPTH,
  COACH_ANALYZE_MOVETIME,
  COACH_ANALYZE_MULTIPV,
  EVAL_BAR_SPEED_PCT_PER_SEC,
  LIVE_EVAL_MULTIPV,
} from "../engine/analysisConfig";
import { evalBarWhiteShare, toWhiteCp } from "../engine/analyzeMistakes";
import { sameMove, sanToUci } from "../engine/chessMoves";
import type { StudyGame } from "../engine/analyzeMistakes";
import { ensureStudyGames } from "../storage/analyticsLoaders";
import type { NormalizedGame } from "../data/platformGames";
import {
  filterNormalizedGames,
  gameHasMoveSource,
  resolveGameWithMoves,
  toStudyGameList,
} from "../data/platformGames";
import type { QueryFilters } from "../api/client";
import { fetchExplorer } from "../api/client";
import { colors, font, radius, result, spacing, type, withAlpha } from "../theme";

/** Matches TabNavigator order: Wrapped, Insights, Study, Games, Profile */
const GAMES_TAB_INDEX = 3;
const GAMES_PAGE_SIZE = 20;

function viewFilteredGames(
  games: StudyGame[],
  filters: QueryFilters
): StudyGame[] {
  if (!filters.speed && !filters.color && !filters.result) return games;
  return toStudyGameList(
    filterNormalizedGames(games as NormalizedGame[], filters)
  );
}

function navHaptic() {
  if (Platform.OS === "web") return;
  if (Platform.OS === "android") {
    Vibration.vibrate(18);
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {
    if (Platform.OS === "ios") {
      Vibration.vibrate(18);
    }
  });
}

function dayKey(value?: string): string {
  if (!value) return "unknown";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatGameDate(value?: string): string {
  if (!value) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  const today = new Date();
  const startToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startToday.getTime() - startThat.getTime()) / 86400000
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDayHeader(key: string): string {
  if (key === "unknown") return "Unknown date";
  return formatGameDate(`${key}T12:00:00`);
}

function resultTone(value?: string): string {
  const v = String(value || "").toLowerCase();
  if (v.includes("win")) return result.win;
  if (v.includes("draw") || v === "1/2-1/2") return result.draw;
  if (v.includes("loss")) return result.loss;
  return colors.textMuted;
}

function userKingBadge(value?: string): "win" | "loss" | null {
  const v = String(value || "").toLowerCase();
  if (v.includes("win")) return "win";
  if (v.includes("loss")) return "loss";
  return null;
}

function overlayMatchScore(value?: string): string {
  const v = String(value || "").toLowerCase();
  if (v.includes("win")) return "1 - 0";
  if (v.includes("draw") || v === "1/2-1/2") return "1/2 - 1/2";
  if (v.includes("loss")) return "0 - 1";
  return "–";
}

export function GamesScreen() {
  const { queryFilters, refreshToken } = useFilters();
  const {
    games: analyticsGames,
    gamesLoading: analyticsGamesLoading,
    requestVaultRemesh,
  } = useAnalytics();
  const { activeTabIndex } = useTabSwipe();
  const { ready: engineReady, error: engineError, evaluate, startLiveEval } =
    useStockfish();
  const gamesTabActive = activeTabIndex === GAMES_TAB_INDEX;

  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [games, setGames] = useState<StudyGame[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [visibleCount, setVisibleCount] = useState(GAMES_PAGE_SIZE);
  const allGamesRef = useRef<StudyGame[]>([]);
  const loadedFiltersKey = useRef<string | null>(null);
  const lastRefreshRef = useRef(refreshToken);
  const visibleCountRef = useRef(GAMES_PAGE_SIZE);

  const [selectedGame, setSelectedGame] = useState<NormalizedGame | null>(null);
  const [openingGame, setOpeningGame] = useState(false);
  const [plies, setPlies] = useState<GameCoachPly[]>([]);
  const [plyIndex, setPlyIndex] = useState(-1);
  const [analysis, setAnalysis] = useState<GameCoachResult | null>(null);
  const [showAccuracyOverlay, setShowAccuracyOverlay] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [liveLines, setLiveLines] = useState<EngineLine[]>([]);
  const [liveCp, setLiveCp] = useState<number | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [boardAnimUci, setBoardAnimUci] = useState<string | null>(null);
  const cancelRef = useRef({ cancelled: false });
  const skipAnimateRef = useRef(false);
  const plyIndexRef = useRef(plyIndex);
  const pliesRef = useRef(plies);
  plyIndexRef.current = plyIndex;
  pliesRef.current = plies;

  const filtersKey = useMemo(
    () =>
      [
        queryFilters.platform,
        queryFilters.username,
        queryFilters.timeframe,
        queryFilters.speed || "",
        queryFilters.color || "",
        queryFilters.result || "",
        queryFilters.dateFrom || "",
        queryFilters.dateTo || "",
      ].join("|"),
    [queryFilters]
  );

  useEffect(() => {
    setSelectedGame(null);
    setPlies([]);
    setPlyIndex(-1);
    setAnalysis(null);
    setAnalyzeError(null);
    setAnalyzeProgress(null);
    setLiveLines([]);
    setLiveCp(null);
    setBoardAnimUci(null);
    setGames([]);
    setHasMore(false);
    setVisibleCount(GAMES_PAGE_SIZE);
    allGamesRef.current = [];
    loadedFiltersKey.current = null;
  }, [filtersKey]);

  const applyVisible = useCallback((all: StudyGame[], count: number) => {
    allGamesRef.current = all;
    const next = Math.min(Math.max(count, GAMES_PAGE_SIZE), all.length || count);
    visibleCountRef.current = next;
    setVisibleCount(next);
    setGames(all.slice(0, next));
    setHasMore(all.length > next);
  }, []);

  const loadList = useCallback(
    async (force: boolean) => {
      if (!queryFilters.username.trim()) {
        setGames([]);
        setHasMore(false);
        allGamesRef.current = [];
        setListError("Sign in / set a username to browse your games.");
        return;
      }
      setListLoading(true);
      setListError(null);
      try {
        const all = await ensureStudyGames(
          queryFilters,
          force ? true : false
        );
        loadedFiltersKey.current = filtersKey;
        applyVisible(all, visibleCountRef.current);
      } catch (err) {
        setListError(err instanceof Error ? err.message : "Failed to load games");
      } finally {
        setListLoading(false);
      }
    },
    [queryFilters, filtersKey, applyVisible]
  );

  useEffect(() => {
    if (!gamesTabActive) return;
    const force = refreshToken !== lastRefreshRef.current;
    lastRefreshRef.current = refreshToken;
    if (force) {
      void loadList(true);
      return;
    }
    if (analyticsGames.length) {
      const filtered = viewFilteredGames(analyticsGames, queryFilters);
      loadedFiltersKey.current = filtersKey;
      setListError(null);
      setListLoading(false);
      applyVisible(filtered, visibleCountRef.current);
      return;
    }
    if (!analyticsGamesLoading) {
      void loadList(false);
    }
  }, [
    gamesTabActive,
    filtersKey,
    refreshToken,
    analyticsGames,
    analyticsGamesLoading,
    queryFilters,
    loadList,
    applyVisible,
  ]);

  const openGame = useCallback(
    async (game: StudyGame) => {
      cancelRef.current.cancelled = true;
      const openToken = { cancelled: false };
      cancelRef.current = openToken;

      setAnalyzing(false);
      setAnalyzeProgress(null);
      setAnalyzeError(null);
      setLiveLines([]);
      setLiveCp(null);
      setBoardAnimUci(null);
      setPlyIndex(-1);
      setPlies([]);
      setAnalysis(null);
      setShowAccuracyOverlay(false);
      setOpeningGame(true);

      const fromList =
        allGamesRef.current.find((g) => g.id === game.id) || game;
      setSelectedGame(fromList as NormalizedGame);

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (openToken.cancelled) {
        setOpeningGame(false);
        return;
      }

      try {
        let full = fromList as NormalizedGame;
        if (!gameHasMoveSource(full)) {
          full = await resolveGameWithMoves(queryFilters, fromList);
          if (openToken.cancelled) return;
          setSelectedGame(full);
        }

        const source = (full.moves_str || full.pgn_str || "").trim();
        setPlies(source ? buildReplayPlies(source) : []);
      } finally {
        if (!openToken.cancelled) setOpeningGame(false);
      }
    },
    [queryFilters]
  );

  const closeGame = useCallback(() => {
    cancelRef.current.cancelled = true;
    setOpeningGame(false);
    setSelectedGame(null);
    setPlies([]);
    setPlyIndex(-1);
    setAnalysis(null);
    setShowAccuracyOverlay(false);
    setAnalyzing(false);
    setAnalyzeProgress(null);
    setAnalyzeError(null);
    setLiveLines([]);
    setLiveCp(null);
  }, []);

  const runAnalyze = useCallback(async () => {
    if (!selectedGame || !engineReady) return;
    const source = (selectedGame.moves_str || selectedGame.pgn_str || "").trim();
    if (!source.trim()) {
      setAnalyzeError("This game has no PGN/moves to analyze.");
      return;
    }
    cancelRef.current = { cancelled: false };
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeProgress("Loading analysis…");
    try {
      const cached = await loadCachedGameAnalysis(
        queryFilters.platform,
        queryFilters.username,
        selectedGame.id
      );
      if (cancelRef.current.cancelled) return;
      if (cached?.plies?.length) {
        const plies = stampAccuracyMarks(cached.plies);
        setAnalysis({ ...cached, plies });
        setPlies(plies);
        setShowAccuracyOverlay(true);
        setAnalyzeProgress(null);
        return;
      }

      setAnalyzeProgress("Starting Stockfish 18…");
      const result = await analyzeSelectedGame({
        gameId: selectedGame.id,
        pgn: selectedGame.pgn_str,
        moves: selectedGame.moves_str,
        eco: selectedGame.opening_eco,
        opening: selectedGame.opening_name,
        userColor: selectedGame.user_color,
        platform: queryFilters.platform,
        username: queryFilters.username,
        userRating:
          selectedGame.user_rating == null
            ? null
            : Number(selectedGame.user_rating),
        speed: selectedGame.speed ?? null,
        timeControl: selectedGame.time_control ?? null,
        result: selectedGame.result ?? null,
        createdAt: selectedGame.created_at ?? null,
        opponentName: selectedGame.opponent_name ?? null,
        evaluate,
        depth: COACH_ANALYZE_DEPTH,
        multiPv: COACH_ANALYZE_MULTIPV,
        movetimeMs: COACH_ANALYZE_MOVETIME,
        signal: cancelRef.current,
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
            white: res.white || 0,
            draws: res.draws || 0,
            black: res.black || 0,
            opening: res.opening,
            fallback: res.fallback,
          };
        },
        onProgress: (p) => {
          setAnalyzeProgress(`${p.status} (${p.ply}/${p.total})`);
        },
      });
      if (cancelRef.current.cancelled) return;
      const plies = stampAccuracyMarks(result.plies);
      setAnalysis({ ...result, plies });
      setPlies(plies);
      setShowAccuracyOverlay(true);
      await saveCachedGameAnalysis(
        queryFilters.platform,
        queryFilters.username,
        result
      );
      requestVaultRemesh();
      setAnalyzeProgress(null);
    } catch (err) {
      if (!cancelRef.current.cancelled) {
        setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
      }
    } finally {
      setAnalyzing(false);
    }
  }, [selectedGame, engineReady, evaluate, queryFilters, requestVaultRemesh]);

  const orientation =
    selectedGame?.user_color === "black" ? "black" : "white";

  const fen = useMemo(() => {
    if (plyIndex < 0 || !plies.length) return new Chess().fen();
    return plies[Math.min(plyIndex, plies.length - 1)]?.fenAfter || new Chess().fen();
  }, [plies, plyIndex]);

  const currentPly = plyIndex >= 0 ? plies[plyIndex] : null;

  // Live MultiPV: uncapped thinking; accuracy marks stay from analyze pass only
  useEffect(() => {
    if (
      !gamesTabActive ||
      !selectedGame ||
      !analysis ||
      !engineReady ||
      analyzing
    ) {
      setLiveLines([]);
      if (!analyzing) setLiveCp(null);
      setLiveBusy(false);
      return;
    }
    const fenNow =
      plyIndex < 0
        ? plies[0]?.fenBefore || new Chess().fen()
        : plies[plyIndex]?.fenAfter || fen;

    const stored =
      plyIndex < 0 ? plies[0]?.lines : plies[plyIndex]?.lines;
    const seedCp =
      plyIndex < 0
        ? plies[0]?.evalBeforeCp ?? null
        : plies[plyIndex]?.evalAfterCp ??
          plies[plyIndex]?.evalBeforeCp ??
          null;
    if (seedCp != null) setLiveCp(seedCp);
    if (stored && stored.length) setLiveLines(stored);

    setLiveBusy(true);
    const stop = startLiveEval(fenNow, LIVE_EVAL_MULTIPV, (ev) => {
      setLiveCp(toWhiteCp(fenNow, ev.cpWhite));
      setLiveLines(linesFromEval(fenNow, ev));
      setLiveBusy(false);
    });
    return () => {
      stop();
    };
  }, [
    gamesTabActive,
    selectedGame,
    analysis,
    engineReady,
    analyzing,
    plyIndex,
    plies,
    fen,
    startLiveEval,
  ]);

  const barAnim = useRef(new Animated.Value(50)).current;
  const barAnimCurrent = useRef(50);

  useEffect(() => {
    const target = evalBarWhiteShare(liveCp ?? 0);
    barAnim.stopAnimation((value) => {
      const from = typeof value === "number" ? value : barAnimCurrent.current;
      barAnimCurrent.current = from;
      const dist = Math.abs(target - from);
      const durationMs = Math.max(
        1,
        (dist / EVAL_BAR_SPEED_PCT_PER_SEC) * 1000
      );
      Animated.timing(barAnim, {
        toValue: target,
        duration: durationMs,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) barAnimCurrent.current = target;
      });
    });
  }, [liveCp, barAnim]);

  const barWidth = barAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  const currentNote = useMemo(() => {
    if (plyIndex < 0) return "";
    return plies[plyIndex]?.note || "";
  }, [plyIndex, plies]);

  const currentNoteRefs = useMemo(() => {
    if (plyIndex < 0) return "";
    return formatCommentRefsCompact(plies[plyIndex]?.noteRefs);
  }, [plyIndex, plies]);

  const graphPoints = useMemo(
    () =>
      plies
        .map((p, plyIndex) => ({
          plyIndex,
          ply: p.ply,
          cp: p.evalAfterCp,
          mark: p.mark,
        }))
        .filter(
          (p): p is {
            plyIndex: number;
            ply: number;
            cp: number;
            mark: typeof p.mark;
          } => p.cp != null
        ),
    [plies]
  );

  const phaseSplits = useMemo(() => {
    if (!analysis?.plies?.length) return null;
    const userColor =
      selectedGame?.user_color === "black" ? "black" : "white";
    return computePhaseSplits(analysis.plies, userColor);
  }, [analysis, selectedGame?.user_color]);

  // Accuracy icons: only from Analyze pass (ply.mark), never from live eval
  const markedPly =
    plyIndex >= 0 && plies[plyIndex]
      ? !boardAnimUci ||
        plies[plyIndex].uci.slice(0, 4) === boardAnimUci.slice(0, 4)
        ? plies[plyIndex]
        : null
      : null;
  const currentMark = markedPly?.mark || null;

  // Board last-move glow only when ply has a coach comment.
  const highlightUci =
    plyIndex >= 0 && plies[plyIndex]?.note?.trim()
      ? plies[plyIndex].uci
      : null;

  const kingBadge =
    plyIndex >= 0 &&
    plyIndex === plies.length - 1 &&
    !boardAnimUci
      ? userKingBadge(selectedGame?.result)
      : null;

  const holdTimers = useRef<{
    delay: ReturnType<typeof setTimeout> | null;
    interval: ReturnType<typeof setInterval> | null;
  }>({ delay: null, interval: null });

  const stopHoldNav = useCallback(() => {
    if (holdTimers.current.delay) clearTimeout(holdTimers.current.delay);
    if (holdTimers.current.interval) clearInterval(holdTimers.current.interval);
    holdTimers.current.delay = null;
    holdTimers.current.interval = null;
    skipAnimateRef.current = false;
  }, []);

  const startHoldNav = useCallback(
    (step: () => void) => {
      stopHoldNav();
      navHaptic();
      skipAnimateRef.current = false;
      step();
      holdTimers.current.delay = setTimeout(() => {
        skipAnimateRef.current = true;
        holdTimers.current.interval = setInterval(step, 85);
      }, 380);
    },
    [stopHoldNav]
  );

  useEffect(() => () => stopHoldNav(), [stopHoldNav]);

  const jumpPly = useCallback((i: number) => {
    setBoardAnimUci(null);
    setPlyIndex(i);
  }, []);

  const prevPly = useCallback(() => {
    const i = plyIndexRef.current;
    if (i <= -1) {
      stopHoldNav();
      return;
    }
    setBoardAnimUci(null);
    const next = i - 1;
    if (next <= -1) stopHoldNav();
    setPlyIndex(next);
  }, [stopHoldNav]);

  const nextPly = useCallback(() => {
    const i = plyIndexRef.current;
    const list = pliesRef.current;
    const max = Math.max(list.length - 1, 0);
    if (i >= max) {
      stopHoldNav();
      return;
    }
    const next = i + 1;
    const uci = list[next]?.uci;
    if (!skipAnimateRef.current && uci) setBoardAnimUci(uci);
    else setBoardAnimUci(null);
    if (next >= max) stopHoldNav();
    setPlyIndex(next);
  }, [stopHoldNav]);

  const clearBoardAnim = useCallback(() => {
    setBoardAnimUci(null);
  }, []);

  const engineArrowUci = useMemo(() => {
    if (!analysis || !currentPly) return null;
    const userColor =
      selectedGame?.user_color === "black" ? "black" : "white";
    if (currentPly.side !== userColor) return null;
    if (!currentPly.mark || !COACH_THEORY_LEAVE_MARKS.has(currentPly.mark))
      return null;
    if (!currentPly.note?.trim()) return null;
    const bestSan =
      currentPly.bestSan ||
      currentPly.bestPvSan[0] ||
      currentPly.lines[0]?.san ||
      "";
    const bestUci = sanToUci(currentPly.fenBefore, bestSan);
    if (bestUci.length < 4) return null;
    if (sameMove(currentPly.fenBefore, currentPly.uci, bestUci)) return null;
    return bestUci;
  }, [analysis, currentPly, selectedGame?.user_color]);

  const gameSections = useMemo(() => {
    const byDay = new Map<string, StudyGame[]>();
    for (const g of games) {
      const key = dayKey(g.created_at);
      const list = byDay.get(key);
      if (list) list.push(g);
      else byDay.set(key, [g]);
    }
    return Array.from(byDay.entries()).map(([key, data]) => ({
      title: formatDayHeader(key),
      key,
      data,
    }));
  }, [games]);

  const accuracyCounts = useMemo(() => {
    if (!analysis?.plies?.length) {
      return { user: {}, opp: {} };
    }
    const userColor =
      selectedGame?.user_color === "black" ? "black" : "white";
    return countCoachMarksBySide(analysis.plies, userColor);
  }, [analysis, selectedGame?.user_color]);

  const accuracyScores = useMemo(() => {
    if (!analysis?.plies?.length) {
      return { user: null as number | null, opp: null as number | null };
    }
    const userColor =
      selectedGame?.user_color === "black" ? "black" : "white";
    const oppColor = userColor === "white" ? "black" : "white";
    return {
      user: sideAccuracyPct(analysis.plies, userColor),
      opp: sideAccuracyPct(analysis.plies, oppColor),
    };
  }, [analysis, selectedGame?.user_color]);

  if (selectedGame) {
    return (
      <FadeFromBlank contentKey={`game-${selectedGame.id}`}>
        <View style={styles.screen}>
          <Pressable onPress={closeGame} style={styles.backRow} hitSlop={8}>
            <Ionicons name="arrow-back" size={18} color={colors.cream} />
            <Text style={styles.backLabel}>Games</Text>
          </Pressable>
          <View style={styles.gameBody}>
            <ScrollView
              style={styles.gameScroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              scrollEnabled={!showAccuracyOverlay}
            >

          <View style={styles.analysisHeader}>
            <OpponentAvatar
              platform={queryFilters.platform}
              username={selectedGame.opponent_name}
              size={44}
            />
            <View style={styles.analysisHeaderText}>
              <DisplayTitle>
                {formatOpponentName(
                  selectedGame.opponent_name,
                  selectedGame.opp_rating
                )}
              </DisplayTitle>
            </View>
          </View>
          <Text style={styles.subtitle}>
            {`${formatGameDate(selectedGame.created_at)} · ${
              selectedGame.speed || "game"
            } · ${selectedGame.result || "?"}`}
          </Text>

          {(() => {
            const compact = formatOpeningLabel(
              selectedGame.opening_eco,
              selectedGame.opening_name
            );
            return compact ? (
              <Text style={styles.openingLine}>{compact}</Text>
            ) : null;
          })()}

          {openingGame ? (
            <View style={styles.openingGameRow}>
              <ActivityIndicator color={colors.red} />
              <Text style={styles.progressText}>Loading game…</Text>
            </View>
          ) : null}

          {!openingGame && !plies.length ? (
            <Text style={styles.errorText}>
              No moves/PGN stored for this game. Pull to refresh the Games list.
            </Text>
          ) : null}

          {analysis ? (
            <View style={styles.evalBlock}>
              <View style={styles.evalSummary}>
                <Text style={styles.evalLabel}>Eval</Text>
                <Text style={styles.evalDrop}>
                  {liveCp == null ? "…" : formatEval(liveCp)}
                  {liveBusy ? " · …" : ""}
                </Text>
              </View>
              <View style={styles.evalBarTrack}>
                <Animated.View style={[styles.evalBarFill, { width: barWidth }]} />
              </View>
              <View style={styles.linesBox}>
                {[0, 1, 2].map((i) => {
                  const line = liveLines[i];
                  return (
                    <Text
                      key={i}
                      style={styles.lineText}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {line ? (
                        <>
                          <Text style={styles.lineRank}>{line.rank}. </Text>
                          <Text style={styles.lineEval}>
                            {formatEval(line.cpWhite)}{" "}
                          </Text>
                          {line.pvSan.join(" ")}
                        </>
                      ) : (
                        " "
                      )}
                    </Text>
                  );
                })}
              </View>
            </View>
          ) : null}

          <EdgeCard style={styles.boardCard}>
            <ChessBoard
              fen={fen}
              orientation={orientation}
              interactive={false}
              highlightUci={highlightUci}
              animateUci={boardAnimUci}
              onAnimateEnd={clearBoardAnim}
              arrowUci={boardAnimUci ? null : engineArrowUci}
              markUci={
                currentMark && markedPly?.uci ? markedPly.uci : null
              }
              markSource={
                currentMark ? COACH_MARK_SOURCES[currentMark] : null
              }
              markKey={
                currentMark && markedPly?.uci
                  ? `${plyIndex}:${currentMark}:${markedPly.uci}`
                  : null
              }
              kingBadge={kingBadge}
            />
          </EdgeCard>

          <View style={styles.navRow}>
            <BrutalButton
              label="Previous"
              ghost
              onPressIn={() => startHoldNav(prevPly)}
              onPressOut={stopHoldNav}
              disabled={plyIndex < 0}
              style={{ flex: 1 }}
            />
            <Text style={styles.pageCount}>
              {plyIndex < 0
                ? ""
                : `${currentPly?.fullmove}${
                    currentPly?.side === "white" ? "." : "..."
                  } ${currentPly?.san || ""}`}
            </Text>
            <BrutalButton
              label="Next"
              ghost
              onPressIn={() => startHoldNav(nextPly)}
              onPressOut={stopHoldNav}
              disabled={!plies.length || plyIndex >= plies.length - 1}
              style={{ flex: 1 }}
            />
          </View>

          {!analysis ? (
            <View style={styles.analyzeRow}>
              <BrutalButton
                label={
                  analyzing
                    ? "Analyzing…"
                    : engineReady
                      ? "Analyze this game"
                      : "Engine loading…"
                }
                onPress={() => void runAnalyze()}
                disabled={!engineReady || analyzing || openingGame || !plies.length}
              />
            </View>
          ) : null}

          {engineError ? <Text style={styles.errorText}>{engineError}</Text> : null}
          {analyzeError ? <Text style={styles.errorText}>{analyzeError}</Text> : null}
          {analyzing && analyzeProgress ? (
            <Text style={styles.progressText}>{analyzeProgress}</Text>
          ) : null}

          {currentNote ? (
            <EdgeCard style={styles.noteCard}>
              <Text style={styles.noteTag}>
                {plyIndex === plies.length - 1 && analysis
                  ? "Summary"
                  : "Book ideas"}
              </Text>
              <Text style={styles.noteBody}>{currentNote}</Text>
              {currentNoteRefs ? (
                <Text style={styles.noteRefs}>{currentNoteRefs}</Text>
              ) : null}
            </EdgeCard>
          ) : null}

          <Text style={styles.movesHeader}>Moves</Text>
          <View style={styles.movesWrap}>
            {plies.map((p, i) => {
              const active = i === plyIndex;
              const noted = Boolean(p.note?.trim());
              return (
                <Pressable
                  key={`${p.ply}-${p.san}`}
                  onPress={() => jumpPly(i)}
                  style={[
                    styles.moveChip,
                    active && styles.moveChipActive,
                    noted && styles.moveChipNoted,
                  ]}
                >
                  <Text
                    style={[
                      styles.moveChipText,
                      active && styles.moveChipTextActive,
                    ]}
                  >
                    {p.side === "white" ? `${p.fullmove}. ` : ""}
                    {p.san}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {analysis && graphPoints.length >= 2 ? (
            <View style={styles.graphBlock}>
              <Text style={[styles.movesHeader, styles.graphHeader]}>
                Eval graph
              </Text>
              <GameEvalGraph
                points={graphPoints}
                currentPly={plyIndex}
                phaseSplits={phaseSplits}
                userColor={
                  selectedGame.user_color === "black" ? "black" : "white"
                }
                onSelectPly={jumpPly}
              />
            </View>
          ) : null}
            </ScrollView>
            {showAccuracyOverlay && analysis ? (
              <View
                style={styles.accuracyOverlay}
                pointerEvents="auto"
              >
                <View style={styles.accuracyCard}>
                  <View style={styles.accuracyBody}>
                  <View style={styles.accuracyHero}>
                    <View style={styles.accuracyHeroSide}>
                      <OpponentAvatar
                        platform={queryFilters.platform}
                        username={queryFilters.username}
                        size={48}
                      />
                      <Text style={styles.accuracyHeroName} numberOfLines={1}>
                        {formatOpponentName(
                          queryFilters.username,
                          selectedGame.user_rating
                        )}
                      </Text>
                      <Text style={styles.accuracyHeroPct}>
                        {accuracyScores.user == null
                          ? "—"
                          : `${accuracyScores.user.toFixed(1)}%`}
                      </Text>
                    </View>
                    <Text style={styles.accuracyHeroScore}>
                      {overlayMatchScore(selectedGame.result)}
                    </Text>
                    <View style={styles.accuracyHeroSide}>
                      <OpponentAvatar
                        platform={queryFilters.platform}
                        username={selectedGame.opponent_name}
                        size={48}
                      />
                      <Text style={styles.accuracyHeroName} numberOfLines={1}>
                        {formatOpponentName(
                          selectedGame.opponent_name,
                          selectedGame.opp_rating
                        )}
                      </Text>
                      <Text style={styles.accuracyHeroPct}>
                        {accuracyScores.opp == null
                          ? "—"
                          : `${accuracyScores.opp.toFixed(1)}%`}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.accuracyTable}>
                    {COACH_MARK_ORDER.map((mark) => {
                      const color = COACH_MARK_COLORS[mark];
                      const you = accuracyCounts.user[mark] || 0;
                      const opp = accuracyCounts.opp[mark] || 0;
                      return (
                        <View key={mark} style={styles.accuracyRow}>
                          <Text
                            style={[
                              styles.accuracyNum,
                              { color: you ? color : colors.textDisabled },
                            ]}
                          >
                            {you}
                          </Text>
                          <View style={styles.accuracyMid}>
                            <View style={styles.accuracyMidInner}>
                              <Image
                                source={COACH_MARK_SOURCES[mark]}
                                fadeDuration={0}
                                resizeMode="contain"
                                style={styles.accuracyGif}
                              />
                              <Text
                                style={[styles.accuracyName, { color }]}
                                numberOfLines={1}
                              >
                                {COACH_MARK_LABELS[mark]}
                              </Text>
                            </View>
                          </View>
                          <Text
                            style={[
                              styles.accuracyNum,
                              { color: opp ? color : colors.textDisabled },
                            ]}
                          >
                            {opp}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                  </View>
                  <BrutalButton
                    label="Continue"
                    onPress={() => setShowAccuracyOverlay(false)}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </FadeFromBlank>
    );
  }

  return (
      <FadeFromBlank contentKey={`games-list-${filtersKey}`}>
        <View style={styles.screen}>
          <View style={styles.listHeader}>
            <DisplayTitle>Games</DisplayTitle>
          </View>

          {listError && !games.length ? (
            <Text style={styles.errorText}>{listError}</Text>
          ) : null}

          {!gamesTabActive ? (
            <Text style={styles.emptyText}>Open this tab to load your games.</Text>
          ) : (
            <SectionList
              sections={gameSections}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              stickySectionHeadersEnabled={false}
              ListEmptyComponent={
                listLoading ? (
                  <ActivityIndicator color={colors.cream} style={{ marginTop: 40 }} />
                ) : (
                  <Text style={styles.emptyText}>
                    No games in this period. Adjust filters or sync from Profile.
                  </Text>
                )
              }
              renderSectionHeader={({ section }) => (
                <Text style={styles.dayHeader}>{section.title}</Text>
              )}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => void openGame(item)}
                  style={({ pressed }) => [
                    styles.gameRow,
                    pressed && styles.gameRowPressed,
                  ]}
                >
                  <OpponentAvatar
                    platform={queryFilters.platform}
                    username={item.opponent_name}
                    size={40}
                  />
                  <View style={styles.gameRowBody}>
                    <View style={styles.gameRowTop}>
                      <Text style={styles.gameOpp} numberOfLines={1}>
                        vs{" "}
                        {formatOpponentName(item.opponent_name, item.opp_rating)}
                      </Text>
                      <Text
                        style={[
                          styles.gameResult,
                          { color: resultTone(item.result) },
                        ]}
                      >
                        {item.result || "—"}
                      </Text>
                    </View>
                    <Text style={styles.gameMeta} numberOfLines={1}>
                      {[
                        item.speed,
                        formatOpeningLabel(item.opening_eco, item.opening_name),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                </Pressable>
              )}
              ListFooterComponent={
                listLoading && games.length ? (
                  <ActivityIndicator
                    color={colors.cream}
                    style={{ marginVertical: 16 }}
                  />
                ) : hasMore ? (
                  <View style={styles.moreRow}>
                    <BrutalButton
                      label="More"
                      ghost
                      onPress={() =>
                        applyVisible(
                          allGamesRef.current,
                          visibleCount + GAMES_PAGE_SIZE
                        )
                      }
                    />
                  </View>
                ) : null
              }
            />
          )}
        </View>
      </FadeFromBlank>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  gameBody: { flex: 1 },
  gameScroll: { flex: 1 },
  accuracyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.bg, 0.88),
    justifyContent: "flex-start",
    paddingHorizontal: spacing.md,
    paddingBottom: 120,
  },
  accuracyCard: {
    width: "100%",
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.rim,
  },
  accuracyBody: {
    flex: 1,
    gap: spacing.lg,
    minHeight: 0,
  },
  accuracyHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  accuracyHeroSide: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  accuracyHeroName: {
    fontFamily: font.sansMedium,
    fontSize: 12,
    color: colors.cream,
    textAlign: "center",
    width: "100%",
  },
  accuracyHeroPct: {
    fontFamily: font.sansBold,
    fontSize: 22,
    color: colors.cream,
  },
  accuracyHeroScore: {
    fontFamily: font.sansBold,
    fontSize: 18,
    color: colors.text,
    textAlign: "center",
    minWidth: 72,
  },
  accuracyTable: {
    flex: 1,
    justifyContent: "space-between",
  },
  accuracyRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  accuracyNum: {
    width: 40,
    textAlign: "center",
    fontFamily: font.sansBold,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },
  accuracyMid: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    minWidth: 0,
  },
  accuracyMidInner: {
    width: 148,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  accuracyGif: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  accuracyName: {
    flex: 1,
    fontFamily: font.sansMedium,
    fontSize: 14,
    textAlign: "left",
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  listHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: 120,
  },
  dayHeader: {
    fontFamily: font.sansMedium,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  moreRow: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  backLabel: {
    fontFamily: font.sansMedium,
    fontSize: type.bodySmall.fontSize,
    color: colors.cream,
  },
  subtitle: {
    fontFamily: font.sans,
    fontSize: type.bodySmall.fontSize,
    lineHeight: type.bodySmall.lineHeight,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  openingLine: {
    fontFamily: font.sans,
    fontSize: type.bodySmall.fontSize,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  evalBlock: { marginBottom: spacing.xs },
  evalSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  evalLabel: { ...type.caption, color: colors.textMuted },
  evalDrop: {
    ...type.numberSm,
    fontSize: 16,
    lineHeight: 21,
    color: colors.text,
  },
  evalBarTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: result.loss,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  evalBarFill: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: result.win,
  },
  linesBox: {
    gap: 4,
    marginBottom: spacing.sm,
    height: 3 * 18 + 2 * 4,
  },
  lineText: {
    fontFamily: font.mono,
    fontSize: type.caption.fontSize,
    lineHeight: 18,
    height: 18,
    color: colors.textSoft,
  },
  lineRank: { color: colors.textDim },
  lineEval: { color: colors.cream, fontFamily: font.monoMedium },
  boardCard: { padding: spacing.sm, alignItems: "center" },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  pageCount: {
    ...type.caption,
    color: colors.textMuted,
    minWidth: 72,
    textAlign: "center",
  },
  analyzeRow: { alignItems: "center", marginTop: spacing.xs },
  openingGameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  progressText: {
    fontFamily: font.sans,
    fontSize: type.caption.fontSize,
    color: colors.textDim,
  },
  errorText: {
    fontFamily: font.sans,
    fontSize: type.bodySmall.fontSize,
    color: colors.danger,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  emptyText: {
    fontFamily: font.sans,
    fontSize: type.bodySmall.fontSize,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 48,
    paddingHorizontal: spacing.lg,
  },
  noteCard: { padding: spacing.md, gap: 6 },
  noteTag: {
    fontFamily: font.sansBold,
    fontSize: type.caption.fontSize,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.cream,
  },
  noteBody: {
    fontFamily: font.sans,
    fontSize: type.body.fontSize,
    lineHeight: 22,
    color: colors.textSoft,
    flexShrink: 0,
  },
  noteRefs: {
    fontFamily: font.sans,
    fontSize: type.caption.fontSize,
    lineHeight: 16,
    color: colors.textMuted,
    marginTop: 2,
  },
  movesHeader: {
    fontFamily: font.sansMedium,
    fontSize: type.bodySmall.fontSize,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  movesWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  moveChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  moveChipActive: {
    borderColor: colors.cream,
    backgroundColor: colors.surfaceRaised,
  },
  moveChipNoted: { borderColor: "rgba(237,231,211,0.35)" },
  moveChipText: {
    fontFamily: font.mono,
    fontSize: type.caption.fontSize,
    color: colors.textMuted,
  },
  moveChipTextActive: { color: colors.cream },
  graphBlock: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    marginHorizontal: -spacing.md,
    overflow: "visible",
  },
  graphHeader: {
    paddingHorizontal: spacing.md,
  },
  gameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  gameRowPressed: { opacity: 0.85 },
  gameRowBody: { flex: 1, minWidth: 0 },
  gameRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  gameOpp: {
    flex: 1,
    fontFamily: font.sansMedium,
    fontSize: type.body.fontSize,
    color: colors.text,
  },
  gameResult: { fontFamily: font.sansBold, fontSize: type.bodySmall.fontSize },
  gameMeta: {
    fontFamily: font.sans,
    fontSize: type.caption.fontSize,
    color: colors.textDim,
  },
  analysisHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 2,
  },
  analysisHeaderText: {
    flex: 1,
    minWidth: 0,
  },
});
