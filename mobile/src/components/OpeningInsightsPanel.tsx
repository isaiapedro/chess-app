import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAnalytics } from "../context/AnalyticsContext";
import { useFilters } from "../context/FilterContext";
import {
  lookupBaseline,
  normalizeSpeed,
  peerCaption,
  ratingBand,
  type BaselineMetricHit,
  type BaselineStore,
} from "../data/baselines";
import type { OpeningSideCard } from "../engine/openingPhase";
import { Ionicons } from "@expo/vector-icons";
import { EdgeCard, SectionLabel } from "./ui";
import { colors, radius, result, spacing, type, withAlpha } from "../theme";

type MetricScale =
  | { kind: "fixed"; max: number }
  | { kind: "benchmark"; fallback: number };

type MetricDef = {
  name: string;
  key: string;
  unit: string;
  summary: string;
  detail: string;
  format: (v: number) => string;
  scale: MetricScale;
};

const GENERAL_METRICS: MetricDef[] = [
  {
    name: "Opening Accuracy",
    key: "opening_accuracy_pct",
    unit: "%",
    summary: "Move quality in the opening from eval win-probability swings.",
    detail:
      "For each of your moves in the opening phase we convert engine evals to win probability before and after the move, then score Accuracy% = 103.1668 × exp(-0.04354 × (win%Before − win%After)) − 3.1669 (clamped 0–100). The reported value is the mean across scored moves. Needs games with evaluations.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Development Speed",
    key: "opening_minors_developed_by_10",
    unit: "",
    summary: "Knights and bishops that left home by move 10 (0–4).",
    detail:
      "Tracks your four minor starting squares (b1/g1/c1/f1 or b8/g8/c8/f8). A piece counts once it leaves its home square, even if it is later traded off the board. Snapshot after fullmove 10. Maximum is 4.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 4 },
  },
  {
    name: "Center Control",
    key: "opening_center_control_pct",
    unit: "%",
    summary: "Share of d4/e4/d5/e5 you occupy or attack.",
    detail:
      "Each opening position scores the four central squares independently. A square counts only if you occupy it, or it is empty and you attack it (attacking an enemy piece on a center square does not count). Controlling all four = 100%, two = 50%. Reported value is the mean of those per-position percentages across the opening phase.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "King Safety",
    key: "opening_castle_fullmove",
    unit: "",
    summary: "Average fullmove when you castled (castled games only).",
    detail:
      "Absolute castling fullmove with no cap. Games where you never castled are excluded from this mean. Lower usually means you tucked the king away earlier.",
    format: (v) => v.toFixed(1),
    scale: { kind: "benchmark", fallback: 12 },
  },
  {
    name: "Uncastled Games",
    key: "opening_uncastled_rate_pct",
    unit: "%",
    summary: "Share of games where you never castled.",
    detail:
      "Percentage of analyzed games with no castling move by you. Complements King Safety, which only averages castled games.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Tempo Balance",
    key: "opening_tempo_waste_rate_pct",
    unit: "%",
    summary: "Share of non-pawn opening moves (incl. castle) that re-move a piece before development finishes.",
    detail:
      "Counts every non-pawn move you make in the opening phase (minors, majors, king moves, and castling all count as tempo moves), up through the phase end (castling move when you castle, otherwise the opening cutoff). A re-move is leaving a square that piece already moved from while fewer than 4 of your minors have ever left home. TempoWaste% = re-moves ÷ all those non-pawn opening moves × 100. Lower means cleaner development.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Pawn Moves",
    key: "opening_pawn_moves_avg",
    unit: "/game",
    summary: "Average pawn moves you made during the opening phase.",
    detail:
      "Counts every pawn move you make while still in the opening (through castling fullmove if you castle, otherwise the opening cutoff). Averaged across games.",
    format: (v) => v.toFixed(1),
    scale: { kind: "benchmark", fallback: 6 },
  },
];

