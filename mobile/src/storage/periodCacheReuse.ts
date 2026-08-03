import type { MistakeItem, QueryFilters } from "../api/client";
import type { OpeningMoment } from "../engine/analyzeOpenings";
import { STUDY_ANALYSIS_TTL_MS, readCache, writeCache } from "./cache";
import {
  relatedPeriodFilters,
  studyMistakesCacheKey,
  studyOpeningCacheKey,
} from "./studyCacheKeys";

export type MistakesCachePayload = {
  moments: MistakeItem[];
  pendingCandidates: MistakeItem[];
  deferredCandidates?: MistakeItem[];
  scannedGameIds: string[];
  remaining: number;
  thresholdPass?: "strict" | "baseline";
  baselineAvailable?: boolean;
};

export type OpeningCachePayload = {
  moments: OpeningMoment[];
  pendingCandidates: OpeningMoment[];
  deferredCandidates?: OpeningMoment[];
  scannedGameIds: string[];
  remaining: number;
  thresholdPass?: "strict" | "baseline";
  baselineAvailable?: boolean;
};

function filterMomentsByGameIds<T extends { game_id: string }>(
  moments: T[],
  periodIds: Set<string>
): T[] {
  return moments.filter((item) => periodIds.has(String(item.game_id)));
}

function intersectScannedIds(
  scanned: string[] | undefined,
  periodIds: Set<string>
): string[] {
  return (scanned || []).filter((id) => periodIds.has(String(id)));
}

export async function readMistakesCacheForPeriod(
  filters: QueryFilters,
  periodGameIds: string[]
): Promise<MistakesCachePayload | null> {
  const direct = await readCache<MistakesCachePayload>(
    studyMistakesCacheKey(filters),
    STUDY_ANALYSIS_TTL_MS
  );
  if (direct?.moments?.length) return direct;

  const periodIds = new Set(periodGameIds.map(String));
  if (!periodIds.size) return null;

  for (const related of relatedPeriodFilters(filters)) {
    const parent = await readCache<MistakesCachePayload>(
      studyMistakesCacheKey(related),
      STUDY_ANALYSIS_TTL_MS
    );
    if (!parent?.moments?.length) continue;
    const moments = filterMomentsByGameIds(parent.moments, periodIds);
    if (!moments.length) continue;
    const pendingCandidates = filterMomentsByGameIds(
      parent.pendingCandidates || [],
      periodIds
    );
    const deferredCandidates = filterMomentsByGameIds(
      parent.deferredCandidates || [],
      periodIds
    );
    const payload: MistakesCachePayload = {
      moments,
      pendingCandidates,
      deferredCandidates,
      scannedGameIds: intersectScannedIds(parent.scannedGameIds, periodIds),
      remaining: pendingCandidates.length + deferredCandidates.length,
      thresholdPass: parent.thresholdPass,
      baselineAvailable: parent.baselineAvailable,
    };
    await writeCache(studyMistakesCacheKey(filters), payload);
    return payload;
  }
  return null;
}

export async function readOpeningCacheForPeriod(
  filters: QueryFilters,
  color: "white" | "black",
  openingKey: string,
  periodGameIds: string[]
): Promise<OpeningCachePayload | null> {
  const direct = await readCache<OpeningCachePayload>(
    studyOpeningCacheKey(filters, color, openingKey),
    STUDY_ANALYSIS_TTL_MS
  );
  if (direct?.moments?.length) return direct;

  const periodIds = new Set(periodGameIds.map(String));
  if (!periodIds.size) return null;

  for (const related of relatedPeriodFilters(filters)) {
    const parent = await readCache<OpeningCachePayload>(
      studyOpeningCacheKey(related, color, openingKey),
      STUDY_ANALYSIS_TTL_MS
    );
    if (!parent?.moments?.length) continue;
    const moments = filterMomentsByGameIds(parent.moments, periodIds);
    if (!moments.length) continue;
    const pendingCandidates = filterMomentsByGameIds(
      parent.pendingCandidates || [],
      periodIds
    );
    const deferredCandidates = filterMomentsByGameIds(
      parent.deferredCandidates || [],
      periodIds
    );
    const payload: OpeningCachePayload = {
      moments,
      pendingCandidates,
      deferredCandidates,
      scannedGameIds: intersectScannedIds(parent.scannedGameIds, periodIds),
      remaining: pendingCandidates.length + deferredCandidates.length,
      thresholdPass: parent.thresholdPass,
      baselineAvailable: parent.baselineAvailable,
    };
    await writeCache(
      studyOpeningCacheKey(filters, color, openingKey),
      payload
    );
    return payload;
  }
  return null;
}
