import { result } from "../theme";

export type MetricPolarity = "higher_better" | "lower_better" | "neutral";
export type ColorTier = 1 | 2 | 3 | 4;

const LOWER_BETTER = new Set<string>([
  "avg_time_per_move_s",
  "avg_clock_diff_s",
  "avg_disadvantage_time_s",
  "avg_critical_time_s",
  "avg_eval_volatility_cp",
  "avg_trades_near_user_king",
  "territory_own_pct",
  "avg_blunders",
  "opening_castle_fullmove",
  "opening_uncastled_rate_pct",
  "opening_tempo_waste_rate_pct",
  "opening_pawn_moves_avg",
  "middlegame_blunder_avg",
  "middlegame_mistake_avg",
  "middlegame_inaccuracy_avg",
  "middlegame_missed_opportunity_pct",
  "middlegame_missed_tactic_pct",
  "middlegame_allowed_tactic_pct",
  "middlegame_king_attackers_score",
  "middlegame_open_file_proximity_pct",
  "middlegame_doubled_pawns_game_pct",
  "middlegame_backward_pawns_game_pct",
  "middlegame_pawn_islands_avg",
  "endgame_blunder_avg",
  "endgame_king_distance",
  "endgame_stalemate_pct",
]);

const NEUTRAL = new Set<string>([
  "same_opening_rate",
  "same_opening_rate_pct",
  "different_opening_rate",
  "different_opening_rate_pct",
  "orthodox_rate",
  "orthodox_rate_pct",
  "unorthodox_rate",
  "unorthodox_rate_pct",
  "avg_early_trades",
  "early_trade_rate_pct",
  "avg_threat_escapes",
  "backward_move_pct",
]);

/** Softness of edge colors: higher = less saturated, pulled toward mid. */
const COLOR_TIER: Record<string, ColorTier> = {
  recovery_rate_pct: 1,
  declined_recapture_rate_pct: 1,
  avg_eval_volatility_cp: 1,
  avg_blunders: 1,
  avg_time_per_move_s: 1,

  territory_own_pct: 2,
  drawishless_rate_pct: 2,
  avg_threat_escapes: 2,
  territory_opp_pct: 2,
  avg_disadvantage_time_s: 2,
  avg_higher_value_threats: 2,
  forward_move_pct: 2,

  avg_early_trades: 3,
  early_trade_rate_pct: 3,
  orthodox_rate: 3,
  orthodox_rate_pct: 3,
  avg_clock_diff_s: 3,
  avg_critical_time_s: 3,
  avg_trades_near_user_king: 3,
  early_flank_rate_pct: 3,
  avg_early_flank_pushes: 3,
  avg_trades_near_enemy_king: 3,

  middlegame_accuracy_pct: 1,
  middlegame_blunder_avg: 1,
  middlegame_missed_opportunity_pct: 1,
  middlegame_allowed_tactic_pct: 1,
  middlegame_king_attackers_score: 1,
  middlegame_opp_king_attackers_score: 1,
  middlegame_space_advantage_pct: 1,
  middlegame_pawn_islands_avg: 1,

  middlegame_mistake_avg: 2,
  middlegame_missed_tactic_pct: 2,
  middlegame_pawn_shield_pct: 2,
  middlegame_open_file_proximity_pct: 2,
  middlegame_outpost_control_avg: 2,
  middlegame_doubled_pawns_game_pct: 2,
  middlegame_backward_pawns_game_pct: 2,

  middlegame_inaccuracy_avg: 3,
  middlegame_safe_moves_pct: 3,
  middlegame_iqp_win_rate_pct: 3,

  win_rate: 1,
  opening_accuracy_pct: 1,
  opening_castle_fullmove: 1,

  opening_minors_developed_by_10: 2,
  opening_uncastled_rate_pct: 2,
  opening_tempo_waste_rate_pct: 2,

  opening_center_control_pct: 3,
  opening_pawn_moves_avg: 3,

  endgame_blunder_avg: 1,
  endgame_pawn_diff: 1,
  endgame_stalemate_pct: 1,
  endgame_theoretical_saved_win_pct: 1,
  endgame_theoretical_saved_draw_pct: 1,

  endgame_king_distance: 2,
  endgame_beneficial_trade_pct: 2,
  te_pawn_endings_win_rate_pct: 2,
  te_pawn_endings_draw_rate_pct: 2,
  te_queen_vs_pawn_win_rate_pct: 2,
  te_queen_vs_pawn_draw_rate_pct: 2,
  te_rook_vs_pawn_win_rate_pct: 2,
  te_rook_vs_pawn_draw_rate_pct: 2,
  te_bishop_pawn_vs_knight_win_rate_pct: 2,
  te_bishop_pawn_vs_knight_draw_rate_pct: 2,
  te_opp_bishop_two_pawns_win_rate_pct: 2,
  te_opp_bishop_two_pawns_draw_rate_pct: 2,
  te_pawn_vs_knight_win_rate_pct: 2,
  te_pawn_vs_knight_draw_rate_pct: 2,
  te_two_pawns_vs_rook_win_rate_pct: 2,
  te_two_pawns_vs_rook_draw_rate_pct: 2,
  te_knight_pawn_vs_bishop_win_rate_pct: 2,
  te_knight_pawn_vs_bishop_draw_rate_pct: 2,
  te_rook_pawn_vs_rook_win_rate_pct: 2,
  te_rook_pawn_vs_rook_draw_rate_pct: 2,

  endgame_king_centralization: 3,
  endgame_simplification_trade_pct: 3,
};

