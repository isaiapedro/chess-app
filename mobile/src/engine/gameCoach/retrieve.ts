import { KNOWLEDGE_PACK, type KnowledgeCard } from "./knowledgePack";
import {
  DERIVED_COACH_PACK,
  type DerivedCoachEntry,
} from "./derivedCoachPack";

export type RetrieveContext = {
  themes: string[];
  phase?: "opening" | "middlegame" | "endgame";
  wantCount?: number;
  /** Only retrieve when teaching value is high enough */
  strict?: boolean;
  fen?: string;
  san?: string;
  bestSan?: string | null;
  eco?: string | null;
  opening?: string | null;
  /** Recent mainline SANs for frequent-line overlap (optional) */
  recentSans?: string[];
};

export type KnowledgeNugget = {
  cardId: string;
  label: string;
  text: string;
  source?: "pack" | "derived" | "vector";
  quality?: string;
};

export type VectorRetrieveFn = (
  ctx: RetrieveContext,
  usedIds: Set<string>
) => Promise<KnowledgeNugget[]>;

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

/** Highest teaching value — tactics, attack, king, initiative. */
const HIGH_VALUE_THEMES = new Set([
  "king_safety",
  "opp_king_exposed",
  "user_king_exposed",
  "attack",
  "defense",
  "missed_opportunity",
  "counterplay",
  "weakness_exploitation",
  "forcing_moves",
  "tactics",
  "initiative",
  "imbalances",
]);

/** Structure — useful, but demoted when high-value motifs are live. */
const STRUCTURE_THEMES = new Set([
  "iqp",
  "hanging_pawns",
  "doubled_pawns",
  "open_c_file",
  "open_file",
  "bishop_pair",
  "passed_pawn",
  "space",
  "minority_attack",
  "pawn_chain",
  "outpost",
  "pawn_breaks",
  "centre",
]);

const GENERIC_PHASE = new Set([
  "development",
  "piece_activity",
  "prophylaxis",
  "planning",
  "coordination",
  "endgame_technique",
  "named_opening",
  "opening_plan",
]);

const OPENING_FAMILY = new Set([
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
]);

function themeWeight(t: string): number {
  if (HIGH_VALUE_THEMES.has(t)) return 10;
  if (OPENING_FAMILY.has(t)) return 5;
  if (STRUCTURE_THEMES.has(t)) return 3;
  if (GENERIC_PHASE.has(t)) return 1;
  return 2;
}

function cardScore(card: KnowledgeCard, themeSet: Set<string>): number {
  let score = 0;
  let hits = 0;
  let highHits = 0;
  for (const t of card.requireThemes) {
    if (!themeSet.has(t)) continue;
    hits += 1;
    score += themeWeight(t);
    if (HIGH_VALUE_THEMES.has(t)) highHits += 1;
  }
  if (hits === card.requireThemes.length && card.requireThemes.length > 1) {
    score += 2;
  }
  score += (card.weight || 0) * (highHits > 0 ? 2 : 1);

  const highLive = [...themeSet].some((t) => HIGH_VALUE_THEMES.has(t));
  const cardIsMostlyStructure =
    highHits === 0 &&
    card.requireThemes.every(
      (t) =>
        STRUCTURE_THEMES.has(t) ||
        GENERIC_PHASE.has(t) ||
        OPENING_FAMILY.has(t) ||
        t.startsWith("opening_")
    );
  if (highLive && cardIsMostlyStructure) {
    score = Math.floor(score * 0.2);
  }
  return score;
}

