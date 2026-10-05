import type { BaselineStore } from "../data/baselines";
import { agentLog } from "../debug/agentLog";
import { lookupBaseline, STYLE_BASELINE_METRIC } from "../data/baselines";
import type { OpeningMixStats } from "./openingMix";
import type { StyleMetricsAggregate } from "./styleMetrics";

let archetypeCallCount = 0;

export type ArchetypeName =
  | "Technical"
  | "Positional"
  | "Attacking"
  | "Calculating"
  | "Tricky"
  | "Dynamic"
  | "Practical"
  | "Intuitive"
  | "Logical";

export type ArchetypeScore = {
  name: ArchetypeName;
  score: number;
};

export const ARCHETYPE_DESCRIPTIONS: Record<ArchetypeName, string> = {
  Technical:
    "You like control and structure. You often stick with familiar openings and prefer positions where you can improve your pieces gradually instead of rushing into complications. Your games tend to reward patience, planning, and clean technique.",
  Positional:
    "You like making the position work for you. You vary your openings but often steer toward structured positions where piece placement and long-term plans matter. You tend to look for small improvements rather than forcing the game immediately.",
  Attacking:
    "You like being the one who starts the action. You tend to look for initiative, active pieces, and chances to put your opponent under pressure. When the position becomes sharp, you're also more likely to invest extra time in finding the right move.",
  Calculating:
    "You like concrete answers. You often stay with familiar openings but are willing to spend time working through variations when the position demands it. Your style leans toward calculating what happens next rather than relying entirely on general plans.",
  Tricky:
    "You like making your opponent uncomfortable. You mix less predictable openings with sharp decisions and look for ways to create problems your opponent has to solve. You're especially willing to fight when you're worse or when one move could completely change the game.",
  Dynamic:
    "You like keeping the game alive. You combine familiar ideas with less standard choices and tend to create positions where plans can change quickly. You are comfortable with uncertainty and often keep fighting through complicated or difficult positions.",
  Practical:
    "You like choices that work. You don't feel tied to one opening or one type of position, and you tend to manage your time efficiently. Your style is flexible: you adapt to what the game gives you instead of forcing every game into the same shape.",
  Intuitive:
    "You trust your feel for the position. Your openings are flexible, and your decisions tend to favor active ideas, maneuvering, and practical judgment rather than following one fixed system. You also tend to manage your time consistently.",
  Logical:
    "You like finding a balanced plan. You vary your openings while combining patient maneuvering with moments of initiative. Your time usage tends to stay disciplined, suggesting a style built around making decisions systematically rather than rushing.",
};

type UserVector = Record<string, number>;

const ARCHETYPE_BENCHMARKS: Record<ArchetypeName, Record<string, number>> = {
  Technical: {
    same_openings: 1.0,
    orthodox: 1.0,
    maneuver_style: 1.0,
    disadvantage_time_quality: 0.0,
  },
  Positional: {
    same_openings: 0.0,
    orthodox: 1.0,
    maneuver_style: 1.0,
    disadvantage_time_quality: 0.0,
  },
  Attacking: {
    same_openings: 1.0,
    orthodox: 1.0,
    initiative_style: 1.0,
    critical_time_quality: 1.0,
  },
  Calculating: {
    same_openings: 1.0,
    orthodox: 1.0,
    overall_time_quality: 0.0,
  },
  Tricky: {
    same_openings: 0.0,
    orthodox: 0.0,
    initiative_style: 1.0,
    disadvantage_time_quality: 1.0,
    critical_time_quality: 1.0,
  },
  Dynamic: {
    same_openings: 1.0,
    orthodox: 0.0,
    initiative_style: 0.7,
    maneuver_style: 0.5,
    disadvantage_time_quality: 1.0,
    critical_time_quality: 1.0,
  },
  Practical: {
    same_openings: 0.0,
    orthodox: 1.0,
    overall_time_quality: 1.0,
  },
  Intuitive: {
    maneuver_style: 1.0,
    intuitive_style: 1.0,
    overall_time_quality: 1.0,
  },
  Logical: {
    same_openings: 0.0,
    orthodox: 1.0,
    maneuver_style: 0.6,
    initiative_style: 0.4,
    overall_time_quality: 1.0,
  },
};

