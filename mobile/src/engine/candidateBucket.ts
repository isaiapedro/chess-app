import type { MistakeItem, QueryFilters } from "../api/client";
import {
  readCache,
  writeCache,
  PERMANENT_CACHE_TTL_MS,
} from "../storage/cache";
import { studyGameEvalsCacheKey } from "../storage/studyCacheKeys";
import type { GlobalGameRecord } from "./globalAnalysis";
import type { OpeningMoment } from "./analyzeOpenings";

export type CandidateKind = "mistake" | "opening";

type PermanentEvalStore = {
  games: Record<string, GlobalGameRecord>;
  consumedMistakeKeys?: string[];
  consumedOpeningKeys?: string[];
};

export function candidateKey(item: {
  game_id: string;
  ply: number;
}): string {
  return `${item.game_id}:${item.ply}`;
}

export function selectRecentPeriodCandidates<
  T extends { game_id: string; created_at: string; ply: number }
>(options: {
  candidates: T[];
  periodGameIds: Set<string> | string[];
  consumedKeys?: Set<string> | string[];
  limit: number;
}): T[] {
  const period = new Set(
    [...options.periodGameIds].map(String).filter(Boolean)
  );
  const consumed = new Set(
    [...(options.consumedKeys || [])].map(String).filter(Boolean)
  );
  return [...options.candidates]
    .filter(
      (item) =>
        period.has(String(item.game_id)) &&
        !consumed.has(candidateKey(item))
    )
    .sort((a, b) => {
      const byDate = String(b.created_at).localeCompare(String(a.created_at));
      if (byDate !== 0) return byDate;
      return a.ply - b.ply;
    })
    .slice(0, Math.max(0, options.limit));
}

export type PeriodCandidatePools<
  T extends { game_id: string; created_at: string; ply: number }
> = {
  batch: T[];
  reservoir: T[];
};

export function periodCandidatePools<
  T extends { game_id: string; created_at: string; ply: number }
>(options: {
  candidates: T[];
  periodGameIds: Set<string> | string[];
  consumedKeys?: Set<string> | string[];
  batchLimit: number;
}): PeriodCandidatePools<T> {
  const reservoir = selectRecentPeriodCandidates({
    candidates: options.candidates,
    periodGameIds: options.periodGameIds,
    consumedKeys: options.consumedKeys,
    limit: Number.MAX_SAFE_INTEGER,
  });
  return {
    batch: reservoir.slice(0, Math.max(0, options.batchLimit)),
    reservoir,
  };
}

export async function loadConsumedKeys(
  filters: Pick<QueryFilters, "username" | "platform">
): Promise<{ mistake: Set<string>; opening: Set<string> }> {
  const cached = await readCache<PermanentEvalStore>(
    studyGameEvalsCacheKey(filters),
    PERMANENT_CACHE_TTL_MS
  );
  return {
    mistake: new Set(cached?.consumedMistakeKeys || []),
    opening: new Set(cached?.consumedOpeningKeys || []),
  };
}

export async function consumeCandidates(
  filters: Pick<QueryFilters, "username" | "platform">,
  kind: CandidateKind,
  items: Array<{ game_id: string; ply: number }>
): Promise<void> {
  if (!items.length) return;
  const key = studyGameEvalsCacheKey(filters);
  const vault =
    (await readCache<PermanentEvalStore>(key, PERMANENT_CACHE_TTL_MS)) || {
      games: {},
    };
  const consumedField =
    kind === "mistake" ? "consumedMistakeKeys" : "consumedOpeningKeys";
  const candidateField =
    kind === "mistake" ? "mistakeCandidates" : "openingCandidates";
  const nextConsumed = new Set(vault[consumedField] || []);
  const games = { ...vault.games };

  for (const item of items) {
    const ck = candidateKey(item);
    nextConsumed.add(ck);
    const game = games[String(item.game_id)];
    if (!game) continue;
    const list = (game[candidateField] || []) as MistakeItem[];
    games[String(item.game_id)] = {
      ...game,
      [candidateField]: list.filter((row) => candidateKey(row) !== ck),
    };
  }

  await writeCache(key, {
    ...vault,
    games,
    [consumedField]: [...nextConsumed],
  } satisfies PermanentEvalStore);
}

export function stubOpeningMoment(item: MistakeItem): OpeningMoment {
  return {
    ...item,
    winrate_played: null,
    winrate_best: null,
    winrate_gap: null,
    games_played: null,
    games_best: null,
    popularity_pct: null,
    popularity_drop_pct: null,
    path_frequency_pct: null,
    path_rank: null,
    frequency_note: null,
    frequency_debug: null,
    compound_table: [],
    source: "eval",
    alt_moves: [],
    best_pv: item.best_uci ? [item.best_uci] : [],
    priority_score:
      (item as MistakeItem & { priority_score?: number }).priority_score ??
      item.eval_drop_cp,
  };
}
