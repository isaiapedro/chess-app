/**
 * Middlegame checkpoint note inputs: full heuristic snapshot + peer baseline gaps.
 * Peers = rating×speed means (same BaselineStore / bundled mix as Insights).
 * Node-safe: pass OpeningPeerContext / OpeningBaselineStore (shared with opening).
 */

import { metricPolarity } from "../../data/metricPolarity";
import type { MiddlegameGameRow } from "../middlegamePhase";
import type { CoachMetricMoment } from "./coachGameMetrics";
import {
  type OpeningPeerContext,
  type OpeningBaselineStore,
  type OpeningPeerPolarity,
  type OpeningPeerJudgment,
  type OpeningPeerSignal,
  resolvePeerBandSpeed,
  openingPeerImpact,
  openingPeerJudgment,
  formatOpeningPeerSignalsShort,
} from "./openingCoachInputs";

export type MiddlegamePeerSignal = OpeningPeerSignal;

const PEER_EPS = 0.05;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function polarityFromBaseline(baselineKey: string): OpeningPeerPolarity {
  return metricPolarity(baselineKey) === "lower_better"
    ? "lower_better"
    : "higher_better";
}

function lookupPeerMean(
  store: OpeningBaselineStore,
  metric: string,
  band: string,
  speed: string
): number | null {
  const hit = store.by_cell[`${band}|${speed}`]?.[metric];
  if (!hit || hit.mean == null || !Number.isFinite(hit.mean)) return null;
  return hit.mean;
}

/** Min |impact| for significant MG peer Δ. */
export const MIDDLEGAME_PEER_SIGNIFICANT: Record<string, number> = {
  middlegame_accuracy_pct: 3,
  middlegame_blunders: 0.4,
  middlegame_mistakes: 0.5,
  middlegame_inaccuracies: 0.5,
  middlegame_missed_opportunity_pct: 8,
  middlegame_missed_tactic_pct: 8,
  middlegame_allowed_tactic_pct: 8,
  middlegame_king_attackers_score: 4,
  middlegame_opp_king_attackers_score: 4,
  middlegame_pawn_shield_pct: 8,
  middlegame_open_file_proximity_pct: 8,
  middlegame_safe_moves_pct: 5,
  middlegame_outpost_control: 0.3,
  middlegame_space_advantage_pct: 5,
  middlegame_pawn_islands_avg: 0.3,
};

export function isSignificantMiddlegameImpact(
  metric: string,
  impact: number
): boolean {
  return Math.abs(impact) >= (MIDDLEGAME_PEER_SIGNIFICANT[metric] ?? PEER_EPS);
}

/**
 * Game-row field → Insights baseline key + peer stamp keys + soft keys.
 * blunders/mistakes/inaccuracies: per-game counts vs peer *_avg.
 */
