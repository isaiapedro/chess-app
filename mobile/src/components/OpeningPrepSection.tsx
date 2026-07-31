import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Chess } from "chess.js";
import { fetchExplorer, fetchStudyGames, type MistakeItem } from "../api/client";
import { ChessBoard } from "../components/ChessBoard";
import { BrutalButton, EdgeCard, Pill } from "../components/ui";
import { useFilters } from "../context/FilterContext";
import type { StudyGame } from "../engine/analyzeMistakes";
import { pvToSanLine } from "../engine/analyzeMistakes";
import {
  analyzeOpeningMoments,
  averageUserRating,
  filterGamesByOpening,
  topOpeningsForColor,
  validateOpeningMove,
  type OpeningChoice,
  type OpeningMoment,
} from "../engine/analyzeOpenings";
import { useStockfish } from "../engine/StockfishProvider";
import { colors, font, result, spacing } from "../theme";

type Phase = "color" | "opening" | "analyze" | "quiz";

function formatEval(value: number): string {
  const pawns = value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
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

export function OpeningPrepSection() {
  const { queryFilters, refreshToken } = useFilters();
  const { ready: engineReady, evaluate } = useStockfish();

  const [phase, setPhase] = useState<Phase>("color");
  const [color, setColor] = useState<"white" | "black" | null>(null);
  const [allGames, setAllGames] = useState<StudyGame[]>([]);
  const [topOpenings, setTopOpenings] = useState<OpeningChoice[]>([]);
  const [customOpening, setCustomOpening] = useState("");
  const [selectedOpening, setSelectedOpening] = useState<OpeningChoice | null>(
    null
  );
  const [loadingGames, setLoadingGames] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moments, setMoments] = useState<OpeningMoment[]>([]);
  const [idx, setIdx] = useState(0);

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

  const current = moments[idx] || null;

  useEffect(() => {
    let alive = true;
    setLoadingGames(true);
    setError(null);
    fetchStudyGames(queryFilters, false)
      .then((rows) => {
        if (!alive) return;
        setAllGames(toStudyGames(rows));
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
    setPhase("opening");
  };

  const startAnalysis = async (opening: OpeningChoice) => {
    if (!color) return;
    cancelRef.current.cancelled = true;
    cancelRef.current = { cancelled: false };
    const signal = cancelRef.current;

    setSelectedOpening(opening);
    setPhase("analyze");
    setAnalyzeStatus("Filtering games…");
    setError(null);
    setMoments([]);
    setIdx(0);

    const filtered = filterGamesByOpening(allGames, color, opening);
    if (!filtered.length) {
      setError("No games found for that opening in the current sample.");
      setPhase("opening");
      return;
    }

    const rating = averageUserRating(filtered.length ? filtered : allGames);
    try {
      const found = await analyzeOpeningMoments({
        games: filtered.slice(0, 24),
        color,
        userRating: rating,
        evaluate,
        signal,
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
            fallback: res.fallback,
          };
        },
        onProgress: (p) => {
          setAnalyzeStatus(
            `${p.status} · ${p.found}/3 moments · ${p.positionsChecked} checks`
          );
        },
      });
      if (signal.cancelled) return;
      setMoments(found);
      setIdx(0);
      if (!found.length) {
        setError("No opening improvement moments found. Try another opening.");
        setPhase("opening");
        return;
      }
      setPhase("quiz");
    } catch (e) {
      if (signal.cancelled) return;
      setError(e instanceof Error ? e.message : "Opening analysis failed");
      setPhase("opening");
    } finally {
      if (!signal.cancelled) setAnalyzeStatus(null);
    }
  };

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

    const res = validateOpeningMove(current.fen, uci, current);
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

  const resetFlow = () => {
    cancelRef.current.cancelled = true;
    setPhase("color");
    setColor(null);
    setSelectedOpening(null);
    setMoments([]);
    setError(null);
  };

  if (loadingGames) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
        <Text style={styles.muted}>Loading your games…</Text>
      </View>
    );
  }

  if (phase === "color") {
    return (
      <View>
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  if (phase === "opening" && color) {
    return (
      <View>
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
              {opening.eco !== "UNK" ? `${opening.eco} · ` : ""}
              {opening.name}
            </Text>
            <Text style={styles.openingOptionMeta}>{opening.games} games</Text>
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
          onChangeText={setCustomOpening}
          placeholder="e.g. Sicilian Defense"
          placeholderTextColor={colors.textDim}
          style={styles.input}
        />
        <BrutalButton
          label="Study custom opening"
          disabled={!customOpening.trim()}
          onPress={() =>
            void startAnalysis({
              key: customOpening.trim().toLowerCase(),
              eco: "UNK",
              name: customOpening.trim(),
              games: 0,
            })
          }
          style={{ marginTop: spacing.sm }}
        />
        <BrutalButton
          label="← Back"
          ghost
          onPress={() => setPhase("color")}
          style={{ marginTop: spacing.md }}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  if (phase === "analyze") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
        <Text style={styles.muted}>
          {analyzeStatus ||
            "Scanning opening games against Lichess & Masters…"}
        </Text>
        {!engineReady ? (
          <Text style={styles.muted}>Waiting for on-device Stockfish fallback…</Text>
        ) : null}
      </View>
    );
  }

  if (!current) {
    return (
      <View>
        <Text style={styles.muted}>No moments to study.</Text>
        <BrutalButton label="Choose another opening" onPress={resetFlow} />
      </View>
    );
  }

  const asMistake = current as MistakeItem;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.openingTitle}>
          {selectedOpening?.eco && selectedOpening.eco !== "UNK"
            ? `${selectedOpening.eco} · `
            : ""}
          {selectedOpening?.name || "Opening"} · {color}
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
            {asMistake.speed || "Unknown format"} · Move{" "}
            {asMistake.move_number || Math.floor(asMistake.ply / 2) + 1}
          </Text>
        </View>
        <View style={styles.evalSummary}>
          {current.winrate_gap != null ? (
            <>
              <Text style={styles.metaLine}>Win rate gap</Text>
              <Text style={styles.evalDrop}>
                {((current.winrate_played || 0) * 100).toFixed(0)}% →{" "}
                {((current.winrate_best || 0) * 100).toFixed(0)}%
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
          <Pill color={result.loss} style={styles.mistakePill}>
            Opening
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
                {userMoveEval != null ? ` ${userMoveEval.toFixed(0)}%` : ""}
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
              setRevealed(true);
              setQuizCorrect(null);
              setQuizFeedback(null);
              setPuzzleFen(current.fen);
              setPuzzleMoveSan(current.best_san || current.best_uci);
              setUserMoveEval(null);
              setHighlightUci(current.best_uci);
              setSequencePlaying(false);
              setContinuation(
                pvToSanLine(current.fen, current.best_pv || [], 6) ||
                  current.best_san
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
          onPress={() =>
            setIdx((i) => Math.min(moments.length - 1, i + 1))
          }
          disabled={idx >= moments.length - 1}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
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
