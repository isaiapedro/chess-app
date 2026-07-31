import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LineChart, PieChart } from "react-native-chart-kit";
import { colors, font, result, spacing } from "../theme";
import type { HourlyPoint, MonthlyPoint, Period, RatingPoint } from "../api/types";

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

const chartConfig = {
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  color: (opacity = 1) => `rgba(52, 199, 89, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(136, 136, 136, ${opacity})`,
  decimalPlaces: 0,
  propsForDots: {
    r: "2",
    strokeWidth: "1",
    stroke: result.win,
  },
  propsForBackgroundLines: {
    stroke: colors.border,
    strokeDasharray: "4 6",
  },
  fillShadowGradientFrom: result.win,
  fillShadowGradientTo: colors.surface,
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

function sampleSeries(points: RatingPoint[], limit = 40): RatingPoint[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => {
    return points[Math.round(index * step)];
  });
}

function hourTick(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

export function RatingChart({
  points,
  period = "all",
}: {
  points: RatingPoint[];
  period?: Period;
}) {
  const { width } = useWindowDimensions();
  const animation = useEntranceAnimation();
  const series = useMemo(() => {
    if (period === "year" || period === "all" || period === "day") return points;
    return sampleSeries(points);
  }, [points, period]);

  if (series.length < 2) return null;

  const spansYears =
    period === "all" ||
    (period === "year" &&
      new Date(series[0].created_at).getFullYear() !==
        new Date(series[series.length - 1].created_at).getFullYear());

  const labels = series.map((point, index) => {
    const date = new Date(point.created_at);
    const previous = index === 0 ? null : new Date(series[index - 1].created_at);

    if (period === "day") {
      return date.getHours() % 6 === 0 ? hourTick(date.getHours()) : "";
    }

    if (period === "week") {
      return String(date.getDate());
    }

    if (period === "month") {
      const bucket = Math.floor((date.getDate() - 1) / 5);
      const previousBucket = previous
        ? Math.floor((previous.getDate() - 1) / 5)
        : null;
      return bucket !== previousBucket ? String(bucket * 5 + 1) : "";
    }

    const initial = MONTH_INITIALS[date.getMonth()];
    const yearChanged =
      spansYears &&
      date.getMonth() === 0 &&
      (previous == null || previous.getFullYear() !== date.getFullYear());
    if (yearChanged) {
      return `${initial}\n${String(date.getFullYear()).slice(2)}`;
    }
    return initial;
  });

  const yearMarks = spansYears
    ? series
        .map((point, index) => {
          const date = new Date(point.created_at);
          const previous = index === 0 ? null : new Date(series[index - 1].created_at);
          if (
            date.getMonth() === 0 &&
            (previous == null || previous.getFullYear() !== date.getFullYear())
          ) {
            return { index, year: String(date.getFullYear()).slice(2) };
          }
          return null;
        })
        .filter((mark): mark is { index: number; year: string } => mark != null)
    : [];

  return (
    <Animated.View style={[styles.panel, animation]}>
      <Text style={styles.title}>Rating Progression</Text>
      <LineChart
        data={{
          labels: labels.map((label) => label.split("\n")[0]),
          datasets: [{ data: series.map((point) => point.user_rating) }],
        }}
        width={Math.max(280, width - spacing.md * 4)}
        height={200}
        chartConfig={chartConfig}
        bezier
        withInnerLines
        withOuterLines={false}
        withVerticalLines={false}
        style={styles.chart}
      />
      {yearMarks.length ? (
        <View style={styles.yearRow}>
          {series.map((point, index) => {
            const mark = yearMarks.find((item) => item.index === index);
            return (
              <View key={`${point.created_at}-${index}`} style={styles.yearSlot}>
                <Text style={styles.yearTick}>{mark ? mark.year : ""}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </Animated.View>
  );
}

export function MonthlyGamesChart({ points }: { points: MonthlyPoint[] }) {
  const animation = useEntranceAnimation();
  if (!points.length) return null;

  const max = Math.max(...points.map((p) => p.games), 1);

  return (
    <Animated.View style={[styles.panel, animation]}>
      <Text style={styles.title}>Games by Month</Text>
      <View style={styles.barRow}>
        {points.map((point) => {
          const ratio = point.games / max;
          const height = point.games > 0 ? Math.max(ratio * 100, 6) : 0;
          return (
            <View key={point.month_key} style={styles.barSlot}>
              <View style={styles.barTrack}>
                <View
                  style={[styles.barFill, styles.barFillRed, { height: `${height}%` }]}
                />
              </View>
              <Text style={styles.barTick}>{point.month.charAt(0)}</Text>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

export function HourlyGamesChart({
  points,
  peakLabel,
}: {
  points: HourlyPoint[];
  peakLabel?: string;
}) {
  const animation = useEntranceAnimation();
  if (!points.length) return null;

  const max = Math.max(...points.map((p) => p.games), 1);

  return (
    <Animated.View style={[styles.panel, animation]}>
      <View style={styles.rowBetween}>
        <Text style={styles.title}>When You Play</Text>
        {peakLabel ? (
          <Text style={styles.meta}>
            Peak: <Text style={styles.metaStrong}>{peakLabel}</Text>
          </Text>
        ) : null}
      </View>
      <View style={styles.barRow}>
        {points.map((point) => {
          const ratio = point.games / max;
          const height = point.games > 0 ? Math.max(ratio * 100, 6) : 0;
          return (
            <View key={point.hour} style={styles.barSlot}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: `${height}%` }]} />
              </View>
              <Text style={styles.barTick}>
                {point.hour % 6 === 0 ? hourTick(point.hour) : ""}
              </Text>
            </View>
          );
        })}
      </View>
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
    borderRadius: 0,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: "hidden",
    padding: spacing.md,
  },
  title: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 11,
    fontWeight: "400",
    letterSpacing: 2,
    marginBottom: spacing.sm,
    textTransform: "uppercase",
  },
  chart: {
    borderRadius: 0,
    marginLeft: -spacing.sm,
  },
  yearRow: {
    flexDirection: "row",
    marginTop: -4,
    marginLeft: 48,
    marginRight: 8,
  },
  yearSlot: {
    flex: 1,
    alignItems: "center",
  },
  yearTick: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 10,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  meta: {
    color: colors.textDim,
    fontFamily: font.sans,
    fontSize: 11,
  },
  metaStrong: {
    color: colors.cream,
    fontFamily: font.monoBold,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    marginTop: spacing.sm,
  },
  barSlot: {
    flex: 1,
    alignItems: "center",
  },
  barTrack: {
    width: "100%",
    height: 96,
    justifyContent: "flex-end",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  barFill: {
    width: "100%",
    backgroundColor: colors.cream,
  },
  barFillRed: {
    backgroundColor: colors.red,
  },
  barTick: {
    color: colors.textDim,
    fontFamily: font.mono,
    fontSize: 10,
    marginTop: 6,
  },
});
