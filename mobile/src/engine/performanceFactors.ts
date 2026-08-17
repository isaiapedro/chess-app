import type { FactorsPayload, FactorItem } from "../api/types";
import {
  lookupBaseline,
  STYLE_BASELINE_METRIC,
  type BaselineStore,
} from "../data/baselines";
import { metricPolarity } from "../data/metricPolarity";
import type { OpeningMetricsAggregate } from "./openingPhase";
import type { MiddlegameMetricsAggregate } from "./middlegamePhase";
import type { EndgameMetricsAggregate } from "./endgamePhase";
import type { StyleMetricsAggregate } from "./styleMetrics";

const TIER_WEIGHT = { 1: 3, 2: 2, 3: 1 } as const;
const TOP_N = 3;

type MetricSource = {
  style?: StyleMetricsAggregate | null;
  opening?: OpeningMetricsAggregate | null;
  middlegame?: MiddlegameMetricsAggregate | null;
  endgame?: EndgameMetricsAggregate | null;
};

type ImpactMetricDef = {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  baselineKey: string;
  unit: string;
  read: (src: MetricSource) => number | null;
};

function finite(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n;
}

function formatMetricValue(value: number, unit: string): string {
  if (unit.includes("%") || unit.includes("cp")) {
    return (Math.round(value * 10) / 10).toFixed(1);
  }
  if (unit.includes("sec")) {
    return (Math.round(value * 10) / 10).toFixed(1);
  }
  if (Math.abs(value) >= 10) {
    return (Math.round(value * 10) / 10).toFixed(1);
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}

function styleGroup(
  style: StyleMetricsAggregate | null | undefined,
  key: "initiative" | "attacking" | "creativity" | "durability"
): Record<string, number | null> {
  const group = style?.[key];
  if (!group || typeof group !== "object") return {};
  return group as Record<string, number | null>;
}

const IMPACT_METRICS: ImpactMetricDef[] = [
  {
    id: "blunders",
    name: "Blunders",
    tier: 1,
    baselineKey: "avg_blunders",
    unit: "per game",
    read: (s) => finite(styleGroup(s.style, "durability").avg_blunders),
  },
  {
    id: "mistake_rate",
    name: "Mistake Rate",
    tier: 1,
    baselineKey: "middlegame_mistake_avg",
    unit: "per game",
    read: (s) => finite(s.middlegame?.middlegame_mistake_avg),
  },
  {
    id: "inaccuracy_rate",
    name: "Inaccuracy Rate",
    tier: 1,
    baselineKey: "middlegame_inaccuracy_avg",
    unit: "per game",
    read: (s) => finite(s.middlegame?.middlegame_inaccuracy_avg),
  },
  {
    id: "missed_opportunities",
    name: "Missed Opportunities",
    tier: 1,
    baselineKey: "middlegame_missed_opportunity_pct",
    unit: "% chances",
    read: (s) => finite(s.middlegame?.middlegame_missed_opportunity_pct),
  },
  {
    id: "missed_tactic",
    name: "Missed Tactic",
    tier: 1,
    baselineKey: "middlegame_missed_tactic_pct",
    unit: "% chances",
    read: (s) => finite(s.middlegame?.middlegame_missed_tactic_pct),
  },
  {
    id: "allowed_tactics",
    name: "Allowed Tactics",
    tier: 1,
    baselineKey: "middlegame_allowed_tactic_pct",
    unit: "% chances",
    read: (s) => finite(s.middlegame?.middlegame_allowed_tactic_pct),
  },
  {
    id: "endgame_conversion",
    name: "Endgame Conversion",
    tier: 1,
    baselineKey: "endgame_conversion_rate_pct",
    unit: "% wins",
    read: (s) =>
      finite(styleGroup(s.style, "initiative").endgame_conversion_rate_pct),
  },
  {
    id: "conversion_rate",
    name: "Conversion Rate",
    tier: 1,
    baselineKey: "endgame_mate_conversion_pct",
    unit: "% mates",
    read: (s) => finite(s.endgame?.endgame_mate_conversion_pct),
  },
  {
    id: "stalemate",
    name: "Stalemate",
    tier: 1,
    baselineKey: "endgame_stalemate_pct",
    unit: "% games",
    read: (s) => finite(s.endgame?.endgame_stalemate_pct),
  },
  {
    id: "theoretical_saved",
    name: "Theoretical Endgames Saved",
    tier: 1,
    baselineKey: "endgame_theoretical_saved_win_pct",
    unit: "% games",
    read: (s) => finite(s.endgame?.endgame_theoretical_saved_win_pct),
  },
  {
    id: "comebacks",
    name: "Comebacks",
    tier: 1,
    baselineKey: "recovery_rate_pct",
    unit: "% games",
    read: (s) => finite(styleGroup(s.style, "durability").recovery_rate_pct),
  },
  {
    id: "opening_accuracy",
    name: "Opening Accuracy",
    tier: 2,
    baselineKey: "opening_accuracy_pct",
    unit: "score",
    read: (s) => finite(s.opening?.opening_accuracy_pct),
  },
  {
    id: "middlegame_accuracy",
    name: "Accuracy in Middlegame",
    tier: 2,
    baselineKey: "middlegame_accuracy_pct",
    unit: "score",
    read: (s) => finite(s.middlegame?.middlegame_accuracy_pct),
  },
  {
    id: "endgame_blunders",
    name: "Blunder Rate on Endgames",
    tier: 2,
    baselineKey: "endgame_blunder_avg",
    unit: "per game",
    read: (s) => finite(s.endgame?.endgame_blunder_avg),
  },
  {
    id: "beneficial_trades",
    name: "Beneficial Trades",
    tier: 2,
    baselineKey: "endgame_beneficial_trade_pct",
    unit: "% trades",
    read: (s) => finite(s.endgame?.endgame_beneficial_trade_pct),
  },
  {
    id: "simplification_trades",
    name: "Simplification Trades",
    tier: 2,
    baselineKey: "endgame_simplification_trade_pct",
    unit: "% trades",
    read: (s) => finite(s.endgame?.endgame_simplification_trade_pct),
  },
  {
    id: "tempo_balance",
    name: "Tempo Balance",
    tier: 2,
    baselineKey: "opening_tempo_waste_rate_pct",
    unit: "% moves",
    read: (s) => finite(s.opening?.opening_tempo_waste_rate_pct),
  },
  {
    id: "space_advantage",
    name: "Space Advantage",
    tier: 2,
    baselineKey: "middlegame_space_advantage_pct",
    unit: "% squares",
    read: (s) => finite(s.middlegame?.middlegame_space_advantage_pct),
  },
  {
    id: "outpost_control",
    name: "Outpost Control",
    tier: 2,
    baselineKey: "middlegame_outpost_control_avg",
    unit: "per game",
    read: (s) => finite(s.middlegame?.middlegame_outpost_control_avg),
  },
  {
    id: "pawn_shield",
    name: "Pawn Shield Integrity",
    tier: 2,
    baselineKey: "middlegame_pawn_shield_pct",
    unit: "% pawns",
    read: (s) => finite(s.middlegame?.middlegame_pawn_shield_pct),
  },
  {
    id: "open_file_king",
    name: "Open File Proximity",
    tier: 2,
    baselineKey: "middlegame_open_file_proximity_pct",
    unit: "score",
    read: (s) => finite(s.middlegame?.middlegame_open_file_proximity_pct),
  },
  {
    id: "king_attackers",
    name: "Attackers in King Zone",
    tier: 2,
    baselineKey: "middlegame_king_attackers_score",
    unit: "score",
    read: (s) => finite(s.middlegame?.middlegame_king_attackers_score),
  },
  {
    id: "safe_moves",
    name: "Safe Legal Moves",
    tier: 2,
    baselineKey: "middlegame_safe_moves_pct",
    unit: "% moves",
    read: (s) => finite(s.middlegame?.middlegame_safe_moves_pct),
  },
  {
    id: "iqp",
    name: "Isolated Queen Pawn",
    tier: 2,
    baselineKey: "middlegame_iqp_win_rate_pct",
    unit: "% wins",
    read: (s) => finite(s.middlegame?.middlegame_iqp_win_rate_pct),
  },
  {
    id: "doubled_pawns",
    name: "Doubled Pawns",
    tier: 2,
    baselineKey: "middlegame_doubled_pawns_game_pct",
    unit: "% games",
    read: (s) => finite(s.middlegame?.middlegame_doubled_pawns_game_pct),
  },
  {
    id: "backward_pawns",
    name: "Backward Pawns",
    tier: 2,
    baselineKey: "middlegame_backward_pawns_game_pct",
    unit: "% games",
    read: (s) => finite(s.middlegame?.middlegame_backward_pawns_game_pct),
  },
  {
    id: "pawn_islands",
    name: "Pawn Islands",
    tier: 2,
    baselineKey: "middlegame_pawn_islands_avg",
    unit: "per game",
    read: (s) => finite(s.middlegame?.middlegame_pawn_islands_avg),
  },
  {
    id: "pawn_difference",
    name: "Pawn Difference",
    tier: 2,
    baselineKey: "endgame_pawn_diff",
    unit: "pawns",
    read: (s) => finite(s.endgame?.endgame_pawn_diff),
  },
  {
    id: "position_swings",
    name: "Position Swings",
    tier: 3,
    baselineKey: "avg_eval_volatility_cp",
    unit: "cp/ply",
    read: (s) =>
      finite(styleGroup(s.style, "initiative").avg_eval_volatility_cp),
  },
  {
    id: "sacrifices",
    name: "Sacrifices",
    tier: 3,
    baselineKey: "avg_sacrifice_moves",
    unit: "per game",
    read: (s) => finite(styleGroup(s.style, "initiative").avg_sacrifice_moves),
  },
  {
    id: "early_flank",
    name: "Early Flank Pushes",
    tier: 3,
    baselineKey: "early_flank_rate_pct",
    unit: "% games",
    read: (s) => finite(styleGroup(s.style, "initiative").early_flank_rate_pct),
  },
  {
    id: "early_piece_trades",
    name: "Early Piece Trades",
    tier: 3,
    baselineKey: "avg_early_trades",
    unit: "per game",
    read: (s) => finite(styleGroup(s.style, "initiative").avg_early_trades),
  },
  {
    id: "unequal_threats",
    name: "Unequal Threats",
    tier: 3,
    baselineKey: "avg_higher_value_threats",
    unit: "per game",
    read: (s) =>
      finite(styleGroup(s.style, "attacking").avg_higher_value_threats),
  },
  {
    id: "threat_escapes",
    name: "Threat Escapes",
    tier: 3,
    baselineKey: "avg_threat_escapes",
    unit: "per game",
    read: (s) => finite(styleGroup(s.style, "attacking").avg_threat_escapes),
  },
  {
    id: "trades_near_enemy_king",
    name: "Trades Near Their King",
    tier: 3,
    baselineKey: "avg_trades_near_enemy_king",
    unit: "per game",
    read: (s) =>
      finite(styleGroup(s.style, "attacking").avg_trades_near_enemy_king),
  },
  {
    id: "trades_near_own_king",
    name: "Trades Near Your King",
    tier: 3,
    baselineKey: "avg_trades_near_user_king",
    unit: "per game",
    read: (s) =>
      finite(styleGroup(s.style, "attacking").avg_trades_near_user_king),
  },
  {
    id: "territory_opp",
    name: "Opponent's Half Moves",
    tier: 3,
    baselineKey: "territory_opp_pct",
    unit: "% moves",
    read: (s) => finite(styleGroup(s.style, "attacking").territory_opp_pct),
  },
  {
    id: "territory_own",
    name: "Own Half Moves",
    tier: 3,
    baselineKey: "territory_own_pct",
    unit: "% moves",
    read: (s) => finite(styleGroup(s.style, "attacking").territory_own_pct),
  },
  {
    id: "forward_moves",
    name: "Forward Moves",
    tier: 3,
    baselineKey: "forward_move_pct",
    unit: "% moves",
    read: (s) => finite(styleGroup(s.style, "attacking").forward_move_pct),
  },
  {
    id: "backward_moves",
    name: "Backwards Moves",
    tier: 3,
    baselineKey: "backward_move_pct",
    unit: "% moves",
    read: (s) => finite(styleGroup(s.style, "attacking").backward_move_pct),
  },
  {
    id: "breaking_draws",
    name: "Breaking Draws",
    tier: 3,
    baselineKey: "drawishless_rate_pct",
    unit: "% games",
    read: (s) => finite(styleGroup(s.style, "creativity").drawishless_rate_pct),
  },
  {
    id: "declined_recaptures",
    name: "Declined Recaptures",
    tier: 3,
    baselineKey: "declined_recapture_rate_pct",
    unit: "% chances",
    read: (s) =>
      finite(styleGroup(s.style, "creativity").declined_recapture_rate_pct),
  },
  {
    id: "avg_time",
    name: "Average Think Time",
    tier: 3,
    baselineKey: "avg_time_per_move_s",
    unit: "sec/move",
    read: (s) => finite(s.style?.avg_time_per_move_s),
  },
  {
    id: "clock_diff",
    name: "Clock Difference",
    tier: 3,
    baselineKey: "avg_clock_diff_s",
    unit: "sec",
    read: (s) => finite(styleGroup(s.style, "durability").avg_clock_diff_s),
  },
  {
    id: "critical_time",
    name: "Time on Big Moments",
    tier: 3,
    baselineKey: "avg_critical_time_s",
    unit: "sec/move",
    read: (s) => finite(styleGroup(s.style, "creativity").avg_critical_time_s),
  },
  {
    id: "disadv_time",
    name: "Time When Losing",
    tier: 3,
    baselineKey: "avg_disadvantage_time_s",
    unit: "sec/move",
    read: (s) =>
      finite(styleGroup(s.style, "durability").avg_disadvantage_time_s),
  },
];

const FALLBACK_MEAN: Record<string, number> = {
  middlegame_accuracy_pct: 75,
  avg_blunders: 1.5,
  middlegame_mistake_avg: 2.5,
  middlegame_inaccuracy_avg: 4,
  middlegame_missed_opportunity_pct: 35,
  middlegame_missed_tactic_pct: 40,
  middlegame_allowed_tactic_pct: 25,
  endgame_conversion_rate_pct: 55,
  endgame_mate_conversion_pct: 60,
  endgame_stalemate_pct: 3,
  endgame_theoretical_saved_win_pct: 45,
  recovery_rate_pct: 35,
  opening_accuracy_pct: 80,
  endgame_blunder_avg: 0.8,
  endgame_beneficial_trade_pct: 50,
  endgame_simplification_trade_pct: 40,
  opening_tempo_waste_rate_pct: 15,
  middlegame_space_advantage_pct: 50,
  middlegame_outpost_control_avg: 1,
  middlegame_pawn_shield_pct: 70,
  middlegame_open_file_proximity_pct: 20,
  middlegame_king_attackers_score: 1.5,
  middlegame_safe_moves_pct: 70,
  middlegame_iqp_win_rate_pct: 50,
  middlegame_doubled_pawns_game_pct: 25,
  middlegame_backward_pawns_game_pct: 30,
  middlegame_pawn_islands_avg: 2.5,
  endgame_pawn_diff: 0,
  avg_eval_volatility_cp: 85,
  avg_sacrifice_moves: 0.3,
  early_flank_rate_pct: 25,
  avg_early_trades: 0.8,
  avg_higher_value_threats: 1.2,
  avg_threat_escapes: 1,
  avg_trades_near_enemy_king: 0.4,
  avg_trades_near_user_king: 0.4,
  territory_opp_pct: 45,
  territory_own_pct: 55,
  forward_move_pct: 40,
  backward_move_pct: 25,
  drawishless_rate_pct: 30,
  declined_recapture_rate_pct: 15,
  avg_time_per_move_s: 8.2,
  avg_clock_diff_s: 0,
  avg_critical_time_s: 11.2,
  avg_disadvantage_time_s: 7.5,
};

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function peerMean(
  metric: string,
  store: BaselineStore | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined
): number | null {
  const resolved = STYLE_BASELINE_METRIC[metric] ?? metric;
  const hit = lookupBaseline(store, resolved, band, speed);
  const mu = hit?.mean ?? FALLBACK_MEAN[metric] ?? FALLBACK_MEAN[resolved];
  if (mu == null || !Number.isFinite(mu)) return null;
  return mu;
}

function peerPercentile(
  value: number,
  metric: string,
  store: BaselineStore | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined
): number {
  const mu = peerMean(metric, store, band, speed);
  if (mu == null) return 50;
  const std = Math.max(Math.abs(mu) * 0.25, 0.5);
  const raw = sigmoid((value - mu) / std) * 100;
  return metricPolarity(metric) === "lower_better" ? 100 - raw : raw;
}

type RankedFactor = FactorItem & { impact: number };

export function selectPerformanceFactors(options: {
  style: StyleMetricsAggregate | null;
  opening: OpeningMetricsAggregate | null | undefined;
  middlegame: MiddlegameMetricsAggregate | null | undefined;
  endgame: EndgameMetricsAggregate | null | undefined;
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
  baselineWinRate: number;
}): FactorsPayload {
  const src: MetricSource = {
    style: options.style,
    opening: options.opening,
    middlegame: options.middlegame,
    endgame: options.endgame,
  };

  const driving: RankedFactor[] = [];
  const costing: RankedFactor[] = [];

  for (const def of IMPACT_METRICS) {
    const value = def.read(src);
    if (value == null) continue;
    const mean = peerMean(
      def.baselineKey,
      options.baselines,
      options.band,
      options.speed
    );
    const percentile = peerPercentile(
      value,
      def.baselineKey,
      options.baselines,
      options.band,
      options.speed
    );
    const signed = percentile - 50;
    const impact = Math.abs(signed) * TIER_WEIGHT[def.tier];
    const item: RankedFactor = {
      condition: def.name,
      win_rate: value,
      diff: Math.round(signed * 10) / 10,
      displayValue: formatMetricValue(value, def.unit),
      unit: def.unit,
      peerMean: mean,
      peerDisplayValue:
        mean != null ? formatMetricValue(mean, def.unit) : null,
      impact,
    };
    if (signed > 0) driving.push(item);
    else if (signed < 0) costing.push(item);
  }

  driving.sort((a, b) => b.impact - a.impact || b.diff - a.diff);
  costing.sort((a, b) => b.impact - a.impact || a.diff - b.diff);

  const toFactor = ({
    condition,
    win_rate,
    diff,
    displayValue,
    unit,
    peerMean: peerMeanVal,
    peerDisplayValue,
  }: RankedFactor): FactorItem => ({
    condition,
    win_rate,
    diff,
    displayValue,
    unit,
    peerMean: peerMeanVal,
    peerDisplayValue,
  });

  return {
    baseline_win_rate: options.baselineWinRate,
    driving: driving.slice(0, TOP_N).map(toFactor),
    costing: costing.slice(0, TOP_N).map(toFactor),
  };
}
