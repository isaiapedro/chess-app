import Constants from "expo-constants";
import type {
  Platform,
  Timeframe,
  RecapResponse,
  InsightsResponse,
} from "./types";
import { readThroughCache, GAMES_TTL_MS, STUDY_API_TTL_MS } from "../storage/cache";

function resolveApiBase(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  if (hostUri) {
    return `http://${hostUri}`;
  }
  return "http://127.0.0.1:8081";
}

const API_BASE = resolveApiBase();

export type QueryFilters = {
  username: string;
  platform: Platform;
  timeframe: Timeframe;
  speed?: string | null;
  color?: "white" | "black" | null;
  result?: "Win" | "Loss" | "Draw" | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type MistakeItem = {
  game_id: string;
  created_at: string;
  opening_name?: string;
  opening_eco?: string;
  opponent_name?: string;
  speed?: string;
  user_color: string;
  result: string;
  ply: number;
  move_number?: number;
  fen: string;
  played_uci: string;
  played_san: string;
  best_uci: string | null;
  best_san: string | null;
  best_pv?: string[];
  continuation_source?: "gm" | "engine";
  gm_game?: {
    id?: string;
    white: string;
    black: string;
    date: string | null;
    event: string | null;
  } | null;
  eval_before_cp: number;
  eval_after_cp: number;
  eval_delta_cp?: number;
  eval_drop_cp: number;
  comment: string;
};

export type ExplorerMove = {
  uci?: string;
  san?: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
};

export type ExplorerTopGame = {
  id?: string;
  uci?: string;
  winner?: string | null;
  year?: number;
  white?: { name?: string; rating?: number };
  black?: { name?: string; rating?: number };
};

function buildParams(filters: QueryFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("username", filters.username);
  params.set("platform", filters.platform);
  params.set("timeframe", filters.timeframe);
  if (filters.speed) params.set("speed", filters.speed);
  if (filters.color) params.set("color", filters.color);
  if (filters.result) params.set("result", filters.result);
  if (filters.dateFrom) params.set("date_from", filters.dateFrom);
  if (filters.dateTo) params.set("date_to", filters.dateTo);
  return params;
}

async function getJson<T>(
  path: string,
  params?: URLSearchParams,
  forceNetwork = false
): Promise<T> {
  const qs = params?.toString();
  const url = `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const cacheKey = `${path}${qs ? `?${qs}` : ""}`;
  return readThroughCache<T>(
    cacheKey,
    async () => {
      const res = await fetch(url);
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const body = await res.json();
          detail = body.detail || JSON.stringify(body);
        } catch {
          detail = res.statusText;
        }
        throw new Error(`${res.status}: ${detail}`);
      }
      return res.json() as Promise<T>;
    },
    {
      forceNetwork,
      ttlMs: ttlForPath(path),
    }
  );
}

function ttlForPath(path: string): number {
  if (path.includes("/games/")) return GAMES_TTL_MS;
  if (path.includes("/baselines")) return 7 * 24 * 60 * 60 * 1000;
  if (
    path.includes("/study/explorer") ||
    path.includes("/study/masters-pgn") ||
    path.includes("/study/eval")
  ) {
    return STUDY_API_TTL_MS;
  }
  return 15 * 60 * 1000;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export function getApiBase(): string {
  return API_BASE;
}

export async function fetchRecap(
  filters: QueryFilters,
  forceNetwork = false
): Promise<RecapResponse> {
  return getJson<RecapResponse>(
    "/api/v1/stats/recap",
    buildParams(filters),
    forceNetwork
  );
}

export async function fetchInsights(
  filters: QueryFilters,
  forceNetwork = false
): Promise<InsightsResponse> {
  return getJson<InsightsResponse>(
    "/api/v1/stats/insights",
    buildParams(filters),
    forceNetwork
  );
}

export type BaselinesResponse = {
  meta: {
    available: boolean;
    source_month?: string | null;
    row_count?: number;
    band_count?: number;
    speed_count?: number;
    cell_count?: number;
  };
  bands: string[];
  speeds: string[];
  rows: Array<Record<string, unknown>>;
  by_cell: Record<
    string,
    Record<
      string,
      {
        mean: number | null;
        n: number;
        sample?: string | null;
        source_month?: string | null;
        p10?: number | null;
        p25?: number | null;
        p50?: number | null;
        p75?: number | null;
        p90?: number | null;
      }
    >
  >;
};

export async function fetchBaselines(
  forceNetwork = false
): Promise<BaselinesResponse> {
  return getJson<BaselinesResponse>(
    "/api/v1/baselines",
    undefined,
    forceNetwork
  );
}

export async function fetchGames(
  filters: QueryFilters,
  forceNetwork = false,
  includePgn = false
): Promise<{ count: number; games: Array<Record<string, unknown>> }> {
  const params = buildParams(filters);
  params.delete("username");
  if (includePgn) params.set("include_pgn", "true");
  return getJson(
    `/api/v1/games/${encodeURIComponent(filters.username)}`,
    params,
    forceNetwork
  );
}

export async function fetchStudyGames(
  filters: QueryFilters,
  forceNetwork = false
): Promise<Array<Record<string, unknown>>> {
  const payload = await fetchGames(filters, forceNetwork, true);
  return (payload.games || []).sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  );
}

export async function fetchEval(fen: string, multiPv = 3) {
  const params = new URLSearchParams({
    fen,
    multi_pv: String(multiPv),
  });
  return getJson<{
    fen: string;
    best_uci: string | null;
    best_san: string | null;
    eval_cp_white: number | null;
    pvs: unknown[];
  }>("/api/v1/study/eval", params);
}

export async function fetchExplorer(
  fen: string,
  source: "lichess" | "masters" | "player" = "lichess",
  username?: string,
  color?: "white" | "black",
  ratings?: string
) {
  const params = new URLSearchParams({ fen, source });
  if (username) params.set("username", username);
  if (color) params.set("color", color);
  if (ratings) params.set("ratings", ratings);
  return getJson<{
    fen: string;
    source: string;
    moves: ExplorerMove[];
    topGames?: ExplorerTopGame[];
    opening?: { eco?: string; name?: string };
    white: number;
    draws: number;
    black: number;
    fallback?: boolean;
    note?: string;
  }>("/api/v1/study/explorer", params);
}

export async function fetchMastersPgn(gameId: string) {
  return getJson<{ id: string; pgn: string }>(
    `/api/v1/study/masters-pgn/${encodeURIComponent(gameId)}`
  );
}

export async function validateQuizMove(
  fen: string,
  userUci: string,
  bestUci: string
) {
  return postJson<{
    correct: boolean;
    legal: boolean;
    user_san: string | null;
    accepted_as_top_line: boolean;
    centipawn_loss: number | null;
  }>("/api/v1/study/quiz/validate", {
    fen,
    user_uci: userUci,
    best_uci: bestUci,
  });
}
