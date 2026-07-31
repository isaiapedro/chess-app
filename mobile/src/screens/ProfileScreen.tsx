import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BrutalButton, DisplayTitle } from "../components/ui";
import { clearAppCache } from "../storage/cache";
import { colors, font, result, spacing } from "../theme";

export function ProfileScreen() {
  const [clearing, setClearing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const onClearCache = async () => {
    if (clearing) return;
    setClearing(true);
    setStatus(null);
    try {
      await clearAppCache();
      setStatus("Cache cleared.");
    } catch (e) {
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
          style={[
            styles.status,
            status === "Cache cleared." ? styles.statusOk : styles.statusErr,
          ]}
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
