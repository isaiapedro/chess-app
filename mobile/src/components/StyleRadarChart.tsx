import React, { useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from "react-native-svg";
import type { StyleRadarAxis } from "../engine/archetypeScores";
import { colors, font, spacing, withAlpha } from "../theme";

type Props = {
  axes: StyleRadarAxis[];
};

const RINGS = 4;
const LABEL_PAD = 28;

function polar(
  cx: number,
  cy: number,
  radius: number,
  index: number,
  count: number
) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

export function StyleRadarChart({ axes }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const size = Math.min(320, Math.max(240, windowWidth - 48));
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - LABEL_PAD - 8;
  const n = axes.length;

  const grid = useMemo(() => {
    return Array.from({ length: RINGS }, (_, ring) => {
      const r = (radius * (ring + 1)) / RINGS;
      return axes
        .map((_, i) => {
          const p = polar(cx, cy, r, i, n);
          return `${p.x},${p.y}`;
        })
        .join(" ");
    });
  }, [axes, cx, cy, n, radius]);

  const spokes = useMemo(() => {
    return axes.map((_, i) => polar(cx, cy, radius, i, n));
  }, [axes, cx, cy, n, radius]);

  const valuePoints = useMemo(() => {
    return axes
      .map((axis, i) => {
        const t = Math.max(0, Math.min(100, axis.score)) / 100;
        const p = polar(cx, cy, radius * t, i, n);
        return `${p.x},${p.y}`;
      })
      .join(" ");
  }, [axes, cx, cy, n, radius]);

  const labels = useMemo(() => {
    return axes.map((axis, i) => {
      const p = polar(cx, cy, radius + 18, i, n);
      return { ...axis, ...p };
    });
  }, [axes, cx, cy, n, radius]);

  if (n < 3) return null;

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size}>
        <G>
          {grid.map((points, idx) => (
            <Polygon
              key={`ring-${idx}`}
              points={points}
              fill="none"
              stroke={withAlpha("#ffffff", idx === RINGS - 1 ? 0.22 : 0.1)}
              strokeWidth={1}
            />
          ))}
          {spokes.map((p, i) => (
            <Line
              key={`spoke-${i}`}
              x1={cx}
              y1={cy}
              x2={p.x}
              y2={p.y}
              stroke={withAlpha("#ffffff", 0.14)}
              strokeWidth={1}
            />
          ))}
          <Polygon
            points={valuePoints}
            fill={withAlpha(colors.cream, 0.22)}
            stroke={colors.cream}
            strokeWidth={2}
          />
          {axes.map((axis, i) => {
            const t = Math.max(0, Math.min(100, axis.score)) / 100;
            const p = polar(cx, cy, radius * t, i, n);
            return (
              <Circle
                key={`dot-${axis.key}`}
                cx={p.x}
                cy={p.y}
                r={3.5}
                fill={colors.cream}
              />
            );
          })}
          {labels.map((label) => (
            <SvgText
              key={`label-${label.key}`}
              x={label.x}
              y={label.y}
              fill={colors.text}
              fontSize={11}
              fontFamily={font.mono}
              textAnchor="middle"
              alignmentBaseline="middle"
            >
              {label.name}
            </SvgText>
          ))}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    marginBottom: spacing.md,
  },
});
