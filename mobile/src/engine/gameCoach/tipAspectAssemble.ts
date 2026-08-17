/**
 * Flexible tip container: good / bad / neutral aspects assembled by tone.
 * Tone from mark criticalness — not a hardcoded praise+nudge sentence shape.
 * First phrase = dynamic verdict asserting correct / incorrect / still-open plan.
 * Critique separates played miss from correct-answer framing (engine ≠ what happened).
 */

import type { CoachMark } from "./coachMarks";
import { rememberPhrase } from "./openingJudgmentTip";
import { bookJoin, polishCoachProse } from "./coachProse";

export type TipTone = "praise" | "critique" | "neutral";

export type AspectPolarity = "good" | "bad" | "neutral";

/** How the fragment relates to the played move vs the correct answer. */
export type AspectVoice =
  | "verdict"
  | "played"
  | "correct"
  | "lesson"
  | "context";

/** One topical fragment that can enter the tip. */
export type TipAspect = {
  polarity: AspectPolarity;
  /** Topic id for diversity / debugging (situation, tactic, idea, continuation, plan, lesson, asset, context). */
  topic: string;
  text: string;
  softKeys?: string[];
  /** Higher wins within the same polarity bucket. */
  priority?: number;
  voice?: AspectVoice;
};

export type AspectAssembleResult = {
  text: string;
  tone: TipTone;
  topics: string[];
  clauses: string[];
  softKeys: string[];
};

function dedupeKey(clause: string): string {
  return clause.toLowerCase().replace(/[^a-z]+/g, "");
}

