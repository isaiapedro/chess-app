import type { QueryFilters } from "../api/client";
import type {
  BadgeItem,
  FactorsPayload,
  HourlyPoint,
  InsightsResponse,
  MonthlyPoint,
  OpeningGroupRow,
  RatingPoint,
  RecapResponse,
  ResultsBreakdown,
} from "../api/types";
import type { NormalizedGame } from "../data/platformGames";

const SECONDS_PER_MOVE: Record<string, number> = {
  bullet: 3,
  blitz: 8,
  rapid: 20,
  classical: 60,
  daily: 60,
};

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function winRate(wins: number, total: number): number {
  return total ? Number(((wins / total) * 100).toFixed(1)) : 0;
}

function buildHeadline(games: NormalizedGame[]) {
  if (!games.length) return {};
  const oldest = [...games].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at))
  );
  const newest = [...oldest].reverse();
  const totalMoves = games.reduce(
    (sum, g) => sum + Number(g.move_count || 0),
    0
  );
  const totalSeconds = games.reduce((sum, g) => {
    const speed = String(g.speed || "blitz").toLowerCase();
    const per = SECONDS_PER_MOVE[speed] ?? 8;
    return sum + Number(g.move_count || 0) * per;
  }, 0);

  let maxWin = 0;
  let curWin = 0;
  let maxUnbeaten = 0;
  let curUnbeaten = 0;
  for (const g of oldest) {
    if (g.result === "Win") {
      curWin += 1;
      maxWin = Math.max(maxWin, curWin);
    } else {
      curWin = 0;
    }
    if (g.result === "Win" || g.result === "Draw") {
      curUnbeaten += 1;
      maxUnbeaten = Math.max(maxUnbeaten, curUnbeaten);
    } else {
      curUnbeaten = 0;
    }
  }
  let currentWinStreak = 0;
  for (const g of newest) {
    if (g.result === "Win") currentWinStreak += 1;
    else break;
  }

  const dayCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  for (const g of games) {
    const d = new Date(g.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const day = DAY_NAMES[d.getDay()];
    dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    hourCounts.set(d.getHours(), (hourCounts.get(d.getHours()) || 0) + 1);
  }
  let peakDay = "N/A";
  let peakDayN = 0;
  for (const [day, n] of dayCounts) {
    if (n > peakDayN) {
      peakDay = day;
      peakDayN = n;
    }
  }
  let peakHour = 0;
  let peakHourN = 0;
  for (const [hour, n] of hourCounts) {
    if (n > peakHourN) {
      peakHour = hour;
      peakHourN = n;
    }
  }

  return {
    total_games: games.length,
    total_moves: totalMoves,
    total_hours: Number((totalSeconds / 3600).toFixed(1)),
    max_win_streak: maxWin,
    max_unbeaten_streak: maxUnbeaten,
    current_win_streak: currentWinStreak,
    peak_day: peakDay,
    peak_hour: `${String(peakHour).padStart(2, "0")}:00 - ${String((peakHour + 1) % 24).padStart(2, "0")}:00`,
  };
}

function buildActivity(games: NormalizedGame[]): {
  hourly_activity: HourlyPoint[];
  monthly_activity: MonthlyPoint[];
  results_breakdown: ResultsBreakdown;
} {
  const wins = games.filter((g) => g.result === "Win").length;
  const draws = games.filter((g) => g.result === "Draw").length;
  const losses = games.filter((g) => g.result === "Loss").length;
  const hourly_activity: HourlyPoint[] = Array.from({ length: 24 }, (_, hour) => {
    const bucket = games.filter((g) => new Date(g.created_at).getHours() === hour);
    return {
      hour,
      label: String(hour),
      games: bucket.length,
      wins: bucket.filter((g) => g.result === "Win").length,
    };
  });

  const months = new Map<string, NormalizedGame[]>();
  const sorted = [...games].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at))
  );
  for (const g of sorted) {
    const d = new Date(g.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const list = months.get(key) || [];
    list.push(g);
    months.set(key, list);
  }
  const monthly_activity: MonthlyPoint[] = [...months.entries()].map(
    ([monthKey, group]) => {
      const ratings = group
        .map((g) => g.user_rating)
        .filter((r): r is number => typeof r === "number");
      const d = new Date(`${monthKey}-01T00:00:00`);
      return {
        month: d.toLocaleString(undefined, { month: "short" }),
        month_key: monthKey,
        games: group.length,
        wins: group.filter((g) => g.result === "Win").length,
        rating: ratings.length ? ratings[ratings.length - 1] : null,
      };
    }
  );

  return {
    hourly_activity,
    monthly_activity,
    results_breakdown: {
      wins,
      draws,
      losses,
      win_rate: winRate(wins, games.length),
    },
  };
}

