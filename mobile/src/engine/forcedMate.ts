import { Chess } from "chess.js";
import { isMateScore, uciMateToCp } from "./winProb";

const FORCED_MATE_MAX_PIECES = 12;
const FORCED_MATE_MAX_MOVES = 2;

function pieceCountFen(fen: string): number {
  return (fen.split(" ")[0] || "").replace(/[^kqrnbpKQRBNP]/g, "").length;
}

function sortMateFirst(sans: string[]): string[] {
  return [...sans].sort((a, b) => {
    const sa = /#$/.test(a) ? 2 : /\+$/.test(a) ? 1 : 0;
    const sb = /#$/.test(b) ? 2 : /\+$/.test(b) ? 1 : 0;
    return sb - sa;
  });
}

function searchMate(board: Chess, remain: number): number | null {
  if (remain <= 0) return null;
  const moves = sortMateFirst(board.moves());
  let best: number | null = null;
  for (const san of moves) {
    board.move(san);
    if (board.isCheckmate()) {
      board.undo();
      return 1;
    }
    if (remain >= 2) {
      const replies = board.moves();
      let forced: number | null = replies.length ? 0 : null;
      if (forced != null) {
        for (const reply of replies) {
          board.move(reply);
          if (board.isCheckmate()) {
            board.undo();
            forced = null;
            break;
          }
          const sub = searchMate(board, remain - 1);
          board.undo();
          if (sub == null) {
            forced = null;
            break;
          }
          forced = Math.max(forced, 1 + sub);
        }
      }
      if (forced != null && (best == null || forced < best)) best = forced;
    }
    board.undo();
    if (best === 1) return 1;
  }
  return best;
}

export function forcedMateMoves(
  fen: string,
  maxMoves = FORCED_MATE_MAX_MOVES
): number | null {
  if (pieceCountFen(fen) > FORCED_MATE_MAX_PIECES) return null;
  let board: Chess;
  try {
    board = new Chess(fen);
  } catch {
    return null;
  }
  if (board.isCheckmate()) return 0;
  if (board.isStalemate() || board.isDraw()) return null;
  return searchMate(board, maxMoves);
}

export function whiteCpForStmMate(fen: string, mateMoves: number): number {
  const stm = uciMateToCp(mateMoves);
  return fen.split(" ")[1] === "b" ? -stm : stm;
}

export function bestStmCp(scores: Array<number | null | undefined>): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const n of scores) {
    if (n == null || !Number.isFinite(n)) continue;
    if (n > best) best = n;
  }
  return best === Number.NEGATIVE_INFINITY ? 0 : best;
}

export function applyForcedMateWhiteCp(fen: string, whiteCp: number): number {
  if (isMateScore(whiteCp)) return whiteCp;
  const n = forcedMateMoves(fen);
  if (n == null || n <= 0) return whiteCp;
  return whiteCpForStmMate(fen, n);
}

export function hungMateAfterPlayedMove(args: {
  fenBefore: string;
  playedSan: string;
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
  side: "white" | "black";
}): number | null {
  let board: Chess;
  try {
    board = new Chess(args.fenBefore);
    if (!board.move(args.playedSan)) return null;
  } catch {
    return null;
  }
  const after = applyForcedMateWhiteCp(board.fen(), args.evalAfterCp ?? 0);
  if (args.evalBeforeCp != null && isMateScore(args.evalBeforeCp)) return null;
  if (!isMateScore(after)) return null;
  const oppMates = args.side === "white" ? after < 0 : after > 0;
  return oppMates ? after : null;
}
