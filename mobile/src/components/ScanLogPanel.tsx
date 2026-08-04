import React, { useEffect, useRef } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useScanLog } from "../context/ScanLogContext";
import { colors, radius, spacing, type, withAlpha } from "../theme";

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
    borderRadius: radius.md,
    padding: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    ...type.label,
    color: colors.textSoft,
  },
  status: {
    ...type.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  chevron: {
    ...type.body,
    color: colors.textMuted,
  },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: withAlpha("#ffffff", 0.08),
    marginBottom: 8,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.blue,
  },
  meta: {
    ...type.micro,
    color: colors.textMuted,
    marginBottom: 6,
  },
  log: {
    maxHeight: 140,
    borderRadius: radius.sm,
    backgroundColor: withAlpha("#000000", 0.3),
  },
  logContent: {
    padding: spacing.sm,
    gap: 2,
  },
  line: {
    ...type.micro,
    color: colors.textDim,
  },
  lineDim: {
    ...type.micro,
    color: colors.textMuted,
  },
});
