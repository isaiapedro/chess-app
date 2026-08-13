import { Chess } from "chess.js";
import { ENDGAME_NON_PAWN_MAX, nonPawnPieceCount } from "../endgamePhase";
import { middlegameStartPly } from "../middlegameBounds";
import { openingPhaseEndFullmove } from "../openingPhase";

export type PhaseSplits = {
  /** First ply index (0-based) of middlegame; opening is before this. */
  middlegameStartPlyIndex: number;
  /** First ply index (0-based) of endgame; null if never reached. */
  endgameStartPlyIndex: number | null;
};

/**
 * Same phase cuts as middlegame/opening/endgame metrics:
 * - Opening ends at openingPhaseEndFullmove(user castle) → MG starts at that × 2 plies
 * - Endgame starts when non-pawn pieces ≤ 7
 */
export function computePhaseSplits(
  plies: Array<{
    side: "white" | "black";
    san: string;
    fullmove: number;
    fenAfter: string;
  }>,
  userColor: "white" | "black"
): PhaseSplits {
  let castleFullmove: number | null = null;
  let endgameStartPlyIndex: number | null = null;

  for (let i = 0; i < plies.length; i++) {
    const p = plies[i];
    if (
      p.side === userColor &&
      castleFullmove == null &&
      (p.san === "O-O" || p.san === "O-O-O")
    ) {
      castleFullmove = p.fullmove;
    }
    if (endgameStartPlyIndex == null && p.fenAfter) {
      try {
        const board = new Chess(p.fenAfter);
        if (nonPawnPieceCount(board) <= ENDGAME_NON_PAWN_MAX) {
          endgameStartPlyIndex = i;
        }
      } catch {
        /* ignore bad fen */
      }
    }
  }

  const phaseEnd = openingPhaseEndFullmove(castleFullmove);
  const middlegameStartPlyIndex = Math.min(
    middlegameStartPly(phaseEnd),
    Math.max(0, plies.length)
  );

  return { middlegameStartPlyIndex, endgameStartPlyIndex };
}
