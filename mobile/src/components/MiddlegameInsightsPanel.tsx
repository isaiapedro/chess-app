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
      "Same Accuracy% formula as openings (103.1668 × exp(-0.04354 × Δwin%) − 3.1669), scored on your moves after the opening ends (min fullmove 11, or your castle fullmove if later) and before the endgame (≤7 non-pawn pieces). Mean across scored moves. Needs evaluations.",
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
      "A middlegame blunder is a move that drops win probability by more than 15pp. Mean count per game that reached a middlegame.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 2 },
  },
  {
    name: "Mistake Rate",
    key: "middlegame_mistake_avg",
    unit: "/game",
    group: "tactics",
    summary: "Average mistakes per middlegame.",
    detail:
      "A middlegame mistake drops win probability by 10–15pp (inclusive). Not counted as a blunder. Mean count per middlegame game.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 3 },
  },
  {
    name: "Inaccuracy Rate",
    key: "middlegame_inaccuracy_avg",
    unit: "/game",
    group: "tactics",
    summary: "Average inaccuracies per middlegame.",
    detail:
      "A middlegame inaccuracy drops win probability by 5–10pp (from 5pp up to but not including 10pp). Mean count per middlegame game.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 4 },
  },
  {
    name: "Missed Opportunities",
    key: "middlegame_missed_opportunity_pct",
    unit: "%",
    group: "tactics",
    summary: "Chances after an opponent blunder that you failed to convert.",
    detail:
      "When the opponent blunders in the middlegame (your win probability jumps by more than 15pp), the next move is an opportunity. It counts as missed if your reply is a mistake or worse (≥10pp drop), or drops ≥10pp from the post-blunder peak. Percentage of such chances you miss.",
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
      "Same opportunity window as Missed Opportunities, but only when a material-winning tactic was available on the board before your reply. Percentage of those tactic chances you miss. TacticsMade counts when you had a hanging/profitable capture (≥+2 material) and you took it.",
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
      "A blunder (>15pp) that leaves a material tactic for the opponent is an allowed-tactic chance. Found if they capture or their reply worsens your position by half a blunder threshold. n/a means zero such chances.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Attackers in King Zone",
    key: "middlegame_king_attackers_score",
    unit: "%",
    group: "king",
    summary: "King-zone pressure as a share of maximum attacker power.",
    detail:
      "Each sampled middlegame position: unique opponent pieces (not king) that attack any of the eight squares around your king. Power weights: P=1, N/B=3, R=5, Q=9. Sum those powers once per piece, square the sum (stacked pressure overweight), then scale to 0–100 against the theoretical max of one full army minus king (Q+2R+2B+2N = 31 → 31² = 961). Sampled every 3 middlegame plies and averaged. 0 = no zone pressure; 100 = every non-king piece hitting the zone.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Pawn Shield Integrity",
    key: "middlegame_pawn_shield_pct",
    unit: "%",
    group: "king",
    summary: "Share of castled shield pawns that never moved or were taken.",
    detail:
      "After you castle (or sit on a wing back-rank), we track the three shield pawns (f/g/h or a/b/c). Each starts intact; if that pawn moves or is captured, its flag flips. Final score = intact pawns ÷ 3 × 100. No per-position board scans after arming—only move events update the flags.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Open File Proximity",
    key: "middlegame_open_file_proximity_pct",
    unit: "%",
    group: "king",
    summary: "Peak exposure of your king to open or semi-open files.",
    detail:
      "Tracks pawn counts on the king file and adjacent files; if you castled, also the rook file (h or a). Uncastled kings never use the flank/rook file — only king file + neighbors. Semi-open = pawns of only one side; open = neither. Open = 100, semi = 70 (half weight on adjacent, 0.6 on rook file when castled). Sticky maximum during the middlegame.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Safe Legal Moves",
    key: "middlegame_safe_moves_pct",
    unit: "%",
    group: "activity",
    summary: "Share of your legal moves landing off any enemy attack.",
    detail:
      "On your turn, percentage of legal destinations not attacked by any opponent piece (not only pawns—so opponent pressure counts fully). Sampled every 5 middlegame plies on your turn and averaged. Lower means more of your options walk into enemy fire.",
    format: (v) => v.toFixed(1),
    scale: { kind: "fixed", max: 100 },
  },
  {
    name: "Outpost Control",
    key: "middlegame_outpost_control_avg",
    unit: "",
    group: "activity",
    summary: "Distinct outpost squares your minors occupied.",
    detail:
      "Count of unique squares where one of your knights/bishops sat on a classic outpost (friendly pawn support, no enemy pawn attack, ranks 4–6 / 3–5 for Black). Same square counts once per game even if revisited.",
    format: (v) => v.toFixed(2),
    scale: { kind: "benchmark", fallback: 1 },
  },
  {
    name: "Space Advantage",
    key: "middlegame_space_advantage_pct",
    unit: "%",
    group: "activity",
    summary: "Safe space on c–f files, ranks 3–5.",
    detail:
      "Among the 12 squares on files c–f and ranks 3–5, the share not attacked by enemy pawns. Sampled every 5 middlegame plies and averaged.",
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
    summary: "Games with lasting doubled pawns in the middlegame.",
    detail:
      "Two or more of your pawns on the same file. Flash doubles that vanish on the next recapture in a trade are ignored—structure must stay doubled for at least 3 consecutive middlegame plies. Percentage of middlegame games meeting that bar.",
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
    summary: "Average number of pawn islands in the middlegame.",
    detail:
      "Connected groups of your pawns separated by open files. Every 5 middlegame plies we record island_count; IslandsAvg = sum(island_count) ÷ scan_count. Middlegame runs from start ply (2 × opening phase-end fullmove) until endgame (≤7 non-pawn pieces).",
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
      middlegame_mistake_avg: agg.middlegame_mistake_avg,
      middlegame_inaccuracy_avg: agg.middlegame_inaccuracy_avg,
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
