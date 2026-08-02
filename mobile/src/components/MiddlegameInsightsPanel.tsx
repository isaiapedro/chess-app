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
import { EdgeCard, SectionLabel } from "./ui";
import { colors, font, result, spacing, withAlpha } from "../theme";

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
  group: "tactics" | "king" | "activity" | "pawns";
};

const METRICS: MetricDef[] = [
  {
    name: "Accuracy in Middlegame",
    key: "middlegame_accuracy_pct",
    unit: "%",
    group: "tactics",
    summary: "Move quality in the middlegame from eval win-probability swings.",
    detail:
      "Same Accuracy% formula as openings (103.1668 × exp(-0.04354 × Δwin%) − 3.1669), scored on your moves after the opening ends and before the endgame (≤7 non-pawn pieces). Mean across scored moves. Needs evaluations.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Blunder Rate",
    key: "middlegame_blunder_avg",
    unit: "/game",
    group: "tactics",
    summary: "Average blunders per middlegame.",
    detail:
      "A middlegame blunder is a move that drops your win probability by 0.2 or more. Reported as the mean blunder count per game that reached a middlegame.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 2 },
  },
  {
    name: "Missed Opportunities",
    key: "middlegame_missed_opportunity_pct",
    unit: "%",
    group: "tactics",
    summary: "Chances after an opponent blunder that you failed to convert.",
    detail:
      "When the opponent blunders in the middlegame (your win probability jumps by ≥0.2), the next move is an opportunity. It counts as missed if your reply drops win probability by ≥0.2 from the post-blunder position. Percentage of such chances you miss.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Missed Tactic",
    key: "middlegame_missed_tactic_pct",
    unit: "%",
    group: "tactics",
    summary: "Missed opportunities where a material win was available.",
    detail:
      "Same opportunity window as Missed Opportunities, but only when the best practical reply includes a material win (hanging or profitable capture). Percentage of those tactic chances you miss.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Allowed Tactics",
    key: "middlegame_allowed_tactic_pct",
    unit: "%",
    group: "tactics",
    summary: "How often opponents punish tactics you blunder into.",
    detail:
      "When you blunder in the middlegame and leave a material tactic for the opponent, we check whether their next move captures or further worsens your win probability. Reported as the percentage of such positions where the opponent finds it.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Attackers in King Zone",
    key: "middlegame_king_attackers_score",
    unit: "",
    group: "king",
    summary: "Pressure on squares next to your king.",
    detail:
      "On each middlegame position we sum opponent piece values attacking the eight squares adjacent to your king, then square that weight so stacked attacks overweight. Averaged across middlegame positions.",
    format: (v) => v.toFixed(1),
    scale: { kind: "benchmark", fallback: 40 },
  },
  {
    name: "Pawn Shield Integrity",
    key: "middlegame_pawn_shield_pct",
    unit: "%",
    group: "king",
    summary: "Health of the three pawns in front of a castled king.",
    detail:
      "For a castled king on the back rank we score f/g/h or a/b/c pawns: missing pawns and advanced pawns lower the score. Uncastled or central-king positions are skipped. Averaged across scored middlegame positions.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Open File Proximity",
    key: "middlegame_open_file_proximity_pct",
    unit: "%",
    group: "king",
    summary: "How exposed your king is to open or semi-open files.",
    detail:
      "Higher when your king sits on an open/semi-open file, beside one, or when the castled-side rook file is open/semi-open. Averaged across middlegame positions.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Safe Legal Moves",
    key: "middlegame_safe_moves_pct",
    unit: "%",
    group: "activity",
    summary: "Share of your legal moves landing off enemy pawn attacks.",
    detail:
      "On your middlegame turns, the percentage of legal destination squares not attacked by an enemy pawn. Averaged across those positions.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Outpost Control",
    key: "middlegame_outpost_control_avg",
    unit: "",
    group: "activity",
    summary: "Your minors sitting on classic outposts.",
    detail:
      "Count of your knights/bishops on ranks 4–6 (3–5 for Black) defended by a friendly pawn and safe from enemy pawn attack. Mean per middlegame position, then averaged across games.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 1 },
  },
  {
    name: "Space Advantage",
    key: "middlegame_space_advantage_pct",
    unit: "%",
    group: "activity",
    summary: "Safe space on the central four files.",
    detail:
      "Among c2–f5 (mirrored for Black), the share of squares not attacked by enemy pawns. Averaged across middlegame positions.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Isolated Queen Pawn",
    key: "middlegame_iqp_win_rate_pct",
    unit: "%",
    group: "pawns",
    summary: "Win rate in middlegames where you had an IQP.",
    detail:
      "Classic isolated queen pawn: a d-pawn with no friendly pawns on the c- or e-files at some point in the middlegame. Win rate among those games.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Doubled Pawns",
    key: "middlegame_doubled_pawns_game_pct",
    unit: "%",
    group: "pawns",
    summary: "Games with doubled pawns in the middlegame.",
    detail:
      "Percentage of middlegame games where you had two or more pawns on the same file at some sampled position.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Backward Pawns",
    key: "middlegame_backward_pawns_game_pct",
    unit: "%",
    group: "pawns",
    summary: "Games with a backward pawn in the middlegame.",
    detail:
      "A pawn behind all friendly pawns on adjacent files whose forward square is attacked by an enemy pawn. Percentage of middlegame games with at least one such pawn.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Pawn Islands",
    key: "middlegame_pawn_islands_avg",
    unit: "",
    group: "pawns",
    summary: "Average number of pawn islands.",
    detail:
      "Connected groups of your pawns separated by open files. Averaged across middlegame positions, then across games.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 3 },
  },
];

