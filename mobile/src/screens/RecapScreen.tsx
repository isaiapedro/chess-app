import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchGames, fetchRecap } from "../api/client";
import { selectRecapView } from "../api/selectors";
import type { Period, RecapResponse } from "../api/types";
import {
  HourlyGamesChart,
  MonthlyGamesChart,
  RatingChart,
} from "../components/AnalyticsCharts";
import {
  DisplayTitle,
  EdgeCard,
  Eyebrow,
  PaperCard,
  Pill,
  SectionLabel,
} from "../components/ui";
import { useFilters } from "../context/FilterContext";
import { colors, font, result, spacing, withAlpha } from "../theme";

const PERIOD_NOUN: Record<Period, string> = {
  all: "Story",
  year: "Year",
  month: "Month",
  week: "Week",
  day: "Day",
};

export function RecapScreen() {
  const { queryFilters, refreshToken, speed, period, periodLabel } = useFilters();
  const [data, setData] = useState<RecapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeBadge, setActiveBadge] = useState(0);

  const load = useCallback(
    async (forceNetwork = false) => {
      try {
        setError(null);
        const recap = await fetchRecap(queryFilters, forceNetwork);
        setData(recap);
        setActiveBadge(0);
        void fetchGames(queryFilters, forceNetwork).catch(() => undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load recap");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [queryFilters]
  );

  useEffect(() => {
    setLoading(true);
    void load(false);
  }, [load, refreshToken]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Text style={styles.muted}>Cached analytics load automatically offline.</Text>
      </View>
    );
  }

  if (!data) return null;

  const view = selectRecapView(data, speed, period);
  const badge = view.badges[activeBadge];
  const periodNoun = PERIOD_NOUN[period];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.red}
          onRefresh={() => {
            setRefreshing(true);
            void load(true);
          }}
        />
      }
    >
      <View style={styles.hero}>
        <Eyebrow>
          {view.formatLabel} · {periodLabel}
        </Eyebrow>
        <View style={styles.heroRow}>
          <View style={styles.heroText}>
            <DisplayTitle size={40}>
              Your {periodNoun}
              {"\n"}in Chess
            </DisplayTitle>
            <Text style={styles.byline}>@{view.username}</Text>
          </View>
          <Text style={styles.heroPawn}>♟</Text>
        </View>
      </View>

      <View style={styles.peakRow}>
        <Text style={styles.peakLabel}>Peak Rating</Text>
        <View style={styles.peakValueRow}>
          <Text style={styles.peakValue}>{view.peakRating ?? "—"}</Text>
          {view.ratingChange != null ? (
            <Pill color={view.ratingChange >= 0 ? result.win : result.loss}>
              {view.ratingChange >= 0 ? "+" : ""}
              {view.ratingChange}
            </Pill>
          ) : null}
        </View>
      </View>

      <View style={styles.grid}>
        {view.stats.map((stat) => (
          <EdgeCard key={stat.label} lifted style={styles.gridCard}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statSub}>{stat.sub}</Text>
          </EdgeCard>
        ))}
      </View>

      <View style={styles.sectionPad}>
        <RatingChart points={view.ratingSeries} period={period} />
        {period === "year" || period === "all" ? (
          <MonthlyGamesChart points={view.monthlyActivity} />
        ) : null}
        <HourlyGamesChart points={view.hourlyActivity} peakLabel={view.peakHourLabel} />
      </View>

      {view.badges.length ? (
        <View style={styles.sectionPad}>
          <SectionLabel>Your Playing Archetypes</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeRow}>
            {view.badges.map((item, index) => {
              const active = index === activeBadge;
              return (
                <Pressable
                  key={`${item.title}-${index}`}
                  onPress={() => setActiveBadge(index)}
                  style={[
                    styles.badgeChip,
                    active && {
                      borderColor: colors.cream,
                      backgroundColor: withAlpha(colors.cream, 0.12),
                    },
                  ]}
                >
                  <Text style={styles.badgeEmoji}>{item.emoji}</Text>
                  <Text style={[styles.badgeTitle, active && { color: colors.cream }]}>
                    {item.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {badge ? (
            <PaperCard title={`${badge.emoji} ${badge.title}`}>{badge.desc}</PaperCard>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sectionPad}>
        <SectionLabel>What You Could Have Done Instead</SectionLabel>
        <View style={styles.grid}>
          {view.comparisons.map((item) => (
            <EdgeCard key={item.label} style={styles.gridCard}>
              <Text style={styles.compIcon}>{item.icon}</Text>
              <Text style={[styles.compValue, item.small && styles.compValueSmall]}>
                {item.value}
              </Text>
              <Text style={styles.compLabel}>{item.label}</Text>
              <Text style={styles.compSub}>{item.sub}</Text>
            </EdgeCard>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  error: {
    color: colors.red,
    fontFamily: font.monoBold,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  muted: {
    color: colors.textDim,
    fontFamily: font.sans,
    textAlign: "center",
  },
  hero: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heroText: {
    flexShrink: 1,
  },
  heroPawn: {
    color: colors.cream,
    fontSize: 64,
    lineHeight: 76,
  },
  byline: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontFamily: font.sans,
    fontSize: 14,
  },
  peakRow: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  peakLabel: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  peakValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  peakValue: {
    color: colors.text,
    fontFamily: font.monoBold,
    fontSize: 52,
    lineHeight: 58,
    letterSpacing: -1,
    includeFontPadding: false,
    fontVariant: ["tabular-nums"],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.sm,
    rowGap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  gridCard: {
    width: "48.4%",
  },
  statLabel: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  statValue: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 30,
    lineHeight: 34,
    marginBottom: 6,
  },
  statSub: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 11,
  },
  sectionPad: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  badgeRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  badgeChip: {
    minWidth: 112,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  badgeEmoji: {
    fontSize: 18,
    marginBottom: 6,
  },
  badgeTitle: {
    color: colors.textSoft,
    fontFamily: font.displayMedium,
    fontSize: 14,
  },
  compIcon: {
    color: colors.red,
    fontSize: 16,
    marginBottom: 8,
  },
  compValue: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 30,
    marginBottom: 6,
  },
  compValueSmall: {
    fontFamily: font.displayMedium,
    fontSize: 18,
    lineHeight: 22,
  },
  compLabel: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 12,
    lineHeight: 14,
  },
  compSub: {
    marginTop: 4,
    color: colors.textDisabled,
    fontFamily: font.mono,
    fontSize: 11,
    lineHeight: 13,
  },
});