const OPENING_CARD_METRICS: Array<{
  name: string;
  key: keyof OpeningSideCard;
  unit: string;
  scale: MetricScale;
  baselineKey: string;
}> = [
  {
    name: "Win Rate",
    key: "win_rate",
    unit: "%",
    scale: { kind: "fixed", max: 100 },
    baselineKey: "win_rate",
  },
  {
    name: "Opening Accuracy",
    key: "opening_accuracy_pct",
    unit: "%",
    scale: { kind: "fixed", max: 100 },
    baselineKey: "opening_accuracy_pct",
  },
  {
    name: "Development Speed",
    key: "opening_minors_developed_by_10",
    unit: "",
    scale: { kind: "fixed", max: 4 },
    baselineKey: "opening_minors_developed_by_10",
  },
  {
    name: "Center Control",
    key: "opening_center_control_pct",
    unit: "%",
    scale: { kind: "fixed", max: 100 },
    baselineKey: "opening_center_control_pct",
  },
  {
    name: "King Safety",
    key: "opening_castle_fullmove",
    unit: "",
    scale: { kind: "benchmark", fallback: 12 },
    baselineKey: "opening_castle_fullmove",
  },
  {
    name: "Uncastled Games",
    key: "opening_uncastled_rate_pct",
    unit: "%",
    scale: { kind: "fixed", max: 100 },
    baselineKey: "opening_uncastled_rate_pct",
  },
  {
    name: "Tempo Balance",
    key: "opening_tempo_waste_rate_pct",
    unit: "%",
    scale: { kind: "fixed", max: 100 },
    baselineKey: "opening_tempo_waste_rate_pct",
  },
];

export const OPENING_FAMILY_METRIC_COUNT = OPENING_CARD_METRICS.length;

const GENERAL_METRIC_KEYS = [
  "opening_accuracy_pct",
  "opening_minors_developed_by_10",
  "opening_center_control_pct",
  "opening_castle_fullmove",
  "opening_uncastled_rate_pct",
  "opening_tempo_waste_rate_pct",
  "opening_pawn_moves_avg",
] as const;

export function countOpeningCatalogBanners(openingPhase: {
  aggregate: {
    opening_accuracy_pct: number | null;
    opening_minors_developed_by_10: number | null;
    opening_center_control_pct: number | null;
    opening_castle_fullmove: number | null;
    opening_uncastled_rate_pct: number | null;
    opening_tempo_waste_rate_pct: number | null;
    opening_pawn_moves_avg: number | null;
  } | null;
  sides: { white: unknown[]; black: unknown[] };
} | null): number {
  if (!openingPhase) return 0;
  const agg = openingPhase.aggregate;
  let general = 0;
  if (agg) {
    for (const key of GENERAL_METRIC_KEYS) {
      const raw = agg[key];
      if (raw != null && Number.isFinite(raw)) general += 1;
    }
  }
  const families =
    openingPhase.sides.white.length + openingPhase.sides.black.length;
  return general + families * OPENING_FAMILY_METRIC_COUNT;
}

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function projectBenchmarkMax(
  hit: BaselineMetricHit | null,
  fallback: number
): number {
  const parts = [fallback];
  if (hit?.mean != null && Number.isFinite(hit.mean) && hit.mean > 0) {
    parts.push(hit.mean * 1.6);
  }
  if (hit?.p90 != null && Number.isFinite(hit.p90) && hit.p90 > 0) {
    parts.push(hit.p90 * 1.25);
  } else if (hit?.p75 != null && Number.isFinite(hit.p75) && hit.p75 > 0) {
    parts.push(hit.p75 * 1.45);
  }
  return Math.max(...parts);
}

function resolveScaleMax(
  scale: MetricScale,
  hit: BaselineMetricHit | null
): number {
  if (scale.kind === "fixed") return scale.max;
  return projectBenchmarkMax(hit, scale.fallback);
}

function MetricBulletGraph({
  value,
  peerMean,
  scaleMax,
}: {
  value: number | null | undefined;
  peerMean: number | null | undefined;
  scaleMax: number;
}) {
  if (value == null || !Number.isFinite(value) || !(scaleMax > 0)) return null;
  const fillPct = Math.max(0, (value / scaleMax) * 100);
  const peerPct =
    peerMean != null && Number.isFinite(peerMean)
      ? Math.max(0, (peerMean / scaleMax) * 100)
      : null;
  return (
    <View style={styles.bulletWrap}>
      <View style={styles.bulletTrack}>
        <View
          style={[
            styles.bulletFill,
            { width: `${Math.min(fillPct, 100)}%` },
          ]}
        />
        {fillPct > 100 ? <View style={styles.bulletOverflow} /> : null}
        {peerPct != null ? (
          <View
            style={[
              styles.bulletPeer,
              { left: `${Math.min(peerPct, 100)}%` },
            ]}
          />
        ) : null}
      </View>
    </View>
  );
}

