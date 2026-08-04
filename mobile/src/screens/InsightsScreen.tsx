import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { selectFactors } from "../api/selectors";
import type { FactorItem, Period } from "../api/types";
import { EvalPendingWarning } from "../components/AnalyticsScanBanner";
import {
  InsightsSkeleton,
  PageLoadingTransition,
} from "../components/LoadingSkeletons";
import { BrutalButton, DisplayTitle, EdgeCard, Eyebrow } from "../components/ui";
import { useAnalytics } from "../context/AnalyticsContext";
import { useFilters } from "../context/FilterContext";
import { useInsightsNav } from "../context/InsightsNavContext";
import { colors, font, radius, result, spacing, type, withAlpha } from "../theme";
import { agentLog } from "../debug/agentLog";
import { CatalogScreen } from "./CatalogScreen";

const FIXED_LOADER_MS = 2000;

function usesFixedLoader(period: Period): boolean {
  return period === "month";
}

export function InsightsScreen() {
  const { queryFilters, refreshToken, period } = useFilters();
  const {
    insights: data,
    recap,
    gamesLoading,
    sessionKey,
    metricsReady,
    refreshAnalytics,
    requestVaultMetrics,
  } = useAnalytics();
  const [error, setError] = useState<string | null>(null);
  const [minLoaderDone, setMinLoaderDone] = useState(!usesFixedLoader(period));
  const [refreshing, setRefreshing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const insightsOpacity = useRef(new Animated.Value(1)).current;
  const { setDepth, registerPopHandler } = useInsightsNav();

  useEffect(() => {
    // #region agent log
    agentLog("F", "InsightsScreen.tsx:mount", "request vault metrics on insights focus", {});
    // #endregion
    requestVaultMetrics(false);
  }, [requestVaultMetrics, sessionKey, refreshToken]);

  useEffect(() => {
    if (!metricsReady && showCatalog) setShowCatalog(false);
  }, [metricsReady, showCatalog]);

  useEffect(() => {
    if (!showCatalog) {
      setDepth(0);
      registerPopHandler(null);
    }
  }, [showCatalog, setDepth, registerPopHandler]);

  const openCatalog = useCallback(() => {
    if (!metricsReady) return;
    Animated.timing(insightsOpacity, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setShowCatalog(true);
    });
  }, [insightsOpacity, metricsReady]);

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
    setMinLoaderDone(!usesFixedLoader(period));
    if (!usesFixedLoader(period)) return;
    const t = setTimeout(() => setMinLoaderDone(true), FIXED_LOADER_MS);
    return () => clearTimeout(t);
  }, [sessionKey, refreshToken, period]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refreshAnalytics(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
    } finally {
      setRefreshing(false);
    }
  }, [refreshAnalytics]);

  const showPieceLoader =
    usesFixedLoader(period) && (!minLoaderDone || !data);
  const showSkeleton = !usesFixedLoader(period) && !data;
  const contentKey = showPieceLoader
    ? `loader:${period}:${refreshToken}`
    : showSkeleton
      ? `skeleton:${period}:${refreshToken}`
      : error && !data
        ? "error"
        : data
          ? `${period}:${refreshToken}:${queryFilters.dateFrom || ""}:${queryFilters.dateTo || ""}`
          : "empty";

  const factors = data ? selectFactors(data) : null;
  const results = recap?.results || {
    wins: 0,
    draws: 0,
    losses: 0,
    win_rate: factors?.baseline_win_rate || 0,
  };
  const ratingSeries = (recap?.rating_series || []).slice(-12);
  const winRate = results.win_rate || factors?.baseline_win_rate || 0;

  useEffect(() => {
    // #region agent log
    agentLog("B", "InsightsScreen.tsx:gate", "insights gate state", {
      metricsReady,
      hasData: !!data,
      gamesLoading,
      showPieceLoader,
      showSkeleton,
    });
    // #endregion
  }, [metricsReady, data, gamesLoading, showPieceLoader, showSkeleton]);

  return (
    <View style={styles.stack}>
      <EvalPendingWarning />
      <Animated.View style={[styles.insightsLayer, { opacity: insightsOpacity }]}>
      <PageLoadingTransition active={showPieceLoader} contentKey={contentKey}>
        {showSkeleton ? (
          <InsightsSkeleton />
        ) : showPieceLoader ? null : error && !data ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : data && factors ? (
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
                    baseline={factors.baseline_win_rate}
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
                    baseline={factors.baseline_win_rate}
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
              />
            </View>
          </ScrollView>
        ) : null}
      </PageLoadingTransition>
      </Animated.View>

      {showCatalog && data && metricsReady ? (
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
  baseline,
  positive,
}: {
  item: FactorItem;
  baseline: number;
  positive: boolean;
}) {
  const accent = positive ? result.win : result.loss;
  const widthPct = Math.max(8, Math.min(100, item.win_rate));
  const baselinePct = Math.max(0, Math.min(100, baseline));

  return (
    <EdgeCard style={styles.factorCard}>
      <Text style={styles.factorName}>{item.condition}</Text>
      <View style={styles.factorRow}>
        <Text style={styles.factorValue}>{item.win_rate}%</Text>
        <Text style={[styles.factorDelta, { color: accent }]}>
          {item.diff > 0 ? "+" : ""}
          {item.diff}% vs baseline
        </Text>
      </View>
      <View style={styles.barTrack}>
        <View
          style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: accent }]}
        />
        <View style={[styles.baselineMark, { left: `${baselinePct}%` }]} />
      </View>
    </EdgeCard>
  );
}

const styles = StyleSheet.create({
  stack: { flex: 1, backgroundColor: colors.bg },
  insightsLayer: { flex: 1 },
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
  factorDelta: {
    ...type.caption,
    fontFamily: font.sansMedium,
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
