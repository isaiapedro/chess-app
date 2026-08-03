import { fetchBaselines, type BaselinesResponse } from "../api/client";
import {
  PERMANENT_CACHE_TTL_MS,
  readCache,
  takeInflight,
  writeCache,
} from "../storage/cache";

export type BaselineMetricHit = {
  mean: number | null;
  n: number;
  sample?: string | null;
  source_month?: string | null;
  p10?: number | null;
  p25?: number | null;
  p50?: number | null;
  p75?: number | null;
  p90?: number | null;
};

export type BaselineRow = {
  metric: string;
  rating_band: string;
  speed: string;
  mean: number | null;
  n: number;
  source_month?: string | null;
  sample?: string | null;
  p10?: number | null;
  p25?: number | null;
  p50?: number | null;
  p75?: number | null;
  p90?: number | null;
};

export type BaselineStore = {
  available: boolean;
  source_month: string | null;
  bands: string[];
  speeds: string[];
  rows: BaselineRow[];
  by_cell: Record<string, Record<string, BaselineMetricHit>>;
};

export const RATING_BANDS: Array<[number, number, string]> = [
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

export const SPEEDS = ["bullet", "blitz", "rapid", "classical"] as const;

export type Speed = (typeof SPEEDS)[number];

/** Style-of-play / Insights metric key → baseline metric key */
export const STYLE_BASELINE_METRIC: Record<string, string> = {
  avg_time_per_move_s: "avg_time_per_move_s",
  avg_clock_diff_s: "avg_clock_diff_s",
  avg_disadvantage_time_s: "avg_disadvantage_time_s",
  avg_critical_time_s: "avg_critical_time_s",
  same_opening_rate_pct: "same_opening_rate",
  different_opening_rate_pct: "different_opening_rate",
  orthodox_rate_pct: "orthodox_rate",
  unorthodox_rate_pct: "unorthodox_rate",
  avg_eval_volatility_cp: "avg_eval_volatility_cp",
  avg_sacrifice_moves: "avg_sacrifice_moves",
  sacrifice_rate_pct: "sacrifice_rate_pct",
  early_flank_rate_pct: "early_flank_rate_pct",
  avg_early_flank_pushes: "avg_early_flank_pushes",
  endgame_conversion_rate_pct: "endgame_conversion_rate_pct",
  early_trade_rate_pct: "early_trade_rate_pct",
  avg_early_trades: "avg_early_trades",
  avg_higher_value_threats: "avg_higher_value_threats",
  avg_threat_escapes: "avg_threat_escapes",
  avg_trades_near_enemy_king: "avg_trades_near_enemy_king",
  avg_trades_near_user_king: "avg_trades_near_user_king",
  territory_opp_pct: "territory_opp_pct",
  territory_own_pct: "territory_own_pct",
  forward_move_pct: "forward_move_pct",
  backward_move_pct: "backward_move_pct",
  drawishless_rate_pct: "drawishless_rate_pct",
  declined_recapture_rate_pct: "declined_recapture_rate_pct",
  recovery_rate_pct: "recovery_rate_pct",
  avg_blunders: "avg_blunders",
  win_rate: "win_rate",
  est_seconds_per_game: "est_seconds_per_game",
  avg_games_per_player_month: "avg_games_per_player_month",
  avg_games_per_player_week: "avg_games_per_player_week",
  avg_games_per_player_day: "avg_games_per_player_day",
  avg_est_seconds_per_player_month: "avg_est_seconds_per_player_month",
  avg_est_seconds_per_player_week: "avg_est_seconds_per_player_week",
  avg_est_seconds_per_player_day: "avg_est_seconds_per_player_day",
  opening_accuracy_pct: "opening_accuracy_pct",
  opening_minors_developed_by_10: "opening_minors_developed_by_10",
  opening_center_control_pct: "opening_center_control_pct",
  opening_castle_fullmove: "opening_castle_fullmove",
  opening_uncastled_rate_pct: "opening_uncastled_rate_pct",
  opening_tempo_waste_rate_pct: "opening_tempo_waste_rate_pct",
  middlegame_accuracy_pct: "middlegame_accuracy_pct",
  middlegame_blunder_avg: "middlegame_blunder_avg",
  middlegame_missed_opportunity_pct: "middlegame_missed_opportunity_pct",
  middlegame_missed_tactic_pct: "middlegame_missed_tactic_pct",
  middlegame_allowed_tactic_pct: "middlegame_allowed_tactic_pct",
  middlegame_king_attackers_score: "middlegame_king_attackers_score",
  middlegame_pawn_shield_pct: "middlegame_pawn_shield_pct",
  middlegame_open_file_proximity_pct: "middlegame_open_file_proximity_pct",
  middlegame_safe_moves_pct: "middlegame_safe_moves_pct",
  middlegame_outpost_control_avg: "middlegame_outpost_control_avg",
  middlegame_space_advantage_pct: "middlegame_space_advantage_pct",
  middlegame_iqp_win_rate_pct: "middlegame_iqp_win_rate_pct",
  middlegame_doubled_pawns_game_pct: "middlegame_doubled_pawns_game_pct",
  middlegame_backward_pawns_game_pct: "middlegame_backward_pawns_game_pct",
  middlegame_pawn_islands_avg: "middlegame_pawn_islands_avg",
  endgame_blunder_avg: "endgame_blunder_avg",
  endgame_theoretical_saved_win_pct: "endgame_theoretical_saved_win_pct",
  endgame_theoretical_saved_draw_pct: "endgame_theoretical_saved_draw_pct",
  endgame_king_centralization: "endgame_king_centralization",
  endgame_king_distance: "endgame_king_distance",
  endgame_pawn_diff: "endgame_pawn_diff",
  endgame_beneficial_trade_pct: "endgame_beneficial_trade_pct",
  endgame_simplification_trade_pct: "endgame_simplification_trade_pct",
  endgame_mate_conversion_pct: "endgame_mate_conversion_pct",
  endgame_stalemate_pct: "endgame_stalemate_pct",
  endgame_mate_avg_seconds: "endgame_mate_avg_seconds",
  te_pawn_endings_win_rate_pct: "te_pawn_endings_win_rate_pct",
  te_queen_vs_pawn_win_rate_pct: "te_queen_vs_pawn_win_rate_pct",
  te_rook_vs_pawn_win_rate_pct: "te_rook_vs_pawn_win_rate_pct",
  te_bishop_pawn_vs_knight_win_rate_pct: "te_bishop_pawn_vs_knight_win_rate_pct",
  te_opp_bishop_two_pawns_win_rate_pct: "te_opp_bishop_two_pawns_win_rate_pct",
  te_pawn_vs_knight_win_rate_pct: "te_pawn_vs_knight_win_rate_pct",
  te_two_pawns_vs_rook_win_rate_pct: "te_two_pawns_vs_rook_win_rate_pct",
  te_knight_pawn_vs_bishop_win_rate_pct: "te_knight_pawn_vs_bishop_win_rate_pct",
  te_rook_pawn_vs_rook_win_rate_pct: "te_rook_pawn_vs_rook_win_rate_pct",
  te_pawn_endings_draw_rate_pct: "te_pawn_endings_draw_rate_pct",
  te_queen_vs_pawn_draw_rate_pct: "te_queen_vs_pawn_draw_rate_pct",
  te_rook_vs_pawn_draw_rate_pct: "te_rook_vs_pawn_draw_rate_pct",
  te_bishop_pawn_vs_knight_draw_rate_pct:
    "te_bishop_pawn_vs_knight_draw_rate_pct",
  te_opp_bishop_two_pawns_draw_rate_pct: "te_opp_bishop_two_pawns_draw_rate_pct",
  te_pawn_vs_knight_draw_rate_pct: "te_pawn_vs_knight_draw_rate_pct",
  te_two_pawns_vs_rook_draw_rate_pct: "te_two_pawns_vs_rook_draw_rate_pct",
  te_knight_pawn_vs_bishop_draw_rate_pct:
    "te_knight_pawn_vs_bishop_draw_rate_pct",
  te_rook_pawn_vs_rook_draw_rate_pct: "te_rook_pawn_vs_rook_draw_rate_pct",
};

export const ACTIVITY_BASELINE_METRICS = [
  "avg_games_per_player_month",
  "avg_games_per_player_week",
  "avg_games_per_player_day",
  "avg_est_seconds_per_player_month",
  "avg_est_seconds_per_player_week",
  "avg_est_seconds_per_player_day",
] as const;

const BASELINES_CACHE_KEY = "baselines:store:v1";

let bundledRows: BaselineRow[] | null = null;
let cachedStore: BaselineStore | null = null;

function storeFromPayload(payload: BaselinesResponse): BaselineStore | null {
  if (!payload?.meta?.available || !Array.isArray(payload.rows)) return null;
  if (payload.by_cell && Object.keys(payload.by_cell).length) {
    return {
      available: true,
      source_month: payload.meta.source_month ?? null,
      bands: payload.bands || [],
      speeds: payload.speeds || [],
      rows: payload.rows as BaselineRow[],
      by_cell: payload.by_cell as BaselineStore["by_cell"],
    };
  }
  return indexRows(payload.rows as BaselineRow[]);
}

function loadBundledRows(): BaselineRow[] {
  if (bundledRows) return bundledRows;
  try {
    const raw = require("../../assets/baselines/opening_mix_lichess_v1.json") as BaselineRow[];
    bundledRows = Array.isArray(raw) ? raw : [];
  } catch {
    bundledRows = [];
  }
  return bundledRows;
}

function indexRows(rows: BaselineRow[]): BaselineStore {
  const by_cell: Record<string, Record<string, BaselineMetricHit>> = {};
  const bands = new Set<string>();
  const speeds = new Set<string>();
  let source_month: string | null = null;
  for (const row of rows) {
    if (!row?.metric || !row?.rating_band || !row?.speed) continue;
    bands.add(row.rating_band);
    speeds.add(row.speed);
    if (!source_month && row.source_month) {
      source_month = String(row.source_month);
    }
    const cell = `${row.rating_band}|${row.speed}`;
    const bucket = by_cell[cell] || (by_cell[cell] = {});
    bucket[row.metric] = {
      mean:
        row.mean == null || !Number.isFinite(Number(row.mean))
          ? null
          : Number(row.mean),
      n: Number(row.n) || 0,
      sample: row.sample ?? null,
      source_month: row.source_month ?? null,
      p10: row.p10 ?? null,
      p25: row.p25 ?? null,
      p50: row.p50 ?? null,
      p75: row.p75 ?? null,
      p90: row.p90 ?? null,
    };
  }
  return {
    available: rows.length > 0,
    source_month,
    bands: [...bands],
    speeds: [...speeds],
    rows,
    by_cell,
  };
}

export function ratingBand(rating: number | null | undefined): string | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  const r = Math.floor(rating);
  if (r < 800) return null;
  for (const [lo, hi, label] of RATING_BANDS) {
    if (r >= lo && r <= hi) return label;
  }
  return null;
}

