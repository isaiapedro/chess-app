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
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Chess } from "chess.js";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ChessBoard, MOVE_ANIM_MS } from "../components/ChessBoard";
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
import { gameEndKingVisual } from "../engine/gameEndKingBadge";
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
import {
  buildEngineVariant,
  engineLineArrowUci,
  type EngineVariantMove,
} from "../engine/gameCoach/engineVariant";
import { AppIcon } from "../icons";
import {
  ENGINE_VARIANT_COLOR,
  GAME_LINE_COLOR,
  activeLineColor,
  applyBoardMove,
  enterUserVariant,
  leaveSidelineToGame,
  lineFen,
  lineSwitchAnims,
  sidelinesVisibleAt,
  stepUserExplore,
  truncateUserVariant,
  userVariantsAt,
  type BoardAnimStep,
  type ExploreState,
  type UserVariantRecord,
} from "../engine/gameCoach/userVariant";
import { Trash2 } from "lucide-react-native";
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

const GAMES_TAB_INDEX = 1;
const GAMES_PAGE_SIZE = 20;
const HOLD_NAV_MAX_MULT = 20;
const HOLD_NAV_RAMP_MS = 1600;

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

function overlayMatchScore(value?: string): string {
  const v = String(value || "").toLowerCase();
  if (v.includes("win")) return "1 - 0";
  if (v.includes("draw") || v === "1/2-1/2") return "1/2 - 1/2";
  if (v.includes("loss")) return "0 - 1";
  return "–";
}

function EngineGameFill({
  active,
  fillId,
}: {
  active: boolean;
  fillId: string;
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const op = active ? 0.36 : 0.22;
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== box.w || height !== box.h) setBox({ w: width, h: height });
      }}
    >
      {box.w > 0 && box.h > 0 ? (
        <Svg width={box.w} height={box.h}>
          <Defs>
            <LinearGradient
              id={fillId}
              x1="0"
              y1="0"
              x2={box.w}
              y2="0"
              gradientUnits="userSpaceOnUse"
            >
              <Stop
                offset="0"
                stopColor={ENGINE_VARIANT_COLOR}
                stopOpacity={op}
              />
              <Stop
                offset="1"
                stopColor={GAME_LINE_COLOR}
                stopOpacity={op}
              />
            </LinearGradient>
          </Defs>
          <Rect width={box.w} height={box.h} fill={`url(#${fillId})`} />
        </Svg>
      ) : null}
    </View>
  );
}

