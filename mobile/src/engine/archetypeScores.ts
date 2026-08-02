import Constants from "expo-constants";
import type { BaselineStore } from "../data/baselines";
import { lookupBaseline } from "../data/baselines";
import type { OpeningMixStats } from "./openingMix";
import type { StyleMetricsAggregate } from "./styleMetrics";

let archetypeCallCount = 0;

function debugArchetypeLog(
  message: string,
  data: Record<string, unknown>
) {
  // #region agent log
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0] || "127.0.0.1";
  fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6d2375",
    },
    body: JSON.stringify({
      sessionId: "6d2375",
      runId: "traits-timing",
      hypothesisId: "H-traits",
      location: "archetypeScores.ts",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  console.log(`[traits] ${message}`, data);
  // #endregion
}

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
    "You stick to familiar orthodox openings and prefer slow maneuvering over sharp complications. Clock use often slips when the position turns against you.",
  Positional:
    "You vary openings within mainstream systems and steer games toward structure and maneuver. Critical defense under pressure is the weaker side of the profile.",
  Attacking:
    "You favor known orthodox lines and push for initiative. You tend to spend your thinking time well when the position is on a knife edge.",
  Calculating:
    "You stay loyal to familiar orthodox openings and invest heavily on the clock, working through concrete lines more than instinct.",
  Tricky:
    "You mix less standard openings with sharp, initiative-seeking play. You focus hard both when you are worse and when a single move can swing the game.",
  Dynamic:
    "You keep a familiar repertoire but lean unorthodox, blending initiative with maneuver. Tough and critical moments get real attention on the clock.",
  Practical:
    "You switch openings inside the mainstream and manage time efficiently. The style stays flexible rather than locked to one plan.",
  Intuitive:
    "Openings stay flexible while the board play leans on feel and maneuver. Overall clock habits stay strong across quiet and tense positions.",
  Logical:
    "You vary orthodox openings and balance maneuver with bursts of initiative. Time usage stays disciplined across the game.",
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
  sacrifice_rate_pct: { mean: 15.0, std: 8.0 },
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

function pct01(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0.5;
  return clamp01(n / 100);
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
  const hit = lookupBaseline(store, metric, band, speed);
  const fallback = FALLBACK_BASELINES[metric];
  const mu = hit?.mean ?? fallback?.mean;
  if (mu == null || !Number.isFinite(mu)) return 0.5;
  const std = Math.max(
    Math.abs(mu) * 0.25,
    fallback?.std ?? 1,
    0.5
  );
  return normalizeMetric(value, mu, std);
}

function relativeFocusQuality(
  special: number | null | undefined,
  avg: number | null | undefined
): number {
  if (
    special == null ||
    avg == null ||
    !Number.isFinite(special) ||
    !Number.isFinite(avg) ||
    avg <= 0
  ) {
    return 0.5;
  }
  return sigmoid((special / avg - 1) / 0.35);
}

export type StyleDimensionScore = {
  name: string;
  score: number;
  key: string;
};

export function buildSecondaryGroups(
  style: StyleMetricsAggregate,
  mix: OpeningMixStats
): Record<string, number> {
  const initiative = style.initiative as Record<string, number | null>;
  const attacking = style.attacking as Record<string, number | null>;
  const creativity = style.creativity as Record<string, number | null>;
  const durability = style.durability as Record<string, number | null>;

  const creativityG = mean([
    pct01(creativity.drawishless_rate_pct),
    pct01(creativity.declined_recapture_rate_pct),
    relativeFocusQuality(
      creativity.avg_critical_time_s,
      style.avg_time_per_move_s
    ),
  ]);
  const attackingG = mean([
    clamp01((attacking.avg_higher_value_threats ?? 0) / 3),
    clamp01((attacking.avg_trades_near_enemy_king ?? 0) / 2),
    pct01(attacking.forward_move_pct),
    pct01(attacking.territory_opp_pct),
  ]);
  const positioningG = mean([
    pct01(attacking.territory_own_pct),
    pct01(initiative.early_trade_rate_pct),
    1 - pct01(initiative.avg_eval_volatility_cp),
    pct01(mix.orthodox_rate_pct),
  ]);
  const defenseG = mean([
    clamp01((attacking.avg_threat_escapes ?? 0) / 3),
    clamp01((attacking.avg_trades_near_user_king ?? 0) / 2),
    1 - pct01(durability.blunder_rate_pct),
  ]);
  const durabilityG = mean([
    pct01(durability.recovery_rate_pct),
    durability.avg_clock_diff_s == null
      ? 0.5
      : clamp01(0.5 + durability.avg_clock_diff_s / 20),
    1 - pct01(durability.blunder_rate_pct),
  ]);

  return {
    creativity: creativityG,
    attacking: attackingG,
    positioning: positioningG,
    defense: defenseG,
    durability: durabilityG,
  };
}

function archetypeSecondaryMod(
  name: ArchetypeName,
  groups: Record<string, number>
): number {
  const keys = SECONDARY_INFLUENCE[name] || [];
  if (!keys.length) return 0;
  return mean(keys.map((k) => groups[k] ?? 0.5));
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

  const volN = peerNorm(
    initiative.avg_eval_volatility_cp,
    "avg_eval_volatility_cp",
    baselines,
    band,
    speed
  );
  const sacN = peerNorm(
    initiative.sacrifice_rate_pct,
    "sacrifice_rate_pct",
    baselines,
    band,
    speed
  );
  const flank = pct01(initiative.early_flank_rate_pct);
  const eg = pct01(initiative.endgame_conversion_rate_pct);
  const trade = pct01(initiative.early_trade_rate_pct);
  const tOpp = pct01(attacking.territory_opp_pct);

  const maneuver_style = mean([1 - volN, 1 - sacN, eg, trade]);
  const initiative_style = mean([volN, sacN, flank]);
  const intuitive_style = clamp01(
    0.3 * volN + 0.25 * sacN + 0.25 * tOpp + 0.2 * flank
  );

  const timeSlowN = peerNorm(
    avgTime,
    "avg_time_per_move_s",
    baselines,
    band,
    speed
  );
  const overall_time_quality = clamp01(1 - timeSlowN);

  const critical_time_quality = relativeFocusQuality(
    creativity.avg_critical_time_s,
    avgTime
  );
  const disadvantage_time_quality = relativeFocusQuality(
    durability.avg_disadvantage_time_s,
    avgTime
  );

  return {
    same_openings: pct01(mix.same_opening_rate_pct),
    orthodox: pct01(mix.orthodox_rate_pct),
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
  secondaryMod: number
): number {
  const keys = Object.keys(benchmark);
  const p = keys.map((k) => userVector[k] ?? 0.5);
  const t = keys.map((k) => benchmark[k]);
  let dot = 0;
  let normP = 0;
  let normT = 0;
  let euc = 0;
  for (let i = 0; i < keys.length; i += 1) {
    dot += p[i] * t[i];
    normP += p[i] * p[i];
    normT += t[i] * t[i];
    const d = p[i] - t[i];
    euc += d * d;
  }
  const cos =
    normP > 0 && normT > 0 ? dot / (Math.sqrt(normP) * Math.sqrt(normT)) : 0;
  const eucClose = Math.max(0, 1 - Math.sqrt(euc) / Math.sqrt(keys.length));
  const matchPct = (0.6 * cos + 0.4 * eucClose) * 100;
  const mod = secondaryMod * 10;
  return Math.round(Math.min(100, Math.max(0, matchPct + mod)) * 10) / 10;
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
  const groups = buildSecondaryGroups(options.style, options.mix);
  const merged: Record<string, number> = { ...groups, ...userVector };
  const result = DIMENSION_LABELS.map(({ key, name }) => ({
    key,
    name,
    score: Math.round(clamp01(merged[key] ?? 0.5) * 1000) / 10,
  }));
  const totalMs = performance.now() - t0;
  debugArchetypeLog("computeStyleDimensionScores", {
    callCount: archetypeCallCount,
    styleGames: options.style.games,
    dimCount: result.length,
    totalMs: Math.round(totalMs * 1000) / 1000,
    scores: Object.fromEntries(result.map((r) => [r.key, r.score])),
  });
  return result;
}

export type StyleRadarAxis = {
  key: string;
  name: string;
  score: number;
};

const RADAR_AXES: { key: string; name: string }[] = [
  { key: "positioning", name: "Positional" },
  { key: "durability", name: "Durability" },
  { key: "creativity", name: "Creativity" },
  { key: "defense", name: "Defending" },
  { key: "time_usage", name: "Time Usage" },
  { key: "attacking", name: "Attacking" },
];

export function computeStyleRadarAxes(options: {
  style: StyleMetricsAggregate;
  mix: OpeningMixStats;
  baselines: BaselineStore | null;
  band: string | null;
  speed: string | null;
  avgTimeFallback?: number | null;
}): StyleRadarAxis[] {
  const userVector = buildUserVector(options);
  const groups = buildSecondaryGroups(options.style, options.mix);
  const timeUsage = mean([
    userVector.overall_time_quality,
    userVector.critical_time_quality,
    userVector.disadvantage_time_quality,
  ]);
  const values: Record<string, number> = {
    ...groups,
    time_usage: timeUsage,
  };
  return RADAR_AXES.map(({ key, name }) => ({
    key,
    name,
    score: Math.round(clamp01(values[key] ?? 0.5) * 1000) / 10,
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
  const groups = buildSecondaryGroups(options.style, options.mix);
  const names = Object.keys(ARCHETYPE_BENCHMARKS) as ArchetypeName[];
  return names
    .map((name) => ({
      name,
      score: scoreOne(
        userVector,
        ARCHETYPE_BENCHMARKS[name],
        archetypeSecondaryMod(name, groups)
      ),
    }))
    .sort((a, b) => b.score - a.score);
}
