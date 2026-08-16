/**
 * Polished MG/EG coach tips — opening-style dialogue, not metric dumps.
 * Weave tactic / why-better / situations / plan / pack into one natural phrase.
 * No cp numbers, "Why better:", "Also:", or raw Δ dumps.
 */

import type { CoachMark } from "./coachMarks";
import type { MetricFieldDelta } from "./coachNoteRequest";
import type { CoachMetricMoment } from "./coachGameMetrics";
import type { EngineLineExplainResult } from "./engineLineExplain";
import type { GamePlanState } from "./gamePlanState";
import { metricKeyLabel } from "./metricThemes";
import { stripPackToClause } from "./openingJudgmentTip";
import type { OpeningTipPrior } from "./openingJudgmentTip";
import type { DetectedSituation } from "./situationProfiles";
import {
  forcingPrefix,
  type TacticalFact,
} from "./tacticalFact";

export type MomentJudgmentTipResult = {
  text: string;
  softKeys: string[];
  metrics: string[];
  clauses: string[];
  topics: string[];
};

const SITUATION_LABEL: Record<string, string> = {
  opposite_side_castling: "opposite-side castling",
  iqp: "an isolated queen pawn",
  closed_center: "a closed centre",
  maroczy_bind: "a Maróczy bind",
  carlsbad: "a Carlsbad structure",
  minority_attack: "a minority-attack structure",
  caro_slav: "a Caro-Slav shell",
  hedgehog: "a Hedgehog shell",
  scheveningen: "a Scheveningen shell",
  dragon_formation: "a Dragon formation",
  pawn_storm: "a pawn-storm race",
  knight_vs_bishop: "knight vs bishop",
  good_vs_bad_bishop: "good vs bad bishop",
  rook_ending: "a rook ending",
  pawn_ending: "a pawn ending",
};

const ROLE_LABEL: Record<string, string> = {
  iqp_owner: "you own the isolani",
  blockader: "you are the blockader",
  binder: "you hold the bind",
  cramped: "you are the cramped side",
  minority_attacker: "you run the minority attack",
  minority_defender: "you defend against the minority",
};

const FIELD_STATE_LABEL: Record<string, string> = {
  mobility: "piece activity",
  king_attackers_pct: "pressure on your king",
  opp_king_attackers_pct: "pressure on their king",
  space_advantage_pct: "space",
  hanging_material_own: "your hanging material",
  hanging_material_opponent: "their hanging material",
  open_file_utilization: "open-file occupation",
  seventh_rank_infiltration: "seventh-rank presence",
  queenside_advance: "your queenside advance",
  queenside_advance_opponent: "their queenside advance",
  kingside_advance: "your kingside advance",
  kingside_advance_opponent: "their kingside advance",
  center_advance: "your central advance",
  center_advance_opponent: "their central advance",
  bishop_diagonal_influence_light: "your light-square bishop scope",
  bishop_diagonal_influence_dark: "your dark-square bishop scope",
  bishop_diagonal_influence_light_opponent: "their light-square bishop scope",
  bishop_diagonal_influence_dark_opponent: "their dark-square bishop scope",
  bishop_openness_light: "your light-square bishop openness",
  bishop_openness_dark: "your dark-square bishop openness",
  bishop_openness_light_opponent: "their light-square bishop openness",
  bishop_openness_dark_opponent: "their dark-square bishop openness",
  material_balance: "material",
  pawn_storm_tempo: "pawn-storm tempo",
  knight_vs_bishop: "knight-vs-bishop imbalance",
  good_vs_bad_bishop: "bishop quality",
  opp_king_in_centre: "their king in the centre",
  opp_king_uncastled: "their uncastled king",
  king_attack_ratio: "attackers vs defenders on their king",
  attack_setup: "your attack build-up",
  opp_king_weaknesses: "holes around their king",
  second_weakness: "a second weakness",
  queen_centralization: "queen centralization",
  connected_rooks: "connected rooks",
  piece_liberation: "piece liberation",
  side_clamp: "side clamp / wing space",
  key_square_control: "key-square control",
  piece_support: "piece support",
};

