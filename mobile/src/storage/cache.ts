import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "@chess-wrapped:v1:";
const DEFAULT_TTL_MS = 15 * 60 * 1000;

type CacheEntry<T> = {
  savedAt: number;
  data: T;
};

type CacheOptions = {
  forceNetwork?: boolean;
  ttlMs?: number;
};

export async function readThroughCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const storageKey = `${PREFIX}${key}`;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  let cached: CacheEntry<T> | null = null;

  try {
    const raw = await AsyncStorage.getItem(storageKey);
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
    await AsyncStorage.setItem(storageKey, JSON.stringify(entry));
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
    const raw = await AsyncStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<unknown>;
    return Math.max(0, Date.now() - entry.savedAt);
  } catch {
    return null;
  }
}

export async function clearAppCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const appKeys = keys.filter((key) => key.startsWith(PREFIX));
  if (appKeys.length) {
    await AsyncStorage.multiRemove(appKeys);
  }
}
