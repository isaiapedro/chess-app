import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing, withAlpha } from "../theme";

type BoneProps = {
  width?: DimensionValue;
  height: number;
  circle?: boolean;
  style?: ViewStyle;
};

function usePulse(): Animated.Value {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.85,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return pulse;
}

function Bone({
  pulse,
  width = "100%",
  height,
  circle = false,
  style,
}: BoneProps & { pulse: Animated.Value }) {
  return (
    <Animated.View
      style={[
        styles.bone,
        {
          width,
          height,
          borderRadius: circle ? height / 2 : 0,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

function Card({
  pulse,
  height,
  children,
  style,
}: {
  pulse: Animated.Value;
  height?: number;
  children?: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, height ? { height } : null, style]}>
      {children || <Bone pulse={pulse} height={height || 80} />}
    </View>
  );
}

export function RecapSkeleton() {
  const pulse = usePulse();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      scrollEnabled={false}
    >
      <Bone pulse={pulse} width="48%" height={12} />
      <Bone pulse={pulse} width="76%" height={38} style={styles.gapSm} />
      <Bone pulse={pulse} width="58%" height={38} style={styles.gapXs} />
      <Bone pulse={pulse} width="28%" height={12} style={styles.gapSm} />
      <View style={[styles.row, styles.gapLg]}>
        <Bone pulse={pulse} width="42%" height={20} />
        <Bone pulse={pulse} width="24%" height={28} />
      </View>
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((item) => (
          <Card key={item} pulse={pulse} height={88} style={styles.gridItem}>
            <Bone pulse={pulse} width="52%" height={10} />
            <Bone pulse={pulse} width="72%" height={24} style={styles.gapSm} />
          </Card>
        ))}
      </View>
      <Card pulse={pulse} height={190} style={styles.gapLg} />
      <Card pulse={pulse} height={150} style={styles.gapMd} />
      <View style={[styles.row, styles.gapMd]}>
        <Bone pulse={pulse} width={72} height={28} circle />
        <Bone pulse={pulse} width={88} height={28} circle />
        <Bone pulse={pulse} width={64} height={28} circle />
      </View>
    </ScrollView>
  );
}

export function InsightsSkeleton() {
  const pulse = usePulse();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      scrollEnabled={false}
    >
      <Bone pulse={pulse} width="44%" height={12} />
      <Bone pulse={pulse} width="72%" height={34} style={styles.gapSm} />
      <Bone pulse={pulse} width="56%" height={34} style={styles.gapXs} />
      <Card pulse={pulse} style={styles.gapLg}>
        <View style={styles.summaryRow}>
          <Bone pulse={pulse} width={76} height={76} circle />
          <View style={styles.summaryText}>
            <View style={styles.row}>
              <Bone pulse={pulse} width="28%" height={30} />
              <Bone pulse={pulse} width="28%" height={30} />
              <Bone pulse={pulse} width="28%" height={30} />
            </View>
            <Bone pulse={pulse} height={12} style={styles.gapMd} />
          </View>
        </View>
      </Card>
      {[0, 1, 2].map((item) => (
        <Card key={item} pulse={pulse} style={styles.gapMd}>
          <Bone pulse={pulse} width="58%" height={14} />
          <Bone pulse={pulse} height={10} style={styles.gapMd} />
          <Bone pulse={pulse} width="36%" height={10} style={styles.gapSm} />
        </Card>
      ))}
    </ScrollView>
  );
}

export function OpeningChoiceSkeleton() {
  const pulse = usePulse();
  return (
    <View style={styles.choice}>
      <Bone pulse={pulse} width="72%" height={16} />
      <View style={[styles.row, styles.gapMd]}>
        <Bone pulse={pulse} width="48%" height={48} />
        <Bone pulse={pulse} width="48%" height={48} />
      </View>
      <Bone pulse={pulse} width="40%" height={12} style={styles.gapLg} />
      {[0, 1, 2].map((item) => (
        <Card key={item} pulse={pulse} height={58} style={styles.gapSm} />
      ))}
    </View>
  );
}

export function BootSkeleton() {
  const pulse = usePulse();
  return (
    <View style={styles.boot}>
      <Bone pulse={pulse} width={54} height={54} />
      <Bone pulse={pulse} width={150} height={18} style={styles.gapMd} />
      <Bone pulse={pulse} width={210} height={10} style={styles.gapSm} />
    </View>
  );
}

const TAB_BAR_BODY = 58;

