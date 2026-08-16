/**
 * Map coach metric fields / moment inputs → soft-key ids for didactic notes.
 * Selection is metrics-first; keys teach the principle behind the metric.
 * When engine-vs-played why_better exists, those soft keys lead the pool.
 */

import {
  softKeysFromOpeningPeerGaps,
} from "./openingCoachInputs";
import { softKeysFromMiddlegamePeerGaps } from "./middlegameCoachInputs";
import { softKeysFromMgStructure } from "./middlegameStructure";
import { softKeysFromEndgameContext } from "./endgameContext";
import { themeTagToMetricKey } from "./metricThemes";
import {
  softKeysFromSituations,
  type DetectedSituation,
} from "./situationProfiles";
import {
  softKeysForTacticalFact,
  type TacticalFact,
} from "./tacticalFact";

/** Match engineLineExplain: higher engine-vs-played favors engine line. */
const COMPARE_HIGHER_BETTER = new Set([
  "mobility",
  "hanging_material_opponent",
  "space_advantage_pct",
  "opp_king_attackers_pct",
  "material_balance",
  "open_file_utilization",
  "seventh_rank_infiltration",
  "queenside_advance",
  "kingside_advance",
  "center_advance",
  "bishop_diagonal_influence_light",
  "bishop_diagonal_influence_dark",
  "bishop_openness_light",
  "bishop_openness_dark",
  "pawn_storm_tempo",
  "wp",
  "eval_cp",
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
]);

const COMPARE_LOWER_BETTER = new Set([
  "hanging_material_own",
  "king_attackers_pct",
  "queenside_advance_opponent",
  "kingside_advance_opponent",
  "center_advance_opponent",
  "bishop_diagonal_influence_light_opponent",
  "bishop_diagonal_influence_dark_opponent",
  "bishop_openness_light_opponent",
  "bishop_openness_dark_opponent",
]);

const FIELD_SOFT_HINT: Record<string, string> = {
  mobility: "piece_activity",
  king_attackers_pct: "king_safety",
  opp_king_attackers_pct: "attack",
  space_advantage_pct: "space",
  hanging_material_own: "prophylaxis",
  hanging_material_opponent: "tactics",
  open_file_utilization: "open_file",
  seventh_rank_infiltration: "seventh_rank",
  queenside_advance: "space",
  queenside_advance_opponent: "pawn_break",
  kingside_advance: "space",
  kingside_advance_opponent: "pawn_break",
  center_advance: "centre",
  center_advance_opponent: "pawn_break",
  bishop_diagonal_influence_light: "color_complexes",
  bishop_diagonal_influence_dark: "color_complexes",
  bishop_diagonal_influence_light_opponent: "color_complexes",
  bishop_diagonal_influence_dark_opponent: "color_complexes",
  bishop_openness_light: "color_complexes",
  bishop_openness_dark: "color_complexes",
  bishop_openness_light_opponent: "color_complexes",
  bishop_openness_dark_opponent: "color_complexes",
  castled_kingside: "king_safety",
  castled_queenside: "king_safety",
  castled_kingside_opponent: "king_safety",
  castled_queenside_opponent: "king_safety",
  opposite_side_castling: "opposite_side_castling",
  closed_center: "pawn_chain",
  blockade_square_control: "iqp",
  maroczy_bind: "space",
  carlsbad: "pawn_break",
  minority_attack: "space",
  caro_slav: "pawn_chain",
  hedgehog: "space",
  scheveningen: "space",
  dragon_formation: "dragon",
  knight_vs_bishop: "knight_vs_bishop",
  good_vs_bad_bishop: "good_vs_bad_bishop",
  pawn_storm_tempo: "attack",
  material_balance: "exchanges",
  wp: "initiative",
  eval_cp: "initiative",
  opp_king_in_centre: "king_safety",
  opp_king_uncastled: "king_safety",
  king_attack_ratio: "attack",
  attack_setup: "attack",
  opp_king_weaknesses: "king_safety",
  second_weakness: "two_weaknesses",
  queen_centralization: "piece_activity",
  connected_rooks: "piece_activity",
  piece_liberation: "piece_activity",
  side_clamp: "space",
  key_square_control: "outpost",
  piece_support: "piece_activity",
};

