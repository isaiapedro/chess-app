import { PERMANENT_CACHE_TTL_MS, readCache, writeCache } from "../../storage/cache";
import type { GameCoachResult } from "./analyzeGame";

export const GAME_COACH_CACHE_VERSION = "v127";

export function gameCoachAnalysisCacheKey(
  platform: string,
  username: string,
  gameId: string
): string {
  return `game-coach:${GAME_COACH_CACHE_VERSION}:${platform}|${username.trim().toLowerCase()}|${gameId}`;
}

export async function loadCachedGameAnalysis(
  platform: string,
  username: string,
  gameId: string
): Promise<GameCoachResult | null> {
  if (!username.trim() || !gameId) return null;
  return readCache<GameCoachResult>(
    gameCoachAnalysisCacheKey(platform, username, gameId),
    PERMANENT_CACHE_TTL_MS
  );
}

export async function saveCachedGameAnalysis(
  platform: string,
  username: string,
  result: GameCoachResult
): Promise<void> {
  if (!username.trim() || !result.gameId) return;
  await writeCache(
    gameCoachAnalysisCacheKey(platform, username, result.gameId),
    result
  );
}
