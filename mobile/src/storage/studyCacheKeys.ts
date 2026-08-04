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

export function withoutSpeedFilter(filters: QueryFilters): QueryFilters {
  return { ...filters, speed: null };
}

export function analyticsPeriodKey(filters: QueryFilters): string {
  return studyFiltersKey(withoutSpeedFilter(filters));
}

export function relatedPeriodFilters(filters: QueryFilters): QueryFilters[] {
  const out: QueryFilters[] = [];
  const seen = new Set<string>();
  const period = withoutSpeedFilter(filters);
  const selfKey = studyFiltersKey(period);
  const push = (next: QueryFilters) => {
    const candidate = withoutSpeedFilter(next);
    const key = studyFiltersKey(candidate);
    if (key === selfKey || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  const now = new Date();
  const monthStart = new Date(now);
  monthStart.setDate(monthStart.getDate() - 29);
  monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(now);
  yearStart.setFullYear(yearStart.getFullYear() - 1);
  yearStart.setHours(0, 0, 0, 0);

  if (period.timeframe === "1 month" && period.dateFrom && period.dateTo) {
    push({
      ...period,
      timeframe: "1 month",
      dateFrom: isoDateLocal(monthStart),
      dateTo: isoDateLocal(now),
    });
  }

  if (period.timeframe === "1 month" || period.timeframe === "1 year") {
    push({
      ...period,
      timeframe: "1 year",
      dateFrom: isoDateLocal(yearStart),
      dateTo: isoDateLocal(now),
    });
  }

  if (period.timeframe !== "all") {
    push({
      ...period,
      timeframe: "all",
      dateFrom: null,
      dateTo: null,
    });
  }

  return out;
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

export function studySolvedMistakesCacheKey(
  filters: Pick<QueryFilters, "username" | "platform">
): string {
  return `study:solved-mistakes:v1:${part(filters.username).toLowerCase()}|${part(
    filters.platform
  )}`;
}

export function studyMistakesSessionCacheKey(filters: QueryFilters): string {
  return `study:mistakes-session:v1:${studyFiltersKey(filters)}`;
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
  return `analytics:study-games:v3:${analyticsPeriodKey(filters)}`;
}

export function analyticsRecapCacheKey(filters: QueryFilters): string {
  return `analytics:recap:v2:${analyticsPeriodKey(filters)}`;
}

export function analyticsInsightsCacheKey(filters: QueryFilters): string {
  return `analytics:insights:v2:${analyticsPeriodKey(filters)}`;
}

export function analyticsEndgamePhaseCacheKey(filters: QueryFilters): string {
  return `analytics:endgame-phase:v3:${studyFiltersKey(filters)}`;
}

export function analyticsMiddlegamePhaseCacheKey(filters: QueryFilters): string {
  return `analytics:middlegame-phase:v1:${studyFiltersKey(filters)}`;
}
