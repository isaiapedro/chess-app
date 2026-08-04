import { colors, result } from "../theme";
import type {
  CatalogMetric,
  CatalogSection,
  FactorItem,
  FactorsPayload,
  HourlyPoint,
  InsightsResponse,
  MonthlyPoint,
  Period,
  RatingPoint,
  RecapResponse,
} from "./types";

const FORMAT_LABEL: Record<string, string> = {
  classical: "Classical",
  rapid: "Rapid",
  blitz: "Blitz",
  bullet: "Bullet",
};

const FORMAT_COLORS: Record<string, string> = {
  bullet: colors.red,
  blitz: colors.blue,
  rapid: colors.sage,
  classical: colors.cream,
};

const FORMAT_ORDER = ["bullet", "blitz", "rapid", "classical"];

export type RatingCurve = {
  key: string;
  label: string;
  color: string;
  points: RatingPoint[];
};

const CHARS_PER_MOVE = 5;
const CHARS_PER_BOOK = 400_000;
const CHARS_PER_PAGE = 1_800;

const BOOK_BENCHMARKS = [
  { title: "The Hobbit", chars: 540_000 },
  { title: "Pride and Prejudice", chars: 685_000 },
  { title: "Jane Eyre", chars: 1_000_000 },
  { title: "Moby-Dick", chars: 1_200_000 },
  { title: "Anna Karenina", chars: 1_900_000 },
  { title: "Les Misérables", chars: 3_000_000 },
  { title: "War and Peace", chars: 3_200_000 },
];

function buildNotationComparison(characters: number) {
  const sub = `${characters.toLocaleString()} PGN characters`;

  if (characters < CHARS_PER_BOOK) {
    const pages = Math.max(1, Math.round(characters / CHARS_PER_PAGE));
    return {
      icon: "☰",
      label: "Pages of notation written",
      value: pages.toLocaleString(),
      sub,
      small: false,
    };
  }

  const match = BOOK_BENCHMARKS.reduce((closest, book) =>
    Math.abs(book.chars - characters) < Math.abs(closest.chars - characters)
      ? book
      : closest
  );

  return {
    icon: "☰",
    label: "You wrote a book the size of",
    value: match.title,
    sub,
    small: true,
  };
}

function formatWeight(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(2)} kg`;
  return `${Math.round(grams)} g`;
}

function bucketHoursByTwo(points: HourlyPoint[]): HourlyPoint[] {
  const bins: HourlyPoint[] = Array.from({ length: 12 }, (_, index) => ({
    hour: index * 2,
    label: `${formatHour12(index * 2)}–${formatHour12((index * 2 + 2) % 24)}`,
    games: 0,
    wins: 0,
  }));
  for (const point of points) {
    const index = Math.min(11, Math.max(0, Math.floor(point.hour / 2)));
    bins[index].games += point.games;
    bins[index].wins += point.wins || 0;
  }
  return bins;
}

function formatHour12(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const base = hour % 12 === 0 ? 12 : hour % 12;
  return `${base} ${suffix}`;
}

function formatPeakHourAmPm(peakHour: string): string {
  const match = peakHour.match(/(\d{1,2})/);
  if (!match) return peakHour;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return peakHour;
  return formatHour12(hour);
}

const MAX_BUCKETS = 400;

function buildEvenRatingSeries(
  points: RatingPoint[],
  period: Period
): RatingPoint[] {
  if (!points.length) return points;

  const sorted = [...points].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  const first = new Date(sorted[0].created_at);
  const last = new Date(sorted[sorted.length - 1].created_at);
  const now = new Date();
  const buckets: Date[] = [];

  if (period === "day") {
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    for (let hour = 0; hour < 24; hour += 2) {
      buckets.push(
        new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0)
      );
    }
  } else if (period === "year" || period === "all") {
    const cursor =
      period === "year"
        ? new Date(now.getFullYear() - 1, now.getMonth(), 1)
        : new Date(first.getFullYear(), first.getMonth(), 1);
    const end =
      period === "year"
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(last.getFullYear(), last.getMonth(), 1);
    while (cursor <= end && buckets.length < MAX_BUCKETS) {
      buckets.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    while (cursor <= end && buckets.length < MAX_BUCKETS) {
      buckets.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  if (!buckets.length) return sorted;

  const bucketKey = (date: Date) => {
    if (period === "day") {
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${Math.floor(date.getHours() / 2)}`;
    }
    if (period === "year" || period === "all") {
      return `${date.getFullYear()}-${date.getMonth()}`;
    }
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  let peak = sorted[0];
  let trough = sorted[0];
  for (const point of sorted) {
    if (point.user_rating > peak.user_rating) peak = point;
    if (point.user_rating < trough.user_rating) trough = point;
  }
  const peakKey = bucketKey(new Date(peak.created_at));
  const troughKey = bucketKey(new Date(trough.created_at));

  const lastRatingByBucket = new Map<string, number>();
  for (const point of sorted) {
    lastRatingByBucket.set(bucketKey(new Date(point.created_at)), point.user_rating);
  }

  let carried = sorted[0].user_rating;
  return buckets.map((date) => {
    const key = bucketKey(date);
    const rating = lastRatingByBucket.get(key);
    if (rating != null) {
      carried = rating;
    }
    let value = carried;
    if (key === peakKey) value = peak.user_rating;
    else if (key === troughKey) value = trough.user_rating;
    return { created_at: date.toISOString(), user_rating: value };
  });
}

