import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, type } from "../theme";

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
    borderRadius: radius.md,
    padding: spacing.md,
    minWidth: "47%",
    flexGrow: 1,
  },
  label: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: 4,
  },
  value: {
    ...type.numberMd,
    color: colors.text,
  },
  caption: {
    ...type.caption,
    color: colors.textDim,
    marginTop: 4,
  },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  badgeEmoji: {
    fontSize: 24,
    marginBottom: 6,
  },
  badgeTitle: {
    ...type.subheading,
    color: colors.text,
    marginBottom: 4,
  },
  badgeDesc: {
    ...type.bodySmall,
    color: colors.textMuted,
  },
  comparison: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    flex: 1,
    minWidth: 100,
  },
  comparisonIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  comparisonValue: {
    ...type.numberSm,
    color: colors.text,
  },
  comparisonLabel: {
    ...type.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 2,
  },
});
