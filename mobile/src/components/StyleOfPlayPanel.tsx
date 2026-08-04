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
  computeStyleRadarAxes,
  type ArchetypeScore,
  type StyleRadarAxis,
} from "../engine/archetypeScores";
import { StyleRadarChart } from "./StyleRadarChart";
import type { StyleMetricsAggregate } from "../engine/styleMetrics";
import {
  lookupBaseline,
  normalizeSpeed,
  ratingBand,
  type BaselineMetricHit,
} from "../data/baselines";
import { Ionicons } from "@expo/vector-icons";
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
  "Average Think Time": { kind: "benchmark", fallback: 18 },
  "Clock Difference": { kind: "signed", fallback: 8 },
  "Time When Losing": { kind: "benchmark", fallback: 18 },
  "Time on Big Moments": { kind: "benchmark", fallback: 22 },
  "Signature Openings": { kind: "fixed", max: 100 },
  "Offbeat Openings": { kind: "fixed", max: 100 },
  "Mainstream Openings": { kind: "fixed", max: 100 },
  "Side Openings": { kind: "fixed", max: 100 },
  "Position Swings": { kind: "fixed", max: 40 },
  Sacrifices: { kind: "fixed", max: 5 },
  "Early Flank Pushes": { kind: "fixed", max: 100 },
  "Endgame Conversion": { kind: "fixed", max: 100 },
  "Early Piece Trades": { kind: "benchmark", fallback: 4 },
  "Unequal Threats": { kind: "benchmark", fallback: 5 },
  "Threat Escapes": { kind: "benchmark", fallback: 5 },
  "Fights Near Their King": { kind: "benchmark", fallback: 3.5 },
  "Fights Near Your King": { kind: "benchmark", fallback: 3.5 },
  "Enemy Half Moves": { kind: "fixed", max: 100 },
  "Own Half Moves": { kind: "fixed", max: 100 },
  "Forward Moves": { kind: "fixed", max: 100 },
  "Backward Moves": { kind: "fixed", max: 100 },
  "Breaking Draws": { kind: "fixed", max: 100 },
  "Declined Recaptures": { kind: "fixed", max: 100 },
  Comebacks: { kind: "fixed", max: 100 },
  Blunders: { kind: "benchmark", fallback: 4 },
};

