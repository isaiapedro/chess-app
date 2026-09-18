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
export const HEURISTICS_MG_ATTACKERS_EVERY = 1;
export const HEURISTICS_EG_KING_EVERY = 3;
export const HEURISTICS_EG_THEORETICAL_EVERY = 4;
export const HEURISTICS_STRUCTURE_PERSIST_PLIES = 4;
export const HEURISTICS_DOUBLED_PERSIST_PLIES =
  HEURISTICS_STRUCTURE_PERSIST_PLIES;

export function structurePersistStartPly1(
  endPly1: number,
  persistPlies = HEURISTICS_STRUCTURE_PERSIST_PLIES
): number {
  return Math.max(1, endPly1 - (persistPlies - 1));
}
export const HEURISTICS_PLY_YIELD_EVERY = 10;
export const EVAL_VAULT_SAVE_EVERY = 5;

/** Games analyze + annotate: metrics/accuracy first pass. */
export const COACH_ANALYZE_DEPTH = 18;
export const COACH_ANALYZE_MOVETIME = 1000;
export const COACH_ANALYZE_MULTIPV = 2;

/**
 * Games analyze + annotate: deepen when user ply is mistake / missed / blunder.
 * MultiPV 1 — long PV for engine line vs played+engine continuation metrics.
 */
export const COACH_CRITICAL_DEPTH = 22;
export const COACH_CRITICAL_MOVETIME = 2500;
export const COACH_CRITICAL_MULTIPV = 1;

/** Study / mistake / opening puzzle refine (= coach critical). */
export const REFINE_DEPTH = COACH_CRITICAL_DEPTH;
export const REFINE_MOVETIME = COACH_CRITICAL_MOVETIME;
export const REFINE_MULTIPV = COACH_CRITICAL_MULTIPV;

/** Live scrub on Games analysis: depth-capped, no movetime, MultiPV 3. */
export const LIVE_EVAL_DEPTH = 22;
export const LIVE_EVAL_MOVETIME = 0;
export const LIVE_EVAL_MULTIPV = 3;
/** Eval bar fill animation: percentage-points per second (constant speed). */
export const EVAL_BAR_SPEED_PCT_PER_SEC = 55;

export const BATCH_GAMES = 10;
export const MAX_MISTAKE_GAMES = BATCH_GAMES;
export const MAX_MISTAKE_SCAN_GAMES = Number.POSITIVE_INFINITY;
export const MAX_OPENING_GAMES = 3;
export const TARGET_MISTAKE_MOMENTS = 5;
export const TARGET_OPENING_MOMENTS = 3;
export const APPEND_MOMENTS = 3;
export const MIN_CONTINUATION_PLIES = 7;
export const ENGINE_LABEL = "Stockfish 18 lite-single";
