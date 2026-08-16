/**
 * Middlegame skeleton, wing priorities, pawn-break class, strategic vectors.
 * Deterministic stamps for moment.inputs + tip lead (no live LLM).
 */

import { Chess, type Color, type Square } from "chess.js";
import {
  CENTER_FILES,
  KINGSIDE_FILES,
  QUEENSIDE_FILES,
  zoneAdvanceSnaps,
} from "../phaseTacticalMetrics";
import { squareFile, swapColor } from "../styleMetrics";
import { middlegameAttackSnaps } from "../middlegameAttackSnaps";
import {
  isCarlsbad,
  isCaroSlav,
  isClosedCenter,
  isHedgehog,
  isMaroczyBind,
  isOppositeSideCastling,
  isScheveningen,
  isDragonFormation,
  type DetectedSituation,
} from "./situationProfiles";

export type WingId = "queenside" | "kingside" | "center" | "unclear";

export type PawnBreakClass =
  | "correct_wing_break"
  | "wrong_center_break"
  | "wrong_wing_break"
  | "passive_move";

export type MgStructureType =
  | "benoni_asymmetric"
  | "maroczy_bind"
  | "closed_center"
  | "carlsbad"
  | "caro_slav"
  | "hedgehog"
  | "scheveningen"
  | "dragon_formation"
  | "open_asymmetric"
  | "unclear";

export type MiddlegameStructureSnap = {
  mg_structure_type: MgStructureType;
  mg_structure: string;
  active_wing_user: WingId;
  active_wing_opp: WingId;
};

function hasPawn(board: Chess, color: Color, file: number, rank: number): boolean {
  const sq = `${"abcdefgh"[file]}${rank + 1}` as Square;
  const p = board.get(sq);
  return Boolean(p && p.type === "p" && p.color === color);
}

/** Black d6 + c-pawn back; White often c4/d5 space — Benoni-shaped. */
export function isBenoniAsymmetric(board: Chess): boolean {
  const blackD6 = hasPawn(board, "b", 3, 5);
  const blackCPawn =
    hasPawn(board, "b", 2, 6) ||
    hasPawn(board, "b", 2, 5) ||
    hasPawn(board, "b", 2, 4);
  const whiteC4 = hasPawn(board, "w", 2, 3);
  const whiteD5 = hasPawn(board, "w", 3, 4);
  const whiteD4 = hasPawn(board, "w", 3, 3);
  if (!(blackD6 && blackCPawn)) return false;
  return whiteC4 || whiteD5 || (whiteD4 && !hasPawn(board, "b", 3, 4));
}

export function classifyMgStructureType(board: Chess): MgStructureType {
  if (isMaroczyBind(board)) return "maroczy_bind";
  if (isBenoniAsymmetric(board)) return "benoni_asymmetric";
  if (isCarlsbad(board)) return "carlsbad";
  if (isCaroSlav(board)) return "caro_slav";
  if (isDragonFormation(board)) return "dragon_formation";
  if (isScheveningen(board)) return "scheveningen";
  if (isHedgehog(board)) return "hedgehog";
  if (isClosedCenter(board)) return "closed_center";
  return "open_asymmetric";
}

function wingFromScores(
  qs: number,
  ks: number,
  center: number,
  bias?: WingId | null
): WingId {
  const max = Math.max(qs, ks, center);
  if (max < 2) return bias || "unclear";
  if (ks >= qs && ks >= center && ks >= max - 1) return "kingside";
  if (qs >= ks && qs >= center && qs >= max - 1) return "queenside";
  if (center >= qs && center >= ks) return "center";
  return bias || "unclear";
}

