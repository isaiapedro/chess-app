/**
 * Game-scoped soft-key retrieval for coach notes.
 * Phase-aware pick + SAN/ECO similarity (no FEN in pack).
 */

import type { DerivedCoachEntry } from "./derivedCoachPack";
import { cleanBookProse } from "./derivedPolish";

export type MomentEvent = "blunder" | "mistake" | "inaccuracy" | "accuracy";

export type KeyTip = {
  keyId: string;
  keyType: string;
  label: string;
  text: string;
  games: string[];
  score: number;
};

export type CollectGameKeysArgs = {
  entries: DerivedCoachEntry[];
  eco?: string | null;
  opening?: string | null;
  themesByPhase?: Partial<
    Record<"opening" | "middlegame" | "endgame", string[]>
  >;
  globalThemes?: string[];
};

const TACTICAL_THEMES = new Set([
  "tactics",
  "attack",
  "forcing_moves",
  "sacrifice",
  "king_safety",
  "opp_king_exposed",
  "user_king_exposed",
  "missed_opportunity",
  "initiative",
]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keyTail(keyId: string): string {
  const parts = keyId.split(".");
  return parts[parts.length - 1] || keyId;
}

function entryBag(entry: DerivedCoachEntry): string[] {
  return [
    entry.keyId || "",
    entry.keyType || "",
    entry.label || "",
    ...(entry.motifs || []),
    ...(entry.themes || []),
  ]
    .filter(Boolean)
    .map(norm);
}

function entryCoreBag(entry: DerivedCoachEntry): string[] {
  return [entry.keyId || "", entry.label || "", entry.keyType || ""]
    .filter(Boolean)
    .map(norm);
}

function keyIdThemeBonus(entry: DerivedCoachEntry, themes: string[]): number {
  const kid = norm(entry.keyId || "");
  const label = norm(entry.label || "");
  const tail = norm(keyTail(entry.keyId || ""));
  let best = 0;
  for (const t of themes) {
    const key = norm(t);
    if (!key || key.length < 3) continue;
    const underscored = key.replace(/\s+/g, "_");
    if (kid === `opening.${underscored}` || kid.endsWith(`.${underscored}`)) {
      best = Math.max(best, 14);
    } else if (tail === key || tail === underscored) {
      best = Math.max(best, 12);
    } else if (label.includes(key)) {
      best = Math.max(best, 8);
    }
  }
  return best;
}

function themeHitsEntry(entry: DerivedCoachEntry, themes: string[]): number {
  if (!themes.length) return 0;
  const core = entryCoreBag(entry);
  const bag = entryBag(entry);
  let n = 0;
  for (const t of themes) {
    const key = norm(t);
    if (!key || key.length < 2) continue;
    if (core.some((b) => b === key || b.endsWith(`.${key}`) || b.includes(key))) {
      n += 3;
      continue;
    }
    if (bag.some((b) => b === key || b.endsWith(`.${key}`))) {
      n += 1;
    }
  }
  return n + keyIdThemeBonus(entry, themes);
}

function openingHitsEntry(
  entry: DerivedCoachEntry,
  opening?: string | null
): number {
  if (!opening) return 0;
  const blob = norm(opening);
  if (!blob) return 0;
  // Only core identity — avoid cross-motif pollution (english listing sicilian)
  const bag = entryCoreBag(entry).join(" ");
  let n = 0;
  for (const token of blob.split(" ")) {
    if (token.length < 4) continue;
    if (bag.includes(token)) n += 2;
  }
  return Math.min(6, n);
}

function ecoHitsEntry(
  entry: DerivedCoachEntry,
  eco?: string | null,
  opening?: string | null,
  themes?: string[]
): number {
  if (!eco) return 0;
  const code = eco.toUpperCase();
  const hints = (entry.ecoHints || []).map((e) => e.toUpperCase());
  if (!hints.length) return 0;
  const exact = hints.includes(code);
  const family = hints.some((e) => e[0] === code[0]);
  if (!exact && !family) return 0;

  // Guard against polluted ecoHints on unrelated keys
  const kid = norm(`${entry.keyId || ""} ${entry.label || ""}`);
  const blob = norm([opening || "", ...(themes || [])].join(" "));
  const keyTokens = kid.split(/[.\s]+/).filter((t) => t.length >= 4);
  const aligned =
    !blob ||
    keyTokens.some((tok) => blob.includes(tok)) ||
    (entry.themes || []).some((t) => blob.includes(norm(t)));
  if (exact) return aligned ? 5 : 1;
  return aligned ? 2 : 0;
}

/** Longest prefix SAN token overlap between recent game and a frequent line. */
function sanLineOverlap(recentSans: string[], sanLine: string): number {
  if (!recentSans.length || !sanLine) return 0;
  const recent = recentSans.map((s) => s.trim()).filter(Boolean);
  const tokens = sanLine.split(/\s+/).filter(Boolean);
  if (tokens.length < 3 || recent.length < 3) return 0;

  // Prefer suffix of recent matching prefix of catalog line
  let best = 0;
  for (let start = 0; start < recent.length; start++) {
    let hit = 0;
    while (
      hit < tokens.length &&
      start + hit < recent.length &&
      recent[start + hit].toLowerCase() === tokens[hit].toLowerCase()
    ) {
      hit += 1;
    }
    if (hit > best) best = hit;
  }
  // Also try full recent joined includes early slice of line
  const recentJoined = recent.join(" ").toLowerCase();
  for (let len = Math.min(8, tokens.length); len >= 3; len--) {
    const slice = tokens.slice(0, len).join(" ").toLowerCase();
    if (recentJoined.includes(slice) && len > best) best = len;
  }
  return best;
}

function bestSanSimilarity(
  entry: DerivedCoachEntry,
  recentSans: string[]
): number {
  let best = 0;
  for (const line of entry.frequentLines || []) {
    const hit = sanLineOverlap(recentSans, line.sanLine);
    const boosted = hit + Math.min(2, Math.log2((line.count || 1) + 1));
    if (boosted > best) best = boosted;
  }
  return best;
}

function keyFamily(entry: DerivedCoachEntry): string {
  const kid = entry.keyId || "";
  const kt = entry.keyType || entry.chapter || "";
  if (kid.startsWith("opening.") || kt === "opening") return "opening";
  if (kid.startsWith("endgame.") || kt === "endgame") return "endgame";
  if (kid.startsWith("motif.") || kt === "motif") return "motif";
  if (kid.startsWith("attack.") || kt === "attack") return "attack";
  if (kid.startsWith("positional.") || kt === "positional") return "positional";
  if (kid.startsWith("structure.") || kt === "structure") return "structure";
  if (kid.startsWith("imbalance.") || kt === "imbalance") return "imbalance";
  if (kid.startsWith("piece.") || kt === "piece") return "piece";
  if (kid.startsWith("methodology.") || kt === "methodology") return "methodology";
  return kt || "other";
}

function allowedFamilies(
  phase: "opening" | "middlegame" | "endgame",
  themes: string[],
  tactical: boolean
): Set<string> {
  if (phase === "opening") return new Set(["opening", "structure"]);
  if (phase === "endgame") return new Set(["endgame", "structure", "piece"]);
  if (tactical) {
    return new Set([
      "motif",
      "attack",
      "positional",
      "piece",
      "structure",
      "imbalance",
    ]);
  }
  return new Set(["positional", "structure", "imbalance", "piece"]);
}

function isTacticalMoment(themes: string[]): boolean {
  return themes.some((t) => TACTICAL_THEMES.has(t));
}

const CANON_KEY =
  /^(structure|opening|endgame|imbalance|positional|piece|motif|attack|methodology)\./;

/**
 * All pack keys related to this game (ECO / opening / phase themes).
 */
export function collectGameKeys(args: CollectGameKeysArgs): DerivedCoachEntry[] {
  const entries = (args.entries || []).filter((e) =>
    CANON_KEY.test(e.keyId || "")
  );
  if (!entries.length) return [];

  const themePool = [
    ...(args.globalThemes || []),
    ...(args.themesByPhase?.opening || []),
    ...(args.themesByPhase?.middlegame || []),
    ...(args.themesByPhase?.endgame || []),
  ];

  const scored = entries
    .map((entry) => {
      const score =
        themeHitsEntry(entry, themePool) +
        ecoHitsEntry(entry, args.eco, args.opening, themePool) +
        openingHitsEntry(entry, args.opening);
      return { entry, score };
    })
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score);

  // Dedupe by keyId
  const seen = new Set<string>();
  const out: DerivedCoachEntry[] = [];
  for (const { entry } of scored) {
    const id = entry.keyId || entry.id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
  }
  return out;
}

