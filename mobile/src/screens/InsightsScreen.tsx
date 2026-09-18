import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { LineChart } from "react-native-chart-kit";
import type { FactorItem } from "../api/types";
import {
  AnalyticsScanBanner,
  EvalPendingWarning,
} from "../components/AnalyticsScanBanner";
import {
  AnalyticsPageShell,
  InsightsSkeleton,
} from "../components/LoadingSkeletons";
import { BrutalButton, DisplayTitle, EdgeCard, Eyebrow } from "../components/ui";
import { useAnalytics } from "../context/AnalyticsContext";
import { useFilters } from "../context/FilterContext";
import { useInsightsNav } from "../context/InsightsNavContext";
import {
  normalizeSpeed,
  peerDeltaLabel,
  ratingBand,
} from "../data/baselines";
import { selectPerformanceFactors } from "../engine/performanceFactors";
import { colors, font, radius, result, spacing, type, withAlpha } from "../theme";
import { agentLog } from "../debug/agentLog";
import { CatalogScreen } from "./CatalogScreen";

export function InsightsScreen() {
  const { queryFilters, refreshToken, period, speed } = useFilters();
  const {
    insights: data,
    recap,
    games,
    style,
    openingPhase,
    middlegamePhase,
    endgamePhase,
    baselines,
    gamesLoading,
    sessionKey,
    metricsReady,
    refreshAnalytics,
    requestVaultMetrics,
  } = useAnalytics();
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const insightsOpacity = useRef(new Animated.Value(1)).current;
  const { setDepth, registerPopHandler } = useInsightsNav();

  const loadKey = `${sessionKey || "x"}:${period}:${refreshToken}:${queryFilters.dateFrom || ""}:${queryFilters.dateTo || ""}`;
  const contentReady = metricsReady && !!data;

  const peerBand = useMemo(() => {
    const ratings = games
      .map((g) => Number(g.user_rating))
      .filter((n) => Number.isFinite(n));
    if (!ratings.length) return null;
    const mid = [...ratings].sort((a, b) => a - b)[
      Math.floor(ratings.length / 2)
    ];
    return ratingBand(mid);
  }, [games]);

  const inferredSpeed = useMemo(() => {
    const speedCounts = new Map<string, number>();
    for (const g of games) {
      const s = String(g.speed || "").toLowerCase();
      if (!s) continue;
      speedCounts.set(s, (speedCounts.get(s) || 0) + 1);
    }
    return (
      [...speedCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    );
  }, [games]);

  const peerSpeed = normalizeSpeed(speed) || normalizeSpeed(inferredSpeed);

  const factors = useMemo(() => {
    const baselineWinRate =
      recap?.results?.win_rate ??
      data?.style?.conditional?.baseline_win_rate ??
      0;
    return selectPerformanceFactors({
      style,
      opening: openingPhase?.aggregate,
      middlegame: middlegamePhase?.aggregate,
      endgame: endgamePhase?.aggregate,
      baselines,
      band: peerBand,
      speed: peerSpeed,
      baselineWinRate: Number(baselineWinRate) || 0,
    });
  }, [
    style,
    openingPhase,
    middlegamePhase,
    endgamePhase,
    baselines,
    peerBand,
    peerSpeed,
    recap,
    data,
  ]);

  useEffect(() => {
    // Soft/cold path already remeshes. Only request when Insights has no metrics yet.
    if (metricsReady) return;
    // #region agent log
    agentLog("F", "InsightsScreen.tsx:mount", "request vault remesh on insights focus", {});
    // #endregion
    requestVaultMetrics(false);
  }, [requestVaultMetrics, sessionKey, refreshToken, metricsReady]);

  useEffect(() => {
    if (period === "all" && showCatalog) setShowCatalog(false);
  }, [period, showCatalog]);

  useEffect(() => {
    if (!showCatalog) {
      setDepth(0);
      registerPopHandler(null);
    }
  }, [showCatalog, setDepth, registerPopHandler]);

  const openCatalog = useCallback(() => {
    if (period === "all" || !data) return;
    Animated.timing(insightsOpacity, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setShowCatalog(true);
    });
  }, [insightsOpacity, data, period]);

  const closeCatalog = useCallback(() => {
    setShowCatalog(false);
    insightsOpacity.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(insightsOpacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [insightsOpacity]);

  useEffect(() => {
    setError(null);
  }, [loadKey]);

  const onRefresh = useCallback(async () => {
    if (period === "all") return;
    setRefreshing(true);
    setError(null);
    try {
      await refreshAnalytics("pull");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
    } finally {
      setRefreshing(false);
    }
  }, [refreshAnalytics, period]);

  const results = recap?.results || {
    wins: 0,
    draws: 0,
    losses: 0,
    win_rate: factors.baseline_win_rate || 0,
  };
  const ratingSeries = (recap?.rating_series || []).slice(-12);
  const winRate = results.win_rate || factors.baseline_win_rate || 0;

  useEffect(() => {
    // #region agent log
    agentLog("B", "InsightsScreen.tsx:gate", "insights gate state", {
      metricsReady,
      hasData: !!data,
      gamesLoading,
      contentReady,
      period,
    });
    // #endregion
  }, [metricsReady, data, gamesLoading, contentReady, period]);

  if (period === "all") {
    return (
      <View style={styles.stack}>
        <View style={styles.allTimeGate}>
          <Eyebrow>Performance analysis</Eyebrow>
          <DisplayTitle size={34}>
            Insights need{"\n"}a shorter window
          </DisplayTitle>
          <Text style={styles.allTimeMessage}>
            All-time is only available on Recap. For Insights, the maximum
            filter is one year.
          </Text>
        </View>
      </View>
    );
  }

  if (!metricsReady) {
    return (
      <View style={[styles.stack, styles.metricsWait]}>
        <AnalyticsScanBanner mode="full" />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <AnalyticsScanBanner mode="overlay" />
      <EvalPendingWarning />
      <Animated.View style={[styles.insightsLayer, { opacity: insightsOpacity }]}>
      <AnalyticsPageShell
        loadKey={loadKey}
        contentReady={!!data}
        period={period}
        error={!!(error && !data)}
        skeleton={<InsightsSkeleton />}
        errorNode={
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
          </View>
        }
      >
        {data && factors ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            scrollEnabled={!showCatalog}
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
              <Eyebrow>Performance analysis</Eyebrow>
              <DisplayTitle size={34}>
                What moves{"\n"}the needle
              </DisplayTitle>
            </View>

            <EdgeCard lifted style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <WinRateDial value={winRate} />
                <View style={{ flex: 1 }}>
                  <View style={styles.wdlRow}>
                    {[
                      { label: "Wins", value: results.wins, color: result.win },
                      { label: "Draws", value: results.draws, color: result.draw },
                      { label: "Losses", value: results.losses, color: result.loss },
                    ].map((item) => (
                      <View key={item.label}>
                        <Text style={[styles.wdlValue, { color: item.color }]}>
                          {item.value}
                        </Text>
                        <Text style={styles.wdlLabel}>{item.label}</Text>
                      </View>
                    ))}
                  </View>
                  {ratingSeries.length > 1 ? (
                    <LineChart
                      data={{
                        labels: ratingSeries.map(() => ""),
                        datasets: [
                          { data: ratingSeries.map((p) => p.user_rating) },
                        ],
                      }}
                      width={220}
                      height={40}
                      withDots={false}
                      withInnerLines={false}
                      withOuterLines={false}
                      withVerticalLabels={false}
                      withHorizontalLabels={false}
                      chartConfig={{
                        backgroundGradientFrom: colors.surface,
                        backgroundGradientTo: colors.surface,
                        color: () => colors.blue,
                        labelColor: () => colors.textDim,
                        propsForBackgroundLines: { stroke: "transparent" },
                      }}
                      style={{ paddingRight: 0, marginLeft: -16 }}
                    />
                  ) : null}
                </View>
              </View>
            </EdgeCard>

            <View style={styles.pad}>
              <GroupHeading label="Driving your wins" accent={result.win} />
              {factors.driving.length ? (
                factors.driving.map((item) => (
                  <FactorCard
                    key={item.condition}
                    item={item}
                    positive
                  />
                ))
              ) : (
                <Text style={styles.empty}>
                  No positive drivers in this sample.
                </Text>
              )}
            </View>

            <View style={styles.pad}>
              <GroupHeading label="Costing you points" accent={result.loss} />
              {factors.costing.length ? (
                factors.costing.map((item) => (
                  <FactorCard
                    key={item.condition}
                    item={item}
                    positive={false}
                  />
                ))
              ) : (
                <Text style={styles.empty}>
                  No negative drivers in this sample.
                </Text>
              )}
            </View>

            <View style={[styles.pad, { marginTop: spacing.md }]}>
              <BrutalButton
                label="Explore all metrics"
                onPress={openCatalog}
                disabled={!data}
              />
            </View>
          </ScrollView>
        ) : null}
      </AnalyticsPageShell>
      </Animated.View>

      {showCatalog && data ? (
        <View style={styles.overlay}>
          <CatalogScreen data={data} onBack={closeCatalog} />
        </View>
      ) : null}
    </View>
  );
}

function WinRateDial({ value }: { value: number }) {
  const size = 72;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <View style={{ width: size, height: size, marginRight: spacing.md }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={withAlpha("#ffffff", 0.1)}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.blue}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.dialCenter}>
        <Text style={styles.dialValue}>{Math.round(clamped)}%</Text>
      </View>
    </View>
  );
}

