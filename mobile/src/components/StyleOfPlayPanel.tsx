import Constants from "expo-constants";
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
import { extractMoveTimesFromPgn } from "../engine/clockFromPgn";
import type { StudyGame } from "../engine/analyzeMistakes";
import { DEBUG_DISABLE_STYLE_METRICS } from "../engine/debugFlags";
import { type OpeningMixStats } from "../engine/openingMix";
import {
  ARCHETYPE_DESCRIPTIONS,
  computeArchetypeScores,
  computePrimaryFeatureScores,
  computeStyleRadarAxes,
  type ArchetypeScore,
  type PrimaryFeatureScore,
  type StyleRadarAxis,
} from "../engine/archetypeScores";
import { StyleRadarChart } from "./StyleRadarChart";
import type { StyleMetricsAggregate } from "../engine/styleMetrics";
import {
  lookupBaseline,
  normalizeSpeed,
  peerDeltaLabel,
  ratingBand,
  type BaselineMetricHit,
} from "../data/baselines";
import { peerImpactColor } from "../data/metricPolarity";
import { Info, X } from "lucide-react-native";
import { AppIcon } from "../icons";
import { EdgeCard, SectionLabel } from "./ui";
import { colors, font, radius, result, spacing, type, withAlpha } from "../theme";

const EVAL_DEPENDENT_METRICS = new Set([
  "Time When Losing",
  "Time on Big Moments",
  "Position Swings",
  "Sacrifices",
  "Endgame Conversion",
  "Breaking Draws",
  "Comebacks",
  "Blunders",
]);

