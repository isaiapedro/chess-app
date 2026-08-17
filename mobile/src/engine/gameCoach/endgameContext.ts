/**
 * Endgame type, conversion state, technique vectors, strategic_delta stamps.
 */

import { Chess, type Color, type PieceSymbol } from "chess.js";
import type { EndgameGameRow } from "../endgamePhase";
import { ENDGAME_NON_PAWN_MAX, nonPawnPieceCount } from "../endgamePhase";
import { pieceMaterialBalance } from "../styleMetrics";
import { WP_ENDGAME_ADVANTAGE, WP_DISADVANTAGE } from "../winProb";
import {
  classifyRookEndingShape,
  type RookEndingShape,
} from "./tier3Metrics";

export type EndgameType =
  | "king_and_pawn"
  | "single_rook"
  | "rook_ending"
  | "opposite_color_bishops"
  | "minor_piece_vs_pawns"
  | "queen_ending"
  | "other";

export type ConversionState =
  | "winning_conversion"
  | "holding_draw"
  | "pawn_race"
  | "unclear";

function countType(board: Chess, type: PieceSymbol): number {
  return (
    board.findPiece({ type, color: "w" }).length +
    board.findPiece({ type, color: "b" }).length
  );
}

function countColor(
  board: Chess,
  type: PieceSymbol,
  color: Color
): number {
  return board.findPiece({ type, color }).length;
}

export function classifyEndgameType(board: Chess): EndgameType {
  const q = countType(board, "q");
  const r = countType(board, "r");
  const b = countType(board, "b");
  const n = countType(board, "n");
  const minors = b + n;
  if (q >= 1 && r + minors === 0) return "queen_ending";
  if (q >= 1) return "other";
  if (r === 0 && minors === 0) return "king_and_pawn";
  if (r === 1 && minors === 0) return "single_rook";
  if (r === 2 && minors === 0) return "rook_ending";
  if (r === 0 && b >= 1 && n === 0) {
    const wb = board.findPiece({ type: "b", color: "w" });
    const bb = board.findPiece({ type: "b", color: "b" });
    if (wb.length && bb.length) {
      // opposite colors if at least one pair on different square colors
      const wSq = wb[0]!;
      const bSq = bb[0]!;
      const wLight =
        (wSq.charCodeAt(0) - 97 + Number(wSq[1])) % 2 === 0;
      const bLight =
        (bSq.charCodeAt(0) - 97 + Number(bSq[1])) % 2 === 0;
      if (wLight !== bLight) return "opposite_color_bishops";
    }
  }
  if (r === 0 && minors <= 2) return "minor_piece_vs_pawns";
  return "other";
}

export function classifyConversionState(args: {
  wpUser?: number | null;
  materialBalance?: number | null;
  pawnDiff?: number | null;
  theoreticalSaved?: boolean;
}): ConversionState {
  const wp = args.wpUser;
  const mat = args.materialBalance ?? 0;
  const pd = args.pawnDiff ?? 0;
  if (
    (wp != null && wp >= WP_ENDGAME_ADVANTAGE) ||
    mat >= 3 ||
    pd >= 2
  ) {
    return "winning_conversion";
  }
  if (
    args.theoreticalSaved ||
    (wp != null && wp <= WP_DISADVANTAGE) ||
    mat <= -3
  ) {
    return "holding_draw";
  }
  if (Math.abs(pd) >= 1 && (wp == null || (wp > 0.35 && wp < 0.65))) {
    return "pawn_race";
  }
  return "unclear";
}

const ENDGAME_TYPE_LABEL: Record<EndgameType, string> = {
  king_and_pawn: "king and pawn ending",
  single_rook: "rook vs pawns ending",
  rook_ending: "rook ending",
  opposite_color_bishops: "opposite-bishop ending",
  minor_piece_vs_pawns: "minor piece vs pawns ending",
  queen_ending: "queen ending",
  other: "simplified ending",
};

const CONVERSION_LABEL: Record<ConversionState, string> = {
  winning_conversion: "a winning conversion",
  holding_draw: "a holdable draw",
  pawn_race: "a pawn race",
  unclear: "an unclear technical fight",
};

