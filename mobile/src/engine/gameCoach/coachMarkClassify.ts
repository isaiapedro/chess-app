import { Chess, type Color, type Move, type Square } from "chess.js";
import { sameMove } from "../chessMoves";
import {
  STYLE_PIECE_VALUE,
  isHangingOrUnderdefended,
  isUnderLesserAttack,
  sacrificeOfferAfterMove,
  threatensHigherValueAfter,
} from "../styleMetrics";
import {
  isMateScore,
  userWinProbability,
  wpDropPp,
  WP_INACCURACY_DROP,
  type EvalDropKind,
} from "../winProb";
import { hungMateAfterPlayedMove } from "../forcedMate";
import { IMPORTANT_PV_GAP, multipvWpGap } from "./tacticSharpness";
import { gameAccuracyForSide } from "../gameAccuracy";

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

export const COACH_THEORY_LEAVE_MARKS = new Set<CoachMark>([
  "inaccuracy",
  "mistake",
  "blunder",
  "missed",
]);

const BRILLIANT_WP_BEFORE_MAX = 0.85;
const BRILLIANT_WP_AFTER_MIN = 0.2;
const BRILLIANT_LOST_WP = 0.25;
const BRILLIANT_EQUAL_WP = 0.45;
const BRILLIANT_SAC_MIN = 2;

export const COACH_MARKS_KEEP_OVER_BOOK = new Set<CoachMark>([
  "brilliant",
  "important",
  "missed",
  "mistake",
  "blunder",
  "inaccuracy",
]);

export type CoachEngineLine = {
  rank: number;
  san: string;
  cpWhite: number;
};

function coachWpDrop(wpBefore: number, wpAfter: number): number {
  return Math.max(0, wpBefore - wpAfter);
}

export const CP_INACCURACY_DROP = 150;

export function userCpDrop(
  evalBeforeCp: number,
  evalAfterCp: number,
  side: "white" | "black"
): number {
  const userIsWhite = side === "white";
  const before = userIsWhite ? evalBeforeCp : -evalBeforeCp;
  const after = userIsWhite ? evalAfterCp : -evalAfterCp;
  return before - after;
}

export function classifyCoachWpBand(
  wpDrop: number,
  cpDrop = 0
): CoachMark | null {
  if (wpDrop >= 0.2) return "blunder";
  if (wpDrop >= 0.1) return "mistake";
  if (wpDrop >= 0.05 || cpDrop >= CP_INACCURACY_DROP) return "inaccuracy";
  if (wpDrop >= 0.02) return "good";
  if (wpDrop >= 0) return "excellent";
  return null;
}

export function isCoachMistakeOrWorse(mark: CoachMark | null): boolean {
  return mark === "mistake" || mark === "blunder" || mark === "missed";
}

export const COACH_MARK_ORDER: CoachMark[] = [
  "brilliant",
  "important",
  "best",
  "excellent",
  "good",
  "book",
  "inaccuracy",
  "mistake",
  "missed",
  "blunder",
];

export function countCoachMarks(
  plies: Array<{ mark?: CoachMark | null }>
): Partial<Record<CoachMark, number>> {
  const counts: Partial<Record<CoachMark, number>> = {};
  for (const ply of plies) {
    const mark = ply.mark;
    if (!mark) continue;
    counts[mark] = (counts[mark] || 0) + 1;
  }
  return counts;
}

export function countCoachMarksBySide(
  plies: Array<{ mark?: CoachMark | null; side?: string }>,
  userColor: "white" | "black"
): {
  user: Partial<Record<CoachMark, number>>;
  opp: Partial<Record<CoachMark, number>>;
} {
  const user: Partial<Record<CoachMark, number>> = {};
  const opp: Partial<Record<CoachMark, number>> = {};
  for (const ply of plies) {
    const mark = ply.mark;
    if (!mark) continue;
    const bucket = ply.side === userColor ? user : opp;
    bucket[mark] = (bucket[mark] || 0) + 1;
  }
  return { user, opp };
}

export function sideAccuracyPct(
  plies: Array<{
    side?: string;
    evalBeforeCp?: number | null;
    evalAfterCp?: number | null;
  }>,
  side: "white" | "black"
): number | null {
  return gameAccuracyForSide(plies, side);
}

function importantFromLines(
  lines: CoachEngineLine[] | undefined,
  playedBest: boolean,
  side: "white" | "black"
): boolean {
  if (!playedBest || !lines || lines.length < 2) return false;
  return multipvWpGap(lines, side) >= IMPORTANT_PV_GAP;
}

function fromSquareHasCaptureThreat(
  board: Chess,
  from: Square,
  piece: Move["piece"],
  color: Color,
  moverWasInCheck: boolean
): boolean {
  if (piece === "k") return moverWasInCheck;
  return (
    isHangingOrUnderdefended(board, from, color) ||
    isUnderLesserAttack(board, from, color)
  );
}

