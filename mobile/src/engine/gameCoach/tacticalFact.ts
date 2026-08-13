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
    | "missed_mate"
    | "hung_mate"
    | "bad_trade"
    | "sacrifice"
    | null;
  pieceLabel: string | null;
  captureSan: string | null;
  takenNext: boolean;
  mateIn: number | null;
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
    mateIn: null,
  };
}

const MATE_CP = 50000;

function mateMovesFromCp(cp: number): number | null {
  const abs = Math.abs(cp);
  if (abs < MATE_CP) return null;
  if (abs >= 100000) return 0;
  return Math.max(0, Math.min(99, Math.round((100000 - abs) / 1000)));
}

function moverHasMate(cpWhite: number, moverIsWhite: boolean): boolean {
  return moverIsWhite ? cpWhite >= MATE_CP : cpWhite <= -MATE_CP;
}

export function forcingPrefix(pvSan: string[]): string {
  const bits: string[] = [];
  for (const san of pvSan.slice(0, 6)) {
    bits.push(san);
    if (!/[+#]$/.test(san) && !san.includes("x")) break;
  }
  return bits.join(" ");
}

/** Forcing miss: mover skipped a multi-move / check / capture line. */
export function missedForcingLine(args: {
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  deltaCp: number;
}): string | null {
  if (!args.bestSan || args.bestSan === args.playedSan) return null;
  if (args.deltaCp < 120) return null;
  const forcing = forcingPrefix(args.bestPvSan) || args.bestSan;
  if (!forcing) return null;
  if (/[+#]/.test(forcing) || forcing.includes("x") || forcing.split(" ").length >= 2) {
    return forcing;
  }
  return null;
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
  side?: "white" | "black";
}): TacticalFact {
  const empty = emptyFact();
  const moverIsWhite = (args.side || args.userColor) === "white";
  const before = args.evalBeforeWhite;
  const after = args.evalAfterWhite;
  const hasMateSignal =
    (before != null && Math.abs(before) >= MATE_CP) ||
    (after != null && Math.abs(after) >= MATE_CP);
  if (args.deltaCp < 80 && !hasMateSignal) return empty;

  const user = colorOf(args.userColor);
  const userIsWhite = args.userColor === "white";

  if (
    before != null &&
    after != null &&
    moverHasMate(before, moverIsWhite) &&
    args.bestSan &&
    args.playedSan !== args.bestSan &&
    !moverHasMate(after, moverIsWhite)
  ) {
    const mateIn = mateMovesFromCp(before);
    const line = forcingPrefix(args.bestPvSan) || args.bestSan;
    return {
      kind: "missed_mate",
      pieceLabel: null,
      captureSan: line,
      takenNext: false,
      mateIn,
    };
  }

  if (
    after != null &&
    moverHasMate(after, !moverIsWhite) &&
    (before == null || !moverHasMate(before, !moverIsWhite))
  ) {
    return {
      kind: "hung_mate",
      pieceLabel: null,
      captureSan: args.bestSan,
      takenNext: Boolean(args.opponentReplySan),
      mateIn: mateMovesFromCp(after),
    };
  }

  let dropKind: EvalDropKind = null;
  if (
    before != null &&
    after != null &&
    Number.isFinite(before) &&
    Number.isFinite(after)
  ) {
    const wpBefore = userWinProbability(before, userIsWhite);
    const wpAfter = userWinProbability(after, userIsWhite);
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
      mateIn: null,
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
          mateIn: null,
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
          mateIn: null,
        };
      }
      if (takenNext) {
        return {
          kind: "sacrifice",
          pieceLabel: label,
          captureSan: null,
          takenNext: true,
          mateIn: null,
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
        mateIn: null,
      };
    }
  } catch {
  }

  const forcing = forcingPrefix(args.bestPvSan);
  if (
    forcing &&
    args.bestSan &&
    args.playedSan !== args.bestSan &&
    args.deltaCp >= 120 &&
    (/[+#]/.test(forcing) || forcing.split(" ").length >= 2)
  ) {
    return {
      kind: "missed_tactic",
      pieceLabel: null,
      captureSan: forcing,
      takenNext: false,
      mateIn: null,
    };
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
        mateIn: null,
      };
    }
  } catch {
  }

  return empty;
}
