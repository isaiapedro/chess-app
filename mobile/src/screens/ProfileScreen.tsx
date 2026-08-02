import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BrutalButton, DisplayTitle } from "../components/ui";
import { useFilters } from "../context/FilterContext";
import { resetPrefetchMemory } from "../engine/studyPrefetch";
import { clearAppCache } from "../storage/cache";
import { colors, font, result, spacing } from "../theme";

export function ProfileScreen() {
  const { refresh } = useFilters();
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const onClearCache = async () => {
    if (clearing) return;
    setClearing(true);
    setStatus(null);
    setFailed(false);
    try {
      resetPrefetchMemory();
      const removed = await clearAppCache();
      refresh();
      setStatus(
        removed
          ? `Cleared ${removed} cached ${removed === 1 ? "entry" : "entries"} (incl. Stockfish vault).`
          : "Nothing cached."
      );
    } catch (e) {
      setFailed(true);
      setStatus(e instanceof Error ? e.message : "Failed to clear cache");
    } finally {
      setClearing(false);
    }
  };

  return (
    <View style={styles.container}>
      <DisplayTitle size={30}>Profile</DisplayTitle>
      <Text style={styles.muted}>Local data & tools</Text>
      <BrutalButton
        label={clearing ? "Clearing…" : "Clear cache"}
        onPress={() => void onClearCache()}
        disabled={clearing}
        style={styles.button}
      />
      {status ? (
        <Text
          style={[styles.status, failed ? styles.statusErr : styles.statusOk]}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  muted: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 14,
  },
  button: {
    alignSelf: "stretch",
  },
  status: {
    marginTop: spacing.sm,
    fontFamily: font.mono,
    fontSize: 12,
  },
  statusOk: {
    color: colors.sage,
  },
  statusErr: {
    color: result.loss,
  },
});
