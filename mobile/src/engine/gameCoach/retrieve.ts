import { KNOWLEDGE_PACK, type KnowledgeCard } from "./knowledgePack";

export type RetrieveContext = {
  themes: string[];
  phase?: "opening" | "middlegame" | "endgame";
  wantCount?: number;
  /** Only retrieve when teaching value is high enough */
  strict?: boolean;
};

export type KnowledgeNugget = {
  cardId: string;
  label: string;
  text: string;
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function fingerprint(text: string): string {
  const norm = normalizeText(text);
  const words = norm.split(" ").filter((w) => w.length > 3);
  return words.slice(0, 12).join(" ");
}

const STRUCTURE_PRIORITY = new Set([
  "iqp",
  "hanging_pawns",
  "open_c_file",
  "open_file",
  "bishop_pair",
  "passed_pawn",
  "space",
  "minority_attack",
  "pawn_chain",
  "outpost",
  "king_safety",
  "opp_king_exposed",
  "user_king_exposed",
  "attack",
  "missed_opportunity",
  "counterplay",
  "weakness_exploitation",
  "forcing_moves",
  "tactics",
  "named_opening",
  "opening_plan",
  "opening_sicilian",
  "opening_najdorf",
  "opening_dragon",
  "opening_scheveningen",
  "opening_french",
  "opening_caro_kann",
  "opening_queens_gambit",
  "opening_qgd",
  "opening_kings_indian",
  "opening_indian",
  "opening_london",
  "opening_ruy_lopez",
  "opening_italian",
  "opening_scandinavian",
  "opening_petroff",
  "opening_english",
  "endgame_technique",
]);

const GENERIC_PHASE = new Set([
  "development",
  "centre",
  "piece_activity",
  "prophylaxis",
  "planning",
  "coordination",
  "endgame_technique",
]);

function cardScore(card: KnowledgeCard, themeSet: Set<string>): number {
  let score = 0;
  let hits = 0;
  for (const t of card.requireThemes) {
    if (!themeSet.has(t)) continue;
    hits += 1;
    score += STRUCTURE_PRIORITY.has(t) ? 4 : GENERIC_PHASE.has(t) ? 1 : 2;
  }
  if (hits === card.requireThemes.length && card.requireThemes.length > 1) {
    score += 2;
  }
  score += card.weight || 0;
  return score;
}

/**
 * Strict retrieval: prefer specific/high-value themes; skip weak generic matches.
 */
export function retrieveKnowledgeNuggets(
  ctx: RetrieveContext,
  usedIds: Set<string>
): KnowledgeNugget[] {
  const themeSet = new Set(ctx.themes || []);
  if (!themeSet.size) return [];

  const phase = ctx.phase || "middlegame";
  const want = Math.max(0, Math.min(ctx.wantCount ?? 1, 2));
  if (want === 0) return [];

  const strict = ctx.strict !== false;
  const minScore = strict ? 5 : 2;
  const hasSpecific = [...themeSet].some((t) => STRUCTURE_PRIORITY.has(t));

  const ranked = KNOWLEDGE_PACK.filter((card) => {
    const hit = card.requireThemes.some((t) => themeSet.has(t));
    if (!hit) return false;
    const phases = card.phases || ["any"];
    if (!(phases.includes("any") || phases.includes(phase))) return false;
    const score = cardScore(card, themeSet);
    if (score < minScore) return false;
    if (strict && !hasSpecific && card.requireThemes.every((t) => GENERIC_PHASE.has(t))) {
      return false;
    }
    return true;
  }).sort((a, b) => cardScore(b, themeSet) - cardScore(a, themeSet));

  const out: KnowledgeNugget[] = [];
  for (const card of ranked) {
    if (out.length >= want) break;
    for (let i = 0; i < card.rules.length; i++) {
      if (out.length >= want) break;
      const uid = `${card.id}:${i}`;
      if (usedIds.has(uid)) continue;
      const text = card.rules[i];
      const fp = fingerprint(text);
      if (!fp || usedIds.has(`fp:${fp}`)) continue;
      usedIds.add(uid);
      usedIds.add(`fp:${fp}`);
      out.push({ cardId: card.id, label: card.label, text });
    }
  }
  return out;
}

export function retrieveKnowledgeNugget(
  ctx: RetrieveContext,
  usedIds: Set<string>
): KnowledgeNugget | null {
  return retrieveKnowledgeNuggets({ ...ctx, wantCount: 1 }, usedIds)[0] || null;
}
