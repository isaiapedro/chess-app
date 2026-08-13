import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import {
  STYLE_PIECE_VALUE,
  SACRIFICE_MIN_OFFER,
  canRecapture,
  hasMaterialWinTactic,
  maxUndefendedHangingPieces,
  sacrificeOfferAfterMove,
} from "../styleMetrics";
import {
  classifyEvalDrop,
  userWinProbability,
  type EvalDropKind,
} from "../winProb";

const PIECE_VALUE = STYLE_PIECE_VALUE;

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export type TacticalFact = {
  kind:
    | "gave_piece"
    | "missed_capture"
    | "missed_tactic"
    | "bad_trade"
    | "sacrifice"
    | null;
  pieceLabel: string | null;
  captureSan: string | null;
  takenNext: boolean;
};

function colorOf(userColor: "white" | "black"): Color {
  return userColor === "black" ? "b" : "w";
}

function emptyFact(): TacticalFact {
  return {
    kind: null,
    pieceLabel: null,
    captureSan: null,
    takenNext: false,
  };
}

function labelForVal(val: number): string {
  if (val >= 9) return "queen";
  if (val >= 5) return "rook";
  if (val >= 3) return "minor piece";
  return "pawn";
}

function findMaterialWinCapture(
  fen: string,
  preferSan: string | null
): { type: PieceSymbol; san: string; free: boolean; gain: number } | null {
  try {
    const board = new Chess(fen);
    const color = board.turn();
    if (!hasMaterialWinTactic(board, color)) return null;

    const moves = board.moves({ verbose: true }) as Move[];
    const scored: Array<{
      type: PieceSymbol;
      san: string;
      free: boolean;
      gain: number;
    }> = [];

    for (const m of moves) {
      if (!m.isCapture() || !m.captured || m.captured === "k") continue;
      const gain = PIECE_VALUE[m.captured] || 0;
      if (gain < 1) continue;
      const dest = m.to;
      const attacked = board.isAttacked(dest, color === "w" ? "b" : "w");
      if (!attacked) {
        if (gain >= 3 || m.captured !== "p") {
          scored.push({
            type: m.captured,
            san: m.san,
            free: true,
            gain,
          });
        }
        continue;
      }
      const defenders = board.attackers(dest, color === "w" ? "b" : "w");
      let minDef = 99;
      for (const d of defenders) {
        const dp = board.get(d);
        if (!dp) continue;
        minDef = Math.min(minDef, PIECE_VALUE[dp.type] || 99);
      }
      const aVal = PIECE_VALUE[m.piece] || 0;
      if (gain > aVal || (gain >= aVal && aVal <= minDef)) {
        scored.push({
          type: m.captured,
          san: m.san,
          free: gain > aVal,
          gain: gain - aVal,
        });
      }
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.gain - a.gain);
    if (preferSan) {
      const hit = scored.find((s) => s.san === preferSan);
      if (hit) return hit;
    }
    return scored[0];
  } catch {
    return null;
  }
}

function replyTakesSquare(
  fenAfter: string,
  replySan: string | null | undefined,
  sq: Square
): boolean {
  if (!replySan) return false;
  try {
    const board = new Chess(fenAfter);
    const move = board.move(replySan);
    return Boolean(move && move.isCapture() && move.to === sq);
  } catch {
    return false;
  }
}

function replyTakesOnAnyHang(
  fenAfter: string,
  replySan: string | null | undefined,
  user: Color
): boolean {
  if (!replySan) return false;
  try {
    const board = new Chess(fenAfter);
    const beforeHung = maxUndefendedHangingPieces(board, user);
    if (beforeHung < SACRIFICE_MIN_OFFER) return false;
    const move = board.move(replySan);
    return Boolean(move?.isCapture());
  } catch {
    return false;
  }
}

function isEvalDrop(kind: EvalDropKind): boolean {
  return kind === "blunder" || kind === "mistake" || kind === "inaccuracy";
}

