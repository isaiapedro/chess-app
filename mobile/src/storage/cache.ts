import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const PREFIX = "@chess-wrapped:v1:";
const DEFAULT_TTL_MS = 15 * 60 * 1000;

export const STUDY_ANALYSIS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PERMANENT_CACHE_TTL_MS = Number.POSITIVE_INFINITY;
export const STUDY_API_TTL_MS = 6 * 60 * 60 * 1000;
export const GAMES_TTL_MS = 60 * 60 * 1000;

type CacheEntry<T> = {
  savedAt: number;
  data: T;
};

type CacheOptions = {
  forceNetwork?: boolean;
  ttlMs?: number;
};

function storageKeyFor(key: string): string {
  return `${PREFIX}${key}`;
}

function debugClearLog(message: string, data: Record<string, unknown>) {
  // #region agent log
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0] || "127.0.0.1";
  fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6d2375",
    },
    body: JSON.stringify({
      sessionId: "6d2375",
      runId: "clear-vault",
      hypothesisId: "H-clear",
      location: "cache.ts",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  console.log(`[clear] ${message}`, data);
  // #endregion
}

export async function readCache<T>(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKeyFor(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.savedAt >= ttlMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  const entry: CacheEntry<T> = { savedAt: Date.now(), data };
  try {
    await AsyncStorage.setItem(storageKeyFor(key), JSON.stringify(entry));
  } catch {
    /* storage full / unavailable */
  }
}

export async function removeCache(key: string): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(storageKeyFor(key));
    return true;
  } catch {
    return false;
  }
}

export async function readThroughCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  let cached: CacheEntry<T> | null = null;

  try {
    const raw = await AsyncStorage.getItem(storageKeyFor(key));
    cached = raw ? (JSON.parse(raw) as CacheEntry<T>) : null;
  } catch {
    cached = null;
  }

  if (
    !options.forceNetwork &&
    cached &&
    Date.now() - cached.savedAt < ttlMs
  ) {
    return cached.data;
  }

  try {
    const data = await fetcher();
    const entry: CacheEntry<T> = { savedAt: Date.now(), data };
    await AsyncStorage.setItem(storageKeyFor(key), JSON.stringify(entry));
    return data;
  } catch (error) {
    if (cached) {
      return cached.data;
    }
    throw error;
  }
}

export async function getCacheAge(key: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKeyFor(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<unknown>;
    return Math.max(0, Date.now() - entry.savedAt);
  } catch {
    return null;
  }
}

export async function clearAppCache(): Promise<number> {
  const keys = await AsyncStorage.getAllKeys();
  const appKeys = keys.filter((key) => key.startsWith(PREFIX));
  const vaultKeys = appKeys.filter(
    (key) =>
      key.includes("study:game-evals") ||
      key.includes("study:style") ||
      key.includes("game-evals")
  );
  debugClearLog("clearAppCache start", {
    totalKeys: keys.length,
    appKeys: appKeys.length,
    vaultKeys: vaultKeys.length,
    vaultSample: vaultKeys.slice(0, 8),
  });

  let removed = 0;
  for (const key of vaultKeys) {
    try {
      await AsyncStorage.removeItem(key);
      removed += 1;
    } catch (err) {
      debugClearLog("vault key remove failed", {
        key,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const remainingApp = (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(PREFIX)
  );
  if (remainingApp.length) {
    try {
      await AsyncStorage.multiRemove(remainingApp);
      removed += remainingApp.length;
    } catch {
      for (const key of remainingApp) {
        try {
          await AsyncStorage.removeItem(key);
          removed += 1;
        } catch {
          /* keep going */
        }
      }
    }
  }

  const after = await AsyncStorage.getAllKeys();
  const leftoverVault = after.filter(
    (key) =>
      key.startsWith(PREFIX) &&
      (key.includes("study:game-evals") || key.includes("study:style"))
  );
  debugClearLog("clearAppCache done", {
    removed,
    leftoverApp: after.filter((k) => k.startsWith(PREFIX)).length,
    leftoverVault: leftoverVault.length,
    leftoverVaultSample: leftoverVault.slice(0, 8),
  });
  return removed;
}