function HelpModal({
  content,
  onClose,
}: {
  content: { title: string; summary: string; detail: string } | null;
  onClose: () => void;
}) {
  if (!content) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.helpBackdrop} onPress={onClose}>
        <Pressable style={styles.helpCard} onPress={() => {}}>
          <View style={styles.helpHeader}>
            <Text style={styles.helpTitle}>{content.title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.helpScroll}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.helpSummary}>{content.summary}</Text>
            <Text style={styles.helpDetailLabel}>How we measure it</Text>
            <Text style={styles.helpDetail}>{content.detail}</Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MetricBanner({
  name,
  value,
  unit,
  userNum,
  baselineKey,
  scale,
  baselines,
  peerBand,
  peerSpeed,
  onHelp,
}: {
  name: string;
  value: string;
  unit: string;
  userNum: number | null;
  baselineKey: string;
  scale: MetricScale;
  baselines: BaselineStore | null;
  peerBand: string | null;
  peerSpeed: string | null;
  onHelp?: () => void;
}) {
  const hit =
    baselineKey && peerBand && peerSpeed
      ? lookupBaseline(baselines, baselineKey, peerBand, peerSpeed)
      : null;
  const scaleMax = resolveScaleMax(scale, hit);
  const caption = peerCaption(
    baselines,
    baselineKey,
    peerBand,
    peerSpeed,
    userNum,
    unit
  );
  return (
    <EdgeCard style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardBody}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.value}>
            {value}
            {unit ? <Text style={styles.unit}> {unit}</Text> : null}
          </Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
          <MetricBulletGraph
            value={userNum}
            peerMean={hit?.mean}
            scaleMax={scaleMax}
          />
        </View>
        {onHelp ? (
          <Pressable
            onPress={onHelp}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`About ${name}`}
            style={styles.helpButton}
          >
            <Ionicons
                      name="information-circle-outline"
                      size={20}
                      color={colors.textDim}
                    />
          </Pressable>
        ) : null}
      </View>
    </EdgeCard>
  );
}

function OpeningFamilyBlock({
  card,
  baselines,
  peerBand,
  peerSpeed,
}: {
  card: OpeningSideCard;
  baselines: BaselineStore | null;
  peerBand: string | null;
  peerSpeed: string | null;
}) {
  return (
    <View style={styles.familyBlock}>
      <View style={styles.familyHeader}>
        <Text style={styles.familyName}>{card.opening_name}</Text>
        <Text style={styles.familyMeta}>
          {card.eco_label || card.opening_eco} · {card.games} games
        </Text>
      </View>
      {OPENING_CARD_METRICS.map((def) => {
        const raw = card[def.key];
        const num =
          typeof raw === "number" && Number.isFinite(raw) ? raw : null;
        return (
          <MetricBanner
            key={`${card.opening_name}-${def.key}`}
            name={def.name}
            value={fmt(num)}
            unit={def.unit}
            userNum={num}
            baselineKey={def.baselineKey}
            scale={def.scale}
            baselines={baselines}
            peerBand={peerBand}
            peerSpeed={peerSpeed}
          />
        );
      })}
    </View>
  );
}