function GroupHeading({ label, accent }: { label: string; accent: string }) {
  return (
    <View style={styles.groupHead}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={[styles.groupUnderline, { backgroundColor: accent }]} />
    </View>
  );
}

function FactorCard({
  item,
  positive,
}: {
  item: FactorItem;
  positive: boolean;
}) {
  const accent = positive ? result.win : result.loss;
  const valueText = item.displayValue ?? String(item.win_rate);
  const unitText = item.unit ? ` ${item.unit}` : "";
  const unit = item.unit ?? "";
  const deltaLabel = peerDeltaLabel(item.win_rate, item.peerMean, unit);
  const peerLabel =
    item.peerDisplayValue != null
      ? `peer ${item.peerDisplayValue}${unitText}`
      : null;

  const scaleMax = (() => {
    const parts = [Math.abs(item.win_rate)];
    if (item.peerMean != null && Number.isFinite(item.peerMean)) {
      parts.push(Math.abs(item.peerMean) * 2);
      parts.push(Math.abs(item.peerMean));
    }
    const max = Math.max(...parts, 1);
    return max > 0 ? max : 1;
  })();
  const fillPct = Math.max(0, (Math.abs(item.win_rate) / scaleMax) * 100);
  const peerPct =
    item.peerMean != null && Number.isFinite(item.peerMean)
      ? Math.max(0, (Math.abs(item.peerMean) / scaleMax) * 100)
      : null;

  return (
    <EdgeCard style={styles.factorCard}>
      <Text style={styles.factorName}>{item.condition}</Text>
      <View style={styles.factorRow}>
        <Text style={[styles.factorValue, { color: accent }]}>
          {valueText}
          <Text style={styles.factorUnit}>{unitText}</Text>
        </Text>
        {deltaLabel ? (
          <Text style={[styles.factorDelta, { color: accent }]}>
            {deltaLabel}
          </Text>
        ) : null}
      </View>
      {peerLabel ? <Text style={styles.factorPeer}>{peerLabel}</Text> : null}
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            {
              width: `${Math.min(fillPct, 100)}%`,
              backgroundColor: accent,
            },
          ]}
        />
        {peerPct != null ? (
          <View
            style={[
              styles.baselineMark,
              { left: `${Math.min(peerPct, 100)}%` },
            ]}
          />
        ) : null}
      </View>
    </EdgeCard>
  );
}