export function classifyWingPriorities(
  board: Chess,
  color: Color,
  situations?: DetectedSituation[] | null
): { active_wing_user: WingId; active_wing_opp: WingId } {
  const snaps = zoneAdvanceSnaps(board, color);
  const opp = swapColor(color);
  let biasUser: WingId | null = null;
  let biasOpp: WingId | null = null;
  for (const s of situations || []) {
    if (s.id === "opposite_side_castling") {
      biasUser = "kingside";
      biasOpp = "kingside";
    }
    if (s.id === "pawn_storm") {
      biasUser = "kingside";
    }
    if (s.id === "minority_attack" && s.role === "minority_attacker") {
      biasUser = "queenside";
    }
    if (s.id === "minority_attack" && s.role === "minority_defender") {
      biasOpp = "queenside";
    }
    if (s.id === "maroczy_bind" && s.role === "cramped") {
      biasUser = "queenside";
    }
  }
  if (isOppositeSideCastling(board) && !biasUser) {
    biasUser = "kingside";
    biasOpp = "kingside";
  }
  void opp;
  return {
    active_wing_user: wingFromScores(
      snaps.queenside_advance,
      snaps.kingside_advance,
      snaps.center_advance,
      biasUser
    ),
    active_wing_opp: wingFromScores(
      snaps.queenside_advance_opponent,
      snaps.kingside_advance_opponent,
      snaps.center_advance_opponent,
      biasOpp
    ),
  };
}

export function buildMiddlegameStructureSnap(
  board: Chess,
  color: Color,
  situations?: DetectedSituation[] | null
): MiddlegameStructureSnap {
  const type = classifyMgStructureType(board);
  const wings = classifyWingPriorities(board, color, situations);
  const bits = [type, `user:${wings.active_wing_user}`, `opp:${wings.active_wing_opp}`];
  if (isClosedCenter(board)) bits.push("closed_centre");
  return {
    mg_structure_type: type,
    mg_structure: bits.join("|"),
    ...wings,
  };
}

export function wingForFile(file: number): WingId {
  if ((QUEENSIDE_FILES as readonly number[]).includes(file)) return "queenside";
  if ((KINGSIDE_FILES as readonly number[]).includes(file)) return "kingside";
  if ((CENTER_FILES as readonly number[]).includes(file)) return "center";
  return "unclear";
}

export function classifyPawnBreakClass(args: {
  toFile: number;
  activeWingUser: WingId;
  isLever: boolean;
}): PawnBreakClass {
  if (!args.isLever) return "passive_move";
  const breakWing = wingForFile(args.toFile);
  const plan = args.activeWingUser;
  if (plan === "unclear") {
    return breakWing === "center" ? "wrong_center_break" : "correct_wing_break";
  }
  if (breakWing === plan) return "correct_wing_break";
  if (breakWing === "center" && (plan === "queenside" || plan === "kingside")) {
    return "wrong_center_break";
  }
  if (
    (breakWing === "queenside" || breakWing === "kingside") &&
    (plan === "queenside" || plan === "kingside") &&
    breakWing !== plan
  ) {
    return "wrong_wing_break";
  }
  if (breakWing === "center") return "wrong_center_break";
  return "wrong_wing_break";
}

export type MgStrategicVectors = {
  king_threat: string;
  piece_scope: string;
  pawn_health: string;
  infiltration: string;
  king_attack_urgency: "low" | "mid" | "high";
};