function dedupeKey(clause: string): string {
  return clause.toLowerCase().replace(/[^a-z]+/g, "");
}

function stripNumericNoise(s: string): string {
  return (s || "")
    .replace(/\s*\([+\-]?\d+(?:\.\d+)?\)/g, "")
    .replace(/\b[~≈]?\d+\s*cp\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function severityLead(args: {
  mark: CoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  kind?: string | null;
}): string {
  const drop = Math.round(args.moment?.dropCp || args.deltaCp || 0);
  const severe =
    args.mark === "blunder" ||
    (args.moment && args.moment.dropCp >= 150) ||
    drop >= 200;
  if (args.kind === "praise_move" || args.mark === "brilliant") {
    return "Sharp idea";
  }
  if (args.mark === "important") return "Only move that holds";
  if (severe) return "Serious miss";
  if (
    args.mark === "mistake" ||
    args.mark === "missed" ||
    args.moment?.severity === "mistake"
  ) {
    return "Costly miss";
  }
  return "";
}

function situationFrame(
  situations: DetectedSituation[] | null | undefined,
  prior?: OpeningTipPrior | null
): { clause: string | null; topic: string | null; softKeys: string[] } {
  const usedTopics = new Set(prior?.topics || []);
  const ranked = [...(situations || [])].sort(
    (a, b) => (b.lockBoost || 0) - (a.lockBoost || 0) || b.confidence - a.confidence
  );
  for (const s of ranked) {
    const topic = `sit:${s.id}`;
    if (usedTopics.has(topic)) continue;
    const label = SITUATION_LABEL[s.id] || s.id.replace(/_/g, " ");
    const role =
      s.role && ROLE_LABEL[s.role] ? ` (${ROLE_LABEL[s.role]})` : "";
    return {
      clause: `With ${label}${role} in play`,
      topic,
      softKeys: s.softKeys.slice(0, 3),
    };
  }
  return { clause: null, topic: null, softKeys: [] };
}

function planFrame(
  gamePlan: GamePlanState | null | undefined,
  prior?: OpeningTipPrior | null
): { clause: string | null; softKeys: string[] } {
  const keys = (gamePlan?.stickyKeys || []).filter(Boolean);
  if (!keys.length) return { clause: null, softKeys: [] };
  const used = new Set(prior?.softKeys || []);
  const fresh = keys.find((k) => !used.has(k)) || keys[0]!;
  const label = metricKeyLabel(fresh);
  if (!label || label.length < 3) return { clause: null, softKeys: [] };
  return {
    clause: `your live plan still hinges on ${label}`,
    softKeys: [fresh],
  };
}

function topMetricStates(
  deltas: MetricFieldDelta[] | null | undefined,
  limit = 3
): { clauses: string[]; metrics: string[] } {
  const rows = [...(deltas || [])]
    .filter(
      (d) =>
        d.delta != null &&
        typeof d.delta === "number" &&
        Math.abs(d.delta) >= 1 &&
        d.before != null &&
        d.after != null &&
        typeof d.before === "number" &&
        typeof d.after === "number"
    )
    .sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0));
  const clauses: string[] = [];
  const metrics: string[] = [];
  const seen = new Set<string>();
  for (const d of rows) {
    const label = FIELD_STATE_LABEL[d.field] || d.field.replace(/_/g, " ");
    if (seen.has(label)) continue;
    seen.add(label);
    const before = Math.round(Number(d.before) * 10) / 10;
    const after = Math.round(Number(d.after) * 10) / 10;
    clauses.push(`${label} ${before}→${after}`);
    metrics.push(d.field);
    if (clauses.length >= limit) break;
  }
  return { clauses, metrics };
}

