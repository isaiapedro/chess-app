import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Chess } from "chess.js";
import {
  fetchExplorer,
  fetchMistakes,
  validateQuizMove,
  type ExplorerMove,
  type MistakeItem,
} from "../api/client";
import { ChessBoard } from "../components/ChessBoard";
import { useFilters } from "../context/FilterContext";
import { colors, spacing } from "../theme";

type Mode = "mistakes" | "repertoire";

const START_FEN = new Chess().fen();

export function StudyScreen() {
  const { queryFilters, refreshToken } = useFilters();
  const [mode, setMode] = useState<Mode>("mistakes");

  const [mistakes, setMistakes] = useState<MistakeItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loadingMistakes, setLoadingMistakes] = useState(false);
  const [mistakesError, setMistakesError] = useState<string | null>(null);
  const [quizFeedback, setQuizFeedback] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  const [repFen, setRepFen] = useState(START_FEN);
  const [repMoves, setRepMoves] = useState<ExplorerMove[]>([]);
  const [repOpening, setRepOpening] = useState<string | null>(null);
  const [repSource, setRepSource] = useState<"lichess" | "masters">("lichess");
  const [repLoading, setRepLoading] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);
  const [repNote, setRepNote] = useState<string | null>(null);

  const current = mistakes[idx] || null;

  const loadMistakes = useCallback(async () => {
    setLoadingMistakes(true);
    setMistakesError(null);
    setQuizFeedback(null);
    setRevealed(false);
    try {
      const res = await fetchMistakes(queryFilters, 5);
      setMistakes(res.mistakes || []);
      setIdx(0);
    } catch (e) {
      setMistakes([]);
      setMistakesError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingMistakes(false);
    }
  }, [queryFilters]);

  const loadExplorer = useCallback(async () => {
    setRepLoading(true);
    setRepError(null);
    try {
      const res = await fetchExplorer(repFen, repSource);
      setRepMoves(res.moves || []);
      const opening = res.opening;
      setRepOpening(
        opening?.name
          ? `${opening.eco ? opening.eco + " · " : ""}${opening.name}`
          : null
      );
      setRepNote(
        (res as { note?: string; fallback?: boolean }).note ||
          ((res as { fallback?: boolean }).fallback
            ? "Explorer fallback: engine lines (set LICHESS_TOKEN for DB stats)."
            : null)
      );
    } catch (e) {
      setRepMoves([]);
      setRepError(e instanceof Error ? e.message : "Explorer failed");
    } finally {
      setRepLoading(false);
    }
  }, [repFen, repSource]);

  useEffect(() => {
    if (mode === "mistakes") loadMistakes();
  }, [mode, loadMistakes, refreshToken]);

  useEffect(() => {
    if (mode === "repertoire") loadExplorer();
  }, [mode, loadExplorer]);

  const onQuizMove = async (uci: string) => {
    if (!current?.best_uci || revealed) return;
    try {
      const res = await validateQuizMove(current.fen, uci, current.best_uci);
      if (res.correct) {
        setQuizFeedback(
          `Correct${res.accepted_as_top_line ? " (top engine line)" : ""}: ${res.user_san}`
        );
        setRevealed(true);
      } else if (!res.legal) {
        setQuizFeedback("Illegal move — try again.");
      } else {
        setQuizFeedback(
          `Not best. You played ${res.user_san}. Hint: look for ${current.best_san || current.best_uci}.`
        );
      }
    } catch (e) {
      setQuizFeedback(e instanceof Error ? e.message : "Validate failed");
    }
  };

  const nextMistake = () => {
    setQuizFeedback(null);
    setRevealed(false);
    setIdx((i) => Math.min(i + 1, Math.max(mistakes.length - 1, 0)));
  };

  const prevMistake = () => {
    setQuizFeedback(null);
    setRevealed(false);
    setIdx((i) => Math.max(i - 1, 0));
  };

  const playExplorerMove = (uci?: string) => {
    if (!uci || uci.length < 4) return;
    const game = new Chess(repFen);
    try {
      const move = game.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? (uci[4] as "q") : undefined,
      });
      if (move) setRepFen(game.fen());
    } catch {
      /* ignore */
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>Study</Text>
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeChip, mode === "mistakes" && styles.modeActive]}
          onPress={() => setMode("mistakes")}
        >
          <Text
            style={[
              styles.modeText,
              mode === "mistakes" && styles.modeTextActive,
            ]}
          >
            Crucial Mistakes
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeChip, mode === "repertoire" && styles.modeActive]}
          onPress={() => setMode("repertoire")}
        >
          <Text
            style={[
              styles.modeText,
              mode === "repertoire" && styles.modeTextActive,
            ]}
          >
            Repertoire
          </Text>
        </Pressable>
      </View>

      {mode === "mistakes" ? (
        <View>
          {loadingMistakes ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.muted}>
                Scanning games via Lichess cloud-eval (cached)…
              </Text>
            </View>
          ) : null}
          {mistakesError ? (
            <Text style={styles.error}>{mistakesError}</Text>
          ) : null}
          {!loadingMistakes && !mistakesError && mistakes.length === 0 ? (
            <Text style={styles.muted}>
              No critical mistakes found in recent losses. Try a wider
              timeframe.
            </Text>
          ) : null}

          {current ? (
            <View>
              <Text style={styles.sub}>
                {idx + 1}/{mistakes.length} · {current.opening_eco}{" "}
                {current.opening_name} · drop {Math.round(current.eval_drop_cp)}{" "}
                cp
              </Text>
              <Text style={styles.prompt}>
                What is the best move here? (you played {current.played_san})
              </Text>
              <ChessBoard
                fen={current.fen}
                orientation={
                  current.user_color === "black" ? "black" : "white"
                }
                interactive={!revealed}
                onMove={(uci) => onQuizMove(uci)}
                highlightUci={revealed ? current.best_uci : null}
              />
              {quizFeedback ? (
                <Text
                  style={[
                    styles.feedback,
                    revealed ? styles.ok : styles.warn,
                  ]}
                >
                  {quizFeedback}
                </Text>
              ) : null}
              {revealed ? (
                <Text style={styles.comment}>{current.comment}</Text>
              ) : (
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => {
                    setRevealed(true);
                    setQuizFeedback(
                      `Best: ${current.best_san || current.best_uci}`
                    );
                  }}
                >
                  <Text style={styles.secondaryBtnText}>Reveal answer</Text>
                </Pressable>
              )}
              <View style={styles.navRow}>
                <Pressable style={styles.navBtn} onPress={prevMistake}>
                  <Text style={styles.navText}>Prev</Text>
                </Pressable>
                <Pressable style={styles.navBtn} onPress={loadMistakes}>
                  <Text style={styles.navText}>Reload</Text>
                </Pressable>
                <Pressable style={styles.navBtn} onPress={nextMistake}>
                  <Text style={styles.navText}>Next</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View>
          <View style={styles.modeRow}>
            <Pressable
              style={[
                styles.modeChip,
                repSource === "lichess" && styles.modeActive,
              ]}
              onPress={() => setRepSource("lichess")}
            >
              <Text
                style={[
                  styles.modeText,
                  repSource === "lichess" && styles.modeTextActive,
                ]}
              >
                Lichess
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.modeChip,
                repSource === "masters" && styles.modeActive,
              ]}
              onPress={() => setRepSource("masters")}
            >
              <Text
                style={[
                  styles.modeText,
                  repSource === "masters" && styles.modeTextActive,
                ]}
              >
                Masters
              </Text>
            </Pressable>
            <Pressable
              style={styles.modeChip}
              onPress={() => setRepFen(START_FEN)}
            >
              <Text style={styles.modeText}>Reset</Text>
            </Pressable>
          </View>
          {repOpening ? <Text style={styles.sub}>{repOpening}</Text> : null}
          {repNote ? <Text style={styles.muted}>{repNote}</Text> : null}
          <ChessBoard
            fen={repFen}
            interactive
            onMove={(_uci, _san, fenAfter) => setRepFen(fenAfter)}
          />
          {repLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />
          ) : null}
          {repError ? <Text style={styles.error}>{repError}</Text> : null}
          <Text style={styles.section}>Popular moves</Text>
          {repMoves.map((m) => {
            const total = (m.white || 0) + (m.draws || 0) + (m.black || 0);
            const wr = total ? Math.round(((m.white || 0) / total) * 100) : 0;
            const engine = (m as { engine?: boolean; cp?: number }).engine;
            const cp = (m as { cp?: number }).cp;
            return (
              <Pressable
                key={`${m.uci}-${m.san}`}
                style={styles.moveRow}
                onPress={() => playExplorerMove(m.uci)}
              >
                <Text style={styles.moveSan}>{m.san}</Text>
                <Text style={styles.moveMeta}>
                  {engine
                    ? `engine${cp != null ? ` · ${cp} cp` : ""}`
                    : `${total} games · W ${wr}%`}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  modeActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  modeText: { color: colors.textMuted, fontSize: 13 },
  modeTextActive: { color: colors.accent, fontWeight: "700" },
  center: { alignItems: "center", gap: 8, paddingVertical: 24 },
  muted: { color: colors.textMuted, textAlign: "center" },
  error: { color: colors.danger, marginBottom: 8 },
  sub: { color: colors.textMuted, marginBottom: 8 },
  prompt: {
    color: colors.text,
    fontWeight: "600",
    marginBottom: spacing.sm,
  },
  feedback: { marginTop: spacing.sm, fontWeight: "600" },
  ok: { color: colors.accent },
  warn: { color: colors.warning },
  comment: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  secondaryBtn: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceAlt,
  },
  secondaryBtnText: { color: colors.info },
  navRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  navBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: "center",
  },
  navText: { color: colors.text, fontWeight: "600" },
  section: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 16,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  moveRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  moveSan: { color: colors.text, fontWeight: "700", fontSize: 16 },
  moveMeta: { color: colors.textMuted },
});
