import React, { useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useScanLog } from "../context/ScanLogContext";
import { colors, font, spacing, withAlpha } from "../theme";

export function ScanLogPanel() {
  const { lines, status, phase, gamesDone, gamesTotal, running } = useScanLog();
  const [open, setOpen] = React.useState(true);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (open) {
      scrollRef.current?.scrollToEnd({ animated: true });
    }
  }, [lines.length, open]);

  const pct =
    gamesTotal > 0
      ? Math.min(100, Math.round((gamesDone / gamesTotal) * 100))
      : 0;

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Background Engine</Text>
          <Text style={styles.status} numberOfLines={1}>
            {running ? status : lines.length ? status : "Waiting for Stockfish…"}
          </Text>
        </View>
        <Text style={styles.chevron}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.meta}>
        {phase} · {gamesDone}/{gamesTotal || "—"} games · {pct}%
      </Text>
      {open ? (
        <ScrollView
          ref={scrollRef}
          style={styles.log}
          contentContainerStyle={styles.logContent}
          nestedScrollEnabled
        >
          {lines.length ? (
            lines.map((line) => (
              <Text key={line.id} style={styles.line}>
                {line.text}
              </Text>
            ))
          ) : (
            <Text style={styles.lineDim}>No scan events yet.</Text>
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 8,
  },
  title: {
    color: colors.textDim,
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  status: {
    color: colors.text,
    fontFamily: font.mono,
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 16,
  },
  track: {
    height: 3,
    backgroundColor: withAlpha("#ffffff", 0.08),
    marginBottom: 6,
  },
  fill: {
    height: 3,
    backgroundColor: colors.blue,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  log: {
    maxHeight: 140,
    backgroundColor: withAlpha("#000000", 0.25),
  },
  logContent: {
    padding: 8,
    gap: 2,
  },
  line: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 10,
    lineHeight: 14,
  },
  lineDim: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 10,
  },
});
