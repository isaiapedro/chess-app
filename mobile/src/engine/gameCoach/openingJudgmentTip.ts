/**
 * Weave opening peer judgments + soft-key pack excerpts into one natural tip.
 * Prefer unused softKeys from earlier moments; exact-clause dedupe only.
 * One praise + one nudge; named-opening plan only — no numbers, SAN, book titles.
 */

import {
  buildOpeningPeerSignals,
  type OpeningPeerJudgment,
  type OpeningPeerSignal,
} from "./openingCoachInputs";

const MAX_PRAISE = 1;
const MAX_NUDGE = 1;
/** Cap of soft-key ids stamped on moment inputs / tip. */
export const OPENING_TIP_KEY_ID_CAP = 3;

/** Topics / soft keys / clause fingerprints already used earlier in the game. */
export type OpeningTipPrior = {
  softKeys?: readonly string[];
  metrics?: readonly string[];
  clauses?: readonly string[];
  topics?: readonly string[];
};

export type OpeningJudgmentTipResult = {
  text: string;
  softKeys: string[];
  metrics: string[];
  clauses: string[];
  topics: string[];
};

/** Curated short clauses keyed by softKey + judgment (primary phrasing). */
const CLAUSE_TEMPLATES: Record<
  string,
  { good: string; bad: string }
> = {
  "piece.centralization": {
    good: "good development",
    bad: "fighting for the centre when you can",
  },
  "attack.king_safety": {
    good: "solid king safety",
    bad: "getting the king safe before the position opens",
  },
  "imbalance.space": {
    good: "useful space for your pieces",
    bad: "claiming more space so your pieces have room to move",
  },
  "positional.pawn_break": {
    good: "a timely pawn break",
    bad: "looking for a freeing pawn break",
  },
  "attack.initiative": {
    good: "keeping the initiative",
    bad: "meeting their wing play before it grows",
  },
};

/** Alternate phrasings when the primary clause was already used. */
const CLAUSE_ALTS: Record<string, { good: string[]; bad: string[] }> = {
  "piece.centralization": {
    good: ["clean piece development", "minors coming out purposefully"],
    bad: [
      "contesting the centre with your pieces",
      "bringing the remaining minors into the fight",
    ],
  },
  "attack.king_safety": {
    good: ["a settled king", "king safety handled early"],
    bad: [
      "tucking the king away sooner",
      "castling before the centre opens",
    ],
  },
  "imbalance.space": {
    good: ["room for your pieces to breathe", "a useful space edge"],
    bad: [
      "using a timely pawn break to control the centre",
      "gaining useful space before the position locks",
      "claiming more of the board so your pieces have routes",
    ],
  },
  "positional.pawn_break": {
    good: ["a well-timed lever", "opening lines at the right moment"],
    bad: [
      "preparing a freeing pawn break in the centre",
      "looking for the lever that opens the position",
    ],
  },
  "attack.initiative": {
    good: ["staying a step ahead", "active play that keeps them reacting"],
    bad: [
      "striking in the centre or on the other wing",
      "answering their flank push before it lands",
    ],
  },
};

/** Metric-aware overrides when the same softKey means different things. */
const METRIC_CLAUSE: Partial<
  Record<string, { good?: string; bad?: string }>
> = {
  minors_developed: {
    good: "good development",
    bad: "finishing development of the minors",
  },
  center_control_pct: {
    good: "strong centre control",
    bad: "fighting for the centre when you can",
  },
  tempo_waste_rate_pct: {
    good: "clean development without wasted tempi",
    bad: "avoiding tempo-wasting moves while developing",
  },
  castle_fullmove: {
    good: "solid king safety",
    bad: "castling before the position opens",
  },
  uncastled_rate_pct: {
    good: "solid king safety",
    bad: "getting the king safe sooner",
  },
  space_advantage_pct: {
    good: "useful space for your pieces",
    bad: "fighting for space so your pieces have room to move",
  },
  queenside_advance_opponent: {
    bad: "meeting their queenside push by striking in the centre or on the kingside",
  },
  kingside_advance_opponent: {
    bad: "meeting their kingside push by striking in the centre or on the queenside",
  },
  center_advance: {
    good: "useful central pawn space",
    bad: "contesting the centre with a timely pawn advance",
  },
  center_advance_opponent: {
    bad: "challenging their central space before it clamps you",
  },
  queenside_advance: {
    good: "useful queenside expansion",
    bad: "preparing queenside space only when the centre is stable",
  },
  kingside_advance: {
    good: "useful kingside expansion",
    bad: "expanding on the kingside only when the centre can hold",
  },
};

