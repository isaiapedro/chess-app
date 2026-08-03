export const GLOBAL_DEPTH = 14;
export const GLOBAL_MULTIPV = 1;
export const GLOBAL_THREADS = 2;
export const GLOBAL_HASH_MB = 32;
export const GLOBAL_LOW_END_THREADS = 1;
export const GLOBAL_LOW_END_HASH_MB = 16;
export const GLOBAL_FIRST_SCAN_MAX_GAMES = 50;
export const GLOBAL_MAX_GAMES = 100;

export function resolveScanGameLimit(options: {
  periodCachedCount: number;
  continueScan?: boolean;
  maxGames?: number;
}): number {
  if (options.maxGames != null) {
    return Math.max(0, Math.min(options.maxGames, GLOBAL_MAX_GAMES));
  }
  if (options.continueScan) return GLOBAL_MAX_GAMES;
  if (options.periodCachedCount <= 0) return GLOBAL_FIRST_SCAN_MAX_GAMES;
  return GLOBAL_MAX_GAMES;
}

export const SCAN_DEPTH = 12;
export const SCAN_MOVETIME = 0;
export const HEURISTICS_FIRST_WAVE_GAMES = 12;
export const HEURISTICS_IDLE_BATCH_SIZE = 10;
export const HEURISTICS_MG_SAMPLE_EVERY = 3;
export const HEURISTICS_MG_ISLANDS_EVERY = 5;
export const HEURISTICS_MG_SPACE_EVERY = 5;
export const HEURISTICS_MG_SAFE_EVERY = 5;
export const HEURISTICS_MG_ATTACKERS_EVERY = 3;
export const HEURISTICS_EG_KING_EVERY = 3;
export const HEURISTICS_EG_THEORETICAL_EVERY = 4;
export const HEURISTICS_DOUBLED_PERSIST_PLIES = 3;
export const HEURISTICS_PLY_YIELD_EVERY = 10;
export const EVAL_VAULT_SAVE_EVERY = 5;
export const REFINE_DEPTH = 20;
export const REFINE_MOVETIME = 1200;
export const REFINE_MULTIPV = 2;

export const BATCH_GAMES = 10;
export const MAX_MISTAKE_GAMES = BATCH_GAMES;
export const MAX_MISTAKE_SCAN_GAMES = Number.POSITIVE_INFINITY;
export const MAX_OPENING_GAMES = 3;
export const TARGET_MISTAKE_MOMENTS = 5;
export const TARGET_OPENING_MOMENTS = 3;
export const APPEND_MOMENTS = 3;
export const MIN_CONTINUATION_PLIES = 7;
export const ENGINE_LABEL = "Stockfish 18 lite-single";
