import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { selectMetricsCatalog } from "../api/selectors";
import type { CatalogMetric, CatalogSection, InsightsResponse } from "../api/types";
import {
  DisplayTitle,
  EdgeCard,
  SearchField,
  SectionLabel,
} from "../components/ui";
import { colors, font, result, spacing, withAlpha } from "../theme";

type Props = {
  data: InsightsResponse;
  onBack: () => void;
};

export function CatalogScreen({ data, onBack }: Props) {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<CatalogSection["key"] | null>(null);
  const sections = useMemo(() => selectMetricsCatalog(data), [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sections
      .filter((section) => !activeSection || section.key === activeSection)
      .map((section) => ({
        ...section,
        metrics: section.metrics.filter(
          (metric) =>
            !q ||
            metric.name.toLowerCase().includes(q) ||
            metric.desc.toLowerCase().includes(q)
        ),
      }))
      .filter((section) => section.metrics.length > 0);
  }, [sections, activeSection, search]);

  const current = activeSection
    ? sections.find((section) => section.key === activeSection)
    : null;
  const showMetrics = Boolean(activeSection) || search.trim().length > 0;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            if (activeSection) {
              setActiveSection(null);
              setSearch("");
              return;
            }
            onBack();
          }}
          hitSlop={8}
        >
          <Text style={styles.back}>
            {activeSection ? "← All Categories" : "← Insights Summary"}
          </Text>
        </Pressable>
        <DisplayTitle size={30}>{current?.title || "Metrics Catalog"}</DisplayTitle>
        <View style={{ height: spacing.md }} />
        <SearchField value={search} onChangeText={setSearch} placeholder="Search metrics..." />
      </View>

      {!showMetrics ? (
        <View style={styles.pad}>
          <SectionLabel>Categories</SectionLabel>
          <View style={styles.grid}>
            {sections.map((section) => (
              <Pressable
                key={section.key}
                onPress={() => setActiveSection(section.key)}
                style={[styles.categoryCard, { borderTopColor: section.color }]}
              >
                <Text style={[styles.categoryIcon, { color: section.color }]}>{section.icon}</Text>
                <Text style={styles.categoryTitle}>{section.title}</Text>
                <Text style={styles.categoryMeta}>{section.metrics.length} metrics</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.pad}>
          {!filtered.length ? (
            <Text style={styles.empty}>No metrics found for "{search}"</Text>
          ) : (
            filtered.map((section) => (
              <View key={section.key} style={{ marginBottom: spacing.md }}>
                {!activeSection ? (
                  <View style={styles.sectionHead}>
                    <Text style={{ color: section.color }}>{section.icon}</Text>
                    <Text style={[styles.sectionTitle, { color: section.color }]}>
                      {section.title}
                    </Text>
                    <View style={styles.rule} />
                  </View>
                ) : null}
                {section.metrics.map((metric) => (
                  <MetricCard key={metric.id} metric={metric} />
                ))}
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

function MetricCard({ metric }: { metric: CatalogMetric }) {
  return (
    <EdgeCard style={{ marginBottom: spacing.sm }}>
      <Text style={styles.metricName}>{metric.name}</Text>
      <Text style={styles.metricValue}>
        {metric.value}
        <Text style={styles.metricUnit}>{metric.unit}</Text>
      </Text>
      <Text style={styles.metricDesc}>{metric.desc}</Text>
      {metric.numericValue != null ? (
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              {
                width: `${Math.min(100, Math.abs(metric.numericValue))}%`,
                backgroundColor: result.win,
              },
            ]}
          />
        </View>
      ) : null}
    </EdgeCard>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },
  header: { padding: spacing.md },
  pad: { paddingHorizontal: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryCard: {
    width: "48%",
    flexGrow: 1,
    minWidth: "46%",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderTopWidth: 3,
    padding: spacing.md,
  },
  categoryIcon: { fontSize: 22, marginBottom: 8 },
  categoryTitle: {
    color: colors.text,
    fontFamily: font.displayMedium,
    fontSize: 16,
    marginBottom: 4,
  },
  categoryMeta: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1,
  },
  back: {
    color: colors.red,
    fontFamily: font.monoBold,
    fontSize: 15,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },
  empty: {
    color: colors.textDim,
    fontFamily: font.sans,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  metricName: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  metricValue: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 24,
    marginBottom: 6,
  },
  metricUnit: {
    color: colors.textMuted,
    fontFamily: font.mono,
    fontSize: 12,
  },
  metricDesc: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 12,
    lineHeight: 17,
  },
  barTrack: {
    marginTop: 12,
    height: 3,
    backgroundColor: withAlpha("#ffffff", 0.08),
  },
  barFill: { height: 3 },
});
