/**
 * Pack note slots + condition matching.
 * Tip structure (worked / attention / lesson / plan) reads these fields directly.
 */

import type { DerivedCoachNote } from "./derivedCoachPack";
import { stripPackToClause } from "./openingJudgmentTip";
import { polishCoachProse, polishPackField } from "./coachProse";

export type PackNoteSlots = {
  worked?: string;
  attention?: string;
  lesson?: string;
  plan?: string;
};

export type PackNoteCondition = {
  /** Soft-key id or metric field name. */
  softKey?: string;
  metric?: string;
  situation?: string;
  theme?: string;
  opening?: string;
  /** Match peer / signal judgment. */
  polarity?: "good" | "bad" | "any";
  feature?: string;
};

export type PackPickContext = {
  phase?: string;
  softKeys?: readonly string[];
  metrics?: readonly string[];
  situations?: readonly string[];
  themes?: readonly string[];
  openings?: readonly string[];
  features?: readonly string[];
  judgment?: "good" | "bad" | null;
};

function cleanSlot(raw: string | null | undefined): string {
  const polished = polishPackField(raw || "") || polishCoachProse(raw || "");
  return polished.replace(/[.!?]+$/g, "").trim();
}

function bulletLines(text: string): string[] {
  return String(text || "")
    .split(/\n+/)
    .map((l) => cleanSlot(l.replace(/^Apply the lesson:\s*/i, "")))
    .filter((l) => l.length >= 12);
}

/** Prefer explicit slots; else synthesize from principle + directive bullets. */
export function resolveNoteSlots(
  note: DerivedCoachNote | null | undefined
): PackNoteSlots {
  if (!note) return {};
  const raw = note.slots || {};
  const principle = cleanSlot(note.principle);
  const bullets = bulletLines(note.text || "");
  const compact = cleanSlot(note.compact);

  const worked = cleanSlot(raw.worked) || principle || "";
  const attention =
    cleanSlot(raw.attention) ||
    bullets[1] ||
    bullets[0] ||
    compact ||
    "";
  const lesson =
    cleanSlot(raw.lesson) ||
    bullets[0] ||
    compact ||
    principle ||
    "";
  const plan = cleanSlot(raw.plan) || bullets[2] || "";

  return {
    worked: worked || undefined,
    attention: attention || undefined,
    lesson: lesson || undefined,
    plan: plan || undefined,
  };
}

export function slotClause(
  note: DerivedCoachNote | null | undefined,
  slot: keyof PackNoteSlots,
  opts?: { maxLen?: number }
): string | null {
  const slots = resolveNoteSlots(note);
  const raw = slots[slot];
  if (!raw) return null;
  const max = opts?.maxLen ?? 88;
  let t = raw;
  if (t.length > max) {
    const cut = t.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    t = (sp > 40 ? cut.slice(0, sp) : cut).trim();
  }
  if (t.length < 12) return null;
  if (/\d/.test(t) && !/^\d+\./.test(t)) {
    // allow mild numbers only in endgame ranks; strip digit-heavy noise
    if (/\b\d{2,}\b/.test(t)) return null;
  }
  return t;
}

function noteConditions(note: DerivedCoachNote): PackNoteCondition[] {
  if (note.conditions?.length) return note.conditions;
  const out: PackNoteCondition[] = [];
  for (const theme of note.themes || []) {
    if (theme.includes(".")) out.push({ softKey: theme, polarity: "any" });
    else out.push({ theme, polarity: "any" });
  }
  for (const f of note.features || []) {
    out.push({ feature: f, polarity: "any" });
  }
  for (const op of note.openings || []) {
    out.push({ opening: op, polarity: "any" });
  }
  return out;
}

export const WIDE_CONDITION_FLOOR = 3;

function normTok(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[- ]/g, "_");
}

function ctxHas(hay: Set<string>, needle: string | undefined): boolean {
  if (!needle) return false;
  const n = normTok(needle);
  if (hay.has(n) || hay.has(needle)) return true;
  for (const h of hay) {
    if (normTok(h) === n) return true;
  }
  return false;
}

function familyOf(c: PackNoteCondition): "plan" | "principle" | "value" | "feature" {
  if (c.situation || c.opening) return "plan";
  if (c.feature) return "feature";
  if (
    c.metric === "tempo_waste_rate_pct" ||
    c.metric === "minors_developed" ||
    c.metric === "center_control_pct" ||
    c.metric === "uncastled_rate_pct"
  ) {
    return "principle";
  }
  if (c.softKey && String(c.softKey).startsWith("opening.")) return "plan";
  if (c.metric) return "value";
  return "feature";
}

