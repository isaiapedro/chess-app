/**
 * Middlegame skeleton, wing priorities, pawn-break class, strategic vectors.
 * Deterministic stamps for moment.inputs + tip lead (no live LLM).
 */

import { Chess, type Color, type Square } from "chess.js";
import {
  CENTER_FILES,
  KINGSIDE_FILES,
  QUEENSIDE_FILES,
  pawnAdvanceDepthScore,
  zoneAdvanceSnaps,
} from "../phaseTacticalMetrics";
import { squareFile, squareRank } from "../styleMetrics";
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
  castlingWingForColor,
  situationCastlingSnaps,
  type DetectedSituation,
} from "./situationProfiles";

export type WingId = "queenside" | "kingside" | "center" | "unclear";

export type PawnBreakClass =
  | "correct_wing_break"
  | "correct_center_break"
  | "thematic_wing_break"
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
  user_wing_activity: WingId;
};

const CRAMPED_QS_IDS = new Set([
  "dragon_formation",
  "maroczy_bind",
  "hedgehog",
  "scheveningen",
]);

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

export function preferCenterStrike(args: {
  closedCenter: boolean;
  oppKingUncastled: boolean;
  oppKingInCentre: boolean;
  userCastled: boolean;
  oppKingsideAdvance: number;
}): boolean {
  if (args.closedCenter) return false;
  const kingStuck = args.oppKingUncastled || args.oppKingInCentre;
  if (kingStuck && args.userCastled) return true;
  return args.oppKingsideAdvance >= 4;
}

function isCrampedQueensidePlan(
  situations?: DetectedSituation[] | null
): boolean {
  for (const s of situations || []) {
    if (s.role === "cramped" && CRAMPED_QS_IDS.has(s.id)) return true;
  }
  return false;
}