function buildRatingSeries(games: NormalizedGame[]): RatingPoint[] {
  return [...games]
    .filter((g) => typeof g.user_rating === "number")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((g) => ({
      created_at: g.created_at,
      user_rating: Number(g.user_rating),
    }));
}

function buildRatingSeriesBySpeed(
  games: NormalizedGame[]
): Record<string, RatingPoint[]> {
  const out: Record<string, RatingPoint[]> = {};
  for (const g of games) {
    if (typeof g.user_rating !== "number") continue;
    const key = String(g.speed || "").toLowerCase().trim();
    if (!key) continue;
    if (!out[key]) out[key] = [];
    out[key].push({
      created_at: g.created_at,
      user_rating: Number(g.user_rating),
    });
  }
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))
    );
  }
  return out;
}

function buildRatingSummary(series: RatingPoint[]) {
  if (!series.length) return { peak: null, current: null, change: null };
  const ratings = series.map((p) => p.user_rating);
  return {
    peak: Math.max(...ratings),
    current: ratings[ratings.length - 1],
    change: ratings[ratings.length - 1] - ratings[0],
  };
}

function buildConditional(games: NormalizedGame[]) {
  if (!games.length) {
    return {
      baseline_win_rate: 0,
      white_win_rate: 0,
      black_win_rate: 0,
      color_bias: 0,
      underdog_win_rate: 0,
      favored_win_rate: 0,
      fb_user_win_rate: 0,
      fb_opp_win_rate: 0,
      modifiers: [] as Array<{ Condition: string; Diff: number }>,
    };
  }
  const baseline = winRate(
    games.filter((g) => g.result === "Win").length,
    games.length
  );
  const white = games.filter((g) => g.user_color === "white");
  const black = games.filter((g) => g.user_color === "black");
  const whiteWr = winRate(
    white.filter((g) => g.result === "Win").length,
    white.length
  );
  const blackWr = winRate(
    black.filter((g) => g.result === "Win").length,
    black.length
  );
  const rated = games.filter(
    (g) => typeof g.user_rating === "number" && typeof g.opp_rating === "number"
  );
  const underdog = rated.filter(
    (g) => Number(g.opp_rating) - Number(g.user_rating) >= 30
  );
  const favored = rated.filter(
    (g) => Number(g.opp_rating) - Number(g.user_rating) <= -30
  );
  const underdogWr = winRate(
    underdog.filter((g) => g.result === "Win").length,
    underdog.length
  );
  const favoredWr = winRate(
    favored.filter((g) => g.result === "Win").length,
    favored.length
  );
  const modifiers = [
    { Condition: "As White", Diff: Number((whiteWr - baseline).toFixed(1)) },
    { Condition: "As Black", Diff: Number((blackWr - baseline).toFixed(1)) },
    {
      Condition: "Vs Higher Rated (+30 ELO)",
      Diff: Number((underdogWr - baseline).toFixed(1)),
    },
    {
      Condition: "Vs Lower Rated (-30 ELO)",
      Diff: Number((favoredWr - baseline).toFixed(1)),
    },
  ];
  return {
    baseline_win_rate: baseline,
    white_win_rate: whiteWr,
    black_win_rate: blackWr,
    color_bias: Number((whiteWr - blackWr).toFixed(1)),
    underdog_win_rate: underdogWr,
    favored_win_rate: favoredWr,
    fb_user_win_rate: 0,
    fb_opp_win_rate: 0,
    modifiers,
  };
}

function buildFactors(conditional: ReturnType<typeof buildConditional>): FactorsPayload {
  const baseline = conditional.baseline_win_rate;
  const driving: FactorsPayload["driving"] = [];
  const costing: FactorsPayload["costing"] = [];
  for (const row of conditional.modifiers) {
    const item = {
      condition: row.Condition,
      win_rate: Number((baseline + row.Diff).toFixed(1)),
      diff: row.Diff,
    };
    if (row.Diff > 0) driving.push(item);
    else if (row.Diff < 0) costing.push(item);
  }
  driving.sort((a, b) => b.diff - a.diff);
  costing.sort((a, b) => a.diff - b.diff);
  return { baseline_win_rate: baseline, driving, costing };
}

