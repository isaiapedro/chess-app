export type Platform = "chesscom" | "lichess";
export type Timeframe = "1 month" | "6 months" | "1 year";
export type DatePreset = "all" | "year" | "month" | "week" | "day" | "custom";

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
    peak_day?: string;
    peak_hour?: string;
  };
  badges: Array<{
    title: string;
    emoji: string;
    desc: string;
  }>;
  comparisons: {
    books_read?: number;
    movies_watched?: number;
    km_walked?: number;
  };
  rating_series: Array<{
    created_at: string;
    user_rating: number;
  }>;
};

export type InsightsResponse = {
  meta: RecapResponse["meta"];
  style: Record<string, unknown>;
  openings: Record<string, unknown>;
  middlegames: Record<string, unknown>;
  endgames: Record<string, unknown>;
};
