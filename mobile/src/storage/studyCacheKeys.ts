import type { QueryFilters } from "../api/client";

function part(value: string | null | undefined): string {
  return value && value.length ? value : "_";
}

export function studyFiltersKey(filters: QueryFilters): string {
  return [
    part(filters.username).toLowerCase(),
    part(filters.platform),
    part(filters.timeframe),
    part(filters.speed),
    part(filters.color),
    part(filters.result),
    part(filters.dateFrom),
    part(filters.dateTo),
  ].join("|");
}

export function studyMistakesCacheKey(filters: QueryFilters): string {
  return `study:mistakes:v13:${studyFiltersKey(filters)}`;
}

export function studyOpeningCacheKey(
  filters: QueryFilters,
  color: "white" | "black",
  openingKey: string
): string {
  return `study:opening:v24:${studyFiltersKey(filters)}:${color}:${part(
    openingKey
  ).toLowerCase()}`;
}

export function studyGameEvalsCacheKey(
  filters: Pick<QueryFilters, "username" | "platform">
): string {
  return `study:game-evals:v2:${part(filters.username).toLowerCase()}|${part(
    filters.platform
  )}`;
}

export function studyStyleCacheKey(filters: QueryFilters): string {
  return `study:style:v2:${studyFiltersKey(filters)}`;
}

export function analyticsOpeningMixCacheKey(filters: QueryFilters): string {
  return `analytics:opening-mix:v1:${studyFiltersKey(filters)}`;
}

export function analyticsOpeningPhaseCacheKey(filters: QueryFilters): string {
  return `analytics:opening-phase:v2:${studyFiltersKey(filters)}`;
}

export function analyticsVaultHeuristicsCacheKey(filters: QueryFilters): string {
  return `analytics:vault-heuristics:v2:${studyFiltersKey(filters)}`;
}

export function analyticsStudyGamesCacheKey(filters: QueryFilters): string {
  return `analytics:study-games:v1:${studyFiltersKey(filters)}`;
}

export function analyticsRecapCacheKey(filters: QueryFilters): string {
  return `analytics:recap:v1:${studyFiltersKey(filters)}`;
}

export function analyticsInsightsCacheKey(filters: QueryFilters): string {
  return `analytics:insights:v1:${studyFiltersKey(filters)}`;
}

export function analyticsEndgamePhaseCacheKey(filters: QueryFilters): string {
  return `analytics:endgame-phase:v3:${studyFiltersKey(filters)}`;
}

export function analyticsMiddlegamePhaseCacheKey(filters: QueryFilters): string {
  return `analytics:middlegame-phase:v1:${studyFiltersKey(filters)}`;
}
