/**
 * Phase themes = metric soft-keys (not free-form GPT topic labels).
 * Legacy theme tags map 1:1 into soft-key ids used by the mobile pack.
 */

export type MetricPhaseName = "opening" | "middlegame" | "endgame";

/** Soft keys allowed per phase (remake of former themesByPhase labels). */
export const PHASE_METRIC_KEYS: Record<MetricPhaseName, readonly string[]> = {
  opening: [
    "positional.pawn_break",
    "piece.centralization",
    "piece.coordination",
    "attack.initiative",
    "methodology.candidate_moves",
    "positional.prophylaxis",
  ],
  middlegame: [
    "attack.initiative",
    "positional.prophylaxis",
    "attack.king_safety",
    "attack.opposite_side_castling",
    "piece.coordination",
    "piece.centralization",
    "piece.simplification",
    "piece.seventh_rank_invasion",
    "piece.blockade",
    "positional.outpost",
    "positional.pawn_break",
    "positional.two_weaknesses",
    "positional.restriction",
    "imbalance.space",
    "positional.color_complexes",
    "imbalance.bishop_pair",
    "imbalance.good_vs_bad_bishop",
    "structure.iqp",
    "structure.pawn_chain",
    "structure.maroczy_bind",
    "structure.carlsbad",
    "structure.caro_slav",
    "structure.hedgehog",
    "structure.scheveningen",
    "structure.dragon_formation",
    "methodology.candidate_moves",
    "methodology.visualization",
  ],
  endgame: [
    "piece.coordination",
    "attack.initiative",
    "endgame.strategic.active_king",
    "piece.simplification",
    "piece.seventh_rank_invasion",
    "structure.passed_pawn",
    "positional.color_complexes",
    "imbalance.bishop_pair",
  ],
};

/** Legacy / heuristic theme tag → soft-key metric id. */
export const THEME_TO_METRIC_KEY: Record<string, string> = {
  pawn_breaks: "positional.pawn_break",
  pawn_break: "positional.pawn_break",
  development: "piece.centralization",
  piece_activity: "piece.coordination",
  initiative: "attack.initiative",
  tactics: "methodology.candidate_moves",
  prophylaxis: "positional.prophylaxis",
  king_safety: "attack.king_safety",
  exchanges: "piece.simplification",
  open_file: "piece.coordination",
  outpost: "positional.outpost",
  space: "imbalance.space",
  attack: "attack.initiative",
  centre: "imbalance.space",
  center: "imbalance.space",
  sacrifice: "motif.sacrifice",
  iqp: "structure.iqp",
  doubled_pawns: "structure.doubled_pawns",
  pawn_chain: "structure.pawn_chain",
  closed_center: "structure.pawn_chain",
  opposite_side_castling: "attack.opposite_side_castling",
  maroczy_bind: "structure.maroczy_bind",
  maroczy: "structure.maroczy_bind",
  carlsbad: "structure.carlsbad",
  minority_attack: "structure.carlsbad",
  caro_slav: "structure.caro_slav",
  "caro-slav": "structure.caro_slav",
  hedgehog: "structure.hedgehog",
  scheveningen: "structure.scheveningen",
  dragon_formation: "structure.dragon_formation",
  dragon: "structure.dragon_formation",
  knight_vs_bishop: "imbalance.knight_vs_bishop",
  good_vs_bad_bishop: "imbalance.good_vs_bad_bishop",
  pawn_storm: "attack.opposite_side_castling",
  pawn_storm_tempo: "attack.opposite_side_castling",
  bishop_pair: "imbalance.bishop_pair",
  color_complexes: "positional.color_complexes",
  good_vs_bad_bishop: "imbalance.good_vs_bad_bishop",
  queenside_advance: "imbalance.space",
  kingside_advance: "imbalance.space",
  center_advance: "imbalance.space",
  seventh_rank: "piece.seventh_rank_invasion",
  two_weaknesses: "positional.two_weaknesses",
  restriction: "positional.restriction",
  active_king: "endgame.strategic.active_king",
  opposition: "endgame.theoretical.triangulation",
  passed_pawn: "structure.passed_pawn",
  endgame_technique: "endgame.strategic.active_king",
  simplification: "piece.simplification",
  blockade: "piece.blockade",
  lucena: "endgame.theoretical.lucena",
  philidor: "endgame.theoretical.philidor",
  vancura: "endgame.theoretical.vancura",
  opposite_bishops: "endgame.strategic.opposite_bishops",
  fortress: "endgame.theoretical.fortress",
};

