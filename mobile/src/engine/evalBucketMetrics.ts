import type { StudyGame } from "./analyzeMistakes";
import type { EndgameGameRow, TheoreticalKey } from "./endgamePhase";
import {
  mergeMiddlegameHeuristicWithBucket,
  type MiddlegameEvalBucket,
  type MiddlegameGameRow,
} from "./middlegamePhase";
import {
  analyzeStyleGame,
  type EndgameEvalBucket,
  type EvalBucketExtras,
  type StyleGameRow,
} from "./styleMetrics";

export type { EndgameEvalBucket, MiddlegameEvalBucket };

export type EvalBucketMetrics = {
  opening_accuracy_pct: number | null;
  opening_accuracy_moves: number;
  endgameEval: EndgameEvalBucket | null;
  middlegameEval: MiddlegameEvalBucket | null;
  style: StyleGameRow | null;
};

export function analyzeEvalBucketMetrics(
  game: StudyGame,
  evalsWhiteCp: number[]
): EvalBucketMetrics {
  if (!evalsWhiteCp.length) {
    return {
      opening_accuracy_pct: null,
      opening_accuracy_moves: 0,
      endgameEval: null,
      middlegameEval: null,
      style: null,
    };
  }
  const extras: EvalBucketExtras = {
    opening_accuracy_pct: null,
    opening_accuracy_moves: 0,
    endgameEval: null,
    middlegameEval: null,
  };
  const style = analyzeStyleGame(game, evalsWhiteCp, extras);
  return {
    opening_accuracy_pct: extras.opening_accuracy_pct,
    opening_accuracy_moves: extras.opening_accuracy_moves,
    endgameEval: extras.endgameEval,
    middlegameEval: extras.middlegameEval,
    style,
  };
}

export function mergeEndgameHeuristicWithBucket(
  heuristic: {
    reached_endgame: boolean;
    endgame_start_ply: number | null;
    king_centralization: number | null;
    king_distance: number | null;
    pawn_diff: number | null;
    theoretical: Partial<Record<TheoreticalKey, true>>;
    theoretical_saved: boolean;
    result: string;
  },
  bucket: EndgameEvalBucket | null | undefined
): EndgameGameRow {
  return {
    reached_endgame: heuristic.reached_endgame,
    endgame_start_ply: heuristic.endgame_start_ply,
    blunders: bucket?.blunders ?? 0,
    king_centralization: heuristic.king_centralization,
    king_distance: heuristic.king_distance,
    pawn_diff: heuristic.pawn_diff,
    piece_trades: bucket?.piece_trades ?? 0,
    beneficial_trades: bucket?.beneficial_trades ?? 0,
    winning_trades: bucket?.winning_trades ?? 0,
    simplification_trades: bucket?.simplification_trades ?? 0,
    mate_episodes: bucket?.mate_episodes ?? 0,
    mate_converted: bucket?.mate_converted ?? 0,
    accidental_stalemate: bucket?.accidental_stalemate ?? false,
    mate_move_times: bucket?.mate_move_times ?? [],
    theoretical: heuristic.theoretical,
    theoretical_saved: heuristic.theoretical_saved,
    result: heuristic.result,
  };
}

export { mergeMiddlegameHeuristicWithBucket };
export type { MiddlegameGameRow };
