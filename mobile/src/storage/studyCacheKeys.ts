import type { QueryFilters } from "../api/client";

function part(value: string | null | undefined): string {
  return value && value.length ? value : "_";
}

function isoDateLocal(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function relatedPeriodFilters(filters: QueryFilters): QueryFilters[] {
  if (filters.timeframe !== "1 month" || !filters.dateFrom || !filters.dateTo) {
    return [];
  }
  const now = new Date();
  const monthStart = new Date(now);
  monthStart.setDate(monthStart.getDate() - 29);
  monthStart.setHours(0, 0, 0, 0);
  const monthFrom = isoDateLocal(monthStart);
  const monthTo = isoDateLocal(now);
  if (filters.dateFrom === monthFrom && filters.dateTo === monthTo) {
    return [];
  }
  return [
    {
      ...filters,
      dateFrom: monthFrom,
      dateTo: monthTo,
    },
  ];
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

export function studyHeuristicsStoreCacheKey(
  filters: Pick<QueryFilters, "username" | "platform">
): string {
  return `study:heuristics-store:v1:${part(filters.username).toLowerCase()}|${part(
    filters.platform
  )}`;
}

export function studyStyleCacheKey(filters: QueryFilters): string {
  return `study:style:v2:${studyFiltersKey(filters)}`;
}

export function analyticsOpeningMixCacheKey(filters: QueryFilters): string {
  return `analytics:opening-mix:v2:${studyFiltersKey(filters)}`;
}

export function analyticsOpeningPhaseCacheKey(filters: QueryFilters): string {
  return `analytics:opening-phase:v2:${studyFiltersKey(filters)}`;
}

export function analyticsVaultHeuristicsCacheKey(filters: QueryFilters): string {
  return `analytics:vault-heuristics:v3:${studyFiltersKey(filters)}`;
}

export function analyticsStudyGamesCacheKey(filters: QueryFilters): string {
  return `analytics:study-games:v2:${studyFiltersKey(filters)}`;
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