const METRIC_CLAUSE_ALTS: Partial<
  Record<string, { good?: string[]; bad?: string[] }>
> = {
  space_advantage_pct: {
    bad: [
      "using a timely pawn break to control the centre",
      "gaining useful space before pieces get cramped",
    ],
  },
  center_control_pct: {
    bad: [
      "contesting the centre before launching a wing plan",
      "using a timely pawn break to control the centre",
    ],
  },
  queenside_advance_opponent: {
    bad: [
      "countering their queenside storm in the centre",
      "hitting back on the kingside while their queenside expands",
    ],
  },
  kingside_advance_opponent: {
    bad: [
      "countering their kingside storm in the centre",
      "hitting back on the queenside while their kingside expands",
    ],
  },
};

function firstSentence(raw: string): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^[^.!?]+[.!?]*/);
  return (m ? m[0] : t).trim();
}

/**
 * Pack first sentence → short clause for weaving.
 * Rejects book refs, numbers, SAN-ish debris, and overlong lines.
 */
export function stripPackToClause(raw: string | null | undefined): string | null {
  let t = firstSentence(raw || "");
  if (!t) return null;
  t = t.replace(/^[-•*]\s*/, "");
  t = t.replace(/^Apply the lesson:\s*/i, "");
  t = t.replace(/\b(bookwalk|chapter|volume|pp?\.)\b/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/[.!?]+$/, "").trim();
  if (t.length < 12 || t.length > 88) return null;
  if (/\d/.test(t)) return null;
  if (/%|Δ|\bpeer\b|\bFEN\b/i.test(t)) return null;
  if (/\b(Dvoretsky|Silman|Kasparov|Capablanca|Hellsten|Avrukh)\b/i.test(t)) {
    return null;
  }
  if (/\b[NBRQK]?[a-h][1-8]\b/.test(t) && /\b(plays?|move|line)\b/i.test(t)) {
    return null;
  }
  return t;
}

function dedupeKey(clause: string): string {
  return clause.toLowerCase().replace(/[^a-z]+/g, "");
}

function priorSets(prior?: OpeningTipPrior | null): {
  softKeys: Set<string>;
  metrics: Set<string>;
  clauses: Set<string>;
  topics: Set<string>;
} {
  return {
    softKeys: new Set(prior?.softKeys || []),
    metrics: new Set(prior?.metrics || []),
    clauses: new Set(
      (prior?.clauses || []).map((c) => dedupeKey(c)).filter(Boolean)
    ),
    topics: new Set(prior?.topics || []),
  };
}

function signalFreshness(
  signal: OpeningPeerSignal,
  used: ReturnType<typeof priorSets>
): number {
  let score = 0;
  if (!used.metrics.has(signal.metric)) score += 3;
  for (const k of signal.softKeys) {
    if (k && !used.softKeys.has(k)) score += 2;
  }
  return score;
}

function rankSignalsForDiversity(
  signals: OpeningPeerSignal[],
  used: ReturnType<typeof priorSets>
): OpeningPeerSignal[] {
  return [...signals].sort(
    (a, b) =>
      signalFreshness(b, used) - signalFreshness(a, used) ||
      Math.abs(b.impact) - Math.abs(a.impact) ||
      a.metric.localeCompare(b.metric)
  );
}

function pickUnusedAlt(
  options: string[] | undefined,
  usedClauses: Set<string>,
  primary: string | null
): string | null {
  if (!options?.length) return null;
  for (const opt of options) {
    const key = dedupeKey(opt);
    if (!key || usedClauses.has(key)) continue;
    if (primary && dedupeKey(primary) === key) continue;
    return opt;
  }
  return null;
}