export function wingFromBestSan(san?: string | null): WingId | null {
  if (!san) return null;
  const clean = san.replace(/[+#?!]/g, "");
  if (clean === "O-O" || clean === "0-0") return "kingside";
  if (clean === "O-O-O" || clean === "0-0-0") return "queenside";
  const dest = clean.match(/([a-h])[1-8]$/);
  if (!dest) return null;
  const wing = wingForFile(dest[1].charCodeAt(0) - 97);
  const isPawn = /^[a-h]/.test(clean) && !/^[NBRQK]/.test(clean);
  if (isPawn) return wing;
  if (clean.startsWith("R") && (wing === "queenside" || wing === "kingside")) {
    return wing;
  }
  return null;
}

export function engineLinePawnPushScores(
  fen: string,
  sans: string[] | null | undefined,
  color: Color
): { queenside: number; kingside: number; center: number } {
  const out = { queenside: 0, kingside: 0, center: 0 };
  if (!sans?.length) return out;
  let board: Chess;
  try {
    board = new Chess(fen);
  } catch {
    return out;
  }
  for (const san of sans) {
    let m;
    try {
      m = board.move(san);
    } catch {
      break;
    }
    if (!m) break;
    if (m.color !== color || m.piece !== "p") continue;
    const wing = wingForFile(squareFile(m.to as Square));
    const depth = pawnAdvanceDepthScore(color, squareRank(m.to as Square)) ?? 1;
    if (wing === "queenside") out.queenside += depth;
    else if (wing === "kingside") out.kingside += depth;
    else if (wing === "center") out.center += depth;
  }
  return out;
}

export function wingFromEnginePawnPushes(scores: {
  queenside: number;
  kingside: number;
  center: number;
}): WingId | null {
  const qs = scores.queenside;
  const ks = scores.kingside;
  const center = scores.center;
  const max = Math.max(qs, ks, center);
  if (max < 1) return null;
  if (ks >= qs && ks >= center) return "kingside";
  if (qs >= ks && qs >= center) return "queenside";
  if (center >= qs && center >= ks) return "center";
  return null;
}

function resolveEngineLineSans(args: {
  engineLineSans?: string[] | null;
  inputs?: Record<string, string | number | boolean | null> | null;
}): string[] {
  if (args.engineLineSans?.length) return args.engineLineSans.filter(Boolean);
  const raw = args.inputs?.engine_line;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().split(/\s+/).filter(Boolean);
  }
  return [];
}

export function classifyWingPriorities(
  board: Chess,
  color: Color,
  situations?: DetectedSituation[] | null,
  engineLineSans?: string[] | null
): {
  active_wing_user: WingId;
  active_wing_opp: WingId;
  user_wing_activity: WingId;
} {
  const snaps = zoneAdvanceSnaps(board, color);
  const attack = middlegameAttackSnaps(board, color);
  const closed = isClosedCenter(board);
  const userWing = castlingWingForColor(board, color);
  const userCastled = userWing.kingside || userWing.queenside;
  const crampedQs = isCrampedQueensidePlan(situations);
  const engineWing = wingFromEnginePawnPushes(
    engineLinePawnPushScores(board.fen(), engineLineSans, color)
  );
  const centerStrike =
    !crampedQs &&
    preferCenterStrike({
      closedCenter: closed,
      oppKingUncastled: attack.opp_king_uncastled === 1,
      oppKingInCentre: attack.opp_king_in_centre === 1,
      userCastled,
      oppKingsideAdvance: snaps.kingside_advance_opponent,
    });
  let biasOpp: WingId | null = null;
  for (const s of situations || []) {
    if (s.id === "opposite_side_castling") biasOpp = "kingside";
    if (s.id === "minority_attack" && s.role === "minority_defender") {
      biasOpp = "queenside";
    }
    if (s.id === "pawn_storm") biasOpp = "kingside";
  }
  const user_wing_activity = wingFromScores(
    snaps.queenside_advance,
    snaps.kingside_advance,
    snaps.center_advance,
    null
  );
  const active_wing_opp = wingFromScores(
    snaps.queenside_advance_opponent,
    snaps.kingside_advance_opponent,
    snaps.center_advance_opponent,
    biasOpp
  );
  let active_wing_user: WingId = "unclear";
  if (engineWing) {
    active_wing_user = engineWing;
  } else if (crampedQs) {
    active_wing_user = "queenside";
  } else if (closed && snaps.kingside_advance_opponent >= 4) {
    active_wing_user = "queenside";
  } else if (centerStrike) {
    active_wing_user = "center";
  } else if (
    situations?.some(
      (s) => s.id === "minority_attack" && s.role === "minority_attacker"
    )
  ) {
    active_wing_user = "queenside";
  } else if (
    isOppositeSideCastling(board) &&
    attack.opp_king_uncastled !== 1 &&
    attack.opp_king_in_centre !== 1
  ) {
    active_wing_user = "kingside";
  }
  return { active_wing_user, active_wing_opp, user_wing_activity };
}

export function buildMiddlegameStructureSnap(
  board: Chess,
  color: Color,
  situations?: DetectedSituation[] | null,
  engineLineSans?: string[] | null
): MiddlegameStructureSnap {
  const type = classifyMgStructureType(board);
  const wings = classifyWingPriorities(board, color, situations, engineLineSans);
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
  preferCenterStrike?: boolean;
}): PawnBreakClass {
  if (!args.isLever) return "passive_move";
  const breakWing = wingForFile(args.toFile);
  const plan = args.activeWingUser;
  if (plan === "center") {
    if (breakWing === "center") return "correct_center_break";
    if (breakWing === "queenside" || breakWing === "kingside") {
      return "thematic_wing_break";
    }
    return "wrong_wing_break";
  }
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
  if (args.preferCenterStrike && breakWing !== "center") {
    return "thematic_wing_break";
  }
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
  correct_center_break: "correct_center_pawn_break",
  thematic_wing_break: "thematic_wing_pawn_break",
  wrong_center_break: "wrong_wing_pawn_break",
  wrong_wing_break: "wrong_wing_pawn_break",
  passive_move: "passive_move",
};