export const MIDDLEGAME_PEER_METRICS = [
  {
    inputKey: "middlegame_accuracy_pct",
    baselineKey: "middlegame_accuracy_pct",
    peerMeanKey: "peer_middlegame_accuracy_pct",
    peerDeltaKey: "peer_delta_middlegame_accuracy_pct",
    softKeys: ["methodology.candidate_moves"],
    polarity: polarityFromBaseline("middlegame_accuracy_pct"),
  },
  {
    inputKey: "middlegame_blunders",
    baselineKey: "middlegame_blunder_avg",
    peerMeanKey: "peer_middlegame_blunder_avg",
    peerDeltaKey: "peer_delta_middlegame_blunders",
    softKeys: ["methodology.candidate_moves", "methodology.visualization"],
    polarity: polarityFromBaseline("middlegame_blunder_avg"),
  },
  {
    inputKey: "middlegame_mistakes",
    baselineKey: "middlegame_mistake_avg",
    peerMeanKey: "peer_middlegame_mistake_avg",
    peerDeltaKey: "peer_delta_middlegame_mistakes",
    softKeys: ["methodology.comparison_and_elimination"],
    polarity: polarityFromBaseline("middlegame_mistake_avg"),
  },
  {
    inputKey: "middlegame_inaccuracies",
    baselineKey: "middlegame_inaccuracy_avg",
    peerMeanKey: "peer_middlegame_inaccuracy_avg",
    peerDeltaKey: "peer_delta_middlegame_inaccuracies",
    softKeys: ["methodology.candidate_moves"],
    polarity: polarityFromBaseline("middlegame_inaccuracy_avg"),
  },
  {
    inputKey: "middlegame_missed_opportunity_pct",
    baselineKey: "middlegame_missed_opportunity_pct",
    peerMeanKey: "peer_middlegame_missed_opportunity_pct",
    peerDeltaKey: "peer_delta_middlegame_missed_opportunity_pct",
    softKeys: ["methodology.candidate_moves", "attack.initiative"],
    polarity: polarityFromBaseline("middlegame_missed_opportunity_pct"),
  },
  {
    inputKey: "middlegame_missed_tactic_pct",
    baselineKey: "middlegame_missed_tactic_pct",
    peerMeanKey: "peer_middlegame_missed_tactic_pct",
    peerDeltaKey: "peer_delta_middlegame_missed_tactic_pct",
    softKeys: ["methodology.visualization", "methodology.candidate_moves"],
    polarity: polarityFromBaseline("middlegame_missed_tactic_pct"),
  },
  {
    inputKey: "middlegame_allowed_tactic_pct",
    baselineKey: "middlegame_allowed_tactic_pct",
    peerMeanKey: "peer_middlegame_allowed_tactic_pct",
    peerDeltaKey: "peer_delta_middlegame_allowed_tactic_pct",
    softKeys: ["positional.prophylaxis", "methodology.candidate_moves"],
    polarity: polarityFromBaseline("middlegame_allowed_tactic_pct"),
  },
  {
    inputKey: "middlegame_king_attackers_score",
    baselineKey: "middlegame_king_attackers_score",
    peerMeanKey: "peer_middlegame_king_attackers_score",
    peerDeltaKey: "peer_delta_middlegame_king_attackers_score",
    softKeys: ["attack.king_safety"],
    polarity: polarityFromBaseline("middlegame_king_attackers_score"),
  },
  {
    inputKey: "middlegame_opp_king_attackers_score",
    baselineKey: "middlegame_king_attackers_score",
    peerMeanKey: "peer_middlegame_opp_king_attackers_score",
    peerDeltaKey: "peer_delta_middlegame_opp_king_attackers_score",
    softKeys: ["attack.initiative", "attack.king_safety"],
    polarity: "higher_better" as OpeningPeerPolarity,
  },
  {
    inputKey: "middlegame_pawn_shield_pct",
    baselineKey: "middlegame_pawn_shield_pct",
    peerMeanKey: "peer_middlegame_pawn_shield_pct",
    peerDeltaKey: "peer_delta_middlegame_pawn_shield_pct",
    softKeys: ["attack.king_safety"],
    polarity: polarityFromBaseline("middlegame_pawn_shield_pct"),
  },
  {
    inputKey: "middlegame_open_file_proximity_pct",
    baselineKey: "middlegame_open_file_proximity_pct",
    peerMeanKey: "peer_middlegame_open_file_proximity_pct",
    peerDeltaKey: "peer_delta_middlegame_open_file_proximity_pct",
    softKeys: ["attack.king_safety"],
    polarity: polarityFromBaseline("middlegame_open_file_proximity_pct"),
  },
  {
    inputKey: "middlegame_safe_moves_pct",
    baselineKey: "middlegame_safe_moves_pct",
    peerMeanKey: "peer_middlegame_safe_moves_pct",
    peerDeltaKey: "peer_delta_middlegame_safe_moves_pct",
    softKeys: ["piece.coordination", "positional.prophylaxis"],
    polarity: polarityFromBaseline("middlegame_safe_moves_pct"),
  },
  {
    inputKey: "middlegame_outpost_control",
    baselineKey: "middlegame_outpost_control_avg",
    peerMeanKey: "peer_middlegame_outpost_control_avg",
    peerDeltaKey: "peer_delta_middlegame_outpost_control",
    softKeys: ["positional.outpost"],
    polarity: polarityFromBaseline("middlegame_outpost_control_avg"),
  },
  {
    inputKey: "middlegame_space_advantage_pct",
    baselineKey: "middlegame_space_advantage_pct",
    peerMeanKey: "peer_middlegame_space_advantage_pct",
    peerDeltaKey: "peer_delta_middlegame_space_advantage_pct",
    softKeys: ["imbalance.space", "positional.restriction"],
    polarity: polarityFromBaseline("middlegame_space_advantage_pct"),
  },
  {
    inputKey: "middlegame_pawn_islands_avg",
    baselineKey: "middlegame_pawn_islands_avg",
    peerMeanKey: "peer_middlegame_pawn_islands_avg",
    peerDeltaKey: "peer_delta_middlegame_pawn_islands_avg",
    softKeys: ["structure.pawn_chain"],
    polarity: polarityFromBaseline("middlegame_pawn_islands_avg"),
  },
] as const;