function projectBenchmarkMax(
  hit: BaselineMetricHit | null,
  fallback: number
): number {
  const parts = [fallback];
  if (hit?.p90 != null && Number.isFinite(hit.p90) && hit.p90 > 0) {
    parts.push(hit.p90 * 1.25);
  } else if (hit?.p75 != null && Number.isFinite(hit.p75) && hit.p75 > 0) {
    parts.push(hit.p75 * 1.45);
  } else if (hit?.mean != null && Number.isFinite(hit.mean) && hit.mean > 0) {
    parts.push(hit.mean * 2.2);
  }
  return Math.max(...parts);
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
}: {
  value: number | null | undefined;
  peerMean: number | null | undefined;
  scaleMax: number;
  signed?: boolean;
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
              { left: `${left}%`, width: `${width}%` },
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
            { width: `${Math.min(fillPct, 100)}%` },
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
  title: "Personality Type",
  summary:
    "We compare your play pattern to nine ideal style profiles and show the closest match.",
  detail:
    "From your filtered games we collect move lists and PGN clocks, Stockfish evaluations converted to win probability, and opening ECO/name tags. Those feed style metrics (time use, sacrifices, territory, threats, recovery, blunders) and opening mix (signature vs offbeat, mainstream vs side).\n\nMetrics are turned into a normalized feature vector: maneuver vs initiative style, intuitive style, opening loyalty and orthodoxy, and time-quality signals (overall, critical moments, and when you are worse). Where possible, time and volatility signals are scaled against Lichess peers in your rating band and speed. Secondary themes—creativity, attacking, positioning, defense, and durability—also shape the match.\n\nEach personality (Technical, Positional, Attacking, Calculating, Tricky, Dynamic, Practical, Intuitive, Logical) has a target profile. Your similarity score blends directional alignment (cosine, 60%) with closeness in feature space (40%), plus a small bonus from the secondary themes. The highest-scoring profile is shown as your personality type.",
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
          unit: "s",
          summary: "How long you usually spend on each move.",
          detail:
            "From each game’s PGN clock stamps we measure your think time per move, average those within the game, then average across games that have clock data. Games without usable clocks are skipped.",
          occurred: hasNumber(avgTime),
        },
        {
          name: "Clock Difference",
          value:
            clockDiff == null
              ? "—"
              : `${clockDiff >= 0 ? "+" : ""}${fmt(clockDiff)}`,
          unit: "s",
          summary:
            "Whether you think longer or shorter than your opponents on average.",
          detail:
            "For each game with clocks we compute your average move time minus your opponent’s. Positive means you spend more time; negative means you play faster. Reported value is the mean of those game-level differences.",
          occurred: hasNumber(clockDiff),
        },
        {
          name: "Time When Losing",
          value: fmt(durability.avg_disadvantage_time_s),
          unit: "s",
          summary: "How long you think when the position is already bad.",
          detail:
            "Using engine evaluations converted to your win probability, we flag moves where your chance of winning is 20% or lower. We collect your clock times on those moves and average them across the period.",
          occurred:
            hasNumber(durability.avg_disadvantage_time_s) &&
            hasPositive(durability.disadvantage_positions),
        },
        {
          name: "Time on Big Moments",
          value: fmt(creativity.avg_critical_time_s),
          unit: "s",
          summary:
            "How long you think when a move sharply changes the evaluation.",
          detail:
            "A move is critical when your win probability swings by ≥10 percentage points and the raw eval also moves by at least 1cp. Critical position count does not need clock data. Avg critical time uses your clock on those moves when clocks exist.",
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
          unit: "%",
          summary: "How often you stick to your usual openings.",
          detail:
            "For each side/first-pawn context (White e4, White d4, Black vs e4, Black vs d4) we find your most common ECO/name as the signature. This metric is the share of games that match that signature opening.",
          occurred: hasPositive(mix?.same_openings.games),
        },
        {
          name: "Offbeat Openings",
          value: fmt(mix?.different_opening_rate_pct),
          unit: "%",
          summary: "How often you leave your usual opening choices.",
          detail:
            "The complement of Signature Openings: games whose ECO/name do not match your signature opening for that side and first-pawn context.",
          occurred: hasPositive(mix?.different_openings.games),
        },
        {
          name: "Mainstream Openings",
          value: fmt(mix?.orthodox_rate_pct),
          unit: "%",
          summary: "How often you play well-known mainstream systems.",
          detail:
            "Openings counted as mainstream by ECO ranges (Italian/Ruy/French/Caro, Sicilian, Queen’s Gambit family, King’s Indian, etc.) or by name match for Italian, Ruy Lopez, Sicilian, French, Caro-Kann, Queen’s Gambit, London, and King’s Indian. Value is that share of all games.",
          occurred: hasPositive(mix?.orthodox.games),
        },
        {
          name: "Side Openings",
          value: fmt(mix?.unorthodox_rate_pct),
          unit: "%",
          summary: "How often you play less standard opening systems.",
          detail:
            "Any game that does not fall into the mainstream ECO/name set above. Value is that share of all games in the period.",
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
          unit: "cp",
          summary: "How much the evaluation jumps from move to move.",
          detail:
            "Volatility is the average absolute change in your engine evaluation (centipawns, white-POV flipped to you) between consecutive plies, then averaged across games. Mate scores are excluded. Higher means sharper, less settled games.",
          occurred: hasPositive(initiative.avg_eval_volatility_cp),
        },
        {
          name: "Sacrifices",
          value: fmt(initiative.sacrifice_rate_pct),
          unit: "% moves",
          summary: "Share of your moves that give up material without a trade.",
          detail:
            "A sacrifice counts only when you leave a minor/major hanging (or capture while giving up ≥ a minor more than you take), the opponent takes that piece, and you do not immediately get the material back (same-square recapture or capturing a piece of similar value next move). Declined offers and trades do not count. Aggregated as sacrifices ÷ your moves across the period.",
          occurred: hasPositive(initiative.sacrifice_rate_pct),
        },
        {
          name: "Early Flank Pushes",
          value: fmt(initiative.early_flank_rate_pct),
          unit: "%",
          summary: "How often you push wing pawns early into enemy ground.",
          detail:
            "Counts games where, in the first 12 full moves, you advance a flank pawn (a, b, g, or h file) at least to the 4th rank as White or the 5th rank as Black. Value is the percentage of games with at least one such push.",
          occurred: hasPositive(initiative.early_flank_rate_pct),
        },
        {
          name: "Endgame Conversion",
          value: fmt(initiative.endgame_conversion_rate_pct),
          unit: "%",
          summary: "How often you turn a winning endgame into a win.",
          detail:
            "An endgame advantage sticks once your eval reaches ~+100cp (win prob ≥ 65%) after the endgame has started; it never resets. Conversion is the share of those games you actually won (PGN Result Win / 1-0 / 0-1 for you). Unfinished games (Result *) do not count as converted.",
          occurred: hasPositive(initiative.endgame_advantage_games),
        },
        {
          name: "Early Piece Trades",
          value: fmt(initiative.avg_early_trades),
          unit: "/game",
          summary: "How often pieces come off early in the game.",
          detail:
            "In the first 12 full moves, a trade is counted when minor or major pieces are captured in a short exchange (captures within two plies of each other). Reported as the average number of such trades per game.",
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
          unit: "/game",
          summary: "How often you attack pieces worth more than the attacker.",
          detail:
            "Full game. After each of your moves (including pawns), count when that piece attacks an enemy minor/major of strictly higher value, or captures a higher-value piece. Equal exchanges do not count. Averaged per game.",
          occurred: hasPositive(attacking.avg_higher_value_threats),
        },
        {
          name: "Threat Escapes",
          value: fmt(attacking.avg_threat_escapes),
          unit: "/game",
          summary: "How often a threatened piece slips to safety.",
          detail:
            "Counts only non-pawn, non-king moves. Before the move the piece must be under enemy attack (any or lesser-value); after the move it is no longer attacked that way. Pawn recaptures and king moves are ignored. Averaged per game.",
          occurred: hasPositive(attacking.avg_threat_escapes),
        },
        {
          name: "Fights Near Their King",
          value: fmt(attacking.avg_trades_near_enemy_king),
          unit: "/game",
          summary: "How often piece trades happen next to the enemy king.",
          detail:
            "Early piece trades (minor/major only — not pawns or kings) whose capture square is within Chebyshev distance 2 of the enemy king. Averaged per game.",
          occurred: hasPositive(attacking.avg_trades_near_enemy_king),
        },
        {
          name: "Fights Near Your King",
          value: fmt(attacking.avg_trades_near_user_king),
          unit: "/game",
          summary: "How often piece trades happen next to your king.",
          detail:
            "Same as fights near their king: minor/major trades only, capture square within distance 2 of your king. Averaged per game.",
          occurred: hasPositive(attacking.avg_trades_near_user_king),
        },
      ],
    },
    {
      title: "Positional Play",
      metrics: [
        {
          name: "Enemy Half Moves",
          value: fmt(attacking.territory_opp_pct),
          unit: "%",
          summary: "Share of your moves that land in the opponent’s half.",
          detail:
            "For White, ranks 5–8 count as enemy territory; for Black, ranks 1–4. Each of your moves is tagged by destination square. Value is enemy-half moves divided by all your moves.",
          occurred: hasPositive(attacking.territory_opp_pct),
        },
        {
          name: "Own Half Moves",
          value: fmt(attacking.territory_own_pct),
          unit: "%",
          summary: "Share of your moves that stay in your own half.",
          detail:
            "Complement of Enemy Half Moves using the same rank split. Value is own-half destinations divided by all your moves.",
          occurred: hasPositive(attacking.territory_own_pct),
        },
        {
          name: "Forward Moves",
          value: fmt(attacking.forward_move_pct),
          unit: "%",
          summary: "How often your pieces advance toward the enemy.",
          detail:
            "Among moves that change rank (forward, backward, or stay on rank as lateral), forward means increasing rank for White and decreasing rank for Black. Value is forward moves over all directed moves (forward + backward + lateral).",
          occurred: hasPositive(attacking.forward_move_pct),
        },
        {
          name: "Backward Moves",
          value: fmt(attacking.backward_move_pct),
          unit: "%",
          summary: "How often your pieces retreat.",
          detail:
            "Same directed-move set as Forward Moves. Backward means decreasing rank for White and increasing rank for Black. Value is backward moves over forward + backward + lateral.",
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
          unit: "%",
          summary:
            "How often equal late middlegames still end with a decisive result.",
          detail:
            "At move 40, if your win probability sits between 45% and 55% (a drawish position) and the game does not end as a draw, we count it. Value is that share of all games.",
          occurred: hasPositive(creativity.drawishless_games),
        },
        {
          name: "Declined Recaptures",
          value: fmt(creativity.declined_recapture_rate_pct),
          unit: "%",
          summary: "How often you refuse to take back immediately.",
          detail:
            "When the opponent captures, we check whether you can recapture on that square on your next turn. If you can but play something else, it counts as declined. Value is declined chances divided by all recapture chances.",
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
          unit: "%",
          summary: "How often you save or win games after being clearly worse.",
          detail:
            "A disadvantage game is any game where your win probability drops to 20% or lower at some point. Recovery counts those games you still win or draw. Value is recoveries divided by disadvantage games.",
          occurred: hasPositive(durability.disadvantage_games),
        },
        {
          name: "Blunders",
          value: fmt(durability.avg_blunders),
          unit: "/game",
          summary: "How often a single move tanks your winning chances after the opening.",
          detail:
            "Post-opening only (middlegame + endgame). A blunder drops win probability by more than 15pp. Opening blunders excluded so this aligns with phase metrics. Average count per game.",
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
    { baselineKey: string; userNum: number | null | undefined }
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
      baselineKey: "same_opening_rate",
      userNum: mix?.same_opening_rate_pct,
    },
    "Offbeat Openings": {
      baselineKey: "different_opening_rate",
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
      baselineKey: "sacrifice_rate_pct",
      userNum: initiative.sacrifice_rate_pct,
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
    "Fights Near Their King": {
      baselineKey: "avg_trades_near_enemy_king",
      userNum: attacking.avg_trades_near_enemy_king,
    },
    "Fights Near Your King": {
      baselineKey: "avg_trades_near_user_king",
      userNum: attacking.avg_trades_near_user_king,
    },
    "Enemy Half Moves": {
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
    "Backward Moves": {
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
          <Text style={styles.archetypeHeroLabel}>Your personality type</Text>
          <View style={styles.archetypeTitleRow}>
            <Text style={styles.archetypeName}>{topArchetype.name}</Text>
            <Pressable
              onPress={() => setHelpContent(PERSONALITY_HELP)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="About personality type"
              style={styles.helpButton}
            >
              <Ionicons
                name="information-circle-outline"
                size={22}
                color={colors.textDim}
              />
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
            return (
              <EdgeCard key={metric.name} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.cardBody}>
                    <Text style={styles.name}>{metric.name}</Text>
                    <Text style={styles.value}>
                      {metric.value}
                      <Text style={styles.unit}> {metric.unit}</Text>
                    </Text>
                    {scaleMax != null ? (
                      <MetricBulletGraph
                        value={metric.userNum}
                        peerMean={hit?.mean}
                        scaleMax={scaleMax}
                        signed={scale?.kind === "signed"}
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
                    <Ionicons
                      name="information-circle-outline"
                      size={20}
                      color={colors.textDim}
                    />
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
    marginBottom: 2,
  },
  unit: {
    ...type.caption,
    color: colors.textMuted,
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