function buildOpenings(games: NormalizedGame[], minGames = 2) {
  if (!games.length) return {};
  const white = games.filter((g) => g.user_color === "white");
  const black = games.filter((g) => g.user_color === "black");
  const modeEco = (list: NormalizedGame[]) => {
    const counts = new Map<string, number>();
    for (const g of list) {
      const eco = g.opening_eco || "UNK";
      counts.set(eco, (counts.get(eco) || 0) + 1);
    }
    let best = "N/A";
    let n = 0;
    for (const [eco, c] of counts) {
      if (c > n) {
        best = eco;
        n = c;
      }
    }
    return best;
  };
  const ecoName = new Map<string, string>();
  for (const g of games) {
    if (g.opening_eco && g.opening_name) ecoName.set(g.opening_eco, g.opening_name);
  }
  const label = (eco: string) =>
    eco === "N/A" ? "N/A" : `${eco} ${ecoName.get(eco) || ""}`.trim();

  const byEco = new Map<string, NormalizedGame[]>();
  for (const g of games) {
    const eco = g.opening_eco || "UNK";
    const list = byEco.get(eco) || [];
    list.push(g);
    byEco.set(eco, list);
  }
  const op_group: OpeningGroupRow[] = [...byEco.entries()].map(([eco, list]) => {
    const wins = list.filter((g) => g.result === "Win").length;
    const draws = list.filter((g) => g.result === "Draw").length;
    const losses = list.filter((g) => g.result === "Loss").length;
    return {
      opening_eco: eco,
      opening_name: ecoName.get(eco) || eco,
      games: list.length,
      wins,
      draws,
      losses,
      win_rate: winRate(wins, list.length),
    };
  });

  const byName = new Map<string, NormalizedGame[]>();
  for (const g of games) {
    const name = g.opening_name || "Unknown";
    const list = byName.get(name) || [];
    list.push(g);
    byName.set(name, list);
  }
  const vars = [...byName.entries()]
    .map(([name, list]) => ({
      name,
      total: list.length,
      win_rate: winRate(list.filter((g) => g.result === "Win").length, list.length),
    }))
    .filter((v) => v.total >= minGames);
  let secret_weapon = `Need min ${minGames} games`;
  let nemesis = `Need min ${minGames} games`;
  if (vars.length) {
    const best = [...vars].sort((a, b) => b.win_rate - a.win_rate)[0];
    const worst = [...vars].sort((a, b) => a.win_rate - b.win_rate)[0];
    secret_weapon = `${best.name} (${best.win_rate.toFixed(0)}% win | ${best.total}g)`;
    nemesis = `${worst.name} (${worst.win_rate.toFixed(0)}% win | ${worst.total}g)`;
  }
  const gambits = games.filter((g) =>
    String(g.opening_name || "").toLowerCase().includes("gambit")
  );
  return {
    sig_white: label(modeEco(white)),
    sig_black: label(modeEco(black)),
    secret_weapon,
    nemesis,
    total_gambits: gambits.length,
    gambit_win_rate: winRate(
      gambits.filter((g) => g.result === "Win").length,
      gambits.length
    ),
    op_group,
  };
}

function buildEndgames(games: NormalizedGame[]) {
  const shortGames = games.filter((g) => Number(g.move_count || 0) <= 30);
  const marathon = games.filter((g) => Number(g.move_count || 0) > 50);
  const countTerm = (list: NormalizedGame[]) => {
    const out: Record<string, number> = {};
    for (const g of list) {
      const key = g.termination || "Normal";
      out[key] = (out[key] || 0) + 1;
    }
    return out;
  };
  return {
    short_games_count: shortGames.length,
    short_win_rate: winRate(
      shortGames.filter((g) => g.result === "Win").length,
      shortGames.length
    ),
    marathon_games_count: marathon.length,
    marathon_win_rate: winRate(
      marathon.filter((g) => g.result === "Win").length,
      marathon.length
    ),
    win_methods: countTerm(games.filter((g) => g.result === "Win")),
    loss_methods: countTerm(games.filter((g) => g.result === "Loss")),
    endgame_types: {},
  };
}

