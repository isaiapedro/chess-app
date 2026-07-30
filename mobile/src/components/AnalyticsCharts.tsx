import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LineChart, PieChart } from "react-native-chart-kit";
import { colors, spacing } from "../theme";

type RatingPoint = {
  created_at: string;
  user_rating: number;
};

const chartConfig = {
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  color: (opacity = 1) => `rgba(74, 222, 128, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(139, 155, 180, ${opacity})`,
  decimalPlaces: 0,
  propsForDots: {
    r: "2",
    strokeWidth: "1",
    stroke: colors.accent,
  },
  propsForBackgroundLines: {
    stroke: colors.border,
    strokeDasharray: "4 6",
  },
};

function useEntranceAnimation() {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 16,
        stiffness: 120,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  return { opacity, transform: [{ translateY }] };
}

function sampleSeries(points: RatingPoint[], limit = 24): RatingPoint[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => {
    return points[Math.round(index * step)];
  });
}

export function RatingChart({ points }: { points: RatingPoint[] }) {
  const { width } = useWindowDimensions();
  const animation = useEntranceAnimation();
  const sampled = useMemo(() => sampleSeries(points), [points]);

  if (sampled.length < 2) return null;

  const labelEvery = Math.max(1, Math.ceil(sampled.length / 5));
  const labels = sampled.map((point, index) => {
    if (index % labelEvery !== 0 && index !== sampled.length - 1) return "";
    return new Date(point.created_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  });

  return (
    <Animated.View style={[styles.panel, animation]}>
      <Text style={styles.title}>Rating progression</Text>
      <LineChart
        data={{
          labels,
          datasets: [{ data: sampled.map((point) => point.user_rating) }],
        }}
        width={Math.max(280, width - spacing.md * 4)}
        height={220}
        chartConfig={chartConfig}
        bezier
        withInnerLines
        withOuterLines={false}
        withVerticalLines={false}
        style={styles.chart}
      />
    </Animated.View>
  );
}

type DonutDatum = {
  name: string;
  value: number;
  color: string;
};

export function DonutChart({
  title,
  data,
}: {
  title: string;
  data: DonutDatum[];
}) {
  const { width } = useWindowDimensions();
  const animation = useEntranceAnimation();
  const visible = data.filter((item) => item.value > 0);

  if (!visible.length) return null;

  return (
    <Animated.View style={[styles.panel, animation]}>
      <Text style={styles.title}>{title}</Text>
      <PieChart
        data={visible.map((item) => ({
          name: item.name,
          population: item.value,
          color: item.color,
          legendFontColor: colors.textMuted,
          legendFontSize: 12,
        }))}
        width={Math.max(280, width - spacing.md * 4)}
        height={180}
        accessor="population"
        backgroundColor="transparent"
        paddingLeft="10"
        center={[0, 0]}
        absolute
        chartConfig={chartConfig}
      />
    </Animated.View>
  );
}

export function AnimatedPanel({
  children,
}: {
  children: React.ReactNode;
}) {
  const animation = useEntranceAnimation();
  return (
    <Animated.View style={[styles.panel, animation]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: "hidden",
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  chart: {
    borderRadius: 12,
    marginLeft: -spacing.sm,
  },
});
