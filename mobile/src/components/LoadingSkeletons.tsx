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
import type { Period } from "../api/types";
import { colors, radius, spacing, withAlpha } from "../theme";

export const PAGE_FADE_WAIT_MS = 3000;
export const PAGE_LONG_LOADER_MIN_MS = 4000;

export type PageLongLoaderKind = "pawn" | "skeleton";

export function longLoaderKindForPeriod(period: Period): PageLongLoaderKind {
  return period === "year" || period === "all" ? "skeleton" : "pawn";
}

export function useSmartPageLoad({
  loadKey,
  contentReady,
}: {
  loadKey: string;
  contentReady: boolean;
}): {
  showLongLoader: boolean;
  revealContent: boolean;
} {
  const [phase, setPhase] = useState<"blank" | "loader" | "done">(
    contentReady ? "done" : "blank"
  );
  const [loaderMinDone, setLoaderMinDone] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    setLoaderMinDone(false);
    if (contentReady) {
      setPhase("done");
      return;
    }
    setPhase("blank");
    const t = setTimeout(() => {
      if (phaseRef.current === "done") return;
      setPhase("loader");
    }, PAGE_FADE_WAIT_MS);
    return () => clearTimeout(t);
  }, [loadKey]);

  useEffect(() => {
    if (!contentReady) return;
    if (phaseRef.current === "loader") return;
    setPhase("done");
  }, [contentReady]);

  useEffect(() => {
    if (phase !== "loader") return;
    setLoaderMinDone(false);
    const t = setTimeout(() => setLoaderMinDone(true), PAGE_LONG_LOADER_MIN_MS);
    return () => clearTimeout(t);
  }, [phase, loadKey]);

  useEffect(() => {
    if (phase !== "loader") return;
    if (contentReady && loaderMinDone) setPhase("done");
  }, [phase, contentReady, loaderMinDone]);

  return {
    showLongLoader: phase === "loader",
    revealContent: phase === "done" && contentReady,
  };
}

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
  return <ChessPieceLoader fullscreen />;
}

const TAB_BAR_BODY = 58;

export function ChessPieceLoader({
  fullscreen = false,
}: {
  fullscreen?: boolean;
}) {
  const rotation = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const tabClearance = fullscreen
    ? 0
    : TAB_BAR_BODY + Math.max(insets.bottom, 12);

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
          tabClearance
            ? {
                marginTop: -tabClearance / 2,
              }
            : null,
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

export function FadeFromBlank({
  contentKey,
  ready = true,
  children,
  style,
  fadeInMs = 240,
}: {
  contentKey: string | number | null;
  ready?: boolean;
  children: React.ReactNode;
  style?: ViewStyle;
  fadeInMs?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [paintKey, setPaintKey] = useState<string | number | null>(null);
  const genRef = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const gen = ++genRef.current;
    animRef.current?.stop();
    opacity.setValue(0);
    setPaintKey(null);

    if (!ready || contentKey == null) return;

    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      if (genRef.current !== gen) return;
      setPaintKey(contentKey);
      frame2 = requestAnimationFrame(() => {
        if (genRef.current !== gen) return;
        animRef.current = Animated.timing(opacity, {
          toValue: 1,
          duration: fadeInMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        });
        animRef.current.start();
      });
    });

    return () => {
      cancelAnimationFrame(frame1);
      if (frame2) cancelAnimationFrame(frame2);
      animRef.current?.stop();
    };
  }, [contentKey, ready, fadeInMs, opacity]);

  return (
    <Animated.View
      style={[styles.pageTransition, style, { opacity }]}
      pointerEvents={ready && paintKey != null ? "auto" : "none"}
    >
      {paintKey != null && ready ? children : null}
    </Animated.View>
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
  const showLoader = active && loader != null;
  const ready = showLoader || !active;
  const key = showLoader
    ? `loader:${contentKey ?? "x"}`
    : contentKey == null
      ? "content"
      : contentKey;

  return (
    <FadeFromBlank contentKey={key} ready={ready} style={style}>
      {showLoader ? loader : children}
    </FadeFromBlank>
  );
}

