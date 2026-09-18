/**
 * Coach note request kinds + metric-delta payloads.
 * Bad moves / opening checkpoints: played continuation vs engine PV (horizon),
 * plus engine-vs-played snap diff to justify why bestSan was better.
 */

import { Chess, type Color, type Square } from "chess.js";
import type { CoachMark } from "./coachMarks";
import type { CoachMetricMoment } from "./coachGameMetrics";
import type { PhaseName } from "./metricNoteWeights";
import {
  isHangingOrUnderdefended,
  pieceMaterialBalance,
  STYLE_MINOR_MAJOR,
  STYLE_PIECE_VALUE,
  swapColor,
} from "../styleMetrics";
import { kingAttackersPct, spaceAdvantagePct } from "../middlegamePhase";
import {
  countOpenFileUtilization,
  countSeventhRankPresence,
  zoneAdvanceSnaps,
  bishopComplexSnaps,
} from "../phaseTacticalMetrics";
import { middlegameAttackSnaps } from "../middlegameAttackSnaps";
import { isOpeningTempoWasteMove, countMinorsDeveloped } from "../openingPhase";
import {
  detectSituations,
  formatSituationRolesShort,
  formatSituationsShort,
  situationCastlingSnaps,
  type DetectedSituation,
} from "./situationProfiles";
import {
  detectTacticalFact,
  tacticalFactInputs,
  type TacticalFact,
} from "./tacticalFact";
import {
  measureTacticSharpness,
  tacticSharpnessInputs,
} from "./tacticSharpness";
import { userWinProbability, WP_INACCURACY_DROP } from "../winProb";
import { checkpointEvalInputs } from "./evalSwingIndex";
import {
  explainEngineLineVsPlayed,
  formatMetricSignalShort,
} from "./engineLineExplain";
import { buildMiddlegameStrategicInputs } from "./middlegameStructure";
import { packConditionFeatures } from "./packNoteContent";

const MG_STRATEGY_META = [
  "prefer_center_strike",
  "center_fluidity_index",
  "pawn_storm_tempo_delta",
  "king_center_file_exposure",
  "closed_center",
  "opposite_side_castling",
  "opp_king_in_centre",
  "opp_king_uncastled",
  "active_wing_user",
  "active_wing_opp",
  "user_wing_activity",
  "pawn_break_class",
  "mg_structure_type",
  "mg_structure",
  "engine_line_plan",
  "strategic_summary",
] as const;