export function buildMgStrategicVectors(args: {
  board: Chess;
  color: Color;
  inputs?: Record<string, string | number | boolean | null> | null;
}): MgStrategicVectors {
  const attack = middlegameAttackSnaps(args.board, args.color);
  const snaps = zoneAdvanceSnaps(args.board, args.color);
  const inp = args.inputs || {};
  const shield =
    typeof inp.middlegame_pawn_shield_pct === "number"
      ? inp.middlegame_pawn_shield_pct
      : typeof inp.pawn_shield_pct === "number"
        ? inp.pawn_shield_pct
        : 80;
  const ownAtk =
    typeof inp.middlegame_king_attackers_score === "number"
      ? inp.middlegame_king_attackers_score
      : 0;
  const oppAtk =
    typeof inp.middlegame_opp_king_attackers_score === "number"
      ? inp.middlegame_opp_king_attackers_score
      : attack.attack_setup * 4;

  let king_threat = "quiet";
  if (attack.attack_setup >= 3 || oppAtk >= 12) {
    king_threat =
      snaps.kingside_advance >= snaps.queenside_advance
        ? "high_opp_kingside_storm"
        : "high_attack_setup";
  } else if (ownAtk >= 10 || shield < 55) {
    king_threat = "own_king_pressured";
  } else if (attack.opp_king_uncastled || attack.opp_king_in_centre) {
    king_threat = "opp_king_exposed";
  }

  let piece_scope = "balanced";
  if (attack.piece_liberation <= 0 && attack.connected_rooks === 0) {
    piece_scope = "pieces_restricted";
  }
  if (attack.second_weakness >= 2) piece_scope = "second_weakness_open";
  if (
    typeof inp.middlegame_unblocking_bishop_dark === "number" &&
    inp.middlegame_unblocking_bishop_dark <= 0 &&
    attack.piece_liberation <= 1
  ) {
    piece_scope = "dark_bishop_blunted";
  }

  let pawn_health = "solid";
  if (inp.had_backward_pawns) pawn_health = "backward_created";
  else if (inp.had_iqp) pawn_health = "iqp_present";
  else if (
    typeof inp.middlegame_pawn_islands_avg === "number" &&
    inp.middlegame_pawn_islands_avg >= 3
  ) {
    pawn_health = "islands_worse";
  }

  let infiltration = "quiet";
  const seventh =
    typeof inp.middlegame_seventh_rank_infiltration === "number"
      ? inp.middlegame_seventh_rank_infiltration
      : 0;
  const openProx =
    typeof inp.middlegame_open_file_proximity_pct === "number"
      ? inp.middlegame_open_file_proximity_pct
      : 0;
  if (seventh >= 1) infiltration = "seventh_in";
  else if (openProx < 20 && snaps.queenside_advance < 4) {
    infiltration = "counterplay_stalled";
  }

  const king_attack_urgency: "low" | "mid" | "high" =
    king_threat.startsWith("high") || king_threat === "own_king_pressured"
      ? "high"
      : king_threat === "opp_king_exposed"
        ? "mid"
        : "low";

  return {
    king_threat,
    piece_scope,
    pawn_health,
    infiltration,
    king_attack_urgency,
  };
}

const BREAK_ERROR: Record<PawnBreakClass, string> = {
  correct_wing_break: "correct_wing_pawn_break",
  wrong_center_break: "wrong_wing_pawn_break",
  wrong_wing_break: "wrong_wing_pawn_break",
  passive_move: "passive_move",
};

const BREAK_IMPACT: Record<PawnBreakClass, string> = {
  correct_wing_break:
    "Played the primary wing pawn break to open lines for counterplay.",
  wrong_center_break:
    "Closed or levered the centre instead of the planned wing break, blunting pieces and handing the opponent a freer attack.",
  wrong_wing_break:
    "Broke on the wrong wing relative to the pawn-structure plan.",
  passive_move: "Missed a chance to execute the thematic pawn break.",
};

export function buildMiddlegameStrategicInputs(args: {
  board: Chess;
  color: Color;
  situations?: DetectedSituation[] | null;
  inputs?: Record<string, string | number | boolean | null> | null;
  playedSan?: string | null;
  bestSan?: string | null;
  isLever?: boolean;
  toFile?: number | null;
}): Record<string, string | number | boolean | null> {
  const structure = buildMiddlegameStructureSnap(
    args.board,
    args.color,
    args.situations
  );
  const vectors = buildMgStrategicVectors({
    board: args.board,
    color: args.color,
    inputs: args.inputs,
  });
  const breakClass =
    args.toFile != null && args.isLever != null
      ? classifyPawnBreakClass({
          toFile: args.toFile,
          activeWingUser: structure.active_wing_user,
          isLever: args.isLever,
        })
      : null;

  const played_move_error = breakClass
    ? BREAK_ERROR[breakClass]
    : vectors.infiltration === "counterplay_stalled"
      ? "plan_alignment_fail"
      : null;
  const played_impact = breakClass
    ? BREAK_IMPACT[breakClass]
    : `Structure ${structure.mg_structure_type}; wing plan ${structure.active_wing_user}; ${vectors.piece_scope.replace(/_/g, " ")}.`;
  const engine_line_plan =
    structure.active_wing_user === "queenside"
      ? "Execute the queenside pawn break to open files before the kingside attack arrives."
      : structure.active_wing_user === "kingside"
        ? "Press the kingside plan with pawn levers and piece support."
        : "Improve the worst-placed piece and prepare the thematic pawn break.";

  const strategic_summary = [
    args.playedSan && args.bestSan && args.playedSan !== args.bestSan
      ? `Played ${args.playedSan} instead of ${args.bestSan}.`
      : null,
    breakClass && breakClass !== "correct_wing_break"
      ? BREAK_IMPACT[breakClass]
      : null,
    `Plan: ${structure.active_wing_user} vs opp ${structure.active_wing_opp} (${structure.mg_structure_type}).`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    mg_structure_type: structure.mg_structure_type,
    mg_structure: structure.mg_structure,
    active_wing_user: structure.active_wing_user,
    active_wing_opp: structure.active_wing_opp,
    pawn_break_class: breakClass,
    vector_king_threat: vectors.king_threat,
    vector_piece_scope: vectors.piece_scope,
    vector_pawn_health: vectors.pawn_health,
    vector_infiltration: vectors.infiltration,
    king_attack_urgency: vectors.king_attack_urgency,
    played_move_error,
    played_impact,
    engine_line_plan,
    strategic_summary: strategic_summary.slice(0, 320),
  };
}