/**
 * Strict retrieval: high-value motifs (tactics/attack/king) outrank pawn structure.
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
  const highLive = [...themeSet].some((t) => HIGH_VALUE_THEMES.has(t));
  const minScore = strict ? (highLive ? 6 : 5) : 2;
  const hasSpecific = [...themeSet].some(
    (t) => HIGH_VALUE_THEMES.has(t) || STRUCTURE_THEMES.has(t) || OPENING_FAMILY.has(t)
  );

  const ranked = KNOWLEDGE_PACK.filter((card) => {
    const hit = card.requireThemes.some((t) => themeSet.has(t));
    if (!hit) return false;
    const openingSpecific = card.requireThemes.filter(
      (t) => t.startsWith("opening_") && t !== "opening_plan"
    );
    if (
      openingSpecific.length &&
      !openingSpecific.some((t) => themeSet.has(t))
    ) {
      return false;
    }
    const phases = card.phases || ["any"];
    if (!(phases.includes("any") || phases.includes(phase))) return false;
    const score = cardScore(card, themeSet);
    if (score < minScore) return false;
    if (
      strict &&
      !hasSpecific &&
      card.requireThemes.every((t) => GENERIC_PHASE.has(t))
    ) {
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

function themeOverlap(entry: DerivedCoachEntry, themes: string[]): number {
  if (!themes.length) return 0;
  const bag = new Set(
    [...entry.themes, ...entry.motifs].map((t) => t.toLowerCase())
  );
  let n = 0;
  for (const t of themes) {
    const key = t.toLowerCase();
    if (bag.has(key)) n += 2;
    else if ([...bag].some((b) => b.includes(key) || key.includes(b))) n += 1;
  }
  return n;
}

function ecoOverlap(entry: DerivedCoachEntry, eco?: string | null): number {
  if (!eco) return 0;
  const code = eco.toUpperCase();
  if (entry.ecoHints.includes(code)) return 3;
  if (entry.ecoHints.some((e) => e[0] === code[0])) return 1;
  return 0;
}

function lineOverlap(entry: DerivedCoachEntry, recentSans?: string[]): number {
  if (!recentSans?.length || !entry.frequentLines.length) return 0;
  const recent = recentSans.join(" ").toLowerCase();
  let best = 0;
  for (const line of entry.frequentLines) {
    const tokens = line.sanLine.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length < 3) continue;
    let hit = 0;
    for (let len = Math.min(6, tokens.length); len >= 3; len--) {
      const slice = tokens.slice(0, len).join(" ");
      if (recent.includes(slice)) {
        hit = len + Math.min(3, Math.log2(line.count + 1));
        break;
      }
    }
    if (hit > best) best = hit;
  }
  return best;
}

/**
 * Offline derived pack from CLI export — summaries + motifs + frequent SAN lines.
 * No PDFs, no masters DB, no live Chroma inside the app.
 */
export function retrieveDerivedCoachNuggets(
  ctx: RetrieveContext,
  usedIds: Set<string>
): KnowledgeNugget[] {
  const want = Math.max(0, Math.min(ctx.wantCount ?? 1, 2));
  if (want === 0) return [];
  const entries = DERIVED_COACH_PACK.entries || [];
  if (!entries.length) return [];

  const ranked = entries
    .map((entry) => {
      const score =
        themeOverlap(entry, ctx.themes || []) * 3 +
        ecoOverlap(entry, ctx.eco) * 4 +
        lineOverlap(entry, ctx.recentSans) * 5 +
        (entry.frequentLines.length ? 0.5 : 0);
      return { entry, score };
    })
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score);

  const out: KnowledgeNugget[] = [];
  for (const { entry } of ranked) {
    if (out.length >= want) break;
    const uid = `derived:${entry.id}`;
    if (usedIds.has(uid)) continue;
    const fp = fingerprint(entry.text);
    if (!fp || usedIds.has(`fp:${fp}`)) continue;
    usedIds.add(uid);
    usedIds.add(`fp:${fp}`);
    const lineHint = entry.frequentLines[0]?.sanLine
      ? ` Common line: ${entry.frequentLines[0].sanLine}.`
      : "";
    const text = `${entry.text}${lineHint}`.trim();
    out.push({
      cardId: uid,
      label: entry.book,
      text,
      source: "derived",
      quality: "summary",
    });
  }
  return out;
}

/**
 * Prefer CLI-derived summaries; optional remote vector; fill from theme pack.
 */
export async function mergeHybridKnowledgeNuggets(
  ctx: RetrieveContext,
  usedIds: Set<string>,
  retrieveVector?: VectorRetrieveFn | null
): Promise<KnowledgeNugget[]> {
  const want = Math.max(0, Math.min(ctx.wantCount ?? 1, 2));
  if (want === 0) return [];

  const out: KnowledgeNugget[] = [];
  const claim = (n: KnowledgeNugget) => {
    const fp = fingerprint(n.text);
    if (!fp || usedIds.has(`fp:${fp}`)) return false;
    if (usedIds.has(n.cardId)) return false;
    usedIds.add(n.cardId);
    usedIds.add(`fp:${fp}`);
    out.push(n);
    return true;
  };

  for (const n of retrieveDerivedCoachNuggets(
    { ...ctx, wantCount: want },
    usedIds
  )) {
    if (out.length >= want) break;
    claim(n);
  }

  if (retrieveVector && out.length < want) {
    try {
      const remote = await retrieveVector(
        { ...ctx, wantCount: want - out.length },
        usedIds
      );
      for (const n of remote) {
        if (out.length >= want) break;
        claim({ ...n, source: n.source || "vector" });
      }
    } catch {
      /* soft-fail */
    }
  }

  if (out.length < want) {
    const local = retrieveKnowledgeNuggets(
      { ...ctx, wantCount: want - out.length },
      usedIds
    );
    for (const n of local) {
      out.push({ ...n, source: "pack" });
    }
  }
  return out;
}

export { HIGH_VALUE_THEMES, STRUCTURE_THEMES };