/** Full MiddlegameGameRow → coach moment inputs (before peers). */
export function buildMiddlegameMetricSnapshot(
  mg: MiddlegameGameRow | null | undefined
): Record<string, string | number | boolean | null> {
  if (!mg || !mg.reached_middlegame) return {};
  return {
    middlegame_accuracy_pct: mg.middlegame_accuracy_pct ?? null,
    middlegame_accuracy_moves: mg.middlegame_accuracy_moves ?? null,
    middlegame_blunders: mg.middlegame_blunders ?? null,
    middlegame_mistakes: mg.middlegame_mistakes ?? null,
    middlegame_inaccuracies: mg.middlegame_inaccuracies ?? null,
    middlegame_missed_opportunity_pct: mg.middlegame_missed_opportunity_pct ?? null,
    middlegame_missed_tactic_pct: mg.middlegame_missed_tactic_pct ?? null,
    middlegame_allowed_tactic_pct: mg.middlegame_allowed_tactic_pct ?? null,
    middlegame_king_attackers_score: mg.middlegame_king_attackers_score ?? null,
    middlegame_opp_king_attackers_score:
      mg.middlegame_opp_king_attackers_score ?? null,
    middlegame_pawn_shield_pct: mg.middlegame_pawn_shield_pct ?? null,
    middlegame_open_file_proximity_pct:
      mg.middlegame_open_file_proximity_pct ?? null,
    middlegame_safe_moves_pct: mg.middlegame_safe_moves_pct ?? null,
    middlegame_outpost_control: mg.middlegame_outpost_control ?? null,
    middlegame_space_advantage_pct: mg.middlegame_space_advantage_pct ?? null,
    had_iqp: mg.had_iqp ?? false,
    had_doubled_pawns: mg.had_doubled_pawns ?? false,
    had_backward_pawns: mg.had_backward_pawns ?? false,
    middlegame_pawn_islands_avg: mg.middlegame_pawn_islands_avg ?? null,
    middlegame_pawn_moves: mg.middlegame_pawn_moves ?? null,
    middlegame_pawn_breaks: mg.middlegame_pawn_breaks ?? null,
    middlegame_defended_pawns: mg.middlegame_defended_pawns ?? null,
    middlegame_unblocking_bishop_light:
      mg.middlegame_unblocking_bishop_light ?? null,
    middlegame_unblocking_bishop_dark:
      mg.middlegame_unblocking_bishop_dark ?? null,
    middlegame_checks: mg.middlegame_checks ?? null,
    middlegame_blocking_checks: mg.middlegame_blocking_checks ?? null,
    middlegame_king_attackers_rises: mg.middlegame_king_attackers_rises ?? null,
    middlegame_opp_king_attackers_rises:
      mg.middlegame_opp_king_attackers_rises ?? null,
    middlegame_seventh_rank_infiltration:
      mg.middlegame_seventh_rank_infiltration ?? null,
    middlegame_open_file_utilization:
      mg.middlegame_open_file_utilization ?? null,
    // Aliases used by thin legacy stamp / STRUCTURAL_KIND maps
    space_advantage_pct: mg.middlegame_space_advantage_pct ?? null,
    king_attackers_score: mg.middlegame_king_attackers_score ?? null,
    pawn_shield_pct: mg.middlegame_pawn_shield_pct ?? null,
    blunders: mg.middlegame_blunders ?? null,
    mistakes: mg.middlegame_mistakes ?? null,
    inaccuracies: mg.middlegame_inaccuracies ?? null,
    accuracy_pct: mg.middlegame_accuracy_pct ?? null,
  };
}

export function buildMiddlegamePeerComparison(
  mg: MiddlegameGameRow | null | undefined,
  ctx?: OpeningPeerContext | null
): Record<string, string | number | boolean | null> {
  if (!mg || !mg.reached_middlegame || !ctx) return {};
  const store = ctx.baselines?.available ? ctx.baselines : null;
  const { band, speed } = resolvePeerBandSpeed(ctx);
  if (!store || !band || !speed) return {};

  const snapshot = buildMiddlegameMetricSnapshot(mg);
  const out: Record<string, string | number | boolean | null> = {
    peer_band: band,
    peer_speed: speed,
    peer_scope: "rating_speed",
  };

  for (const def of MIDDLEGAME_PEER_METRICS) {
    const meanRaw = lookupPeerMean(store, def.baselineKey, band, speed);
    if (meanRaw == null) continue;
    const mean = round1(meanRaw);
    out[def.peerMeanKey] = mean;
    const userVal = snapshot[def.inputKey];
    if (typeof userVal === "number" && Number.isFinite(userVal)) {
      out[def.peerDeltaKey] = round1(userVal - mean);
    }
  }
  return out;
}

