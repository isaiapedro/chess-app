import { Chess } from "chess.js";
import {
  ENDGAME_NON_PAWN_MAX,
  isCoachEndgame,
  nonPawnPieceCount,
} from "../endgamePhase";
import { middlegameStartPly } from "../middlegameBounds";
import { openingPhaseEndFullmove } from "../openingPhase";

export type PhaseSplits = {
  /** First ply index (0-based) of middlegame; opening is before this. */
  middlegameStartPlyIndex: number;
  /** First ply index (0-based) of endgame; null if never reached. */
  endgameStartPlyIndex: number | null;
};

export type CoachPhaseName = "opening" | "middlegame" | "endgame";

export type CoachPhaseBounds = {
  middlegameStartPly0: number | null;
  endgameStartPly0: number | null;
};

export type CoachPhaseHints = {
  fen?: string | null;
  tacticalKind?: string | null;
  dropCp?: number;
};

function isOpeningPly(
  ply1: number,
  pieceCount: number,
  bounds?: CoachPhaseBounds | null
): boolean {
  const mg0 = bounds?.middlegameStartPly0;
  if (mg0 != null) return ply1 - 1 < mg0;
  return ply1 <= 16 && pieceCount >= 28;
}

/**
 * Board phase from heuristic bounds (0-based) vs display ply (1-based).
 * Coach EG is per-ply material + tactic override, not sticky endgameStartPly0.
 */
export function phaseForPlyBounds(
  ply1: number,
  pieceCount: number,
  bounds?: CoachPhaseBounds | null,
  hints?: CoachPhaseHints | null
): CoachPhaseName {
  if (isOpeningPly(ply1, pieceCount, bounds)) return "opening";

  if (hints?.tacticalKind || (hints?.dropCp ?? 0) > 150) {
    return "middlegame";
  }

  if (hints?.fen) {
    return isCoachEndgame({
      fen: hints.fen,
      tacticalKind: hints.tacticalKind,
      dropCp: hints.dropCp,
    })
      ? "endgame"
      : "middlegame";
  }

  const eg0 = bounds?.endgameStartPly0;
  const mg0 = bounds?.middlegameStartPly0;
  if (eg0 != null && ply1 - 1 >= eg0) return "endgame";
  if (mg0 != null && ply1 - 1 >= mg0) return "middlegame";
  if (pieceCount <= 12) return "endgame";
  return "middlegame";
}

/**
 * Coach tip/plan phase: structural checkpoints keep their phase even when
 * placed on a phase-boundary ply (e.g. middlegame_aggregate @ endgame start).
 */
export function phaseForCoachMoment(args: {
  ply1: number;
  pieceCount?: number;
  bounds?: CoachPhaseBounds | null;
  structuralKind?: string | null;
  fen?: string | null;
  tacticalKind?: string | null;
  dropCp?: number;
}): CoachPhaseName {
  const sk = args.structuralKind;
  if (sk === "opening_name" || sk === "opening_aggregate") return "opening";
  if (
    sk === "middlegame_aggregate" ||
    sk === "decisive_pawn_break"
  ) {
    return "middlegame";
  }
  if (sk === "endgame_advantage") return "endgame";
  return phaseForPlyBounds(
    args.ply1,
    args.pieceCount ?? 32,
    args.bounds,
    {
      fen: args.fen,
      tacticalKind: args.tacticalKind,
      dropCp: args.dropCp,
    }
  );
}

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