export function OpeningInsightsPanel() {
  const { speed } = useFilters();
  const {
    games,
    gamesLoading,
    openingPhase,
    openingPhaseLoading,
    baselines,
  } = useAnalytics();
  const [helpContent, setHelpContent] = useState<{
    title: string;
    summary: string;
    detail: string;
  } | null>(null);

  const peerBand = useMemo(() => {
    const ratings = games
      .map((g) => Number(g.user_rating))
      .filter((n) => Number.isFinite(n));
    if (!ratings.length) return null;
    const mid = [...ratings].sort((a, b) => a - b)[
      Math.floor(ratings.length / 2)
    ];
    return ratingBand(mid);
  }, [games]);

  const inferredSpeed = useMemo(() => {
    const speedCounts = new Map<string, number>();
    for (const g of games) {
      const s = String(g.speed || "").toLowerCase();
      if (!s) continue;
      speedCounts.set(s, (speedCounts.get(s) || 0) + 1);
    }
    return (
      [...speedCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    );
  }, [games]);

  const peerSpeed = normalizeSpeed(speed) || normalizeSpeed(inferredSpeed);
  const agg = openingPhase?.aggregate ?? null;
  const sides = openingPhase?.sides ?? { white: [], black: [] };
  const profileReady = !!agg && !openingPhaseLoading;

  const generalCards = useMemo(() => {
    if (!agg) return [];
    const values: Record<string, number | null> = {
      opening_accuracy_pct: agg.opening_accuracy_pct,
      opening_minors_developed_by_10: agg.opening_minors_developed_by_10,
      opening_center_control_pct: agg.opening_center_control_pct,
      opening_castle_fullmove: agg.opening_castle_fullmove,
      opening_uncastled_rate_pct: agg.opening_uncastled_rate_pct,
      opening_tempo_waste_rate_pct: agg.opening_tempo_waste_rate_pct,
      opening_pawn_moves_avg: agg.opening_pawn_moves_avg,
    };
    return GENERAL_METRICS.map((def) => {
      const raw = values[def.key];
      const userNum =
        raw == null || !Number.isFinite(raw) ? null : Number(raw);
      return {
        ...def,
        value: userNum == null ? "—" : def.format(userNum),
        userNum,
      };
    }).filter((m) => m.userNum != null);
  }, [agg]);

  if ((gamesLoading || openingPhaseLoading) && !agg) {
    return <Text style={styles.hint}>Loading opening metrics…</Text>;
  }
  if (!gamesLoading && games.length <= 0 && !agg) {
    return <Text style={styles.hint}>No games in this filter set.</Text>;
  }

  return (
    <View>
      <HelpModal
        content={helpContent}
        onClose={() => setHelpContent(null)}
      />

      {generalCards.length ? (
        <View style={styles.section}>
          <SectionLabel>General</SectionLabel>
          {generalCards.map((metric) => (
            <MetricBanner
              key={metric.key}
              name={metric.name}
              value={metric.value}
              unit={metric.unit}
              userNum={metric.userNum}
              baselineKey={metric.key}
              scale={metric.scale}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
              onHelp={() =>
                setHelpContent({
                  title: metric.name,
                  summary: metric.summary,
                  detail: metric.detail,
                })
              }
            />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <SectionLabel>As White</SectionLabel>
        {sides.white.length ? (
          sides.white.map((card) => (
            <OpeningFamilyBlock
              key={`w-${card.opening_name}-${card.eco_label}`}
              card={card}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
            />
          ))
        ) : profileReady ? (
          <Text style={styles.hint}>
            Need at least 3 games in an opening family as White.
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionLabel>As Black</SectionLabel>
        {sides.black.length ? (
          sides.black.map((card) => (
            <OpeningFamilyBlock
              key={`b-${card.opening_name}-${card.eco_label}`}
              card={card}
              baselines={baselines}
              peerBand={peerBand}
              peerSpeed={peerSpeed}
            />
          ))
        ) : profileReady ? (
          <Text style={styles.hint}>
            Need at least 3 games in an opening family as Black.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    ...type.bodySmall,
    color: colors.textDim,
    marginBottom: spacing.md,
  },
  section: { marginBottom: spacing.xl },
  familyBlock: {
    marginBottom: spacing.lg,
  },
  familyHeader: {
    marginBottom: spacing.sm,
  },
  familyName: {
    ...type.heading,
    color: colors.text,
    marginBottom: 2,
  },
  familyMeta: {
    ...type.caption,
    color: colors.textDim,
    marginBottom: spacing.sm,
  },
  card: { marginBottom: spacing.sm },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardBody: {
    flex: 1,
    flexShrink: 1,
  },
  name: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: 4,
  },
  helpButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    ...type.numberSm,
    color: colors.text,
    marginBottom: 2,
  },
  unit: {
    ...type.caption,
    color: colors.textMuted,
  },
  caption: {
    ...type.caption,
    color: colors.textDim,
    marginBottom: 4,
  },
  bulletWrap: {
    marginTop: 10,
    paddingVertical: 4,
  },
  bulletTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: withAlpha("#ffffff", 0.08),
    position: "relative",
    justifyContent: "center",
  },
  bulletFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.pill,
    backgroundColor: result.win,
  },
  stackWin: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.pill,
    backgroundColor: result.win,
  },
  stackDraw: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: result.draw,
  },
  bulletOverflow: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
  },
  bulletPeer: {
    position: "absolute",
    top: -3,
    bottom: -3,
    width: 2,
    marginLeft: -1,
    borderRadius: radius.pill,
    backgroundColor: colors.rim,
  },
  helpBackdrop: {
    flex: 1,
    backgroundColor: withAlpha("#000000", 0.68),
    justifyContent: "flex-end",
  },
  helpCard: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: "78%",
  },
  helpHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  helpTitle: {
    ...type.title,
    color: colors.text,
    flex: 1,
  },
  helpScroll: { flexGrow: 0, maxHeight: 420 },
  helpSummary: {
    ...type.body,
    color: colors.textSoft,
    marginBottom: spacing.lg,
  },
  helpDetailLabel: {
    ...type.label,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  helpDetail: {
    ...type.bodySmall,
    color: colors.textDim,
    lineHeight: 20,
  },
});
