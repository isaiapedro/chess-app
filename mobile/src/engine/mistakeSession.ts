import type { MistakeItem, QueryFilters } from "../api/client";
import { TARGET_MISTAKE_MOMENTS } from "./analysisConfig";
import { candidateKey } from "./candidateBucket";
import {
  PERMANENT_CACHE_TTL_MS,
  readCache,
  writeCache,
} from "../storage/cache";
import {
  studyMistakesSessionCacheKey,
  studySolvedMistakesCacheKey,
} from "../storage/studyCacheKeys";

export const MISTAKES_SESSION_ROLLOVER_HOUR = 4;

export type MistakesSessionPayload = {
  sessionId: string;
  moments: MistakeItem[];
  completedKeys: string[];
};

type SolvedMistakesPayload = {
  keys: string[];
};

export function mistakesSessionId(now = new Date()): string {
  const boundary = new Date(now);
  if (boundary.getHours() < MISTAKES_SESSION_ROLLOVER_HOUR) {
    boundary.setDate(boundary.getDate() - 1);
  }
  const year = boundary.getFullYear();
  const month = String(boundary.getMonth() + 1).padStart(2, "0");
  const day = String(boundary.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function loadSolvedMistakeKeys(
  filters: Pick<QueryFilters, "username" | "platform">
): Promise<Set<string>> {
  const cached = await readCache<SolvedMistakesPayload>(
    studySolvedMistakesCacheKey(filters),
    PERMANENT_CACHE_TTL_MS
  );
  return new Set(cached?.keys || []);
}

export async function markMistakesSolved(
  filters: Pick<QueryFilters, "username" | "platform">,
  items: Array<{ game_id: string; ply: number }>
): Promise<Set<string>> {
  if (!items.length) return loadSolvedMistakeKeys(filters);
  const next = await loadSolvedMistakeKeys(filters);
  for (const item of items) next.add(candidateKey(item));
  await writeCache(studySolvedMistakesCacheKey(filters), {
    keys: [...next],
  } satisfies SolvedMistakesPayload);
  return next;
}

export async function loadMistakesSession(
  filters: QueryFilters
): Promise<MistakesSessionPayload | null> {
  const cached = await readCache<MistakesSessionPayload>(
    studyMistakesSessionCacheKey(filters),
    PERMANENT_CACHE_TTL_MS
  );
  if (!cached?.sessionId) return null;
  if (cached.sessionId !== mistakesSessionId()) return null;
  return {
    sessionId: cached.sessionId,
    moments: Array.isArray(cached.moments) ? cached.moments : [],
    completedKeys: Array.isArray(cached.completedKeys)
      ? cached.completedKeys
      : [],
  };
}

export async function saveMistakesSession(
  filters: QueryFilters,
  payload: MistakesSessionPayload
): Promise<void> {
  await writeCache(studyMistakesSessionCacheKey(filters), {
    sessionId: payload.sessionId,
    moments: payload.moments.slice(0, TARGET_MISTAKE_MOMENTS),
    completedKeys: [...new Set(payload.completedKeys)],
  } satisfies MistakesSessionPayload);
}

export function filterUnsolvedMoments<T extends { game_id: string; ply: number }>(
  moments: T[],
  solved: Set<string>
): T[] {
  if (!solved.size) return moments;
  return moments.filter((item) => !solved.has(candidateKey(item)));
}

export function mergeSessionMoments(
  sessionMoments: MistakeItem[],
  incoming: MistakeItem[],
  solved: Set<string>,
  limit = TARGET_MISTAKE_MOMENTS
): MistakeItem[] {
  const kept = sessionMoments.slice(0, limit);
  if (kept.length >= limit) return kept;
  const seen = new Set(kept.map((item) => candidateKey(item)));
  const additions: MistakeItem[] = [];
  for (const item of incoming) {
    const key = candidateKey(item);
    if (seen.has(key) || solved.has(key)) continue;
    seen.add(key);
    additions.push(item);
    if (kept.length + additions.length >= limit) break;
  }
  return [...kept, ...additions].slice(0, limit);
}

export function capMistakeMoments(
  moments: MistakeItem[],
  limit = TARGET_MISTAKE_MOMENTS
): MistakeItem[] {
  return moments.slice(0, Math.max(0, limit));
}
