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
  return `study:mistakes:v12:${studyFiltersKey(filters)}`;
}

export function studyOpeningCacheKey(
  filters: QueryFilters,
  color: "white" | "black",
  openingKey: string
): string {
  return `study:opening:v23:${studyFiltersKey(filters)}:${color}:${part(
    openingKey
  ).toLowerCase()}`;
}