export function AnalyticsPageShell({
  loadKey,
  contentReady,
  period,
  error,
  errorNode,
  skeleton,
  children,
}: {
  loadKey: string;
  contentReady: boolean;
  period: Period;
  error?: boolean;
  errorNode?: React.ReactNode;
  skeleton: React.ReactNode;
  children: React.ReactNode;
}) {
  const { showLongLoader, revealContent } = useSmartPageLoad({
    loadKey,
    contentReady: contentReady && !error,
  });
  const kind = longLoaderKindForPeriod(period);
  const waiting = !revealContent && !error;
  const loader =
    showLongLoader
      ? kind === "pawn"
        ? <ChessPieceLoader />
        : skeleton
      : undefined;

  const contentKey = error
    ? `error:${loadKey}`
    : revealContent
      ? `ready:${loadKey}`
      : showLongLoader
        ? `loader:${kind}:${loadKey}`
        : `wait:${loadKey}`;

  return (
    <PageLoadingTransition
      active={waiting}
      contentKey={contentKey}
      loader={loader}
    >
      {error ? errorNode : revealContent ? children : null}
    </PageLoadingTransition>
  );
}

const INTRO_END = 0.3;
const MID_END = 0.9;
const INTRO_MS = 8640;
const MIDDLE_MS = 4200;
const FINISH_MS = 720;
const MIDDLE_MIN_SPEED = 0.055;
const MIDDLE_MAX_SPEED = 0.085;
const MIDDLE_RUNNING_LIMIT = MID_END - 0.002;
const MIDDLE_BUFFER_SMOOTH = 2.2;
const MIDDLE_START_BOOST = 1.85;
const MIDDLE_END_BOOST = 0.8;
const MIDDLE_SEED_BUFFER = 0.55;
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
  const span = MIDDLE_RUNNING_LIMIT - INTRO_END;
  if (span <= 0) return MIDDLE_START_BOOST;
  const t = Math.max(0, Math.min(1, (fill - INTRO_END) / span));
  const eased = t * t;
  return (
    MIDDLE_START_BOOST + (MIDDLE_END_BOOST - MIDDLE_START_BOOST) * eased
  );
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
  const bufferSmoothRef = useRef(0);
  const fillCursorRef = useRef(0);
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
      if (finished) {
        fillCursorRef.current = INTRO_END;
        setIntroDone(true);
      }
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
        duration: 500,
        easing: Easing.linear,
        useNativeDriver: false,
      });
      animation.start(({ finished }) => {
        if (finished) fillCursorRef.current = to;
      });
    });
    return () => {
      animation?.stop();
    };
  }, [introDone, complete, fill, useLinearProgress, progressRatio]);

  useEffect(() => {
    if (!introDone || complete || useLinearProgress) return;
    let stopped = false;
    let raf = 0;
    let lastTs = 0;
    bufferSmoothRef.current = Math.max(bufferRef.current, MIDDLE_SEED_BUFFER);
    fill.stopAnimation((current) => {
      fillCursorRef.current = Math.max(INTRO_END, Number(current) || INTRO_END);
    });

    const tick = (ts: number) => {
      if (stopped) return;
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
      lastTs = ts;

      const targetBuffer = Math.max(bufferRef.current, MIDDLE_SEED_BUFFER * 0.35);
      const smooth = bufferSmoothRef.current;
      bufferSmoothRef.current =
        smooth + (targetBuffer - smooth) * Math.min(1, dt * MIDDLE_BUFFER_SMOOTH);

      const speed =
        (MIDDLE_MIN_SPEED +
          (MIDDLE_MAX_SPEED - MIDDLE_MIN_SPEED) * bufferSmoothRef.current) *
        middlePaceWeight(fillCursorRef.current);
      const next = Math.min(
        MIDDLE_RUNNING_LIMIT,
        fillCursorRef.current + speed * dt
      );
      fillCursorRef.current = next;
      fill.setValue(next);

      if (next < MIDDLE_RUNNING_LIMIT) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
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