function cleanAspectText(raw: string): string {
  return (raw || "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
}

function finishSentence(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t = `${t}.`;
  return t.slice(0, 420);
}

function followUpAlreadyTold(bits: string[], correctBit: string): boolean {
  const hay = bits.join(" ").toLowerCase();
  const stripped = correctBit
    .replace(/^Better is\s+(?:to\s+)?/i, "")
    .replace(/^the correct (?:move|idea) is\s+(?:to\s+)?/i, "")
    .trim();
  if (stripped && hay.includes(stripped.slice(0, 28).toLowerCase())) return true;
  const m = correctBit.match(/^Better is\s+(\S+)/i);
  if (!m) return false;
  const san = m[1].replace(/[+#]+$/g, "").toLowerCase();
  return hay
    .split(/\s+/)
    .some((tok) => tok.replace(/[+#.,!?]+$/g, "").toLowerCase() === san);
}

function joinBits(parts: string[], sep = ", "): string {
  const clean = parts.map(cleanAspectText).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0]!;
  return clean.join(sep);
}

function hashVariety(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return h;
}

const VERDICT_POOLS: Record<TipTone, string[]> = {
  praise: [
    "That was the right idea",
    "You read this well",
    "That matches what the position wants",
    "Clean choice here",
    "That solves what the position asks",
  ],
  critique: [
    "Not the right idea here",
    "A better move was available",
    "This lets the real plan slip",
    "The position wanted something else",
    "That misses what the structure asks",
  ],
  neutral: [
    "The structure still wants a plan",
    "Look at what this position asks",
    "The plan is not settled yet",
    "Find the move that fits the structure",
    "The next idea still needs a clear point",
  ],
};

/**
 * Dynamic first phrase: asserts correct / incorrect / still-open plan.
 * Variety rotates by soft-key / metric / move salt — not a fixed stock lead.
 */
export function toneVerdictLead(args: {
  tone: TipTone;
  mark?: CoachMark | null;
  kind?: string | null;
  varietyKey?: string | null;
}): string {
  const tone = args.tone;
  const mark = args.mark || null;
  const kind = String(args.kind || "");

  if (tone === "praise") {
    if (mark === "brilliant") return "Brilliant idea";
    if (mark === "excellent") return "Clean solution";
    if (kind === "praise_move") {
      const pool = VERDICT_POOLS.praise;
      const i = hashVariety(String(args.varietyKey || "praise")) % pool.length;
      return pool[i]!;
    }
  }
  if (
    tone === "neutral" &&
    /thematic/i.test(String(args.varietyKey || ""))
  ) {
    return "The break fits the structure";
  }
  if (tone === "critique") {
    if (mark === "blunder") return "Blunder";
    if (mark === "missed") {
      const pool = [
        "Missed chance",
        "A better continuation was there",
        "The punish was available",
      ];
      const i = hashVariety(String(args.varietyKey || "missed")) % pool.length;
      return pool[i]!;
    }
    if (mark === "mistake") {
      const pool = [
        "Mistake",
        "Not the right idea here",
        "A better move was available",
      ];
      const i = hashVariety(String(args.varietyKey || "mistake")) % pool.length;
      return pool[i]!;
    }
  }

  const pool = VERDICT_POOLS[tone];
  const i = hashVariety(String(args.varietyKey || tone)) % pool.length;
  return pool[i]!;
}

/**
 * Frame engine / pack / plan content as the correct answer — never as what was played.
 */
export function frameAsCorrectIdea(raw: string): string {
  let t = cleanAspectText(raw)
    .replace(/^prefer\s+/i, "")
    .replace(/^better was\s+/i, "")
    .replace(/^look at\s+/i, "")
    .replace(/^the correct (?:move|idea) is\s+(?:to\s+)?/i, "")
    .replace(/^start with\s+/i, "")
    .replace(/^the finish runs\s+/i, "")
    .replace(/^the idea continues\s+/i, "");
  if (!t) return "";
  if (/^Better is\b/i.test(t)) return t;
  if (/^the correct (?:move|idea)\b/i.test(t)) {
    return t.replace(/^the correct (?:move|idea) is\s+/i, "Better is ");
  }

  const sanLike =
    /^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[O0]-[O0](?:-[O0])?[+#]?)(?:\s+(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[O0]-[O0](?:-[O0])?[+#]?)){0,4}$/i.test(
      t
    );
  if (sanLike) return `Better is ${t}`;

  const sanStart =
    /^(?:[KQRBN]|[a-h][1-8]|[O0]-)/.test(t) || /\sinstead of\s/.test(t);
  if (sanStart && /(?:[KQRBN]?[a-h]|[O0]-)/.test(t)) {
    return `Better is ${t}`;
  }

  const low = t.charAt(0).toLowerCase() + t.slice(1);
  if (
    /^(to\s+|open|attack|connect|castle|push|bring|remove|claim|fight|meet|keep|use|centraliz|improv|activat|simplif|hit|contest|prepare|counter|expand|press|finish|calculate|support|build)/i.test(
      low
    )
  ) {
    if (/^to\s+/i.test(low)) return `Better is ${low}`;
    return `Better is to ${low}`;
  }
  return `Better is ${low}`;
}

/** Frame a played-side miss in past / diagnosis voice. */
export function frameAsPlayedMiss(raw: string): string {
  const t = cleanAspectText(raw);
  if (!t) return "";
  if (/^(you |your |this |that |the played)/i.test(t)) return t;
  const low = t.charAt(0).toLowerCase() + t.slice(1);
  if (/^(missed|left|hung|allowed|entered|gave|trapped)/i.test(low)) {
    return `you ${low}`;
  }
  return t;
}

function rankBucket(
  aspects: TipAspect[],
  polarity: AspectPolarity,
  usedTopics: Set<string>,
  usedClauses: Set<string>,
  cap: number,
  voice?: AspectVoice
): TipAspect[] {
  const ranked = aspects
    .filter((a) => a.polarity === polarity && cleanAspectText(a.text))
    .filter((a) => (voice ? a.voice === voice : true))
    .filter(
      (a) =>
        !usedTopics.has(a.topic) ||
        a.topic.startsWith("metric:") ||
        a.voice === "correct" ||
        a.voice === "verdict"
    )
    .sort(
      (a, b) =>
        (b.priority || 0) - (a.priority || 0) ||
        a.topic.localeCompare(b.topic)
    );
  const out: TipAspect[] = [];
  for (const a of ranked) {
    const key = dedupeKey(a.text);
    if (!key || usedClauses.has(key)) continue;
    usedClauses.add(key);
    usedTopics.add(a.topic);
    out.push(a);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Resolve coaching tone from mark / request kind / eval drop.
 * Neutral = checkpoints, structural, unclear eval — assets + plans, not verdict.
 */
export function resolveTipTone(args: {
  mark?: CoachMark | null;
  kind?: string | null;
  deltaCp?: number | null;
  dropCp?: number | null;
  /** Explicit override (e.g. correct wing break → praise). */
  override?: TipTone | null;
}): TipTone {
  if (args.override) return args.override;
  const kind = String(args.kind || "");
  const mark = args.mark || null;
  const drop = Math.round(
    Number(args.dropCp ?? args.deltaCp ?? 0) || 0
  );

  if (
    kind === "praise_move" ||
    mark === "brilliant" ||
    mark === "excellent" ||
    mark === "important"
  ) {
    return "praise";
  }
  if (
    kind === "bad_move" ||
    mark === "blunder" ||
    mark === "mistake" ||
    mark === "missed" ||
    drop >= 80
  ) {
    return "critique";
  }
  if (
    kind === "fixed_checkpoint" ||
    kind === "structural_moment" ||
    kind === "opening_aggregate" ||
    kind === "middlegame_aggregate" ||
    kind === "endgame_advantage"
  ) {
    return "neutral";
  }
  if (mark === "inaccuracy" || (drop > 0 && drop < 80)) {
    return "critique";
  }
  return "neutral";
}

/**
 * Assemble aspects into one comment. Slot picks depend on tone — not a fixed template.
 *
 * - praise: verdict + what you got right + optional keep-going lesson
 * - critique: verdict + played miss + correct-answer framing (+ lesson nudge)
 * - neutral: verdict + assets / plans
 */
export function assembleFromAspects(
  tone: TipTone,
  aspects: TipAspect[],
  opts?: {
    priorTopics?: readonly string[] | null;
    priorClauses?: readonly string[] | null;
    maxBits?: number;
    /** Fallback verdict when no verdict aspect was supplied. */
    verdictFallback?: string | null;
  }
): AspectAssembleResult {
  const usedTopics = new Set(opts?.priorTopics || []);
  const usedClauses = new Set(
    (opts?.priorClauses || []).map(dedupeKey).filter(Boolean)
  );
  const maxBits = opts?.maxBits ?? 3;
  const softKeys: string[] = [];
  const topics: string[] = [];
  const clauses: string[] = [];

  const take = (bucket: TipAspect[]) => {
    for (const a of bucket) {
      softKeys.push(...(a.softKeys || []));
      topics.push(a.topic);
      clauses.push(dedupeKey(a.text));
    }
  };

  const verdictAsp =
    aspects.find(
      (a) =>
        (a.voice === "verdict" || a.topic === "verdict") &&
        cleanAspectText(a.text)
    ) || null;
  const verdictText =
    cleanAspectText(verdictAsp?.text || "") ||
    cleanAspectText(opts?.verdictFallback || "") ||
    toneVerdictLead({ tone });

  if (verdictAsp) {
    take([verdictAsp]);
    usedTopics.add(verdictAsp.topic);
    usedClauses.add(dedupeKey(verdictAsp.text));
  } else {
    topics.push("verdict");
    clauses.push(dedupeKey(verdictText));
  }

  let bits: string[] = [verdictText];

  if (tone === "praise") {
    const goods = rankBucket(aspects, "good", usedTopics, usedClauses, 2);
    const context = rankBucket(aspects, "neutral", usedTopics, usedClauses, 1);
    take(goods);
    take(context);
    const idea = goods
      .filter((a) => a.topic !== "verdict" && a.voice !== "verdict")
      .map((a) => a.text);
    const ctx = context.map((a) => a.text);
    if (ctx.length && idea.length) {
      bits.push(bookJoin([...ctx, ...idea]));
    } else if (idea.length) {
      bits.push(joinBits(idea));
    } else if (ctx.length) {
      bits.push(joinBits(ctx));
    }
    const lesson = rankBucket(
      aspects.filter(
        (a) => a.topic === "lesson" || a.topic.startsWith("lesson")
      ),
      "good",
      usedTopics,
      usedClauses,
      1
    );
    if (lesson[0]) {
      take(lesson);
      const keep = cleanAspectText(lesson[0].text);
      if (keep) {
        bits.push(
          `Keep building on that. ${keep.charAt(0).toUpperCase()}${keep.slice(1)}`
        );
      }
    }
  } else if (tone === "critique") {
    const context = rankBucket(
      aspects.filter(
        (a) =>
          a.voice === "context" ||
          a.topic === "situation" ||
          a.topic.startsWith("sit:") ||
          a.topic === "context"
      ),
      "neutral",
      usedTopics,
      usedClauses,
      1
    );
    const played = [
      ...rankBucket(
        aspects.filter((a) => a.voice === "played"),
        "bad",
        usedTopics,
        usedClauses,
        2
      ),
      ...rankBucket(
        aspects.filter(
          (a) =>
            a.voice !== "correct" &&
            a.voice !== "verdict" &&
            (a.topic === "severity" ||
              a.topic === "why" ||
              a.topic.startsWith("tact:") ||
              a.topic === "tactic" ||
              a.topic === "impact" ||
              a.topic.startsWith("break:") ||
              a.topic.startsWith("metric:"))
        ),
        "bad",
        usedTopics,
        usedClauses,
        2
      ),
    ].slice(0, 2);

    const correct = [
      ...rankBucket(
        aspects.filter((a) => a.voice === "correct"),
        "neutral",
        usedTopics,
        usedClauses,
        1
      ),
      ...rankBucket(
        aspects.filter((a) => a.voice === "correct"),
        "good",
        usedTopics,
        usedClauses,
        1
      ),
      ...rankBucket(
        aspects.filter(
          (a) => a.topic === "continuation" || a.topic === "idea"
        ),
        "neutral",
        usedTopics,
        usedClauses,
        1
      ),
      ...rankBucket(
        aspects.filter((a) => a.topic === "continuation"),
        "good",
        usedTopics,
        usedClauses,
        1
      ),
    ].slice(0, 1);

    take(context);
    take(played);
    take(correct);

    const headParts: string[] = [];
    if (context[0]) headParts.push(context[0].text);
    for (const b of played) {
      headParts.push(frameAsPlayedMiss(b.text));
    }

    const correctRaw = correct[0]?.text || "";
    const correctBit = correctRaw ? frameAsCorrectIdea(correctRaw) : "";

    if (headParts.length) bits.push(bookJoin(headParts));
    if (correctBit && !followUpAlreadyTold(bits, correctBit)) {
      bits.push(correctBit);
    }

    const lesson = aspects
      .filter(
        (a) =>
          a.topic === "lesson" ||
          a.topic === "nudge" ||
          a.voice === "lesson"
      )
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const a of lesson) {
      const framed = frameAsCorrectIdea(a.text);
      const key = dedupeKey(framed || a.text);
      if (!key || usedClauses.has(key)) continue;
      if (correctBit && dedupeKey(correctBit) === key) continue;
      usedClauses.add(key);
      topics.push(a.topic);
      clauses.push(key);
      softKeys.push(...(a.softKeys || []));
      bits.push(
        framed.replace(/^Better is\s+(?:to\s+)?/i, "").replace(
          /^the correct (?:move|idea) is\s+(?:to\s+)?/i,
          ""
        )
      );
      break;
    }
  } else {
    const assets = rankBucket(aspects, "good", usedTopics, usedClauses, 1);
    const ideas = rankBucket(aspects, "neutral", usedTopics, usedClauses, 2);
    const caution = rankBucket(aspects, "bad", usedTopics, usedClauses, 1);
    take(assets);
    take(ideas);
    take(caution);

    const parts: string[] = [];
    if (assets[0] && assets[0].voice !== "verdict") {
      parts.push(assets[0].text);
    }
    if (ideas[0]) {
      const ideaText = cleanAspectText(ideas[0].text);
      parts.push(
        ideas[0].topic === "plan" || ideas[0].topic === "idea"
          ? `the idea is ${ideaText.charAt(0).toLowerCase()}${ideaText.slice(1)}`
          : ideaText
      );
    } else if (ideas[1]) {
      parts.push(ideas[1].text);
    }
    if (parts.length) bits.push(joinBits(parts));
    if (caution[0] && bits.length < maxBits) {
      bits.push(rememberPhrase(caution[0].text));
      topics.push(caution[0].topic);
      clauses.push(dedupeKey(caution[0].text));
      softKeys.push(...(caution[0].softKeys || []));
    }
  }

  bits = bits.filter(Boolean).slice(0, maxBits);
  if (bits.length <= 1) {
    const extra = aspects.find(
      (a) =>
        a.voice !== "verdict" &&
        a.topic !== "verdict" &&
        cleanAspectText(a.text) &&
        !usedClauses.has(dedupeKey(a.text))
    );
    if (extra) {
      bits.push(extra.text);
      topics.push(extra.topic);
      clauses.push(dedupeKey(extra.text));
      softKeys.push(...(extra.softKeys || []));
    }
  }
  let text = polishCoachProse(bookJoin(bits));
  text = finishSentence(text);

  return {
    text,
    tone,
    topics: [...new Set(topics.filter(Boolean))],
    clauses: [...new Set(clauses.filter(Boolean))],
    softKeys: [...new Set(softKeys.filter(Boolean))],
  };
}

/** Map break-class / EG impact hints → tone override for strategic tips. */
export function strategicToneFromInputs(
  inputs?: Record<string, string | number | boolean | null> | null,
  mark?: string | null
): TipTone {
  if (!inputs) return "neutral";
  const praiseMark =
    mark === "brilliant" || mark === "excellent" || mark === "best";
  const br = String(inputs.pawn_break_class || "");
  if (praiseMark) {
    if (
      br === "wrong_center_break" ||
      br === "wrong_wing_break" ||
      br === "passive_move"
    ) {
      return "neutral";
    }
    return br === "thematic_wing_break" ? "neutral" : "praise";
  }
  if (br === "thematic_wing_break") return "neutral";
  if (br === "correct_wing_break" || br === "correct_center_break") {
    if (
      inputs.engine_recommend === true ||
      inputs.played_best === false ||
      inputs.played_best === 0
    ) {
      return "neutral";
    }
    return "praise";
  }
  if (
    br === "wrong_center_break" ||
    br === "wrong_wing_break" ||
    br === "passive_move"
  ) {
    if (praiseMark) return "neutral";
    return "critique";
  }
  const err = String(inputs.played_move_error || "");
  if (
    err &&
    err !== "correct_wing_pawn_break" &&
    err !== "correct_center_pawn_break" &&
    err !== "thematic_wing_pawn_break"
  ) {
    if (praiseMark) return "neutral";
    return "critique";
  }
  if (
    inputs.strategic_summary ||
    inputs.engine_line_plan ||
    inputs.technical_rule
  ) {
    return "neutral";
  }
  return "neutral";
}