const METRIC_KEYS = METRICS.map((m) => m.key);

export function countMiddlegameCatalogBanners(middlegamePhase: {
  aggregate: Record<string, number | null> | null;
} | null): number {
  if (!middlegamePhase?.aggregate) return 0;
  let n = 0;
  for (const key of METRIC_KEYS) {
    const raw = middlegamePhase.aggregate[key];
    if (raw != null && Number.isFinite(raw)) n += 1;
  }
  return n;
}

function projectBenchmarkMax(
  hit: BaselineMetricHit | null,
  fallback: number
): number {
  const parts = [fallback];
  if (hit?.mean != null && Number.isFinite(hit.mean) && Math.abs(hit.mean) > 0) {
    parts.push(Math.abs(hit.mean) * 1.6);
  }
  if (hit?.p90 != null && Number.isFinite(hit.p90) && Math.abs(hit.p90) > 0) {
    parts.push(Math.abs(hit.p90) * 1.25);
  } else if (hit?.p75 != null && Number.isFinite(hit.p75) && Math.abs(hit.p75) > 0) {
    parts.push(Math.abs(hit.p75) * 1.45);
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
  const fillPct = Math.max(0, (Math.abs(value) / scaleMax) * 100);
  const peerPct =
    peerMean != null && Number.isFinite(peerMean)
      ? Math.max(0, (Math.abs(peerMean) / scaleMax) * 100)
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
              <Text style={styles.helpClose}>✕</Text>
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
            <Text style={styles.helpButtonText}>?</Text>
          </Pressable>
        ) : null}
      </View>
    </EdgeCard>
  );
}

