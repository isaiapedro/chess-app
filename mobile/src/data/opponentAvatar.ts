import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Platform } from "../api/types";
import { getPlatformGamesAuth } from "../data/platformGames";

const CACHE_PREFIX = "@chess-wrapped:opp-avatar:v1:";
const memory = new Map<string, string | null>();

function cacheKey(platform: Platform, username: string): string {
  return `${CACHE_PREFIX}${platform}|${username.trim().toLowerCase()}`;
}

function chesscomUserAgent(): string {
  const email = (getPlatformGamesAuth().email || "dev@example.com").trim();
  return `ChessWrappedMobile/1.0 (contact: ${email})`;
}

async function fetchChesscomAvatar(username: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.chess.com/pub/player/${encodeURIComponent(username)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": chesscomUserAgent(),
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { avatar?: string };
    const url = String(data.avatar || "").trim();
    return url || null;
  } catch {
    return null;
  }
}

export async function resolveOpponentAvatarUrl(
  platform: Platform,
  username: string | null | undefined
): Promise<string | null> {
  const name = String(username || "").trim();
  if (!name || name === "Unknown") return null;
  const key = cacheKey(platform, name);
  if (memory.has(key)) return memory.get(key) ?? null;

  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached != null) {
      const url = cached || null;
      memory.set(key, url);
      return url;
    }
  } catch {
    /* ignore */
  }

  let url: string | null = null;
  if (platform === "chesscom") {
    url = await fetchChesscomAvatar(name);
  }

  memory.set(key, url);
  try {
    await AsyncStorage.setItem(key, url || "");
  } catch {
    /* ignore */
  }
  return url;
}

export function formatOpponentName(
  name: string | null | undefined,
  rating: number | null | undefined
): string {
  const label = String(name || "Unknown").trim() || "Unknown";
  if (rating != null && Number.isFinite(rating) && rating > 0) {
    return `${label} (${Math.round(rating)})`;
  }
  return label;
}
