import type { ImageSourcePropType } from "react-native";
import type { CoachMark } from "./coachMarkClassify";

export type {
  CoachMark,
  CoachEngineLine,
} from "./coachMarkClassify";
export {
  COACH_THEORY_LEAVE_MARKS,
  COACH_MARKS_KEEP_OVER_BOOK,
  COACH_MARK_ORDER,
  classifyCoachWpBand,
  isCoachMistakeOrWorse,
  isForcingEqualOrHigherRecapture,
  classifyCoachMark,
  coachMissedFromPending,
  countCoachMarks,
  countCoachMarksBySide,
  sideAccuracyPct,
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

export const COACH_MARK_LABELS: Record<CoachMark, string> = {
  brilliant: "Brilliant",
  important: "Important",
  best: "Best move",
  excellent: "Excellent",
  good: "Good",
  book: "Book",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  missed: "Miss",
  blunder: "Blunder",
};

export const COACH_MARK_COLORS: Record<CoachMark, string> = {
  brilliant: "#1DC4B4",
  important: "#3B9AE1",
  best: "#34C759",
  excellent: "#7DCE73",
  good: "#A8B5A0",
  book: "#C4B896",
  inaccuracy: "#E8C547",
  mistake: "#E8913A",
  missed: "#D4789A",
  blunder: "#D32531",
};
