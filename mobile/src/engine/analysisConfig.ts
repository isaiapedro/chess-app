export const GLOBAL_DEPTH = 14;
export const GLOBAL_MULTIPV = 1;
export const GLOBAL_THREADS = 2;
export const GLOBAL_HASH_MB = 32;
export const GLOBAL_MAX_GAMES = 100;

export const SCAN_DEPTH = GLOBAL_DEPTH;
export const SCAN_MOVETIME = 0;
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