function rankEntry(args: {
  entry: DerivedCoachEntry;
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  preferredFamilies?: Set<string>;
}): number {
  const theme = themeHitsEntry(args.entry, args.themes);
  const eco = ecoHitsEntry(
    args.entry,
    args.eco,
    null,
    args.themes
  );
  const san = bestSanSimilarity(args.entry, args.recentSans);
  let score = theme * 3 + eco * 4 + san * 6;
  const fam = keyFamily(args.entry);
  if (args.preferredFamilies?.has(fam)) {
    // Boost preferred phase family (motif/attack when tactical, etc.)
    if (fam === "motif" || fam === "attack") score += 4;
    else if (fam === "opening" || fam === "endgame") score += 3;
    else score += 1;
  }
  return score;
}

/**
 * Best key tip for a blunder / mistake / accuracy moment.
 */
export function pickMomentKey(args: {
  gameKeys: DerivedCoachEntry[];
  packEntries?: DerivedCoachEntry[];
  phase: "opening" | "middlegame" | "endgame";
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  event: MomentEvent;
}): KeyTip | null {
  const pool = args.gameKeys.length
    ? args.gameKeys
    : args.packEntries || [];
  if (!pool.length) return null;

  const tactical = isTacticalMoment(args.themes);
  let families = allowedFamilies(args.phase, args.themes, tactical);

  let candidates = pool.filter((e) => families.has(keyFamily(e)));
  // Opening fallback to structure if no opening keys
  if (!candidates.length && args.phase === "opening") {
    families = new Set(["structure", "positional"]);
    candidates = pool.filter((e) => families.has(keyFamily(e)));
  }
  if (!candidates.length) {
    candidates = pool;
  }

  const ranked = candidates
    .map((entry) => ({
      entry,
      score: rankEntry({
        entry,
        themes: args.themes,
        recentSans: args.recentSans,
        eco: args.eco,
        preferredFamilies: families,
      }),
    }))
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const text = cleanBookProse(best.entry.text);
  if (!text || text.length < 40) return null;

  const games = (best.entry.games || []).filter(Boolean).slice(0, 2);
  let tip = text;
  if (games.length && best.score >= 8) {
    tip = `${text} Cf. ${games.join("; ")}.`;
  }

  // Accuracy moments: slightly prefer plan/structure wording already in prose
  void args.event;

  return {
    keyId: best.entry.keyId || best.entry.id,
    keyType: best.entry.keyType || keyFamily(best.entry),
    label: best.entry.label || best.entry.book,
    text: tip,
    games,
    score: best.score,
  };
}

export function formatKeyTipAsConcept(tip: KeyTip): string {
  return tip.text;
}
