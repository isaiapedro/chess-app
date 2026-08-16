/**
 * Game-scoped soft-key retrieval for coach notes.
 * Phase keys first → metric / theme / opening similarity on idea notes.
 * Same note may not repeat; multiple keys per game allowed.
 */

import type { DerivedCoachEntry, DerivedCoachNote } from "./derivedCoachPack";
import { reformatCoachNote } from "./derivedPolish";
import type { CoachMark } from "./coachMarks";
import { resolveEcoFamily } from "../ecoFamilies";
import { detectOpeningFamily } from "./structureDetect";

export type MomentEvent = "blunder" | "mistake" | "inaccuracy" | "accuracy";

export type KeyTip = {
  keyId: string;
  /** Up to 3 ranked soft-key ids for this tip (primary first). */
  keyIds?: string[];
  keyType: string;
  label: string;
  text: string;
  games: string[];
  score: number;
  noteId?: string;
  principle?: string;
  phase?: string;
  compactDefinition?: string;
  noteCompact?: string;
  modelGame?: string;
};

export type PhaseName = "opening" | "middlegame" | "endgame";

/** Max notes attached per game phase (stops once reached). */
export const PHASE_NOTE_LIMITS: Record<PhaseName, number> = {
  opening: 3,
  middlegame: 7,
  endgame: 4,
};

/** @deprecated No per-key cap — non-repetition is noteId / text only. */
export const NOTES_PER_KEY = Number.POSITIVE_INFINITY;

/** @deprecated alias of NOTES_PER_KEY. */
export const OPENING_NOTES_PER_KEY = NOTES_PER_KEY;

/** Min idea similarity score to attach a note. */
export const NOTE_SCORE_THRESHOLD = 8;

export type CollectGameKeysArgs = {
  entries: DerivedCoachEntry[];
  /** Soft-key index — when set, only theme keys are fetched (no full pack scan). */
  byKey?: Map<string, DerivedCoachEntry> | null;
  eco?: string | null;
  opening?: string | null;
  themesByPhase?: Partial<Record<PhaseName, string[]>>;
  globalThemes?: string[];
};

export type PhaseGameKeys = Record<PhaseName, DerivedCoachEntry[]>;

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

const ERROR_MARKS = new Set<CoachMark>([
  "blunder",
  "mistake",
  "missed",
]);

const CANON_KEY =
  /^(structure|opening|endgame|imbalance|positional|piece|motif|attack|methodology)\./;

const PHASES: PhaseName[] = ["opening", "middlegame", "endgame"];

const WEAK_OPENING_TAGS = new Set([
  "named_opening",
  "opening_plan",
  "opening_indian",
]);

function isSpecificOpeningTag(tag: string): boolean {
  return tag.startsWith("opening_") && !WEAK_OPENING_TAGS.has(tag);
}

function specificOpeningTags(tags: string[]): string[] {
  return [...new Set(tags.filter(isSpecificOpeningTag))];
}

function gameOpeningTags(
  eco?: string | null,
  opening?: string | null,
  themes?: string[]
): string[] {
  return specificOpeningTags([
    ...detectOpeningFamily(eco, opening),
    ...(themes || []),
  ]);
}

function claimedOpeningTagsFromHints(
  ecoHints: string[] | undefined,
  openings: string[] | undefined,
  extraThemes?: string[]
): string[] {
  const tags = new Set<string>();
  for (const t of extraThemes || []) {
    if (isSpecificOpeningTag(t)) tags.add(t);
  }
  for (const h of [...(ecoHints || []), ...(openings || [])]) {
    const raw = String(h || "").trim();
    if (!raw) continue;
    const asEco = /^[A-Ea-e]\d{2}/.test(raw) ? raw : null;
    const asName = asEco ? null : raw;
    for (const t of detectOpeningFamily(asEco, asName || raw)) {
      if (isSpecificOpeningTag(t)) tags.add(t);
    }
  }
  return [...tags];
}

function entryClaimedOpeningTags(entry: DerivedCoachEntry): string[] {
  return claimedOpeningTagsFromHints(entry.ecoHints, undefined, [
    ...(entry.themes || []),
    ...detectOpeningFamily(null, entry.label || ""),
  ]);
}