function compareDeltaHelpsEngine(field: string, delta: number): boolean | null {
  if (Math.abs(delta) < 1e-9) return null;
  if (COMPARE_HIGHER_BETTER.has(field)) return delta > 0;
  if (COMPARE_LOWER_BETTER.has(field)) return delta < 0;
  return delta > 0;
}

/** Soft keys for the top engine-helping Δ (why_better primary). */
export function primarySoftKeysFromMetricDeltas(
  deltas: Array<{ field: string; delta?: number | null }> | null | undefined
): string[] {
  if (!deltas?.length) return [];
  const scored = deltas
    .filter((d) => d.delta != null && Math.abs(d.delta) > 1e-9)
    .map((d) => ({
      field: d.field,
      abs: Math.abs(d.delta || 0),
      helps: compareDeltaHelpsEngine(d.field, d.delta || 0),
    }))
    .filter((x) => x.helps)
    .sort((a, b) => b.abs - a.abs);
  const primary = scored[0]?.field;
  if (!primary) return [];
  const fromMap = keysForMetricFields([primary]);
  const hint = FIELD_SOFT_HINT[primary];
  const fromHint = hint ? themeTagToMetricKey(hint) : null;
  return [...new Set([...fromMap, ...(fromHint ? [fromHint] : [])])];
}

