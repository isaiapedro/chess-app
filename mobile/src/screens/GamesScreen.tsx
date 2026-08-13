import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Chess } from "chess.js";
import { ArrowLeft } from "lucide-react-native";
import { ChessBoard } from "../components/ChessBoard";
import {
  BrutalButton,
  DisplayTitle,
  EdgeCard,
} from "../components/ui";
import { FadeFromBlank } from "../components/LoadingSkeletons";
import { useFilters } from "../context/FilterContext";
import { useTabSwipe } from "../context/TabSwipeContext";
import {
  analyzeSelectedGame,
  buildReplayPlies,
  formatEval,
  linesFromEval,
  type EngineLine,
  type GameCoachPly,
  type GameCoachResult,
} from "../engine/gameCoach/analyzeGame";
import {
  loadCachedGameAnalysis,
  saveCachedGameAnalysis,
} from "../engine/gameCoach/analysisCache";
import { formatOpeningLabel } from "../engine/gameCoach/ecoLabels";
import { useStockfish } from "../engine/StockfishProvider";
import { GLOBAL_DEPTH } from "../engine/analysisConfig";
import { displayCp } from "../engine/analyzeMistakes";
import type { StudyGame } from "../engine/analyzeMistakes";
import {
  loadLocalGamesPage,
  findLocalGameById,
  type NormalizedGame,
} from "../data/platformGames";
import { AppIcon } from "../icons";
import { colors, font, radius, result, spacing, type } from "../theme";

/** Matches TabNavigator order: Wrapped, Insights, Study, Games, Profile */
const GAMES_TAB_INDEX = 3;