/** True when pack entry claims a different named opening than this game. */
function openingFamilyConflict(
  entry: DerivedCoachEntry,
  eco?: string | null,
  opening?: string | null,
  themes?: string[]
): boolean {
  const game = gameOpeningTags(eco, opening, themes);
  if (!game.length) return false;
  const claimed = entryClaimedOpeningTags(entry);
  if (!claimed.length) return false;
  return !claimed.some((t) => game.includes(t));
}

function noteOpeningConflict(
  note: DerivedCoachNote,
  eco?: string | null,
  opening?: string | null
): boolean {
  const game = gameOpeningTags(eco, opening);
  if (!game.length) return false;
  const claimed = claimedOpeningTagsFromHints(
    note.ecoHints,
    note.openings,
    note.themes
  );
  if (!claimed.length) return false;
  return !claimed.some((t) => game.includes(t));
}


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

const OPENING_NAME_STOP = new Set([
  "defense",
  "defence",
  "attack",
  "game",
  "opening",
  "system",
  "accepted",
  "declined",
  "variation",
  "with",
  "from",
]);

function openingHitsEntry(
  entry: DerivedCoachEntry,
  opening?: string | null
): number {
  if (!opening) return 0;
  const blob = norm(opening);
  if (!blob) return 0;
  const bag = entryCoreBag(entry).join(" ");
  let n = 0;
  for (const token of blob.split(" ")) {
    if (token.length < 4 || OPENING_NAME_STOP.has(token)) continue;
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
  const gameFam = resolveEcoFamily(code, opening || null);
  const family = hints.some((h) => {
    const fam = resolveEcoFamily(h, null);
    return Boolean(fam && gameFam && fam.key === gameFam.key);
  });
  if (!exact && !family) return 0;

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

function sanLineOverlap(recentSans: string[], sanLine: string): number {
  if (!recentSans.length || !sanLine) return 0;
  const recent = recentSans.map((s) => s.trim()).filter(Boolean);
  const tokens = sanLine.split(/\s+/).filter(Boolean);
  if (tokens.length < 3 || recent.length < 3) return 0;

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

/** Theme/motif bag overlap as position-family similarity (pack has no FEN). */
function positionThemeSimilarity(
  entry: DerivedCoachEntry,
  themes: string[]
): number {
  if (!themes.length) return 0;
  const bag = new Set(entryBag(entry));
  let hits = 0;
  for (const t of themes) {
    const key = norm(t);
    if (!key) continue;
    if ([...bag].some((b) => b === key || b.includes(key) || key.includes(b))) {
      hits += 1;
    }
  }
  return hits;
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


/** Opening pool: prefer opening.* keys; ECO key boosted via sort order only. */
export function openingKeyPool(
  pool: DerivedCoachEntry[],
  preferredKeyId?: string | null
): DerivedCoachEntry[] {
  if (!pool.length) return [];
  const openingOnly = pool.filter((e) => keyFamily(e) === "opening");
  const base = openingOnly.length ? openingOnly : pool;
  if (!preferredKeyId) return base;
  const hit = base.find((e) => (e.keyId || e.id) === preferredKeyId);
  if (!hit) return base;
  return [hit, ...base.filter((e) => (e.keyId || e.id) !== preferredKeyId)];
}


function isTacticalMoment(themes: string[]): boolean {
  return themes.some((t) => TACTICAL_THEMES.has(t));
}

function isTacticalKey(entry: DerivedCoachEntry): boolean {
  const fam = keyFamily(entry);
  return fam === "motif" || fam === "attack";
}

function canonEntries(entries: DerivedCoachEntry[]): DerivedCoachEntry[] {
  return (entries || []).filter((e) => CANON_KEY.test(e.keyId || ""));
}

function scorePhaseEntry(
  entry: DerivedCoachEntry,
  phase: PhaseName,
  themes: string[],
  eco?: string | null,
  opening?: string | null
): number {
  if (openingFamilyConflict(entry, eco, opening, themes)) return 0;
  let score =
    themeHitsEntry(entry, themes) +
    ecoHitsEntry(entry, eco, opening, themes) +
    openingHitsEntry(entry, opening);
  if (phase === "opening" && keyFamily(entry) === "opening") score += 2;
  if (phase === "endgame" && keyFamily(entry) === "endgame") score += 2;
  return score;
}

function rankSimilarity(args: {
  entry: DerivedCoachEntry;
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  phase: PhaseName;
  tacticalBoost?: boolean;
  windowSans?: string[];
}): number {
  void args.recentSans;
  void args.windowSans;
  const theme = themeHitsEntry(args.entry, args.themes);
  const eco = ecoHitsEntry(args.entry, args.eco, null, args.themes);
  const pos = positionThemeSimilarity(args.entry, args.themes);
  let score = theme * 3 + eco * 4 + pos * 4;
  if (args.tacticalBoost && isTacticalKey(args.entry)) {
    score *= 2;
  }
  if (
    args.phase === "middlegame" &&
    isTacticalMoment(args.themes) &&
    isTacticalKey(args.entry)
  ) {
    score *= 2;
  }
  return score;
}

function extractSansFromText(text: string): string[] {
  const out: string[] = [];
  const re =
    /\b(?:O-O-O|O-O|0-0-0|0-0|[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?)\b/g;
  for (const m of text.match(re) || []) {
    out.push(m.replace(/[+#]+$/g, ""));
  }
  return out;
}

function windowSanHitsOnText(text: string, windowSans: string[]): number {
  if (!windowSans.length || !text) return 0;
  const noteSans = extractSansFromText(text).map((s) => s.toLowerCase());
  if (!noteSans.length) return 0;
  const window = windowSans.map((s) =>
    s.toLowerCase().replace(/[+#]+$/g, "")
  );
  let hits = 0;
  for (let i = 0; i < window.length; i++) {
    const w = window[i];
    if (!w) continue;
    if (noteSans.includes(w)) hits += i === 0 ? 3 : 2;
  }
  for (let i = 0; i < window.length - 1; i++) {
    const a = window[i];
    const b = window[i + 1];
    if (!a || !b) continue;
    for (let j = 0; j < noteSans.length - 1; j++) {
      if (noteSans[j] === a && noteSans[j + 1] === b) {
        hits += 4;
        break;
      }
    }
  }
  return hits;
}

export type PositionTransform = {
  capture: boolean;
  check: boolean;
  castle: boolean;
  promote: boolean;
  pieceDelta: number;
};

export function detectPositionTransform(
  fenBefore: string,
  fenAfter: string,
  playedSan: string
): PositionTransform {
  const san = playedSan || "";
  let pieceDelta = 0;
  try {
    const before = fenBefore.split(" ")[0].replace(/\d/g, "").length;
    const after = fenAfter.split(" ")[0].replace(/\d/g, "").length;
    pieceDelta = before - after;
  } catch {
    pieceDelta = 0;
  }
  return {
    capture: san.includes("x") || pieceDelta > 0,
    check: /[+#]$/.test(san),
    castle: /^O-O|^0-0/i.test(san),
    promote: san.includes("="),
    pieceDelta,
  };
}

function noteTransformHits(
  noteText: string,
  transform: PositionTransform | null | undefined
): number {
  if (!transform || !noteText) return 0;
  const t = noteText.toLowerCase();
  let n = 0;
  if (transform.capture && /\b(captur|tak(e|es|ing)|exchange|trade|x[a-h])\b/.test(t)) {
    n += 3;
  }
  if (transform.check && /\b(check|checkmate|mate|forcing|king)\b/.test(t)) {
    n += 3;
  }
  if (transform.castle && /\b(castl|king.?safety|connect the rooks)\b/.test(t)) {
    n += 3;
  }
  if (transform.promote && /\b(promot|queen(ing)?)\b/.test(t)) {
    n += 3;
  }
  if (transform.pieceDelta >= 2 && /\b(material|sacrifice|exchange)\b/.test(t)) {
    n += 2;
  }
  return n;
}

function noteThemeHits(note: DerivedCoachNote, themes: string[]): number {
  if (!themes.length) return 0;
  const bag = [
    ...(note.themes || []),
    ...(note.patterns || []),
    note.principle || "",
  ].map(norm);
  let n = 0;
  for (const t of themes) {
    const key = norm(t);
    if (!key || key.length < 2) continue;
    if (bag.some((b) => b === key || b.includes(key) || key.includes(b))) {
      n += 2;
    }
  }
  return n;
}

function noteEcoHits(
  note: DerivedCoachNote,
  eco?: string | null,
  opening?: string | null
): number {
  if (!eco) return 0;
  const code = eco.toUpperCase();
  const hints = [
    ...(note.ecoHints || []),
    ...(note.openings || []),
  ].map((e) => e.toUpperCase());
  if (hints.includes(code)) return 5;
  const gameFam = resolveEcoFamily(code, opening || null);
  if (
    gameFam &&
    hints.some((h) => {
      const fam = resolveEcoFamily(h, null);
      return Boolean(fam && fam.key === gameFam.key);
    })
  ) {
    return 2;
  }
  return 0;
}

function noteOpeningHits(
  note: DerivedCoachNote,
  opening?: string | null
): number {
  if (!opening) return 0;
  if (noteOpeningConflict(note, null, opening)) return 0;
  const o = norm(opening);
  if (o.length < 4) return 0;
  const bag = [...(note.openings || []), ...(note.ecoHints || [])].map(norm);
  const tokens = o
    .split(" ")
    .filter((t) => t.length >= 4 && !OPENING_NAME_STOP.has(t));
  if (
    bag.some(
      (b) =>
        b === o ||
        (b.length >= 5 && (b.includes(o) || o.includes(b))) ||
        tokens.some((t) => b === t || b.includes(t))
    )
  ) {
    return 4;
  }
  return 0;
}

/** Piece-placement overlap between two FENs (ignore clocks / ep). */
export function fenPlacementSimilarity(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const pa = a.split(" ")[0] || "";
  const pb = b.split(" ")[0] || "";
  if (!pa || !pb) return 0;
  if (pa === pb) return 12;
  // Expand ranks to 64 chars for Hamming-ish overlap
  const expand = (fen: string): string =>
    fen
      .replace(/\d/g, (d) => ".".repeat(Number(d)))
      .replace(/\//g, "");
  const ea = expand(pa);
  const eb = expand(pb);
  if (ea.length !== 64 || eb.length !== 64) return 0;
  let same = 0;
  let pieces = 0;
  for (let i = 0; i < 64; i++) {
    if (ea[i] !== ".") pieces++;
    if (ea[i] === eb[i] && ea[i] !== ".") same++;
  }
  if (!pieces) return 0;
  const ratio = same / pieces;
  if (ratio >= 0.92) return 10;
  if (ratio >= 0.8) return 7;
  if (ratio >= 0.65) return 4;
  if (ratio >= 0.5) return 2;
  return 0;
}

function noteFenHits(
  note: DerivedCoachNote,
  fenBefore?: string,
  fenAfter?: string
): number {
  const fens = note.fens || [];
  if (!fens.length) return 0;
  let best = 0;
  for (const f of fens) {
    best = Math.max(
      best,
      fenPlacementSimilarity(fenBefore, f),
      fenPlacementSimilarity(fenAfter, f)
    );
  }
  return best;
}

function noteSanLineHits(note: DerivedCoachNote, windowSans: string[]): number {
  if (!windowSans.length) return 0;
  const window = windowSans.map((s) =>
    s.toLowerCase().replace(/[+#]+$/g, "")
  );
  let best = windowSanHitsOnText(note.text, windowSans);
  for (const line of note.sanLines || []) {
    const toks = line
      .split(/\s+/)
      .map((s) => s.toLowerCase().replace(/[+#]+$/g, ""))
      .filter(Boolean);
    if (!toks.length) continue;
    let hits = 0;
    for (let i = 0; i < window.length; i++) {
      if (toks.includes(window[i]!)) hits += i === 0 ? 3 : 2;
    }
    for (let i = 0; i < Math.min(window.length, toks.length) - 1; i++) {
      if (window[i] === toks[i] && window[i + 1] === toks[i + 1]) hits += 5;
    }
    // prefix match on first 3 plies
    let prefix = 0;
    for (let i = 0; i < Math.min(3, window.length, toks.length); i++) {
      if (window[i] === toks[i]) prefix++;
      else break;
    }
    if (prefix >= 3) hits += 6;
    else if (prefix === 2) hits += 3;
    best = Math.max(best, hits);
  }
  return best;
}

/** Prefer notes whose sanLines / FEN match this ply. */
function isBookwalkNote(note: DerivedCoachNote): boolean {
  const id = note.id || "";
  const feats = note.features || [];
  return (
    id.startsWith("bookwalk:") ||
    feats.includes("bookwalk-passage") ||
    feats.includes("fen-bookwalk") ||
    (note.patterns || []).includes("bookwalk")
  );
}

function isSeedFenNote(note: DerivedCoachNote): boolean {
  if (isBookwalkNote(note)) return false;
  const feats = note.features || [];
  return feats.includes("fen-seed") || feats.includes("fen-enriched");
}

function noteMoveStickOk(
  note: DerivedCoachNote,
  playedSan?: string,
  fenBefore?: string,
  phase?: PhaseName
): boolean {
  if (!playedSan) return true;
  const fenHit = noteFenHits(note, fenBefore, undefined);
  const played = playedSan.toLowerCase().replace(/[+#]+$/g, "");
  const lineSans: string[] = [];
  for (const line of note.sanLines || []) {
    for (const tok of line.split(/\s+/)) {
      const s = tok.toLowerCase().replace(/[+#]+$/g, "");
      if (s) lineSans.push(s);
    }
  }
  const sanHit = lineSans.length > 0 && lineSans.includes(played);

  // Seed/teaching FENs only stick on near-exact FEN or explicit SAN.
  if (isSeedFenNote(note)) {
    return fenHit >= 10 || sanHit;
  }

  // Middlegame/endgame: require strong FEN or SAN-in-sanLines (no thematic drift).
  if (phase === "middlegame" || phase === "endgame") {
    if (fenHit >= 7) return true;
    if (sanHit) return true;
    return false;
  }

  // Opening: allow strong FEN, SAN lines, or text SAN agreement.
  if (fenHit >= 7) return true;
  if (lineSans.length) return sanHit;
  const textSans = extractSansFromText(note.text || "").map((s) =>
    s.toLowerCase().replace(/[+#]+$/g, "")
  );
  if (textSans.length >= 2 && !textSans.includes(played)) {
    return false;
  }
  return true;
}

function notePhaseOk(note: DerivedCoachNote, phase: PhaseName): boolean {
  const p = (note.phase || "any").toLowerCase();
  return p === "any" || p === phase || !note.phase;
}

function noteFeatureHits(note: DerivedCoachNote, themes: string[]): number {
  const bag = [...(note.features || []), ...(note.themes || [])].map(norm);
  if (!bag.length || !themes.length) return 0;
  let n = 0;
  for (const t of themes) {
    const key = norm(t);
    if (!key || key.length < 2) continue;
    if (bag.some((b) => b === key || b.includes(key) || key.includes(b))) {
      n += 2;
    }
  }
  return n;
}

/**
 * Best idea-note inside a key for this metric moment.
 * Theme / features / specificity only — no FEN or SAN stick.
 */
export function pickBestNoteInKey(args: {
  entry: DerivedCoachEntry;
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  opening?: string | null;
  fenBefore?: string;
  fenAfter?: string;
  playedSan?: string;
  windowSans?: string[];
  phase?: PhaseName;
  minScore?: number;
  excludeNoteIds?: Set<string>;
}): { text: string; noteId: string; book: string; score: number; principle?: string; phase?: string; specificity?: number } | null {
  void args.recentSans;
  void args.fenBefore;
  void args.fenAfter;
  void args.playedSan;
  void args.windowSans;
  const phase = args.phase || "middlegame";
  const minScore = args.minScore ?? Math.min(NOTE_SCORE_THRESHOLD, 4);

  if (openingFamilyConflict(args.entry, args.eco, args.opening, args.themes)) {
    return null;
  }
  const excludeNotes = args.excludeNoteIds || new Set<string>();
  const notes = (args.entry.notes || []).filter((n) => {
    if (!(n.text || "").trim()) return false;
    if (n.id && excludeNotes.has(n.id)) return false;
    if (!notePhaseOk(n, phase)) return false;
    if (noteOpeningConflict(n, args.eco, args.opening)) return false;
    return true;
  });
  if (notes.length) {
    const ranked = notes
      .map((note) => {
        const eco = noteEcoHits(note, args.eco, args.opening);
        const opening = noteOpeningHits(note, args.opening);
        const theme = noteThemeHits(note, args.themes);
        const features = noteFeatureHits(note, args.themes);
        const bookwalkBoost = isBookwalkNote(note) ? 4 : 0;
        const seedPenalty = isSeedFenNote(note) ? -2 : 0;
        const match =
          eco * 2 +
          opening * 2 +
          theme * 3 +
          features * 3 +
          bookwalkBoost +
          seedPenalty;
        const specificity = Math.max(1, Math.min(5, note.specificity ?? 3));
        const score =
          match + (match >= 2 ? specificity * 2 : Math.max(0, specificity - 2));
        return { note, score, specificity };
      })
      .filter((r) => r.score >= minScore)
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.specificity ?? 0) - (a.specificity ?? 0) ||
          b.note.text.length - a.note.text.length
      );
    const pick = ranked[0];
    if (!pick) return null;
    const text = reformatCoachNote(pick.note.text, 420);
    if (!text || text.length < 40) return null;
    return {
      text,
      noteId: pick.note.id || "",
      book: pick.note.book || "",
      score: pick.score,
      principle: pick.note.principle,
      phase: pick.note.phase,
      specificity: pick.specificity,
    };
  }

  return null;
}

export type TipPickContext = {
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  opening?: string | null;
  fenBefore?: string;
  fenAfter?: string;
  playedSan?: string;
  windowSans?: string[];
  phase?: PhaseName;
  minScore?: number;
  excludeNoteIds?: Set<string>;
};

function tipFromEntry(
  entry: DerivedCoachEntry,
  score: number,
  ctx: TipPickContext
): KeyTip | null {
  const picked = pickBestNoteInKey({
    entry,
    themes: ctx.themes,
    recentSans: ctx.recentSans,
    eco: ctx.eco,
    opening: ctx.opening,
    fenBefore: ctx.fenBefore,
    fenAfter: ctx.fenAfter,
    playedSan: ctx.playedSan,
    windowSans: ctx.windowSans,
    phase: ctx.phase,
    minScore: ctx.minScore,
    excludeNoteIds: ctx.excludeNoteIds,
  });
  if (!picked) return null;
  const note =
    (entry.notes || []).find((n) => n.id === picked.noteId) ||
    (entry.notes || [])[0];
  const modelGame =
    entry.modelGame ||
    (entry.games || []).find((g) => /^Model game:/i.test(g)) ||
    "";
  return {
    keyId: entry.keyId || entry.id,
    keyType: entry.keyType || keyFamily(entry),
    label: entry.label || entry.book,
    text: picked.text,
    games: (entry.games || []).filter(Boolean).slice(0, 2),
    score: score + picked.score,
    noteId: picked.noteId,
    principle: picked.principle,
    phase: picked.phase || note?.phase,
    compactDefinition: entry.compactDefinition || "",
    noteCompact: note?.compact || note?.principle || "",
    modelGame,
  };
}

function dedupeEntries(scored: Array<{ entry: DerivedCoachEntry; score: number }>): DerivedCoachEntry[] {
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

/**
 * Phase-split keyHits: opening / middlegame / endgame buckets independently.
 * Prefer exact soft-key Map lookup from themes — do not score every pack entry.
 */
export function collectGameKeysByPhase(args: CollectGameKeysArgs): PhaseGameKeys {
  const empty: PhaseGameKeys = { opening: [], middlegame: [], endgame: [] };
  const byKey = args.byKey;
  const allEntries = byKey?.size ? null : canonEntries(args.entries);
  if (!byKey?.size && !allEntries?.length) return empty;

  const out: PhaseGameKeys = { opening: [], middlegame: [], endgame: [] };
  for (const phase of PHASES) {
    const themes = [
      ...(args.themesByPhase?.[phase] || []),
      ...(args.globalThemes || []),
    ];
    let candidates: DerivedCoachEntry[];
    if (byKey?.size) {
      const seen = new Set<string>();
      candidates = [];
      for (const theme of themes) {
        const soft = String(theme || "").trim();
        if (!soft) continue;
        const hit = byKey.get(soft);
        if (!hit) continue;
        const id = hit.keyId || hit.id;
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push(hit);
      }
    } else {
      candidates = allEntries || [];
    }

    const scored = candidates
      .map((entry) => ({
        entry,
        score: scorePhaseEntry(entry, phase, themes, args.eco, args.opening),
      }))
      .filter((r) => {
        if (openingFamilyConflict(r.entry, args.eco, args.opening, themes)) {
          return false;
        }
        if (byKey?.size) return true;
        return r.score >= 2;
      })
      .sort((a, b) => b.score - a.score);
    out[phase] = dedupeEntries(scored);
  }
  return out;
}

/** Flat union (compat / finale index). Prefer phase buckets for picks. */
export function collectGameKeys(args: CollectGameKeysArgs): DerivedCoachEntry[] {
  const byPhase = collectGameKeysByPhase(args);
  return dedupeEntries(
    PHASES.flatMap((phase) =>
      byPhase[phase].map((entry) => ({ entry, score: 1 }))
    )
  );
}

function pickFromPool(args: {
  pool: DerivedCoachEntry[];
  phase: PhaseName;
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  opening?: string | null;
  tacticalBoost?: boolean;
  event?: MomentEvent;
  fenBefore?: string;
  fenAfter?: string;
  playedSan?: string;
  windowSans?: string[];
  excludeKeyIds?: Set<string>;
  excludeNoteIds?: Set<string>;
  minScore?: number;
}): KeyTip | null {
  if (!args.pool.length) return null;
  const exclude = args.excludeKeyIds || new Set<string>();
  const ctx: TipPickContext = {
    themes: args.themes,
    recentSans: args.recentSans,
    eco: args.eco,
    opening: args.opening,
    fenBefore: args.fenBefore,
    fenAfter: args.fenAfter,
    playedSan: args.playedSan,
    windowSans: args.windowSans,
    phase: args.phase,
    minScore: args.minScore ?? NOTE_SCORE_THRESHOLD,
    excludeNoteIds: args.excludeNoteIds,
  };
  const ranked = args.pool
    .filter((entry) => !exclude.has(entry.keyId || entry.id))
    .filter(
      (entry) =>
        !openingFamilyConflict(entry, args.eco, args.opening, args.themes)
    )
    .map((entry) => {
      const eventBoost =
        args.event &&
        args.event !== "accuracy" &&
        (isTacticalKey(entry) || keyFamily(entry) === "methodology")
          ? 1.35
          : 1;
      return {
        entry,
        score:
          rankSimilarity({
            entry,
            themes: args.themes,
            recentSans: args.recentSans,
            eco: args.eco,
            phase: args.phase,
            tacticalBoost:
              args.tacticalBoost ||
              args.event === "blunder" ||
              args.event === "mistake",
            windowSans: args.windowSans,
          }) * eventBoost,
      };
    })
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score);

  for (const candidate of ranked) {
    const tip = tipFromEntry(candidate.entry, candidate.score, ctx);
    if (tip) return tip;
  }
  return null;
}

/**
 * Stage pick: candidates from phase keys; note scored vs themes/ECO (no FEN/SAN).
 * Middlegame: tactical keys ×2 when tactical themes live. No family gate.
 * Non-repetition via excludeNoteIds (not one-key-per-game).
 */
export function pickMomentKey(args: {
  gameKeys: DerivedCoachEntry[];
  phaseKeys?: PhaseGameKeys;
  packEntries?: DerivedCoachEntry[];
  phase: PhaseName;
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  opening?: string | null;
  event: MomentEvent;
  fenBefore?: string;
  fenAfter?: string;
  playedSan?: string;
  windowSans?: string[];
  excludeKeyIds?: Set<string>;
  excludeNoteIds?: Set<string>;
  poolOverride?: DerivedCoachEntry[];
  minScore?: number;
}): KeyTip | null {
  void args.packEntries;
  const pool =
    args.poolOverride ||
    (args.phaseKeys?.[args.phase]?.length
      ? args.phaseKeys[args.phase]
      : args.gameKeys);
  return pickFromPool({
    pool,
    phase: args.phase,
    themes: args.themes,
    recentSans: args.recentSans,
    eco: args.eco,
    opening: args.opening,
    event: args.event,
    tacticalBoost:
      args.event === "blunder" ||
      args.event === "mistake" ||
      args.event === "inaccuracy",
    fenBefore: args.fenBefore,
    fenAfter: args.fenAfter,
    playedSan: args.playedSan,
    windowSans: args.windowSans,
    excludeKeyIds: args.excludeKeyIds,
    excludeNoteIds: args.excludeNoteIds,
    minScore: args.minScore,
  });
}

/**
 * Priority pick for blunder / mistake / inaccuracy / missed.
 * Prefers motif/attack keys with tactical boost.
 */
export function pickErrorKey(args: {
  mark: CoachMark | null;
  gameKeys: DerivedCoachEntry[];
  phaseKeys?: PhaseGameKeys;
  phase: PhaseName;
  themes: string[];
  recentSans: string[];
  eco?: string | null;
  opening?: string | null;
  fenBefore?: string;
  fenAfter?: string;
  playedSan?: string;
  windowSans?: string[];
  excludeKeyIds?: Set<string>;
  excludeNoteIds?: Set<string>;
  poolOverride?: DerivedCoachEntry[];
  minScore?: number;
}): KeyTip | null {
  if (!args.mark || !ERROR_MARKS.has(args.mark)) return null;
  const pool =
    args.poolOverride ||
    (args.phaseKeys?.[args.phase]?.length
      ? args.phaseKeys[args.phase]
      : args.gameKeys);
  return pickFromPool({
    pool,
    phase: args.phase,
    themes: args.themes,
    recentSans: args.recentSans,
    eco: args.eco,
    opening: args.opening,
    tacticalBoost: true,
    fenBefore: args.fenBefore,
    fenAfter: args.fenAfter,
    playedSan: args.playedSan,
    windowSans: args.windowSans,
    excludeKeyIds: args.excludeKeyIds,
    excludeNoteIds: args.excludeNoteIds,
    minScore: args.minScore,
  });
}

export function isErrorMark(mark: CoachMark | null): boolean {
  return Boolean(mark && ERROR_MARKS.has(mark));
}

export function formatKeyTipAsConcept(tip: KeyTip): string {
  return tip.text;
}

/**
 * Indexed closing: pick tip sentences that cover opening × tactic × structure combo.
 * No canned templates — only text already selected from the pack.
 */
export function indexComboResponse(args: {
  selectedTips: KeyTip[];
  openingLabel?: string;
  themes?: string[];
}): string {
  const tips = args.selectedTips || [];
  if (!tips.length) return "";

  const byType = (want: string[]) =>
    tips.filter((t) => want.includes(t.keyType));

  const openingTips = byType(["opening"]);
  const tacticTips = byType(["motif", "attack"]);
  const structureTips = byType(["structure", "positional", "imbalance", "piece"]);
  const endgameTips = byType(["endgame"]);

  const picked: KeyTip[] = [];
  const take = (list: KeyTip[], n: number) => {
    for (const t of list) {
      if (picked.length >= n) break;
      if (picked.some((p) => p.keyId === t.keyId)) continue;
      picked.push(t);
    }
  };

  if (openingTips.length && tacticTips.length) {
    take(openingTips, 1);
    take(tacticTips, 1);
  } else if (openingTips.length && structureTips.length) {
    take(openingTips, 1);
    take(structureTips, 1);
  } else if (tacticTips.length && structureTips.length) {
    take(structureTips, 1);
    take(tacticTips, 1);
  } else if (endgameTips.length && tacticTips.length) {
    take(endgameTips, 1);
    take(tacticTips, 1);
  } else {
    take(
      [...tips].sort((a, b) => b.score - a.score),
      2
    );
  }

  return picked
    .map((t) => {
      const first = reformatCoachNote(t.text, 220);
      if (!first) return "";
      return t.label ? `${t.label}: ${first}` : first;
    })
    .filter(Boolean)
    .join(" ");
}