const TECHNICAL_RULE: Record<EndgameType, string> = {
  king_and_pawn:
    "In king and pawn endgames, the king must lead the pawn to control key squares.",
  single_rook:
    "Activate the rook behind passed pawns and cut off the enemy king.",
  rook_ending:
    "Rooks belong behind passed pawns; seek the seventh rank and checks that gain tempi.",
  opposite_color_bishops:
    "Opposite bishops favour the attacker with two weaknesses; otherwise hold the blockade.",
  minor_piece_vs_pawns:
    "Use the minor piece to restrain passers; do not rush pawns without king support.",
  queen_ending:
    "Centralize the queen and create perpetual or mating nets; avoid careless checks.",
  other:
    "Activate the king, simplify into a known win, and avoid unnecessary pawn moves.",
};

const SHAPE_RULE: Record<Exclude<RookEndingShape, null>, string> = {
  lucena: "Build the Lucena bridge: shelter checks then escort the pawn.",
  philidor: "Hold the Philidor defence: rook on the third (sixth) until the pawn advances.",
  vancura: "Use the Vancura lateral checks against a rook pawn.",
};

export type EgStrategicVectors = {
  king_mechanics: string;
  pawn_dynamics: string;
  simplification: string;
  rook_activity: string;
};

export function buildEgStrategicVectors(args: {
  eg?: EndgameGameRow | null;
  shape?: RookEndingShape;
  playedIsPawn?: boolean;
  bestIsKing?: boolean;
}): EgStrategicVectors {
  const eg = args.eg;
  let king_mechanics = "quiet";
  if (args.playedIsPawn && args.bestIsKing) {
    king_mechanics = "pawn_advanced_without_king_lead";
  } else if ((eg?.endgame_opposition || 0) <= 0 && (eg?.king_distance ?? 9) >= 3) {
    king_mechanics = "passive_king";
  } else if ((eg?.endgame_opposition || 0) > 0) {
    king_mechanics = "king_leads_pawn";
  }

  let pawn_dynamics = "quiet";
  if (args.playedIsPawn && (eg?.king_centralization ?? 0) < 2) {
    pawn_dynamics = "passer_pushed_early";
  } else if ((eg?.pawn_diff ?? 0) > 0) {
    pawn_dynamics = "pawn_majority_press";
  }

  let simplification = "quiet";
  if (eg?.accidental_stalemate) simplification = "stalemate_blunder";
  else if (
    (eg?.simplification_trades || 0) === 0 &&
    (eg?.piece_trades || 0) > 0
  ) {
    simplification = "missed_simplification";
  } else if ((eg?.winning_trades || 0) === 0 && (eg?.piece_trades || 0) > 1) {
    simplification = "traded_into_drawn_endgame";
  }

  let rook_activity = "quiet";
  if (args.shape === "philidor") rook_activity = "philidor_defence";
  else if (args.shape === "lucena") rook_activity = "lucena_bridge";
  else if (args.shape === "vancura") rook_activity = "vancura_defence";
  else if ((eg?.endgame_seventh_rank_infiltration || 0) >= 1) {
    rook_activity = "seventh_rank_cut_off";
  } else if ((eg?.endgame_open_file_utilization || 0) === 0 && countHintRook(eg)) {
    rook_activity = "passive_rook_behind_pawn";
  }

  return { king_mechanics, pawn_dynamics, simplification, rook_activity };
}

function countHintRook(eg?: EndgameGameRow | null): boolean {
  return Boolean(eg && (eg.endgame_checks || 0) + (eg.endgame_open_file_utilization || 0) === 0);
}