function buildAlignedRatingCurves(
  bySpeed: Record<string, RatingPoint[]>,
  period: Period
): RatingCurve[] {
  const entries = [
    ...FORMAT_ORDER.filter((key) => (bySpeed[key] || []).length > 0),
    ...Object.keys(bySpeed).filter(
      (key) => !FORMAT_ORDER.includes(key) && (bySpeed[key] || []).length > 0
    ),
  ]
    .map((key) => ({
      key,
      sorted: [...(bySpeed[key] || [])]
        .filter((point) => point.user_rating != null)
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        ),
    }))
    .filter((entry) => entry.sorted.length > 0);

  if (!entries.length) return [];

  const allPoints = entries.flatMap((entry) => entry.sorted);
  const shared = buildEvenRatingSeries(allPoints, period);
  if (shared.length < 2) return [];

  const bucketKey = (date: Date) => {
    if (period === "day") {
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${Math.floor(date.getHours() / 2)}`;
    }
    if (period === "year" || period === "all") {
      return `${date.getFullYear()}-${date.getMonth()}`;
    }
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };

  return entries.map((entry) => {
    let peak = entry.sorted[0];
    let trough = entry.sorted[0];
    for (const point of entry.sorted) {
      if (point.user_rating > peak.user_rating) peak = point;
      if (point.user_rating < trough.user_rating) trough = point;
    }
    const peakKey = bucketKey(new Date(peak.created_at));
    const troughKey = bucketKey(new Date(trough.created_at));

    const lastRatingByBucket = new Map<string, number>();
    for (const point of entry.sorted) {
      lastRatingByBucket.set(
        bucketKey(new Date(point.created_at)),
        point.user_rating
      );
    }
    let carried = entry.sorted[0].user_rating;
    let started = false;
    const points = shared.map((bucket) => {
      const key = bucketKey(new Date(bucket.created_at));
      const rating = lastRatingByBucket.get(key);
      if (rating != null) {
        carried = rating;
        started = true;
      }
      let value = started ? carried : entry.sorted[0].user_rating;
      if (started && key === peakKey) value = peak.user_rating;
      else if (started && key === troughKey) value = trough.user_rating;
      return {
        created_at: bucket.created_at,
        user_rating: value,
      };
    });
    return {
      key: entry.key,
      label: FORMAT_LABEL[entry.key] || entry.key,
      color: FORMAT_COLORS[entry.key] || colors.cream,
      points,
    };
  });
}

function fillMonthlyGaps(points: MonthlyPoint[], period: Period): MonthlyPoint[] {
  const now = new Date();
  const byKey = new Map(points.map((point) => [point.month_key, point]));

  const parse = (key: string) => {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, (month || 1) - 1, 1);
  };

  let cursor: Date;
  let end: Date;

  if (period === "year") {
    cursor = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (points.length >= 1) {
    cursor = parse(points[0].month_key);
    end = parse(points[points.length - 1].month_key);
  } else {
    return points;
  }

  const filled: MonthlyPoint[] = [];
  while (cursor <= end && filled.length < MAX_BUCKETS) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    filled.push(
      byKey.get(key) || {
        month: cursor.toLocaleDateString(undefined, { month: "short" }),
        month_key: key,
        games: 0,
        wins: 0,
        rating: null,
      }
    );
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return filled;
}

export function selectRecapView(
  data: RecapResponse,
  speed?: string | null,
  period: Period = "all"
) {
  const headline = data.headline || {};
  const results = data.results || {
    wins: 0,
    draws: 0,
    losses: 0,
    win_rate: 0,
  };
  const rating = data.rating_summary || {
    peak: null,
    current: null,
    change: null,
  };
  const hourlyRaw = data.activity?.hourly_activity || [];
  const monthly = data.activity?.monthly_activity || [];
  const peakHourPoint = [...hourlyRaw].sort((a, b) => b.games - a.games)[0];
  const totalMoves = Number(headline.total_moves || 0);
  const notationCharacters = totalMoves * CHARS_PER_MOVE;
  return {
    username: data.meta.username,
    platform: data.meta.platform,
    timeframe: data.meta.timeframe,
    formatLabel: speed ? FORMAT_LABEL[speed] || speed : "All Speeds",
    gamesCount: data.meta.games_count,
    peakRating: rating.peak,
    currentRating: rating.current,
    ratingChange: rating.change,
    currentWinStreak: Number(headline.current_win_streak || 0),
    results,
    stats: [
      {
        label: "Games Played",
        value: String(headline.total_games ?? data.meta.games_count ?? 0),
        sub:
          period === "day"
            ? "Filtered games"
            : headline.peak_day
              ? `Peak day ${headline.peak_day}`
              : "Filtered games",
      },
      {
        label: "Win Rate",
        value: `${results.win_rate}%`,
        sub: `${results.wins}W · ${results.draws}D · ${results.losses}L`,
      },
      {
        label: "Time Invested",
        value: `${headline.total_hours ?? 0}h`,
        sub:
          peakHourPoint && peakHourPoint.games > 0
            ? `Peak ${formatHour12(peakHourPoint.hour)}`
            : headline.peak_hour
              ? `Peak ${formatPeakHourAmPm(headline.peak_hour)}`
              : "Estimated play time",
      },
      {
        label: "Moves Made",
        value: Number(headline.total_moves || 0).toLocaleString(),
        sub: `Undefeated streak ${headline.max_unbeaten_streak ?? 0}`,
      },
    ],
    ratingSeries: buildEvenRatingSeries(data.rating_series || [], period),
    ratingCurves: speed
      ? []
      : buildAlignedRatingCurves(data.rating_series_by_speed || {}, period),
    monthlyActivity: fillMonthlyGaps(monthly, period),
    hourlyActivity: bucketHoursByTwo(hourlyRaw),
    peakHourLabel:
      peakHourPoint && peakHourPoint.games > 0
        ? formatHour12(peakHourPoint.hour)
        : headline.peak_hour || "N/A",
    badges: data.badges || [],
    comparisons: [
      {
        label: "Movies you could have watched",
        value: String(data.comparisons?.movies_watched ?? 0),
        sub: `${headline.total_hours ?? 0}h of screen time`,
        icon: "▶",
        small: false,
      },
      buildNotationComparison(notationCharacters),
      {
        label: "Weight of captured pieces",
        value: formatWeight(data.comparisons?.captured_piece_weight_g ?? 0),
        sub: "Material taken off the board",
        icon: "⚖",
        small: false,
      },
      {
        label: "Km walked by pieces",
        value: String(data.comparisons?.km_walked ?? 0),
        sub: "Distance across the board",
        icon: "━",
        small: false,
      },
    ],
  };
}

export function selectFactors(data: InsightsResponse): FactorsPayload {
  if (data.factors) {
    return {
      baseline_win_rate: data.factors.baseline_win_rate ?? 0,
      driving: data.factors.driving || [],
      costing: data.factors.costing || [],
    };
  }

  const baseline = Number(data.style?.conditional?.baseline_win_rate || 0);
  const modifiers = data.style?.conditional?.modifiers || [];
  const driving: FactorItem[] = [];
  const costing: FactorItem[] = [];

  for (const row of modifiers) {
    const condition = String(row.Condition || row.condition || "");
    const diff = Number(row.Diff ?? row.diff ?? 0);
    const item = {
      condition,
      win_rate: Number((baseline + diff).toFixed(1)),
      diff: Number(diff.toFixed(1)),
    };
    if (diff > 0) driving.push(item);
    if (diff < 0) costing.push(item);
  }

  driving.sort((a, b) => b.diff - a.diff);
  costing.sort((a, b) => a.diff - b.diff);
  return { baseline_win_rate: baseline, driving, costing };
}

function metric(
  section: CatalogMetric["section"],
  sectionTitle: string,
  name: string,
  value: string | number | undefined | null,
  unit: string,
  desc: string
): CatalogMetric | null {
  if (value === undefined || value === null || value === "") return null;
  const numericValue = typeof value === "number" ? value : Number(value);
  return {
    id: `${section}-${name}`,
    section,
    sectionTitle,
    name,
    value: String(value),
    unit,
    desc,
    numericValue: Number.isFinite(numericValue) ? numericValue : undefined,
  };
}

export function selectMetricsCatalog(_data: InsightsResponse): CatalogSection[] {
  const styleMetricDefs: Array<[string, string, string]> = [
    ["Average Think Time", "s", "How long you usually spend on each move"],
    ["Clock Difference", "s", "Your think time versus opponents"],
    ["Time When Losing", "s", "Think time when the position is already bad"],
    ["Time on Big Moments", "s", "Think time on sharp evaluation swings"],
    ["Signature Openings", "%", "Games in your usual openings"],
    ["Offbeat Openings", "%", "Games outside your usual openings"],
    ["Mainstream Openings", "%", "Games in well-known mainstream systems"],
    ["Side Openings", "%", "Games in less standard opening systems"],
    ["Position Swings", "pp", "How much the evaluation jumps move to move"],
    ["Sacrifices", "/game", "Material given up on purpose"],
    ["Early Flank Pushes", "%", "Early wing pawn advances into enemy ground"],
    ["Endgame Conversion", "%", "Wins from winning endgames"],
    ["Early Piece Trades", "/game", "Early piece exchanges"],
    ["Unequal Threats", "/game", "Attacks on higher-value pieces"],
    ["Threat Escapes", "/game", "Escapes from cheaper-piece attacks"],
    ["Fights Near Their King", "/game", "Captures near the enemy king"],
    ["Fights Near Your King", "/game", "Captures near your king"],
    ["Enemy Half Moves", "%", "Moves landing in the opponent half"],
    ["Own Half Moves", "%", "Moves staying in your half"],
    ["Forward Moves", "%", "Pieces advancing toward the enemy"],
    ["Backward Moves", "%", "Pieces retreating"],
    ["Breaking Draws", "%", "Equal late positions that still finish decisive"],
    ["Declined Recaptures", "%", "Recapture chances you refuse"],
    ["Comebacks", "%", "Saves after being clearly worse"],
    ["Blunders", "/game", "Moves that tank winning chances"],
  ];
  const styleMetrics: CatalogMetric[] = styleMetricDefs.map(
    ([name, unit, desc]) => ({
      id: `style-${name}`,
      section: "style",
      sectionTitle: "Style of Play",
      name,
      value: "—",
      unit,
      desc,
    })
  );

  const openingMetricDefs: Array<[string, string, string]> = [
    ["Opening Accuracy", "%", "Opening-phase quality vs peers"],
    ["Development Speed", "", "Minors developed by move 10"],
    ["Center Control", "%", "Influence on central squares"],
    ["King Safety", "", "Average castling fullmove"],
    ["Uncastled Games", "%", "Games without castling"],
    ["Tempo Balance", "%", "Wasted developing tempi"],
  ];
  const openingMetrics: CatalogMetric[] = openingMetricDefs.map(
    ([name, unit, desc]) => ({
      id: `openings-${name}`,
      section: "openings",
      sectionTitle: "Openings",
      name,
      value: "—",
      unit,
      desc,
    })
  );

  const midMetricDefs: Array<[string, string, string]> = [
    ["Accuracy in Middlegame", "%", "Middlegame move quality vs peers"],
    ["Blunder Rate", "/game", "Average middlegame blunders per game"],
    ["Missed Opportunities", "%", "Failed chances after opponent blunders"],
    ["Missed Tactic", "%", "Missed material tactics after opponent blunders"],
    ["Allowed Tactics", "%", "Opponent finds tactics you blunder into"],
    ["Attackers in King Zone", "", "Pressure on squares next to your king"],
    ["Pawn Shield Integrity", "%", "Castled pawn shield health"],
    ["Open File Proximity", "%", "King exposure to open files"],
    ["Safe Legal Moves", "%", "Moves landing off enemy pawn attacks"],
    ["Outpost Control", "", "Minors on classic outposts"],
    ["Space Advantage", "%", "Safe central space share"],
    ["Isolated Queen Pawn", "%", "Win rate with an IQP"],
    ["Doubled Pawns", "%", "Games with doubled pawns"],
    ["Backward Pawns", "%", "Games with a backward pawn"],
    ["Pawn Islands", "", "Average pawn island count"],
  ];
  const midMetrics: CatalogMetric[] = midMetricDefs.map(
    ([name, unit, desc]) => ({
      id: `middlegame-${name}`,
      section: "middlegame",
      sectionTitle: "Middlegames",
      name,
      value: "—",
      unit,
      desc,
    })
  );

  const endMetricDefs: Array<[string, string, string]> = [
    ["Blunder Rate on Endgames", "/game", "Average blunders per endgame"],
    [
      "Theoretical Endgames Saved",
      "%",
      "Win or draw rate defending weaker theoretical sides",
    ],
    ["King Centralization", "", "King closeness to the center"],
    ["King Distance", "", "King distance to enemy pawns"],
    ["Pawn Difference", "", "Pawn edge after the endgame starts"],
    ["Beneficial Trades", "%", "Trades that raise winning chances"],
    ["Simplification Trades", "%", "Trading down while already winning"],
    ["Conversion Rate", "%", "Mate evaluations that become checkmate"],
    ["Stalemate", "%", "Winning positions that end in stalemate"],
    ["Mate Tempo", "s", "Think time during mate sequences"],
    ["Pawn Endings", "%", "Win rate in pure pawn endings"],
    ["Queen vs Pawn", "%", "Win rate with queen vs pawn"],
    ["Rook vs Pawn", "%", "Win rate with rook vs pawn"],
    ["Bishop + Pawn vs Knight", "%", "Win rate with bishop+pawn vs knight"],
    [
      "Two Pawns + Opposite Bishops",
      "%",
      "Win rate with two pawns in opposite bishops",
    ],
    ["Pawn vs Knight", "%", "Win/draw rate in pawn vs knight"],
    ["Two Pawns vs Rook", "%", "Win/draw rate in two pawns vs rook"],
    ["Knight + Pawn vs Bishop", "%", "Win/draw rate in knight+pawn vs bishop"],
    ["Rook + Pawn vs Rook", "%", "Win/draw rate in rook+pawn vs rook"],
  ];

  const endMetrics: CatalogMetric[] = endMetricDefs.map(
    ([name, unit, desc]) => ({
      id: `endgame-${name}`,
      section: "endgame",
      sectionTitle: "Endgames",
      name,
      value: "—",
      unit,
      desc,
    })
  );

  return [
    {
      key: "style",
      title: "Style of Play",
      icon: "♞",
      color: colors.blue,
      metrics: styleMetrics,
    },
    {
      key: "openings",
      title: "Openings",
      icon: "♛",
      color: colors.cream,
      metrics: openingMetrics,
    },
    {
      key: "middlegame",
      title: "Middlegames",
      icon: "♝",
      color: result.win,
      metrics: midMetrics,
    },
    {
      key: "endgame",
      title: "Endgames",
      icon: "♚",
      color: result.loss,
      metrics: endMetrics,
    },
  ];
}

export function selectRepertoireQuiz(
  moves: Array<{ uci?: string; san?: string; white?: number; draws?: number; black?: number }>
) {
  const ranked = [...moves]
    .filter((m) => m.san)
    .sort((a, b) => {
      const ta = (a.white || 0) + (a.draws || 0) + (a.black || 0);
      const tb = (b.white || 0) + (b.draws || 0) + (b.black || 0);
      return tb - ta;
    });

  if (!ranked.length) {
    return null;
  }

  const best = ranked[0];
  const alternatives = ranked.slice(1, 4).map((m) => m.san!);
  while (alternatives.length < 3) {
    alternatives.push(`Alt ${alternatives.length + 1}`);
  }

  return {
    bestMove: best.san!,
    bestUci: best.uci || "",
    alternatives: alternatives.slice(0, 3),
    options: shuffleSeed([best.san!, ...alternatives.slice(0, 3)], best.san!.length),
  };
}

function shuffleSeed<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  let s = seed || 1;
  for (let i = copy.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