const BREAK_IMPACT: Record<PawnBreakClass, string> = {
  correct_wing_break:
    "Played the primary wing pawn break to open lines for counterplay.",
  correct_center_break:
    "Opened the centre to expose the king and drain the flank attack.",
  thematic_wing_break:
    "The wing lever fits this structure. A central idea was also available.",
  wrong_center_break:
    "Closed or levered the centre instead of the planned wing break, blunting pieces and handing the opponent a freer attack.",
  wrong_wing_break:
    "Broke on the wrong wing relative to the pawn-structure plan.",
  passive_move: "Missed a chance to execute the thematic pawn break.",
};

const STRUCTURE_LABEL: Record<MgStructureType, string> = {
  benoni_asymmetric: "Benoni structure",
  maroczy_bind: "Maróczy bind",
  closed_center: "closed centre",
  carlsbad: "Carlsbad structure",
  caro_slav: "Caro-Slav shell",
  hedgehog: "Hedgehog shell",
  scheveningen: "Scheveningen shell",
  dragon_formation: "Dragon structure",
  open_asymmetric: "open asymmetric middlegame",
  unclear: "unclear middlegame structure",
};

const WING_PLAN_LABEL: Record<WingId, string> = {
  queenside: "the queenside pawn break",
  kingside: "the kingside attack",
  center: "opening the centre",
  unclear: "improving the worst-placed piece",
};

function humanMgPlanSentence(
  type: MgStructureType,
  wing: WingId,
  oppWing: WingId
): string {
  const struct = STRUCTURE_LABEL[type] || "this structure";
  const plan = WING_PLAN_LABEL[wing] || "the thematic break";
  if (wing === "queenside" && (oppWing === "kingside" || type === "dragon_formation")) {
    return `In a ${struct}, your plan is ${plan} before their kingside play arrives`;
  }
  if (wing === "center") {
    return `In a ${struct}, your plan is ${plan} to punish the uncastled king`;
  }
  if (wing === "kingside") {
    return `In a ${struct}, your plan is ${plan} with pawn levers and piece support`;
  }
  return `In a ${struct}, your plan is ${plan}`;
}

function humanPieceScope(scope: string): string {
  const s = String(scope || "").replace(/_/g, " ").trim();
  if (!s || s === "quiet") return "";
  if (s.includes("bishop")) return "watch the bishop colour complexes";
  if (s.includes("rook") || s.includes("open")) return "use the open files";
  if (s.includes("cramped")) return "free the cramped pieces";
  return s;
}