export function ChessPieceLoader() {
  const rotation = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const tabClearance = TAB_BAR_BODY + Math.max(insets.bottom, 12);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [rotation]);

  return (
    <View style={styles.pieceLoaderScreen}>
      <View
        style={[
          styles.pieceLoaderTrack,
          {
            marginTop: -tabClearance / 2,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.pieceLoaderOrbit,
            {
              transform: [
                {
                  rotate: rotation.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "360deg"],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.pieceLoaderPiece}>♟</Text>
        </Animated.View>
      </View>
    </View>
  );
}

export function PageLoadingTransition({
  active,
  children,
  loader,
  contentKey,
  style,
}: {
  active: boolean;
  children: React.ReactNode;
  loader?: React.ReactNode;
  contentKey?: string | number | null;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(active ? 0 : 1)).current;
  const [phase, setPhase] = useState<"loader" | "content">(
    active ? "loader" : "content"
  );
  const [frozenChildren, setFrozenChildren] = useState<React.ReactNode | null>(
    null
  );
  const childrenRef = useRef(children);
  const contentKeyRef = useRef(contentKey);
  const fadingRef = useRef(false);
  childrenRef.current = children;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    if (active && phase === "content") {
      fadingRef.current = false;
      setFrozenChildren(null);
      opacity.setValue(0);
      setPhase("loader");
      return;
    }

    if (!active && phase === "loader") {
      fadingRef.current = true;
      animation = Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      });
      animation.start(({ finished }) => {
        fadingRef.current = false;
        if (!finished) return;
        contentKeyRef.current = contentKey;
        setPhase("content");
      });
    } else if (phase === "loader") {
      animation = Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      });
      animation.start();
    } else {
      opacity.setValue(0);
      contentKeyRef.current = contentKey;
      animation = Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      });
      animation.start();
    }

    return () => animation?.stop();
  }, [active, phase, opacity]);

  useEffect(() => {
    if (active || phase !== "content" || fadingRef.current) return;
    if (contentKey == null || contentKey === contentKeyRef.current) return;

    fadingRef.current = true;
    setFrozenChildren(childrenRef.current);
    const out = Animated.timing(opacity, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    out.start(({ finished }) => {
      setFrozenChildren(null);
      if (!finished) {
        fadingRef.current = false;
        return;
      }
      contentKeyRef.current = contentKey;
      const fadeIn = Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      });
      fadeIn.start(() => {
        fadingRef.current = false;
      });
    });

    return () => {
      out.stop();
      fadingRef.current = false;
      setFrozenChildren(null);
    };
  }, [contentKey, active, phase, opacity]);

  return (
    <Animated.View style={[styles.pageTransition, style, { opacity }]}>
      {phase === "loader"
        ? loader ?? <ChessPieceLoader />
        : frozenChildren ?? children}
    </Animated.View>
  );
}

const INTRO_END = 0.3;
const MID_END = 0.9;
const INTRO_MS = 8640;
const MIDDLE_MS = 12000;
const FINISH_MS = 720;
const MIDDLE_STEP_MS = 500;
const MIDDLE_MIN_SPEED = 0.003;
const MIDDLE_MAX_SPEED = 0.018;
const MIDDLE_RUNNING_LIMIT = MID_END - 0.002;
const MIDDLE_FRONT_WEIGHT = 1.85;
const MIDDLE_BACK_WEIGHT = 0.45;
const RIBBON_WIDTH = 16;
const RIBBON_GAP = 16;
const RIBBON_PITCH = RIBBON_WIDTH + RIBBON_GAP;
const RIBBON_COUNT = 40;
const RIBBON_CYCLE_MS = 750;

function bufferProgress(
  selected: number,
  candidates: number,
  target: number
): number {
  const goal = Math.max(1, target);
  const selNorm = Math.min(1, Math.max(0, selected) / goal);
  const candNorm = Math.min(1, Math.max(0, candidates) / (goal * 2));
  return Math.min(1, selNorm * 0.3 + candNorm * 0.7);
}

function middlePaceWeight(fill: number): number {
  const span = MID_END - INTRO_END;
  if (span <= 0) return 1;
  const t = Math.max(0, Math.min(1, (fill - INTRO_END) / span));
  return t < 0.5 ? MIDDLE_FRONT_WEIGHT : MIDDLE_BACK_WEIGHT;
}