function formatGameDate(value?: string): string {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function resultTone(value?: string): string {
  const v = String(value || "").toLowerCase();
  if (v.includes("win")) return result.win;
  if (v.includes("draw") || v === "1/2-1/2") return result.draw;
  if (v.includes("loss")) return result.loss;
  return colors.textMuted;
}

export function GamesScreen() {
  const { queryFilters, refreshToken } = useFilters();
  const { activeTabIndex } = useTabSwipe();
  const { ready: engineReady, error: engineError, evaluate } = useStockfish();
  const gamesTabActive = activeTabIndex === GAMES_TAB_INDEX;

  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [games, setGames] = useState<StudyGame[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const listLoadedForKey = useRef<string | null>(null);

  const [selectedGame, setSelectedGame] = useState<NormalizedGame | null>(null);
  const [plies, setPlies] = useState<GameCoachPly[]>([]);
  const [plyIndex, setPlyIndex] = useState(-1);
  const [analysis, setAnalysis] = useState<GameCoachResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [liveLines, setLiveLines] = useState<EngineLine[]>([]);
  const [liveCp, setLiveCp] = useState<number | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const liveReq = useRef(0);

  const listKey = `${queryFilters.platform}|${queryFilters.username}|${refreshToken}`;

  useEffect(() => {
    setSelectedGame(null);
    setPlies([]);
    setPlyIndex(-1);
    setAnalysis(null);
    setAnalyzeError(null);
    setAnalyzeProgress(null);
    setLiveLines([]);
    setLiveCp(null);
    setOffset(0);
    setGames([]);
    listLoadedForKey.current = null;
  }, [listKey]);

  const loadList = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (!queryFilters.username.trim()) {
        setGames([]);
        setHasMore(false);
        setListError("Sign in / set a username to browse your games.");
        return;
      }
      setListLoading(true);
      setListError(null);
      try {
        const page = await loadLocalGamesPage(queryFilters, {
          force: false,
          limit: 30,
          offset: nextOffset,
        });
        setGames((prev) => (append ? [...prev, ...page.games] : page.games));
        setHasMore(page.has_more);
        setOffset(nextOffset + page.games.length);
        listLoadedForKey.current = listKey;
      } catch (err) {
        setListError(err instanceof Error ? err.message : "Failed to load games");
      } finally {
        setListLoading(false);
      }
    },
    [queryFilters, listKey]
  );

  // Only load history when Games tab is focused — no startup ingest.
  useEffect(() => {
    if (!gamesTabActive) return;
    if (listLoadedForKey.current === listKey) return;
    void loadList(0, false);
  }, [gamesTabActive, listKey, loadList]);

  const openGame = useCallback(
    async (game: StudyGame) => {
      cancelRef.current.cancelled = true;
      setAnalyzing(false);
      setAnalyzeProgress(null);
      setAnalyzeError(null);
      setLiveLines([]);
      setLiveCp(null);
      setPlyIndex(-1);

      const full =
        game.pgn_str || game.moves_str
          ? (game as NormalizedGame)
          : (await findLocalGameById(queryFilters, game.id)) ||
            (game as NormalizedGame);
      setSelectedGame(full);
      const source = full.pgn_str || full.moves_str || "";
      setPlies(buildReplayPlies(source));

      const cached = await loadCachedGameAnalysis(
        queryFilters.platform,
        queryFilters.username,
        full.id
      );
      if (cached?.plies?.length) {
        setAnalysis(cached);
        setPlies(cached.plies);
        setAnalyzeProgress(null);
      } else {
        setAnalysis(null);
      }
    },
    [queryFilters]
  );

  const closeGame = useCallback(() => {
    cancelRef.current.cancelled = true;
    setSelectedGame(null);
    setPlies([]);
    setPlyIndex(-1);
    setAnalysis(null);
    setAnalyzing(false);
    setAnalyzeProgress(null);
    setAnalyzeError(null);
    setLiveLines([]);
    setLiveCp(null);
  }, []);

  const runAnalyze = useCallback(async () => {
    if (!selectedGame || !engineReady) return;
    const source = selectedGame.pgn_str || selectedGame.moves_str || "";
    if (!source.trim()) {
      setAnalyzeError("This game has no PGN/moves to analyze.");
      return;
    }
    cancelRef.current = { cancelled: false };
    setAnalyzing(true);
    setAnalyzeError(null);
    setAnalyzeProgress("Starting Stockfish 18…");
    try {
      const result = await analyzeSelectedGame({
        gameId: selectedGame.id,
        pgn: selectedGame.pgn_str,
        moves: selectedGame.moves_str,
        eco: selectedGame.opening_eco,
        opening: selectedGame.opening_name,
        evaluate,
        depth: GLOBAL_DEPTH,
        multiPv: 3,
        signal: cancelRef.current,
        onProgress: (p) => {
          setAnalyzeProgress(`${p.status} (${p.ply}/${p.total})`);
        },
      });
      if (cancelRef.current.cancelled) return;
      setAnalysis(result);
      setPlies(result.plies);
      await saveCachedGameAnalysis(
        queryFilters.platform,
        queryFilters.username,
        result
      );
      setAnalyzeProgress(null);
    } catch (err) {
      if (!cancelRef.current.cancelled) {
        setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
      }
    } finally {
      setAnalyzing(false);
    }
  }, [selectedGame, engineReady, evaluate, queryFilters]);

  const orientation =
    selectedGame?.user_color === "black" ? "black" : "white";

  const fen = useMemo(() => {
    if (plyIndex < 0 || !plies.length) return new Chess().fen();
    return plies[Math.min(plyIndex, plies.length - 1)]?.fenAfter || new Chess().fen();
  }, [plies, plyIndex]);

  const currentPly = plyIndex >= 0 ? plies[plyIndex] : null;

  // Live MultiPV for current position after analyze (or from cached ply lines)
  useEffect(() => {
    if (!selectedGame || !analysis || !engineReady) {
      setLiveLines([]);
      setLiveCp(null);
      return;
    }
    const fenNow =
      plyIndex < 0
        ? plies[0]?.fenBefore || new Chess().fen()
        : plies[plyIndex]?.fenAfter || fen;

    const stored =
      plyIndex < 0
        ? plies[0]?.lines
        : plies[plyIndex]?.lines;
    if (stored && stored.length) {
      setLiveLines(stored);
      setLiveCp(
        plyIndex < 0
          ? plies[0]?.evalBeforeCp ?? null
          : plies[plyIndex]?.evalAfterCp ?? plies[plyIndex]?.evalBeforeCp ?? null
      );
    }

    const req = ++liveReq.current;
    setLiveBusy(true);
    void (async () => {
      try {
        const ev = await evaluate(fenNow, GLOBAL_DEPTH, 3, 0);
        if (liveReq.current !== req) return;
        setLiveCp(ev.cpWhite);
        setLiveLines(linesFromEval(fenNow, ev));
      } catch {
        if (liveReq.current !== req) return;
      } finally {
        if (liveReq.current === req) setLiveBusy(false);
      }
    })();
  }, [selectedGame, analysis, engineReady, plyIndex, plies, fen, evaluate]);

  const whiteShare = Math.max(
    8,
    Math.min(92, 50 + displayCp(liveCp ?? 0) / 4)
  );

  const currentNote = useMemo(() => {
    if (plyIndex < 0) return "";
    return plies[plyIndex]?.note || "";
  }, [plyIndex, plies]);

  const highlightUci =
    plyIndex >= 0 && plies[plyIndex] ? plies[plyIndex].uci : null;

  const prevPly = () => setPlyIndex((i) => Math.max(-1, i - 1));
  const nextPly = () =>
    setPlyIndex((i) => Math.min(Math.max(plies.length - 1, 0), i + 1));

  if (selectedGame) {
    return (
      <FadeFromBlank contentKey={`game-${selectedGame.id}`}>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable onPress={closeGame} style={styles.backRow} hitSlop={8}>
            <AppIcon icon={ArrowLeft} size={18} color={colors.cream} />
            <Text style={styles.backLabel}>Games</Text>
          </Pressable>

          <DisplayTitle>{selectedGame.opponent_name || "Opponent"}</DisplayTitle>
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
                <View style={[styles.evalBarFill, { width: `${whiteShare}%` }]} />
              </View>
              {liveLines.length ? (
                <View style={styles.linesBox}>
                  {liveLines.map((line) => (
                    <Text key={line.rank} style={styles.lineRow}>
                      <Text style={styles.lineRank}>{line.rank}. </Text>
                      <Text style={styles.lineEval}>{formatEval(line.cpWhite)} </Text>
                      {line.pvSan.join(" ")}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <EdgeCard style={styles.boardCard}>
            <ChessBoard
              fen={fen}
              orientation={orientation}
              interactive={false}
              highlightUci={highlightUci}
            />
          </EdgeCard>

          <View style={styles.navRow}>
            <BrutalButton
              label="Previous"
              ghost
              onPress={prevPly}
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
              onPress={nextPly}
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
                disabled={!engineReady || analyzing || !plies.length}
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
              <Text style={styles.noteTag}>Book ideas</Text>
              <Text style={styles.noteBody}>{currentNote}</Text>
            </EdgeCard>
          ) : null}

          <Text style={styles.movesHeader}>Moves</Text>
          <View style={styles.movesWrap}>
            {plies.map((p, i) => {
              const active = i === plyIndex;
              const noted = Boolean(p.note);
              return (
                <Pressable
                  key={`${p.ply}-${p.san}`}
                  onPress={() => setPlyIndex(i)}
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
        </ScrollView>
      </FadeFromBlank>
    );
  }

  return (
    <FadeFromBlank contentKey={`games-list-${listKey}`}>
      <View style={styles.screen}>
        <View style={styles.listHeader}>
          <DisplayTitle>Games</DisplayTitle>
          <Text style={styles.subtitle}>
            Pick a game from your history. Analysis runs only when you ask.
          </Text>
        </View>

        {listError && !games.length ? (
          <Text style={styles.errorText}>{listError}</Text>
        ) : null}

        {!gamesTabActive ? (
          <Text style={styles.emptyText}>Open this tab to load your games.</Text>
        ) : (
          <FlatList
            data={games}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              listLoading ? (
                <ActivityIndicator color={colors.cream} style={{ marginTop: 40 }} />
              ) : (
                <Text style={styles.emptyText}>
                  No games in this period. Adjust filters or sync from Profile.
                </Text>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => void openGame(item)}
                style={({ pressed }) => [
                  styles.gameRow,
                  pressed && styles.gameRowPressed,
                ]}
              >
                <View style={styles.gameRowTop}>
                  <Text style={styles.gameOpp} numberOfLines={1}>
                    vs {item.opponent_name || "Unknown"}
                  </Text>
                  <Text
                    style={[styles.gameResult, { color: resultTone(item.result) }]}
                  >
                    {item.result || "—"}
                  </Text>
                </View>
                <Text style={styles.gameMeta} numberOfLines={1}>
                  {formatGameDate(item.created_at)}
                  {item.speed ? ` · ${item.speed}` : ""}
                  {item.opening_name || item.opening_eco
                    ? ` · ${formatOpeningLabel(item.opening_eco, item.opening_name)}`
                    : ""}
                </Text>
              </Pressable>
            )}
            onEndReached={() => {
              if (hasMore && !listLoading) void loadList(offset, true);
            }}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              listLoading && games.length ? (
                <ActivityIndicator
                  color={colors.cream}
                  style={{ marginVertical: 16 }}
                />
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
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
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
  linesBox: { gap: 2, marginBottom: spacing.sm },
  lineRow: {
    fontFamily: font.mono,
    fontSize: type.caption.fontSize,
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
  analyzeRow: { alignItems: "flex-start", marginTop: spacing.xs },
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
  gameRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  gameRowPressed: { opacity: 0.85 },
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
});