/** Absolute snapshot judgments when peer Δ missing. */
export function buildMiddlegameSnapshotJudgmentSignals(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): MiddlegamePeerSignal[] {
  if (!inputs) return [];
  const out: MiddlegamePeerSignal[] = [];
  const hasPeer = (deltaKey: string) => {
    const d = inputs[deltaKey];
    return typeof d === "number" && Number.isFinite(d);
  };

  if (inputs.had_iqp === true) {
    out.push({
      metric: "had_iqp",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: 2,
      softKeys: ["structure.iqp", "piece.blockade"],
    });
  }
  if (inputs.had_doubled_pawns === true) {
    out.push({
      metric: "had_doubled_pawns",
      peerDelta: null,
      polarity: "lower_better",
      judgment: "bad",
      impact: -5,
      softKeys: ["structure.doubled_pawns", "structure.pawn_chain"],
    });
  }
  if (inputs.had_backward_pawns === true) {
    out.push({
      metric: "had_backward_pawns",
      peerDelta: null,
      polarity: "lower_better",
      judgment: "bad",
      impact: -5,
      softKeys: ["structure.pawn_chain", "positional.outpost"],
    });
  }
  if (
    !hasPeer("peer_delta_middlegame_pawn_breaks") &&
    typeof inputs.middlegame_pawn_breaks === "number" &&
    inputs.middlegame_pawn_breaks >= 1
  ) {
    out.push({
      metric: "middlegame_pawn_breaks",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: inputs.middlegame_pawn_breaks,
      softKeys: ["positional.pawn_break"],
    });
  }
  if (
    !hasPeer("peer_delta_middlegame_seventh_rank_infiltration") &&
    typeof inputs.middlegame_seventh_rank_infiltration === "number" &&
    inputs.middlegame_seventh_rank_infiltration >= 1
  ) {
    out.push({
      metric: "middlegame_seventh_rank_infiltration",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: inputs.middlegame_seventh_rank_infiltration,
      softKeys: ["piece.seventh_rank_invasion"],
    });
  }
  if (
    typeof inputs.middlegame_opp_king_attackers_rises === "number" &&
    inputs.middlegame_opp_king_attackers_rises >= 2
  ) {
    out.push({
      metric: "middlegame_opp_king_attackers_rises",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: inputs.middlegame_opp_king_attackers_rises,
      softKeys: ["attack.initiative", "attack.king_safety"],
    });
  }
  return out.filter((s) => s.judgment === "good" || s.judgment === "bad");
}

export function buildMiddlegamePeerSignals(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): MiddlegamePeerSignal[] {
  if (!inputs) return [];
  const out: MiddlegamePeerSignal[] = [];
  for (const def of MIDDLEGAME_PEER_METRICS) {
    const delta = inputs[def.peerDeltaKey];
    if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
    const polarity = def.polarity as OpeningPeerPolarity;
    const impact = openingPeerImpact(delta, polarity);
    const judgment = openingPeerJudgment(impact);
    if (
      judgment === "ok" ||
      !isSignificantMiddlegameImpact(def.inputKey, impact)
    ) {
      continue;
    }
    out.push({
      metric: def.inputKey,
      peerDelta: delta,
      polarity,
      judgment,
      impact: round1(impact),
      softKeys: def.softKeys,
    });
  }
  const covered = new Set(out.map((s) => s.metric));
  for (const snap of buildMiddlegameSnapshotJudgmentSignals(inputs)) {
    if (covered.has(snap.metric)) continue;
    out.push(snap);
    covered.add(snap.metric);
  }
  return out.sort(
    (a, b) =>
      Math.abs(b.impact) - Math.abs(a.impact) ||
      a.metric.localeCompare(b.metric)
  );
}