export function softKeysFromMgStructure(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): string[] {
  if (!inputs) return [];
  const out: string[] = [];
  const type = String(inputs.mg_structure_type || "");
  const breakClass = String(inputs.pawn_break_class || "");
  const wing = String(inputs.active_wing_user || "");
  if (type === "benoni_asymmetric" || type === "maroczy_bind") {
    out.push("imbalance.space", "positional.pawn_break");
  }
  if (type === "closed_center") out.push("structure.pawn_chain", "positional.pawn_break");
  if (type === "carlsbad") out.push("structure.carlsbad", "imbalance.space");
  if (wing === "kingside") {
    out.push("attack.opposite_side_castling", "attack.initiative");
  }
  if (wing === "queenside") out.push("imbalance.space", "positional.pawn_break");
  if (
    breakClass === "wrong_center_break" ||
    breakClass === "wrong_wing_break"
  ) {
    out.push("positional.pawn_break", "imbalance.space");
  }
  if (String(inputs.vector_piece_scope || "").includes("bishop")) {
    out.push("positional.color_complexes");
  }
  if (String(inputs.vector_king_threat || "").startsWith("high")) {
    out.push("attack.king_safety", "attack.initiative");
  }
  if (String(inputs.vector_pawn_health || "") === "backward_created") {
    out.push("structure.pawn_chain");
  }
  if (String(inputs.vector_infiltration || "") === "seventh_in") {
    out.push("piece.seventh_rank_invasion");
  }
  if (String(inputs.vector_piece_scope || "") === "second_weakness_open") {
    out.push("positional.two_weaknesses");
  }
  return [...new Set(out)];
}

/** Enrich live MG moments with structure / break / strategic summary. */
export function enrichMiddlegameStrategicMoments(args: {
  momentsByPly: Record<
    number,
    {
      structuralKind?: string | null;
      inputs?: Record<string, string | number | boolean | null>;
      fen?: string;
      playedSan?: string;
      bestSan?: string | null;
    }
  >;
  userColor: Color;
  situationsByPly?: Record<number, DetectedSituation[] | null | undefined>;
}): void {
  for (const [plyStr, moment] of Object.entries(args.momentsByPly)) {
    const kind = moment.structuralKind;
    const want =
      kind === "decisive_pawn_break" ||
      kind === "middlegame_aggregate" ||
      moment.inputs?.pawn_break === true;
    if (!want || !moment.fen) continue;
    try {
      const board = new Chess(moment.fen);
      const sit = args.situationsByPly?.[Number(plyStr)] || null;
      let toFile: number | null = null;
      const san = (moment.playedSan || "").replace(/[+#?!x]/g, "");
      if (san && /^[a-h]/.test(san)) {
        toFile = san.charCodeAt(0) - 97;
      }
      const strategic = buildMiddlegameStrategicInputs({
        board,
        color: args.userColor,
        situations: sit,
        inputs: moment.inputs,
        playedSan: moment.playedSan,
        bestSan: moment.bestSan,
        isLever: kind === "decisive_pawn_break" || moment.inputs?.pawn_break === true,
        toFile,
      });
      moment.inputs = { ...(moment.inputs || {}), ...strategic };
    } catch {
      /* ignore */
    }
  }
}