export function AnalysisLoadingBars({
  selected = 0,
  candidates = 0,
  target = 5,
  complete = false,
  progressRatio = null,
  onComplete,
}: {
  selected?: number;
  candidates?: number;
  target?: number;
  complete?: boolean;
  progressRatio?: number | null;
  onComplete?: () => void;
}) {
  const fill = useRef(new Animated.Value(0)).current;
  const ribbon = useRef(new Animated.Value(0)).current;
  const bufferRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  const [introDone, setIntroDone] = useState(false);
  const useLinearProgress = progressRatio != null;
  bufferRef.current = bufferProgress(selected, candidates, target);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(ribbon, {
        toValue: 1,
        duration: RIBBON_CYCLE_MS,
        easing: Easing.linear,
        isInteraction: false,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [ribbon]);

  useEffect(() => {
    const animation = Animated.timing(fill, {
      toValue: INTRO_END,
      duration: useLinearProgress ? Math.round(INTRO_MS * 0.35) : INTRO_MS,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished) setIntroDone(true);
    });
    return () => animation.stop();
  }, [fill, useLinearProgress]);

  useEffect(() => {
    if (!introDone || complete || !useLinearProgress) return;
    const ratio = Math.max(0, Math.min(1, Number(progressRatio) || 0));
    const targetFill =
      INTRO_END + (MIDDLE_RUNNING_LIMIT - INTRO_END) * ratio;
    let animation: Animated.CompositeAnimation | null = null;
    fill.stopAnimation((current) => {
      const from = Math.max(INTRO_END, Number(current) || 0);
      const to = Math.max(from, targetFill);
      if (to <= from + 0.0005) return;
      animation = Animated.timing(fill, {
        toValue: to,
        duration: MIDDLE_STEP_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      });
      animation.start();
    });
    return () => {
      animation?.stop();
    };
  }, [introDone, complete, fill, useLinearProgress, progressRatio]);

  useEffect(() => {
    if (!introDone || complete || useLinearProgress) return;
    let stopped = false;
    let animation: Animated.CompositeAnimation | null = null;

    const step = () => {
      if (stopped) return;
      fill.stopAnimation((current) => {
        if (stopped) return;
        const from = Math.max(INTRO_END, Number(current) || 0);
        const speed =
          (MIDDLE_MIN_SPEED +
            (MIDDLE_MAX_SPEED - MIDDLE_MIN_SPEED) * bufferRef.current) *
          middlePaceWeight(from);
        const distance = speed * (MIDDLE_STEP_MS / 1000);
        const to = Math.min(MIDDLE_RUNNING_LIMIT, from + distance);
        animation = Animated.timing(fill, {
          toValue: to,
          duration: MIDDLE_STEP_MS,
          easing: Easing.linear,
          useNativeDriver: false,
        });
        animation.start(({ finished }) => {
          if (finished && !stopped) step();
        });
      });
    };

    step();
    return () => {
      stopped = true;
      animation?.stop();
    };
  }, [introDone, complete, fill, useLinearProgress]);

  useEffect(() => {
    if (!introDone || !complete) return;
    let animation: Animated.CompositeAnimation | null = null;
    fill.stopAnimation((current) => {
      const from = Math.max(INTRO_END, Number(current) || 0);
      const middleDuration = Math.max(
        180,
        Math.round(
          ((MID_END - Math.min(from, MID_END)) / (MID_END - INTRO_END)) *
            MIDDLE_MS
        )
      );
      animation = Animated.sequence([
        Animated.timing(fill, {
          toValue: MID_END,
          duration: middleDuration,
          easing: Easing.bezier(0.2, 0.7, 0.25, 1),
          useNativeDriver: false,
        }),
        Animated.timing(fill, {
          toValue: 1,
          duration: FINISH_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }),
      ]);
      animation.start(({ finished }) => {
        if (finished) onCompleteRef.current?.();
      });
    });
    return () => {
      animation?.stop();
    };
  }, [introDone, complete, fill]);

  return (
    <View style={styles.loadingBarTrack}>
      <Animated.View
        style={[
          styles.loadingBarFill,
          {
            width: fill.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
            }),
          },
        ]}
      >
        <Animated.View
          style={[
            styles.loadingBarRibbonRow,
            {
              transform: [
                {
                  translateX: ribbon.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -RIBBON_PITCH],
                  }),
                },
              ],
            },
          ]}
        >
          {Array.from({ length: RIBBON_COUNT }).map((_, index) => (
            <View key={index} style={styles.loadingBarRibbon} />
          ))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    paddingBottom: 120,
  },
  bone: {
    backgroundColor: withAlpha(colors.textMuted, 0.3),
    borderRadius: radius.xs,
  },
  card: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  gridItem: {
    width: "48%",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  summaryText: {
    flex: 1,
  },
  choice: {
    width: "100%",
    paddingVertical: spacing.md,
  },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  pieceLoaderScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  pageTransition: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  pieceLoaderTrack: {
    width: 54,
    height: 54,
  },
  pieceLoaderOrbit: {
    width: "100%",
    height: "100%",
    alignItems: "center",
  },
  pieceLoaderPiece: {
    position: "absolute",
    top: -22,
    color: "#050505",
    fontSize: 44,
    lineHeight: 48,
    textShadowColor: withAlpha(colors.text, 0.8),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1,
  },
  loadingBarTrack: {
    width: "100%",
    height: 14,
    marginTop: spacing.md,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: withAlpha("#ffffff", 0.1),
  },
  loadingBarFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.textSoft,
    overflow: "hidden",
  },
  loadingBarRibbonRow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: -RIBBON_PITCH,
    flexDirection: "row",
    alignItems: "stretch",
  },
  loadingBarRibbon: {
    width: RIBBON_WIDTH,
    marginRight: RIBBON_GAP,
    backgroundColor: colors.bg,
    opacity: 0.18,
    transform: [{ skewX: "-28deg" }],
  },
  gapXs: {
    marginTop: spacing.xs,
  },
  gapSm: {
    marginTop: spacing.sm,
  },
  gapMd: {
    marginTop: spacing.md,
  },
  gapLg: {
    marginTop: spacing.lg,
  },
});
