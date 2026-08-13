import { Chess, type Color, type Move } from "chess.js";
import type { ImageSourcePropType } from "react-native";
import {
  SACRIFICE_MIN_OFFER,
  STYLE_PIECE_VALUE,
  sacrificeOfferAfterMove,
} from "../styleMetrics";
import {
  userWinProbability,
  wpDropPp,
  type EvalDropKind,
} from "../winProb";

export type CoachMark =
  | "book"
  | "best"
  | "important"
  | "excellent"
  | "good"
  | "brilliant"
  | "missed"
  | "inaccuracy"
  | "mistake"
  | "blunder";

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

export const COACH_THEORY_LEAVE_MARKS = new Set<CoachMark>([
  "inaccuracy",
  "mistake",
  "blunder",
  "missed",
]);

const IMPORTANT_PV_GAP = 0.1;
const BRILLIANT_WP_BEFORE_MAX = 0.85;
const BRILLIANT_WP_AFTER_MIN = 0.4;

export type CoachEngineLine = {
  rank: number;
  san: string;
  cpWhite: number;
};

function coachWpDrop(wpBefore: number, wpAfter: number): number {
  return Math.max(0, wpBefore - wpAfter);
}

export function classifyCoachWpBand(wpDrop: number): CoachMark | null {
  if (wpDrop >= 0.2) return "blunder";
  if (wpDrop >= 0.1) return "mistake";
  if (wpDrop >= 0.05) return "inaccuracy";
  if (wpDrop >= 0.02) return "good";
  if (wpDrop >= 0) return "excellent";
  return null;
}

export function isCoachMistakeOrWorse(mark: CoachMark | null): boolean {
  return mark === "mistake" || mark === "blunder" || mark === "missed";
}

function importantFromLines(
  lines: CoachEngineLine[] | undefined,
  playedBest: boolean,
  side: "white" | "black"
): boolean {
  if (!playedBest || !lines || lines.length < 2) return false;
  const userIsWhite = side === "white";
  const wp1 = userWinProbability(lines[0].cpWhite, userIsWhite);
  const wp2 = userWinProbability(lines[1].cpWhite, userIsWhite);
  return wp1 - wp2 >= IMPORTANT_PV_GAP;
}

/**
 * Routine forcing recapture of equal-or-higher value (QxQ, RxR, …) —
 * not "important", just the only sensible take-back.
 */
export function isForcingEqualOrHigherRecapture(
  fenBefore: string,
  playedSan: string
): boolean {
  try {
    const before = new Chess(fenBefore);
    const legal = before.moves({ verbose: true });
    const move = before.move(playedSan) as Move | null;
    if (!move?.isCapture() || !move.captured) return false;

    const moverVal = STYLE_PIECE_VALUE[move.piece] ?? 0;
    const capVal = STYLE_PIECE_VALUE[move.captured] ?? 0;
    if (capVal + 1e-9 < moverVal) return false;

    const givesCheck = before.inCheck();
    const equalOrBetterCaps = legal.filter((m) => {
      if (!m.captured) return false;
      const mv = STYLE_PIECE_VALUE[m.piece] ?? 0;
      const cv = STYLE_PIECE_VALUE[m.captured] ?? 0;
      return cv + 1e-9 >= mv;
    });
    const uniqueRecapture = equalOrBetterCaps.length === 1;
    const sameSquareRecaptures = equalOrBetterCaps.filter(
      (m) => m.to === move.to
    );
    const onlyWayOnSquare = sameSquareRecaptures.length === 1;

    return givesCheck || uniqueRecapture || onlyWayOnSquare;
  } catch {
    return false;
  }
}

function brilliantSacrifice(args: {
  fenBefore: string;
  playedSan: string;
  side: "white" | "black";
  playedBest: boolean;
  wpDrop: number;
  wpBefore: number;
  wpAfter: number;
}): boolean {
  if (args.wpBefore >= BRILLIANT_WP_BEFORE_MAX) return false;
  if (args.wpAfter < BRILLIANT_WP_AFTER_MIN) return false;
  if (!(args.playedBest || args.wpDrop < 0.02)) return false;
  try {
    const board = new Chess(args.fenBefore);
    const color: Color = args.side === "white" ? "w" : "b";
    const move = board.move(args.playedSan) as Move | null;
    if (!move) return false;
    return sacrificeOfferAfterMove(board, move, color) >= SACRIFICE_MIN_OFFER;
  } catch {
    return false;
  }
}

export function classifyCoachMark(args: {
  side: "white" | "black";
  evalBeforeCp: number | null;
  evalAfterCp: number | null;
  playedBest: boolean;
  lines?: CoachEngineLine[];
  fenBefore?: string;
  playedSan?: string;
  missedOpportunity?: boolean;
}): CoachMark | null {
  if (args.missedOpportunity) return "missed";
  if (args.evalBeforeCp == null || args.evalAfterCp == null) {
    return args.playedBest ? "best" : null;
  }

  const userIsWhite = args.side === "white";
  const wpBefore = userWinProbability(args.evalBeforeCp, userIsWhite);
  const wpAfter = userWinProbability(args.evalAfterCp, userIsWhite);
  const wpDrop = coachWpDrop(wpBefore, wpAfter);

  if (
    args.fenBefore &&
    args.playedSan &&
    brilliantSacrifice({
      fenBefore: args.fenBefore,
      playedSan: args.playedSan,
      side: args.side,
      playedBest: args.playedBest,
      wpDrop,
      wpBefore,
      wpAfter,
    })
  ) {
    return "brilliant";
  }

  if (args.playedBest) {
    if (
      importantFromLines(args.lines, true, args.side) &&
      !(
        args.fenBefore &&
        args.playedSan &&
        isForcingEqualOrHigherRecapture(args.fenBefore, args.playedSan)
      )
    ) {
      return "important";
    }
    return "best";
  }

  return classifyCoachWpBand(wpDrop);
}

export function coachMissedFromPending(args: {
  wpBefore: number;
  wpAfter: number;
  pendingPeakWp: number;
}): boolean {
  const band = classifyCoachWpBand(coachWpDrop(args.wpBefore, args.wpAfter));
  if (isCoachMistakeOrWorse(band)) return true;
  return wpDropPp(args.pendingPeakWp, args.wpAfter) >= 10;
}

export type { EvalDropKind };
