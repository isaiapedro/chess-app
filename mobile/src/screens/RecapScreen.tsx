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
  AnalyticsPageShell,
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
import { AppIcon } from "../icons";
import {
  BookOpenText,
  Clapperboard,
  Ruler,
  Weight,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, font, radius, result, spacing, type } from "../theme";

const COMPARISON_ICONS: Record<string, LucideIcon> = {
  "book-open-text": BookOpenText,
  ruler: Ruler,
  weight: Weight,
  clapperboard: Clapperboard,
};

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

function streakOutlineOffsets(px: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dx = -px; dx <= px; dx += 1) {
    for (let dy = -px; dy <= px; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      out.push([dx, dy]);
    }
  }
  return out;
}

function streakTypeSize(n: number): {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  outlinePx: number;
} {
  if (n >= 1000)
    return { fontSize: 14, lineHeight: 14, letterSpacing: -0.6, outlinePx: 1 };
  if (n >= 100)
    return { fontSize: 16, lineHeight: 16, letterSpacing: -0.5, outlinePx: 1 };
  if (n >= 10)
    return { fontSize: 20, lineHeight: 20, letterSpacing: -0.3, outlinePx: 2 };
  return { fontSize: 26, lineHeight: 26, letterSpacing: -0.3, outlinePx: 2 };
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [activeBadge, setActiveBadge] = useState(0);
  const heroPiece = useMemo(() => {
    const idx = Math.floor(Math.random() * HERO_PIECES.length);
    return HERO_PIECES[idx];
  }, [period, refreshToken, queryFilters.username]);

  const loadKey = `${sessionKey || "x"}:${period}:${periodLabel}:${speed || "all"}:${refreshToken}`;
  const contentReady = !!data;

  useEffect(() => {
    setActiveBadge(0);
    setError(null);
    debugRecapLog("recap load start", "H2", {
      period,
      forceNetwork: false,
      user: queryFilters.username,
    });
  }, [loadKey, period, queryFilters.username]);

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
      await refreshAnalytics("pull");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recap");
    } finally {
      setRefreshing(false);
    }
  }, [refreshAnalytics]);

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

    const speedFilter = normalizeSpeed(speed);
    const peerSpeed =
      speedFilter ||
      normalizeSpeed(
        Object.entries(data.headline?.games_by_speed || {})
          .sort((a, b) => (b[1] || 0) - (a[1] || 0))[0]?.[0]
      ) ||
      normalizeSpeed(
        Object.entries(data.rating_series_by_speed || {})
          .sort(
            (a, b) => (b[1]?.length || 0) - (a[1]?.length || 0)
          )[0]?.[0]
      );
    const band = ratingBand(base.currentRating ?? base.peakRating);
    if (!baselines?.available || !band || !peerSpeed) return withWdl;

    const gamesForPeer = speedFilter
      ? Number(data.headline?.total_games ?? base.gamesCount ?? 0)
      : Number(
          data.headline?.games_by_speed?.[peerSpeed] ??
            data.headline?.total_games ??
            base.gamesCount ??
            0
        );
    const activitySecondsForPeer = speedFilter
      ? Number(data.headline?.activity_est_seconds ?? 0)
      : Number(
          data.headline?.activity_est_seconds_by_speed?.[peerSpeed] ??
            data.headline?.activity_est_seconds ??
            0
        );

    const gamesCaption = peerGamesPlayedCaption(
      baselines,
      gamesForPeer,
      band,
      peerSpeed,
      period
    );
    const timeCaption = peerTimeInvestedCaption(
      baselines,
      activitySecondsForPeer / 3600,
      gamesForPeer,
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
  const streakGlyph = view
    ? (() => {
        const { outlinePx, ...glyph } = streakTypeSize(view.currentWinStreak);
        return { outlinePx, glyph };
      })()
    : null;
  const badge = view?.badges[activeBadge];
  const periodNoun = PERIOD_NOUN[period];

  return (
    <AnalyticsPageShell
      loadKey={loadKey}
      contentReady={contentReady}
      period={period}
      error={!!(error && !data)}
      skeleton={<RecapSkeleton />}
      errorNode={
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.muted}>
            Cached analytics load automatically offline.
          </Text>
        </View>
      }
    >
      {view ? (
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
            {view.currentWinStreak >= 2 && streakGlyph ? (
              <View style={styles.streakBadge}>
                <Text style={styles.streakFire}>🔥</Text>
                <View style={styles.streakCountWrap}>
                  <View style={styles.streakCountInner}>
                    {streakOutlineOffsets(streakGlyph.outlinePx).map(
                      ([dx, dy]) => (
                        <Text
                          key={`${dx},${dy}`}
                          allowFontScaling={false}
                          style={[
                            styles.streakCountOutline,
                            streakGlyph.glyph,
                            { left: dx, top: dy },
                          ]}
                        >
                          {view.currentWinStreak}
                        </Text>
                      )
                    )}
                    <Text
                      allowFontScaling={false}
                      style={[styles.streakCount, streakGlyph.glyph]}
                    >
                      {view.currentWinStreak}
                    </Text>
                  </View>
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
          <SectionLabel>Playing archetypes</SectionLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeRow}>
            {view.badges.map((item, index) => {
              const active = index === activeBadge;
              return (
                <Pressable
                  key={`${item.title}-${index}`}
                  onPress={() => setActiveBadge(index)}
                  style={[
                    styles.badgeChip,
                    active && { backgroundColor: colors.text },
                  ]}
                >
                  <Text style={styles.badgeEmoji}>{item.emoji}</Text>
                  <Text style={[styles.badgeTitle, active && { color: "#000000" }]}>
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
        <SectionLabel>Time spent instead</SectionLabel>
        <View style={styles.grid}>
          {view.comparisons.map((item) => {
            const CompIcon = COMPARISON_ICONS[item.icon];
            return (
              <EdgeCard key={item.label} style={styles.gridCard}>
                {CompIcon ? (
                  <AppIcon
                    icon={CompIcon}
                    size={18}
                    color={colors.textMuted}
                    style={styles.compIcon}
                  />
                ) : null}
                <Text style={[styles.compValue, item.small && styles.compValueSmall]}>
                  {item.value}
                </Text>
                <Text style={styles.compLabel}>{item.label}</Text>
                <Text style={styles.compSub}>{item.sub}</Text>
              </EdgeCard>
            );
          })}
        </View>
      </View>
      </ScrollView>
      ) : null}
    </AnalyticsPageShell>
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
    ...type.subheading,
    color: colors.red,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  muted: {
    ...type.bodySmall,
    color: colors.textDim,
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
    ...type.body,
    color: colors.textMuted,
  },
  peakRow: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  peakMain: {
    flex: 1,
  },
  peakLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: 2,
  },
  peakValueRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  peakValue: {
    ...type.numberLg,
    fontSize: 52,
    lineHeight: 58,
    letterSpacing: -2,
    color: colors.text,
    includeFontPadding: false,
  },
  streakBadge: {
    width: 50,
    height: 50,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "visible",
  },
  streakFire: {
    fontSize: 48,
    lineHeight: 50,
    opacity: 0.8,
  },
  streakCountWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    overflow: "visible",
    zIndex: 2,
  },
  streakCountInner: {
    position: "relative",
    overflow: "visible",
  },
  streakCountOutline: {
    position: "absolute",
    color: STREAK_OUTLINE_COLOR,
    fontFamily: font.sansBold,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
  },
  streakCount: {
    color: "#FFF7ED",
    fontFamily: font.sansBold,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
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
    ...type.label,
    color: colors.textMuted,
    marginBottom: 6,
  },
  statValue: {
    ...type.numberMd,
    color: colors.text,
    marginBottom: 4,
  },
  statSub: {
    ...type.caption,
    color: colors.textDim,
  },
  sectionPad: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
  },
  badgeRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  badgeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.mutedAlt,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  badgeEmoji: {
    fontSize: 16,
  },
  badgeTitle: {
    ...type.label,
    color: colors.textSoft,
  },
  compIcon: {
    marginBottom: 8,
  },
  compValue: {
    ...type.numberMd,
    fontSize: 26,
    lineHeight: 32,
    color: colors.text,
    marginBottom: 4,
  },
  compValueSmall: {
    ...type.subheading,
    fontFamily: font.sansBold,
  },
  compLabel: {
    ...type.label,
    color: colors.textMuted,
  },
  compSub: {
    marginTop: 4,
    ...type.caption,
    color: colors.textDim,
  },
});