export const METRIC_FIELD_TO_KEYS: Record<string, string[]> = {
  pawn_break: ["positional.pawn_break", "structure.pawn_chain"],
  pawn_breaks: ["positional.pawn_break", "structure.pawn_chain"],
  defended_pawn: ["positional.prophylaxis", "methodology.prophylactic_thinking"],
  defended_pawns: ["positional.prophylaxis", "methodology.prophylactic_thinking"],
  unblocking_bishop_light: [
    "positional.color_complexes",
    "imbalance.bishop_pair",
  ],
  unblocking_bishop_dark: [
    "positional.color_complexes",
    "imbalance.bishop_pair",
  ],
  checks: ["motif.pin_and_skewer", "attack.initiative"],
  blocking_checks: ["methodology.prophylactic_thinking", "motif.pin_and_skewer"],
  king_attackers: ["attack.king_safety", "attack.initiative"],
  king_attackers_score: ["attack.king_safety", "attack.initiative"],
  king_attackers_pct: ["attack.king_safety"],
  opp_king_attackers: ["attack.king_safety", "attack.initiative"],
  opp_king_attackers_pct: ["attack.king_safety", "attack.initiative"],
  opp_king_attackers_score: ["attack.king_safety", "attack.initiative"],
  space_advantage_pct: ["imbalance.space", "positional.restriction"],
  pawn_shield_pct: ["attack.king_safety"],
  hanging_material_own: ["methodology.candidate_moves"],
  hanging_material_opponent: ["attack.initiative"],
  mobility: ["piece.centralization", "piece.coordination"],
  material_balance: ["imbalance.material_asymmetry", "piece.simplification"],
  seventh_rank_infiltration: ["piece.seventh_rank_invasion"],
  open_file_utilization: ["piece.coordination", "imbalance.space"],
  queenside_advance: ["imbalance.space", "positional.pawn_break"],
  queenside_advance_opponent: ["imbalance.space", "attack.initiative"],
  kingside_advance: ["imbalance.space", "attack.initiative"],
  kingside_advance_opponent: ["imbalance.space", "attack.initiative"],
  center_advance: ["imbalance.space", "piece.centralization"],
  center_advance_opponent: ["imbalance.space", "piece.centralization"],
  bishop_diagonal_influence_light: [
    "positional.color_complexes",
    "imbalance.good_vs_bad_bishop",
  ],
  bishop_diagonal_influence_dark: [
    "positional.color_complexes",
    "imbalance.good_vs_bad_bishop",
  ],
  bishop_diagonal_influence_light_opponent: [
    "positional.color_complexes",
    "attack.initiative",
  ],
  bishop_diagonal_influence_dark_opponent: [
    "positional.color_complexes",
    "attack.initiative",
  ],
  bishop_openness_light: [
    "positional.color_complexes",
    "imbalance.bishop_pair",
  ],
  bishop_openness_dark: [
    "positional.color_complexes",
    "imbalance.bishop_pair",
  ],
  bishop_openness_light_opponent: [
    "positional.color_complexes",
    "imbalance.good_vs_bad_bishop",
  ],
  bishop_openness_dark_opponent: [
    "positional.color_complexes",
    "imbalance.good_vs_bad_bishop",
  ],
  castled_kingside: ["attack.king_safety", "attack.opposite_side_castling"],
  castled_queenside: ["attack.king_safety", "attack.opposite_side_castling"],
  castled_kingside_opponent: [
    "attack.king_safety",
    "attack.opposite_side_castling",
  ],
  castled_queenside_opponent: [
    "attack.king_safety",
    "attack.opposite_side_castling",
  ],
  opposite_side_castling: [
    "attack.opposite_side_castling",
    "attack.king_safety",
    "attack.initiative",
  ],
  closed_center: [
    "structure.pawn_chain",
    "positional.pawn_break",
    "positional.outpost",
  ],
  blockade_square_control: ["piece.blockade", "structure.iqp"],
  maroczy_bind: [
    "structure.maroczy_bind",
    "imbalance.space",
    "positional.restriction",
  ],
  carlsbad: [
    "structure.carlsbad",
    "imbalance.space",
    "positional.pawn_break",
  ],
  minority_attack: [
    "structure.carlsbad",
    "imbalance.space",
    "positional.pawn_break",
  ],
  caro_slav: [
    "structure.caro_slav",
    "structure.pawn_chain",
    "positional.pawn_break",
  ],
  hedgehog: [
    "structure.hedgehog",
    "imbalance.space",
    "positional.pawn_break",
  ],
  scheveningen: [
    "structure.scheveningen",
    "imbalance.space",
    "positional.pawn_break",
  ],
  dragon_formation: [
    "structure.dragon_formation",
    "attack.initiative",
    "positional.color_complexes",
  ],
  knight_vs_bishop: [
    "imbalance.knight_vs_bishop",
    "positional.outpost",
    "positional.color_complexes",
  ],
  good_vs_bad_bishop: [
    "imbalance.good_vs_bad_bishop",
    "positional.color_complexes",
    "imbalance.bishop_pair",
  ],
  pawn_storm_tempo: [
    "attack.opposite_side_castling",
    "attack.initiative",
    "imbalance.space",
  ],
  opposition: [
    "endgame.strategic.active_king",
    "endgame.theoretical.triangulation",
  ],
  minors_developed: ["piece.centralization"],
  pawn_moves: ["structure.pawn_chain"],
  castle_fullmove: ["attack.king_safety"],
  uncastled: ["attack.king_safety"],
  uncastled_rate_pct: ["attack.king_safety"],
  opening_accuracy_pct: [],
  center_control_pct: ["piece.centralization", "imbalance.space"],
  tempo_waste_rate_pct: ["piece.centralization"],
  peer_delta_minors_developed: ["piece.centralization"],
  peer_delta_center_control_pct: ["piece.centralization", "imbalance.space"],
  peer_delta_castle_fullmove: ["attack.king_safety"],
  peer_delta_uncastled_rate_pct: ["attack.king_safety"],
  peer_delta_tempo_waste_rate_pct: ["piece.centralization"],
  peer_delta_opening_accuracy_pct: [],
  peer_delta_middlegame_accuracy_pct: ["methodology.candidate_moves"],
  peer_delta_middlegame_blunders: [
    "methodology.candidate_moves",
    "methodology.visualization",
  ],
  peer_delta_middlegame_mistakes: ["methodology.comparison_and_elimination"],
  peer_delta_middlegame_inaccuracies: ["methodology.candidate_moves"],
  peer_delta_middlegame_missed_opportunity_pct: [
    "methodology.candidate_moves",
    "attack.initiative",
  ],
  peer_delta_middlegame_missed_tactic_pct: [
    "methodology.visualization",
    "methodology.candidate_moves",
  ],
  peer_delta_middlegame_allowed_tactic_pct: [
    "positional.prophylaxis",
    "methodology.candidate_moves",
  ],
  peer_delta_middlegame_king_attackers_score: ["attack.king_safety"],
  peer_delta_middlegame_opp_king_attackers_score: [
    "attack.initiative",
    "attack.king_safety",
  ],
  peer_delta_middlegame_pawn_shield_pct: ["attack.king_safety"],
  peer_delta_middlegame_open_file_proximity_pct: ["attack.king_safety"],
  peer_delta_middlegame_safe_moves_pct: [
    "piece.coordination",
    "positional.prophylaxis",
  ],
  peer_delta_middlegame_outpost_control: ["positional.outpost"],
  peer_delta_middlegame_space_advantage_pct: [
    "imbalance.space",
    "positional.restriction",
  ],
  peer_delta_middlegame_pawn_islands_avg: ["structure.pawn_chain"],
  middlegame_accuracy_pct: ["methodology.candidate_moves"],
  middlegame_blunders: ["methodology.candidate_moves"],
  middlegame_mistakes: ["methodology.comparison_and_elimination"],
  middlegame_missed_tactic_pct: ["methodology.visualization"],
  middlegame_allowed_tactic_pct: ["positional.prophylaxis"],
  middlegame_king_attackers_score: ["attack.king_safety"],
  middlegame_opp_king_attackers_score: ["attack.initiative"],
  middlegame_pawn_shield_pct: ["attack.king_safety"],
  middlegame_open_file_proximity_pct: ["attack.king_safety"],
  middlegame_safe_moves_pct: ["piece.coordination"],
  middlegame_outpost_control: ["positional.outpost"],
  middlegame_space_advantage_pct: ["imbalance.space"],
  middlegame_pawn_breaks: ["positional.pawn_break"],
  middlegame_seventh_rank_infiltration: ["piece.seventh_rank_invasion"],
  opp_king_in_centre: ["attack.king_safety", "attack.initiative"],
  opp_king_uncastled: ["attack.king_safety", "attack.initiative"],
  king_attack_ratio: ["attack.king_safety", "attack.initiative"],
  attack_setup: [
    "attack.initiative",
    "attack.opposite_side_castling",
  ],
  opp_king_weaknesses: ["attack.king_safety"],
  second_weakness: ["positional.two_weaknesses", "attack.initiative"],
  queen_centralization: ["piece.centralization"],
  connected_rooks: ["piece.coordination"],
  piece_liberation: [
    "piece.coordination",
    "positional.color_complexes",
  ],
  side_clamp: ["imbalance.space", "positional.restriction"],
  key_square_control: ["positional.outpost"],
  piece_support: ["piece.coordination"],
  had_iqp: ["structure.iqp"],
  had_doubled_pawns: ["structure.doubled_pawns"],
  had_backward_pawns: ["structure.pawn_chain"],
  blunders: ["methodology.candidate_moves", "methodology.visualization"],
  mistakes: ["methodology.comparison_and_elimination"],
  inaccuracies: ["methodology.candidate_moves"],
  accuracy_pct: ["methodology.candidate_moves"],
  brilliant_moves: ["motif.sacrifice"],
  important_moves: ["methodology.comparison_and_elimination"],
  excellent_moves: ["methodology.candidate_moves"],
  eco: [],
  opening: [],
  opening_name: [],
  opp_wp_gift: ["methodology.candidate_moves", "attack.initiative"],
  engine_line: ["methodology.visualization", "methodology.candidate_moves"],
  best_line_wp: ["endgame.strategic.active_king", "piece.simplification"],
  best_line_eval_cp: ["endgame.strategic.active_king"],
  had_endgame_advantage: ["endgame.strategic.active_king", "piece.simplification"],
  converted_endgame: ["endgame.strategic.active_king"],
  endgame_advantage_start_ply: ["endgame.strategic.active_king"],
};