/** Mix toward gray (keeps sage/red hue). Higher = grayer. */
const TIER_GRAY_MIX: Record<ColorTier, number> = {
  1: 0,
  2: 0.22,
  3: 0.38,
  4: 0.82,
};
/** Extra flatten after gray mix. */
const TIER_DESAT: Record<ColorTier, number> = {
  1: 0,
  2: 0.06,
  3: 0.12,
  4: 0.4,
};

const GRADIENT_GREEN = result.win;
const GRADIENT_MID = "#E0B83A";
const GRADIENT_RED = result.loss;
const NEUTRAL_GRAY = "#8a8a8a";

/** Half-window as fraction of bar range (±10% → 20% blend zone). */
const BLEND_HALF_FRAC = 0.1;
/**
 * Exponential steepness inside the blend window.
 * At ~1% of bar (0.1 of window): ~50% of color shift.
 * At halfway (±5% of bar): ~97% — clearly sage or red.
 * Past the window edge: solid.
 */
const BLEND_EXP_K = 7;

export function metricPolarity(key: string): MetricPolarity {
  if (NEUTRAL.has(key)) return "neutral";
  if (LOWER_BETTER.has(key)) return "lower_better";
  return "higher_better";
}

export function metricColorTier(key: string): ColorTier {
  if (metricPolarity(key) === "neutral") return 4;
  return COLOR_TIER[key] ?? 1;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mixHex(a: string, b: string, t: number): string {
  const u = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * u);
  const g = Math.round(ag + (bg - ag) * u);
  const bl = Math.round(ab + (bb - ab) * u);
  return `#${[r, g, bl].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function desaturateHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const grayHex = `#${[gray, gray, gray]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
  return mixHex(hex, grayHex, amount);
}

type TierPalette = { green: string; red: string; mid: string };

function paletteForTier(tier: ColorTier): TierPalette {
  const grayMix = TIER_GRAY_MIX[tier];
  const desat = TIER_DESAT[tier];
  return {
    green: desaturateHex(mixHex(GRADIENT_GREEN, NEUTRAL_GRAY, grayMix), desat),
    red: desaturateHex(mixHex(GRADIENT_RED, NEUTRAL_GRAY, grayMix), desat),
    mid: desaturateHex(mixHex(GRADIENT_MID, NEUTRAL_GRAY, grayMix), desat),
  };
}

/** t ∈ [-1, 1]: −1 red → 0 amber → +1 green */
function gradientFromSigned(t: number, palette: TierPalette): string {
  const clamped = Math.max(-1, Math.min(1, t));
  if (clamped >= 0) return mixHex(palette.mid, palette.green, clamped);
  return mixHex(palette.mid, palette.red, -clamped);
}

/** Map |delta|/span ∈ [0,1] through ease-out so small diffs move color fastest. */
function exponentialBlend(normalizedAbs: number): number {
  const x = Math.max(0, Math.min(1, normalizedAbs));
  return 1 - Math.exp(-BLEND_EXP_K * x);
}

export function peerImpactSigned(
  user: number | null | undefined,
  mean: number | null | undefined,
  key: string
): number | null {
  if (
    user == null ||
    mean == null ||
    !Number.isFinite(user) ||
    !Number.isFinite(mean)
  ) {
    return null;
  }
  const polarity = metricPolarity(key);
  if (polarity === "neutral") return null;
  return polarity === "lower_better" ? mean - user : user - mean;
}

export function peerImpactTone(
  user: number | null | undefined,
  mean: number | null | undefined,
  key: string
): "good" | "bad" | "neutral" | null {
  const signed = peerImpactSigned(user, mean, key);
  if (signed == null) {
    if (
      user != null &&
      mean != null &&
      Number.isFinite(user) &&
      Number.isFinite(mean) &&
      metricPolarity(key) === "neutral"
    ) {
      return "neutral";
    }
    return null;
  }
  if (signed === 0) return "good";
  return signed > 0 ? "good" : "bad";
}

/**
 * Color from signed impact vs peer mean.
 * `barRange` = full value span of the bullet track (scaleMax, or 2×scaleMax if signed).
 * Blend only inside ±10% of that span around zero differential; outside → solid sage/red.
 * Inside window, progress is exponential so small diffs shift color most.
 * Color vividness follows metric color tier (1 vivid → 3 soft).
 */
export function peerImpactColor(
  user: number | null | undefined,
  mean: number | null | undefined,
  key: string,
  barRange?: number | null
): string {
  const palette = paletteForTier(metricColorTier(key));

  if (metricPolarity(key) === "neutral") return palette.green;

  const signed = peerImpactSigned(user, mean, key);
  if (signed == null) return palette.green;
  if (signed === 0) return palette.mid;

  const range =
    barRange != null && Number.isFinite(barRange) && barRange > 0
      ? barRange
      : Math.max(Math.abs(mean as number) * 2, 1);
  const span = range * BLEND_HALF_FRAC;
  const normalized = Math.abs(signed) / span;
  if (normalized >= 1) {
    return signed > 0 ? palette.green : palette.red;
  }
  const blend = exponentialBlend(normalized);
  return gradientFromSigned(Math.sign(signed) * blend, palette);
}
