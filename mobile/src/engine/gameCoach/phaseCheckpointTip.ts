/**
 * Rigid fixed-checkpoint tip grammar (opening / middlegame / endgame aggregates).
 * Shape: lead + core + phase-remember + optional plan.
 * MG/EG: lead = what worked so far; core = what needs attention now.
 * Mistake/blunder on the same ply takes over via classifyMoment (not this weaver).
 */

import type { DerivedCoachNote } from "./derivedCoachPack";
import type { OpeningPeerSignal } from "./openingCoachInputs";
import {
  asNudgeLead,
  rememberPhrase,
  type OpeningJudgmentTipResult,
  type OpeningTipPrior,
} from "./openingJudgmentTip";
import { clauseForSoftKey } from "./metricClauseTemplates";
import {
  clauseFromPackNote,
  lessonFromPackNote,
  planFromPackNote,
} from "./packNoteContent";
import {
  checkpointEvalOverlay,
  evalBandFromInputs,
  isDecisiveEvalBand,
  type CheckpointEvalBand,
} from "./evalSwingIndex";
import { polishCoachProse } from "./coachProse";

export type CheckpointPhase = "opening" | "middlegame" | "endgame";
export type PackNoteByKey = Record<string, DerivedCoachNote>;

function dedupeKey(clause: string): string {
  return clause.toLowerCase().replace(/[^a-z]+/g, "");
}

