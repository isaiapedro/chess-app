import Constants from "expo-constants";
import type { Platform, Timeframe } from "./types";
import {
  readThroughCache,
  takeInflight,
  DAY_TTL_MS,
  PERMANENT_CACHE_TTL_MS,
  STUDY_API_TTL_MS,
} from "../storage/cache";
import {
  GLOBAL_FIRST_SCAN_MAX_GAMES,
  GLOBAL_MAX_GAMES,
} from "../engine/analysisConfig";

export const GAMES_FIRST_PAGE_SIZE = GLOBAL_FIRST_SCAN_MAX_GAMES;
export const GAMES_PAGE_SIZE = GLOBAL_MAX_GAMES;

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
  if (path.includes("/baselines")) return PERMANENT_CACHE_TTL_MS;
  if (
    path.includes("/study/explorer") ||
    path.includes("/study/masters-pgn")
  ) {
    return STUDY_API_TTL_MS;
  }
  return DAY_TTL_MS;
}

export function getApiBase(): string {
  return API_BASE;
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

const EXPLORER_MAX_INFLIGHT = 3;
let explorerInflight = 0;
const explorerWaiters: Array<() => void> = [];

function acquireExplorerSlot(): Promise<void> {
  if (explorerInflight < EXPLORER_MAX_INFLIGHT) {
    explorerInflight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    explorerWaiters.push(() => {
      explorerInflight += 1;
      resolve();
    });
  });
}

function releaseExplorerSlot(): void {
  explorerInflight = Math.max(0, explorerInflight - 1);
  const next = explorerWaiters.shift();
  if (next) next();
}

type ExplorerResponse = {
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
};

export async function fetchExplorer(
  fen: string,
  source: "lichess" | "masters" | "player" = "lichess",
  username?: string,
  color?: "white" | "black",
  ratings?: string
) {
  const coalesceKey = [
    "explorer",
    source,
    fen,
    username || "",
    color || "",
    ratings || "",
  ].join("|");
  return takeInflight(coalesceKey, async () => {
    await acquireExplorerSlot();
    try {
      const params = new URLSearchParams({ fen, source });
      if (username) params.set("username", username);
      if (color) params.set("color", color);
      if (ratings) params.set("ratings", ratings);
      return await getJson<ExplorerResponse>("/api/v1/study/explorer", params);
    } finally {
      releaseExplorerSlot();
    }
  });
}

export async function fetchMastersPgn(gameId: string) {
  return getJson<{ id: string; pgn: string }>(
    `/api/v1/study/masters-pgn/${encodeURIComponent(gameId)}`
  );
}
