import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import {
  STYLE_PIECE_VALUE,
  isHangingOrUnderdefended,
  maxUndefendedHangingPieces,
  squareFile,
  squareRank,
  swapColor,
} from "../styleMetrics";

const FILES = "abcdefgh";
const KING_VAL = 100;
const RAY_DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const DIAG_DIRS = RAY_DIRS.filter(([df, dr]) => df !== 0 && dr !== 0);
const ORTHO_DIRS = RAY_DIRS.filter(([df, dr]) => df === 0 || dr === 0);

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export type BoardMotifKind = "pin" | "skewer" | "fork" | "hang";

export type BoardMotifHit = {
  kind: BoardMotifKind;
  pieceLabel: string | null;
  square: string | null;
};

function sq(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}` as Square;
}

function valOf(type: PieceSymbol): number {
  if (type === "k") return KING_VAL;
  return STYLE_PIECE_VALUE[type] || 0;
}

function dirsFor(type: PieceSymbol): Array<[number, number]> {
  if (type === "b") return DIAG_DIRS;
  if (type === "r") return ORTHO_DIRS;
  if (type === "q") return RAY_DIRS;
  return [];
}

function walkOccupied(
  board: Chess,
  from: Square,
  df: number,
  dr: number
): Array<{ sq: Square; type: PieceSymbol; color: Color }> {
  const out: Array<{ sq: Square; type: PieceSymbol; color: Color }> = [];
  let f = squareFile(from) + df;
  let r = squareRank(from) + dr;
  while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
    const s = sq(f, r);
    if (!s) break;
    const p = board.get(s);
    if (p) {
      out.push({ sq: s, type: p.type, color: p.color });
      if (out.length >= 2) break;
    }
    f += df;
    r += dr;
  }
  return out;
}

function rayHit(
  board: Chess,
  from: Square,
  type: PieceSymbol,
  attacker: Color
): BoardMotifHit | null {
  const opp = swapColor(attacker);
  for (const [df, dr] of dirsFor(type)) {
    const occ = walkOccupied(board, from, df, dr);
    if (occ.length < 2) continue;
    const front = occ[0]!;
    const back = occ[1]!;
    if (front.color !== opp || back.color !== opp) continue;
    const fv = valOf(front.type);
    const bv = valOf(back.type);
    if (back.type === "k" || bv > fv) {
      return { kind: "pin", pieceLabel: PIECE_NAME[front.type], square: front.sq };
    }
    if (front.type === "k" || fv > bv) {
      return {
        kind: "skewer",
        pieceLabel: PIECE_NAME[front.type === "k" ? back.type : front.type],
        square: front.type === "k" ? back.sq : front.sq,
      };
    }
  }
  return null;
}

function anyKingPin(board: Chess, attacker: Color): BoardMotifHit | null {
  for (const pt of ["q", "r", "b"] as const) {
    for (const from of board.findPiece({ type: pt, color: attacker })) {
      const hit = rayHit(board, from as Square, pt, attacker);
      if (hit?.kind === "pin") return hit;
    }
  }
  return null;
}

function forkTargets(
  board: Chess,
  from: Square,
  attacker: Color
): Array<{ sq: Square; type: PieceSymbol }> {
  const opp = swapColor(attacker);
  const out: Array<{ sq: Square; type: PieceSymbol }> = [];
  for (const pt of ["k", "q", "r", "b", "n", "p"] as const) {
    for (const s of board.findPiece({ type: pt, color: opp })) {
      const sqs = s as Square;
      if (!board.attackers(sqs, attacker).includes(from)) continue;
      const worthy =
        pt === "k" ||
        (STYLE_PIECE_VALUE[pt] || 0) >= 3 ||
        isHangingOrUnderdefended(board, sqs, opp);
      if (!worthy) continue;
      out.push({ sq: sqs, type: pt });
    }
  }
  return out;
}

function bestVictimLabel(
  targets: Array<{ type: PieceSymbol }>
): string | null {
  if (!targets.length) return null;
  const ranked = [...targets].sort(
    (a, b) => valOf(b.type) - valOf(a.type)
  );
  const top = ranked[0]!;
  if (top.type === "k" && ranked[1]) return PIECE_NAME[ranked[1].type];
  return PIECE_NAME[top.type];
}

function hangVictim(
  board: Chess,
  from: Square,
  attacker: Color
): BoardMotifHit | null {
  const opp = swapColor(attacker);
  if (maxUndefendedHangingPieces(board, opp) < 3) return null;
  for (const pt of ["q", "r", "b", "n"] as const) {
    for (const s of board.findPiece({ type: pt, color: opp })) {
      const sqs = s as Square;
      if (!isHangingOrUnderdefended(board, sqs, opp)) continue;
      if (!board.attackers(sqs, attacker).includes(from)) continue;
      return { kind: "hang", pieceLabel: PIECE_NAME[pt], square: sqs };
    }
  }
  return null;
}

export function detectBoardMotif(args: {
  fen: string;
  san: string;
  color: Color;
}): BoardMotifHit | null {
  try {
    const before = new Chess(args.fen);
    if (before.turn() !== args.color) return null;
    const pinBefore = anyKingPin(before, args.color);
    const move = before.move(args.san) as Move | null;
    if (!move) return null;
    const after = before;
    const from = move.to as Square;

    const moverRay = dirsFor(move.piece).length
      ? rayHit(after, from, move.piece, args.color)
      : null;
    if (moverRay) return moverRay;

    const pinAfter = anyKingPin(after, args.color);
    if (pinAfter && (!pinBefore || pinBefore.square !== pinAfter.square)) {
      return pinAfter;
    }

    const targets = forkTargets(after, from, args.color);
    const capturedWorthy =
      Boolean(move.captured) &&
      move.captured !== "p" &&
      (STYLE_PIECE_VALUE[move.captured as PieceSymbol] || 0) >= 3;
    const forkCount = targets.length + (capturedWorthy ? 1 : 0);
    if (forkCount >= 2) {
      const labels = capturedWorthy
        ? [...targets, { type: move.captured as PieceSymbol }]
        : targets;
      return {
        kind: "fork",
        pieceLabel: bestVictimLabel(labels),
        square: targets[0]?.sq || null,
      };
    }

    return hangVictim(after, from, args.color);
  } catch {
    return null;
  }
}