export function buildMiddlegameStrategicInputs(args: {
  board: Chess;
  color: Color;
  situations?: DetectedSituation[] | null;
  inputs?: Record<string, string | number | boolean | null> | null;
  playedSan?: string | null;
  bestSan?: string | null;
  engineLineSans?: string[] | null;
  isLever?: boolean;
  toFile?: number | null;
  /** When false, skip "Played X instead of Y" (near-equal engine alternatives). */
  recommendBest?: boolean | null;
}): Record<string, string | number | boolean | null> {
  const structure = buildMiddlegameStructureSnap(
    args.board,
    args.color,
    args.situations,
    resolveEngineLineSans(args)
  );
  const vectors = buildMgStrategicVectors({
    board: args.board,
    color: args.color,
    inputs: args.inputs,
  });
  const attack = middlegameAttackSnaps(args.board, args.color);
  const snaps = zoneAdvanceSnaps(args.board, args.color);
  const userWing = castlingWingForColor(args.board, args.color);
  const centerStrikeFlag = preferCenterStrike({
    closedCenter: isClosedCenter(args.board),
    oppKingUncastled: attack.opp_king_uncastled === 1,
    oppKingInCentre: attack.opp_king_in_centre === 1,
    userCastled: userWing.kingside || userWing.queenside,
    oppKingsideAdvance: snaps.kingside_advance_opponent,
  });
  const breakClass =
    args.toFile != null && args.isLever != null
      ? classifyPawnBreakClass({
          toFile: args.toFile,
          activeWingUser: structure.active_wing_user,
          isLever: args.isLever,
          preferCenterStrike: centerStrikeFlag,
        })
      : null;

  const played_move_error = breakClass
    ? BREAK_ERROR[breakClass]
    : vectors.infiltration === "counterplay_stalled"
      ? "plan_alignment_fail"
      : null;
  const planSentence = humanMgPlanSentence(
    structure.mg_structure_type,
    structure.active_wing_user,
    structure.active_wing_opp
  );
  const scopeBit = humanPieceScope(vectors.piece_scope);
  const played_impact = breakClass
    ? BREAK_IMPACT[breakClass]
    : scopeBit
      ? `${planSentence}; ${scopeBit}.`
      : `${planSentence}.`;
  const sitSnaps = situationCastlingSnaps(args.board, args.color);
  const engine_line_plan =
    structure.active_wing_user === "center"
      ? "Open the centre (d/e) to punish the uncastled king and blunt the flank attack."
      : structure.active_wing_user === "queenside"
        ? "Execute the queenside pawn break to open files before the kingside attack arrives."
        : structure.active_wing_user === "kingside"
          ? "Press the kingside plan with pawn levers and piece support."
          : "Improve the worst-placed piece and prepare the thematic pawn break.";

  const recommendBest =
    args.recommendBest != null
      ? Boolean(args.recommendBest)
      : args.inputs?.engine_recommend === true;
  const skipInstead =
    breakClass === "thematic_wing_break" ||
    breakClass === "correct_wing_break" ||
    breakClass === "correct_center_break";
  const breakLead =
    breakClass ? BREAK_IMPACT[breakClass] : null;
  const strategic_summary = [
    recommendBest &&
    !skipInstead &&
    args.playedSan &&
    args.bestSan &&
    args.playedSan !== args.bestSan
      ? `Played ${args.playedSan} instead of ${args.bestSan}.`
      : null,
    breakLead,
    !breakLead ? planSentence + "." : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    mg_structure_type: structure.mg_structure_type,
    mg_structure: structure.mg_structure,
    active_wing_user: structure.active_wing_user,
    active_wing_opp: structure.active_wing_opp,
    user_wing_activity: structure.user_wing_activity,
    pawn_break_class: breakClass,
    prefer_center_strike: centerStrikeFlag ? 1 : 0,
    center_fluidity_index: sitSnaps.center_fluidity_index,
    pawn_storm_tempo_delta: sitSnaps.pawn_storm_tempo_delta,
    king_center_file_exposure: sitSnaps.king_center_file_exposure,
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
  if (wing === "center") {
    out.push(
      "positional.pawn_break",
      "attack.king_safety",
      "piece.coordination"
    );
  }
  if (wing === "queenside") out.push("imbalance.space", "positional.pawn_break");
  if (breakClass === "correct_center_break") {
    out.push(
      "positional.pawn_break",
      "attack.king_safety",
      "piece.coordination"
    );
  }
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
      const engineRaw = moment.inputs?.engine_line;
      const engineLineSans =
        typeof engineRaw === "string" && engineRaw.trim()
          ? engineRaw.trim().split(/\s+/).filter(Boolean)
          : [];
      const strategic = buildMiddlegameStrategicInputs({
        board,
        color: args.userColor,
        situations: sit,
        inputs: moment.inputs,
        playedSan: moment.playedSan,
        bestSan: moment.bestSan,
        engineLineSans,
        isLever: kind === "decisive_pawn_break" || moment.inputs?.pawn_break === true,
        toFile,
      });
      moment.inputs = { ...(moment.inputs || {}), ...strategic };
    } catch {
      /* ignore */
    }
  }
}