function clauseForSignal(
  signal: OpeningPeerSignal,
  softKey: string,
  packByKey: Record<string, string> | null | undefined,
  usedClauses: Set<string>,
  preferRephrase: boolean
): string | null {
  const judgment = signal.judgment as Exclude<OpeningPeerJudgment, "ok">;
  if (judgment !== "good" && judgment !== "bad") return null;

  const metricOverride = METRIC_CLAUSE[signal.metric]?.[judgment] ?? null;
  const templ = CLAUSE_TEMPLATES[softKey]?.[judgment] ?? null;
  const pack =
    judgment === "bad"
      ? stripPackToClause(packByKey?.[softKey])
      : null;
  const packUsable =
    pack &&
    (pack.length >= 40 ||
      /[,—;]/.test(pack) ||
      /\bbecause\b|\bso that\b/i.test(pack));

  const candidates: string[] = [];
  if (packUsable && pack) candidates.push(pack);
  if (metricOverride) candidates.push(metricOverride);
  if (templ) candidates.push(templ);
  if (pack && !packUsable) candidates.push(pack);

  const altMetric = METRIC_CLAUSE_ALTS[signal.metric]?.[judgment];
  const altSoft = CLAUSE_ALTS[softKey]?.[judgment];
  if (preferRephrase || candidates.some((c) => usedClauses.has(dedupeKey(c)))) {
    const alt =
      pickUnusedAlt(altMetric, usedClauses, null) ||
      pickUnusedAlt(altSoft, usedClauses, null);
    if (alt) return alt;
  }

  for (const c of candidates) {
    if (!usedClauses.has(dedupeKey(c))) return c;
  }

  const forcedAlt =
    pickUnusedAlt(altMetric, usedClauses, null) ||
    pickUnusedAlt(altSoft, usedClauses, null);
  if (forcedAlt) return forcedAlt;

  return candidates[0] || null;
}

function rememberPhrase(clause: string): string {
  const n = asNudgeLead(clause);
  if (
    /^(fighting|getting|finishing|claiming|looking|avoiding|castling|meeting|using|gaining|contesting|preparing|countering|hitting|challenging|answering|striking|expanding|bringing|tucking)\b/i.test(
      n
    )
  ) {
    return `just remember ${n}`;
  }
  if (
    /^(use|fight|contest|finish|castle|gain|claim|centralize|get|look|avoid|meet|prepare|counter|hit|challenge|answer|strike|expand)\b/i.test(
      n
    )
  ) {
    return `just remember to ${n}`;
  }
  return `just remember ${n}`;
}

function collectClauses(
  signals: OpeningPeerSignal[],
  judgment: "good" | "bad",
  cap: number,
  packByKey: Record<string, string> | null | undefined,
  used: ReturnType<typeof priorSets>,
  preferRephrase: boolean
): { clauses: string[]; softKeys: string[]; metrics: string[] } {
  const out: string[] = [];
  const softKeys: string[] = [];
  const metrics: string[] = [];
  const seen = new Set<string>(used.clauses);
  const ranked = rankSignalsForDiversity(
    signals.filter((s) => s.judgment === judgment),
    used
  );
  for (const signal of ranked) {
    for (const softKey of signal.softKeys) {
      if (!softKey || softKey.startsWith("methodology.")) continue;
      const clause = clauseForSignal(
        signal,
        softKey,
        packByKey,
        seen,
        preferRephrase || used.softKeys.has(softKey)
      );
      if (!clause) continue;
      const key = dedupeKey(clause);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clause);
      softKeys.push(softKey);
      metrics.push(signal.metric);
      break;
    }
    if (out.length >= cap) break;
  }
  return { clauses: out, softKeys, metrics };
}