function middlegameStrategyStamp(args: {
  phase: PhaseName;
  fenBefore?: string;
  moment?: CoachMetricMoment | null;
  playedSan?: string | null;
  userColor: "white" | "black";
  situations?: DetectedSituation[] | null;
  engineLineSans?: string[] | null;
}): Record<string, string | number | boolean | null> {
  const moment = args.moment || null;
  const want =
    args.phase === "middlegame" ||
    moment?.structuralKind === "decisive_pawn_break" ||
    moment?.structuralKind === "middlegame_aggregate";
  const fen = args.fenBefore || moment?.fen;
  if (!want || !fen) return {};
  try {
    const board = new Chess(fen);
    const played = args.playedSan || moment?.playedSan || "";
    const san = played.replace(/[+#?!x]/g, "");
    const toFile =
      san && /^[a-h]/.test(san) ? san.charCodeAt(0) - 97 : null;
    const isLever =
      moment?.structuralKind === "decisive_pawn_break" ||
      moment?.inputs?.pawn_break === true;
    return {
      ...buildMiddlegameStrategicInputs({
        board,
        color: args.userColor === "white" ? "w" : "b",
        situations: args.situations,
        inputs: moment?.inputs,
        playedSan: played || null,
        bestSan: moment?.bestSan,
        engineLineSans: args.engineLineSans,
        isLever: Boolean(isLever && toFile != null),
        toFile,
      }),
      material_balance: boardMetricSnap(
        board,
        args.userColor === "white" ? "white" : "black"
      ).material_balance,
    };
  } catch {
    return {};
  }
}

export type CoachNoteRequestKind =
  | "bad_move"
  | "structural_moment"
  | "fixed_checkpoint"
  | "praise_move";

export type BoardMetricSnap = {
  material_balance: number;
  mobility: number;
  king_attackers_pct: number;
  opp_king_attackers_pct: number;
  space_advantage_pct: number;
  hanging_material_own: number;
  hanging_material_opponent: number;
  open_file_utilization: number;
  seventh_rank_infiltration: number;
  /** Own pawn advance on a/b/c (≥2 ranks; depth score 2–5 each). */
  queenside_advance: number;
  queenside_advance_opponent: number;
  /** Own pawn advance on f/g/h. */
  kingside_advance: number;
  kingside_advance_opponent: number;
  /** Own pawn advance on c/d/e/f (flank overlap OK). */
  center_advance: number;
  center_advance_opponent: number;
  /** Squares the bishop oversees on diagonals (ray; includes capture square). */
  bishop_diagonal_influence_light: number;
  bishop_diagonal_influence_dark: number;
  bishop_diagonal_influence_light_opponent: number;
  bishop_diagonal_influence_dark_opponent: number;
  /** Empty squares on bishop diagonals (how open / unblocked). */
  bishop_openness_light: number;
  bishop_openness_dark: number;
  bishop_openness_light_opponent: number;
  bishop_openness_dark_opponent: number;
  castled_kingside: number;
  castled_queenside: number;
  castled_kingside_opponent: number;
  castled_queenside_opponent: number;
  opposite_side_castling: number;
  closed_center: number;
  blockade_square_control: number;
  maroczy_bind: number;
  carlsbad: number;
  minority_attack: number;
  caro_slav: number;
  hedgehog: number;
  scheveningen: number;
  dragon_formation: number;
  /** +1 knight-side vs bishops; -1 bishop-side; 0 none. */
  knight_vs_bishop: number;
  /** +1 good bishop; -1 bad bishop; 0 neutral. */
  good_vs_bad_bishop: number;
  /** Own wing race minus opp (opp-castle aware). */
  pawn_storm_tempo: number;
  /** Mobile d/e pawns vs locked heads (0 locked … 100 both files open). */
  center_fluidity_index: number;
  /** User queenside advance minus opp kingside advance. */
  pawn_storm_tempo_delta: number;
  /** Open/semi d/e files while opp king uncastled or on d/e. */
  king_center_file_exposure: number;
  /** Opp king on the d or e file. */
  opp_king_in_centre: number;
  /** Opp king not castled to wing. */
  opp_king_uncastled: number;
  /** Attackers÷defenders on opp king zone. */
  king_attack_ratio: number;
  /** Build-up score (attackers + open lines + uncastled). */
  attack_setup: number;
  /** Shield holes around opp king (0–3). */
  opp_king_weaknesses: number;
  /** Distinct weak sectors (king + wing / centre). */
  second_weakness: number;
  queen_centralization: number;
  connected_rooks: number;
  piece_liberation: number;
  side_clamp: number;
  key_square_control: number;
  /** % own minors/majors defended. */
  piece_support: number;
  wp?: number | null;
  eval_cp?: number | null;
};

export type MetricFieldDelta = {
  field: keyof BoardMetricSnap | string;
  before: number | boolean | null;
  after: number | boolean | null;
  delta: number | null;
};

export type CoachNoteRequest = {
  kind: CoachNoteRequestKind;
  ply: number;
  phase: PhaseName;
  mark: CoachMark | null;
  moment: CoachMetricMoment | null;
  deltaCp: number;
  /** Immediate metric change from the single played move. */
  playedMetricDelta: MetricFieldDelta[];
  /** Metric change along played move + engine continuation (horizon). */
  playedLineMetricDelta: MetricFieldDelta[];
  playedLineSans: string[];
  /** Metric change following best engine line (up to horizon moves). */
  engineLineMetricDelta: MetricFieldDelta[];
  engineLineSans: string[];
  /**
   * Engine-leaf snap minus played-alt-leaf snap (same horizon).
   * Played-alt = played move + engine PV from fenAfter (not the real game).
   * Positive on mobility / opp hanging / space ⇒ engine position is stronger there.
   */
  engineVsPlayedMetricDelta: MetricFieldDelta[];
  structuralKind?: CoachMetricMoment["structuralKind"];
  inputs?: CoachMetricMoment["inputs"];
  /** Tier-1 situation profiles active at fenBefore. */
  situations?: DetectedSituation[];
  /** Board-true tactic diagnosis for bad_move tips. */
  tacticalFact?: TacticalFact | null;
};

/** Central config: when notes fire and what payload they expect. */
export const COACH_NOTE_REQUEST_CONFIG = {
  /** Engine PV / played-continuation horizon for line compare. */
  engineLineHorizonMoves: 8,
  badMoveMarks: ["blunder", "mistake", "missed"] as const,
  praiseMarks: ["brilliant", "excellent"] as const,
  alwaysAttachKinds: [
    "bad_move",
    "structural_moment",
    "fixed_checkpoint",
    "praise_move",
  ] as const,
  /**
   * Rigid schedule — only these attach at fixed/dynamic plies.
   * Live structural (pawn break / opp mistake) are NOT fixed checkpoints.
   */
  fixedCheckpoints: [
    { structuralKind: "opening_name" as const, fullMove: 5 },
    { structuralKind: "opening_aggregate" as const, fullMove: 10 },
    { structuralKind: "middlegame_aggregate" as const, fullMove: null },
    { structuralKind: "endgame_advantage" as const, fullMove: null },
  ],
  /** Live structural kinds (flexible ply; still always-attach notes). */
  liveStructuralKinds: ["decisive_pawn_break" as const],
  /** Kept for callers; line/snap diffs now emit every field (minAbs 0). */
  minNumericDelta: 0,
  durableStructureTipThemes: [
    "iqp",
    "maroczy_bind",
    "carlsbad",
    "minority_attack",
    "caro_slav",
    "hedgehog",
    "scheveningen",
    "dragon_formation",
    "closed_center",
    "opposite_side_castling",
    "pawn_storm",
    "knight_vs_bishop",
    "good_vs_bad_bishop",
  ] as const,
  /**
   * Move-10 opening_aggregate: engine line only if eval gap ≥ inaccuracy.
   * Quiet openings stay concept/structure focused.
   */
  openingAggregateEngineMinWpDrop: WP_INACCURACY_DROP,
  /**
   * Pawn break: only recommend engine best when gap ≥ inaccuracy band.
   * Near-equal alternatives stay structure-focused (no "instead of …").
   */
  pawnBreakEngineMinWpDrop: WP_INACCURACY_DROP,
};

export type CoachNoteRequestConfig = typeof COACH_NOTE_REQUEST_CONFIG;

const BAD_SET = new Set<string>(COACH_NOTE_REQUEST_CONFIG.badMoveMarks);
const PRAISE_SET = new Set<string>(COACH_NOTE_REQUEST_CONFIG.praiseMarks);
const ALWAYS_SET = new Set<string>(COACH_NOTE_REQUEST_CONFIG.alwaysAttachKinds);
const FIXED_KINDS = new Set<string>(
  COACH_NOTE_REQUEST_CONFIG.fixedCheckpoints.map((c) => c.structuralKind)
);
const LIVE_STRUCTURAL = new Set<string>(
  COACH_NOTE_REQUEST_CONFIG.liveStructuralKinds
);

function colorFromUser(userColor: "white" | "black"): Color {
  return userColor === "white" ? "w" : "b";
}

function hangingMaterial(board: Chess, color: Color): number {
  let material = 0;
  for (const pt of [...STYLE_MINOR_MAJOR, "p" as const]) {
    for (const sq of board.findPiece({ type: pt, color })) {
      if (!isHangingOrUnderdefended(board, sq as Square, color)) continue;
      material += STYLE_PIECE_VALUE[pt] ?? 0;
    }
  }
  return material;
}

export function boardMetricSnap(
  board: Chess,
  userColor: "white" | "black",
  evalCpWhite?: number | null
): BoardMetricSnap {
  const color = colorFromUser(userColor);
  const userIsWhite = userColor === "white";
  return {
    material_balance: pieceMaterialBalance(board, color),
    hanging_material_own: hangingMaterial(board, color),
    hanging_material_opponent: hangingMaterial(board, swapColor(color)),
    mobility: board.moves().length,
    king_attackers_pct: kingAttackersPct(board, color),
    opp_king_attackers_pct: kingAttackersPct(board, swapColor(color)),
    space_advantage_pct: spaceAdvantagePct(board, color),
    open_file_utilization: countOpenFileUtilization(board, color),
    seventh_rank_infiltration: countSeventhRankPresence(board, color),
    ...zoneAdvanceSnaps(board, color),
    ...bishopComplexSnaps(board, color),
    ...situationCastlingSnaps(board, color),
    ...middlegameAttackSnaps(board, color),
    eval_cp: evalCpWhite ?? null,
    wp:
      evalCpWhite != null
        ? Math.round(userWinProbability(evalCpWhite, userIsWhite) * 1000) / 1000
        : null,
  };
}

const BOARD_METRIC_FIELDS: (keyof BoardMetricSnap)[] = [
  "material_balance",
  "mobility",
  "king_attackers_pct",
  "opp_king_attackers_pct",
  "space_advantage_pct",
  "hanging_material_own",
  "hanging_material_opponent",
  "open_file_utilization",
  "seventh_rank_infiltration",
  "queenside_advance",
  "queenside_advance_opponent",
  "kingside_advance",
  "kingside_advance_opponent",
  "center_advance",
  "center_advance_opponent",
  "bishop_diagonal_influence_light",
  "bishop_diagonal_influence_dark",
  "bishop_diagonal_influence_light_opponent",
  "bishop_diagonal_influence_dark_opponent",
  "bishop_openness_light",
  "bishop_openness_dark",
  "bishop_openness_light_opponent",
  "bishop_openness_dark_opponent",
  "castled_kingside",
  "castled_queenside",
  "castled_kingside_opponent",
  "castled_queenside_opponent",
  "opposite_side_castling",
  "closed_center",
  "blockade_square_control",
  "maroczy_bind",
  "carlsbad",
  "minority_attack",
  "caro_slav",
  "hedgehog",
  "scheveningen",
  "dragon_formation",
  "knight_vs_bishop",
  "good_vs_bad_bishop",
  "pawn_storm_tempo",
  "center_fluidity_index",
  "pawn_storm_tempo_delta",
  "king_center_file_exposure",
  "opp_king_in_centre",
  "opp_king_uncastled",
  "king_attack_ratio",
  "attack_setup",
  "opp_king_weaknesses",
  "second_weakness",
  "queen_centralization",
  "connected_rooks",
  "piece_liberation",
  "side_clamp",
  "key_square_control",
  "piece_support",
  "wp",
  "eval_cp",
];

export function diffMetricSnaps(
  before: BoardMetricSnap,
  after: BoardMetricSnap,
  _minAbs = COACH_NOTE_REQUEST_CONFIG.minNumericDelta
): MetricFieldDelta[] {
  const out: MetricFieldDelta[] = [];
  for (const field of BOARD_METRIC_FIELDS) {
    const b = before[field] ?? null;
    const a = after[field] ?? null;
    if (typeof b === "number" && typeof a === "number") {
      const delta = Math.round((a - b) * 1000) / 1000;
      out.push({ field, before: b, after: a, delta });
      continue;
    }
    if (b == null && a == null) {
      out.push({ field, before: null, after: null, delta: null });
      continue;
    }
    if (typeof b === "number" || typeof a === "number") {
      const bn = typeof b === "number" ? b : null;
      const an = typeof a === "number" ? a : null;
      out.push({
        field,
        before: bn,
        after: an,
        delta:
          bn != null && an != null
            ? Math.round((an - bn) * 1000) / 1000
            : null,
      });
      continue;
    }
    out.push({
      field,
      before: b as number | boolean | null,
      after: a as number | boolean | null,
      delta: null,
    });
  }
  return out;
}

/**
 * Metric change after playing `sans` from fen (stops early on illegal).
 * Horizon defaults to config.engineLineHorizonMoves.
 * If leaf still has hanging_material_own or hanging_material_opponent ≠ 0,
 * take one extra ply when available.
 */
export function metricDeltaAlongSans(args: {
  fen: string;
  sans: string[];
  userColor: "white" | "black";
  horizonMoves?: number;
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
}): { sans: string[]; deltas: MetricFieldDelta[]; snapAfter: BoardMetricSnap | null } {
  const horizon =
    args.horizonMoves ?? COACH_NOTE_REQUEST_CONFIG.engineLineHorizonMoves;
  const board = new Chess(args.fen);
  const before = boardMetricSnap(board, args.userColor, args.evalBeforeCp);
  const played: string[] = [];
  for (const san of args.sans.slice(0, horizon)) {
    try {
      const m = board.move(san);
      if (!m) break;
      played.push(m.san);
    } catch {
      break;
    }
  }
  if (!played.length) {
    return { sans: [], deltas: [], snapAfter: null };
  }
  let after = boardMetricSnap(
    board,
    args.userColor,
    args.evalAfterCp ?? null
  );
  if (
    (after.hanging_material_own !== 0 ||
      after.hanging_material_opponent !== 0) &&
    args.sans.length > played.length
  ) {
    const extraSan = args.sans[played.length];
    if (extraSan) {
      try {
        const m = board.move(extraSan);
        if (m) {
          played.push(m.san);
          after = boardMetricSnap(
            board,
            args.userColor,
            args.evalAfterCp ?? null
          );
        }
      } catch {
        /* stop at hanging leaf */
      }
    }
  }
  return {
    sans: played,
    deltas: diffMetricSnaps(before, after),
    snapAfter: after,
  };
}

/** Max SANs to request from PV/game so hanging-extra ply can fire. */
export function engineLineSansBudget(
  horizonMoves = COACH_NOTE_REQUEST_CONFIG.engineLineHorizonMoves
): number {
  return horizonMoves + 1;
}

/**
 * Alt line for compare: played move + engine continuation from fenAfter
 * (not the real game — avoids opponent later errors polluting the Δ).
 */
export function composePlayedAltLine(args: {
  playedSan: string | null | undefined;
  continuationSans?: string[];
  horizonMoves?: number;
}): string[] {
  const san = (args.playedSan || "").trim();
  if (!san) return [];
  const budget = engineLineSansBudget(args.horizonMoves);
  const out = [san];
  for (const c of args.continuationSans || []) {
    if (out.length >= budget) break;
    if (!c) continue;
    out.push(c);
  }
  return out;
}

export function detectPlayedOpeningTempoWaste(args: {
  phase: PhaseName;
  fenBefore?: string | null;
  playedSan?: string | null;
  userColor: "white" | "black";
}): { waste: boolean; piece: string | null } {
  if (args.phase !== "opening" || !args.fenBefore || !args.playedSan) {
    return { waste: false, piece: null };
  }
  try {
    const board = new Chess(args.fenBefore);
    const color: Color = args.userColor === "white" ? "w" : "b";
    if (board.turn() !== color) return { waste: false, piece: null };
    const move = board.move(args.playedSan);
    if (!move) return { waste: false, piece: null };
    board.undo();
    return isOpeningTempoWasteMove(board, move, color);
  } catch {
    return { waste: false, piece: null };
  }
}

function injectTempoWasteDelta(
  deltas: MetricFieldDelta[],
  waste: boolean
): MetricFieldDelta[] {
  if (!waste) return deltas;
  if (deltas.some((d) => d.field === "tempo_waste_rate_pct")) return deltas;
  return [
    { field: "tempo_waste_rate_pct", before: 100, after: 0, delta: -100 },
    ...deltas,
  ];
}

export function openingLocationStamp(args: {
  phase: PhaseName;
  fenBefore?: string | null;
  userColor: "white" | "black";
}): Record<string, string | number | boolean | null> {
  if (args.phase !== "opening" || !args.fenBefore) return {};
  try {
    const board = new Chess(args.fenBefore);
    const color: Color = args.userColor === "white" ? "w" : "b";
    const minors = countMinorsDeveloped(board, color);
    const attack = middlegameAttackSnaps(board, color);
    return {
      undeveloped_minors: minors < 4 ? 1 : 0,
      minors_developed: minors,
      opp_king_in_centre: attack.opp_king_in_centre,
      opp_king_uncastled: attack.opp_king_uncastled,
    };
  } catch {
    return {};
  }
}

export function playedMoveMetricDelta(args: {
  fenBefore: string;
  fenAfter: string;
  userColor: "white" | "black";
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
}): MetricFieldDelta[] {
  try {
    const before = boardMetricSnap(
      new Chess(args.fenBefore),
      args.userColor,
      args.evalBeforeCp
    );
    const after = boardMetricSnap(
      new Chess(args.fenAfter),
      args.userColor,
      args.evalAfterCp
    );
    return diffMetricSnaps(before, after);
  } catch {
    return [];
  }
}

export function isBadMoveMark(mark: CoachMark | null | undefined): boolean {
  return Boolean(mark && BAD_SET.has(mark));
}

export function isPraiseMark(mark: CoachMark | null | undefined): boolean {
  return Boolean(mark && PRAISE_SET.has(mark));
}

/** Played SAN matches engine best (bestSan or PV head) — no engine-vs-played compare. */
export function playedMoveIsBest(args: {
  playedSan?: string | null;
  bestSan?: string | null;
  bestPvSan?: string[] | null;
  moment?: CoachMetricMoment | null;
}): boolean {
  const played =
    (args.playedSan || args.moment?.playedSan || "").trim() || "";
  if (!played) return false;
  const best =
    (args.bestSan || args.moment?.bestSan || "").trim() ||
    (args.bestPvSan && args.bestPvSan[0] ? String(args.bestPvSan[0]).trim() : "");
  return Boolean(best && played === best);
}

/** Inaccuracy-or-worse mark, or WP drop ≥ inaccuracy band. */
export function openingEvalGapAllowsEngineLine(args: {
  mark?: CoachMark | null;
  deltaCp?: number;
  fenBefore?: string;
  userColor?: "white" | "black";
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
  minWpDrop?: number;
}): boolean {
  const mark = args.mark;
  if (
    mark === "inaccuracy" ||
    mark === "mistake" ||
    mark === "blunder" ||
    mark === "missed"
  ) {
    return true;
  }
  const minWp =
    args.minWpDrop ??
    COACH_NOTE_REQUEST_CONFIG.openingAggregateEngineMinWpDrop;
  if (
    args.evalBeforeCp != null &&
    args.evalAfterCp != null &&
    args.userColor
  ) {
    const userIsWhite = args.userColor === "white";
    const wpBefore = userWinProbability(args.evalBeforeCp, userIsWhite);
    const wpAfter = userWinProbability(args.evalAfterCp, userIsWhite);
    if (wpBefore - wpAfter >= minWp - 1e-9) return true;
  }
  // ~50cp ≈ soft inaccuracy band when WP unavailable
  if ((args.deltaCp || 0) >= 50) return true;
  return false;
}

/** Pawn-break engine recommend only when best is meaningfully better. */
export function pawnBreakEvalGapAllowsRecommend(args: {
  mark?: CoachMark | null;
  deltaCp?: number;
  userColor?: "white" | "black";
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
  playedBest?: boolean;
}): boolean {
  if (args.playedBest) return false;
  return openingEvalGapAllowsEngineLine({
    mark: args.mark,
    deltaCp: args.deltaCp,
    fenBefore: undefined,
    userColor: args.userColor,
    evalBeforeCp: args.evalBeforeCp,
    evalAfterCp: args.evalAfterCp,
    minWpDrop: COACH_NOTE_REQUEST_CONFIG.pawnBreakEngineMinWpDrop,
  });
}

export function requestAlwaysAttaches(
  kind: CoachNoteRequestKind | null | undefined
): boolean {
  return Boolean(kind && ALWAYS_SET.has(kind));
}

export function isFixedCheckpointMoment(
  moment: CoachMetricMoment | null | undefined
): boolean {
  return Boolean(
    moment?.structuralKind && FIXED_KINDS.has(moment.structuralKind)
  );
}

/** Moment.inputs keys for annotate / live moment logs. */
export function lineComparisonMomentInputs(
  req: Pick<
    CoachNoteRequest,
    | "engineLineSans"
    | "playedLineSans"
    | "engineLineMetricDelta"
    | "playedLineMetricDelta"
    | "engineVsPlayedMetricDelta"
  > & {
    bestSan?: string | null;
    phase?: string | null;
    openingKeyId?: string | null;
    openingName?: string | null;
    punishFrame?: boolean;
  }
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (req.engineLineSans.length) {
    out.engine_line = req.engineLineSans.join(" ");
  }
  if (req.playedLineSans.length) {
    out.played_line = req.playedLineSans.join(" ");
  }
  if (req.engineLineMetricDelta.length) {
    out.engine_line_metrics = formatMetricDeltaShort(
      req.engineLineMetricDelta
    );
  }
  if (req.playedLineMetricDelta.length) {
    out.played_line_metrics = formatMetricDeltaShort(
      req.playedLineMetricDelta
    );
    out.structure_delta = out.played_line_metrics;
  }
  if (req.engineVsPlayedMetricDelta.length) {
    out.engine_vs_played = formatMetricDeltaShort(
      req.engineVsPlayedMetricDelta
    );
  }
  const explained = explainEngineLineVsPlayed({
    bestSan: req.bestSan,
    engineLineSans: req.engineLineSans,
    playedLineSans: req.playedLineSans,
    engineVsPlayedMetricDelta: req.engineVsPlayedMetricDelta,
    engineLineMetricDelta: req.engineLineMetricDelta,
    playedLineMetricDelta: req.playedLineMetricDelta,
    phase: req.phase,
    openingKeyId: req.openingKeyId,
    openingName: req.openingName,
    punishFrame: req.punishFrame,
  });
  if (explained.softKeys.length) {
    out.metric_keys = explained.softKeys.join(",");
  }
  if (explained.primarySoftKeys.length) {
    out.primary_metric_keys = explained.primarySoftKeys.join(",");
  }
  if (explained.primaryField) {
    out.primary_field = explained.primaryField;
  }
  if (explained.reasons.length) {
    out.why_better = explained.reasons.join("; ");
  }
  if (explained.metricSignals.length) {
    out.metric_signals = formatMetricSignalShort(explained.metricSignals);
  }
  return out;
}

/**
 * Resolve which note request to fire for this ply, and fill metric payloads
 * for bad moves / opening checkpoints (played Δ + engine-line Δ + compare).
 */
export function buildCoachNoteRequest(args: {
  ply: number;
  phase: PhaseName;
  mark: CoachMark | null;
  moment?: CoachMetricMoment | null;
  deltaCp: number;
  fenBefore?: string;
  fenAfter?: string;
  bestPvSan?: string[];
  lines?: { san?: string; cpWhite: number }[] | null;
  /**
   * Played move + engine continuation after it (preferred).
   * Not the real game line — opponent later mistakes must not affect Δ.
   */
  playedLineSans?: string[];
  /** Played SAN; used with playedContinuationSans when playedLineSans omitted. */
  playedSan?: string | null;
  /** Engine PV from fenAfter (after the played move). */
  playedContinuationSans?: string[];
  userColor?: "white" | "black";
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
  /** Best-line leaf eval if known (else omitted from engine snap). */
  engineLineEvalCp?: number | null;
  unusedStructureThemes?: string[];
  /** Windowed structure themes (prefer over unused-only for situation detect). */
  structureThemes?: string[] | null;
  /** Windowed pawn-storm tempo from PawnStormTracker. */
  pawnStormTempo?: number | null;
  /** Precomputed situations (analyze tip loop); else detect from fenAfter. */
  situations?: DetectedSituation[] | null;
}): CoachNoteRequest | null {
  const rawMoment = args.moment || null;
  // Opp gifts must never drive tips. Strip structural; clear gift severity unless
  // the user already has an independent critical_mark on this ply.
  let moment = rawMoment;
  if (rawMoment?.structuralKind === "opponent_mistake") {
    const userCritical = Boolean(rawMoment.inputs?.critical_mark);
    moment = {
      ...rawMoment,
      structuralKind: undefined,
      severity: userCritical ? rawMoment.severity : null,
      dropCp: userCritical ? rawMoment.dropCp : 0,
    };
    delete moment.structuralKind;
  }
  const userColor = args.userColor || "white";

  const criticalMark =
    args.mark === "blunder" ||
    args.mark === "mistake" ||
    args.mark === "missed";
  const criticalMoment =
    (moment?.severity === "blunder" ||
      moment?.severity === "mistake" ||
      moment?.severity === "missed") &&
    !moment?.structuralKind;
  const criticalDrop =
    Boolean(moment && moment.dropCp >= 150 && !moment.structuralKind);

  let kind: CoachNoteRequestKind | null = null;
  // Inaccuracy is a board mark only — never a coach-moment / bad_move request.
  const inaccuracyOnly = args.mark === "inaccuracy";
  // Rigid schedule tips always win — fixed moments must print even with a mark.
  if (moment?.structuralKind && FIXED_KINDS.has(moment.structuralKind)) {
    kind = "fixed_checkpoint";
  } else if (
    moment?.structuralKind &&
    LIVE_STRUCTURAL.has(moment.structuralKind)
  ) {
    kind = "structural_moment";
  } else if (moment?.structuralKind) {
    kind = "structural_moment";
  } else if (criticalMark || criticalMoment || criticalDrop) {
    kind = "bad_move";
  } else if (
    !inaccuracyOnly &&
    (isBadMoveMark(args.mark) || (moment && moment.dropCp >= 80))
  ) {
    kind = "bad_move";
  } else if (
    isPraiseMark(args.mark) ||
    isPraiseMark(
      typeof args.moment?.inputs?.praise_mark === "string"
        ? (args.moment.inputs.praise_mark as CoachMark)
        : null
    )
  ) {
    kind = "praise_move";
  }
  // Bare Δ without mark/moment is not a coach call.

  if (!kind) return null;

  let playedMetricDelta: MetricFieldDelta[] = [];
  let playedLineMetricDelta: MetricFieldDelta[] = [];
  let playedLineSans: string[] = [];
  let engineLineMetricDelta: MetricFieldDelta[] = [];
  let engineLineSans: string[] = [];
  let engineVsPlayedMetricDelta: MetricFieldDelta[] = [];

  const wantPlayed =
    kind === "bad_move" ||
    kind === "praise_move" ||
    moment?.structuralKind === "decisive_pawn_break";
  const playedBest = playedMoveIsBest({
    playedSan: args.playedSan,
    bestSan: moment?.bestSan,
    bestPvSan: args.bestPvSan,
    moment,
  });
  const isPawnBreak = moment?.structuralKind === "decisive_pawn_break";
  const openingAggWantsEngine =
    !playedBest &&
    kind === "fixed_checkpoint" &&
    moment?.structuralKind === "opening_aggregate" &&
    openingEvalGapAllowsEngineLine({
      mark: args.mark,
      deltaCp: args.deltaCp,
      fenBefore: args.fenBefore,
      userColor,
      evalBeforeCp: args.evalBeforeCp,
      evalAfterCp: args.evalAfterCp,
    });
  const pawnBreakWantsEngine =
    isPawnBreak &&
    pawnBreakEvalGapAllowsRecommend({
      mark: args.mark,
      deltaCp: args.deltaCp,
      userColor,
      evalBeforeCp: args.evalBeforeCp,
      evalAfterCp: args.evalAfterCp,
      playedBest,
    });
  // Pawn break: always snap played continuation; engine recommend only when gap meaningful.
  // Other kinds: skip engine-vs-played when move already best.
  const wantLineCompare =
    isPawnBreak ||
    (!playedBest &&
      (kind === "bad_move" ||
        (kind === "fixed_checkpoint" &&
          moment?.structuralKind === "opening_name") ||
        openingAggWantsEngine));

  if (args.fenBefore && args.userColor && (wantPlayed || wantLineCompare)) {
    if (wantPlayed && args.fenAfter) {
      playedMetricDelta = playedMoveMetricDelta({
        fenBefore: args.fenBefore,
        fenAfter: args.fenAfter,
        userColor,
        evalBeforeCp: args.evalBeforeCp,
        evalAfterCp: args.evalAfterCp,
      });
    }
    if (wantLineCompare) {
      const horizon = COACH_NOTE_REQUEST_CONFIG.engineLineHorizonMoves;
      const altSans =
        args.playedLineSans?.length
          ? args.playedLineSans
          : composePlayedAltLine({
              playedSan: args.playedSan,
              continuationSans: args.playedContinuationSans,
              horizonMoves: horizon,
            });
      const playedLine = metricDeltaAlongSans({
        fen: args.fenBefore,
        sans: altSans,
        userColor,
        horizonMoves: horizon,
        evalBeforeCp: args.evalBeforeCp,
        evalAfterCp: args.evalAfterCp ?? null,
      });
      playedLineSans = playedLine.sans;
      playedLineMetricDelta = playedLine.deltas;

      const allowEngine =
        (!isPawnBreak && !playedBest) || pawnBreakWantsEngine;
      if (allowEngine) {
        const engine = metricDeltaAlongSans({
          fen: args.fenBefore,
          sans: args.bestPvSan || [],
          userColor,
          horizonMoves: horizon,
          evalBeforeCp: args.evalBeforeCp,
          evalAfterCp: args.engineLineEvalCp ?? null,
        });
        engineLineSans = engine.sans;
        engineLineMetricDelta = engine.deltas;
        if (
          !playedBest &&
          engine.snapAfter &&
          playedLine.snapAfter
        ) {
          engineVsPlayedMetricDelta = diffMetricSnaps(
            playedLine.snapAfter,
            engine.snapAfter
          );
        }
      }
    }
  }

  const fenForSit = args.fenAfter || args.fenBefore || moment?.fen || "";
  const situations =
    args.situations != null
      ? args.situations
      : fenForSit
        ? detectSituations({
            fen: fenForSit,
            phase: args.phase,
            userColor,
            structureThemes:
              args.structureThemes ?? args.unusedStructureThemes ?? null,
            pawnStormTempo: args.pawnStormTempo ?? null,
          })
        : [];
  const situationStamp: Record<string, string | number | boolean | null> =
    situations.length > 0
      ? {
          situations: formatSituationsShort(situations),
          situation_roles: formatSituationRolesShort(situations) || null,
        }
      : {};

  let tacticalFact: TacticalFact | null = null;
  if (
    kind === "bad_move" &&
    args.fenBefore &&
    (args.playedSan || moment?.playedSan)
  ) {
    const played = args.playedSan || moment?.playedSan || "";
    const best =
      moment?.bestSan ||
      (args.bestPvSan && args.bestPvSan[0] ? args.bestPvSan[0] : null);
    const continuation =
      args.playedContinuationSans?.length
        ? args.playedContinuationSans
        : args.playedLineSans && args.playedLineSans.length > 1
          ? args.playedLineSans.slice(1)
          : [];
    tacticalFact = detectTacticalFact({
      fenBefore: args.fenBefore,
      fenAfter: args.fenAfter,
      playedSan: played,
      bestSan: best,
      bestPvSan: args.bestPvSan || [],
      userColor,
      deltaCp: args.deltaCp,
      evalBeforeWhite: args.evalBeforeCp,
      evalAfterWhite: args.evalAfterCp,
      opponentReplySan: continuation[0] || null,
      playedContinuationSans: continuation,
      side: userColor,
      lines: args.lines,
    });
    if (!tacticalFact.kind) tacticalFact = null;
  }
  const sharp =
    kind === "bad_move" || kind === "praise_move"
      ? measureTacticSharpness({
          pvSan: args.bestPvSan || [],
          lines: args.lines,
          side: userColor,
        })
      : null;
  const tacticalStamp = {
    ...tacticalFactInputs(tacticalFact),
    ...tacticSharpnessInputs(sharp),
  };
  const mgStamp = middlegameStrategyStamp({
    phase: args.phase,
    fenBefore: args.fenBefore,
    moment,
    playedSan: args.playedSan,
    userColor,
    situations,
    engineLineSans: engineLineSans.length
      ? engineLineSans
      : args.bestPvSan || [],
  });
  const evalStamp = checkpointEvalInputs({
    evalCpWhite:
      args.evalAfterCp != null && Number.isFinite(args.evalAfterCp)
        ? args.evalAfterCp
        : typeof moment?.inputs?.eval_cp === "number"
          ? moment.inputs.eval_cp
          : typeof moment?.inputs?.best_line_eval_cp === "number"
            ? moment.inputs.best_line_eval_cp
            : null,
    userIsWhite: userColor === "white",
  });

  const tempoHit = detectPlayedOpeningTempoWaste({
    phase: args.phase,
    fenBefore: args.fenBefore,
    playedSan: args.playedSan || moment?.playedSan || null,
    userColor,
  });
  engineVsPlayedMetricDelta = injectTempoWasteDelta(
    engineVsPlayedMetricDelta,
    tempoHit.waste
  );
  const tempoStamp: Record<string, string | number | boolean | null> = tempoHit.waste
    ? {
        played_tempo_waste: true,
        played_tempo_piece: tempoHit.piece,
        tempo_waste_rate_pct: 1,
      }
    : {};
  const locationStamp = openingLocationStamp({
    phase: args.phase,
    fenBefore: args.fenBefore,
    userColor,
  });

  const mergedInputs: Record<string, string | number | boolean | null> = {
    ...(moment?.inputs || {}),
    ...situationStamp,
    ...tacticalStamp,
    ...mgStamp,
    ...evalStamp,
    ...tempoStamp,
    ...locationStamp,
  };
  const featureTags = packConditionFeatures({
    inputs: mergedInputs,
    tacticalFact,
  });
  if (featureTags.length) {
    mergedInputs.features = featureTags.join(",");
  }

  return {
    kind,
    ply: args.ply,
    phase: args.phase,
    mark: args.mark,
    moment,
    deltaCp: args.deltaCp,
    playedMetricDelta,
    playedLineMetricDelta,
    playedLineSans,
    engineLineMetricDelta,
    engineLineSans,
    engineVsPlayedMetricDelta,
    structuralKind: moment?.structuralKind,
    inputs: mergedInputs,
    situations,
    tacticalFact,
  };
}

export function formatMetricDeltaShort(
  deltas: MetricFieldDelta[],
  limit = BOARD_METRIC_FIELDS.length
): string {
  return deltas
    .slice(0, limit)
    .map((d) => {
      if (d.delta != null) {
        const sign = d.delta > 0 ? "+" : "";
        return `${d.field}:${d.before}→${d.after}(${sign}${d.delta})`;
      }
      return `${d.field}:${d.before}→${d.after}`;
    })
    .join(",");
}

export function formatCoachNoteRequest(req: CoachNoteRequest): string {
  const bits = [`kind=${req.kind}`];
  if (req.structuralKind) bits.push(`structural=${req.structuralKind}`);
  if (req.mark) bits.push(`mark=${req.mark}`);
  if (req.playedMetricDelta.length) {
    bits.push(`playedΔ[${formatMetricDeltaShort(req.playedMetricDelta)}]`);
  }
  if (req.playedLineSans.length) {
    bits.push(`playedLine=${req.playedLineSans.join(" ")}`);
  }
  if (req.playedLineMetricDelta.length) {
    bits.push(`playedLineΔ[${formatMetricDeltaShort(req.playedLineMetricDelta)}]`);
  }
  if (req.engineLineSans.length) {
    bits.push(`engineLine=${req.engineLineSans.join(" ")}`);
  }
  if (req.engineLineMetricDelta.length) {
    bits.push(`engineΔ[${formatMetricDeltaShort(req.engineLineMetricDelta)}]`);
  }
  if (req.engineVsPlayedMetricDelta.length) {
    bits.push(
      `engineVsPlayedΔ[${formatMetricDeltaShort(req.engineVsPlayedMetricDelta)}]`
    );
  }
  if (req.situations?.length) {
    bits.push(`situations[${formatSituationsShort(req.situations)}]`);
  }
  if (req.tacticalFact?.kind) {
    const tf = req.tacticalFact;
    if (tf.kind === "trapped_piece") {
      const piece = (tf.pieceLabel || "piece").replace(/_/g, " ");
      const own = tf.selfInflicted ? ":own" : "";
      const sq = tf.trapSquare ? `@${tf.trapSquare}` : "";
      const delay =
        tf.capturePlyDelay != null ? ` delay=${tf.capturePlyDelay}` : "";
      bits.push(`tactical=trapped_piece${own}:${piece}${sq}${delay}`);
    } else {
      bits.push(`tactical=${tf.kind}${tf.motif ? `:${tf.motif}` : ""}`);
    }
  }
  if (req.inputs?.tactical_sharp != null) {
    bits.push(
      `sharp=${req.inputs.tactical_sharp}:gap=${req.inputs.tactical_pv_gap_wp}:force=${req.inputs.tactical_forcing_ratio}`
    );
  }
  if (
    req.inputs?.prefer_center_strike != null ||
    req.inputs?.center_fluidity_index != null
  ) {
    bits.push(
      `centre=strike=${req.inputs.prefer_center_strike ?? 0}:fluid=${req.inputs.center_fluidity_index ?? 0}:exp=${req.inputs.king_center_file_exposure ?? 0}:wing=${req.inputs.active_wing_user || "—"}:break=${req.inputs.pawn_break_class || "—"}`
    );
  }
  if (req.inputs) {
    const inp = Object.entries(req.inputs)
      .filter(([, v]) => v != null && v !== "")
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    if (inp) bits.push(`inputs{${inp}}`);
  }
  return bits.join(" ");
}

/** Situations + tactical stamps for moment.inputs (analyze + annotate). */
export function coachRequestMetaInputs(
  request: CoachNoteRequest | null | undefined
): Record<string, string | number | boolean | null> {
  if (!request) return {};
  const sit: Record<string, string | number | boolean | null> =
    request.inputs?.situations != null
      ? {
          situations: request.inputs.situations,
          situation_roles: request.inputs.situation_roles ?? null,
        }
      : {};
  const tact: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(request.inputs || {})) {
    if (k.startsWith("tactical_") && v != null && v !== "") tact[k] = v;
  }
  const mg: Record<string, string | number | boolean | null> = {};
  for (const k of MG_STRATEGY_META) {
    const v = request.inputs?.[k];
    if (v != null && v !== "") mg[k] = v;
  }
  const tempo: Record<string, string | number | boolean | null> = {};
  if (request.inputs?.played_tempo_waste != null) {
    tempo.played_tempo_waste = request.inputs.played_tempo_waste;
  }
  if (request.inputs?.played_tempo_piece != null) {
    tempo.played_tempo_piece = request.inputs.played_tempo_piece;
  }
  if (request.inputs?.tempo_waste_rate_pct != null) {
    tempo.tempo_waste_rate_pct = request.inputs.tempo_waste_rate_pct;
  }
  for (const k of [
    "undeveloped_minors",
    "minors_developed",
    "opp_king_in_centre",
    "opp_king_uncastled",
  ] as const) {
    const v = request.inputs?.[k];
    if (v != null && v !== "") tempo[k] = v;
  }
  const featureTags = packConditionFeatures({
    inputs: request.inputs,
    tacticalFact: request.tacticalFact,
  });
  const feats: Record<string, string | number | boolean | null> = {};
  if (typeof request.inputs?.features === "string" && request.inputs.features) {
    feats.features = request.inputs.features;
  } else if (featureTags.length) {
    feats.features = featureTags.join(",");
  }
  return {
    ...sit,
    ...tact,
    ...mg,
    ...tempo,
    ...feats,
  };
}

/**
 * Unused durable structure/situation ids for structure-once tracking.
 * Prefer windowed structure + live situations; fall back to phase themes.
 */
export function durableUnusedStructureThemes(args: {
  windowedStructure?: string[] | null;
  situations?: DetectedSituation[] | null;
  structureThemeUsed?: Set<string> | null;
  phaseThemesFallback?: string[] | null;
}): string[] {
  const used = args.structureThemeUsed || new Set<string>();
  const durable = new Set<string>(
    COACH_NOTE_REQUEST_CONFIG.durableStructureTipThemes
  );
  const out: string[] = [];
  for (const t of args.windowedStructure || []) {
    if (!durable.has(t) || used.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  for (const s of args.situations || []) {
    if (!durable.has(s.id) || used.has(s.id) || out.includes(s.id)) continue;
    out.push(s.id);
  }
  if (out.length) return out;
  return (args.phaseThemesFallback || []).filter((t) => !used.has(t));
}
