import { KNOWLEDGE_PACK, type KnowledgeCard } from "./knowledgePack";

export type RetrieveContext = {
  themes: string[];
  phase?: "opening" | "middlegame" | "endgame";
};

/**
 * Only cards whose requireThemes intersect board/opening tags.
 * No keyword/ECO fuzzy matching — that caused IQP/hanging spam.
 */
export function retrieveKnowledgeNugget(
  ctx: RetrieveContext,
  usedIds: Set<string>
): { cardId: string; label: string; text: string } | null {
  const themeSet = new Set(ctx.themes || []);
  if (!themeSet.size) return null;

  const phase = ctx.phase || "middlegame";
  const ranked: KnowledgeCard[] = [];
  for (const card of KNOWLEDGE_PACK) {
    const hit = card.requireThemes.some((t) => themeSet.has(t));
    if (!hit) continue;
    const phases = card.phases || ["any"];
    if (!phases.includes("any") && !phases.includes(phase)) continue;
    ranked.push(card);
  }

  // Prefer concrete structure over opening-family fluff when both match
  ranked.sort((a, b) => {
    const struct = new Set([
      "iqp",
      "hanging_pawns",
      "open_c_file",
      "open_file",
      "bishop_pair",
      "passed_pawn",
      "space",
    ]);
    const as = a.requireThemes.some((t) => struct.has(t)) ? 0 : 1;
    const bs = b.requireThemes.some((t) => struct.has(t)) ? 0 : 1;
    return as - bs;
  });

  for (const card of ranked) {
    for (let i = 0; i < card.rules.length; i++) {
      const uid = `${card.id}:${i}`;
      if (usedIds.has(uid)) continue;
      usedIds.add(uid);
      return { cardId: card.id, label: card.label, text: card.rules[i] };
    }
  }
  return null;
}
