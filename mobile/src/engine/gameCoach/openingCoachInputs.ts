/**
 * Opening checkpoint note inputs: phase metric snapshot + peer baseline gaps.
 * Peers = rating×speed means (same as Insights), not ECO cells.
 * Node-safe: no RN / cache imports — pass BaselineStore via OpeningPeerContext.
 */

import { Chess, type Color } from "chess.js";
import { metricPolarity } from "../../data/metricPolarity";
import type { OpeningGameRow } from "../openingPhase";
import { spaceAdvantagePct, kingAttackersPct } from "../middlegamePhase";
import { resolveEcoFamily } from "../ecoFamilies";
import type { CoachMetricMoment } from "./coachGameMetrics";
import { zoneAdvanceSnaps } from "../phaseTacticalMetrics";

/** Minimal baseline store surface (avoids importing mobile baselines → RN cache). */
export type OpeningBaselineHit = { mean: number | null };
export type OpeningBaselineStore = {
  available: boolean;
  by_cell: Record<string, Record<string, OpeningBaselineHit>>;
};

/** Matches Insights `metricPolarity` for opening peer baselines. */
export type OpeningPeerPolarity = "lower_better" | "higher_better";
export type OpeningPeerJudgment = "good" | "bad" | "ok";

export type OpeningPeerSignal = {
  metric: string;
  peerDelta: number | null;
  polarity: OpeningPeerPolarity;
  judgment: OpeningPeerJudgment;
  /** Positive = good for user (polarity-normalized). */
  impact: number;
  softKeys: readonly string[];
};

const PEER_EPS = 0.05;

function significantFloor(metric: string): number {
  return OPENING_PEER_SIGNIFICANT[metric] ?? PEER_EPS;
}

export function isSignificantOpeningImpact(
  metric: string,
  impact: number
): boolean {
  return Math.abs(impact) >= significantFloor(metric);
}

function polarityFromBaseline(baselineKey: string): OpeningPeerPolarity {
  return metricPolarity(baselineKey) === "lower_better"
    ? "lower_better"
    : "higher_better";
}

/**
 * Opening peer metrics vs Insights baselines.
 * lower_better: castle_fullmove, uncastled_rate, tempo_waste
 * higher_better: minors_developed, center_control, opening_accuracy
 * space: higher_better (snapshot; no opening peer cell)
 */
/** Min |impact| to treat a peer Δ as significant (Insights-aligned). */
export const OPENING_PEER_SIGNIFICANT: Record<string, number> = {
  minors_developed: 0.5,
  center_control_pct: 3,
  castle_fullmove: 1,
  uncastled_rate_pct: 10,
  tempo_waste_rate_pct: 3,
  opening_accuracy_pct: 3,
  space_advantage_pct: 5,
  queenside_advance: 4,
  kingside_advance: 4,
  center_advance: 4,
  queenside_advance_opponent: 4,
  kingside_advance_opponent: 4,
  center_advance_opponent: 4,
};

/**
 * Metric → didactic soft key(s). No filler methodology/prophylaxis/pawn_break.
 * Only emit a key when that metric’s judgment is significant.
 */
export const OPENING_PEER_METRICS = [
  {
    inputKey: "minors_developed",
    baselineKey: "opening_minors_developed_by_10",
    peerMeanKey: "peer_minors_developed",
    peerDeltaKey: "peer_delta_minors_developed",
    softKeys: ["piece.centralization"],
    polarity: polarityFromBaseline("opening_minors_developed_by_10"),
    lowerBetter: false,
  },
  {
    inputKey: "center_control_pct",
    baselineKey: "opening_center_control_pct",
    peerMeanKey: "peer_center_control_pct",
    peerDeltaKey: "peer_delta_center_control_pct",
    softKeys: ["piece.centralization", "imbalance.space"],
    polarity: polarityFromBaseline("opening_center_control_pct"),
    lowerBetter: false,
  },
  {
    inputKey: "castle_fullmove",
    baselineKey: "opening_castle_fullmove",
    peerMeanKey: "peer_castle_fullmove",
    peerDeltaKey: "peer_delta_castle_fullmove",
    softKeys: ["attack.king_safety"],
    polarity: polarityFromBaseline("opening_castle_fullmove"),
    lowerBetter: true,
  },
  {
    inputKey: "uncastled_rate_pct",
    baselineKey: "opening_uncastled_rate_pct",
    peerMeanKey: "peer_uncastled_rate_pct",
    peerDeltaKey: "peer_delta_uncastled_rate_pct",
    softKeys: ["attack.king_safety"],
    polarity: polarityFromBaseline("opening_uncastled_rate_pct"),
    lowerBetter: true,
  },
  {
    inputKey: "tempo_waste_rate_pct",
    baselineKey: "opening_tempo_waste_rate_pct",
    peerMeanKey: "peer_tempo_waste_rate_pct",
    peerDeltaKey: "peer_delta_tempo_waste_rate_pct",
    softKeys: ["piece.centralization"],
    polarity: polarityFromBaseline("opening_tempo_waste_rate_pct"),
    lowerBetter: true,
  },
  {
    inputKey: "opening_accuracy_pct",
    baselineKey: "opening_accuracy_pct",
    peerMeanKey: "peer_opening_accuracy_pct",
    peerDeltaKey: "peer_delta_opening_accuracy_pct",
    softKeys: [],
    polarity: polarityFromBaseline("opening_accuracy_pct"),
    lowerBetter: false,
  },
] as const;

