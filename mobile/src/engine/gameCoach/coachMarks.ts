import type { ImageSourcePropType } from "react-native";
import {
  classifyEvalDrop,
  userWinProbability,
  type EvalDropKind,
} from "../winProb";

export type CoachMark =
  | "book"
  | "best"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export const COACH_MARK_SOURCES: Record<CoachMark, ImageSourcePropType> = {
  book: require("../../../assets/coach/textbook-chess.gif"),
  best: require("../../../assets/coach/chess-great-move.gif"),
  inaccuracy: require("../../../assets/coach/chess-inaccuracy.gif"),
  mistake: require("../../../assets/coach/chess-mistake.gif"),
  blunder: require("../../../assets/coach/chess-blunder.gif"),
};

/**
 * Same WP thresholds as middlegame metrics:
 * blunder >15pp, mistake 10–15pp, inaccuracy 5–10pp.
 * "best" when the played move matches the engine's top choice.
 */
export function classifyCoachMark(args: {
  side: "white" | "black";
  evalBeforeCp: number | null;
  evalAfterCp: number | null;
  playedBest: boolean;
}): CoachMark | null {
  if (args.playedBest) return "best";
  if (args.evalBeforeCp == null || args.evalAfterCp == null) return null;
  const userIsWhite = args.side === "white";
  const wpBefore = userWinProbability(args.evalBeforeCp, userIsWhite);
  const wpAfter = userWinProbability(args.evalAfterCp, userIsWhite);
  return classifyEvalDrop(wpBefore, wpAfter);
}

export type { EvalDropKind };
