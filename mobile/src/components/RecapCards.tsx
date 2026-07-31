import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";

export function MetricCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

export function BadgeCard({
  emoji,
  title,
  desc,
}: {
  emoji: string;
  title: string;
  desc: string;
}) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeEmoji}>{emoji}</Text>
      <Text style={styles.badgeTitle}>{title}</Text>
      <Text style={styles.badgeDesc}>{desc}</Text>
    </View>
  );
}

export function ComparisonCard({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.comparison}>
      <Text style={styles.comparisonIcon}>{icon}</Text>
      <Text style={styles.comparisonValue}>{value}</Text>
      <Text style={styles.comparisonLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minWidth: "47%",
    flexGrow: 1,
  },
  label: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  value: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700",
  },
  caption: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  badge: {
    backgroundColor: colors.badge,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "#4338ca",
  },
  badgeEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  badgeTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  badgeDesc: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  comparison: {
    backgroundColor: colors.muted,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: "center",
    flex: 1,
    minWidth: 100,
  },
  comparisonIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  comparisonValue: {
    color: colors.warning,
    fontSize: 20,
    fontWeight: "700",
  },
  comparisonLabel: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
  },
});