export const OPENING_PLAN_KEYS = [
  "opening.caro_kann",
  "opening.english",
  "opening.french",
  "opening.italian",
  "opening.kings_indian",
  "opening.london_system",
  "opening.petroff",
  "opening.queens_gambit",
  "opening.ruy_lopez",
  "opening.scandinavian",
  "opening.sicilian",
] as const;

/** Soft keys preferred for fixed/live structural moments. */
export const STRUCTURAL_KIND_KEYS: Record<string, string[]> = {
  /**
   * Opening checkpoints: do NOT list every opening.* here.
   * The played opening is injected only via openingKeyId (resolveOpeningPackKey).
   * Metric soft keys come from opening snapshot / peer-gap inputs.
   */
  opening_name: [],
  opening_aggregate: [],
  middlegame_aggregate: [
    "imbalance.space",
    "attack.king_safety",
    "attack.initiative",
    "positional.pawn_break",
    "positional.two_weaknesses",
    "positional.outpost",
    "piece.coordination",
    "piece.centralization",
    "methodology.candidate_moves",
  ],
  endgame_advantage: [
    "endgame.strategic.active_king",
    "piece.simplification",
    "piece.seventh_rank_invasion",
  ],
  decisive_pawn_break: ["positional.pawn_break", "imbalance.space"],
  opponent_mistake: [
    "methodology.candidate_moves",
    "methodology.visualization",
    "attack.initiative",
  ],
};