export function buildEndgameStrategicInputs(args: {
  board: Chess;
  color: Color;
  eg?: EndgameGameRow | null;
  wpUser?: number | null;
  playedSan?: string | null;
  bestSan?: string | null;
}): Record<string, string | number | boolean | null> {
  const type = classifyEndgameType(args.board);
  const shape =
    type === "rook_ending" || type === "single_rook"
      ? classifyRookEndingShape(args.board)
      : null;
  const theoreticalKeys = Object.keys(args.eg?.theoretical || {}).filter(
    (k) => args.eg?.theoretical?.[k as keyof typeof args.eg.theoretical]
  );
  const theoretical = Boolean(shape || theoreticalKeys.length || args.eg?.theoretical_saved);
  const mat = pieceMaterialBalance(args.board, args.color);
  const conversion = classifyConversionState({
    wpUser: args.wpUser,
    materialBalance: mat,
    pawnDiff: args.eg?.pawn_diff ?? null,
    theoreticalSaved: args.eg?.theoretical_saved,
  });

  const played = (args.playedSan || "").replace(/[+#?!]/g, "");
  const best = (args.bestSan || "").replace(/[+#?!]/g, "");
  const playedIsPawn = /^[a-h][1-8]$/.test(played) || /^[a-h]x/.test(args.playedSan || "");
  const bestIsKing = best.startsWith("K");

  const vectors = buildEgStrategicVectors({
    eg: args.eg,
    shape,
    playedIsPawn: playedIsPawn,
    bestIsKing,
  });

  let played_move_error: string | null = null;
  if (args.eg?.accidental_stalemate) played_move_error = "stalemate_blunder";
  else if (playedIsPawn && bestIsKing) {
    played_move_error = "pawn_move_before_king_activation";
  } else if (vectors.king_mechanics === "passive_king") {
    played_move_error = "missed_opposition";
  } else if (vectors.simplification === "missed_simplification") {
    played_move_error = "missed_simplification";
  } else if (vectors.rook_activity === "passive_rook_behind_pawn") {
    played_move_error = "passive_rook";
  }

  const technical_rule =
    (shape && SHAPE_RULE[shape]) || TECHNICAL_RULE[type];

  const typeLabel = ENDGAME_TYPE_LABEL[type];
  const conversionLabel = CONVERSION_LABEL[conversion];
  const played_impact =
    played_move_error === "pawn_move_before_king_activation"
      ? "Advanced the pawn without king support, allowing the enemy king to seize opposition or block the promotion path."
      : played_move_error === "missed_opposition"
        ? "Left the king passive and lost the fight for key squares."
        : played_move_error === "missed_simplification"
          ? "Failed to liquidate into a clearly won simplified ending."
          : played_move_error === "passive_rook"
            ? "Left the rook passive instead of cutting off the king or sitting behind the passer."
            : played_move_error === "stalemate_blunder"
              ? "Allowed an accidental stalemate instead of converting cleanly."
              : `You reached ${conversionLabel} in a ${typeLabel}.`;

  const engine_line_plan =
    bestIsKing
      ? "Centralize the king to secure opposition or key squares before pushing pawns."
      : type === "rook_ending"
        ? "Activate the rook: seventh rank, behind passers, or checking distance."
        : "Improve the king and simplify when ahead.";

  const arrival =
    args.playedSan && args.bestSan && args.playedSan !== args.bestSan
      ? `In a ${typeLabel}, the better idea was ${args.bestSan}.`
      : `You reached ${conversionLabel} in a ${typeLabel}.`;
  const strategic_summary = [
    arrival,
    played_move_error ? played_impact : null,
    technical_rule && !(played_move_error ? played_impact : "").includes(technical_rule)
      ? technical_rule
      : null,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 360);

  return {
    endgame_type: type,
    theoretical: theoretical,
    theoretical_shape: shape,
    theoretical_keys: theoreticalKeys.slice(0, 4).join(",") || null,
    conversion_state: conversion,
    pawn_diff: args.eg?.pawn_diff ?? null,
    king_centralization: args.eg?.king_centralization ?? null,
    king_distance: args.eg?.king_distance ?? null,
    endgame_opposition: args.eg?.endgame_opposition ?? null,
    piece_trades: args.eg?.piece_trades ?? null,
    simplification_trades: args.eg?.simplification_trades ?? null,
    endgame_seventh_rank_infiltration:
      args.eg?.endgame_seventh_rank_infiltration ?? null,
    vector_king_mechanics: vectors.king_mechanics,
    vector_pawn_dynamics: vectors.pawn_dynamics,
    vector_simplification: vectors.simplification,
    vector_rook_activity: vectors.rook_activity,
    played_move_error,
    played_impact,
    engine_line_plan,
    technical_rule,
    strategic_summary,
    had_endgame_advantage: null,
    converted_endgame: null,
  };
}

export function softKeysFromEndgameContext(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): string[] {
  if (!inputs) return [];
  const out: string[] = ["endgame.strategic.active_king"];
  const type = String(inputs.endgame_type || "");
  const shape = String(inputs.theoretical_shape || "");
  if (type === "king_and_pawn") {
    out.push("endgame.theoretical.triangulation");
  }
  if (shape === "lucena") out.push("endgame.theoretical.lucena");
  if (shape === "philidor") out.push("endgame.theoretical.philidor");
  if (shape === "vancura") out.push("endgame.theoretical.vancura");
  if (type === "opposite_color_bishops") {
    out.push("endgame.strategic.opposite_bishops");
  }
  if (String(inputs.vector_simplification || "").includes("simplif")) {
    out.push("piece.simplification");
  }
  if (String(inputs.vector_rook_activity || "").includes("seventh")) {
    out.push("piece.seventh_rank_invasion");
  }
  if (String(inputs.vector_pawn_dynamics || "").includes("pawn")) {
    out.push("structure.passed_pawn");
  }
  if (String(inputs.conversion_state || "") === "winning_conversion") {
    out.push("piece.simplification");
  }
  return [...new Set(out)];
}

export function buildEndgameMetricSnapshot(
  eg: EndgameGameRow | null | undefined
): Record<string, string | number | boolean | null> {
  if (!eg || !eg.reached_endgame) return {};
  return {
    king_centralization: eg.king_centralization ?? null,
    king_distance: eg.king_distance ?? null,
    pawn_diff: eg.pawn_diff ?? null,
    piece_trades: eg.piece_trades ?? null,
    beneficial_trades: eg.beneficial_trades ?? null,
    winning_trades: eg.winning_trades ?? null,
    simplification_trades: eg.simplification_trades ?? null,
    accidental_stalemate: eg.accidental_stalemate ?? false,
    theoretical_saved: eg.theoretical_saved ?? false,
    endgame_opposition: eg.endgame_opposition ?? null,
    endgame_seventh_rank_infiltration:
      eg.endgame_seventh_rank_infiltration ?? null,
    endgame_open_file_utilization: eg.endgame_open_file_utilization ?? null,
    endgame_checks: eg.endgame_checks ?? null,
    endgame_pawn_breaks: eg.endgame_pawn_breaks ?? null,
  };
}

export function enrichEndgameCoachMoments(args: {
  momentsByPly: Record<
    number,
    {
      ply?: number;
      structuralKind?: string | null;
      inputs?: Record<string, string | number | boolean | null>;
      fen?: string;
      playedSan?: string;
      bestSan?: string | null;
      severity?: string | null;
    }
  >;
  userColor: Color;
  eg?: EndgameGameRow | null;
  style?: {
    had_endgame_advantage?: boolean;
    converted_endgame?: boolean;
  } | null;
}): void {
  const snap = buildEndgameMetricSnapshot(args.eg);
  const egStart0 = args.eg?.endgame_start_ply;
  for (const [plyKey, moment] of Object.entries(args.momentsByPly)) {
    const isEgCheckpoint = moment.structuralKind === "endgame_advantage";
    const momentPly1 = moment.ply ?? Number(plyKey);
    const momentPly0 = Number.isFinite(momentPly1) ? momentPly1 - 1 : null;
    const inEndgamePhase =
      egStart0 != null &&
      momentPly0 != null &&
      momentPly0 >= egStart0;
    const isLiveEg =
      Boolean(moment.fen) &&
      (Boolean(moment.severity) || Boolean(moment.inputs?.praise_mark)) &&
      inEndgamePhase;
    if (!isEgCheckpoint && !isLiveEg) continue;
    if (!args.eg?.reached_endgame && !isEgCheckpoint) continue;
    if (isEgCheckpoint && egStart0 != null && momentPly0 != null && momentPly0 < egStart0) {
      continue;
    }

    let strategic: Record<string, string | number | boolean | null> = {};
    if (moment.fen) {
      try {
        const board = new Chess(moment.fen);
        if (!isEgCheckpoint && nonPawnPieceCount(board) > ENDGAME_NON_PAWN_MAX) {
          continue;
        }
        const wp =
          typeof moment.inputs?.best_line_wp === "number"
            ? moment.inputs.best_line_wp
            : null;
        strategic = buildEndgameStrategicInputs({
          board,
          color: args.userColor,
          eg: args.eg,
          wpUser: wp,
          playedSan: moment.playedSan,
          bestSan: moment.bestSan,
        });
      } catch {
        strategic = {
          endgame_type: "other",
          conversion_state: "unclear",
          technical_rule: TECHNICAL_RULE.other,
          strategic_summary:
            "Endgame — activate the king and convert carefully.",
        };
      }
    } else if (isEgCheckpoint) {
      strategic = {
        endgame_type: "other",
        conversion_state: args.style?.had_endgame_advantage
          ? "winning_conversion"
          : "unclear",
        technical_rule: TECHNICAL_RULE.other,
        strategic_summary:
          "You reached a favourable endgame — activate the king and simplify when ahead.",
        ...snap,
      };
    } else {
      continue;
    }
    moment.inputs = {
      ...(moment.inputs || {}),
      ...snap,
      ...strategic,
      had_endgame_advantage:
        args.style?.had_endgame_advantage ??
        moment.inputs?.had_endgame_advantage ??
        false,
      converted_endgame: args.style?.converted_endgame ?? false,
    };
  }
}
