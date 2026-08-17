/**
 * Curated human clauses for MG/EG soft keys when pack text is thin or spent.
 * Parallel to opening CLAUSE_TEMPLATES — short, no numbers / SAN / enums.
 */

export const METRIC_CLAUSE_TEMPLATES: Record<
  string,
  { good: string; bad: string }
> = {
  "imbalance.space": {
    good: "useful space for your pieces",
    bad: "claiming more space so your pieces have room to move",
  },
  "positional.pawn_break": {
    good: "a timely pawn break",
    bad: "looking for the freeing pawn break that opens your plan",
  },
  "piece.seventh_rank_invasion": {
    good: "heavy pieces on the seventh",
    bad: "getting a rook or queen onto the seventh rank",
  },
  "piece.coordination": {
    good: "pieces working together on open lines",
    bad: "connecting your pieces on the open files",
  },
  "piece.centralization": {
    good: "pieces taking strong central squares",
    bad: "centralizing the worst-placed piece",
  },
  "attack.king_safety": {
    good: "solid king safety",
    bad: "keeping the king safe before the position opens",
  },
  "attack.initiative": {
    good: "keeping the initiative",
    bad: "meeting their wing play before it grows",
  },
  "attack.opposite_side_castling": {
    good: "racing usefully on the opposite wing",
    bad: "hitting their king before their pawn storm lands",
  },
  "positional.two_weaknesses": {
    good: "pressure on a second weakness",
    bad: "creating a second weakness once the first is fixed",
  },
  "positional.color_complexes": {
    good: "control of the key colour complex",
    bad: "improving the bishop on the open colour complex",
  },
  "positional.restriction": {
    good: "their pieces short of squares",
    bad: "restricting their pieces before the net closes",
  },
  "motif.trapped_piece": {
    good: "their piece with no escape",
    bad: "calculating the net before the capture appears",
  },
  "motif.pin_and_skewer": {
    good: "a useful pin or skewer",
    bad: "looking for pins and skewers along open lines",
  },
  "structure.pawn_chain": {
    good: "a healthy pawn chain",
    bad: "challenging the base of their pawn chain",
  },
  "structure.passed_pawn": {
    good: "a useful passed pawn",
    bad: "supporting the passer with the king before pushing",
  },
  "piece.simplification": {
    good: "a clean simplification",
    bad: "simplifying into a clearly won ending",
  },
  "endgame.strategic.active_king": {
    good: "an active king",
    bad: "bringing the king into the fight before pawn moves",
  },
  "endgame.theoretical.lucena": {
    good: "the Lucena bridge idea",
    bad: "building the Lucena bridge to escort the pawn",
  },
  "endgame.theoretical.philidor": {
    good: "holding the Philidor defence",
    bad: "keeping the Philidor rook defence until the pawn advances",
  },
  "endgame.theoretical.vancura": {
    good: "the Vancura defence",
    bad: "using lateral checks in the Vancura defence",
  },
  "endgame.strategic.opposite_bishops": {
    good: "attacking with opposite bishops",
    bad: "creating two weaknesses in the opposite-bishop ending",
  },
};

const METRIC_FIELD_CLAUSES: Record<string, { good: string; bad: string }> = {
  tempo_waste_rate_pct: {
    good: "clean development without wasted tempi",
    bad: "avoiding tempo-wasting moves while developing",
  },
  piece_support: {
    good: "pieces covering one another",
    bad: "pieces covering one another before the next idea",
  },
  minors_developed: {
    good: "good development of the minors",
    bad: "finishing development of the remaining minors",
  },
};

