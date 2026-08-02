import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAnalytics } from "../context/AnalyticsContext";
import { useScanLog } from "../context/ScanLogContext";
import { GLOBAL_MAX_GAMES } from "../engine/analysisConfig";
import { colors, font, spacing } from "../theme";
import { AnalysisLoadingBars } from "./LoadingSkeletons";

const WAITING_LINES = [
  "Buying the chess board…",
  "Warming up the coffee…",
  "Unhooking the king…",
  "Never playing f6…",
  "Hiding the bongcloud…",
  "Dusting off the knights…",
  "Asking the bishop for directions…",
  "Polishing the queens…",
  "Counting the pawns twice…",
  "Bribing the arbiter with snacks…",
  "Straightening the a-file…",
  "Looking for the en passant button…",
  "Telling Stockfish it is loved…",
  "Practicing the handshake…",
  "Hiding the score sheet…",
  "Searching under the board for luck…",
  "Reminding the rook to stay on track…",
  "Whispering 'castle long' to myself…",
  "Avoiding the fried liver…",
  "Waiting for the clock to beep…",
  "Folding the score pad neatly…",
  "Pretending this is still blitz…",
  "Checking if the king is sticky…",
  "Finding a better square for the knight…",
  "Saying no to hanging pieces…",
];

function pickRandomLine(exclude?: string): string {
  if (WAITING_LINES.length <= 1) return WAITING_LINES[0] || "";
  let next = WAITING_LINES[Math.floor(Math.random() * WAITING_LINES.length)];
  if (exclude && WAITING_LINES.length > 1) {
    while (next === exclude) {
      next = WAITING_LINES[Math.floor(Math.random() * WAITING_LINES.length)];
    }
  }
  return next;
}

function stripTrailingEllipsis(text: string): string {
  return text.replace(/(?:\u2026|\.{2,})\s*$/, "").trimEnd();
}

export function useAnalyticsScanReady(): boolean {
  const { metricsReady } = useAnalytics();
  return metricsReady;
}

function ProgressTrack({
  label,
  done,
  total,
  complete,
}: {
  label: string;
  done: number;
  total: number;
  complete: boolean;
}) {
  const ratio = total > 0 ? Math.min(1, done / total) : complete ? 1 : 0;
  return (
    <View style={styles.trackBlock}>
      <Text style={styles.trackLabel}>
        {label} ({done}/{total || 0})
      </Text>
      <AnalysisLoadingBars
        selected={done}
        candidates={Math.max(total, done, 1)}
        target={Math.max(total, 1)}
        progressRatio={ratio}
        complete={complete}
      />
    </View>
  );
}

export function AnalyticsScanBanner() {
  const { metricsScanned, metricsTotal, metricsReady } = useAnalytics();
  const [phrase, setPhrase] = useState(() => pickRandomLine());

  const metricsDone = Math.min(
    Math.max(metricsScanned, 0),
    metricsTotal || metricsScanned
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setPhrase((prev) => pickRandomLine(prev));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const showMetrics = !metricsReady;

  const message = useMemo(() => {
    const head = stripTrailingEllipsis(phrase);
    if (!showMetrics) return `${head}…`;
    if (metricsTotal > 0) {
      return `${head}… (${metricsDone}/${metricsTotal} games measured)`;
    }
    return `${head}… (measuring games)`;
  }, [phrase, showMetrics, metricsDone, metricsTotal]);

  if (!showMetrics) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.phrase}>{message}</Text>
      <ProgressTrack
        label="Metrics"
        done={metricsDone}
        total={metricsTotal}
        complete={false}
      />
      <Text style={styles.subtitle}>Do some puzzles while you wait.</Text>
    </View>
  );
}

export function EvalPendingWarning() {
  const { phase, gamesTotal } = useScanLog();
  const {
    games,
    metricsReady,
    openingPhaseLoading,
    middlegamePhaseLoading,
    endgamePhaseLoading,
  } = useAnalytics();
  const evalComplete = phase === "done" || phase === "error";
  const sectionsReady =
    metricsReady &&
    !openingPhaseLoading &&
    !middlegamePhaseLoading &&
    !endgamePhaseLoading;
  if (evalComplete && sectionsReady) return null;
  const known = Math.max(gamesTotal, games.length);
  const target =
    known > 0 ? Math.min(GLOBAL_MAX_GAMES, known) : GLOBAL_MAX_GAMES;
  const message = evalComplete
    ? "Finishing opening, middlegame, and endgame metrics…"
    : `Full analytics appear after Stockfish evaluates ${target} game${
        target === 1 ? "" : "s"
      }.`;
  return (
    <View style={styles.warningWrap}>
      <Text style={styles.warningText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  phrase: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 14,
    textAlign: "center",
  },
  trackBlock: {
    width: "100%",
    gap: 4,
  },
  trackLabel: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 11,
    textAlign: "center",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  subtitle: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 12,
    textAlign: "center",
  },
  warningWrap: {
    width: "100%",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    backgroundColor: colors.charcoal,
  },
  warningText: {
    color: colors.warning,
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
});