function HintedMoveChip({
  label,
  active,
  noted,
  engineFork,
  userFork,
  onPress,
}: {
  label: string;
  active: boolean;
  noted: boolean;
  engineFork: boolean;
  userFork: boolean;
  onPress: () => void;
}) {
  const mixId = `eg${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const mixed = engineFork && userFork;
  const outline = mixed || engineFork
    ? ENGINE_VARIANT_COLOR
    : userFork
      ? GAME_LINE_COLOR
      : null;
  const fill = mixed
    ? "transparent"
    : outline
      ? withAlpha(outline, active ? 0.28 : 0.16)
      : undefined;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.moveChip,
        active && !outline && styles.moveChipActive,
        noted && !outline && styles.moveChipNoted,
        outline && {
          borderColor: outline,
          backgroundColor: fill,
          overflow: "hidden",
        },
      ]}
    >
      {mixed ? <EngineGameFill active={active} fillId={mixId} /> : null}
      <Text
        style={[
          styles.moveChipText,
          styles.moveChipLabel,
          active && styles.moveChipTextActive,
          Boolean(outline) && !active && { color: colors.cream },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function BranchChips({
  moves,
  color,
  openMark,
  closeMark,
  activeDepth,
  onPressDepth,
  onDeleteDepth,
}: {
  moves: EngineVariantMove[];
  color: string;
  openMark: string;
  closeMark: string;
  activeDepth: number | null;
  onPressDepth: (depth: number) => void;
  onDeleteDepth?: (depth: number) => void;
}) {
  if (!moves.length) return null;
  return (
    <View style={styles.variantGroup}>
      <Text style={[styles.variantMark, { color }]}>{openMark}</Text>
      {moves.map((m, d) => {
        const vActive = activeDepth === d;
        return (
          <View key={`${d}-${m.uci}`} style={styles.variantChipRow}>
            <Pressable
              onPress={() => onPressDepth(d)}
              style={[
                styles.moveChip,
                {
                  borderColor: withAlpha(color, vActive ? 1 : 0.45),
                  backgroundColor: vActive
                    ? colors.surfaceRaised
                    : withAlpha(color, 0.08),
                },
              ]}
            >
              <Text
                style={[
                  styles.moveChipText,
                  { color: vActive ? colors.cream : color },
                ]}
              >
                {m.side === "white" ? `${m.fullmove}. ` : ""}
                {m.san}
              </Text>
            </Pressable>
            {vActive && onDeleteDepth ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete from this move"
                onPress={() => onDeleteDepth(d)}
                hitSlop={8}
                style={[
                  styles.variantDelete,
                  { borderColor: withAlpha(color, 0.7) },
                ]}
              >
                <AppIcon icon={Trash2} size={13} color={color} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Text style={[styles.variantMark, { color }]}>{closeMark}</Text>
    </View>
  );
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
  const [boardAnimSteps, setBoardAnimSteps] = useState<BoardAnimStep[] | null>(
    null
  );
  const [variantCursor, setVariantCursor] = useState<{
    plyIndex: number;
    depth: number;
  } | null>(null);
  const [explore, setExplore] = useState<ExploreState | null>(null);
  const [userVariants, setUserVariants] = useState<UserVariantRecord[]>([]);
  const cancelRef = useRef({ cancelled: false });
  const skipAnimateRef = useRef(false);
  const plyIndexRef = useRef(plyIndex);
  const pliesRef = useRef(plies);
  const variantCursorRef = useRef(variantCursor);
  const exploreRef = useRef(explore);
  const userVariantsRef = useRef(userVariants);
  plyIndexRef.current = plyIndex;
  pliesRef.current = plies;
  variantCursorRef.current = variantCursor;
  exploreRef.current = explore;
  userVariantsRef.current = userVariants;

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
    setBoardAnimSteps(null);
    setVariantCursor(null);
    setExplore(null);
    setUserVariants([]);
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
      setBoardAnimSteps(null);
      setVariantCursor(null);
      setExplore(null);
      setUserVariants([]);
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
    setBoardAnimUci(null);
    setBoardAnimSteps(null);
    setVariantCursor(null);
    setExplore(null);
    setUserVariants([]);
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
        const refreshed = { ...cached, plies };
        setAnalysis(refreshed);
        setPlies(plies);
        setShowAccuracyOverlay(true);
        setAnalyzeProgress(null);
        if (plies !== cached.plies) {
          // Persist lazy mark/comparison migration without delaying the review.
          void saveCachedGameAnalysis(
            queryFilters.platform,
            queryFilters.username,
            refreshed
          );
        }
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
      const reviewed = { ...result, plies };
      setAnalysis(reviewed);
      setPlies(plies);
      setShowAccuracyOverlay(true);
      await saveCachedGameAnalysis(
        queryFilters.platform,
        queryFilters.username,
        reviewed
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

  const engineVariants = useMemo(
    () => (analysis ? plies.map((p, i) => buildEngineVariant(p, i)) : []),
    [analysis, plies]
  );
  const engineVariantsRef = useRef(engineVariants);
  engineVariantsRef.current = engineVariants;

  const activeVariantMoves =
    variantCursor != null
      ? engineVariants[variantCursor.plyIndex]?.moves
      : null;
  const activeVariantMove =
    activeVariantMoves && variantCursor != null
      ? activeVariantMoves[variantCursor.depth] ?? null
      : null;
  const exploreMove =
    explore && explore.depth >= 0
      ? explore.moves[explore.depth] ?? null
      : null;
  const lineMove = exploreMove || activeVariantMove;
  const startFen = plies[0]?.fenBefore || new Chess().fen();
  const fen = useMemo(
    () =>
      lineFen(
        { plyIndex, engineCursor: variantCursor, explore },
        plies,
        engineVariants,
        startFen
      ),
    [plies, plyIndex, variantCursor, explore, engineVariants, startFen]
  );
  const boardRimColor = activeLineColor({
    engineCursor: variantCursor,
    explore,
  });

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
    const offMain = Boolean(activeVariantMove || explore);
    const fenNow = fen;

    const stored = offMain
      ? []
      : plyIndex < 0
        ? plies[0]?.lines
        : plies[plyIndex]?.lines;
    const seedCp = offMain
      ? null
      : plyIndex < 0
        ? plies[0]?.evalBeforeCp ?? null
        : plies[plyIndex]?.evalAfterCp ??
          plies[plyIndex]?.evalBeforeCp ??
          null;
    if (seedCp != null) setLiveCp(seedCp);
    if (stored && stored.length) setLiveLines(stored);
    else if (offMain) setLiveLines([]);

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
    activeVariantMove,
    explore,
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
    !variantCursor && !explore && plyIndex >= 0 && plies[plyIndex]
      ? plies[plyIndex]
      : null;
  const currentMark = markedPly?.mark || null;

  const highlightUci =
    !lineMove && plyIndex >= 0 && plies[plyIndex]?.note?.trim()
      ? plies[plyIndex].uci
      : null;

  const kingBadge =
    plyIndex >= 0 &&
    plyIndex === plies.length - 1 &&
    !variantCursor &&
    !explore
      ? gameEndKingVisual(selectedGame?.result, orientation)?.kind ?? null
      : null;

  const holdNavTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdNavGen = useRef(0);

  const stopHoldNav = useCallback(() => {
    holdNavGen.current += 1;
    if (holdNavTimer.current != null) clearTimeout(holdNavTimer.current);
    holdNavTimer.current = null;
    skipAnimateRef.current = false;
  }, []);

  const startHoldNav = useCallback(
    (step: () => void) => {
      stopHoldNav();
      navHaptic();
      skipAnimateRef.current = false;
      const startedAt = Date.now();
      const gen = holdNavGen.current;
      step();
      if (gen !== holdNavGen.current) return;
      const schedule = () => {
        if (gen !== holdNavGen.current) return;
        const elapsed = Date.now() - startedAt;
        const progress = Math.min(1, elapsed / HOLD_NAV_RAMP_MS);
        const delay = MOVE_ANIM_MS / HOLD_NAV_MAX_MULT ** progress;
        skipAnimateRef.current = delay < MOVE_ANIM_MS;
        holdNavTimer.current = setTimeout(() => {
          if (gen !== holdNavGen.current) return;
          step();
          schedule();
        }, delay);
      };
      schedule();
    },
    [stopHoldNav]
  );

  useEffect(() => () => stopHoldNav(), [stopHoldNav]);

  const playLineNav = useCallback(
    (
      next: {
        plyIndex: number;
        engineCursor: { plyIndex: number; depth: number } | null;
        explore: ExploreState | null;
        userVariants?: UserVariantRecord[];
      },
      animate: boolean
    ) => {
      const from = {
        plyIndex: plyIndexRef.current,
        engineCursor: variantCursorRef.current,
        explore: exploreRef.current,
      };
      const startFen =
        pliesRef.current[0]?.fenBefore || new Chess().fen();
      const steps =
        animate && !skipAnimateRef.current
          ? lineSwitchAnims(
              from,
              next,
              pliesRef.current,
              engineVariantsRef.current,
              startFen
            )
          : [];
      setPlyIndex(next.plyIndex);
      setVariantCursor(next.engineCursor);
      setExplore(next.explore);
      if (next.userVariants) setUserVariants(next.userVariants);
      setBoardAnimUci(null);
      setBoardAnimSteps(steps.length ? steps : null);
    },
    []
  );

  const jumpPly = useCallback((i: number) => {
    playLineNav({ plyIndex: i, engineCursor: null, explore: null }, false);
  }, [playLineNav]);

  const enterVariant = useCallback((plyAt: number, depth: number) => {
    const moves = engineVariantsRef.current[plyAt]?.moves;
    if (!moves?.[depth]) return;
    playLineNav(
      {
        plyIndex: plyAt,
        engineCursor: { plyIndex: plyAt, depth },
        explore: null,
      },
      true
    );
  }, [playLineNav]);

  const openUserVariant = useCallback((id: string, depth: number) => {
    const entered = enterUserVariant(userVariantsRef.current, id, depth);
    if (!entered) return;
    playLineNav(
      {
        plyIndex: entered.baseIdx,
        engineCursor: null,
        explore: entered,
      },
      true
    );
  }, [playLineNav]);

  const deleteFromUserMove = useCallback((id: string, depth: number) => {
    const next = truncateUserVariant(
      {
        plyIndex: plyIndexRef.current,
        engineCursor: variantCursorRef.current,
        explore: exploreRef.current,
        userVariants: userVariantsRef.current,
      },
      id,
      depth
    );
    playLineNav(next, false);
    setUserVariants(next.userVariants);
  }, [playLineNav]);

  const prevPly = useCallback(() => {
    const exp = exploreRef.current;
    if (exp) {
      const stepped = stepUserExplore(exp, -1);
      if (
        stepped.explore === exp &&
        stepped.explore.depth === exp.depth
      ) {
        stopHoldNav();
        return;
      }
      playLineNav(
        {
          plyIndex: stepped.plyIndex,
          engineCursor: stepped.engineCursor,
          explore: stepped.explore,
        },
        !skipAnimateRef.current
      );
      return;
    }
    const cursor = variantCursorRef.current;
    if (cursor) {
      if (cursor.depth <= 0) {
        playLineNav(
          leaveSidelineToGame({
            plyIndex: cursor.plyIndex,
            engineCursor: cursor,
            explore: null,
          }),
          !skipAnimateRef.current
        );
        return;
      }
      playLineNav(
        {
          plyIndex: cursor.plyIndex,
          engineCursor: { plyIndex: cursor.plyIndex, depth: cursor.depth - 1 },
          explore: null,
        },
        !skipAnimateRef.current
      );
      return;
    }
    const i = plyIndexRef.current;
    if (i <= -1) {
      stopHoldNav();
      return;
    }
    const next = i - 1;
    if (next <= -1) stopHoldNav();
    playLineNav(
      { plyIndex: next, engineCursor: null, explore: null },
      !skipAnimateRef.current
    );
  }, [playLineNav, stopHoldNav]);

  const nextPly = useCallback(() => {
    const exp = exploreRef.current;
    if (exp) {
      const stepped = stepUserExplore(exp, 1);
      if (!stepped.explore || stepped.explore.depth === exp.depth) {
        stopHoldNav();
        return;
      }
      if (stepped.explore.depth >= stepped.explore.moves.length - 1) {
        stopHoldNav();
      }
      playLineNav(
        {
          plyIndex: stepped.plyIndex,
          engineCursor: null,
          explore: stepped.explore,
        },
        !skipAnimateRef.current
      );
      return;
    }
    const cursor = variantCursorRef.current;
    if (cursor) {
      const moves = engineVariantsRef.current[cursor.plyIndex]?.moves;
      const next = cursor.depth + 1;
      if (!moves || next >= moves.length) {
        stopHoldNav();
        return;
      }
      if (next >= moves.length - 1) stopHoldNav();
      playLineNav(
        {
          plyIndex: cursor.plyIndex,
          engineCursor: { plyIndex: cursor.plyIndex, depth: next },
          explore: null,
        },
        !skipAnimateRef.current
      );
      return;
    }
    const i = plyIndexRef.current;
    const list = pliesRef.current;
    const max = Math.max(list.length - 1, 0);
    if (i >= max) {
      stopHoldNav();
      return;
    }
    const next = i + 1;
    if (next >= max) stopHoldNav();
    playLineNav(
      { plyIndex: next, engineCursor: null, explore: null },
      !skipAnimateRef.current
    );
  }, [playLineNav, stopHoldNav]);

  const clearBoardAnim = useCallback(() => {
    setBoardAnimUci(null);
    setBoardAnimSteps(null);
  }, []);

  const engineArrowUci = useMemo(() => {
    const lineUci = engineLineArrowUci(
      { plyIndex, engineCursor: variantCursor, explore },
      engineVariants
    );
    if (lineUci) return lineUci;
    if (explore || variantCursor || !analysis || !currentPly) return null;
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
  }, [
    analysis,
    currentPly,
    selectedGame?.user_color,
    variantCursor,
    engineVariants,
    plyIndex,
    explore,
  ]);

  const onEngineArrowPress = useCallback(() => {
    const exp = exploreRef.current;
    if (exp) {
      const stepped = stepUserExplore(exp, 1);
      if (!stepped.explore || stepped.explore.depth === exp.depth) return;
      playLineNav(
        {
          plyIndex: stepped.plyIndex,
          engineCursor: null,
          explore: stepped.explore,
        },
        true
      );
      return;
    }
    if (variantCursor) {
      const next = variantCursor.depth + 1;
      const moves = engineVariantsRef.current[variantCursor.plyIndex]?.moves;
      if (moves && next < moves.length) enterVariant(variantCursor.plyIndex, next);
      return;
    }
    if (plyIndex < 0) return;
    if (!engineVariantsRef.current[plyIndex]?.moves.length) return;
    enterVariant(plyIndex, 0);
  }, [variantCursor, plyIndex, enterVariant, playLineNav]);

  const arrowPressable = Boolean(
    engineArrowUci &&
      (explore
        ? explore.depth + 1 < explore.moves.length
        : variantCursor
          ? (activeVariantMoves?.length ?? 0) > variantCursor.depth + 1
          : Boolean(engineVariants[plyIndex]?.moves.length))
  );

  const atVariantEnd = Boolean(
    explore
      ? explore.depth >= explore.moves.length - 1
      : variantCursor &&
        variantCursor.depth >=
          (engineVariants[variantCursor.plyIndex]?.moves.length ?? 1) - 1
  );

  const navLabelPly = lineMove || currentPly;

  const onBoardMove = useCallback(
    (uci: string, san: string, fenAfter: string) => {
      const nav = {
        plyIndex: plyIndexRef.current,
        engineCursor: variantCursorRef.current,
        explore: exploreRef.current,
        userVariants: userVariantsRef.current,
      };
      const currentFen = lineFen(
        nav,
        pliesRef.current,
        engineVariantsRef.current,
        pliesRef.current[0]?.fenBefore || new Chess().fen()
      );
      const next = applyBoardMove(
        nav,
        pliesRef.current,
        engineVariantsRef.current,
        currentFen,
        uci,
        san,
        fenAfter
      );
      if (!next) return;
      playLineNav(next, true);
      setUserVariants(next.userVariants);
    },
    [playLineNav]
  );

  const canPrev = explore
    ? explore.depth >= 0 ||
      Boolean(explore.stem && explore.stem.through >= 0) ||
      explore.baseIdx >= 0
    : plyIndex >= 0 || Boolean(variantCursor);

  const canNext = explore
    ? explore.depth < explore.moves.length - 1
    : Boolean(plies.length) &&
      (variantCursor ? !atVariantEnd : plyIndex < plies.length - 1);

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

          {!analysis ? (
            <>
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
            </>
          ) : null}

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
              interactive={!openingGame && plies.length > 0}
              onMove={onBoardMove}
              highlightUci={highlightUci}
              animateUci={boardAnimSteps?.length ? null : boardAnimUci}
              animateSteps={boardAnimSteps}
              onAnimateEnd={clearBoardAnim}
              arrowUci={
                boardAnimUci || boardAnimSteps?.length ? null : engineArrowUci
              }
              arrowColor={boardRimColor || colors.sage}
              onArrowPress={
                boardAnimUci || boardAnimSteps?.length || !arrowPressable
                  ? undefined
                  : onEngineArrowPress
              }
              markUci={
                currentMark && markedPly?.uci ? markedPly.uci : null
              }
              markSource={
                currentMark ? COACH_MARK_SOURCES[currentMark] : null
              }
              markKey={currentMark}
              kingBadge={kingBadge}
              kingBadgeUser={orientation}
              rimColor={boardRimColor}
            />
            <View pointerEvents="none" style={styles.markPreload}>
              {COACH_MARK_ORDER.map((mark) => (
                <Image
                  key={mark}
                  source={COACH_MARK_SOURCES[mark]}
                  fadeDuration={0}
                  style={styles.markPreloadGif}
                />
              ))}
            </View>
          </EdgeCard>

          <View style={styles.navRow}>
            <BrutalButton
              label="Previous"
              ghost
              onPressIn={() => startHoldNav(prevPly)}
              onPressOut={stopHoldNav}
              disabled={!canPrev}
              style={{ flex: 1 }}
            />
            <Text style={styles.pageCount}>
              {navLabelPly && (explore ? explore.depth >= 0 : plyIndex >= 0)
                ? `${navLabelPly.fullmove}${
                    navLabelPly.side === "white" ? "." : "..."
                  } ${navLabelPly.san || ""}`
                : ""}
            </Text>
            <BrutalButton
              label="Next"
              ghost
              onPressIn={() => startHoldNav(nextPly)}
              onPressOut={stopHoldNav}
              disabled={!canNext}
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
            {userVariantsAt(userVariants, -1).map((v) =>
              sidelinesVisibleAt(-1, {
                plyIndex,
                engineCursor: variantCursor,
                explore,
              }) || explore?.id === v.id ? (
                <BranchChips
                  key={v.id}
                  moves={v.moves}
                  color={GAME_LINE_COLOR}
                  openMark="["
                  closeMark="]"
                  activeDepth={explore?.id === v.id ? explore.depth : null}
                  onPressDepth={(d) => openUserVariant(v.id, d)}
                  onDeleteDepth={
                    explore?.id === v.id
                      ? (d) => deleteFromUserMove(v.id, d)
                      : undefined
                  }
                />
              ) : null
            )}
            {plies.map((p, i) => {
              const active = !variantCursor && !explore && i === plyIndex;
              const noted = Boolean(p.note?.trim());
              const engine = engineVariants[i];
              const custom = [
                ...userVariantsAt(userVariants, i),
                ...userVariantsAt(userVariants, i, i),
              ];
              const showSides = sidelinesVisibleAt(i, {
                plyIndex,
                engineCursor: variantCursor,
                explore,
              });
              const stem = explore?.stem?.ply === i ? explore.stem : null;
              const engineMoves = !showSides
                ? null
                : stem
                  ? engine?.moves.slice(0, stem.through + 1)
                  : engine?.moves;
              const engineActiveDepth = stem
                ? explore && explore.depth < 0
                  ? stem.through
                  : null
                : variantCursor?.plyIndex === i
                  ? variantCursor.depth
                  : null;
              return (
                <React.Fragment key={`${i}-${p.uci}`}>
                  <HintedMoveChip
                    label={`${p.side === "white" ? `${p.fullmove}. ` : ""}${p.san}`}
                    active={active}
                    noted={noted}
                    engineFork={Boolean(engine?.moves.length)}
                    userFork={custom.length > 0}
                    onPress={() => jumpPly(i)}
                  />
                  {engineMoves?.length ? (
                    <BranchChips
                      moves={engineMoves}
                      color={ENGINE_VARIANT_COLOR}
                      openMark="("
                      closeMark=")"
                      activeDepth={engineActiveDepth}
                      onPressDepth={(d) => enterVariant(i, d)}
                    />
                  ) : null}
                  {showSides
                    ? custom.map((v) => (
                        <BranchChips
                          key={v.id}
                          moves={v.moves}
                          color={GAME_LINE_COLOR}
                          openMark="["
                          closeMark="]"
                          activeDepth={
                            explore?.id === v.id ? explore.depth : null
                          }
                          onPressDepth={(d) => openUserVariant(v.id, d)}
                          onDeleteDepth={
                            explore?.id === v.id
                              ? (d) => deleteFromUserMove(v.id, d)
                              : undefined
                          }
                        />
                      ))
                    : null}
                </React.Fragment>
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
                  <ScrollView
                    style={styles.accuracyBody}
                    contentContainerStyle={styles.accuracyBodyContent}
                    showsVerticalScrollIndicator={false}
                  >
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
                        if (you + opp === 0) return null;
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
                  </ScrollView>
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
                  <View style={styles.listLoading} accessibilityRole="progressbar">
                    <ActivityIndicator color={colors.cream} />
                    <Text style={styles.listLoadingText}>Loading games…</Text>
                  </View>
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
                  <View style={styles.listLoadingMore} accessibilityRole="progressbar">
                    <ActivityIndicator color={colors.cream} />
                    <Text style={styles.listLoadingText}>Loading more games…</Text>
                  </View>
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
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(colors.bg, 0.88),
    justifyContent: "flex-start",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 96,
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
    minHeight: 0,
  },
  accuracyBodyContent: {
    gap: spacing.lg,
    paddingBottom: spacing.xs,
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
    gap: spacing.sm,
  },
  accuracyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 32,
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
  listLoading: {
    alignItems: "center",
    gap: spacing.sm,
    marginTop: 40,
  },
  listLoadingMore: {
    alignItems: "center",
    gap: spacing.xs,
    marginVertical: spacing.md,
  },
  listLoadingText: {
    ...type.bodySmall,
    color: colors.textMuted,
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
  boardCard: { padding: spacing.sm, alignItems: "center", overflow: "visible" },
  markPreload: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  markPreloadGif: { width: 1, height: 1 },
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
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
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
  moveChipLabel: { zIndex: 1 },
  moveChipTextActive: { color: colors.cream },
  variantGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
  },
  variantChipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  variantDelete: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  variantMark: {
    fontFamily: font.mono,
    fontSize: type.caption.fontSize,
    color: colors.blue,
  },
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
