export type Platform = "chesscom" | "lichess";
export type Timeframe = "1 month" | "6 months" | "1 year" | "all";
export type Period = "all" | "year" | "month" | "week" | "day";

export type RatingPoint = {
  created_at: string;
  user_rating: number;
};

export type BadgeItem = {
  title: string;
  emoji: string;
  desc: string;
};

export type HourlyPoint = {
  hour: number;
  label: string;
  games: number;
  wins: number;
};

export type MonthlyPoint = {
  month: string;
  month_key: string;
  games: number;
  wins: number;
  rating: number | null;
};

export type ResultsBreakdown = {
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
};

export type FactorItem = {
  condition: string;
  win_rate: number;
  diff: number;
};

export type FactorsPayload = {
  baseline_win_rate: number;
  driving: FactorItem[];
  costing: FactorItem[];
};

export type RecapResponse = {
  meta: {
    username: string;
    platform: string;
    timeframe: string;
    games_count: number;
    filters: Record<string, unknown>;
  };
  headline: {
    total_games?: number;
    total_moves?: number;
    total_hours?: number;
    max_win_streak?: number;
    max_unbeaten_streak?: number;
    current_win_streak?: number;
    peak_day?: string;
    peak_hour?: string;
  };
  badges: BadgeItem[];
  comparisons: {
    books_read?: number;
    movies_watched?: number;
    km_walked?: number;
    captured_piece_weight_g?: number;
  };
  rating_series: RatingPoint[];
  rating_series_by_speed?: Record<string, RatingPoint[]>;
  rating_summary?: {
    peak: number | null;
    current: number | null;
    change: number | null;
  };
  activity?: {
    hourly_activity: HourlyPoint[];
    monthly_activity: MonthlyPoint[];
  };
  results?: ResultsBreakdown;
};

export type OpeningGroupRow = {
  opening_eco?: string;
  opening_name?: string;
  games?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  win_rate?: number;
  [key: string]: unknown;
};

export type InsightsResponse = {
  meta: RecapResponse["meta"];
  style: {
    clock?: Record<string, unknown>;
    conditional?: {
      baseline_win_rate?: number;
      white_win_rate?: number;
      black_win_rate?: number;
      underdog_win_rate?: number;
      favored_win_rate?: number;
      modifiers?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    first_blood_pct?: number;
    castling_counts?: Record<string, number>;
  };
  factors?: FactorsPayload;
  openings: {
    op_group?: OpeningGroupRow[];
    sig_white?: string;
    sig_black?: string;
    secret_weapon?: string;
    nemesis?: string;
    total_gambits?: number;
    gambit_win_rate?: number;
    [key: string]: unknown;
  };
  middlegames: {
    knights_captured?: number;
    bishops_captured?: number;
    queenless_pct?: number;
    promotions_total?: Record<string, number> | number;
    underpromotions?: number;
    checkmate_finishers?: Record<string, number>;
    [key: string]: unknown;
  };
  endgames: {
    short_games_count?: number;
    short_win_rate?: number;
    marathon_games_count?: number;
    marathon_win_rate?: number;
    win_methods?: Record<string, number>;
    loss_methods?: Record<string, number>;
    endgame_types?: Record<string, number>;
    [key: string]: unknown;
  };
};

export type CatalogMetric = {
  id: string;
  section: "style" | "openings" | "middlegame" | "endgame";
  sectionTitle: string;
  name: string;
  value: string;
  unit: string;
  desc: string;
  numericValue?: number;
};

export type CatalogSection = {
  key: CatalogMetric["section"];
  title: string;
  icon: string;
  color: string;
  metrics: CatalogMetric[];
};