const styles = StyleSheet.create({
  stack: { flex: 1, backgroundColor: colors.bg },
  insightsLayer: { flex: 1 },
  metricsWait: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: 80,
  },
  allTimeGate: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
    gap: spacing.md,
  },
  allTimeMessage: {
    ...type.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
  },
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 100 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  error: { ...type.subheading, color: colors.red, textAlign: "center" },
  hero: { padding: spacing.md, paddingTop: spacing.lg },
  summaryCard: { marginHorizontal: spacing.md, marginBottom: spacing.lg },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  wdlRow: { flexDirection: "row", gap: spacing.lg, marginBottom: 6 },
  wdlValue: { ...type.numberSm },
  wdlLabel: {
    ...type.caption,
    color: colors.textMuted,
  },
  dialCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  dialValue: {
    ...type.subheading,
    fontFamily: font.sansBold,
    color: colors.text,
  },
  pad: { paddingHorizontal: spacing.md, marginTop: spacing.lg },
  groupHead: {
    alignItems: "flex-start",
    gap: 6,
    marginBottom: spacing.md,
  },
  groupLabel: {
    ...type.heading,
    color: colors.text,
  },
  groupUnderline: {
    height: 2,
    width: 28,
    borderRadius: radius.pill,
  },
  empty: {
    ...type.bodySmall,
    color: colors.textDim,
    marginBottom: spacing.md,
  },
  factorCard: { marginBottom: spacing.sm, gap: 8 },
  factorName: {
    ...type.subheading,
    color: colors.textSoft,
  },
  factorRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  factorValue: {
    ...type.numberMd,
    color: colors.text,
  },
  factorUnit: {
    ...type.caption,
    color: colors.textMuted,
    fontFamily: font.sansMedium,
  },
  factorDelta: {
    ...type.caption,
    fontFamily: font.sansMedium,
  },
  factorPeer: {
    ...type.caption,
    color: colors.textDim,
  },
  barTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: withAlpha("#ffffff", 0.08),
    position: "relative",
    marginTop: 2,
  },
  barFill: { height: 6, borderRadius: radius.pill },
  baselineMark: {
    position: "absolute",
    top: -2,
    width: 2,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.rim,
    marginLeft: -1,
  },
});
