import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { fetchRecap } from "../api/client";
import type { RecapResponse } from "../api/types";
import { BadgeCard, ComparisonCard, MetricCard } from "../components/RecapCards";
import { useFilters } from "../context/FilterContext";
import { colors, spacing } from "../theme";

export function RecapScreen() {
  const { queryFilters, refreshToken } = useFilters();
  const [data, setData] = useState<RecapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRecap(queryFilters);
      setData(res);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load recap");
    } finally {
      setLoading(false);
    }
  }, [queryFilters]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.muted}>Loading wrapped stats…</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Text style={styles.muted}>
          Is the API running? Check EXPO_PUBLIC_API_URL (use Metro :8081).
        </Text>
      </View>
    );
  }

  const headline = data?.headline || {};
  const comparisons = data?.comparisons || {};
  const badges = data?.badges || [];
  const games = data?.meta.games_count ?? 0;
  const ratingSeries = data?.rating_series || [];
  const firstRating = ratingSeries[0]?.user_rating;
  const lastRating = ratingSeries[ratingSeries.length - 1]?.user_rating;
  const eloDelta =
    firstRating != null && lastRating != null
      ? lastRating - firstRating
      : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={load}
          tintColor={colors.accent}
        />
      }
    >
      <Text style={styles.heading}>Your Recap</Text>
      <Text style={styles.sub}>
        {data?.meta.username} · {data?.meta.platform} · {games} games
      </Text>

      <View style={styles.grid}>
        <MetricCard
          label="Games"
          value={`${headline.total_games ?? 0}`}
        />
        <MetricCard
          label="Moves"
          value={`${(headline.total_moves ?? 0).toLocaleString()}`}
        />
        <MetricCard
          label="Hours played"
          value={`~${headline.total_hours ?? 0}`}
        />
        <MetricCard
          label="Best streaks"
          value={`${headline.max_win_streak ?? 0}W / ${headline.max_unbeaten_streak ?? 0}U`}
          caption={`Peak: ${headline.peak_day ?? "—"} ${headline.peak_hour ?? ""}`}
        />
        <MetricCard
          label="Elo change"
          value={
            eloDelta == null
              ? "—"
              : `${eloDelta >= 0 ? "+" : ""}${eloDelta}`
          }
          caption={
            firstRating != null && lastRating != null
              ? `${firstRating} → ${lastRating}`
              : undefined
          }
        />
      </View>

      <Text style={styles.section}>Real-world equivalents</Text>
      <View style={styles.comparisons}>
        <ComparisonCard
          icon="📚"
          label="Books read"
          value={`${comparisons.books_read ?? 0}`}
        />
        <ComparisonCard
          icon="🎬"
          label="Movies watched"
          value={`${comparisons.movies_watched ?? 0}`}
        />
        <ComparisonCard
          icon="🚶"
          label="Km walked"
          value={`${comparisons.km_walked ?? 0}`}
        />
      </View>

      <Text style={styles.section}>Archetypes</Text>
      {badges.map((b) => (
        <BadgeCard
          key={b.title}
          emoji={b.emoji}
          title={b.title}
          desc={b.desc}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heading: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  sub: {
    color: colors.textMuted,
    marginBottom: spacing.md,
    marginTop: 4,
  },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  comparisons: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  muted: {
    color: colors.textMuted,
    textAlign: "center",
  },
  error: {
    color: colors.danger,
    textAlign: "center",
    fontWeight: "600",
  },
});
