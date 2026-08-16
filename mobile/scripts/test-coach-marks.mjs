/**
 * Smoke checks for sacrificeOfferAfterMove semantics (brilliant prerequisite).
 * Run: node scripts/test-coach-marks.mjs
 */
import { Chess } from "chess.js";

function pieceVal(p) {
  return { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }[p] || 0;
}

/** Mirrors styleMetrics.sacrificeOfferAfterMove (pieces only; equal trades ≠ sac). */
function sacrificeOfferAfterMove(boardAfter, move, color) {
  if (move.piece === "p" || move.piece === "k") return 0;
  const opp = color === "w" ? "b" : "w";
  const moverVal = pieceVal(move.piece);
  const capturedVal = move.captured ? pieceVal(move.captured) : 0;
  const attackCount = boardAfter.attackers(move.to, opp).length;
  if (attackCount === 0) return 0;
  const defendCount = boardAfter.attackers(move.to, color).length;
  const tradeLoss = moverVal - capturedVal;
  if (move.isCapture() && tradeLoss <= 0) return 0;
  if (move.isCapture() && tradeLoss >= 3) return tradeLoss;
  if (attackCount > defendCount) {
    if (tradeLoss > 0) return tradeLoss;
    if (moverVal >= 3) return moverVal;
  }
  return 0;
}

/** Mirrors coachMarks brilliantSacrifice WP gates (no RN import). */
function brilliantWpOk(wpBefore, wpAfter) {
  if (wpBefore >= 0.85) return false;
  if (wpAfter < 0.2) return false;
  if (wpBefore < 0.25 && wpAfter < 0.45) return false;
  return true;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function tryMove(board, san) {
  try {
    return board.move(san);
  } catch {
    return null;
  }
}

// Undervalued sac: Bxf7 (bishop for pawn) hanging → tradeLoss 2.
{
  const board = new Chess(
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4"
  );
  const m = tryMove(board, "Bxf7");
  assert(m, "Bxf7 legal");
  const offered = sacrificeOfferAfterMove(board, m, "w");
  assert(offered >= 2, `Bxf7 offer ≥2, got ${offered}`);
}

// Equal piece trade: must not count as sacrifice.
{
  const board = new Chess(
    "r1bqkb1r/pppp1ppp/2n2n2/4N3/4P3/8/PPPP1PPP/RNBQKB1R w KQkq - 1 4"
  );
  const m = tryMove(board, "Nxc6");
  assert(m, "Nxc6 legal");
  const offered = sacrificeOfferAfterMove(board, m, "w");
  assert(offered === 0, `Nxc6 equal trade must be 0, got ${offered}`);
}

// Lost + still lost after sac → not brilliant.
assert(!brilliantWpOk(0.1, 0.22), "lost→still-lost must reject");
assert(!brilliantWpOk(0.1, 0.4), "lost→below-equal must reject");
assert(brilliantWpOk(0.1, 0.45), "lost→equal must allow");
assert(brilliantWpOk(0.4, 0.35), "not-lost small drop ok if after≥0.2");
assert(!brilliantWpOk(0.9, 0.5), "already-winning must reject");

console.log("test-coach-marks: ok");
