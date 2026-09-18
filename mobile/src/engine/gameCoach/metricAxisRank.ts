/**
 * Pedagogical metric ranking for coach comments.
 * Raw |Δ| must not pick the story: piece_support is a 0–100 proxy and
 * routinely outranks development / king-safety / tempo on magnitude alone.
 */

export type RankedMetricAxis = {
  field: string;
  delta: number;
  abs: number;
  helpsEngine: boolean;
  score: number;
};

const HIGHER_BETTER = new Set([
  "mobility",
  "hanging_material_opponent",
  "space_advantage_pct",
  "opp_king_attackers_pct",
  "material_balance",
  "open_file_utilization",
  "seventh_rank_infiltration",
  "queenside_advance",
  "kingside_advance",
  "center_advance",
  "bishop_diagonal_influence_light",
  "bishop_diagonal_influence_dark",
  "bishop_openness_light",
  "bishop_openness_dark",
  "pawn_storm_tempo",
  "center_fluidity_index",
  "pawn_storm_tempo_delta",
  "king_center_file_exposure",
  "knight_vs_bishop",
  "good_vs_bad_bishop",
  "wp",
  "eval_cp",
  "opp_king_in_centre",
  "opp_king_uncastled",
  "king_attack_ratio",
  "attack_setup",
  "opp_king_weaknesses",
  "second_weakness",
  "queen_centralization",
  "connected_rooks",
  "piece_liberation",
  "side_clamp",
  "key_square_control",
  "piece_support",
  "minors_developed",
  "center_control_pct",
]);

const LOWER_BETTER = new Set([
  "hanging_material_own",
  "king_attackers_pct",
  "queenside_advance_opponent",
  "kingside_advance_opponent",
  "center_advance_opponent",
  "bishop_diagonal_influence_light_opponent",
  "bishop_diagonal_influence_dark_opponent",
  "bishop_openness_light_opponent",
  "bishop_openness_dark_opponent",
  "tempo_waste_rate_pct",
  "uncastled_rate_pct",
  "castle_fullmove",
]);

const FIELD_SCALE: Record<string, number> = {
  mobility: 8,
  piece_support: 20,
  king_attackers_pct: 12,
  opp_king_attackers_pct: 12,
  space_advantage_pct: 15,
  hanging_material_own: 3,
  hanging_material_opponent: 3,
  material_balance: 3,
  open_file_utilization: 2,
  seventh_rank_infiltration: 1,
  queen_centralization: 2,
  connected_rooks: 1,
  piece_liberation: 2,
  tempo_waste_rate_pct: 25,
  minors_developed: 2,
  center_control_pct: 12,
  pawn_storm_tempo: 4,
  center_fluidity_index: 20,
  king_center_file_exposure: 20,
  king_attack_ratio: 2,
  attack_setup: 3,
  opp_king_weaknesses: 2,
  second_weakness: 1,
  key_square_control: 2,
  side_clamp: 8,
};

const PROXY_FIELDS = new Set(["piece_support"]);

const OPENING_DEVELOPMENT_FIELDS = new Set([
  "tempo_waste_rate_pct",
  "minors_developed",
  "center_control_pct",
]);

function deltaHelpsEngine(field: string, delta: number): boolean | null {
  if (Math.abs(delta) < 1e-9) return null;
  if (HIGHER_BETTER.has(field)) return delta > 0;
  if (LOWER_BETTER.has(field)) return delta < 0;
  return delta > 0;
}

function fieldScale(field: string): number {
  return FIELD_SCALE[field] || 10;
}

function pedagogicalMultiplier(
  field: string,
  phase: string | null | undefined
): number {
  const opening = (phase || "").toLowerCase() === "opening";
  if (field === "tempo_waste_rate_pct") return opening ? 3.4 : 2.2;
  if (field === "minors_developed") return opening ? 2.6 : 1.2;
  if (field === "hanging_material_own" || field === "hanging_material_opponent") {
    return 2.8;
  }
  if (field === "king_attackers_pct" || field === "opp_king_attackers_pct") {
    return opening ? 1.7 : 1.9;
  }
  if (field === "king_attack_ratio" || field === "opp_king_weaknesses") {
    return 1.6;
  }
  if (PROXY_FIELDS.has(field)) return opening ? 0.28 : 0.5;
  if (field === "mobility") return opening ? 0.85 : 1.0;
  if (field === "queen_centralization" && opening) return 0.4;
  if (OPENING_DEVELOPMENT_FIELDS.has(field)) return opening ? 2.0 : 1.0;
  return 1.0;
}

export function rankMetricAxes(args: {
  deltas: Array<{ field: string; delta?: number | null }>;
  phase?: string | null;
}): RankedMetricAxis[] {
  const phase = args.phase || null;
  const out: RankedMetricAxis[] = [];
  for (const d of args.deltas || []) {
    if (d.delta == null || typeof d.delta !== "number") continue;
    if (!Number.isFinite(d.delta) || Math.abs(d.delta) < 1e-9) continue;
    const helps = deltaHelpsEngine(d.field, d.delta);
    if (helps == null) continue;
    const abs = Math.abs(d.delta);
    const norm = Math.min(1, abs / fieldScale(d.field));
    const score = norm * pedagogicalMultiplier(d.field, phase);
    out.push({
      field: d.field,
      delta: d.delta,
      abs,
      helpsEngine: Boolean(helps),
      score,
    });
  }
  return out.sort((a, b) => {
    if (a.helpsEngine !== b.helpsEngine) return a.helpsEngine ? -1 : 1;
    return b.score - a.score || b.abs - a.abs;
  });
}

export function primaryFieldFromRanked(
  ranked: RankedMetricAxis[]
): string | null {
  return ranked.find((r) => r.helpsEngine)?.field ?? null;
}

export function significantRankedAxes(
  ranked: RankedMetricAxis[],
  limit = 4
): RankedMetricAxis[] {
  const helping = ranked.filter((r) => r.helpsEngine);
  if (!helping.length) return [];
  const top = helping[0]!.score;
  const floor = Math.max(0.18, top * 0.38);
  return helping.filter((r) => r.score >= floor).slice(0, limit);
}

export function wideRankedAxes(
  ranked: RankedMetricAxis[],
  limit = 10
): RankedMetricAxis[] {
  if (!ranked.length) return [];
  const helping = ranked.filter((r) => r.helpsEngine);
  const top = helping[0]?.score ?? ranked[0]!.score;
  const floor = Math.max(0.1, top * 0.22);
  const wide = ranked.filter((r) => r.score >= floor).slice(0, limit);
  if (wide.length) return wide;
  return (helping.length ? helping : ranked).slice(0, Math.min(4, limit));
}
