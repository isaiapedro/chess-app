import type { Platform } from "../../api/types";
import { readCache, PERMANENT_CACHE_TTL_MS } from "../../storage/cache";
import { studyHeuristicsStoreCacheKey } from "../../storage/studyCacheKeys";
import {
  loadPermanentEvalStore,
  type GlobalGameRecord,
} from "../globalAnalysis";
import {
  buildCoachGameMetrics,
  emptyCoachGameMetrics,
  enrichMomentsWithPlies,
  ensureFixedOpeningMoments,
  isCriticalCoachMoment,
  upsertLiveMoment,
  type CoachGameMetrics,
  type CoachHeuristicEntry,
  type CoachMetricMoment,
} from "./coachGameMetrics";

export type { CoachGameMetrics, CoachMetricMoment, CoachHeuristicEntry };
export {
  buildCoachGameMetrics,
  emptyCoachGameMetrics,
  enrichMomentsWithPlies,
  ensureFixedOpeningMoments,
  isCriticalCoachMoment,
  upsertLiveMoment,
};

type HeuristicStore = {
  games: Record<string, CoachHeuristicEntry>;
};

/**
 * Lookup already-calculated vault + heuristic metrics for one game.
 */
export async function lookupCoachGameMetrics(options: {
  platform: Platform;
  username: string;
  gameId: string;
  userColor?: string | null;
}): Promise<CoachGameMetrics> {
  const filters = {
    platform: options.platform,
    username: options.username,
  };
  const gameId = String(options.gameId);

  const [vault, heuristicsCached] = await Promise.all([
    loadPermanentEvalStore(filters),
    readCache<HeuristicStore>(
      studyHeuristicsStoreCacheKey(filters),
      PERMANENT_CACHE_TTL_MS
    ),
  ]);

  const record = vault.games[gameId] || null;
  const heuristics = heuristicsCached?.games?.[gameId] || null;

  return buildCoachGameMetrics({
    record: record as GlobalGameRecord | null,
    heuristics,
    userColor: options.userColor,
  });
}