const SECONDARY_INFLUENCE: Record<ArchetypeName, string[]> = {
  Technical: ["positioning", "defense"],
  Positional: ["positioning", "defense"],
  Attacking: ["creativity", "attacking"],
  Calculating: ["positioning", "defense"],
  Tricky: ["creativity", "attacking", "durability"],
  Dynamic: ["creativity", "attacking", "durability"],
  Practical: ["creativity", "positioning", "durability"],
  Intuitive: ["creativity", "positioning", "durability"],
  Logical: ["creativity", "positioning", "defense"],
};

const FALLBACK_BASELINES: Record<string, { mean: number; std: number }> = {
  avg_time_per_move_s: { mean: 8.2, std: 2.1 },
  avg_eval_volatility_cp: { mean: 85.0, std: 22.5 },
  avg_disadvantage_time_s: { mean: 7.5, std: 2.8 },
  avg_critical_time_s: { mean: 11.2, std: 4.0 },
  sacrifice_rate_pct: { mean: 1.0, std: 0.8 },
  same_opening_rate_pct: { mean: 35.0, std: 12.0 },
  orthodox_rate_pct: { mean: 55.0, std: 15.0 },
  early_flank_rate_pct: { mean: 25.0, std: 12.0 },
  endgame_conversion_rate_pct: { mean: 55.0, std: 15.0 },
  early_trade_rate_pct: { mean: 40.0, std: 12.0 },
  territory_opp_pct: { mean: 45.0, std: 10.0 },
  territory_own_pct: { mean: 55.0, std: 10.0 },
  forward_move_pct: { mean: 40.0, std: 8.0 },
  drawishless_rate_pct: { mean: 30.0, std: 12.0 },
  declined_recapture_rate_pct: { mean: 15.0, std: 8.0 },
  avg_higher_value_threats: { mean: 1.2, std: 0.6 },
  avg_threat_escapes: { mean: 1.0, std: 0.5 },
  avg_trades_near_enemy_king: { mean: 0.4, std: 0.3 },
  avg_trades_near_user_king: { mean: 0.4, std: 0.3 },
  recovery_rate_pct: { mean: 35.0, std: 12.0 },
  avg_clock_diff_s: { mean: 0.0, std: 5.0 },
  avg_blunders: { mean: 1.5, std: 1.0 },
  blunder_rate_pct: { mean: 5.0, std: 2.5 },
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function sigmoid(z: number): number {
  return 1.0 / (1.0 + Math.exp(-z));
}

function normalizeMetric(value: number, mean: number, std: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (!Number.isFinite(std) || std <= 0) return 0.5;
  return sigmoid((value - mean) / std);
}

function mean(vals: number[]): number {
  if (!vals.length) return 0.5;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function peerNorm(
  value: number | null | undefined,
  metric: string,
  store: BaselineStore | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined
): number {
  if (value == null || !Number.isFinite(value)) return 0.5;
  const resolved = STYLE_BASELINE_METRIC[metric] ?? metric;
  const hit = lookupBaseline(store, resolved, band, speed);
  const fallback =
    FALLBACK_BASELINES[metric] ?? FALLBACK_BASELINES[resolved];
  const mu = hit?.mean ?? fallback?.mean;
  if (mu == null || !Number.isFinite(mu)) return 0.5;
  const std = Math.max(
    Math.abs(mu) * 0.25,
    fallback?.std ?? 1,
    0.5
  );
  return normalizeMetric(value, mu, std);
}

const TRAIT_LOWER_BETTER = new Set([
  "avg_time_per_move_s",
  "avg_clock_diff_s",
  "avg_disadvantage_time_s",
  "avg_critical_time_s",
  "avg_eval_volatility_cp",
  "avg_blunders",
]);

function rawPeerPercentile(
  value: number | null | undefined,
  metric: string,
  store: BaselineStore | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined
): number {
  return peerNorm(value, metric, store, band, speed) * 100;
}

function peerPercentile(
  value: number | null | undefined,
  metric: string,
  store: BaselineStore | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined
): number {
  const pct = rawPeerPercentile(value, metric, store, band, speed);
  return TRAIT_LOWER_BETTER.has(metric) ? 100 - pct : pct;
}

function invertPercentile(pct: number): number {
  return 100 - pct;
}

export type StyleDimensionScore = {
  name: string;
  score: number;
  key: string;
};

type PeerContext = {
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
};

export function buildSecondaryGroups(
  style: StyleMetricsAggregate,
  mix: OpeningMixStats,
  peer: PeerContext
): Record<string, number> {
  const { baselines, band, speed } = peer;
  const initiative = style.initiative as Record<string, number | null>;
  const attacking = style.attacking as Record<string, number | null>;
  const creativity = style.creativity as Record<string, number | null>;
  const durability = style.durability as Record<string, number | null>;
  const pp = (
    value: number | null | undefined,
    metric: string
  ) => peerPercentile(value, metric, baselines, band, speed);

  const creativityG = mean([
    pp(creativity.drawishless_rate_pct, "drawishless_rate_pct"),
    pp(creativity.declined_recapture_rate_pct, "declined_recapture_rate_pct"),
    pp(creativity.avg_critical_time_s, "avg_critical_time_s"),
  ]);
  const attackingG = mean([
    pp(attacking.avg_higher_value_threats, "avg_higher_value_threats"),
    pp(attacking.avg_trades_near_enemy_king, "avg_trades_near_enemy_king"),
    pp(attacking.forward_move_pct, "forward_move_pct"),
    pp(attacking.territory_opp_pct, "territory_opp_pct"),
  ]);
  const positioningG = mean([
    pp(attacking.territory_own_pct, "territory_own_pct"),
    pp(initiative.early_trade_rate_pct, "early_trade_rate_pct"),
    pp(initiative.avg_eval_volatility_cp, "avg_eval_volatility_cp"),
    pp(mix.orthodox_rate_pct, "orthodox_rate_pct"),
  ]);
  const defenseG = mean([
    pp(attacking.avg_threat_escapes, "avg_threat_escapes"),
    pp(attacking.avg_trades_near_user_king, "avg_trades_near_user_king"),
    pp(durability.avg_blunders, "avg_blunders"),
  ]);
  const durabilityG = mean([
    pp(durability.recovery_rate_pct, "recovery_rate_pct"),
    pp(durability.avg_clock_diff_s, "avg_clock_diff_s"),
    pp(durability.avg_blunders, "avg_blunders"),
  ]);

  return {
    creativity: creativityG,
    attacking: attackingG,
    positioning: positioningG,
    defense: defenseG,
    durability: durabilityG,
  };
}

export function buildUserVector(options: {
  style: StyleMetricsAggregate;
  mix: OpeningMixStats;
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
  avgTimeFallback?: number | null;
}): UserVector {
  const { style, mix, baselines, band, speed } = options;
  const initiative = style.initiative as Record<string, number | null>;
  const attacking = style.attacking as Record<string, number | null>;
  const creativity = style.creativity as Record<string, number | null>;
  const durability = style.durability as Record<string, number | null>;
  const avgTime =
    style.avg_time_per_move_s ?? options.avgTimeFallback ?? null;
  const rp = (value: number | null | undefined, metric: string) =>
    rawPeerPercentile(value, metric, baselines, band, speed);

  const volP = rp(initiative.avg_eval_volatility_cp, "avg_eval_volatility_cp");
  const sacP = rp(initiative.sacrifice_rate_pct, "sacrifice_rate_pct");
  const flankP = rp(initiative.early_flank_rate_pct, "early_flank_rate_pct");
  const egP = rp(
    initiative.endgame_conversion_rate_pct,
    "endgame_conversion_rate_pct"
  );
  const tradeP = rp(initiative.early_trade_rate_pct, "early_trade_rate_pct");
  const tOppP = rp(attacking.territory_opp_pct, "territory_opp_pct");

  const maneuver_style = mean([
    invertPercentile(volP),
    invertPercentile(sacP),
    egP,
    tradeP,
  ]);
  const initiative_style = 0.35 * volP + 0.5 * sacP + 0.15 * flankP;
  const intuitive_style =
    0.35 * volP + 0.25 * sacP + 0.3 * tOppP + 0.1 * flankP;

  const overall_time_quality = invertPercentile(
    rp(avgTime, "avg_time_per_move_s")
  );
  const critical_time_quality = invertPercentile(
    rp(creativity.avg_critical_time_s, "avg_critical_time_s")
  );
  const disadvantage_time_quality = invertPercentile(
    rp(durability.avg_disadvantage_time_s, "avg_disadvantage_time_s")
  );

  return {
    same_openings:
      mix.same_opening_rate_pct != null &&
      Number.isFinite(mix.same_opening_rate_pct)
        ? mix.same_opening_rate_pct
        : 50,
    orthodox:
      mix.orthodox_rate_pct != null && Number.isFinite(mix.orthodox_rate_pct)
        ? mix.orthodox_rate_pct
        : 50,
    maneuver_style,
    initiative_style,
    intuitive_style,
    overall_time_quality,
    critical_time_quality,
    disadvantage_time_quality,
  };
}

function scoreOne(
  userVector: UserVector,
  benchmark: Record<string, number>,
  groups: Record<string, number>,
  secondaryKeys: string[]
): number {
  const parts: number[] = [];
  const directional: number[] = [];

  for (const key of Object.keys(benchmark)) {
    const pct = Number.isFinite(userVector[key]) ? userVector[key] : 50;
    const target = benchmark[key] * 100;
    parts.push(Math.max(0, 100 - Math.abs(pct - target)));
    directional.push(benchmark[key] >= 0.5 ? pct : 100 - pct);
  }
  for (const key of secondaryKeys) {
    const pct = groups[key] ?? 50;
    parts.push(pct);
    directional.push(pct);
  }

  const k = parts.length;
  if (!k) return 50;
  const base = mean(parts);
  let hits = 0;
  for (const d of directional) {
    if (d >= 90) hits += 1;
  }
  const bonus = hits * (12 / k);
  return Math.round(Math.min(100, Math.max(0, base + bonus)) * 10) / 10;
}

export const PRIMARY_FEATURE_LABELS: { key: string; name: string }[] = [
  { key: "same_openings", name: "Same Openings" },
  { key: "orthodox", name: "Orthodox" },
  { key: "maneuver_style", name: "Maneuver" },
  { key: "initiative_style", name: "Initiative" },
  { key: "intuitive_style", name: "Intuitive" },
  { key: "overall_time_quality", name: "Time Quality" },
  { key: "critical_time_quality", name: "Critical Time" },
  { key: "disadvantage_time_quality", name: "Disadvantage Time" },
];

export type PrimaryFeatureScore = {
  key: string;
  name: string;
  score: number;
};

export function computePrimaryFeatureScores(options: {
  style: StyleMetricsAggregate;
  mix: OpeningMixStats;
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
  avgTimeFallback?: number | null;
}): PrimaryFeatureScore[] {
  const userVector = buildUserVector(options);
  return PRIMARY_FEATURE_LABELS.map(({ key, name }) => ({
    key,
    name,
    score: Math.round((userVector[key] ?? 50) * 10) / 10,
  }));
}

const DIMENSION_LABELS: { key: string; name: string }[] = [
  { key: "attacking", name: "Attacking" },
  { key: "defense", name: "Defense" },
  { key: "creativity", name: "Creativity" },
  { key: "positioning", name: "Positioning" },
  { key: "durability", name: "Durability" },
  { key: "maneuver_style", name: "Maneuver" },
  { key: "initiative_style", name: "Initiative" },
  { key: "intuitive_style", name: "Intuitive" },
  { key: "overall_time_quality", name: "Time Quality" },
  { key: "critical_time_quality", name: "Critical Time" },
  { key: "disadvantage_time_quality", name: "Disadvantage Time" },
  { key: "same_openings", name: "Same Openings" },
  { key: "orthodox", name: "Orthodox" },
];

const PRIMARY_KEYS = new Set(PRIMARY_FEATURE_LABELS.map((x) => x.key));

export function computeStyleDimensionScores(options: {
  style: StyleMetricsAggregate;
  mix: OpeningMixStats;
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
  avgTimeFallback?: number | null;
}): StyleDimensionScore[] {
  archetypeCallCount += 1;
  const t0 = performance.now();
  const userVector = buildUserVector(options);
  const groups = buildSecondaryGroups(options.style, options.mix, {
    baselines: options.baselines,
    band: options.band,
    speed: options.speed,
  });
  const merged: Record<string, number> = { ...groups };
  for (const [key, val] of Object.entries(userVector)) {
    merged[key] = Number.isFinite(val) ? val : 50;
  }
  const result = DIMENSION_LABELS.map(({ key, name }) => ({
    key,
    name,
    score: Math.round((merged[key] ?? 50) * 10) / 10,
  }));
  const totalMs = performance.now() - t0;
  agentLog("H-traits", "archetypeScores:computeStyleDimensionScores", "computed style dimensions", {
    callCount: archetypeCallCount,
    styleGames: options.style.games,
    dimCount: result.length,
    totalMs: Math.round(totalMs * 1000) / 1000,
    scores: Object.fromEntries(result.map((r) => [r.key, r.score])),
    primaryKeys: [...PRIMARY_KEYS],
  });
  return result;
}

export type StyleRadarAxis = {
  key: string;
  name: string;
  score: number;
};

const RADAR_TIER_WEIGHT = { 1: 3, 2: 2, 3: 1 } as const;

type RadarMetricInput = {
  value: number | null | undefined;
  metric: string;
  tier: 1 | 2 | 3;
};

function weightedRadarScore(
  inputs: RadarMetricInput[],
  store: BaselineStore | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined
): number {
  if (!inputs.length) return 50;
  let weighted = 0;
  let weightSum = 0;
  for (const input of inputs) {
    const w = RADAR_TIER_WEIGHT[input.tier];
    weighted += w * peerPercentile(input.value, input.metric, store, band, speed);
    weightSum += w;
  }
  if (weightSum <= 0) return 50;
  return Math.round((weighted / weightSum) * 10) / 10;
}

const RADAR_AXIS_DEFS: {
  key: string;
  name: string;
  metrics: (ctx: {
    style: StyleMetricsAggregate;
    mix: OpeningMixStats;
    avgTime: number | null;
  }) => RadarMetricInput[];
}[] = [
  {
    key: "positioning",
    name: "Positional",
    metrics: ({ style, mix }) => {
      const initiative = style.initiative as Record<string, number | null>;
      const attacking = style.attacking as Record<string, number | null>;
      return [
        {
          value: initiative.avg_eval_volatility_cp,
          metric: "avg_eval_volatility_cp",
          tier: 1,
        },
        {
          value: attacking.territory_own_pct,
          metric: "territory_own_pct",
          tier: 2,
        },
        {
          value: initiative.early_trade_rate_pct,
          metric: "early_trade_rate_pct",
          tier: 3,
        },
        {
          value: mix.orthodox_rate_pct,
          metric: "orthodox_rate_pct",
          tier: 3,
        },
      ];
    },
  },
  {
    key: "durability",
    name: "Durability",
    metrics: ({ style }) => {
      const durability = style.durability as Record<string, number | null>;
      return [
        {
          value: durability.recovery_rate_pct,
          metric: "recovery_rate_pct",
          tier: 1,
        },
        {
          value: durability.avg_blunders,
          metric: "avg_blunders",
          tier: 2,
        },
        {
          value: durability.avg_clock_diff_s,
          metric: "avg_clock_diff_s",
          tier: 3,
        },
      ];
    },
  },
  {
    key: "creativity",
    name: "Creativity",
    metrics: ({ style }) => {
      const creativity = style.creativity as Record<string, number | null>;
      return [
        {
          value: creativity.declined_recapture_rate_pct,
          metric: "declined_recapture_rate_pct",
          tier: 1,
        },
        {
          value: creativity.drawishless_rate_pct,
          metric: "drawishless_rate_pct",
          tier: 2,
        },
        {
          value: creativity.avg_critical_time_s,
          metric: "avg_critical_time_s",
          tier: 3,
        },
      ];
    },
  },
  {
    key: "defense",
    name: "Defending",
    metrics: ({ style }) => {
      const attacking = style.attacking as Record<string, number | null>;
      const durability = style.durability as Record<string, number | null>;
      return [
        {
          value: durability.avg_blunders,
          metric: "avg_blunders",
          tier: 1,
        },
        {
          value: attacking.avg_threat_escapes,
          metric: "avg_threat_escapes",
          tier: 2,
        },
        {
          value: attacking.avg_trades_near_user_king,
          metric: "avg_trades_near_user_king",
          tier: 3,
        },
      ];
    },
  },
  {
    key: "attacking",
    name: "Attacking",
    metrics: ({ style }) => {
      const attacking = style.attacking as Record<string, number | null>;
      return [
        {
          value: attacking.avg_higher_value_threats,
          metric: "avg_higher_value_threats",
          tier: 1,
        },
        {
          value: attacking.forward_move_pct,
          metric: "forward_move_pct",
          tier: 1,
        },
        {
          value: attacking.territory_opp_pct,
          metric: "territory_opp_pct",
          tier: 2,
        },
        {
          value: attacking.avg_trades_near_enemy_king,
          metric: "avg_trades_near_enemy_king",
          tier: 3,
        },
      ];
    },
  },
  {
    key: "time_usage",
    name: "Time Usage",
    metrics: ({ style, avgTime }) => {
      const creativity = style.creativity as Record<string, number | null>;
      const durability = style.durability as Record<string, number | null>;
      return [
        {
          value: avgTime,
          metric: "avg_time_per_move_s",
          tier: 1,
        },
        {
          value: durability.avg_disadvantage_time_s,
          metric: "avg_disadvantage_time_s",
          tier: 2,
        },
        {
          value: creativity.avg_critical_time_s,
          metric: "avg_critical_time_s",
          tier: 3,
        },
      ];
    },
  },
];

export function computeStyleRadarAxes(options: {
  style: StyleMetricsAggregate;
  mix: OpeningMixStats;
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
  avgTimeFallback?: number | null;
}): StyleRadarAxis[] {
  const avgTime =
    options.style.avg_time_per_move_s ?? options.avgTimeFallback ?? null;
  const ctx = {
    style: options.style,
    mix: options.mix,
    avgTime,
  };
  return RADAR_AXIS_DEFS.map(({ key, name, metrics }) => ({
    key,
    name,
    score: weightedRadarScore(
      metrics(ctx),
      options.baselines,
      options.band,
      options.speed
    ),
  }));
}

export function computeArchetypeScores(options: {
  style: StyleMetricsAggregate;
  mix: OpeningMixStats;
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
  avgTimeFallback?: number | null;
}): ArchetypeScore[] {
  const userVector = buildUserVector(options);
  const groups = buildSecondaryGroups(options.style, options.mix, {
    baselines: options.baselines,
    band: options.band,
    speed: options.speed,
  });
  const names = Object.keys(ARCHETYPE_BENCHMARKS) as ArchetypeName[];
  return names
    .map((name) => ({
      name,
      score: scoreOne(
        userVector,
        ARCHETYPE_BENCHMARKS[name],
        groups,
        SECONDARY_INFLUENCE[name] || []
      ),
    }))
    .sort((a, b) => b.score - a.score);
}