function cleanBit(raw: string | null | undefined): string {
  return (raw || "").replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

function finish(text: string): string {
  let t = polishCoachProse(text.replace(/\s+/g, " ").trim());
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t = `${t}.`;
  return t.slice(0, 420);
}

/**
 * Phase-specific "just remember" construction.
 * Opening keeps classic just-remember; MG/EG use forward-looking leads.
 */
export function phaseRememberPhrase(
  phase: CheckpointPhase,
  clause: string
): string {
  const n = asNudgeLead(clause);
  if (phase === "opening") return rememberPhrase(clause);

  const gerund =
    /^(fighting|getting|finishing|claiming|looking|avoiding|castling|meeting|using|gaining|contesting|preparing|countering|hitting|challenging|answering|striking|expanding|bringing|tucking|executing|pressing|opening|activating|improving|calculating|connecting|centralizing|supporting|building)\b/i.test(
      n
    );
  const imperative =
    /^(use|fight|contest|finish|castle|gain|claim|centralize|get|look|avoid|meet|prepare|counter|hit|challenge|answer|strike|expand|execute|press|open|activate|improve|calculate|connect|support|build)\b/i.test(
      n
    );

  if (phase === "middlegame") {
    if (gerund) return `going forward, keep ${n}`;
    if (imperative) return `going forward, ${n}`;
    return `going forward, focus on ${n}`;
  }

  // endgame
  if (gerund) return `from here, keep ${n}`;
  if (imperative) return `from here, ${n}`;
  return `from here, prioritise ${n}`;
}

/**
 * Rigid checkpoint assemble.
 * Opening: lead=praise, remember=nudge (core optional empty).
 * MG/EG: lead=worked so far, core=needs attention now, remember=lesson.
 * Eval band (winning/losing) shifts lead tone + plan toward convert / resist.
 */
export function assemblePhaseCheckpointTip(args: {
  phase: CheckpointPhase;
  /** What worked so far (MG/EG) or opening praise. */
  worked?: string | null;
  /** What needs attention now (MG/EG core). Opening usually omits. */
  attention?: string | null;
  /** Pack / soft-key lesson for the phase-remember slot. */
  lesson?: string | null;
  /** Optional plan / typical idea. */
  plan?: string | null;
  /** User-POV eval band at the checkpoint. */
  evalBand?: CheckpointEvalBand | null;
}): string {
  const phase = args.phase;
  const band = args.evalBand || "unknown";
  const overlay = checkpointEvalOverlay(band, phase);
  let worked = cleanBit(args.worked);
  let attention = cleanBit(args.attention);
  let lesson = cleanBit(args.lesson) || cleanBit(overlay.lessonHint);
  let plan = cleanBit(args.plan);
  if (band === "losing" || band === "worse") {
    plan = cleanBit(overlay.plan) || plan;
  } else {
    plan = plan || cleanBit(overlay.plan);
  }

  if (isDecisiveEvalBand(band) && !attention && overlay.attentionFallback) {
    attention = overlay.attentionFallback;
  }

  let lead = "";
  let core = "";

  if (phase === "opening") {
    if (overlay.leadPrefix && worked) {
      lead = `${overlay.leadPrefix} — ${worked.charAt(0).toLowerCase()}${worked.slice(1)}`;
    } else if (overlay.leadPrefix) {
      lead = overlay.leadPrefix;
    } else {
      lead = worked;
    }
    core = "";
  } else {
    if (overlay.leadPrefix && worked) {
      lead = `${overlay.leadPrefix} — ${worked.charAt(0).toLowerCase()}${worked.slice(1)}`;
    } else if (overlay.leadPrefix) {
      lead = overlay.leadPrefix;
    } else if (worked) {
      lead = `So far, ${worked.charAt(0).toLowerCase()}${worked.slice(1)}`;
    }
    if (attention) {
      core = `now ${attention.charAt(0).toLowerCase()}${attention.slice(1)}`;
    }
  }

  const headParts = [lead, core].filter(Boolean);
  let head = "";
  if (headParts.length === 1) head = headParts[0]!;
  else if (headParts.length >= 2) head = `${headParts[0]}, ${headParts[1]}`;

  const remember = lesson ? phaseRememberPhrase(phase, lesson) : "";

  let text = "";
  if (head && remember) {
    text = `${head}; ${remember}`;
  } else if (head) {
    text = head;
  } else if (remember) {
    text = remember.charAt(0).toUpperCase() + remember.slice(1);
  }

  if (plan) {
    const planLow = plan.charAt(0).toLowerCase() + plan.slice(1);
    const planLabel =
      band === "winning" || band === "losing" ? "plan" : "typical idea";
    if (text && !text.toLowerCase().includes(planLow.slice(0, 20).toLowerCase())) {
      text = `${text.replace(/[.!?]+$/, "")}; ${planLabel}: ${planLow}`;
    } else if (!text) {
      text = `${planLabel.charAt(0).toUpperCase()}${planLabel.slice(1)}: ${planLow}`;
    }
  }

  if (!text && phase === "middlegame") {
    text =
      "So far the structure is stable, now prepare the thematic break; going forward, focus on the live wing plan";
  }
  if (!text && phase === "endgame") {
    text =
      "So far you reached a technical ending, now activate the king; from here, prioritise conversion without pawn rushes";
  }
  if (!text && phase === "opening") {
    text =
      "Develop the minors, castle, and contest the centre before launching a plan";
  }

  return finish(text);
}

/** Whether a critical mark should replace the rigid checkpoint tip. */
export function checkpointMistakeTakesOver(args: {
  mark?: string | null;
  momentSeverity?: string | null;
  inputs?: Record<string, string | number | boolean | null> | null;
  kind?: string | null;
  playedSan?: string | null;
  structuralKind?: string | null;
}): boolean {
  if (isDeliveredMate(args.playedSan, args.inputs)) return false;
  if (args.structuralKind === "endgame_advantage") return false;
  if (args.kind === "bad_move" || args.kind === "praise_move") return true;
  const mark = args.mark || args.momentSeverity || "";
  if (mark === "blunder" || mark === "mistake" || mark === "missed") return true;
  if (args.inputs?.critical_mark) return true;
  return false;
}

function isDeliveredMate(
  playedSan?: string | null,
  inputs?: Record<string, string | number | boolean | null> | null
): boolean {
  if (/#/.test(String(playedSan || ""))) return true;
  if (/#/.test(String(inputs?.san || ""))) return true;
  if (inputs?.game_over === true || inputs?.game_over === 1) return true;
  if (inputs?.delivered_mate === true || inputs?.delivered_mate === 1) {
    return true;
  }
  return false;
}

function pickClauseFromSignals(
  signals: OpeningPeerSignal[],
  judgment: "good" | "bad",
  packByKey: PackNoteByKey | null | undefined,
  used: Set<string>
): { clause: string; softKey: string; metric: string; note: DerivedCoachNote | null } | null {
  const ranked = signals
    .filter((s) => s.judgment === judgment)
    .sort(
      (a, b) =>
        Math.abs(b.impact) - Math.abs(a.impact) ||
        a.metric.localeCompare(b.metric)
    );
  for (const signal of ranked) {
    for (const softKey of signal.softKeys) {
      if (!softKey || softKey.startsWith("methodology.")) continue;
      const note = packByKey?.[softKey] || null;
      const pack = clauseFromPackNote(note, judgment);
      const templ = clauseForSoftKey(softKey, judgment);
      const clause = (judgment === "bad" && pack) || templ || pack;
      if (!clause) continue;
      const key = dedupeKey(clause);
      if (used.has(key)) continue;
      used.add(key);
      return { clause, softKey, metric: signal.metric, note };
    }
  }
  return null;
}

/**
 * Shared helper: signals + pack slots → rigid MG/EG checkpoint result.
 * Slots map: worked → lead, attention → core, lesson → phase-remember, plan → plan.
 */
export function composeSignalCheckpointTip(args: {
  phase: "middlegame" | "endgame";
  signals: OpeningPeerSignal[];
  packByKey?: PackNoteByKey | null;
  priorTopics?: OpeningTipPrior | null;
  plan?: string | null;
  fallbackWorked?: string | null;
  fallbackAttention?: string | null;
  inputs?: Record<string, string | number | boolean | null> | null;
  evalBand?: CheckpointEvalBand | null;
}): OpeningJudgmentTipResult {
  const used = new Set(
    (args.priorTopics?.clauses || []).map(dedupeKey).filter(Boolean)
  );
  const band =
    args.evalBand || evalBandFromInputs(args.inputs) || "unknown";
  const overlay = checkpointEvalOverlay(band, args.phase);

  const good = pickClauseFromSignals(
    args.signals,
    "good",
    args.packByKey,
    used
  );
  const bad = pickClauseFromSignals(args.signals, "bad", args.packByKey, used);

  // Winning: lean on what worked; losing: lean on what still needs resistance.
  let worked = good?.clause || cleanBit(args.fallbackWorked) || null;
  let attention =
    bad?.clause || cleanBit(args.fallbackAttention) || null;
  if (band === "winning" && !attention && overlay.attentionFallback) {
    attention = overlay.attentionFallback;
  }
  if (band === "losing" && !attention && overlay.attentionFallback) {
    attention = overlay.attentionFallback;
  }

  let lesson: string | null = null;
  if (bad?.note) lesson = lessonFromPackNote(bad.note, used);
  if (!lesson && bad?.softKey) {
    lesson = clauseForSoftKey(bad.softKey, "bad", used);
  }
  if (!lesson && good?.note) lesson = lessonFromPackNote(good.note, used);
  if (!lesson && good?.softKey) {
    lesson = clauseForSoftKey(good.softKey, "good", used);
  }
  if (!lesson && overlay.lessonHint) lesson = overlay.lessonHint;
  if (!lesson) lesson = attention || worked;

  if (
    lesson &&
    attention &&
    dedupeKey(lesson) === dedupeKey(attention) &&
    good?.note
  ) {
    const alt = lessonFromPackNote(good.note, used);
    if (alt && dedupeKey(alt) !== dedupeKey(attention)) lesson = alt;
  }

  let plan =
    cleanBit(args.plan) ||
    planFromPackNote(bad?.note) ||
    planFromPackNote(good?.note) ||
    null;
  if (band === "losing" || band === "worse") {
    plan = cleanBit(overlay.plan) || plan;
  } else if (band === "winning" || band === "better") {
    plan = cleanBit(overlay.plan);
  }

  const text = assemblePhaseCheckpointTip({
    phase: args.phase,
    worked,
    attention,
    lesson,
    plan,
    evalBand: band,
  });

  return {
    text,
    softKeys: [...new Set([good?.softKey, bad?.softKey].filter(Boolean))] as string[],
    metrics: [...new Set([good?.metric, bad?.metric, band !== "unknown" ? `eval:${band}` : ""].filter(Boolean))] as string[],
    clauses: [
      worked && dedupeKey(worked),
      attention && dedupeKey(attention),
      lesson && dedupeKey(lesson),
      plan && dedupeKey(plan),
      band !== "unknown" ? `eval${band}` : "",
    ].filter(Boolean) as string[],
    topics: [
      `checkpoint:${args.phase}`,
      band !== "unknown" ? `eval:${band}` : "",
      worked ? "worked" : "",
      attention ? "attention" : "",
      lesson ? "lesson" : "",
      plan ? "plan" : "",
    ].filter(Boolean),
  };
}