/** Snapshot-only space (no opening peer baseline cell). */
export const OPENING_SPACE_SOFT_KEYS = ["imbalance.space"] as const;

/**
 * @deprecated Opening soft keys come from significant peer/snapshot judgments only.
 * Kept empty so callers do not spray principle laundry lists.
 */
export const OPENING_CHECKPOINT_SOFT_KEYS = [] as const;

const RATING_BANDS: Array<[number, number, string]> = [
  [800, 999, "800-999"],
  [1000, 1199, "1000-1199"],
  [1200, 1399, "1200-1399"],
  [1400, 1599, "1400-1599"],
  [1600, 1799, "1600-1799"],
  [1800, 1999, "1800-1999"],
  [2000, 2199, "2000-2199"],
  [2200, 2399, "2200-2399"],
  [2400, 4000, "2400+"],
];

export type OpeningPeerContext = {
  baselines?: OpeningBaselineStore | null;
  rating?: number | null;
  speed?: string | null;
  timeControl?: string | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function colorFromUser(userColor: "white" | "black"): Color {
  return userColor === "white" ? "w" : "b";
}

function peerRatingBand(rating: number | null | undefined): string | null {
  if (rating == null) return null;
  const r = Math.floor(Number(rating));
  if (!Number.isFinite(r) || r < 800) return null;
  for (const [lo, hi, label] of RATING_BANDS) {
    if (r >= lo && r <= hi) return label;
  }
  return null;
}

function estimateGameSecondsFromTc(tc: string | null | undefined): number | null {
  if (!tc || tc === "-") return null;
  const parts = String(tc).split("+");
  const base = Number(parts[0]);
  const inc = parts.length > 1 ? Number(parts[1]) : 0;
  if (!Number.isFinite(base) || !Number.isFinite(inc)) return null;
  return base + 40 * inc;
}

function peerSpeedFromContext(ctx: OpeningPeerContext): string | null {
  const s = String(ctx.speed || "").toLowerCase().trim();
  if (["bullet", "blitz", "rapid", "classical"].includes(s)) return s;
  // Lichess sometimes sends "ultraBullet" / "correspondence"
  if (s === "ultrabullet") return "bullet";
  if (s === "correspondence") return "classical";
  const total = estimateGameSecondsFromTc(ctx.timeControl);
  if (total == null) return null;
  if (total < 180) return "bullet";
  if (total < 480) return "blitz";
  if (total < 1500) return "rapid";
  return "classical";
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

/**
 * Phase-level opening metrics for coach moments (not line Δ).
 * Available after heuristics run — same numbers Insights uses.
 */
export function buildOpeningMetricSnapshot(
  opening: OpeningGameRow | null | undefined,
  opts?: {
    fen?: string | null;
    userColor?: "white" | "black";
    badAccuracyMoves?: number | null;
  }
): Record<string, string | number | boolean | null> {
  if (!opening) return {};
  const fam = resolveEcoFamily(
    opening.opening_eco || null,
    opening.opening_name || null
  );
  const out: Record<string, string | number | boolean | null> = {
    minors_developed: opening.opening_minors_developed_by_10 ?? null,
    pawn_moves: opening.opening_pawn_moves ?? null,
    castle_fullmove: opening.opening_castle_fullmove ?? null,
    uncastled: opening.uncastled ?? false,
    uncastled_rate_pct: opening.uncastled ? 100 : 0,
    opening_accuracy_pct: opening.opening_accuracy_pct ?? null,
    center_control_pct: opening.opening_center_control_pct ?? null,
    tempo_waste_rate_pct: opening.opening_tempo_waste_rate_pct ?? null,
    eco_family: fam?.name || null,
    eco_family_key: fam?.key || null,
  };
  if (opts?.badAccuracyMoves != null) {
    out.bad_accuracy_moves = opts.badAccuracyMoves;
  }
  if (opening.opening_king_attackers_score != null) {
    out.king_attackers_score = opening.opening_king_attackers_score;
  }
  if (opening.opening_pawn_breaks != null && opening.opening_pawn_breaks > 0) {
    out.pawn_breaks = opening.opening_pawn_breaks;
  }
  if (opts?.fen && opts.userColor) {
    try {
      const board = new Chess(opts.fen);
      const color = colorFromUser(opts.userColor);
      out.space_advantage_pct = spaceAdvantagePct(board, color);
      out.king_attackers_pct = kingAttackersPct(board, color);
      Object.assign(out, zoneAdvanceSnaps(board, color));
    } catch {
      /* fen optional */
    }
  }
  return out;
}

export function resolvePeerBandSpeed(ctx: OpeningPeerContext | null | undefined): {
  band: string | null;
  speed: string | null;
} {
  if (!ctx) return { band: null, speed: null };
  return {
    band: peerRatingBand(ctx.rating ?? null),
    speed: peerSpeedFromContext(ctx),
  };
}

/**
 * Peer means + user−peer Δ for opening metrics.
 * Missing band/speed/store → empty (caller still has metric snapshot).
 * Irregular / unmapped ECO: same global peers (no ECO-scoped baselines).
 */
export function buildOpeningPeerComparison(
  opening: OpeningGameRow | null | undefined,
  ctx?: OpeningPeerContext | null
): Record<string, string | number | boolean | null> {
  if (!opening || !ctx) return {};
  const store = ctx.baselines?.available ? ctx.baselines : null;
  const { band, speed } = resolvePeerBandSpeed(ctx);
  if (!store || !band || !speed) return {};

  const snapshot = buildOpeningMetricSnapshot(opening);
  const out: Record<string, string | number | boolean | null> = {
    peer_band: band,
    peer_speed: speed,
    peer_scope: "rating_speed",
  };

  for (const def of OPENING_PEER_METRICS) {
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

/** Polarity-normalized impact: positive = good for the user. */
export function openingPeerImpact(
  peerDelta: number,
  polarity: OpeningPeerPolarity
): number {
  return polarity === "lower_better" ? -peerDelta : peerDelta;
}

export function openingPeerJudgment(
  impact: number,
  eps: number = PEER_EPS
): OpeningPeerJudgment {
  if (impact > eps) return "good";
  if (impact < -eps) return "bad";
  return "ok";
}

function spaceSnapshotSignal(
  spacePct: number
): OpeningPeerSignal | null {
  if (!Number.isFinite(spacePct)) return null;
  let judgment: OpeningPeerJudgment = "ok";
  let impact = 0;
  if (spacePct < 30) {
    judgment = "bad";
    impact = spacePct - 30;
  } else if (spacePct > 50) {
    judgment = "good";
    impact = spacePct - 50;
  }
  if (judgment === "ok") return null;
  if (!isSignificantOpeningImpact("space_advantage_pct", impact)) return null;
  return {
    metric: "space_advantage_pct",
    peerDelta: null,
    polarity: "higher_better",
    judgment,
    impact: round1(impact),
    softKeys: OPENING_SPACE_SOFT_KEYS,
  };
}

/**
 * Absolute snapshot judgments when peer Δ for that metric is missing.
 * Evidence-only: uncastled / weak development / soft centre / pawn breaks.
 */
export function buildOpeningSnapshotJudgmentSignals(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): OpeningPeerSignal[] {
  if (!inputs) return [];
  const out: OpeningPeerSignal[] = [];
  const hasPeer = (deltaKey: string) => {
    const d = inputs[deltaKey];
    return typeof d === "number" && Number.isFinite(d);
  };

  if (!hasPeer("peer_delta_uncastled_rate_pct") && inputs.uncastled === true) {
    out.push({
      metric: "uncastled_rate_pct",
      peerDelta: null,
      polarity: "lower_better",
      judgment: "bad",
      impact: -100,
      softKeys: ["attack.king_safety"],
    });
  }
  if (
    !hasPeer("peer_delta_castle_fullmove") &&
    typeof inputs.castle_fullmove === "number" &&
    inputs.castle_fullmove >= 12
  ) {
    out.push({
      metric: "castle_fullmove",
      peerDelta: null,
      polarity: "lower_better",
      judgment: "bad",
      impact: -(inputs.castle_fullmove - 10),
      softKeys: ["attack.king_safety"],
    });
  }
  if (
    !hasPeer("peer_delta_minors_developed") &&
    typeof inputs.minors_developed === "number" &&
    inputs.minors_developed < 3
  ) {
    out.push({
      metric: "minors_developed",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: inputs.minors_developed - 3,
      softKeys: ["piece.centralization"],
    });
  }
  if (
    !hasPeer("peer_delta_center_control_pct") &&
    typeof inputs.center_control_pct === "number" &&
    inputs.center_control_pct < 40
  ) {
    out.push({
      metric: "center_control_pct",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: inputs.center_control_pct - 40,
      softKeys: ["piece.centralization", "imbalance.space"],
    });
  }
  if (
    typeof inputs.pawn_breaks === "number" &&
    inputs.pawn_breaks > 0
  ) {
    out.push({
      metric: "pawn_breaks",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: inputs.pawn_breaks,
      softKeys: ["positional.pawn_break"],
    });
  }
  if (
    typeof inputs.king_attackers_pct === "number" &&
    inputs.king_attackers_pct >= 20
  ) {
    out.push({
      metric: "king_attackers_pct",
      peerDelta: null,
      polarity: "lower_better",
      judgment: "bad",
      impact: -(inputs.king_attackers_pct - 15),
      softKeys: ["attack.king_safety"],
    });
  }

  const advanceSignals = buildAdvanceSnapshotSignals(inputs);
  for (const sig of advanceSignals) out.push(sig);

  return out;
}

/** Min absolute advance score to treat a wing as "committed". */
const ADVANCE_COMMIT_FLOOR = 4;
/** Own vs opp gap that marks a significant wing race. */
const ADVANCE_GAP = 3;

function numInput(
  inputs: Record<string, string | number | boolean | null>,
  key: string
): number | null {
  const v = inputs[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Light snapshot judgments from queenside / kingside / centre pawn advances.
 * Opp wing storm → counter in centre/other wing; own lagging centre → space/break.
 */
export function buildAdvanceSnapshotSignals(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): OpeningPeerSignal[] {
  if (!inputs) return [];
  const out: OpeningPeerSignal[] = [];

  const ownQ = numInput(inputs, "queenside_advance");
  const oppQ = numInput(inputs, "queenside_advance_opponent");
  const ownK = numInput(inputs, "kingside_advance");
  const oppK = numInput(inputs, "kingside_advance_opponent");
  const ownC = numInput(inputs, "center_advance");
  const oppC = numInput(inputs, "center_advance_opponent");

  if (
    oppQ != null &&
    oppQ >= ADVANCE_COMMIT_FLOOR &&
    (ownQ == null || oppQ - ownQ >= ADVANCE_GAP)
  ) {
    const impact = -(oppQ - (ownQ ?? 0));
    if (isSignificantOpeningImpact("queenside_advance_opponent", impact)) {
      out.push({
        metric: "queenside_advance_opponent",
        peerDelta: null,
        polarity: "lower_better",
        judgment: "bad",
        impact: round1(impact),
        softKeys: ["imbalance.space", "attack.initiative"],
      });
    }
  }
  if (
    oppK != null &&
    oppK >= ADVANCE_COMMIT_FLOOR &&
    (ownK == null || oppK - ownK >= ADVANCE_GAP)
  ) {
    const impact = -(oppK - (ownK ?? 0));
    if (isSignificantOpeningImpact("kingside_advance_opponent", impact)) {
      out.push({
        metric: "kingside_advance_opponent",
        peerDelta: null,
        polarity: "lower_better",
        judgment: "bad",
        impact: round1(impact),
        softKeys: ["imbalance.space", "attack.initiative"],
      });
    }
  }
  if (
    ownC != null &&
    ownC < 4 &&
    oppC != null &&
    oppC - ownC >= ADVANCE_GAP
  ) {
    const impact = ownC - oppC;
    if (isSignificantOpeningImpact("center_advance", impact)) {
      out.push({
        metric: "center_advance",
        peerDelta: null,
        polarity: "higher_better",
        judgment: "bad",
        impact: round1(impact),
        softKeys: ["imbalance.space", "piece.centralization"],
      });
    }
  }
  if (
    ownC != null &&
    ownC >= ADVANCE_COMMIT_FLOOR &&
    (oppC == null || ownC - oppC >= ADVANCE_GAP)
  ) {
    const impact = ownC - (oppC ?? 0);
    if (isSignificantOpeningImpact("center_advance", impact)) {
      out.push({
        metric: "center_advance",
        peerDelta: null,
        polarity: "higher_better",
        judgment: "good",
        impact: round1(impact),
        softKeys: ["imbalance.space", "piece.centralization"],
      });
    }
  }

  return out;
}

/**
 * Peer (and space/snapshot) signals with polarity-normalized judgments.
 * Signs mean good/bad for the user — e.g. castle Δ −6.1 → good.
 */
export function buildOpeningPeerSignals(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): OpeningPeerSignal[] {
  if (!inputs) return [];
  const out: OpeningPeerSignal[] = [];
  for (const def of OPENING_PEER_METRICS) {
    const delta = inputs[def.peerDeltaKey];
    if (typeof delta !== "number" || !Number.isFinite(delta)) continue;
    const polarity = def.polarity as OpeningPeerPolarity;
    const impact = openingPeerImpact(delta, polarity);
    const judgment = openingPeerJudgment(impact);
    if (
      judgment === "ok" ||
      !isSignificantOpeningImpact(def.inputKey, impact)
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
  const space = inputs.space_advantage_pct;
  if (typeof space === "number") {
    const spaceSig = spaceSnapshotSignal(space);
    if (spaceSig) out.push(spaceSig);
  }
  const covered = new Set(out.map((s) => s.metric));
  for (const snap of buildOpeningSnapshotJudgmentSignals(inputs)) {
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

export function formatOpeningPeerSignalsShort(
  signals: OpeningPeerSignal[]
): string {
  return signals
    .map((s) => {
      const d =
        s.peerDelta == null
          ? "snap"
          : `${s.peerDelta > 0 ? "+" : ""}${s.peerDelta}`;
      return `${s.metric}:${d}/${s.polarity}/${s.judgment}`;
    })
    .join(",");
}

/**
 * Soft keys ranked by |impact| (biggest significant peer/snapshot gap first).
 * No laundry-list fillers — only keys evidenced by judgments.
 */
export function softKeysFromOpeningPeerGaps(
  inputs: Record<string, string | number | boolean | null> | null | undefined,
  opts?: { badOnly?: boolean }
): string[] {
  const signals = buildOpeningPeerSignals(inputs).filter((s) => {
    if (opts?.badOnly) return s.judgment === "bad";
    return s.judgment === "good" || s.judgment === "bad";
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of signals) {
    for (const k of s.softKeys) {
      if (!k || seen.has(k)) continue;
      if (k.startsWith("methodology.")) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

const OPENING_INPUT_STICKY = new Set([
  "opening_name",
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
  "key_id",
  "key_ids",
]);

export function mergeOpeningCoachInputs(
  base: Record<string, string | number | boolean | null> | undefined,
  opening: OpeningGameRow | null | undefined,
  opts?: {
    fen?: string | null;
    userColor?: "white" | "black";
    badAccuracyMoves?: number | null;
    peer?: OpeningPeerContext | null;
    openingName?: string | null;
  }
): Record<string, string | number | boolean | null> {
  const snap = buildOpeningMetricSnapshot(opening, {
    fen: opts?.fen,
    userColor: opts?.userColor,
    badAccuracyMoves: opts?.badAccuracyMoves,
  });
  const peers = buildOpeningPeerComparison(opening, opts?.peer);
  const sticky: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(base || {})) {
    if (OPENING_INPUT_STICKY.has(k) && v != null && v !== "") {
      sticky[k] = v;
    }
  }
  const merged: Record<string, string | number | boolean | null> = {
    ...(base || {}),
    ...snap,
    ...peers,
    ...sticky,
  };
  if (opts?.openingName != null && opts.openingName !== "") {
    merged.opening_name = opts.openingName;
  }
  const peerSignals = buildOpeningPeerSignals(merged);
  if (peerSignals.length) {
    merged.peer_signals = formatOpeningPeerSignalsShort(peerSignals);
  } else {
    delete merged.peer_signals;
  }
  return merged;
}

/**
 * Stamp opening metric snapshot (+ optional peers / board space) onto
 * opening_name and opening_aggregate moments.
 */
export function enrichOpeningCoachMoments(args: {
  momentsByPly: Record<number, CoachMetricMoment>;
  opening: OpeningGameRow | null | undefined;
  userColor?: "white" | "black";
  badAccuracyMoves?: number | null;
  peer?: OpeningPeerContext | null;
  openingName?: string | null;
}): void {
  for (const moment of Object.values(args.momentsByPly)) {
    if (
      moment.structuralKind !== "opening_name" &&
      moment.structuralKind !== "opening_aggregate"
    ) {
      continue;
    }
    moment.inputs = mergeOpeningCoachInputs(moment.inputs, args.opening, {
      fen: moment.fen || null,
      userColor: args.userColor,
      badAccuracyMoves: args.badAccuracyMoves,
      peer: args.peer,
      openingName: args.openingName ?? null,
    });
  }
}
