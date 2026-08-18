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
import type { DerivedCoachNote } from "./derivedCoachPack";
import {
  clauseFromPackNote,
  formatTacticalSlotComment,
  lessonFromPackNote,
  planFromPackNote,
} from "./packNoteContent";
import {
  clauseForMetricDelta,
  clauseForSoftKey,
} from "./metricClauseTemplates";
import type { DetectedSituation } from "./situationProfiles";
import {
  type TacticalFact,
} from "./tacticalFact";
import {
  assembleFromAspects,
  resolveTipTone,
  toneVerdictLead,
  type TipAspect,
} from "./tipAspectAssemble";
import {
  localizeTipCoordinate,
  packNoteLocalizes,
  engineVsPlayedClause,
  type TipCoordinate,
} from "./tipCoordinate";

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

function stripNumericNoise(s: string): string {
  return (s || "")
    .replace(/\s*\([+\-]?\d+(?:\.\d+)?\)/g, "")
    .replace(/\b[~≈]?\d+\s*cp\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function praiseIdeaFromLine(args: {
  fact?: TacticalFact | null;
  engineLineSans?: string[] | null;
  playedSan?: string | null;
  bestSan?: string | null;
  explained?: EngineLineExplainResult | null;
}): string {
  const played = (args.playedSan || "").trim();
  const best = followUpMove(args.bestSan, args.engineLineSans) || played;
  if (args.fact?.kind === "sacrifice") {
    const piece = (args.fact.pieceLabel || "piece").replace(/_/g, " ");
    return `the ${piece} sacrifice opens a follow-up`;
  }
  const idea = ideaBehindFollowUp({
    fact: args.fact,
    explained: args.explained,
  });
  if (best && idea) return `${best} to ${idea}`;
  if (best) return `${best} improves the pieces`;
  return "the move improves your pieces";
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

function topMetricHumanClauses(
  deltas: MetricFieldDelta[] | null | undefined,
  limit = 2,
  usedClauses?: Set<string>,
  preferFields?: string[] | null
): { clauses: string[]; metrics: string[]; softKeys: string[]; judgments: ("good" | "bad")[] } {
  const prefer = preferFields?.filter(Boolean) || [];
  const preferSet = new Set(prefer);
  const rows = [...(deltas || [])]
    .filter(
      (d) =>
        d.delta != null &&
        typeof d.delta === "number" &&
        Math.abs(d.delta) >= 1 &&
        (!preferSet.size || preferSet.has(d.field))
    )
    .sort((a, b) => {
      if (preferSet.size) {
        const ia = prefer.indexOf(a.field);
        const ib = prefer.indexOf(b.field);
        const ra = ia < 0 ? 99 : ia;
        const rb = ib < 0 ? 99 : ib;
        if (ra !== rb) return ra - rb;
      }
      return Math.abs(b.delta || 0) - Math.abs(a.delta || 0);
    });
  const clauses: string[] = [];
  const metrics: string[] = [];
  const softKeys: string[] = [];
  const judgments: ("good" | "bad")[] = [];
  const seen = new Set<string>(usedClauses || []);
  for (const d of rows) {
    const hit = clauseForMetricDelta(d.field, Number(d.delta), seen);
    if (!hit) continue;
    const key = hit.clause.toLowerCase().replace(/[^a-z]+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    clauses.push(hit.clause);
    metrics.push(d.field);
    softKeys.push(hit.softKey);
    judgments.push(hit.judgment);
    if (clauses.length >= limit) break;
  }
  return { clauses, metrics, softKeys, judgments };
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

function tokenHasSan(text: string, san: string): boolean {
  const p = String(san || "").trim();
  if (!p) return false;
  const needle = p.replace(/[+#]+$/g, "");
  return (text || "")
    .split(/\s+/)
    .some((tok) => tok.replace(/[+#]+$/g, "") === needle);
}

function withInsteadOfPlayed(
  story: string,
  played: string | null | undefined
): string {
  const p = String(played || "").trim();
  const s = (story || "").replace(/^prefer\s+/i, "").trim();
  if (!s) return "";
  if (!p) return s;
  const first = s.split(/\s+/)[0] || "";
  if (tokenHasSan(first, p)) return s;
  return `${s} instead of ${p}`;
}

function huntIsPlayedContinuation(fact?: TacticalFact | null): boolean {
  if (!fact?.kind) return false;
  if (fact.selfInflicted) return true;
  return fact.kind === "gave_piece" || fact.kind === "hung_mate";
}

function followUpMove(
  bestSan?: string | null,
  engineLineSans?: string[] | null
): string | null {
  const t = String(bestSan || "").trim();
  if (t && t !== "—" && t !== "-") return t.replace(/[?!]+$/g, "");
  const first = (engineLineSans || []).find(Boolean);
  const s = String(first || "").trim();
  if (!s || s === "—" || s === "-") return null;
  return s.replace(/[?!]+$/g, "");
}

function ideaBehindFollowUp(args: {
  fact?: TacticalFact | null;
  explained?: EngineLineExplainResult | null;
  factors?: string[] | null;
  phase?: string | null;
}): string | null {
  const fact = args.fact;
  const piece = (fact?.pieceLabel || "piece").replace(/_/g, " ");
  if (fact?.kind === "missed_mate") return "start the mate";
  if (fact?.kind === "hung_mate") return "avoid mate";
  if (fact?.kind === "missed_capture") return `take the ${piece}`;
  if (fact?.kind === "trapped_piece" && fact.selfInflicted) {
    return `save the ${piece}`;
  }
  if (fact?.kind === "trapped_piece") return `win the trapped ${piece}`;
  if (fact?.kind === "gave_piece") return `keep the ${piece}`;
  if (fact?.kind === "sacrifice") return `follow the sacrifice`;
  if (fact?.kind === "missed_tactic") {
    if (fact.motif === "pin") return `pin the ${piece}`;
    if (fact.motif === "skewer") return `skewer the ${piece}`;
    if (fact.motif === "fork") return `fork the ${piece}`;
    if (fact.motif === "hang") return `take the hanging ${piece}`;
  }
  const factors = args.factors || [];
  if (
    factors.includes("queen_re_move") ||
    factors.includes("knight_re_move") ||
    factors.includes("tempo_waste") ||
    factors.includes("undeveloped_minors")
  ) {
    return "develop";
  }
  return null;
}

function narrateEngineLine(args: {
  fact?: TacticalFact | null;
  engineLineSans?: string[] | null;
  bestSan?: string | null;
  explained?: EngineLineExplainResult | null;
  factors?: string[] | null;
  phase?: string | null;
}): string {
  const playedHunt = huntIsPlayedContinuation(args.fact);
  const best = followUpMove(
    args.bestSan,
    playedHunt ? null : args.engineLineSans
  );
  if (!best) return "";
  const idea = ideaBehindFollowUp(args);
  if (idea) return `${best} to ${idea}`;
  return best;
}

function tacticalDiagnosis(fact: TacticalFact | null | undefined): string {
  if (!fact?.kind) return "";
  const piece = (fact.pieceLabel || "material").replace(/_/g, " ");
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
    case "trapped_piece":
      if (fact.selfInflicted) {
        const hunt = fact.captureSan ? ` after ${fact.captureSan}` : "";
        return fact.trapSquare
          ? `your ${piece} on ${fact.trapSquare} has no escape${hunt}`
          : `your ${piece} has no escape${hunt}`;
      }
      return fact.trapSquare
        ? `you missed that the ${piece} on ${fact.trapSquare} is trapped`
        : `you missed a trapped ${piece}`;
    case "missed_tactic":
      if (fact.motif === "pin") {
        return `you missed a pin on the ${piece}`;
      }
      if (fact.motif === "skewer") {
        return `you missed a skewer of the ${piece}`;
      }
      if (fact.motif === "fork") {
        return `you missed a fork of the ${piece}`;
      }
      if (fact.motif === "hang") {
        return `you missed that the ${piece} hangs`;
      }
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
 * Flexible aspect container: tone from criticalness; good/bad/neutral bits by topic.
 * Critique: played miss ≠ engine/correct idea — engine gains framed as correct answer.
 */
export function composeMomentJudgmentTip(args: {
  mark: CoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  kind?: string | null;
  explained?: EngineLineExplainResult | null;
  fact?: TacticalFact | null;
  packText?: string | null;
  packNote?: DerivedCoachNote | null;
  packKeyId?: string | null;
  gamePlan?: GamePlanState | null;
  situations?: DetectedSituation[] | null;
  engineLineSans?: string[] | null;
  playedMetricDelta?: MetricFieldDelta[] | null;
  engineVsPlayedMetricDelta?: MetricFieldDelta[] | null;
  priorTopics?: OpeningTipPrior | null;
  coordinate?: TipCoordinate | null;
}): MomentJudgmentTipResult {
  const softKeys: string[] = [];
  const metrics: string[] = [];
  const used = new Set(
    (args.priorTopics?.clauses || []).map((c) =>
      c.toLowerCase().replace(/[^a-z]+/g, "")
    )
  );

  const tone = resolveTipTone({
    mark: args.mark,
    kind: args.kind,
    deltaCp: args.deltaCp,
    dropCp: args.moment?.dropCp,
  });

  const varietyKey =
    args.packKeyId ||
    args.explained?.primaryField ||
    args.moment?.playedSan ||
    args.mark ||
    tone;

  const verdict = toneVerdictLead({
    tone,
    mark: args.mark,
    kind: args.kind,
    varietyKey,
  });

  const localized = args.coordinate
    ? localizeTipCoordinate(args.coordinate)
    : null;
  const factLeads = Boolean(args.fact?.kind);
  const storyLocal = Boolean(localized?.clauses.length);
  const sit = factLeads || localized?.includesContext
    ? { clause: null as string | null, topic: null as string | null, softKeys: [] as string[] }
    : situationFrame(args.situations, args.priorTopics);
  const plan = factLeads || localized?.includesContext
    ? { clause: null as string | null, softKeys: [] as string[] }
    : planFrame(args.gamePlan, args.priorTopics);

  for (const c of localized?.clauses || []) {
    used.add(c.toLowerCase().replace(/[^a-z]+/g, ""));
  }

  const preferFields = args.coordinate?.liveMetrics || null;
  const playedState = storyLocal
    ? { clauses: [] as string[], metrics: [] as string[], softKeys: [] as string[], judgments: [] as ("good" | "bad")[] }
    : topMetricHumanClauses(
        args.playedMetricDelta,
        factLeads ? 1 : 2,
        used,
        preferFields
      );
  const engineGapState = storyLocal
    ? { clauses: [] as string[], metrics: [] as string[], softKeys: [] as string[], judgments: [] as ("good" | "bad")[] }
    : topMetricHumanClauses(
        args.engineVsPlayedMetricDelta,
        2,
        used,
        preferFields
      );

  const tact = tacticalDiagnosis(args.fact);
  const bestSan =
    args.moment?.bestSan ||
    args.explained?.primaryText?.match(/\bPrefer\s+(\S+)/i)?.[1] ||
    null;
  if (
    args.fact?.kind &&
    args.kind === "bad_move" &&
    tone === "critique"
  ) {
    const slotComment = formatTacticalSlotComment({
      note: args.packNote,
      bestSan: bestSan || args.engineLineSans?.[0] || null,
    });
    if (slotComment) {
      return {
        text: slotComment,
        softKeys: [
          ...new Set(
            [args.packKeyId, args.fact.kind ? `motif.${args.fact.kind}` : ""]
              .filter(Boolean)
          ),
        ].slice(0, 6),
        metrics: [],
        clauses: [slotComment],
        topics: [`tone:${tone}`, "tactical-slots"],
      };
    }
  }
  const engineStory = narrateEngineLine({
    fact: args.fact,
    engineLineSans: args.engineLineSans,
    bestSan,
    explained: args.explained,
    factors: args.coordinate?.factors,
    phase: args.coordinate?.phase,
  });
  const playedSan = args.moment?.playedSan || null;
  const contrast = huntIsPlayedContinuation(args.fact)
    ? ""
    : engineVsPlayedClause({
        playedSan,
        bestSan: args.moment?.bestSan,
        engineLineSans: args.engineLineSans,
      });
  const principle = localized?.pillars?.principleLine || "";
  const principleHasBoth =
    Boolean(playedSan) &&
    Boolean(args.moment?.bestSan) &&
    tokenHasSan(principle, String(args.moment?.bestSan)) &&
    tokenHasSan(principle, String(playedSan));
  const lineStory =
    tone === "critique"
      ? factLeads || !principleHasBoth
        ? withInsteadOfPlayed(engineStory || contrast || "", playedSan) ||
          contrast ||
          ""
        : ""
      : factLeads || !principle
        ? engineStory
        : "";

  const why =
    (localized?.clauses.length
      ? localized.clauses.slice(0, 2).join(" and ")
      : "") || reasonProse(args.explained?.reasons || [], 2);

  const packLocal =
    !args.coordinate ||
    packNoteLocalizes(
      args.packNote?.conditions?.map((c) => c.metric || "").filter(Boolean),
      [
        args.packKeyId || "",
        ...(args.packNote?.conditions || [])
          .map((c) => c.softKey || "")
          .filter(Boolean),
      ],
      args.coordinate
    );
  let packCorrect: string | null = null;
  if (packLocal && !storyLocal) {
    packCorrect =
      (tone === "critique"
        ? clauseFromPackNote(args.packNote, "bad") ||
          planFromPackNote(args.packNote) ||
          lessonFromPackNote(args.packNote)
        : tone === "praise"
          ? clauseFromPackNote(args.packNote, "good") ||
            lessonFromPackNote(args.packNote)
          : lessonFromPackNote(args.packNote) ||
            planFromPackNote(args.packNote)) ||
      stripPackToClause(args.packText);
  }

  if (sit.softKeys.length) softKeys.push(...sit.softKeys);
  if (plan.softKeys.length) softKeys.push(...plan.softKeys);
  if (playedState.softKeys.length) softKeys.push(...playedState.softKeys);
  if (engineGapState.softKeys.length) softKeys.push(...engineGapState.softKeys);
  if (localized?.softKeys.length) {
    softKeys.push(...localized.softKeys.slice(0, 3));
  } else if (args.explained?.primarySoftKeys?.length) {
    softKeys.push(...args.explained.primarySoftKeys.slice(0, 2));
  }
  if (args.coordinate?.primarySoftKeys.length) {
    softKeys.push(...args.coordinate.primarySoftKeys.slice(0, 2));
  }
  if (packLocal && args.packKeyId) softKeys.push(args.packKeyId);
  metrics.push(...playedState.metrics, ...engineGapState.metrics);
  if (localized?.metrics.length) metrics.push(...localized.metrics);
  else if (args.coordinate?.liveMetrics.length) {
    metrics.push(...args.coordinate.liveMetrics);
  } else if (args.explained?.primaryField) {
    metrics.push(args.explained.primaryField);
  }

  const aspects: TipAspect[] = [
    {
      polarity:
        tone === "praise" ? "good" : tone === "critique" ? "bad" : "neutral",
      topic: "verdict",
      voice: "verdict",
      text: verdict,
      priority: 100,
    },
  ];

  if (sit.clause) {
    aspects.push({
      polarity: "neutral",
      topic: sit.topic || "situation",
      voice: "context",
      text: sit.clause,
      softKeys: sit.softKeys,
      priority: 12,
    });
  }

  if (tone === "praise") {
    aspects.push({
      polarity: "good",
      topic: "idea",
      voice: "played",
      text: praiseIdeaFromLine({
        fact: args.fact,
        engineLineSans: args.engineLineSans,
        playedSan: args.moment?.playedSan,
        bestSan: args.moment?.bestSan,
        explained: args.explained,
      }),
      priority: 28,
    });
    if (why) {
      aspects.push({
        polarity: "good",
        topic: "why",
        voice: "played",
        text: why,
        priority: 20,
      });
    }
    for (let i = 0; i < playedState.clauses.length; i++) {
      if (playedState.judgments[i] !== "good") continue;
      aspects.push({
        polarity: "good",
        topic: `metric:${playedState.metrics[i] || i}`,
        voice: "played",
        text: playedState.clauses[i]!,
        softKeys: playedState.softKeys[i] ? [playedState.softKeys[i]!] : [],
        priority: 14,
      });
    }
  } else if (tone === "critique") {
    if (tact) {
      aspects.push({
        polarity: "bad",
        topic: args.fact?.kind ? `tact:${args.fact.kind}` : "tactic",
        voice: "played",
        text: tact,
        priority: 32,
      });
    }
    if (why) {
      aspects.push({
        polarity: "bad",
        topic: "why",
        voice: "played",
        text: why,
        priority: 22,
      });
    }
    for (let i = 0; i < playedState.clauses.length; i++) {
      if (playedState.judgments[i] !== "bad") continue;
      aspects.push({
        polarity: "bad",
        topic: `metric:${playedState.metrics[i] || i}`,
        voice: "played",
        text: playedState.clauses[i]!,
        softKeys: playedState.softKeys[i] ? [playedState.softKeys[i]!] : [],
        priority: 18,
      });
    }

    if (lineStory) {
      aspects.push({
        polarity: "neutral",
        topic: "engine_line",
        voice: "correct",
        text: lineStory,
        priority: 34,
      });
    }
    for (let i = 0; i < engineGapState.clauses.length; i++) {
      if (engineGapState.judgments[i] !== "good") continue;
      aspects.push({
        polarity: "neutral",
        topic: `metric:${engineGapState.metrics[i] || i}`,
        voice: "correct",
        text: engineGapState.clauses[i]!,
        softKeys: engineGapState.softKeys[i]
          ? [engineGapState.softKeys[i]!]
          : [],
        priority: 27,
      });
    }
    if (packCorrect) {
      aspects.push({
        polarity: "neutral",
        topic: "continuation",
        voice: "correct",
        text: packCorrect,
        softKeys: args.packKeyId ? [args.packKeyId] : [],
        priority: 30,
      });
    }
  } else {
    if (lineStory && !tact) {
      aspects.push({
        polarity: "neutral",
        topic: "idea",
        voice: "correct",
        text: lineStory.replace(/^prefer\s+/i, ""),
        priority: 18,
      });
    }
    if (why) {
      aspects.push({
        polarity: "neutral",
        topic: "idea",
        text: why,
        priority: 16,
      });
    }
    for (let i = 0; i < playedState.clauses.length; i++) {
      const judgment = playedState.judgments[i]!;
      aspects.push({
        polarity: judgment === "good" ? "good" : "bad",
        topic: `metric:${playedState.metrics[i] || i}`,
        text: playedState.clauses[i]!,
        softKeys: playedState.softKeys[i] ? [playedState.softKeys[i]!] : [],
        priority: judgment === "good" ? 14 : 12,
      });
    }
  }

  if (plan.clause) {
    aspects.push({
      polarity: "neutral",
      topic: "plan",
      voice: tone === "critique" ? "correct" : "context",
      text: plan.clause,
      softKeys: plan.softKeys,
      priority: tone === "neutral" ? 20 : 10,
    });
  }

  if (tone !== "critique" && packCorrect) {
    aspects.push({
      polarity: tone === "praise" ? "good" : "neutral",
      topic: "lesson",
      voice: "lesson",
      text: packCorrect,
      softKeys: args.packKeyId ? [args.packKeyId] : [],
      priority: 8,
    });
  } else if (tone === "critique" && !packCorrect && args.packKeyId && !storyLocal) {
    const fallback = clauseForSoftKey(args.packKeyId, "bad", used);
    if (fallback) {
      aspects.push({
        polarity: "neutral",
        topic: "continuation",
        voice: "correct",
        text: fallback,
        softKeys: [args.packKeyId],
        priority: 24,
      });
    }
  }

  const woven = assembleFromAspects(tone, aspects, {
    priorTopics: args.priorTopics?.topics,
    priorClauses: args.priorTopics?.clauses,
    verdictFallback: verdict,
  });

  let textOut = stripNumericNoise(woven.text);

  if (!textOut || textOut.length < 28) {
    const fallbackAspects: TipAspect[] = [
      {
        polarity:
          tone === "praise" ? "good" : tone === "critique" ? "bad" : "neutral",
        topic: "verdict",
        voice: "verdict",
        text: verdict,
        priority: 100,
      },
      {
        polarity:
          tone === "praise" ? "good" : tone === "critique" ? "bad" : "neutral",
        topic: "fallback",
        voice: tone === "critique" ? "correct" : "played",
        text:
          tone === "praise"
            ? "keep following the clear idea"
            : tone === "critique"
              ? lineStory ||
                packCorrect ||
                why ||
                "compare the played move with the engine idea"
              : plan.clause ||
                "focus on the useful assets and the live plan in this structure",
        priority: 1,
      },
    ];
    textOut = stripNumericNoise(
      assembleFromAspects(tone, fallbackAspects, {
        verdictFallback: verdict,
      }).text
    );
  }

  return {
    text: textOut,
    softKeys: [...new Set([...softKeys, ...woven.softKeys].filter(Boolean))].slice(
      0,
      6
    ),
    metrics: [...new Set(metrics.filter(Boolean))].slice(0, 6),
    clauses: woven.clauses,
    topics: [...new Set([`tone:${tone}`, ...woven.topics])],
  };
}
