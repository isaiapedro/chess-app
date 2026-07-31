import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AnalyzeProgress } from "../engine/analyzeMistakes";
import { colors, font } from "../theme";

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
  progress: AnalyzeProgress | null;
  logLines?: string[];
  fallback?: string;
};

export function StudyAnalyzeStatus({
  progress,
  fallback = "Setting up the pieces…",
}: Props) {
  const [phrase, setPhrase] = useState(() => pickRandomLine());

  useEffect(() => {
    const timer = setInterval(() => {
      setPhrase((prev) => pickRandomLine(prev));
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const candidates = progress?.candidates ?? 0;
  const selected = progress?.selected ?? 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.phrase}>{phrase || fallback}</Text>
      <Text style={styles.counts}>
        Moments found: {candidates} · Ready to study: {selected}
      </Text>
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
  counts: {
    color: colors.cream,
    fontFamily: font.mono,
    fontSize: 12,
    textAlign: "center",
  },
});