export function timeControlToSpeed(
  tc: string | null | undefined
): Speed | null {
  if (!tc || tc === "-") return null;
  const parts = String(tc).split("+");
  const base = Number(parts[0]);
  const inc = parts.length > 1 ? Number(parts[1]) : 0;
  if (!Number.isFinite(base) || !Number.isFinite(inc)) return null;
  const total = base + 40 * inc;
  if (total < 180) return "bullet";
  if (total < 480) return "blitz";
  if (total < 1500) return "rapid";
  return "classical";
}

export function normalizeSpeed(
  speed: string | null | undefined
): Speed | null {
  if (!speed) return null;
  const s = String(speed).toLowerCase();
  if ((SPEEDS as readonly string[]).includes(s)) return s as Speed;
  return null;
}

export function cellKey(band: string, speed: string): string {
  return `${band}|${speed}`;
}

export function lookupBaseline(
  store: BaselineStore | null | undefined,
  metric: string,
  band: string | null | undefined,
  speed: string | null | undefined
): BaselineMetricHit | null {
  if (!store?.available || !band || !speed || !metric) return null;
  const hit = store.by_cell[cellKey(band, speed)]?.[metric];
  return hit ?? null;
}

export function formatPeerDelta(
  userVal: number | null | undefined,
  mean: number | null | undefined
): string {
  if (userVal == null || mean == null) return "";
  if (!Number.isFinite(userVal) || !Number.isFinite(mean)) return "";
  const delta = userVal - mean;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}`;
}

/** Approx share of peers below `userVal` from stored percentile breakpoints. */
export function approxPercentileRank(
  userVal: number,
  hit: BaselineMetricHit | null | undefined
): number | null {
  if (!hit || !Number.isFinite(userVal)) return null;
  const points = (
    [
      [10, hit.p10],
      [25, hit.p25],
      [50, hit.p50 ?? hit.mean],
      [75, hit.p75],
      [90, hit.p90],
    ] as Array<[number, number | null | undefined]>
  )
    .filter(([, v]) => v != null && Number.isFinite(Number(v)))
    .map(([p, v]) => ({ p, v: Number(v) }));

  if (points.length >= 2) {
    if (userVal <= points[0].v) {
      return Math.max(1, Math.min(points[0].p, 99));
    }
    const last = points[points.length - 1];
    if (userVal >= last.v) {
      return Math.max(1, Math.min(99, last.p));
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (userVal >= a.v && userVal <= b.v) {
        const span = b.v - a.v || 1;
        const t = (userVal - a.v) / span;
        return Math.max(
          1,
          Math.min(99, Math.round(a.p + t * (b.p - a.p)))
        );
      }
    }
  }

  if (hit.mean == null) return null;
  if (userVal >= hit.mean) return 60;
  return 40;
}

export function peerWinRateCaption(
  store: BaselineStore | null | undefined,
  userWinRate: number | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined
): string | null {
  if (userWinRate == null || !Number.isFinite(userWinRate)) return null;
  const hit = lookupBaseline(store, "win_rate", band, speed);
  if (!hit || hit.mean == null) return null;
  const rank = approxPercentileRank(userWinRate, hit);
  if (rank != null) {
    return `More than ${rank}% of players`;
  }
  const delta = formatPeerDelta(userWinRate, hit.mean);
  return `Peers ${hit.mean}% · Δ ${delta}%`;
}

export type ActivityPeriod = "day" | "week" | "month";

export function activityBucketForPeriod(
  period: string | null | undefined
): ActivityPeriod {
  if (period === "day") return "day";
  if (period === "week") return "week";
  return "month";
}

function activityComparableTotal(
  total: number,
  period: string | null | undefined
): number {
  if (period === "year" || period === "all") {
    return total / 12;
  }
  return total;
}

function moreThanPlayersCaption(
  store: BaselineStore | null | undefined,
  metric: string,
  userVal: number,
  band: string | null | undefined,
  speed: string | null | undefined
): string | null {
  const hit = lookupBaseline(store, metric, band, speed);
  if (!hit || hit.mean == null) return null;
  const rank = approxPercentileRank(userVal, hit);
  if (rank == null) return null;
  return `More than ${rank}% of players`;
}

export function peerGamesPlayedCaption(
  store: BaselineStore | null | undefined,
  userGames: number | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined,
  period: string | null | undefined = "month"
): string | null {
  if (userGames == null || !Number.isFinite(userGames) || userGames < 0) {
    return null;
  }
  const bucket = activityBucketForPeriod(period);
  const metric = `avg_games_per_player_${bucket}`;
  const comparable = activityComparableTotal(userGames, period);
  return moreThanPlayersCaption(store, metric, comparable, band, speed);
}

export function peerTimeInvestedCaption(
  store: BaselineStore | null | undefined,
  userHours: number | null | undefined,
  games: number | null | undefined,
  band: string | null | undefined,
  speed: string | null | undefined,
  period: string | null | undefined = "month"
): string | null {
  if (userHours == null || !Number.isFinite(userHours) || userHours < 0) {
    return null;
  }
  const bucket = activityBucketForPeriod(period);
  const metric = `avg_est_seconds_per_player_${bucket}`;
  const userSeconds = activityComparableTotal(userHours * 3600, period);
  const activityCaption = moreThanPlayersCaption(
    store,
    metric,
    userSeconds,
    band,
    speed
  );
  if (activityCaption) return activityCaption;

  if (games == null || games <= 0) return null;
  const hit = lookupBaseline(store, "est_seconds_per_game", band, speed);
  if (!hit || hit.mean == null) return null;
  const peerHours = (hit.mean * games) / 3600;
  const delta = userHours - peerHours;
  const sign = delta >= 0 ? "+" : "";
  return `Peers ~${peerHours.toFixed(1)}h · Δ ${sign}${delta.toFixed(1)}h`;
}

export function peerCaption(
  store: BaselineStore | null | undefined,
  metric: string,
  band: string | null | undefined,
  speed: string | null | undefined,
  userVal: number | null | undefined,
  unit = ""
): string | null {
  const hit = lookupBaseline(store, metric, band, speed);
  if (!hit || hit.mean == null) return null;
  const parts = [
    `Lichess peers ${band} · ${speed}: mean ${hit.mean}${unit}`,
  ];
  const delta = formatPeerDelta(userVal, hit.mean);
  if (userVal != null && delta) parts.push(`Δ ${delta}${unit}`);
  if (hit.source_month) parts.push(String(hit.source_month));
  if (hit.sample) parts.push(`(${hit.sample})`);
  return parts.join(" · ");
}

export function baselinesFromBundledAsset(): BaselineStore {
  return indexRows(loadBundledRows());
}

export async function loadBaselineStore(
  forceNetwork = false
): Promise<BaselineStore> {
  return takeInflight(`baselines:${forceNetwork ? "force" : "soft"}`, async () => {
    if (!forceNetwork && cachedStore) return cachedStore;

    const disk = await readCache<BaselineStore>(
      BASELINES_CACHE_KEY,
      PERMANENT_CACHE_TTL_MS
    );
    if (!forceNetwork && disk) {
      cachedStore = disk;
      return cachedStore;
    }

    if (!forceNetwork) {
      const legacy = await readCache<BaselinesResponse>(
        "/api/v1/baselines",
        PERMANENT_CACHE_TTL_MS
      );
      const migrated = legacy ? storeFromPayload(legacy) : null;
      if (migrated) {
        cachedStore = migrated;
        await writeCache(BASELINES_CACHE_KEY, migrated);
        return cachedStore;
      }

      const bundled = baselinesFromBundledAsset();
      if (bundled.available) {
        cachedStore = bundled;
        await writeCache(BASELINES_CACHE_KEY, bundled);
        return cachedStore;
      }
    }

    try {
      const payload = await fetchBaselines(true);
      const store = storeFromPayload(payload);
      if (store) {
        cachedStore = store;
        await writeCache(BASELINES_CACHE_KEY, store);
        return cachedStore;
      }
    } catch {
      /* fall through */
    }

    if (disk?.available) {
      cachedStore = disk;
      return cachedStore;
    }
    cachedStore = baselinesFromBundledAsset();
    await writeCache(BASELINES_CACHE_KEY, cachedStore);
    return cachedStore;
  });
}

export function getCachedBaselineStore(): BaselineStore | null {
  return cachedStore;
}