function reasonProse(reasons: string[], limit = 3): string {
  const clean = reasons
    .map(stripNumericNoise)
    .map((r) => r.replace(/^engine:\s*/i, "").trim())
    .filter((r) => r.length >= 8)
    .slice(0, limit);
  if (!clean.length) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]}, and ${clean[2]}`;
}

function narrateEngineLine(args: {
  fact?: TacticalFact | null;
  engineLineSans?: string[] | null;
  bestSan?: string | null;
}): string {
  const sans = (args.engineLineSans || []).filter(Boolean);
  const best =
    args.bestSan ||
    args.fact?.captureSan ||
    (sans[0] ? String(sans[0]) : null);
  if (!best) return "";

  const forcing = forcingPrefix(sans.length ? sans : [best]);
  const line = (forcing || best).trim();
  const moves = line.split(/\s+/).filter(Boolean);
  const laterCaps = moves.slice(1).filter((s) => s.includes("x"));
  const hasCheck = moves.some((s) => /[+#]$/.test(s));

  if (args.fact?.kind === "missed_mate" || args.fact?.kind === "hung_mate") {
    return moves.length > 1
      ? `the finish runs ${line}`
      : `start with ${best}`;
  }
  if (args.fact?.kind === "missed_capture") {
    const piece = args.fact.pieceLabel || "piece";
    return moves.length > 1
      ? `${line} collects the ${piece}`
      : `${best} takes the ${piece}`;
  }
  if (args.fact?.kind === "gave_piece") {
    return args.fact.takenNext
      ? `the ${args.fact.pieceLabel || "piece"} falls on the next move`
      : `the ${args.fact.pieceLabel || "piece"} is left hanging`;
  }
  if (args.fact?.kind === "missed_tactic" || args.fact?.kind === "sacrifice") {
    if (moves.length >= 2 && (laterCaps.length || hasCheck)) {
      return `${line} — the forcing sequence leaves material unable to escape`;
    }
    if (moves.length >= 2) {
      return `the idea continues ${line}`;
    }
    return `start with ${best}`;
  }
  if (moves.length >= 2) return `prefer ${line}`;
  return `prefer ${best}`;
}

function tacticalDiagnosis(fact: TacticalFact | null | undefined): string {
  if (!fact?.kind) return "";
  const piece = fact.pieceLabel || "material";
  switch (fact.kind) {
    case "missed_mate":
      return fact.mateIn != null
        ? `you missed mate in ${fact.mateIn}`
        : "you missed a forced mate";
    case "hung_mate":
      return fact.mateIn != null
        ? `you allowed mate in ${fact.mateIn}`
        : "you allowed a forced mate";
    case "missed_capture":
      return `you missed the capture of the ${piece}`;
    case "missed_tactic":
      return "you missed a forcing intermediate idea";
    case "gave_piece":
      return fact.takenNext
        ? `you hung the ${piece} (taken next)`
        : `you left the ${piece} hanging`;
    case "bad_trade":
      return `you entered a bad trade of the ${piece}`;
    case "sacrifice":
      return `the sacrifice of the ${piece} needed a clean follow-up`;
    default:
      return "";
  }
}

/**
 * One polished coach comment for a metric coach call (bad / praise / structural).
 */
export function composeMomentJudgmentTip(args: {
  mark: CoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  kind?: string | null;
  explained?: EngineLineExplainResult | null;
  fact?: TacticalFact | null;
  packText?: string | null;
  packKeyId?: string | null;
  gamePlan?: GamePlanState | null;
  situations?: DetectedSituation[] | null;
  engineLineSans?: string[] | null;
  playedMetricDelta?: MetricFieldDelta[] | null;
  engineVsPlayedMetricDelta?: MetricFieldDelta[] | null;
  priorTopics?: OpeningTipPrior | null;
}): MomentJudgmentTipResult {
  const softKeys: string[] = [];
  const metrics: string[] = [];
  const clauses: string[] = [];
  const topics: string[] = [];

  const lead = severityLead(args);
  const sit = situationFrame(args.situations, args.priorTopics);
  const plan = planFrame(args.gamePlan, args.priorTopics);
  const state = topMetricStates(
    args.playedMetricDelta?.length
      ? args.playedMetricDelta
      : args.engineVsPlayedMetricDelta,
    3
  );

  const tact = tacticalDiagnosis(args.fact);
  const lineStory = narrateEngineLine({
    fact: args.fact,
    engineLineSans: args.engineLineSans,
    bestSan:
      args.moment?.bestSan ||
      args.fact?.captureSan ||
      args.explained?.primaryText?.match(/\bPrefer\s+(\S+)/i)?.[1] ||
      null,
  });

  const why = reasonProse(args.explained?.reasons || [], 3);
  const lesson = stripPackToClause(args.packText);

  if (sit.softKeys.length) softKeys.push(...sit.softKeys);
  if (plan.softKeys.length) softKeys.push(...plan.softKeys);
  if (args.explained?.primarySoftKeys?.length) {
    softKeys.push(...args.explained.primarySoftKeys.slice(0, 2));
  }
  if (args.explained?.softKeys?.length) {
    softKeys.push(...args.explained.softKeys.slice(0, 3));
  }
  if (args.packKeyId) softKeys.push(args.packKeyId);
  metrics.push(...state.metrics);
  if (args.explained?.primaryField) metrics.push(args.explained.primaryField);
  if (sit.topic) topics.push(sit.topic);
  if (plan.clause) topics.push("game_plan");
  if (args.fact?.kind) topics.push(`tact:${args.fact.kind}`);
  if (lesson) {
    clauses.push(dedupeKey(lesson));
    topics.push("lesson");
  }

  const bits: string[] = [];

  // Frame: situation + severity
  if (sit.clause && lead) {
    bits.push(`${sit.clause}, ${lead.toLowerCase()}`);
  } else if (sit.clause) {
    bits.push(sit.clause);
  } else if (lead) {
    bits.push(lead);
  }

  // Core diagnosis
  if (tact && lineStory) {
    bits.push(`${tact}: ${lineStory}`);
  } else if (tact) {
    bits.push(tact);
  } else if (lineStory && why) {
    bits.push(`${lineStory} — ${why}`);
  } else if (lineStory) {
    bits.push(lineStory);
  } else if (why) {
    bits.push(why);
  }

  // Plan / assets
  if (plan.clause) {
    bits.push(plan.clause);
  }

  // Metric before→after (top weighted only)
  if (state.clauses.length) {
    bits.push(`on the board: ${state.clauses.join(", ")}`);
  }

  // Lesson woven like opening nudge
  if (lesson) {
    const used = new Set((args.priorTopics?.clauses || []).map(dedupeKey));
    if (!used.has(dedupeKey(lesson))) {
      bits.push(`remember ${lesson.charAt(0).toLowerCase()}${lesson.slice(1)}`);
    }
  }

  let text = bits
    .map((b) => stripNumericNoise(b))
    .filter(Boolean)
    .join(" — ")
    .replace(/\s+/g, " ")
    .trim();

  // Capitalize first letter; ensure terminal punctuation
  if (text) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!/[.!?]$/.test(text)) text = `${text}.`;
  }

  if (!text || text.length < 28) {
    text =
      lead || why || lineStory
        ? `${lead || "Review this moment"}${why ? ` — ${why}` : ""}${lineStory && !why ? ` — ${lineStory}` : ""}.`
        : "Revisit the plan and compare your move with the engine idea.";
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!/[.!?]$/.test(text)) text = `${text}.`;
  }

  return {
    text,
    softKeys: [...new Set(softKeys.filter(Boolean))],
    metrics: [...new Set(metrics.filter(Boolean))],
    clauses: [...new Set(clauses.filter(Boolean))],
    topics: [...new Set(topics.filter(Boolean))],
  };
}