function joinPraise(parts: string[]): string {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function asNudgeLead(clause: string): string {
  const trimmed = clause.replace(/[.!?]+$/, "").trim();
  const lower = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  if (
    /^(use|fight|fighting|contest|finish|finishing|castle|castling|gain|claim|claiming|centralize|get|getting|look|looking|avoid|avoiding|meet|meeting|prepare|preparing|counter|countering|hit|hitting|challenge|challenging|answer|answering|strike|striking|expand|expanding|bring|bringing|tuck|tucking)\b/i.test(
      trimmed
    )
  ) {
    return lower;
  }
  return lower;
}

function enrichNudgeWithSpace(nudge: string, hasSpaceBad: boolean): string {
  if (!hasSpaceBad) return nudge;
  if (/\bspace\b|\broom\b/i.test(nudge)) return nudge;
  if (/\bcent(?:re|er)\b/i.test(nudge)) {
    return `${nudge} — it gives your pieces more room to move`;
  }
  return nudge;
}

function openingPlanClause(
  openingKeyId: string | null | undefined,
  packByKey?: Record<string, string> | null,
  usedClauses?: Set<string>
): string | null {
  if (!openingKeyId || !openingKeyId.startsWith("opening.")) return null;
  const pack = stripPackToClause(packByKey?.[openingKeyId]);
  if (!pack) return null;
  if (/irregular/i.test(pack)) return null;
  const lead = asNudgeLead(pack);
  if (usedClauses?.has(dedupeKey(lead))) return null;
  return lead;
}

function principlePlanClause(
  packByKey?: Record<string, string> | null,
  usedClauses?: Set<string>
): string | null {
  const keys = [
    "positional.pawn_break",
    "imbalance.space",
    "piece.centralization",
  ];
  for (const k of keys) {
    const pack = stripPackToClause(packByKey?.[k]);
    if (!pack) continue;
    const lead = asNudgeLead(pack);
    if (usedClauses?.has(dedupeKey(lead))) continue;
    if (pack.length < 20) continue;
    return lead;
  }
  return null;
}

function advanceTopicFromInputs(
  inputs?: Record<string, string | number | boolean | null> | null
): string | null {
  if (!inputs) return null;
  const oppQ =
    typeof inputs.queenside_advance_opponent === "number"
      ? inputs.queenside_advance_opponent
      : 0;
  const oppK =
    typeof inputs.kingside_advance_opponent === "number"
      ? inputs.kingside_advance_opponent
      : 0;
  const ownC =
    typeof inputs.center_advance === "number" ? inputs.center_advance : 0;
  const ownQ =
    typeof inputs.queenside_advance === "number" ? inputs.queenside_advance : 0;
  const ownK =
    typeof inputs.kingside_advance === "number" ? inputs.kingside_advance : 0;
  if (oppQ >= 4 && oppQ >= oppK && oppQ >= ownQ) return "counter_queenside_advance";
  if (oppK >= 4 && oppK >= oppQ) return "counter_kingside_advance";
  if (ownC >= 4) return "centre_space";
  if (ownQ >= 4 && ownQ > ownK) return "own_queenside_advance";
  if (ownK >= 4) return "own_kingside_advance";
  return null;
}

function advanceNudgeClause(topic: string): string {
  if (topic === "counter_queenside_advance") {
    return "meeting their queenside push by striking in the centre or on the other wing";
  }
  if (topic === "counter_kingside_advance") {
    return "meeting their kingside push before it grows";
  }
  if (topic === "centre_space") {
    return "using your centre pawns to claim useful space";
  }
  if (topic === "own_queenside_advance") {
    return "using your queenside space before they clamp it";
  }
  return "using your kingside space while the centre stays flexible";
}

/** Ranked soft keys for tip / inputs (cap OPENING_TIP_KEY_ID_CAP). */
export function rankOpeningTipKeyIds(args: {
  wovenSoftKeys?: readonly string[] | null;
  peerSoftKeys?: readonly string[] | null;
  openingKeyId?: string | null;
  openingName?: string | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string | null | undefined) => {
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const k of args.peerSoftKeys || []) push(k);
  for (const k of args.wovenSoftKeys || []) push(k);
  const named =
    args.openingKeyId &&
    args.openingKeyId.startsWith("opening.") &&
    !/irregular/i.test(String(args.openingName || ""));
  if (named) {
    if (!seen.has(args.openingKeyId!)) {
      out.unshift(args.openingKeyId!);
      seen.add(args.openingKeyId!);
    } else {
      const rest = out.filter((k) => k !== args.openingKeyId);
      out.length = 0;
      out.push(args.openingKeyId!, ...rest);
    }
  }
  return out.slice(0, OPENING_TIP_KEY_ID_CAP);
}

/**
 * Detailed opening tip: one praise + one nudge; named-opening plan only.
 * priorTopics: prefer unused softKeys; exact-clause dedupe (no synonym churn).
 */
export function composeOpeningJudgmentTipDetailed(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  openingName?: string | null;
  openingKeyId?: string | null;
  packByKey?: Record<string, string> | null;
  priorTopics?: OpeningTipPrior | null;
  /** Override peer signals (middlegame weave uses MG peer gaps). */
  signals?: OpeningPeerSignal[] | null;
}): OpeningJudgmentTipResult {
  const used = priorSets(args.priorTopics);
  const preferUnused = Boolean(args.priorTopics?.softKeys?.length);
  const signals = args.signals?.length
    ? [...args.signals].sort(
        (a, b) =>
          Math.abs(b.impact) - Math.abs(a.impact) ||
          a.metric.localeCompare(b.metric)
      )
    : buildOpeningPeerSignals(args.inputs)
        .slice()
        .sort((a, b) => {
          const aUsed = a.softKeys.some((k) => used.softKeys.has(k)) ? 1 : 0;
          const bUsed = b.softKeys.some((k) => used.softKeys.has(k)) ? 1 : 0;
          if (preferUnused && aUsed !== bUsed) return aUsed - bUsed;
          return Math.abs(b.impact) - Math.abs(a.impact);
        });

  const praisePack = collectClauses(
    signals,
    "good",
    MAX_PRAISE,
    args.packByKey,
    used,
    false
  );
  const nudgePack = collectClauses(
    signals,
    "bad",
    MAX_NUDGE,
    args.packByKey,
    used,
    false
  );

  const hasSpaceBad = signals.some(
    (s) =>
      s.judgment === "bad" &&
      (s.metric === "space_advantage_pct" ||
        s.metric === "center_control_pct" ||
        s.softKeys.includes("imbalance.space"))
  );
  let nudges = nudgePack.clauses;
  if (nudges.length) {
    nudges = [enrichNudgeWithSpace(nudges[0]!, hasSpaceBad)];
  }

  const advTopic = advanceTopicFromInputs(args.inputs);
  const namedOpening =
    Boolean(args.openingKeyId) &&
    !/irregular/i.test(String(args.openingName || ""));

  const planUsed = new Set(used.clauses);
  for (const c of praisePack.clauses) planUsed.add(dedupeKey(c));
  for (const c of nudges) planUsed.add(dedupeKey(c));
  const plan = namedOpening
    ? openingPlanClause(args.openingKeyId, args.packByKey, planUsed)
    : null;

  const usedSoftKeys = [...praisePack.softKeys, ...nudgePack.softKeys];
  const usedMetrics = [...praisePack.metrics, ...nudgePack.metrics];
  const usedClauses = [
    ...praisePack.clauses.map(dedupeKey),
    ...nudges.map(dedupeKey),
  ];
  const topics: string[] = [];
  if (advTopic && !used.topics.has(advTopic)) topics.push(advTopic);

  if (!nudges.length && advTopic && !used.topics.has(advTopic)) {
    nudges = [advanceNudgeClause(advTopic)];
    usedSoftKeys.push("imbalance.space");
    usedClauses.push(dedupeKey(nudges[0]!));
    if (!topics.includes(advTopic)) topics.push(advTopic);
  }

  if (plan) {
    topics.push("opening_plan");
    usedClauses.push(dedupeKey(plan));
  }

  let text: string;
  const praise = praisePack.clauses;

  if (praise.length && nudges.length) {
    const head = joinPraise(praise);
    const nudgeBit = rememberPhrase(nudges[0]!);
    text =
      plan && !used.topics.has("opening_plan")
        ? `${head}, ${nudgeBit}; typical idea: ${plan}`
        : `${head}, ${nudgeBit}`;
  } else if (praise.length && plan) {
    text = `${joinPraise(praise)}; typical idea: ${plan}`;
  } else if (praise.length) {
    text = `${joinPraise(praise)} — keep building on that`;
  } else if (nudges.length) {
    const remembered = rememberPhrase(nudges[0]!);
    text = remembered.charAt(0).toUpperCase() + remembered.slice(1);
    if (plan) text = `${text}; typical idea: ${plan}`;
  } else if (plan) {
    text = `Typical idea: ${plan}`;
  } else if (args.openingKeyId) {
    text =
      "Follow the usual plans: develop, castle, and fight for the centre.";
  } else {
    text =
      "Develop the minors, castle, and contest the centre before launching a plan.";
  }

  return {
    text,
    softKeys: [...new Set(usedSoftKeys)],
    metrics: [...new Set(usedMetrics)],
    clauses: [...new Set(usedClauses.filter(Boolean))],
    topics: [...new Set(topics)],
  };
}

/**
 * One concise natural phrase from peer judgments + optional pack excerpts.
 */
export function composeOpeningJudgmentTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  openingName?: string | null;
  openingKeyId?: string | null;
  packByKey?: Record<string, string> | null;
  priorTopics?: OpeningTipPrior | null;
}): string {
  return composeOpeningJudgmentTipDetailed(args).text;
}

/** Merge tip metadata into a running prior-topics bag. */
export function mergeOpeningTipPrior(
  prior: OpeningTipPrior | null | undefined,
  next: Pick<
    OpeningJudgmentTipResult,
    "softKeys" | "metrics" | "clauses" | "topics"
  >
): OpeningTipPrior {
  return {
    softKeys: [...new Set([...(prior?.softKeys || []), ...next.softKeys])],
    metrics: [...new Set([...(prior?.metrics || []), ...next.metrics])],
    clauses: [...new Set([...(prior?.clauses || []), ...next.clauses])],
    topics: [...new Set([...(prior?.topics || []), ...next.topics])],
  };
}