export function MiddlegameInsightsPanel() {
  const { speed } = useFilters();
  const {
    games,
    gamesLoading,
    middlegamePhase,
    middlegamePhaseLoading,
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
  const agg = middlegamePhase?.aggregate ?? null;
  const profileReady = !!agg && !middlegamePhaseLoading;

  const values = useMemo(() => {
    if (!agg) return {} as Record<string, number | null>;
    return {
      middlegame_accuracy_pct: agg.middlegame_accuracy_pct,
      middlegame_blunder_avg: agg.middlegame_blunder_avg,
      middlegame_missed_opportunity_pct: agg.middlegame_missed_opportunity_pct,
      middlegame_missed_tactic_pct: agg.middlegame_missed_tactic_pct,
      middlegame_allowed_tactic_pct: agg.middlegame_allowed_tactic_pct,
      middlegame_king_attackers_score: agg.middlegame_king_attackers_score,
      middlegame_pawn_shield_pct: agg.middlegame_pawn_shield_pct,
      middlegame_open_file_proximity_pct: agg.middlegame_open_file_proximity_pct,
      middlegame_safe_moves_pct: agg.middlegame_safe_moves_pct,
      middlegame_outpost_control_avg: agg.middlegame_outpost_control_avg,
      middlegame_space_advantage_pct: agg.middlegame_space_advantage_pct,
      middlegame_iqp_win_rate_pct: agg.middlegame_iqp_win_rate_pct,
      middlegame_doubled_pawns_game_pct: agg.middlegame_doubled_pawns_game_pct,
      middlegame_backward_pawns_game_pct: agg.middlegame_backward_pawns_game_pct,
      middlegame_pawn_islands_avg: agg.middlegame_pawn_islands_avg,
    };
  }, [agg]);

  const cardsByGroup = useMemo(() => {
    const groups: Record<MetricDef["group"], Array<MetricDef & { value: string; userNum: number }>> = {
      tactics: [],
      king: [],
      activity: [],
      pawns: [],
    };
    for (const def of METRICS) {
      const raw = values[def.key];
      if (raw == null || !Number.isFinite(raw)) continue;
      groups[def.group].push({
        ...def,
        value: def.format(raw),
        userNum: raw,
      });
    }
    return groups;
  }, [values]);

  if (!agg && (gamesLoading || middlegamePhaseLoading)) {
    return <Text style={styles.hint}>Loading middlegame metrics…</Text>;
  }
  if (!gamesLoading && games.length <= 0 && !agg) {
    return <Text style={styles.hint}>No games in this filter set.</Text>;
  }

  const sections: Array<[string, MetricDef["group"]]> = [
    ["Tactics", "tactics"],
    ["King Safety", "king"],
    ["Piece Activity & Mobility", "activity"],
    ["Pawn Structure", "pawns"],
  ];

  return (
    <View>
      <HelpModal
        content={helpContent}
        onClose={() => setHelpContent(null)}
      />
      {!profileReady ? (
        <Text style={styles.hint}>Computing middlegame metrics…</Text>
      ) : null}
      {sections.map(([title, group]) => {
        const cards = cardsByGroup[group];
        if (!cards.length) return null;
        return (
          <View key={group} style={styles.section}>
            <SectionLabel>{title}</SectionLabel>
            {cards.map((card) => (
              <MetricBanner
                key={card.key}
                name={card.name}
                value={card.value}
                unit={card.unit}
                userNum={card.userNum}
                baselineKey={card.key}
                scale={card.scale}
                baselines={baselines}
                peerBand={peerBand}
                peerSpeed={peerSpeed}
                onHelp={() =>
                  setHelpContent({
                    title: card.name,
                    summary: card.summary,
                    detail: card.detail,
                  })
                }
              />
            ))}
          </View>
        );
      })}
      {profileReady &&
      !cardsByGroup.tactics.length &&
      !cardsByGroup.king.length &&
      !cardsByGroup.activity.length &&
      !cardsByGroup.pawns.length ? (
        <Text style={styles.hint}>
          No middlegame positions in this filter set.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.md },
  card: { marginBottom: spacing.sm },
  cardRow: { flexDirection: "row", alignItems: "flex-start" },
  cardBody: { flex: 1 },
  name: {
    color: colors.cream,
    fontFamily: font.sans,
    fontSize: 14,
    marginBottom: 4,
  },
  value: {
    color: colors.cream,
    fontFamily: font.display,
    fontSize: 28,
  },
  unit: {
    color: withAlpha(colors.cream, 0.55),
    fontFamily: font.sans,
    fontSize: 14,
  },
  caption: {
    color: withAlpha(colors.cream, 0.55),
    fontFamily: font.sans,
    fontSize: 11,
    marginTop: 4,
    marginBottom: 6,
  },
  bulletWrap: { marginTop: 8 },
  bulletTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: withAlpha(colors.cream, 0.12),
    overflow: "hidden",
    position: "relative",
  },
  bulletFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: result.win,
  },
  bulletPeer: {
    position: "absolute",
    top: -2,
    width: 2,
    height: 12,
    marginLeft: -1,
    backgroundColor: colors.cream,
  },
  helpButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: withAlpha(colors.cream, 0.25),
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
  },
  helpButtonText: {
    color: colors.cream,
    fontFamily: font.sans,
    fontSize: 14,
  },
  helpBackdrop: {
    flex: 1,
    backgroundColor: withAlpha("#000", 0.55),
    justifyContent: "center",
    padding: spacing.lg,
  },
  helpCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.cream, 0.18),
    padding: spacing.md,
    maxHeight: "70%",
  },
  helpHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  helpTitle: {
    color: colors.cream,
    fontFamily: font.display,
    fontSize: 20,
    flex: 1,
    paddingRight: spacing.sm,
  },
  helpClose: { color: colors.cream, fontSize: 18 },
  helpScroll: { maxHeight: 360 },
  helpSummary: {
    color: colors.cream,
    fontFamily: font.sans,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  helpDetailLabel: {
    color: withAlpha(colors.cream, 0.55),
    fontFamily: font.sans,
    fontSize: 12,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  helpDetail: {
    color: withAlpha(colors.cream, 0.85),
    fontFamily: font.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  hint: {
    color: withAlpha(colors.cream, 0.6),
    fontFamily: font.sans,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
});
