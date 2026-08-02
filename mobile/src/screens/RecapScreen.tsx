import Constants from "expo-constants";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { selectRecapView } from "../api/selectors";
import type { Period } from "../api/types";
import {
  HourlyGamesChart,
  MonthlyGamesChart,
  RatingChart,
} from "../components/AnalyticsCharts";
import {
  PageLoadingTransition,
  RecapSkeleton,
} from "../components/LoadingSkeletons";
import {
  DisplayTitle,
  EdgeCard,
  Eyebrow,
  PaperCard,
  Pill,
  SectionLabel,
} from "../components/ui";
import { useAnalytics } from "../context/AnalyticsContext";
import { useFilters } from "../context/FilterContext";
import {
  normalizeSpeed,
  peerGamesPlayedCaption,
  peerTimeInvestedCaption,
  ratingBand,
} from "../data/baselines";
import { colors, font, result, spacing, withAlpha } from "../theme";

function debugRecapLog(
  message: string,
  hypothesisId: string,
  data: Record<string, unknown>
) {
  // #region agent log
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0] || "127.0.0.1";
  fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6d2375",
    },
    body: JSON.stringify({
      sessionId: "6d2375",
      runId: "month-freeze",
      hypothesisId,
      location: "RecapScreen.tsx",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

const STREAK_OUTLINE_COLOR = "#7C2D12";
const STREAK_OUTLINE = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;

const PERIOD_NOUN: Record<Period, string> = {
  all: "Story",
  year: "Year",
  month: "Month",
  week: "Week",
  day: "Day",
};

const HERO_PIECES = [
  require("../../assets/chess_set/king.png"),
  require("../../assets/chess_set/queen.png"),
  require("../../assets/chess_set/rook.png"),
  require("../../assets/chess_set/bishop.png"),
  require("../../assets/chess_set/knight.png"),
  require("../../assets/chess_set/pawn.png"),
] as const;

const FIXED_LOADER_MS = 2000;

function usesFixedLoader(period: Period): boolean {
  return period === "day" || period === "week" || period === "month";
}

export function RecapScreen() {
  const { queryFilters, refreshToken, speed, period, periodLabel } = useFilters();
  const {
    recap: data,
    baselines,
    gamesLoading,
    sessionKey,
    refreshAnalytics,
  } = useAnalytics();
  const [error, setError] = useState<string | null>(null);
  const [minLoaderDone, setMinLoaderDone] = useState(!usesFixedLoader(period));
  const [refreshing, setRefreshing] = useState(false);
  const [activeBadge, setActiveBadge] = useState(0);
  const heroPiece = useMemo(() => {
    const idx = Math.floor(Math.random() * HERO_PIECES.length);
    return HERO_PIECES[idx];
  }, [period, refreshToken, queryFilters.username]);

  useEffect(() => {
    setActiveBadge(0);
    setError(null);
    setMinLoaderDone(!usesFixedLoader(period));
    if (!usesFixedLoader(period)) return;
    const startedAt = Date.now();
    debugRecapLog("recap load start", "H2", {
      period,
      forceNetwork: false,
      user: queryFilters.username,
    });
    const t = setTimeout(() => {
      setMinLoaderDone(true);
      debugRecapLog("recap load end", "H2", {
        totalMs: Date.now() - startedAt,
        period,
      });
    }, FIXED_LOADER_MS);
    return () => clearTimeout(t);
  }, [sessionKey, refreshToken, period, queryFilters.username]);

  useEffect(() => {
    if (!data) return;
    debugRecapLog("recap done", "H2", {
      games: data?.meta?.games_count,
      runId: "post-fix",
    });
  }, [data]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshAnalytics(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recap");
    } finally {
      setRefreshing(false);
    }
  }, [refreshAnalytics]);

  const loading = (gamesLoading && !data) || !minLoaderDone;
  const showPieceLoader = loading && usesFixedLoader(period);
  const showSkeleton = loading && !data && !usesFixedLoader(period);
  const contentKey = showPieceLoader
    ? `loader:${period}:${periodLabel}`
    : showSkeleton
      ? `skeleton:${period}`
      : error && !data
        ? "error"
        : data
          ? `${period}:${periodLabel}:${refreshToken}:${queryFilters.dateFrom || ""}:${queryFilters.dateTo || ""}`
          : "empty";

  const view = useMemo(() => {
    if (!data) return null;
    const base = selectRecapView(data, speed, period);
    const wdl = `${base.results.wins}W · ${base.results.draws}D · ${base.results.losses}L`;
    const withWdl = {
      ...base,
      stats: base.stats.map((stat) =>
        stat.label === "Win Rate" ? { ...stat, sub: wdl } : stat
      ),
    };

    const peerSpeed =
      normalizeSpeed(speed) ||
      normalizeSpeed(
        Object.entries(data.rating_series_by_speed || {})
          .sort(
            (a, b) => (b[1]?.length || 0) - (a[1]?.length || 0)
          )[0]?.[0]
      );
    const band = ratingBand(base.currentRating ?? base.peakRating);
    if (!baselines?.available || !band || !peerSpeed) return withWdl;

    const gamesCaption = peerGamesPlayedCaption(
      baselines,
      Number(data.headline?.total_games ?? base.gamesCount ?? 0),
      band,
      peerSpeed,
      period
    );
    const timeCaption = peerTimeInvestedCaption(
      baselines,
      Number(data.headline?.total_hours ?? 0),
      Number(data.headline?.total_games ?? base.gamesCount ?? 0),
      band,
      peerSpeed,
      period
    );

    return {
      ...withWdl,
      stats: withWdl.stats.map((stat) => {
        if (stat.label === "Games Played" && gamesCaption) {
          return { ...stat, sub: gamesCaption };
        }
        if (stat.label === "Time Invested" && timeCaption) {
          return { ...stat, sub: timeCaption };
        }
        return stat;
      }),
    };
  }, [baselines, data, period, speed]);
  const badge = view?.badges[activeBadge];
  const periodNoun = PERIOD_NOUN[period];

  return (
    <PageLoadingTransition active={showPieceLoader} contentKey={contentKey}>
      {showSkeleton ? (
        <View style={{ flex: 1 }}>
          <RecapSkeleton />
        </View>
      ) : error && !data ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.muted}>
            Cached analytics load automatically offline.
          </Text>
        </View>
      ) : view ? (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.red}
            onRefresh={() => {
              void onRefresh();
            }}
          />
        }
      >
      <View style={styles.hero}>
        <View style={styles.heroRow}>
          <View style={styles.heroText}>
            <Eyebrow>
              {view.formatLabel} · {periodLabel}
            </Eyebrow>
            <DisplayTitle size={40}>
              Your {periodNoun}
              {"\n"}in Chess
            </DisplayTitle>
            <Text style={styles.byline}>@{view.username}</Text>
          </View>
          <View style={styles.heroPieceWrap}>
            <Image source={heroPiece} style={styles.heroPiece} resizeMode="contain" />
          </View>
        </View>
      </View>

      <View style={styles.peakRow}>
        <View style={styles.peakMain}>
          <Text style={styles.peakLabel}>Peak Rating</Text>
          <View style={styles.peakValueRow}>
            <Text style={styles.peakValue}>{view.peakRating ?? "—"}</Text>
            {view.ratingChange != null ? (
              <Pill color={view.ratingChange >= 0 ? result.win : result.loss}>
                {view.ratingChange >= 0 ? "+" : ""}
                {view.ratingChange}
              </Pill>
            ) : null}
            {view.currentWinStreak >= 2 ? (
              <View style={styles.streakBadge}>
                <Text style={styles.streakFire}>🔥</Text>
                <View style={styles.streakCountWrap}>
                  {STREAK_OUTLINE.map(([dx, dy]) => (
                    <Text
                      key={`${dx},${dy}`}
                      style={[
                        styles.streakCountOutline,
                        { transform: [{ translateX: dx }, { translateY: dy }] },
                      ]}
                    >
                      {view.currentWinStreak}
                    </Text>
                  ))}
                  <Text style={styles.streakCount}>{view.currentWinStreak}</Text>
                </View>
              </View>
            ) : null}
          </View>
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
        <RatingChart
          points={view.ratingSeries}
          curves={view.ratingCurves}
          period={period}
        />
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
      ) : null}
    </PageLoadingTransition>
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  heroText: {
    flex: 1,
    flexShrink: 1,
    justifyContent: "center",
  },
  heroPieceWrap: {
    width: 90,
    height: 90,
    marginTop: 5,
    alignItems: "center",
    justifyContent: "flex-start",
    alignSelf: "flex-start",
  },
  heroPiece: {
    width: 90,
    height: 90,
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
  peakMain: {
    flex: 1,
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
    alignItems: "flex-end",
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
  streakBadge: {
    width: 50,
    height: 50,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  streakFire: {
    fontSize: 48,
    lineHeight: 50,
    opacity: 0.9,
  },
  streakCountWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 4,
    alignItems: "center",
    justifyContent: "flex-end",
    zIndex: 2,
  },
  streakCountOutline: {
    position: "absolute",
    left: 0,
    right: 0,
    textAlign: "center",
    color: STREAK_OUTLINE_COLOR,
    fontFamily: font.monoBold,
    fontSize: 28,
    lineHeight: 29,
    fontVariant: ["tabular-nums"],
  },
  streakCount: {
    color: "#FFF7ED",
    fontFamily: font.monoBold,
    fontSize: 28,
    lineHeight: 29,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    zIndex: 1,
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