function threatEscapeHasExtraIdea(
  boardAfter: Chess,
  move: Move,
  color: Color
): boolean {
  if (move.isCapture()) return true;
  if (move.isPromotion()) return true;
  if (move.isKingsideCastle() || move.isQueensideCastle()) return true;
  if (boardAfter.inCheck()) return true;
  if (sacrificeOfferAfterMove(boardAfter, move, color) >= BRILLIANT_SAC_MIN) {
    return true;
  }
  return threatensHigherValueAfter(boardAfter, move, color);
}

export function isSimpleThreatEscape(
  fenBefore: string,
  playedSan: string
): boolean {
  try {
    const before = new Chess(fenBefore);
    const color = before.turn();
    const moverWasInCheck = before.inCheck();
    const after = new Chess(fenBefore);
    const move = after.move(playedSan) as Move | null;
    if (!move) return false;
    if (
      !fromSquareHasCaptureThreat(
        before,
        move.from as Square,
        move.piece,
        color,
        moverWasInCheck
      )
    ) {
      return false;
    }
    if (threatEscapeHasExtraIdea(after, move, color)) return false;
    const to = move.to as Square;
    if (
      isHangingOrUnderdefended(after, to, color) ||
      isUnderLesserAttack(after, to, color)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function captureDest(fenBefore: string, san: string): string | null {
  if (!san.includes("x")) return null;
  try {
    const board = new Chess(fenBefore);
    const move = board.move(san) as Move | null;
    if (!move?.isCapture()) return null;
    return move.to;
  } catch {
    return null;
  }
}

const OPENING_DEVELOP_FULLMOVE = 10;
const MINOR_HOME: Record<Color, ReadonlySet<string>> = {
  w: new Set(["b1", "c1", "f1", "g1"]),
  b: new Set(["b8", "c8", "f8", "g8"]),
};

export function isRoutineExcellentMove(
  fenBefore: string,
  playedSan: string
): boolean {
  try {
    const before = new Chess(fenBefore);
    const color = before.turn();
    const opp = color === "w" ? "b" : "w";
    const after = new Chess(fenBefore);
    const move = after.move(playedSan) as Move | null;
    if (!move) return false;
    if (after.inCheck()) return true;
    if (
      before.inCheck() &&
      move.piece !== "k" &&
      !move.isCapture()
    ) {
      return true;
    }
    if (move.isCapture()) {
      const dest = move.to as Square;
      if (
        isHangingOrUnderdefended(before, dest, opp) ||
        isUnderLesserAttack(before, dest, opp)
      ) {
        return true;
      }
    }
    const fullmove = Number(fenBefore.split(" ")[5] || "1");
    if (
      fullmove <= OPENING_DEVELOP_FULLMOVE &&
      (move.piece === "n" || move.piece === "b") &&
      MINOR_HOME[color].has(move.from)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isRecapture(
  fenBefore: string,
  playedSan: string,
  prevCaptureTo?: string | null
): boolean {
  if (!prevCaptureTo) return false;
  try {
    const before = new Chess(fenBefore);
    const move = before.move(playedSan) as Move | null;
    if (!move?.isCapture()) return false;
    return move.to === prevCaptureTo;
  } catch {
    return false;
  }
}

function moverHasMate(cpWhite: number, moverIsWhite: boolean): boolean {
  if (!isMateScore(cpWhite)) return false;
  return moverIsWhite ? cpWhite > 0 : cpWhite < 0;
}

export function lostOwnMate(args: {
  side: "white" | "black";
  evalBeforeCp: number | null;
  evalAfterCp: number | null;
  playedBest?: boolean;
}): boolean {
  if (args.playedBest) return false;
  if (args.evalBeforeCp == null || args.evalAfterCp == null) return false;
  const moverIsWhite = args.side === "white";
  return (
    moverHasMate(args.evalBeforeCp, moverIsWhite) &&
    !moverHasMate(args.evalAfterCp, moverIsWhite)
  );
}

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

export function isEqualOrLesserCapture(
  fenBefore: string,
  playedSan: string
): boolean {
  try {
    const before = new Chess(fenBefore);
    const move = before.move(playedSan) as Move | null;
    if (!move?.isCapture() || !move.captured) return false;
    const moverVal = STYLE_PIECE_VALUE[move.piece] ?? 0;
    const capVal = STYLE_PIECE_VALUE[move.captured] ?? 0;
    return capVal + 1e-9 <= moverVal;
  } catch {
    return false;
  }
}

function isRoutineImportantMove(fenBefore: string, playedSan: string): boolean {
  try {
    const before = new Chess(fenBefore);
    const after = new Chess(fenBefore);
    const move = after.move(playedSan) as Move | null;
    if (!move) return false;
    if (before.inCheck() && move.piece !== "k" && !move.isCapture()) {
      return true;
    }
    return isEqualOrLesserCapture(fenBefore, playedSan);
  } catch {
    return false;
  }
}

function brilliantSacrifice(args: {
  fenBefore: string;
  playedSan: string;
  side: "white" | "black";
  wpDrop: number;
  wpBefore: number;
  wpAfter: number;
}): boolean {
  if (args.wpBefore >= BRILLIANT_WP_BEFORE_MAX) return false;
  if (args.wpAfter < BRILLIANT_WP_AFTER_MIN) return false;
  if (
    args.wpBefore < BRILLIANT_LOST_WP &&
    args.wpAfter < BRILLIANT_EQUAL_WP
  ) {
    return false;
  }
  if (args.wpDrop >= WP_INACCURACY_DROP) return false;
  try {
    const board = new Chess(args.fenBefore);
    const color: Color = args.side === "white" ? "w" : "b";
    const move = board.move(args.playedSan) as Move | null;
    if (!move) return false;
    return sacrificeOfferAfterMove(board, move, color) >= BRILLIANT_SAC_MIN;
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
  prevCaptureTo?: string | null;
}): CoachMark | null {
  const playedBest =
    args.playedBest ||
    Boolean(
      args.fenBefore &&
        args.playedSan &&
        args.lines?.[0]?.san &&
        sameMove(args.fenBefore, args.playedSan, args.lines[0].san)
    );
  if (playedBest) {
    if (args.evalBeforeCp == null || args.evalAfterCp == null) return "best";
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
        wpDrop,
        wpBefore,
        wpAfter,
      })
    ) {
      return "brilliant";
    }
    const forcedRecapture =
      Boolean(args.fenBefore) &&
      Boolean(args.playedSan) &&
      isForcingEqualOrHigherRecapture(args.fenBefore!, args.playedSan!);
    if (
      !forcedRecapture &&
      importantFromLines(args.lines, true, args.side) &&
      !(
        args.fenBefore &&
        args.playedSan &&
        (isSimpleThreatEscape(args.fenBefore, args.playedSan) ||
          isRoutineImportantMove(args.fenBefore, args.playedSan))
      )
    ) {
      return "important";
    }
    return "best";
  }

  if (
    args.fenBefore &&
    args.playedSan &&
    hungMateAfterPlayedMove({
      fenBefore: args.fenBefore,
      playedSan: args.playedSan,
      evalBeforeCp: args.evalBeforeCp,
      evalAfterCp: args.evalAfterCp,
      side: args.side,
    }) != null
  ) {
    return "blunder";
  }

  if (lostOwnMate({ ...args, playedBest })) return "missed";

  if (args.missedOpportunity) return "missed";
  if (args.evalBeforeCp == null || args.evalAfterCp == null) {
    return null;
  }

  const userIsWhite = args.side === "white";
  const wpBefore = userWinProbability(args.evalBeforeCp, userIsWhite);
  const wpAfter = userWinProbability(args.evalAfterCp, userIsWhite);
  const wpDrop = coachWpDrop(wpBefore, wpAfter);
  const cpDrop = userCpDrop(
    args.evalBeforeCp,
    args.evalAfterCp,
    args.side
  );

  if (
    args.fenBefore &&
    args.playedSan &&
    brilliantSacrifice({
      fenBefore: args.fenBefore,
      playedSan: args.playedSan,
      side: args.side,
      wpDrop,
      wpBefore,
      wpAfter,
    })
  ) {
    return "brilliant";
  }

  const band = classifyCoachWpBand(wpDrop, cpDrop);
  if (
    band === "excellent" &&
    args.fenBefore &&
    args.playedSan &&
    (isRecapture(args.fenBefore, args.playedSan, args.prevCaptureTo) ||
      isRoutineExcellentMove(args.fenBefore, args.playedSan) ||
      isEqualOrLesserCapture(args.fenBefore, args.playedSan))
  ) {
    return "good";
  }
  return band;
}

export function coachMissedFromPending(args: {
  wpBefore: number;
  wpAfter: number;
  pendingPeakWp: number;
  playedBest?: boolean;
}): boolean {
  if (args.playedBest) return false;
  const drop = coachWpDrop(args.wpBefore, args.wpAfter);
  const band = classifyCoachWpBand(drop);
  if (band === "blunder" || band === "mistake" || band === "inaccuracy") {
    return true;
  }
  return wpDropPp(args.pendingPeakWp, args.wpAfter) >= 5;
}

export type { EvalDropKind };