export function detectTacticalFact(args: {
  fenBefore: string;
  fenAfter?: string;
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  userColor: "white" | "black";
  deltaCp: number;
  evalBeforeWhite?: number | null;
  evalAfterWhite?: number | null;
  opponentReplySan?: string | null;
}): TacticalFact {
  const empty = emptyFact();
  if (args.deltaCp < 80) return empty;

  const user = colorOf(args.userColor);
  const userIsWhite = args.userColor === "white";

  let dropKind: EvalDropKind = null;
  if (
    args.evalBeforeWhite != null &&
    args.evalAfterWhite != null &&
    Number.isFinite(args.evalBeforeWhite) &&
    Number.isFinite(args.evalAfterWhite)
  ) {
    const wpBefore = userWinProbability(args.evalBeforeWhite, userIsWhite);
    const wpAfter = userWinProbability(args.evalAfterWhite, userIsWhite);
    dropKind = classifyEvalDrop(wpBefore, wpAfter);
  } else if (args.deltaCp >= 200) {
    dropKind = "blunder";
  } else if (args.deltaCp >= 120) {
    dropKind = "mistake";
  }

  const prefer =
    args.bestSan || (args.bestPvSan[0] ? args.bestPvSan[0] : null);
  const winCap = findMaterialWinCapture(args.fenBefore, prefer);
  if (
    winCap &&
    winCap.gain >= 2 &&
    args.playedSan !== winCap.san &&
    args.deltaCp >= 100
  ) {
    return {
      kind: "missed_capture",
      pieceLabel: PIECE_NAME[winCap.type],
      captureSan: winCap.san,
      takenNext: false,
    };
  }

  try {
    const board = new Chess(args.fenBefore);
    const move = board.move(args.playedSan) as Move | null;
    if (!move) return empty;
    const fenAfter = args.fenAfter || board.fen();
    const toSq = move.to as Square;
    const offered = sacrificeOfferAfterMove(board, move, user);
    const recapturePossible = move.isCapture() && canRecapture(board, toSq);
    const hungVal = maxUndefendedHangingPieces(board, user);
    const takenNext = replyTakesSquare(
      fenAfter,
      args.opponentReplySan,
      toSq
    );

    if (
      move.isCapture() &&
      recapturePossible &&
      offered < SACRIFICE_MIN_OFFER
    ) {
      if (
        winCap &&
        args.playedSan !== winCap.san &&
        args.deltaCp >= 120
      ) {
        return {
          kind: "missed_capture",
          pieceLabel: PIECE_NAME[winCap.type],
          captureSan: winCap.san,
          takenNext: false,
        };
      }
      return empty;
    }

    if (offered >= SACRIFICE_MIN_OFFER) {
      const label = labelForVal(offered);
      if (isEvalDrop(dropKind)) {
        const isLosingTrade =
          move.isCapture() && (takenNext || recapturePossible);
        return {
          kind: isLosingTrade ? "bad_trade" : "gave_piece",
          pieceLabel: label,
          captureSan: null,
          takenNext,
        };
      }
      if (takenNext) {
        return {
          kind: "sacrifice",
          pieceLabel: label,
          captureSan: null,
          takenNext: true,
        };
      }
    }

    if (
      hungVal >= SACRIFICE_MIN_OFFER &&
      (isEvalDrop(dropKind) || args.deltaCp >= 150)
    ) {
      return {
        kind: "gave_piece",
        pieceLabel: labelForVal(hungVal),
        captureSan: null,
        takenNext: replyTakesOnAnyHang(
          fenAfter,
          args.opponentReplySan,
          user
        ),
      };
    }
  } catch {
  }

  try {
    const board = new Chess(args.fenBefore);
    if (
      hasMaterialWinTactic(board, user) &&
      args.deltaCp >= 120 &&
      args.bestSan &&
      args.bestSan !== args.playedSan
    ) {
      return {
        kind: "missed_tactic",
        pieceLabel: winCap ? PIECE_NAME[winCap.type] : null,
        captureSan: args.bestSan,
        takenNext: false,
      };
    }
  } catch {
  }

  return empty;
}
