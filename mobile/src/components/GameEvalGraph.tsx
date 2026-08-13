import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Defs,
  Line,
  LinearGradient,
  Path,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import type { CoachMark } from "../engine/gameCoach/coachMarks";
import type { PhaseSplits } from "../engine/gameCoach/phaseSplits";
import { colors, font, spacing, type } from "../theme";

export type EvalGraphPoint = {
  plyIndex: number;
  ply: number;
  /** White-POV centipawns from analysis */
  cp: number;
  mark: CoachMark | null;
};

const CP_CLAMP = 500;

function clampCp(cp: number): number {
  return Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
}

function xForIndex(i: number, n: number, padX: number, innerW: number): number {
  if (n <= 1) return padX + innerW / 2;
  return padX + (i / (n - 1)) * innerW;
}

/** userCp > 0 → advantage for the logged-in user → plotted upward */
function yForUserCp(userCp: number, padY: number, innerH: number): number {
  return padY + ((CP_CLAMP - clampCp(userCp)) / (CP_CLAMP * 2)) * innerH;
}

export function GameEvalGraph({
  points,
  currentPly,
  phaseSplits,
  userColor = "white",
  onSelectPly,
}: {
  points: EvalGraphPoint[];
  currentPly: number;
  phaseSplits?: PhaseSplits | null;
  userColor?: "white" | "black";
  onSelectPly?: (plyIndex: number) => void;
}) {
  const { width: winW } = useWindowDimensions();
  const width = winW;
  const height = 108;
  const padX = 10;
  const padY = 14;
  const padBottom = 18;
  const innerW = width - padX * 2;
  const innerH = height - padY - padBottom;
  const flip = userColor === "black" ? -1 : 1;

  const plotted = useMemo(() => {
    return points.filter((p) => Number.isFinite(p.cp));
  }, [points]);

  if (plotted.length < 2) {
    return (
      <Text style={styles.empty}>Eval graph needs a finished analysis.</Text>
    );
  }

  const n = plotted.length;
  const coords = plotted.map((p, i) => {
    const userCp = p.cp * flip;
    return {
      ...p,
      userCp,
      x: xForIndex(i, n, padX, innerW),
      y: yForUserCp(userCp, padY, innerH),
    };
  });

  const zeroY = yForUserCp(0, padY, innerH);
  const bottomY = padY + innerH;
  const topY = padY;

  const linePath = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ");
  const fillPath = `${linePath} L ${coords[n - 1].x} ${bottomY} L ${coords[0].x} ${bottomY} Z`;

  const cursor =
    currentPly < 0
      ? null
      : coords.find((c) => c.plyIndex === currentPly) || null;

  const splitX = (plyIndex: number): number | null => {
    const idx = coords.findIndex((c) => c.plyIndex >= plyIndex);
    if (idx < 0) return null;
    return coords[idx].x;
  };

  const mgX =
    phaseSplits != null
      ? splitX(phaseSplits.middlegameStartPlyIndex)
      : null;
  const egX =
    phaseSplits?.endgameStartPlyIndex != null
      ? splitX(phaseSplits.endgameStartPlyIndex)
      : null;

  const handlePress = (locationX: number) => {
    if (!onSelectPly || !coords.length) return;
    let best = coords[0];
    let bestDist = Math.abs(coords[0].x - locationX);
    for (const c of coords) {
      const d = Math.abs(c.x - locationX);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    onSelectPly(best.plyIndex);
  };

  const labelY = height - 4;
  const topSign = flip === 1 ? "+" : "−";
  const bottomSign = flip === 1 ? "−" : "+";

  return (
    <View style={styles.wrap}>
      <Pressable onPress={(e) => handlePress(e.nativeEvent.locationX)}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="evalAreaFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#c8c8c8" stopOpacity="0.55" />
              <Stop offset="0.35" stopColor="#a8a8a8" stopOpacity="0.32" />
              <Stop offset="0.7" stopColor="#7a7a7a" stopOpacity="0.12" />
              <Stop offset="1" stopColor="#5a5a5a" stopOpacity="0.04" />
            </LinearGradient>
          </Defs>

          <Path d={fillPath} fill="url(#evalAreaFill)" />

          <Line
            x1={padX}
            y1={zeroY}
            x2={padX + innerW}
            y2={zeroY}
            stroke={colors.textMuted}
            strokeWidth={1.25}
            opacity={0.85}
          />

          {mgX != null ? (
            <Line
              x1={mgX}
              y1={topY}
              x2={mgX}
              y2={bottomY}
              stroke={colors.cream}
              strokeWidth={1.75}
              strokeDasharray="5 3"
              opacity={0.72}
            />
          ) : null}
          {egX != null ? (
            <Line
              x1={egX}
              y1={topY}
              x2={egX}
              y2={bottomY}
              stroke={colors.cream}
              strokeWidth={1.75}
              strokeDasharray="5 3"
              opacity={0.72}
            />
          ) : null}

          <Path
            d={linePath}
            fill="none"
            stroke={colors.cream}
            strokeWidth={1.5}
          />

          {cursor ? (
            <Line
              x1={cursor.x}
              y1={topY}
              x2={cursor.x}
              y2={bottomY}
              stroke={colors.cream}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
          ) : null}

          <SvgText
            x={padX + 6}
            y={topY + 16}
            fill={colors.cream}
            fontSize={16}
            fontFamily={font.sansMedium}
            opacity={0.5}
          >
            {topSign}
          </SvgText>
          <SvgText
            x={padX + 6}
            y={bottomY - 6}
            fill={colors.cream}
            fontSize={16}
            fontFamily={font.sansMedium}
            opacity={0.5}
          >
            {bottomSign}
          </SvgText>

          {phaseSplits ? (
            <>
              <SvgText
                x={padX + 2}
                y={labelY}
                fill={colors.textDim}
                fontSize={9}
                fontFamily={font.sans}
              >
                Opening
              </SvgText>
              {mgX != null ? (
                <SvgText
                  x={mgX + 4}
                  y={labelY}
                  fill={colors.textDim}
                  fontSize={9}
                  fontFamily={font.sans}
                >
                  Middlegame
                </SvgText>
              ) : null}
              {egX != null ? (
                <SvgText
                  x={egX + 4}
                  y={labelY}
                  fill={colors.textDim}
                  fontSize={9}
                  fontFamily={font.sans}
                >
                  Endgame
                </SvgText>
              ) : null}
            </>
          ) : null}
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    width: "100%",
    alignSelf: "stretch",
  },
  empty: {
    fontFamily: font.sans,
    fontSize: type.caption.fontSize,
    color: colors.textDim,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
});