/** Field → soft key for metric-delta → clause mapping. */
export const METRIC_FIELD_SOFT_KEY: Record<string, string> = {
  space_advantage_pct: "imbalance.space",
  mobility: "piece.coordination",
  open_file_utilization: "piece.coordination",
  tempo_waste_rate_pct: "piece.centralization",
  piece_support: "piece.coordination",
  minors_developed: "piece.centralization",
  seventh_rank_infiltration: "piece.seventh_rank_invasion",
  hanging_material_own: "motif.trapped_piece",
  hanging_material_opponent: "motif.trapped_piece",
  king_attackers_pct: "attack.king_safety",
  opp_king_attackers_pct: "attack.initiative",
  queenside_advance: "imbalance.space",
  kingside_advance: "attack.initiative",
  center_advance: "positional.pawn_break",
  center_fluidity_index: "positional.pawn_break",
  king_center_file_exposure: "attack.king_safety",
  opp_king_in_centre: "attack.king_safety",
  opp_king_uncastled: "attack.king_safety",
  second_weakness: "positional.two_weaknesses",
  connected_rooks: "piece.coordination",
  piece_liberation: "piece.coordination",
  queen_centralization: "piece.centralization",
  bishop_openness_light: "positional.color_complexes",
  bishop_openness_dark: "positional.color_complexes",
  pawn_storm_tempo: "attack.opposite_side_castling",
  pawn_storm_tempo_delta: "attack.opposite_side_castling",
};

/** Higher = better for the user (delta > 0 → good clause). */
const HIGHER_BETTER = new Set([
  "space_advantage_pct",
  "mobility",
  "piece_support",
  "minors_developed",
  "open_file_utilization",
  "seventh_rank_infiltration",
  "hanging_material_opponent",
  "opp_king_attackers_pct",
  "queenside_advance",
  "kingside_advance",
  "center_advance",
  "center_fluidity_index",
  "king_center_file_exposure",
  "opp_king_in_centre",
  "opp_king_uncastled",
  "second_weakness",
  "connected_rooks",
  "piece_liberation",
  "queen_centralization",
  "bishop_openness_light",
  "bishop_openness_dark",
  "pawn_storm_tempo",
  "pawn_storm_tempo_delta",
]);

export function clauseForSoftKey(
  softKey: string,
  judgment: "good" | "bad",
  usedClauses?: Set<string>
): string | null {
  const templ = METRIC_CLAUSE_TEMPLATES[softKey];
  if (!templ) return null;
  const clause = templ[judgment];
  if (!clause) return null;
  const key = clause.toLowerCase().replace(/[^a-z]+/g, "");
  if (usedClauses?.has(key)) return null;
  return clause;
}

export function clauseForMetricDelta(
  field: string,
  delta: number,
  usedClauses?: Set<string>
): { clause: string; softKey: string; judgment: "good" | "bad" } | null {
  const softKey = METRIC_FIELD_SOFT_KEY[field] || "";
  const higherBetter = HIGHER_BETTER.has(field);
  const good =
    (higherBetter && delta > 0) || (!higherBetter && delta < 0);
  const judgment: "good" | "bad" = good ? "good" : "bad";
  const fieldClause = METRIC_FIELD_CLAUSES[field]?.[judgment];
  if (fieldClause) {
    const key = fieldClause.toLowerCase().replace(/[^a-z]+/g, "");
    if (usedClauses?.has(key)) return null;
    return { clause: fieldClause, softKey: softKey || field, judgment };
  }
  if (!softKey) return null;
  const clause = clauseForSoftKey(softKey, judgment, usedClauses);
  if (!clause) return null;
  return { clause, softKey, judgment };
}

export function clauseForBreakClass(
  breakClass: string | null | undefined,
  usedClauses?: Set<string>
): string | null {
  const c = String(breakClass || "");
  if (!c) return null;
  if (c === "correct_wing_break" || c === "correct_center_break") {
    return clauseForSoftKey("positional.pawn_break", "good", usedClauses);
  }
  if (c === "thematic_wing_break") {
    return clauseForSoftKey("positional.pawn_break", "good", usedClauses);
  }
  if (
    c === "wrong_center_break" ||
    c === "wrong_wing_break" ||
    c === "passive_move"
  ) {
    return clauseForSoftKey("positional.pawn_break", "bad", usedClauses);
  }
  return null;
}