/** Higher = better match to live metrics / situations / openings / polarity. */
export function scoreNoteConditions(
  note: DerivedCoachNote,
  ctx: PackPickContext
): number {
  const conds = noteConditions(note);
  if (!conds.length) return WIDE_CONDITION_FLOOR;
  let score = 0;
  const soft = new Set((ctx.softKeys || []).map(String));
  const metrics = new Set((ctx.metrics || []).map(String));
  const sits = new Set((ctx.situations || []).map(String));
  const themes = new Set((ctx.themes || []).map(String));
  const openings = new Set(
    (ctx.openings || []).map((o) => String(o).toLowerCase())
  );
  const features = new Set((ctx.features || []).map(String));
  const wide = new Set(
    [...soft, ...metrics, ...sits, ...themes, ...openings, ...features].map(
      (t) => normTok(t)
    )
  );
  const judgment = ctx.judgment || null;
  const families = new Set<string>();

  const metricConds = conds.filter((c) => c.metric);
  let metricHits = 0;
  let metricMisses = 0;
  let coreHits = 0;

  for (const c of conds) {
    if (c.polarity && c.polarity !== "any" && judgment && c.polarity !== judgment) {
      continue;
    }
    const fam = familyOf(c);
    if (c.softKey && (soft.has(c.softKey) || ctxHas(wide, c.softKey))) {
      score += 4;
      coreHits += 1;
      families.add(c.softKey.startsWith("opening.") ? "plan" : fam);
    }
    if (c.metric) {
      if (metrics.has(c.metric) || ctxHas(wide, c.metric)) {
        score += 8;
        metricHits += 1;
        coreHits += 1;
        families.add(fam);
      } else {
        metricMisses += 1;
      }
    }
    if (c.situation && (sits.has(c.situation) || ctxHas(wide, c.situation))) {
      score += 5;
      coreHits += 1;
      families.add("plan");
    }
    if (c.theme && (themes.has(c.theme) || ctxHas(wide, c.theme))) {
      score += 1;
    }
    if (c.feature && (features.has(c.feature) || ctxHas(wide, c.feature))) {
      score += 3;
      coreHits += 1;
      families.add("feature");
    }
    if (c.opening && (openings.has(String(c.opening).toLowerCase()) || ctxHas(wide, c.opening))) {
      score += 3;
      coreHits += 1;
      families.add("plan");
    }
    if (c.polarity && judgment && c.polarity === judgment) score += 1;
  }
  if (metricConds.length && metrics.size && metricHits === 0 && coreHits < 2) {
    return 0;
  }
  if (metricMisses) score -= metricMisses * 2;
  if (families.size >= 2) score += 2 * (families.size - 1);
  return Math.max(0, score);
}

/**
 * Pick best didactic note for a key given metric/signal context.
 * Falls back to mid-specificity when conditions are empty.
 */
export function pickNoteForContext(args: {
  notes: DerivedCoachNote[];
  phase: string;
  ctx: PackPickContext;
  preferDidactic?: boolean;
}): DerivedCoachNote | null {
  let notes = args.notes.filter((n) => (n.text || "").trim());
  if (args.preferDidactic !== false) {
    notes = notes.filter((n) => !String(n.id || "").startsWith("bookwalk:"));
  }
  const phase = (args.phase || "any").toLowerCase();
  notes = notes.filter((n) => {
    const p = (n.phase || "any").toLowerCase();
    return p === "any" || p === phase || !n.phase;
  });
  if (!notes.length) return null;

  notes.sort((a, b) => {
    const sa = scoreNoteConditions(a, args.ctx);
    const sb = scoreNoteConditions(b, args.ctx);
    if (sb !== sa) return sb - sa;
    const da = Math.abs((a.specificity ?? 3) - 3);
    const db = Math.abs((b.specificity ?? 3) - 3);
    return da - db || (b.text || "").length - (a.text || "").length;
  });
  const best = notes[0] || null;
  if (!best) return null;
  if (scoreNoteConditions(best, args.ctx) < WIDE_CONDITION_FLOOR) return null;
  return best;
}

/** Clause for a soft key from pack note slots (judgment selects worked vs attention). */
export function clauseFromPackNote(
  note: DerivedCoachNote | null | undefined,
  judgment: "good" | "bad",
  used?: Set<string>
): string | null {
  if (!note) return null;
  const slot: keyof PackNoteSlots =
    judgment === "good" ? "worked" : "attention";
  let clause =
    slotClause(note, slot) ||
    slotClause(note, "lesson") ||
    stripPackToClause(note.text);
  if (!clause) return null;
  const key = clause.toLowerCase().replace(/[^a-z]+/g, "");
  if (used?.has(key)) {
    const alt =
      judgment === "good"
        ? slotClause(note, "lesson")
        : slotClause(note, "lesson") || slotClause(note, "worked");
    if (!alt) return null;
    const altKey = alt.toLowerCase().replace(/[^a-z]+/g, "");
    if (used.has(altKey)) return null;
    clause = alt;
  }
  used?.add(clause.toLowerCase().replace(/[^a-z]+/g, ""));
  return clause;
}

export function lessonFromPackNote(
  note: DerivedCoachNote | null | undefined,
  used?: Set<string>
): string | null {
  const clause =
    slotClause(note, "lesson") ||
    stripPackToClause(note?.text) ||
    null;
  if (!clause) return null;
  const key = clause.toLowerCase().replace(/[^a-z]+/g, "");
  if (used?.has(key)) return null;
  used?.add(key);
  return clause;
}

export function planFromPackNote(
  note: DerivedCoachNote | null | undefined
): string | null {
  return slotClause(note, "plan");
}