export function softKeysFromMiddlegamePeerGaps(
  inputs: Record<string, string | number | boolean | null> | null | undefined,
  opts?: { badOnly?: boolean }
): string[] {
  const signals = buildMiddlegamePeerSignals(inputs).filter((s) => {
    if (opts?.badOnly) return s.judgment === "bad";
    return s.judgment === "good" || s.judgment === "bad";
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of signals) {
    for (const k of s.softKeys) {
      if (!k || seen.has(k)) continue;
      if (k.startsWith("methodology.") && signals.length > 2) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

const MG_INPUT_STICKY = new Set([
  "engine_line",
  "played_line",
  "engine_line_metrics",
  "played_line_metrics",
  "engine_vs_played",
  "why_better",
  "metric_keys",
  "primary_metric_keys",
  "primary_field",
  "metric_signals",
  "peer_signals",
  "situations",
  "situation_roles",
  "game_plan",
  "key_id",
  "key_ids",
  "brilliant_moves",
  "excellent_moves",
  "important_moves",
]);

export function mergeMiddlegameCoachInputs(
  base: Record<string, string | number | boolean | null> | undefined,
  mg: MiddlegameGameRow | null | undefined,
  opts?: {
    peer?: OpeningPeerContext | null;
    styleExtras?: Record<string, string | number | boolean | null> | null;
  }
): Record<string, string | number | boolean | null> {
  const snap = buildMiddlegameMetricSnapshot(mg);
  const peers = buildMiddlegamePeerComparison(mg, opts?.peer);
  const sticky: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (MG_INPUT_STICKY.has(k) && v != null && v !== "") {
      sticky[k] = v;
    }
  }
  const merged: Record<string, string | number | boolean | null> = {
    ...(base || {}),
    ...snap,
    ...(opts?.styleExtras || {}),
    ...peers,
    ...sticky,
  };
  const peerSignals = buildMiddlegamePeerSignals(merged);
  if (peerSignals.length) {
    merged.peer_signals = formatOpeningPeerSignalsShort(peerSignals);
  } else {
    delete merged.peer_signals;
  }
  return merged;
}

export function enrichMiddlegameCoachMoments(args: {
  momentsByPly: Record<number, CoachMetricMoment>;
  middlegame: MiddlegameGameRow | null | undefined;
  peer?: OpeningPeerContext | null;
  styleExtras?: Record<string, string | number | boolean | null> | null;
}): void {
  for (const moment of Object.values(args.momentsByPly)) {
    if (moment.structuralKind !== "middlegame_aggregate") continue;
    moment.inputs = mergeMiddlegameCoachInputs(moment.inputs, args.middlegame, {
      peer: args.peer,
      styleExtras: args.styleExtras,
    });
  }
}

/** Attach significant MG peer gaps onto live MG moments (bad/praise/pawn break). */
export function enrichLiveMiddlegamePeerGaps(args: {
  momentsByPly: Record<number, CoachMetricMoment>;
  middlegame: MiddlegameGameRow | null | undefined;
  peer?: OpeningPeerContext | null;
}): void {
  if (!args.middlegame?.reached_middlegame) return;
  const peers = buildMiddlegamePeerComparison(args.middlegame, args.peer);
  if (!Object.keys(peers).length) return;
  const synth = { ...buildMiddlegameMetricSnapshot(args.middlegame), ...peers };
  const signals = buildMiddlegamePeerSignals(synth);
  if (!signals.length) return;
  const short = formatOpeningPeerSignalsShort(peerSignalsSlice(signals, 6));
  for (const moment of Object.values(args.momentsByPly)) {
    const sk = moment.structuralKind;
    const live =
      !sk ||
      sk === "decisive_pawn_break" ||
      moment.inputs?.critical_mark ||
      moment.inputs?.praise_mark;
    if (!live && sk !== "middlegame_aggregate") continue;
    if (sk === "opening_name" || sk === "opening_aggregate") continue;
    if (sk === "endgame_advantage") continue;
    if (sk === "middlegame_aggregate") continue;
    moment.inputs = {
      ...(moment.inputs || {}),
      ...pickSignificantPeerStamps(peers, signals),
      peer_signals: short,
    };
  }
}

function peerSignalsSlice(
  signals: MiddlegamePeerSignal[],
  n: number
): MiddlegamePeerSignal[] {
  return signals.slice(0, n);
}

function pickSignificantPeerStamps(
  peers: Record<string, string | number | boolean | null>,
  signals: MiddlegamePeerSignal[]
): Record<string, string | number | boolean | null> {
  const keep = new Set<string>(["peer_band", "peer_speed", "peer_scope"]);
  for (const s of signals.slice(0, 8)) {
    const def = MIDDLEGAME_PEER_METRICS.find((d) => d.inputKey === s.metric);
    if (!def) continue;
    keep.add(def.peerMeanKey);
    keep.add(def.peerDeltaKey);
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of keep) {
    if (peers[k] != null) out[k] = peers[k]!;
  }
  return out;
}
