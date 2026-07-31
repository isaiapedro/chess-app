import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Chess } from "chess.js";
import { fetchStudyGames, type MistakeItem } from "../api/client";
import { ChessBoard } from "../components/ChessBoard";
import { OpeningPrepSection } from "../components/OpeningPrepSection";
import {
  BrutalButton,
  DisplayTitle,
  EdgeCard,
  Pill,
} from "../components/ui";
import { useFilters } from "../context/FilterContext";
import {
  analyzeCriticalMistakes,
  validateMoveLocal,
  type StudyGame,
} from "../engine/analyzeMistakes";
import { useStockfish } from "../engine/StockfishProvider";
import { colors, font, result, spacing } from "../theme";

type Mode = "mistakes" | "repertoire";

function formatGameDate(value?: string): string {
  if (!value) return "Unknown date";
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatEval(value: number): string {
  const pawns = value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

function applyUci(fen: string, uci?: string | null): string {
  if (!uci) return fen;
  const game = new Chess(fen);
  try {
    game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? (uci[4] as "q") : undefined,
    });
    return game.fen();
  } catch {
    return fen;
  }
}

export function StudyScreen() {
  const { queryFilters, refreshToken } = useFilters();
  const { ready: engineReady, error: engineError, evaluate } = useStockfish();
  const [mode, setMode] = useState<Mode>("mistakes");

  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loadingMistakes, setLoadingMistakes] = useState(false);
  const [mistakesError, setMistakesError] = useState<string | null>(null);
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [quizCorrect, setQuizCorrect] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [continuation, setContinuation] = useState<string | null>(null);
  const [userMoveEval, setUserMoveEval] = useState<number | null>(null);
  const [puzzleFen, setPuzzleFen] = useState<string | null>(null);
  const [puzzleMoveSan, setPuzzleMoveSan] = useState<string | null>(null);
  const [highlightUci, setHighlightUci] = useState<string | null>(null);
  const [sequencePv, setSequencePv] = useState<string[]>([]);
  const [sequencePlaying, setSequencePlaying] = useState(false);
  const cancelRef = useRef({ cancelled: false });
  const playTokenRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = mistakes[idx] || null;

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
    setPuzzleMoveSan(null);
    setSequencePv([]);
    setSequencePlaying(false);
  }, []);

  const loadMistakes = useCallback(async () => {
    if (!engineReady) {
      setMistakesError(engineError || "Waiting for on-device Stockfish…");
      return;
    }
    cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const signal = cancelRef.current;

    setLoadingMistakes(true);
    setMistakesError(null);
    setQuizFeedback(null);
    setQuizCorrect(null);
    setRevealed(false);
    setAnalyzeStatus("Loading recent games…");
    try {
      const rows = await fetchStudyGames(queryFilters, false);
      const games = rows.map(
        (row): StudyGame => ({
          id: String(row.id || ""),
          created_at: String(row.created_at || ""),
          speed: row.speed ? String(row.speed) : undefined,
          user_color: String(row.user_color || "white"),
          result: String(row.result || ""),
          opening_name: row.opening_name ? String(row.opening_name) : undefined,
          opening_eco: row.opening_eco ? String(row.opening_eco) : undefined,
          opponent_name: row.opponent_name
            ? String(row.opponent_name)
            : undefined,
          pgn_str: row.pgn_str ? String(row.pgn_str) : undefined,
          moves_str: row.moves_str ? String(row.moves_str) : undefined,
        })
      );
      const moments = await analyzeCriticalMistakes({
        games,
        evaluate,
        signal,
        onProgress: (progress) => {
          setAnalyzeStatus(
            `${progress.status} · ${progress.found}/5 moments · ${progress.positionsChecked} evals`
          );
        },
      });
      if (signal.cancelled) return;
      setMistakes(moments);
      setIdx(0);
      if (!moments.length) {
        setMistakesError("No critical swings found in recent games.");
      }
    } catch (e) {
      if (signal.cancelled) return;
      setMistakes([]);
      setMistakesError(e instanceof Error ? e.message : "Failed to analyze");
    } finally {
      if (!signal.cancelled) {
        setLoadingMistakes(false);
        setAnalyzeStatus(null);
      }
    }
  }, [engineReady, engineError, evaluate, queryFilters]);

  useEffect(() => {
    if (mode !== "mistakes") {
      cancelRef.current.cancelled = true;
      return;
    }
    if (!engineReady) {
      setMistakesError(engineError || "Starting on-device Stockfish…");
      return;
    }
    void loadMistakes();
  }, [mode, loadMistakes, refreshToken, engineReady, engineError]);

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
    setHighlightUci(uci);
    setQuizFeedback("Checking…");
    setQuizCorrect(null);
    try {
      const res = await validateMoveLocal(
        evaluate,
        current.fen,
        uci,
        current.best_uci
      );

      if (res.verdict === "illegal") {
        setQuizFeedback("Illegal move — try again.");
        setPuzzleFen(current.fen);
        setPuzzleMoveSan(null);
        setHighlightUci(null);
        return;
      }

      if (res.verdict === "retry") {
        setQuizCorrect(false);
        setQuizFeedback("Not quite — try a different move.");
        setContinuation(null);
        setUserMoveEval(null);
        retryTimerRef.current = setTimeout(() => {
          setPuzzleFen(current.fen);
          setHighlightUci(null);
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
      setHighlightUci(null);
    }
  };

  const nextMistake = () => {
    resetQuizChrome();
    setIdx((i) => Math.min(i + 1, Math.max(mistakes.length - 1, 0)));
  };

  const prevMistake = () => {
    resetQuizChrome();
    setIdx((i) => Math.max(i - 1, 0));
  };

  const evalBefore = current?.eval_before_cp ?? 0;
  const evalAfter = current?.eval_after_cp ?? 0;
  const whiteShare = Math.max(
    8,
    Math.min(92, 50 + evalBefore / 4)
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

      {mode === "mistakes" ? (
        <View>
          {loadingMistakes ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.red} />
              <Text style={styles.muted}>
                {analyzeStatus ||
                  "Scanning latest games on-device until 5 critical swings…"}
              </Text>
            </View>
          ) : null}
          {mistakesError && !loadingMistakes ? (
            <Text style={styles.error}>{mistakesError}</Text>
          ) : null}
          {!loadingMistakes && !mistakesError && mistakes.length === 0 ? (
            <Text style={styles.muted}>
              No critical swings found in recent games. Try a wider timeframe.
            </Text>
          ) : null}

          {current ? (
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
                    +{(Math.abs(evalBefore - evalAfter) / 100).toFixed(2)} improvement
                  </Text>
                  <View style={styles.evalAlign}>
                    <Pill color={result.loss} style={styles.mistakePill}>
                      Mistake
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
                  <Text style={[styles.comment, { marginTop: spacing.sm }]}>
                    Continuation: {continuation}
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
                          current.best_uci
                        );
                        setContinuation(res.best_continuation_san);
                        setSequencePv(
                          res.best_pv.length
                            ? res.best_pv
                            : [current.best_uci]
                        );
                      } catch {
                        setContinuation(null);
                        setSequencePv([current.best_uci]);
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
                  disabled={idx >= mistakes.length - 1}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <OpeningPrepSection />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
