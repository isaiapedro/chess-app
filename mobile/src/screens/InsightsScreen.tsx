import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { LineChart } from "react-native-chart-kit";
import { fetchInsights, fetchRecap } from "../api/client";
import { selectFactors } from "../api/selectors";
import type {
  FactorItem,
  InsightsResponse,
  Period,
  RecapResponse,
} from "../api/types";
import {
  InsightsSkeleton,
  PageLoadingTransition,
} from "../components/LoadingSkeletons";
import { BrutalButton, DisplayTitle, EdgeCard, Eyebrow } from "../components/ui";
import { useFilters } from "../context/FilterContext";
import { colors, font, result, spacing, withAlpha } from "../theme";
import { CatalogScreen } from "./CatalogScreen";

const FIXED_LOADER_MS = 2000;

function usesFixedLoader(period: Period): boolean {
  return period === "day" || period === "week" || period === "month";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function InsightsScreen() {
  const { queryFilters, refreshToken, period } = useFilters();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [recap, setRecap] = useState<RecapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);

  const load = useCallback(
    async (forceNetwork = false) => {
      const startedAt = Date.now();
      try {
        setError(null);
        const [insights, recapData] = await Promise.all([
          fetchInsights(queryFilters, forceNetwork),
          fetchRecap(queryFilters, forceNetwork),
        ]);
        setData(insights);
        setRecap(recapData);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load insights");
      } finally {
        if (!forceNetwork && usesFixedLoader(period)) {
          await wait(Math.max(0, FIXED_LOADER_MS - (Date.now() - startedAt)));
        }
        setLoading(false);
        setRefreshing(false);
      }
    },
    [period, queryFilters]
  );

  useEffect(() => {
    setLoading(true);
    void load(false);
  }, [load, refreshToken]);

  if (showCatalog && data) {
    return <CatalogScreen data={data} onBack={() => setShowCatalog(false)} />;
  }

  const showPieceLoader = loading && usesFixedLoader(period);
  const showSkeleton = loading && !data && !usesFixedLoader(period);
  const contentKey = showPieceLoader
    ? `loader:${period}:${refreshToken}`
    : showSkeleton
      ? `skeleton:${period}`
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

  return (
    <PageLoadingTransition active={showPieceLoader} contentKey={contentKey}>
      {showSkeleton ? (
        <InsightsSkeleton />
      ) : error && !data ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : data && factors ? (
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
        <Eyebrow>Performance Analysis</Eyebrow>
        <DisplayTitle size={34}>
          What Moves{"\n"}the Needle
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
                  <Text style={[styles.wdlValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={styles.wdlLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
            {ratingSeries.length > 1 ? (
              <LineChart
                data={{
                  labels: ratingSeries.map(() => ""),
                  datasets: [{ data: ratingSeries.map((p) => p.user_rating) }],
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
        <GroupHeading label="Driving Your Wins" accent={result.win} />
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
          <Text style={styles.empty}>No positive drivers in this sample.</Text>
        )}
      </View>

      <View style={styles.pad}>
        <GroupHeading label="Costing You Points" accent={result.loss} />
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
          <Text style={styles.empty}>No negative drivers in this sample.</Text>
        )}
      </View>

      <View style={[styles.pad, { marginTop: spacing.md }]}>
        <BrutalButton
          label="Explore All Metrics →"
          onPress={() => setShowCatalog(true)}
        />
      </View>
      </ScrollView>
      ) : null}
    </PageLoadingTransition>
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
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <Text style={[styles.groupLabel, { color: accent }]}>{label}</Text>
      <View style={styles.rule} />
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
    <EdgeCard style={{ ...styles.factorCard, borderLeftColor: accent, borderLeftWidth: 3 }}>
      <Text style={styles.factorName}>{item.condition}</Text>
      <View style={styles.factorRow}>
        <Text style={styles.factorValue}>{item.win_rate}%</Text>
        <Text style={[styles.factorDelta, { color: accent }]}>
          {item.diff > 0 ? "+" : ""}
          {item.diff}%
        </Text>
      </View>
      <Text style={styles.factorMeta}>baseline {baseline}%</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: accent }]} />
        <View style={[styles.baselineMark, { left: `${baselinePct}%` }]} />
      </View>
      <View style={styles.barLabels}>
        <Text style={styles.barLabel}>You</Text>
        <Text style={styles.barLabel}>Your baseline</Text>
      </View>
    </EdgeCard>
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
  error: { color: colors.red, fontFamily: font.monoBold, textAlign: "center" },
  hero: { padding: spacing.md, paddingTop: spacing.lg },
  summaryCard: { marginHorizontal: spacing.md, marginBottom: spacing.md },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  wdlRow: { flexDirection: "row", gap: 14, marginBottom: 6 },
  wdlValue: { fontFamily: font.display, fontSize: 20 },
  wdlLabel: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  dialCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  dialValue: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 15,
  },
  pad: { paddingHorizontal: spacing.md, marginTop: spacing.sm },
  groupHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dot: { width: 8, height: 8 },
  groupLabel: {
    fontFamily: font.monoBold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  empty: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 12,
    marginBottom: spacing.md,
  },
  factorCard: { marginBottom: spacing.sm },
  factorName: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  factorRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  factorValue: {
    color: colors.text,
    fontFamily: font.display,
    fontSize: 28,
  },
  factorDelta: {
    fontFamily: font.monoBold,
    fontSize: 12,
  },
  factorMeta: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 12,
    marginTop: 2,
    marginBottom: 10,
  },
  barTrack: {
    height: 4,
    backgroundColor: withAlpha("#ffffff", 0.08),
    position: "relative",
  },
  barFill: { height: 4 },
  baselineMark: {
    position: "absolute",
    top: -1,
    width: 2,
    height: 6,
    backgroundColor: colors.rim,
    marginLeft: -1,
  },
  barLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  barLabel: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
  },
});
