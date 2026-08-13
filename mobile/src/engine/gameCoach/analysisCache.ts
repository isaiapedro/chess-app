import { PERMANENT_CACHE_TTL_MS, readCache, writeCache } from "../../storage/cache";
import type { GameCoachResult } from "./analyzeGame";

function cacheKey(platform: string, username: string, gameId: string): string {
  return `game-coach:v51:${platform}|${username.trim().toLowerCase()}|${gameId}`;
}

export async function loadCachedGameAnalysis(
  platform: string,
  username: string,
  gameId: string
): Promise<GameCoachResult | null> {
  if (!username.trim() || !gameId) return null;
  return readCache<GameCoachResult>(
    cacheKey(platform, username, gameId),
    PERMANENT_CACHE_TTL_MS
  );
}

export async function saveCachedGameAnalysis(
  platform: string,
  username: string,
  result: GameCoachResult
): Promise<void> {
  if (!username.trim() || !result.gameId) return;
  await writeCache(cacheKey(platform, username, result.gameId), result);
}
