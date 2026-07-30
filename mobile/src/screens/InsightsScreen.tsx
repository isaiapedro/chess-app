import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchInsights } from "../api/client";
import type { InsightsResponse } from "../api/types";
import { AnimatedPanel, DonutChart } from "../components/AnalyticsCharts";
import { useFilters } from "../context/FilterContext";
import { colors, spacing } from "../theme";

type NumericMap = Record<string, number>;
type OpeningRow = {
  opening_eco?: string;
  eco_label?: string;
  total?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  win_rate?: number;
};

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asMap(value: unknown): NumericMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      asNumber(item),
    ])
  );
}

export function InsightsScreen() {
  const { queryFilters, refreshToken } = useFilters();
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (forceNetwork = false) => {
      setLoading(true);
      setError(null);
      try {
        setData(await fetchInsights(queryFilters, forceNetwork));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load insights");
      } finally {
        setLoading(false);
      }
    },
    [queryFilters]
  );

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.muted}>Loading insights…</Text>
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

  const style = data?.style || {};
  const conditional =
    (style.conditional as Record<string, unknown> | undefined) || {};
  const clock = (style.clock as Record<string, unknown> | undefined) || {};
  const openings = data?.openings || {};
  const middlegames = data?.middlegames || {};
  const endgames = data?.endgames || {};
  const castling = asMap(style.castling_counts);
  const endgameTypes = asMap(endgames.endgame_types);
  const openingRows = Array.isArray(openings.op_group)
    ? (openings.op_group as OpeningRow[])
        .slice()
        .sort((a, b) => asNumber(b.total) - asNumber(a.total))
        .slice(0, 5)
    : [];

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={() => load(true)}
          tintColor={colors.accent}
        />
      }
    >
      <Text style={styles.title}>Insights</Text>
      <Text style={styles.subtitle}>
        {data?.meta.username} · {data?.meta.games_count ?? 0} games
      </Text>

      <Text style={styles.section}>Playing style</Text>
      <AnimatedPanel>
        <View style={styles.metricGrid}>
          <Metric
            label="Baseline win rate"
            value={`${asNumber(conditional.baseline_win_rate).toFixed(1)}%`}
          />
          <Metric
            label="First blood"
            value={`${asNumber(style.first_blood_pct).toFixed(1)}%`}
          />
          <Metric
            label="Vs higher rated"
            value={`${asNumber(conditional.underdog_win_rate).toFixed(1)}%`}
          />
          <Metric
            label="Avg move time"
            value={`${asNumber(clock.avg_time_per_move_user).toFixed(1)}s`}
          />
        </View>
      </AnimatedPanel>

      <DonutChart
        title="Castling choices"
        data={[
          { name: "Kingside", value: castling.Kingside || 0, color: colors.accent },
          { name: "Queenside", value: castling.Queenside || 0, color: colors.info },
          { name: "Uncastled", value: castling.Uncastled || 0, color: colors.warning },
        ]}
      />

      <Text style={styles.section}>Openings</Text>
      <AnimatedPanel>
        <Text style={styles.panelTitle}>Most played ECOs</Text>
        {openingRows.map((row) => (
          <View key={row.opening_eco || row.eco_label} style={styles.listRow}>
            <View style={styles.listCopy}>
              <Text style={styles.listTitle} numberOfLines={1}>
                {row.eco_label || row.opening_eco || "Unknown"}
              </Text>
              <View style={styles.track}>
                <View
                  style={[
                    styles.trackFill,
                    {
                      width: `${Math.min(100, Math.max(2, asNumber(row.win_rate)))}%`,
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.listMeta}>
              {row.total ?? 0}g · {asNumber(row.win_rate).toFixed(0)}%
            </Text>
          </View>
        ))}
      </AnimatedPanel>

      <Text style={styles.section}>Middlegame</Text>
      <AnimatedPanel>
        <View style={styles.metricGrid}>
          <Metric
            label="Knights captured"
            value={`${asNumber(middlegames.knights_captured)}`}
          />
          <Metric
            label="Bishops captured"
            value={`${asNumber(middlegames.bishops_captured)}`}
          />
          <Metric
            label="Early queen trades"
            value={`${asNumber(middlegames.queenless_pct).toFixed(1)}%`}
          />
          <Metric
            label="Underpromotions"
            value={`${asNumber(middlegames.underpromotions)}`}
          />
        </View>
      </AnimatedPanel>

      <Text style={styles.section}>Endgame</Text>
      <DonutChart
        title="Endgame types reached"
        data={Object.entries(endgameTypes).map(([name, value], index) => ({
          name,
          value,
          color: [colors.accent, colors.info, colors.warning, "#a78bfa", "#f87171"][
            index % 5
          ],
        }))}
      />
      <AnimatedPanel>
        <View style={styles.metricGrid}>
          <Metric
            label="Sprints (≤30)"
            value={`${asNumber(endgames.short_games_count)}`}
            detail={`${asNumber(endgames.short_win_rate).toFixed(1)}% wins`}
          />
          <Metric
            label="Marathons (>50)"
            value={`${asNumber(endgames.marathon_games_count)}`}
            detail={`${asNumber(endgames.marathon_win_rate).toFixed(1)}% wins`}
          />
        </View>
      </AnimatedPanel>
    </ScrollView>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {detail ? <Text style={styles.metricDetail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  center: {
    alignItems: "center",
    backgroundColor: colors.bg,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: 4,
  },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metric: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    flexGrow: 1,
    minWidth: "46%",
    padding: spacing.md,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  metricValue: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "700",
    marginTop: 3,
  },
  metricDetail: {
    color: colors.accent,
    fontSize: 11,
    marginTop: 2,
  },
  listRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: 10,
  },
  listCopy: {
    flex: 1,
  },
  listTitle: {
    color: colors.text,
    fontSize: 13,
    marginBottom: 5,
  },
  listMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  track: {
    backgroundColor: colors.bg,
    borderRadius: 3,
    height: 5,
    overflow: "hidden",
  },
  trackFill: {
    backgroundColor: colors.accent,
    borderRadius: 3,
    height: "100%",
  },
  muted: {
    color: colors.textMuted,
    textAlign: "center",
  },
  error: {
    color: colors.danger,
    fontWeight: "600",
    textAlign: "center",
  },
});