function debugStyleLog(data: Record<string, unknown>) {
  // #region agent log
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0] || "127.0.0.1";
  const runId = String(data.runId || "traits-timing");
  fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6d2375",
    },
    body: JSON.stringify({
      sessionId: "6d2375",
      runId,
      hypothesisId: "H-traits",
      location: "StyleOfPlayPanel.tsx",
      message: "style/traits",
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  console.log("[traits] style/traits", data);
  // #endregion
}

type MetricRow = {
  name: string;
  value: string;
  unit: string;
  summary: string;
  detail: string;
  occurred: boolean;
  baselineKey?: string;
  absoluteRef?: number;
  refKey?: string;
  userNum?: number | null;
  scale?: MetricScale;
};

type Section = {
  title: string;
  metrics: MetricRow[];
};

type MetricScale =
  | { kind: "fixed"; max: number }
  | { kind: "benchmark"; fallback: number }
  | { kind: "signed"; fallback: number };

const METRIC_SCALE: Record<string, MetricScale> = {
  "Average Think Time": { kind: "benchmark", fallback: 14 },
  "Clock Difference": { kind: "signed", fallback: 8 },
  "Time When Losing": { kind: "benchmark", fallback: 14 },
  "Time on Big Moments": { kind: "benchmark", fallback: 20 },
  "Signature Openings": { kind: "fixed", max: 100 },
  "Offbeat Openings": { kind: "fixed", max: 100 },
  "Mainstream Openings": { kind: "fixed", max: 100 },
  "Side Openings": { kind: "fixed", max: 100 },
  "Position Swings": { kind: "benchmark", fallback: 100 },
  Sacrifices: { kind: "benchmark", fallback: 7 },
  "Early Flank Pushes": { kind: "benchmark", fallback: 25 },
  "Endgame Conversion": { kind: "fixed", max: 100 },
  "Early Piece Trades": { kind: "benchmark", fallback: 3 },
  "Unequal Threats": { kind: "benchmark", fallback: 7 },
  "Threat Escapes": { kind: "benchmark", fallback: 7 },
  "Trades Near Their King": { kind: "benchmark", fallback: 3 },
  "Trades Near Your King": { kind: "benchmark", fallback: 4 },
  "Opponent's Half Moves": { kind: "fixed", max: 100 },
  "Own Half Moves": { kind: "fixed", max: 100 },
  "Forward Moves": { kind: "fixed", max: 100 },
  "Backwards Moves": { kind: "fixed", max: 100 },
  "Breaking Draws": { kind: "benchmark", fallback: 12 },
  "Declined Recaptures": { kind: "benchmark", fallback: 30 },
  Comebacks: { kind: "benchmark", fallback: 50 },
  Blunders: { kind: "benchmark", fallback: 4 },
};

function projectBenchmarkMax(
  hit: BaselineMetricHit | null,
  fallback: number
): number {
  if (hit?.mean != null && Number.isFinite(hit.mean) && Math.abs(hit.mean) > 0) {
    return Math.abs(hit.mean) * 2;
  }
  return fallback;
}

function projectSignedHalf(
  hit: BaselineMetricHit | null,
  fallback: number
): number {
  const parts = [fallback];
  for (const raw of [hit?.p10, hit?.p90, hit?.p75, hit?.p25, hit?.mean]) {
    if (raw == null || !Number.isFinite(raw)) continue;
    const abs = Math.abs(raw);
    if (abs > 0) parts.push(abs * 1.35);
  }
  return Math.max(...parts);
}

function resolveScaleMax(
  scale: MetricScale,
  hit: BaselineMetricHit | null
): number {
  if (scale.kind === "fixed") return scale.max;
  if (scale.kind === "signed") return projectSignedHalf(hit, scale.fallback);
  return projectBenchmarkMax(hit, scale.fallback);
}

function MetricBulletGraph({
  value,
  peerMean,
  scaleMax,
  signed = false,
  fillColor,
}: {
  value: number | null | undefined;
  peerMean: number | null | undefined;
  scaleMax: number;
  signed?: boolean;
  fillColor: string;
}) {
  if (value == null || !Number.isFinite(value) || !(scaleMax > 0)) return null;

  if (signed) {
    const half = scaleMax;
    const toPct = (n: number) =>
      Math.max(0, Math.min(100, ((n + half) / (2 * half)) * 100));
    const zeroPct = 50;
    const valuePct = toPct(value);
    const left = Math.min(zeroPct, valuePct);
    const width = Math.abs(valuePct - zeroPct);
    const peerPct =
      peerMean != null && Number.isFinite(peerMean) ? toPct(peerMean) : null;
    return (
      <View style={styles.bulletWrap}>
        <View style={styles.bulletTrack}>
          <View style={[styles.bulletZero, { left: `${zeroPct}%` }]} />
          <View
            style={[
              styles.bulletFill,
              {
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: fillColor,
              },
            ]}
          />
          {peerPct != null ? (
            <View style={[styles.bulletPeer, { left: `${peerPct}%` }]} />
          ) : null}
        </View>
      </View>
    );
  }

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
            {
              width: `${Math.min(fillPct, 100)}%`,
              backgroundColor: fillColor,
            },
          ]}
        />
        {fillPct > 100 ? (
          <View style={styles.bulletOverflow} />
        ) : null}
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

const PERSONALITY_HELP = {
  title: "Your chess personality",
  summary:
    "Your chess personality is based on patterns in your games, including your opening choices, position changes, sacrifices, piece movement, time usage, attacking and defensive decisions, and how you handle difficult positions.",
  detail:
    "Your results are compared with players in a similar rating and time-control group.",
};

