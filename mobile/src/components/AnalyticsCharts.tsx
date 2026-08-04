import React, { useEffect, useMemo, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LineChart, PieChart } from "react-native-chart-kit";
import { Text as SvgText } from "react-native-svg";
import { colors, font, radius, result, spacing, type, withAlpha } from "../theme";
import type { HourlyPoint, MonthlyPoint, Period, RatingPoint } from "../api/types";
import type { RatingCurve } from "../api/selectors";

const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const X_LABELS_HEIGHT_PCT = 0.75;

const chartConfig = {
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.surface,
  color: (opacity = 1) => `rgba(52, 199, 89, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(160, 160, 160, ${opacity})`,
  decimalPlaces: 0,
  strokeWidth: 2.5,
  propsForDots: {
    r: "0",
  },
  propsForLabels: {
    fontFamily: font.sans,
    fontSize: 11,
  },
  propsForBackgroundLines: {
    stroke: "rgba(255,255,255,0.05)",
    strokeDasharray: "",
  },
  fillShadowGradientFrom: result.win,
  fillShadowGradientFromOpacity: 0.22,
  fillShadowGradientTo: colors.surface,
  fillShadowGradientToOpacity: 0,
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
  let peakIdx = 0;
  let troughIdx = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].user_rating > points[peakIdx].user_rating) peakIdx = i;
    if (points[i].user_rating < points[troughIdx].user_rating) troughIdx = i;
  }
  const chosen = new Set<number>([0, points.length - 1, peakIdx, troughIdx]);
  const step = (points.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    chosen.add(Math.round(index * step));
    if (chosen.size >= limit) break;
  }
  if (chosen.size < limit) {
    for (let i = 0; i < points.length && chosen.size < limit; i += 1) {
      chosen.add(i);
    }
  }
  return [...chosen]
    .sort((a, b) => a - b)
    .slice(0, limit)
    .map((index) => points[index]);
}

function hourTick(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

export function RatingChart({
  points,
  curves = [],
  period = "all",
}: {
  points: RatingPoint[];
  curves?: RatingCurve[];
  period?: Period;
}) {
  const { width } = useWindowDimensions();
  const animation = useEntranceAnimation();
  const multi = curves.length > 1;
  const series = useMemo(() => {
    if (multi) return curves[0].points;
    if (period === "year" || period === "all" || period === "day") return points;
    return sampleSeries(points);
  }, [points, period, multi, curves]);

  if ((!multi && series.length < 2) || (multi && curves.every((c) => c.points.length < 2))) {
    return null;
  }

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

    return MONTH_INITIALS[date.getMonth()];
  });

  const yearMarks =
    period === "year" || period === "all"
      ? series
          .map((point, index) => {
            const date = new Date(point.created_at);
            const previous =
              index === 0 ? null : new Date(series[index - 1].created_at);
            if (
              date.getMonth() === 0 &&
              (previous == null || previous.getFullYear() !== date.getFullYear())
            ) {
              return { index, year: String(date.getFullYear()) };
            }
            return null;
          })
          .filter((mark): mark is { index: number; year: string } => mark != null)
      : [];

  const hexToRgba = (hex: string, opacity: number) => {
    const cleaned = hex.replace("#", "");
    const value = cleaned.length === 3
      ? cleaned.split("").map((ch) => ch + ch).join("")
      : cleaned;
    const num = parseInt(value, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const datasets = multi
    ? curves.map((curve) => ({
        data: curve.points.map((point) => point.user_rating),
        color: (opacity = 1) => hexToRgba(curve.color, opacity),
        strokeWidth: 2,
      }))
    : [{ data: series.map((point) => point.user_rating) }];

  const chartWidth = Math.max(280, width - spacing.md * 4);
  const chartHeight = yearMarks.length ? 270 : 250;

  return (
    <Animated.View style={[styles.panel, animation]}>
      <Text style={styles.title}>Rating</Text>
      <LineChart
        data={{
          labels,
          datasets,
        }}
        width={chartWidth}
        height={chartHeight}
        chartConfig={chartConfig}
        bezier
        withInnerLines
        withOuterLines={false}
        withVerticalLines={false}
        xLabelsOffset={yearMarks.length ? -2 : 0}
        style={styles.chart}
        decorator={({
          width: plotWidth,
          height: plotHeight,
          paddingRight = 64,
          paddingTop = 16,
        }: {
          width: number;
          height: number;
          paddingRight?: number;
          paddingTop?: number;
        }) => {
          if (!yearMarks.length) return null;
          const count = Math.max(labels.length, 1);
          const monthLabelY =
            plotHeight * X_LABELS_HEIGHT_PCT + paddingTop + 12 * 2 - 2;
          return (
            <>
              {yearMarks.map((mark) => {
                const x =
                  ((plotWidth - paddingRight) / count) * mark.index +
                  paddingRight;
                return (
                  <SvgText
                    key={`year-${mark.year}-${mark.index}`}
                    x={x}
                    y={monthLabelY + 11}
                    fill={colors.textDim}
                    fontSize="8"
                    fontFamily={font.mono}
                    textAnchor="middle"
                  >
                    {`(${mark.year})`}
                  </SvgText>
                );
              })}
            </>
          );
        }}
      />
      {multi ? (
        <View style={styles.legendRow}>
          {curves.map((curve) => (
            <View key={curve.key} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: curve.color }]} />
              <Text style={styles.legendLabel}>{curve.label}</Text>
            </View>
          ))}
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
      <Text style={styles.title}>Games by month</Text>
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
        <Text style={styles.title}>When you play</Text>
        {peakLabel ? (
          <Text style={styles.meta}>
            Peak <Text style={styles.metaStrong}>{peakLabel}</Text>
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
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: "hidden",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  title: {
    ...type.subheading,
    fontFamily: font.sansBold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  chart: {
    borderRadius: radius.md,
    marginLeft: -spacing.sm,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
  },
  legendLabel: {
    ...type.caption,
    color: colors.textMuted,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  meta: {
    ...type.caption,
    color: colors.textDim,
  },
  metaStrong: {
    color: colors.text,
    fontFamily: font.sansMedium,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
    marginTop: spacing.xs,
  },
  barSlot: {
    flex: 1,
    alignItems: "center",
  },
  barTrack: {
    width: "100%",
    height: 104,
    justifyContent: "flex-end",
    borderRadius: radius.pill,
    backgroundColor: withAlpha("#ffffff", 0.04),
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.textSoft,
  },
  barFillRed: {
    backgroundColor: colors.red,
  },
  barTick: {
    ...type.micro,
    color: colors.textDim,
    marginTop: 8,
  },
});