function buildBadges(
  headline: ReturnType<typeof buildHeadline>,
  openings: ReturnType<typeof buildOpenings>,
  endgames: ReturnType<typeof buildEndgames>,
  conditional: ReturnType<typeof buildConditional>
): BadgeItem[] {
  const badges: BadgeItem[] = [];
  if ((conditional.underdog_win_rate || 0) >= 50) {
    badges.push({
      title: "Giant Killer",
      emoji: "👑",
      desc: `Fears no higher rating: ${conditional.underdog_win_rate}% win rate vs +30 ELO opponents.`,
    });
  }
  if (
    (endgames.marathon_win_rate || 0) >= 55 &&
    (endgames.marathon_games_count || 0) >= 3
  ) {
    badges.push({
      title: "Endgame Virtuoso",
      emoji: "♟️",
      desc: `Thrives in deep water: ${endgames.marathon_win_rate}% win rate in games >50 moves.`,
    });
  }
  if (
    (endgames.short_win_rate || 0) >= 55 &&
    (endgames.short_games_count || 0) >= 3
  ) {
    badges.push({
      title: "Sprint Specialist",
      emoji: "⚡",
      desc: `Lethal early finisher: ${endgames.short_win_rate}% win rate in short games (≤30 moves).`,
    });
  }
  if (Math.abs(conditional.color_bias || 0) >= 15) {
    const colorFav = (conditional.color_bias || 0) > 0 ? "White" : "Black";
    badges.push({
      title: "Color Specialist",
      emoji: "☯️",
      desc: `Dominant with ${colorFav}: Has a +${Math.abs(conditional.color_bias || 0)}% win rate advantage.`,
    });
  }
  if (
    Number(openings.total_gambits || 0) >= 3 &&
    Number(openings.gambit_win_rate || 0) >= 50
  ) {
    badges.push({
      title: "Gambit Enjoyer",
      emoji: "🔥",
      desc: `Sacrifices material for momentum: ${openings.gambit_win_rate}% win rate across ${openings.total_gambits} gambit games.`,
    });
  }
  const peak = String(headline.peak_hour || "00:00");
  const startHour = Number(peak.split(":")[0]);
  if (Number.isFinite(startHour) && (startHour >= 22 || startHour <= 4)) {
    badges.push({
      title: "Night Owl",
      emoji: "🌙",
      desc: `Plays best under the stars: Peak activity window is ${peak}.`,
    });
  }
  if (!badges.length) {
    badges.push({
      title: "Balanced General",
      emoji: "🧠",
      desc: "A well-rounded player with consistent stats across all phases of the game.",
    });
  }
  return badges;
}

function buildMeta(
  filters: QueryFilters,
  gamesCount: number
): RecapResponse["meta"] {
  return {
    username: filters.username,
    platform: filters.platform,
    timeframe: filters.timeframe,
    games_count: gamesCount,
    filters: {
      platform: filters.platform,
      timeframe: filters.timeframe,
      speed: filters.speed ?? null,
      color: filters.color ?? null,
      result: filters.result ?? null,
      date_from: filters.dateFrom ?? null,
      date_to: filters.dateTo ?? null,
    },
  };
}

export function buildLocalRecap(
  filters: QueryFilters,
  games: NormalizedGame[]
): RecapResponse {
  const headline = buildHeadline(games);
  const activity = buildActivity(games);
  const rating_series = buildRatingSeries(games);
  const openings = buildOpenings(games);
  const endgames = buildEndgames(games);
  const conditional = buildConditional(games);
  return {
    meta: buildMeta(filters, games.length),
    headline,
    badges: buildBadges(headline, openings, endgames, conditional),
    comparisons: {
      books_read: Number((((headline.total_hours as number) || 0) / 8).toFixed(1)),
      movies_watched: Number(
        (((headline.total_hours as number) || 0) / 2).toFixed(1)
      ),
      km_walked: Number((((headline.total_moves as number) || 0) * 0.001).toFixed(2)),
      captured_piece_weight_g: 0,
    },
    rating_series,
    rating_series_by_speed: buildRatingSeriesBySpeed(games),
    rating_summary: buildRatingSummary(rating_series),
    activity: {
      hourly_activity: activity.hourly_activity,
      monthly_activity: activity.monthly_activity,
    },
    results: activity.results_breakdown,
  };
}

export function buildLocalInsights(
  filters: QueryFilters,
  games: NormalizedGame[]
): InsightsResponse {
  const openings = buildOpenings(games);
  const endgames = buildEndgames(games);
  const conditional = buildConditional(games);
  return {
    meta: buildMeta(filters, games.length),
    style: {
      clock: {},
      conditional: {
        baseline_win_rate: conditional.baseline_win_rate,
        white_win_rate: conditional.white_win_rate,
        black_win_rate: conditional.black_win_rate,
        underdog_win_rate: conditional.underdog_win_rate,
        favored_win_rate: conditional.favored_win_rate,
        modifiers: conditional.modifiers,
      },
      first_blood_pct: 0,
      castling_counts: {},
    },
    factors: buildFactors(conditional),
    openings,
    middlegames: {
      knights_captured: 0,
      bishops_captured: 0,
      queenless_pct: 0,
      promotions_total: {},
      underpromotions: 0,
      checkmate_finishers: {},
    },
    endgames,
  };
}

export function buildLocalSessionBundle(
  filters: QueryFilters,
  pageGames: NormalizedGame[],
  allFiltered: NormalizedGame[]
): {
  games: NormalizedGame[];
  recap: RecapResponse;
  insights: InsightsResponse;
} {
  return {
    games: pageGames,
    recap: buildLocalRecap(filters, allFiltered),
    insights: buildLocalInsights(filters, allFiltered),
  };
}
