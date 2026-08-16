import type { ImageSourcePropType } from "react-native";
import type { CoachMark } from "./coachMarkClassify";

export type {
  CoachMark,
  CoachEngineLine,
} from "./coachMarkClassify";
export {
  COACH_THEORY_LEAVE_MARKS,
  COACH_MARKS_KEEP_OVER_BOOK,
  classifyCoachWpBand,
  isCoachMistakeOrWorse,
  isForcingEqualOrHigherRecapture,
  classifyCoachMark,
  coachMissedFromPending,
} from "./coachMarkClassify";

export const COACH_MARK_SOURCES: Record<CoachMark, ImageSourcePropType> = {
  book: require("../../../assets/coach/textbook-chess.gif"),
  best: require("../../../assets/coach/chess-best-move.gif"),
  important: require("../../../assets/coach/chess-great-move.gif"),
  excellent: require("../../../assets/coach/chess-excellent-move.gif"),
  good: require("../../../assets/coach/chess-good-move.gif"),
  brilliant: require("../../../assets/coach/chess-brilliant-move.gif"),
  missed: require("../../../assets/coach/chess-missed-opportunity.gif"),
  inaccuracy: require("../../../assets/coach/chess-inaccuracy.gif"),
  mistake: require("../../../assets/coach/chess-mistake.gif"),
  blunder: require("../../../assets/coach/chess-blunder.gif"),
};