function HelpModal({
  content,
  onClose,
}: {
  content: { title: string; summary: string; detail: string } | null;
  onClose: () => void;
}) {
  if (!content) return null;
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
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
              <AppIcon icon={X} size={20} color={colors.textMuted} />
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

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function hasNumber(n: number | null | undefined): boolean {
  return n != null && Number.isFinite(n);
}

function hasPositive(n: number | null | undefined): boolean {
  return hasNumber(n) && (n as number) > 0;
}

function buildSections(
  style: StyleMetricsAggregate | null,
  mix: OpeningMixStats | null,
  clockFallback: {
    avg_time_per_move_s: number | null;
    avg_clock_diff_s: number | null;
  }
): Section[] {
  const initiative = (style?.initiative || {}) as Record<string, number | null>;
  const attacking = (style?.attacking || {}) as Record<string, number | null>;
  const creativity = (style?.creativity || {}) as Record<string, number | null>;
  const durability = (style?.durability || {}) as Record<string, number | null>;

  const avgTime =
    style?.avg_time_per_move_s ?? clockFallback.avg_time_per_move_s;
  const clockDiff =
    durability.avg_clock_diff_s ?? clockFallback.avg_clock_diff_s;

  return [
    {
      title: "Time Usage",
      metrics: [
        {
          name: "Average Think Time",
          value: fmt(avgTime),
          unit: "sec/move",
          summary: "How much time you usually take to make a move.",
          detail:
            "We read the clock timestamps from your games, calculate your average time per move in each game, then average those game-level values. Games without usable clock data are left out.",
          occurred: hasNumber(avgTime),
        },
        {
          name: "Clock Difference",
          value:
            clockDiff == null
              ? "—"
              : `${clockDiff >= 0 ? "+" : ""}${fmt(clockDiff)}`,
          unit: "sec",
          summary:
            "Whether you usually play faster or slower than your opponent.",
          detail:
            "For every game with clock data, we subtract your average move time from your opponent's average move time. Positive values mean you took longer; negative values mean you played faster.",
          occurred: hasNumber(clockDiff),
        },
        {
          name: "Time When Losing",
          value: fmt(durability.avg_disadvantage_time_s),
          unit: "sec/move",
          summary:
            "How much time you spend thinking when things are going badly.",
          detail:
            "Engine evaluations are converted into your estimated win probability. We collect your move times whenever that probability is 20% or lower, then average those times across the games and positions where this happened.",
          occurred:
            hasNumber(durability.avg_disadvantage_time_s) &&
            hasPositive(durability.disadvantage_positions),
        },
        {
          name: "Time on Big Moments",
          value: fmt(creativity.avg_critical_time_s),
          unit: "sec/move",
          summary: "How much time you spend when the game is about to change.",
          detail:
            "A position is marked as critical when your estimated win probability changes by at least 10 percentage points between moves. When clock data is available, we average the time you spent on those critical moves.",
          occurred:
            hasNumber(creativity.avg_critical_time_s) &&
            hasPositive(creativity.critical_positions),
        },
      ],
    },
    {
      title: "Opening Types",
      metrics: [
        {
          name: "Signature Openings",
          value: fmt(mix?.same_opening_rate_pct),
          unit: "% games",
          summary: "How often you return to your usual opening choices.",
          detail:
            "We identify your most-played opening for each context: White with e4, White with d4, Black against e4, and Black against d4. This is the percentage of games that use the corresponding signature opening.",
          occurred: hasPositive(mix?.same_openings.games),
        },
        {
          name: "Offbeat Openings",
          value: fmt(mix?.different_opening_rate_pct),
          unit: "% games",
          summary: "How often you step away from your usual openings.",
          detail:
            "This is the complement of Signature Openings: games whose opening does not match your usual opening for that side and first-pawn context.",
          occurred: hasPositive(mix?.different_openings.games),
        },
        {
          name: "Mainstream Openings",
          value: fmt(mix?.orthodox_rate_pct),
          unit: "% games",
          summary: "How often you play familiar, well-established openings.",
          detail:
            "Games are classified as mainstream using the app's ECO ranges and opening-name rules covering systems such as the Italian, Ruy Lopez, Sicilian, French, Caro-Kann, Queen's Gambit, London, and King's Indian.",
          occurred: hasPositive(mix?.orthodox.games),
        },
        {
          name: "Side Openings",
          value: fmt(mix?.unorthodox_rate_pct),
          unit: "% games",
          summary: "How often you choose something less standard.",
          detail:
            "A game is counted as a Side Opening when its ECO or opening name does not fall into the app's mainstream opening categories.",
          occurred: hasPositive(mix?.unorthodox.games),
        },
      ],
    },
    {
      title: "Initiative & Maneuver",
      metrics: [
        {
          name: "Position Swings",
          value: fmt(initiative.avg_eval_volatility_cp),
          unit: "cp/ply",
          summary:
            "How much your games tend to swing from one side to the other.",
          detail:
            "We compare the engine evaluation after consecutive moves, from your point of view, and measure the average absolute change. Larger values mean the game tends to have sharper evaluation swings.",
          occurred: hasPositive(initiative.avg_eval_volatility_cp),
        },
        {
          name: "Sacrifices",
          value: fmt(initiative.avg_sacrifice_moves),
          unit: "per game",
          summary: "How often you deliberately put material on the line.",
          detail:
            "A sacrifice is detected when you offer significant material without an immediate equivalent trade or recovery. The metric is the number of detected sacrifices divided by your total moves.",
          occurred: hasPositive(initiative.avg_sacrifice_moves),
        },
        {
          name: "Early Flank Pushes",
          value: fmt(initiative.early_flank_rate_pct),
          unit: "% games",
          summary: "How often you push your wing pawns early.",
          detail:
            "We check the first 12 moves for advances by the a-, b-, g-, or h-pawns deep enough to reach the opponent's side of the board. The value is the percentage of games containing at least one such push.",
          occurred: hasPositive(initiative.early_flank_rate_pct),
        },
        {
          name: "Endgame Conversion",
          value: fmt(initiative.endgame_conversion_rate_pct),
          unit: "% wins",
          summary:
            "How often you turn a winning endgame into an actual win.",
          detail:
            "Once the endgame begins and your engine-based win probability reaches the app's winning threshold, that game becomes a conversion opportunity. The metric is the percentage of those opportunities that ended in a win.",
          occurred: hasPositive(initiative.endgame_advantage_games),
        },
        {
          name: "Early Piece Trades",
          value: fmt(initiative.avg_early_trades),
          unit: "per game",
          summary: "How often you exchange pieces early.",
          detail:
            "During the first 12 moves, we detect short sequences of minor- or major-piece captures that form a trade. The value is the average number of detected early trades per game.",
          occurred: hasPositive(initiative.avg_early_trades),
        },
      ],
    },
    {
      title: "Attack & Defense",
      metrics: [
        {
          name: "Unequal Threats",
          value: fmt(attacking.avg_higher_value_threats),
          unit: "per game",
          summary:
            "How often you attack something more valuable than the piece doing the attacking.",
          detail:
            "After each of your moves, we check whether the moved piece attacks an enemy minor or major piece worth more than itself. The result is averaged across games.",
          occurred: hasPositive(attacking.avg_higher_value_threats),
        },
        {
          name: "Threat Escapes",
          value: fmt(attacking.avg_threat_escapes),
          unit: "per game",
          summary:
            "How often you manage to get an attacked piece out of danger.",
          detail:
            "We identify non-pawn, non-king pieces that are under attack before your move and no longer under the relevant attack afterward. The result is the average number of such escapes per game.",
          occurred: hasPositive(attacking.avg_threat_escapes),
        },
        {
          name: "Trades Near Their King",
          value: fmt(attacking.avg_trades_near_enemy_king),
          unit: "per game",
          summary:
            "How often your exchanges happen close to the enemy king.",
          detail:
            "We count minor- and major-piece trades whose capture square is within two squares of the opponent's king, then average those trades per game.",
          occurred: hasPositive(attacking.avg_trades_near_enemy_king),
        },
        {
          name: "Trades Near Your King",
          value: fmt(attacking.avg_trades_near_user_king),
          unit: "per game",
          summary: "How often exchanges happen close to your own king.",
          detail:
            "We use the same trade detection, but measure the distance from the capture square to your king.",
          occurred: hasPositive(attacking.avg_trades_near_user_king),
        },
      ],
    },
    {
      title: "Positional Play",
      metrics: [
        {
          name: "Opponent's Half Moves",
          value: fmt(attacking.territory_opp_pct),
          unit: "% moves",
          summary:
            "How often your pieces venture into the opponent's side of the board.",
          detail:
            "Every piece move is classified by its destination square. Ranks 5–8 are enemy territory for White and ranks 1–4 for Black. The percentage is enemy-half moves divided by your total moves.",
          occurred: hasPositive(attacking.territory_opp_pct),
        },
        {
          name: "Own Half Moves",
          value: fmt(attacking.territory_own_pct),
          unit: "% moves",
          summary: "How often your pieces stay on your side of the board.",
          detail:
            "Using the same board-half classification, we calculate the percentage of your moves that land in your own half.",
          occurred: hasPositive(attacking.territory_own_pct),
        },
        {
          name: "Forward Moves",
          value: fmt(attacking.forward_move_pct),
          unit: "% moves",
          summary: "How often your pieces move toward the opponent.",
          detail:
            "We classify directed piece moves by rank change relative to your color. Forward moves are counted against all forward, backward, and lateral piece moves.",
          occurred: hasPositive(attacking.forward_move_pct),
        },
        {
          name: "Backwards Moves",
          value: fmt(attacking.backward_move_pct),
          unit: "% moves",
          summary: "How often your pieces pull back or retreat.",
          detail:
            "Using the same directed-move set, we count moves that decrease your piece's progress toward the opponent.",
          occurred: hasPositive(attacking.backward_move_pct),
        },
      ],
    },
    {
      title: "Creativity",
      metrics: [
        {
          name: "Breaking Draws",
          value: fmt(creativity.drawishless_rate_pct),
          unit: "% games",
          summary:
            "How often you manage to make an even-looking game decisive.",
          detail:
            "From move 40 onward, we look for positions where your engine-based win probability is between 45% and 55%. If the game then finishes with a win or loss rather than a draw, it counts toward this metric.",
          occurred: hasPositive(creativity.drawishless_games),
        },
        {
          name: "Declined Recaptures",
          value: fmt(creativity.declined_recapture_rate_pct),
          unit: "% chances",
          summary: "How often you choose not to recapture immediately.",
          detail:
            "When your opponent captures a piece and you have a legal recapture on the same square, we check whether your next move takes it back. If you choose another move, the opportunity is counted as declined.",
          occurred: hasPositive(creativity.recapture_chances),
        },
      ],
    },
    {
      title: "Durability",
      metrics: [
        {
          name: "Comebacks",
          value: fmt(durability.recovery_rate_pct),
          unit: "% games",
          summary:
            "How often you recover after the game has gone badly against you.",
          detail:
            "A comeback opportunity begins when your engine-based win probability falls to 20% or lower. We then check whether you eventually draw or win. The score is recoveries divided by disadvantage games.",
          occurred: hasPositive(durability.disadvantage_games),
        },
        {
          name: "Blunders",
          value: fmt(durability.avg_blunders),
          unit: "per game",
          summary: "How often one move seriously hurts your position.",
          detail:
            "We count post-opening moves where your estimated win probability drops by 20 percentage points or more. The result is the average number of these blunders per game.",
          occurred: hasPositive(durability.total_blunders),
        },
      ],
    },
  ];
}

function attachPeerMeta(
  sections: Section[],
  style: StyleMetricsAggregate | null,
  mix: OpeningMixStats | null,
  clockFallback: {
    avg_time_per_move_s: number | null;
    avg_clock_diff_s: number | null;
  }
): Section[] {
  const initiative = (style?.initiative || {}) as Record<string, number | null>;
  const attacking = (style?.attacking || {}) as Record<string, number | null>;
  const creativity = (style?.creativity || {}) as Record<string, number | null>;
  const durability = (style?.durability || {}) as Record<string, number | null>;
  const avgTime =
    style?.avg_time_per_move_s ?? clockFallback.avg_time_per_move_s;
  const clockDiff =
    durability.avg_clock_diff_s ?? clockFallback.avg_clock_diff_s;
  const peerMeta: Record<
    string,
    {
      baselineKey?: string;
      absoluteRef?: number;
      refKey?: string;
      userNum: number | null | undefined;
    }
  > = {
    "Average Think Time": {
      baselineKey: "avg_time_per_move_s",
      userNum: avgTime,
    },
    "Clock Difference": {
      baselineKey: "avg_clock_diff_s",
      userNum: clockDiff,
    },
    "Time When Losing": {
      baselineKey: "avg_disadvantage_time_s",
      userNum: durability.avg_disadvantage_time_s,
    },
    "Time on Big Moments": {
      baselineKey: "avg_critical_time_s",
      userNum: creativity.avg_critical_time_s,
    },
    "Signature Openings": {
      absoluteRef: 50,
      refKey: "same_opening_rate",
      userNum: mix?.same_opening_rate_pct,
    },
    "Offbeat Openings": {
      absoluteRef: 50,
      refKey: "different_opening_rate",
      userNum: mix?.different_opening_rate_pct,
    },
    "Mainstream Openings": {
      baselineKey: "orthodox_rate",
      userNum: mix?.orthodox_rate_pct,
    },
    "Side Openings": {
      baselineKey: "unorthodox_rate",
      userNum: mix?.unorthodox_rate_pct,
    },
    "Position Swings": {
      baselineKey: "avg_eval_volatility_cp",
      userNum: initiative.avg_eval_volatility_cp,
    },
    Sacrifices: {
      baselineKey: "avg_sacrifice_moves",
      userNum: initiative.avg_sacrifice_moves,
    },
    "Early Flank Pushes": {
      baselineKey: "early_flank_rate_pct",
      userNum: initiative.early_flank_rate_pct,
    },
    "Endgame Conversion": {
      baselineKey: "endgame_conversion_rate_pct",
      userNum: initiative.endgame_conversion_rate_pct,
    },
    "Early Piece Trades": {
      baselineKey: "avg_early_trades",
      userNum: initiative.avg_early_trades,
    },
    "Unequal Threats": {
      baselineKey: "avg_higher_value_threats",
      userNum: attacking.avg_higher_value_threats,
    },
    "Threat Escapes": {
      baselineKey: "avg_threat_escapes",
      userNum: attacking.avg_threat_escapes,
    },
    "Trades Near Their King": {
      baselineKey: "avg_trades_near_enemy_king",
      userNum: attacking.avg_trades_near_enemy_king,
    },
    "Trades Near Your King": {
      baselineKey: "avg_trades_near_user_king",
      userNum: attacking.avg_trades_near_user_king,
    },
    "Opponent's Half Moves": {
      baselineKey: "territory_opp_pct",
      userNum: attacking.territory_opp_pct,
    },
    "Own Half Moves": {
      baselineKey: "territory_own_pct",
      userNum: attacking.territory_own_pct,
    },
    "Forward Moves": {
      baselineKey: "forward_move_pct",
      userNum: attacking.forward_move_pct,
    },
    "Backwards Moves": {
      baselineKey: "backward_move_pct",
      userNum: attacking.backward_move_pct,
    },
    "Breaking Draws": {
      baselineKey: "drawishless_rate_pct",
      userNum: creativity.drawishless_rate_pct,
    },
    "Declined Recaptures": {
      baselineKey: "declined_recapture_rate_pct",
      userNum: creativity.declined_recapture_rate_pct,
    },
    Comebacks: {
      baselineKey: "recovery_rate_pct",
      userNum: durability.recovery_rate_pct,
    },
    Blunders: {
      baselineKey: "avg_blunders",
      userNum: durability.avg_blunders,
    },
  };
  return sections.map((section) => ({
    ...section,
    metrics: section.metrics.map((metric) => {
      const meta = peerMeta[metric.name];
      const scale = METRIC_SCALE[metric.name];
      return {
        ...metric,
        baselineKey: meta?.baselineKey ?? metric.baselineKey,
        absoluteRef: meta?.absoluteRef ?? metric.absoluteRef,
        refKey: meta?.refKey ?? metric.refKey,
        userNum: meta ? (meta.userNum ?? null) : metric.userNum,
        scale: scale ?? metric.scale,
      };
    }),
  }));
}

function clockFallbackFromGames(
  games: Array<{
    pgn_str?: string;
    time_control?: string;
    user_color: string;
  }>
): {
  avg_time_per_move_s: number | null;
  avg_clock_diff_s: number | null;
} {
  const userAvgs: number[] = [];
  const diffs: number[] = [];
  for (const game of games) {
    const clock = extractMoveTimesFromPgn(
      game.pgn_str,
      game.time_control,
      game.user_color
    );
    if (!clock) continue;
    userAvgs.push(clock.user_avg);
    diffs.push(clock.user_avg - clock.opp_avg);
  }
  if (!userAvgs.length) {
    return { avg_time_per_move_s: null, avg_clock_diff_s: null };
  }
  const mean = (vals: number[]) =>
    Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  return {
    avg_time_per_move_s: mean(userAvgs),
    avg_clock_diff_s: mean(diffs),
  };
}

export function StyleOfPlayPanel() {
  const { speed } = useFilters();
  const {
    games,
    gamesLoading,
    mix,
    style,
    styleTotal,
    styleComplete,
    baselines,
  } = useAnalytics();
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
  const clockFallback = useMemo(
    () => clockFallbackFromGames(games),
    [games]
  );
  const loading = gamesLoading && !mix && !style;
  const [helpContent, setHelpContent] = useState<{
    title: string;
    summary: string;
    detail: string;
  } | null>(null);

  const sections = useMemo(() => {
    const built = attachPeerMeta(
      buildSections(style, mix, clockFallback),
      style,
      mix,
      clockFallback
    );
    return built
      .map((section) => ({
        ...section,
        metrics: section.metrics.filter((metric) => metric.occurred),
      }))
      .filter((section) => section.metrics.length > 0);
  }, [style, mix, clockFallback]);

  const profileReady = styleComplete;

  const visibleSections = useMemo(() => {
    if (profileReady) return sections;
    return sections
      .map((section) => ({
        ...section,
        metrics: section.metrics.filter(
          (metric) => !EVAL_DEPENDENT_METRICS.has(metric.name)
        ),
      }))
      .filter((section) => section.metrics.length > 0);
  }, [sections, profileReady]);

  const radarAxes = useMemo((): StyleRadarAxis[] => {
    if (!profileReady || !style || style.games <= 0 || !mix) return [];
    const t0 = performance.now();
    const axes = computeStyleRadarAxes({
      style,
      mix,
      baselines,
      band: peerBand,
      speed: peerSpeed,
      avgTimeFallback: clockFallback.avg_time_per_move_s,
    });
    // #region agent log
    debugStyleLog({
      phase: "radar-useMemo",
      styleGames: style.games,
      scoreCount: axes.length,
      scores: Object.fromEntries(axes.map((s) => [s.key, s.score])),
      memoMs: Math.round((performance.now() - t0) * 1000) / 1000,
      runId: "style-yield",
    });
    // #endregion
    return axes;
  }, [
    profileReady,
    style,
    mix,
    baselines,
    peerBand,
    peerSpeed,
    clockFallback,
  ]);

  const primaryFeatures = useMemo((): PrimaryFeatureScore[] => {
    if (!profileReady || !style || style.games <= 0 || !mix) return [];
    return computePrimaryFeatureScores({
      style,
      mix,
      baselines,
      band: peerBand,
      speed: peerSpeed,
      avgTimeFallback: clockFallback.avg_time_per_move_s,
    });
  }, [
    profileReady,
    style,
    mix,
    baselines,
    peerBand,
    peerSpeed,
    clockFallback,
  ]);

  const topArchetype = useMemo((): ArchetypeScore | null => {
    if (!profileReady || !style || style.games <= 0 || !mix) return null;
    const scores = computeArchetypeScores({
      style,
      mix,
      baselines,
      band: peerBand,
      speed: peerSpeed,
      avgTimeFallback: clockFallback.avg_time_per_move_s,
    });
    return scores[0] ?? null;
  }, [
    profileReady,
    style,
    mix,
    baselines,
    peerBand,
    peerSpeed,
    clockFallback,
  ]);

  if (DEBUG_DISABLE_STYLE_METRICS) {
    return (
      <Text style={styles.hint}>
        Style metrics calculation disabled (debug). Background Stockfish scan can still run.
      </Text>
    );
  }

  const totalGames = styleTotal || games.length;
  if (!loading && totalGames <= 0 && !mix?.games) {
    return <Text style={styles.hint}>No games in this filter set.</Text>;
  }

  if (
    !loading &&
    profileReady &&
    !visibleSections.length &&
    !radarAxes.length
  ) {
    return (
      <Text style={styles.hint}>
        No style metrics with observed events in this sample yet.
      </Text>
    );
  }

  return (
    <View>
      <HelpModal
        content={helpContent}
        onClose={() => setHelpContent(null)}
      />
      {topArchetype ? (
        <View style={styles.archetypeHero}>
          <Text style={styles.archetypeHeroLabel}>Your chess personality</Text>
          <View style={styles.archetypeTitleRow}>
            <Text style={styles.archetypeName}>{topArchetype.name}</Text>
            <Pressable
              onPress={() => setHelpContent(PERSONALITY_HELP)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="About chess personality"
              style={styles.helpButton}
            >
              <AppIcon icon={Info} size={22} color={colors.textDim} />
            </Pressable>
          </View>
          <Text style={styles.archetypeDesc}>
            {ARCHETYPE_DESCRIPTIONS[topArchetype.name]}
          </Text>
        </View>
      ) : null}
      {radarAxes.length ? (
        <View style={styles.section}>
          <StyleRadarChart axes={radarAxes} />
          <Text style={styles.radarScores}>
            {radarAxes
              .map((axis) => `${axis.name} ${axis.score.toFixed(1)}`)
              .join("  ·  ")}
          </Text>
          {primaryFeatures.length ? (
            <Text style={styles.radarScores}>
              {primaryFeatures
                .map((f) => `${f.name} ${f.score.toFixed(1)}`)
                .join("  ·  ")}
            </Text>
          ) : null}
        </View>
      ) : null}
      {visibleSections.map((section) => (
        <View key={section.title} style={styles.section}>
          <SectionLabel>{section.title}</SectionLabel>
          {section.metrics.map((metric) => {
            const hit =
              metric.baselineKey && peerBand && peerSpeed
                ? lookupBaseline(
                    baselines,
                    metric.baselineKey,
                    peerBand,
                    peerSpeed
                  )
                : null;
            const scale = metric.scale ?? METRIC_SCALE[metric.name];
            const scaleMax = scale
              ? resolveScaleMax(scale, hit)
              : null;
            const referenceMean =
              metric.absoluteRef != null && Number.isFinite(metric.absoluteRef)
                ? metric.absoluteRef
                : hit?.mean ?? null;
            const polarityKey = metric.baselineKey ?? metric.refKey;
            const deltaLabel =
              referenceMean != null
                ? peerDeltaLabel(metric.userNum, referenceMean, metric.unit)
                : null;
            const impactColor = polarityKey
              ? peerImpactColor(
                  metric.userNum,
                  referenceMean,
                  polarityKey,
                  scaleMax != null
                    ? scale?.kind === "signed"
                      ? scaleMax * 2
                      : scaleMax
                    : null
                )
              : result.win;
            return (
              <EdgeCard key={metric.name} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.cardBody}>
                    <Text style={styles.name}>{metric.name}</Text>
                    <View style={styles.valueRow}>
                      <Text style={styles.value}>
                        {metric.value}
                        <Text style={styles.unit}> {metric.unit}</Text>
                      </Text>
                      {deltaLabel ? (
                        <Text
                          style={[styles.peerDelta, { color: impactColor }]}
                        >
                          {deltaLabel}
                        </Text>
                      ) : null}
                    </View>
                    {scaleMax != null ? (
                      <MetricBulletGraph
                        value={metric.userNum}
                        peerMean={referenceMean}
                        scaleMax={scaleMax}
                        signed={scale?.kind === "signed"}
                        fillColor={impactColor}
                      />
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() =>
                      setHelpContent({
                        title: metric.name,
                        summary: metric.summary,
                        detail: metric.detail,
                      })
                    }
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`About ${metric.name}`}
                    style={styles.helpButton}
                  >
                    <AppIcon icon={Info} size={20} color={colors.textDim} />
                  </Pressable>
                </View>
              </EdgeCard>
            );
          })}
        </View>
      ))}
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
  radarScores: {
    ...type.bodySmall,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
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
  archetypeHero: {
    marginBottom: spacing.xl,
  },
  archetypeHeroLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: 4,
  },
  archetypeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  archetypeName: {
    ...type.title,
    color: colors.text,
    flex: 1,
    flexShrink: 1,
  },
  archetypeDesc: {
    ...type.body,
    color: colors.textMuted,
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
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    marginBottom: 2,
    flexWrap: "wrap",
  },
  unit: {
    ...type.caption,
    color: colors.textMuted,
  },
  peerDelta: {
    ...type.caption,
    fontFamily: font.sansMedium,
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
    top: -4,
    bottom: -4,
    width: 3,
    marginLeft: -1.5,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: withAlpha("#000000", 0.35),
  },
  bulletZero: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    marginLeft: -0.5,
    backgroundColor: withAlpha("#ffffff", 0.24),
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
  helpScroll: {
    flexGrow: 0,
  },
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