export function keysForMetricFields(
  fields: Iterable<string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const bare = field.replace(/^(opening_|middlegame_|endgame_)/, "");
    const list =
      METRIC_FIELD_TO_KEYS[field] ||
      METRIC_FIELD_TO_KEYS[bare] ||
      [];
    for (const k of list) {
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

export function keysForCoachInputs(
  inputs: Record<string, string | number | boolean | null> | null | undefined,
  structuralKind?: string | null
): string[] {
  const fields = Object.keys(inputs || {}).filter((k) => {
    const v = inputs![k];
    return v != null && v !== "" && v !== false && v !== 0;
  });
  const fromInputs = keysForMetricFields(fields);
  const fromKind =
    structuralKind && STRUCTURAL_KIND_KEYS[structuralKind]
      ? STRUCTURAL_KIND_KEYS[structuralKind]!
      : [];
  return [...new Set([...fromKind, ...fromInputs])];
}

export function keysForMetricDeltas(
  deltas: Array<{ field: string; delta?: number | null }>
): string[] {
  const rising = deltas
    .filter((d) => d.delta == null || d.delta !== 0)
    .map((d) => d.field);
  return keysForMetricFields(rising);
}

/** Fallback soft keys when bad/praise moves lack metric Δ fields. */
export const MARK_KIND_KEYS: Record<string, string[]> = {
  bad_move: [
    "methodology.candidate_moves",
    "methodology.visualization",
    "methodology.comparison_and_elimination",
    "motif.intermediate_move",
    "attack.initiative",
  ],
  praise_move: [
    "motif.sacrifice",
    "methodology.comparison_and_elimination",
    "attack.initiative",
    "piece.centralization",
  ],
  phase_structure: [
    "methodology.candidate_moves",
    "positional.pawn_break",
    "imbalance.space",
  ],
};

/** Min |Δ| for engine-vs-played / line compare to contribute opening soft keys. */
const OPENING_LINE_DELTA_EPS = 1;

export function keysForSignificantMetricDeltas(
  deltas: Array<{ field: string; delta?: number | null }>,
  eps: number = OPENING_LINE_DELTA_EPS
): string[] {
  const rising = deltas
    .filter(
      (d) =>
        d.delta != null &&
        Number.isFinite(d.delta) &&
        Math.abs(Number(d.delta)) >= eps
    )
    .map((d) => d.field);
  return keysForMetricFields(rising);
}

/**
 * Soft-key pool for a note request — metrics / structural kind only.
 * Optional openingKeyId locks opening tip into opening_name / opening_aggregate.
 * Opening checkpoints: ONE opening.* (if named) + keys from significant
 * peer/snapshot judgments / line Δ only — no principle laundry list.
 */
export function softKeysForNoteRequest(args: {
  structuralKind?: string | null;
  inputs?: Record<string, string | number | boolean | null> | null;
  playedMetricDelta?: Array<{ field: string; delta?: number | null }>;
  playedLineMetricDelta?: Array<{ field: string; delta?: number | null }>;
  engineLineMetricDelta?: Array<{ field: string; delta?: number | null }>;
  engineVsPlayedMetricDelta?: Array<{ field: string; delta?: number | null }>;
  kind?: string | null;
  openingKeyId?: string | null;
  /** When middlegame/endgame, never inject opening.* into the tip pool. */
  phase?: "opening" | "middlegame" | "endgame" | null;
  /** Phase metric soft keys already derived for this game. */
  phaseMetricKeys?: string[];
  situations?: DetectedSituation[] | null;
  /** Sticky opening/structure plan keys for this game. */
  planKeys?: string[] | null;
  /** Board-true tactic diagnosis (bad_move). */
  tacticalFact?: TacticalFact | null;
}): string[] {
  const openingCheckpoint =
    args.structuralKind === "opening_name" ||
    args.structuralKind === "opening_aggregate";
  const allowOpeningKeys =
    openingCheckpoint || args.phase === "opening";
  const fromInputs = keysForCoachInputs(args.inputs, args.structuralKind);
  const peerGapKeys = openingCheckpoint
    ? softKeysFromOpeningPeerGaps(args.inputs)
    : softKeysFromMiddlegamePeerGaps(args.inputs);
  const fromPlayed = keysForMetricDeltas(args.playedMetricDelta || []);
  const fromPlayedLine = keysForMetricDeltas(args.playedLineMetricDelta || []);
  const fromEngine = keysForMetricDeltas(args.engineLineMetricDelta || []);
  const fromCompare = keysForMetricDeltas(
    args.engineVsPlayedMetricDelta || []
  );
  const fromMark =
    args.kind && MARK_KIND_KEYS[args.kind] ? MARK_KIND_KEYS[args.kind]! : [];
  const fromPhase = args.phaseMetricKeys || [];
  const fromSituations = softKeysFromSituations(args.situations);
  const fromPlan = (args.planKeys || []).filter(
    (k) => allowOpeningKeys || !k.startsWith("opening.")
  );
  const fromTactical = softKeysForTacticalFact(args.tacticalFact);
  const openingLock =
    args.openingKeyId && openingCheckpoint ? [args.openingKeyId] : [];
  const dropOpening = (keys: string[]) =>
    allowOpeningKeys
      ? keys
      : keys.filter((k) => !k.startsWith("opening."));

  const whyPrimary = primarySoftKeysFromMetricDeltas(
    args.engineVsPlayedMetricDelta?.length
      ? args.engineVsPlayedMetricDelta
      : args.engineLineMetricDelta
  );
  const whySoft = [
    ...whyPrimary,
    ...keysForMetricDeltas(
      (args.engineVsPlayedMetricDelta?.length
        ? args.engineVsPlayedMetricDelta
        : args.engineLineMetricDelta) || []
    ),
  ];

  if (openingCheckpoint) {
    const quietCompare = !(args.engineVsPlayedMetricDelta || []).some(
      (d) =>
        d.delta != null &&
        Number.isFinite(d.delta) &&
        Math.abs(Number(d.delta)) >= OPENING_LINE_DELTA_EPS
    );
    const lineKeys = quietCompare
      ? []
      : keysForSignificantMetricDeltas(
          args.engineVsPlayedMetricDelta || []
        );
    const pooled = [
      ...openingLock,
      ...peerGapKeys,
      ...lineKeys,
      ...fromSituations,
      ...fromPlan,
    ];
    return [...new Set(pooled)].filter((k) => {
      if (k.startsWith("methodology.")) return false;
      if (!k.startsWith("opening.")) return true;
      return Boolean(args.openingKeyId) && k === args.openingKeyId;
    });
  }

  if (args.structuralKind === "middlegame_aggregate") {
    const pooled = [
      ...peerGapKeys,
      ...softKeysFromMgStructure(args.inputs),
      ...fromSituations,
      ...fromPlan,
      ...fromInputs,
    ];
    return [...new Set(pooled)].filter((k) => !k.startsWith("opening."));
  }

  if (args.structuralKind === "endgame_advantage") {
    const pooled = [
      ...softKeysFromEndgameContext(args.inputs),
      ...fromSituations,
      ...fromPlan,
      ...fromInputs,
    ];
    return dropOpening([...new Set(pooled)]);
  }

  if (args.structuralKind === "decisive_pawn_break") {
    const structureKeys = keysForSignificantMetricDeltas(
      args.playedLineMetricDelta || []
    );
    const compareKeys = keysForSignificantMetricDeltas(
      args.engineVsPlayedMetricDelta || []
    );
    return dropOpening([
      ...new Set([
        "positional.pawn_break",
        "imbalance.space",
        ...softKeysFromMgStructure(args.inputs),
        ...structureKeys,
        ...compareKeys,
        ...fromSituations,
        ...fromPlan,
        ...fromInputs,
        ...fromPlayedLine,
        ...fromPlayed,
      ]),
    ]);
  }

  return dropOpening([
    ...new Set([
      ...fromTactical,
      ...whyPrimary,
      ...peerGapKeys,
      ...softKeysFromMgStructure(args.inputs),
      ...softKeysFromEndgameContext(args.inputs),
      ...openingLock,
      ...whySoft,
      ...fromCompare,
      ...fromEngine,
      ...fromPlayedLine,
      ...fromPlayed,
      ...fromSituations,
      ...fromPlan,
      ...fromInputs,
      ...fromPhase,
      ...fromMark,
    ]),
  ]);
}
