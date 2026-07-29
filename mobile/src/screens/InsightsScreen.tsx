import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

export function InsightsScreen() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Insights</Text>
      <Text style={styles.body}>
        Deep analytics panels (style, openings, middlegames, endgames) land in
        a later polish pass. API endpoint ready: /api/v1/stats/insights.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    justifyContent: "center",
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
});