const PHASE_ALLOW = {
  opening: new Set(PHASE_METRIC_KEYS.opening),
  middlegame: new Set(PHASE_METRIC_KEYS.middlegame),
  endgame: new Set([
    ...PHASE_METRIC_KEYS.endgame,
    "endgame.theoretical.lucena",
    "endgame.theoretical.philidor",
    "endgame.theoretical.vancura",
    "endgame.theoretical.fortress",
    "endgame.strategic.opposite_bishops",
    "endgame.theoretical.triangulation",
    "endgame.strategic.pawn_break",
    "structure.iqp",
    "structure.doubled_pawns",
    "structure.pawn_chain",
    "structure.maroczy_bind",
    "structure.carlsbad",
    "structure.caro_slav",
    "structure.hedgehog",
    "structure.scheveningen",
    "structure.dragon_formation",
    "imbalance.bishop_pair",
    "piece.blockade",
    "attack.opposite_side_castling",
    "motif.sacrifice",
  ]),
};

export function themeTagToMetricKey(tag: string): string | null {
  const t = (tag || "").trim();
  if (!t) return null;
  if (t.includes(".")) return t;
  return THEME_TO_METRIC_KEY[t] || THEME_TO_METRIC_KEY[t.replace(/\s+/g, "_")] || null;
}

/** Map + filter theme tags into soft keys allowed for the phase. */
export function toPhaseMetricKeys(
  phase: MetricPhaseName,
  tags: Iterable<string>
): string[] {
  const allow = PHASE_ALLOW[phase];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const key = themeTagToMetricKey(tag);
    if (!key || !allow.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function metricKeyLabel(keyId: string): string {
  const bare = keyId.includes(".") ? keyId.split(".").slice(1).join(".") : keyId;
  return bare.replace(/_/g, " ");
}

/** Opening-principle soft keys (pack opening.* family). */
export const OPENING_PRINCIPLE_HINTS: Record<string, string[]> = {
  "opening.sicilian": [
    "Contest the center with ...c5 ideas and timely pawn breaks.",
    "Develop pieces toward queenside pressure before premature wing storms.",
  ],
  "opening.french": [
    "Challenge the center with ...c5 / ...f6 breaks once development is ready.",
    "Solve the light-squared bishop before locking the structure forever.",
  ],
  "opening.caro_kann": [
    "Keep a solid pawn chain and time the liberating break.",
    "Develop minors to active squares before chasing material.",
  ],
  "opening.italian": [
    "Develop minors, castle, then decide between quiet build-up and central break.",
    "Fight for d4/d5 tension without leaving the king exposed.",
  ],
  "opening.ruy_lopez": [
    "Pressure the pinned knight and prepare c3–d4 with completed development.",
    "Castle early; only then expand on the queenside or center.",
  ],
  "opening.queens_gambit": [
    "Contest d5 with sound development; do not grab c4 if it costs tempi.",
    "Develop the queenside bishop before launching minority-attack plans.",
  ],
  "opening.london_system": [
    "Keep the London triangle solid and castle before pawn storms.",
    "Use the e5/c5 breaks only after pieces support the holes.",
  ],
  "opening.kings_indian": [
    "Prepare the thematic pawn break after kingside development.",
    "Do not open the center while the king is uncastled.",
  ],
  "opening.english": [
    "Control d5/c4 complexes with pieces before pawn grabs.",
    "Develop toward the queenside space edge, then break.",
  ],
  "opening.petroff": [
    "Neutralize early pressure with clean development and timely exchanges.",
    "Castle and only then look for central counterplay.",
  ],
  "opening.scandinavian": [
    "Recycle the queen without losing tempi, then finish development.",
    "Castle before chasing further material in the open center.",
  ],
};

export function openingPrincipleDirectives(openingKeyId: string | null | undefined): string[] {
  if (!openingKeyId) return [];
  return OPENING_PRINCIPLE_HINTS[openingKeyId] || [
    "Develop minor pieces, castle, then contest the center with a prepared pawn break.",
    "Do not launch attacks before development and king safety are under control.",
  ];
}
