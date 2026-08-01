import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AnalyzeProgress } from "../engine/analyzeMistakes";
import {
  TARGET_MISTAKE_MOMENTS,
  TARGET_OPENING_MOMENTS,
} from "../engine/analysisConfig";
import { colors, font } from "../theme";
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

type Props = {
  progress?: AnalyzeProgress | null;
  logLines?: string[];
  fallback?: string;
  targetMoments?: number;
  complete?: boolean;
  onComplete?: () => void;
};

export function StudyAnalyzeStatus({
  progress = null,
  fallback = "Setting up the pieces…",
  targetMoments,
  complete = false,
  onComplete,
}: Props) {
  const [phrase, setPhrase] = useState(() => pickRandomLine());

  useEffect(() => {
    const timer = setInterval(() => {
      setPhrase((prev) => pickRandomLine(prev));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const target =
    targetMoments ??
    Math.max(TARGET_MISTAKE_MOMENTS, TARGET_OPENING_MOMENTS);

  return (
    <View style={styles.wrap}>
      <Text style={styles.phrase}>{phrase || fallback}</Text>
      <AnalysisLoadingBars
        selected={progress?.selected ?? 0}
        candidates={progress?.candidates ?? 0}
        target={target}
        complete={complete}
        onComplete={onComplete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 8, paddingVertical: 8, width: "100%" },
  phrase: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 14,
    textAlign: "center",
  },
});
