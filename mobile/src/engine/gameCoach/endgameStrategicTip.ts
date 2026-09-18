/**
 * EG strategic tip — flexible aspects: technique assets / errors / plans by tone.
 * Engine plan = correct answer on critique — never narrated as played fact.
 */

import { type OpeningTipPrior } from "./openingJudgmentTip";
import type { DerivedCoachNote } from "./derivedCoachPack";
import {
  clauseFromPackNote,
  lessonFromPackNote,
  planFromPackNote,
} from "./packNoteContent";
import { clauseForSoftKey } from "./metricClauseTemplates";
import { softKeysFromEndgameContext } from "./endgameContext";
import {
  assembleFromAspects,
  strategicToneFromInputs,
  toneVerdictLead,
  type TipAspect,
  type TipTone,
} from "./tipAspectAssemble";

export type StrategicTipResult = {
  text: string;
  softKeys: string[];
  metrics: string[];
  clauses: string[];
  topics: string[];
};

function dedupeKey(clause: string): string {
  return clause.toLowerCase().replace(/[^a-z]+/g, "");
}

function egTone(
  inputs: Record<string, string | number | boolean | null>
): TipTone {
  const base = strategicToneFromInputs(inputs);
  if (base !== "neutral") return base;
  const err = String(inputs.played_move_error || "");
  if (err) return "critique";
  return "neutral";
}

export function composeEndgameStrategicTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packClause?: string | null;
  packNote?: DerivedCoachNote | null;
  packKeyId?: string | null;
  priorTopics?: OpeningTipPrior | null;
}): StrategicTipResult {
  const inputs = args.inputs || {};
  const used = new Set(
    (args.priorTopics?.clauses || []).map(dedupeKey).filter(Boolean)
  );
  const softKeys = softKeysFromEndgameContext(inputs);
  if (args.packKeyId) softKeys.unshift(args.packKeyId);

  const tone = egTone(inputs);
  const verdict = toneVerdictLead({
    tone,
    varietyKey:
      args.packKeyId ||
      String(inputs.played_move_error || inputs.endgame_type || tone),
  });
  const impact =
    typeof inputs.played_impact === "string"
      ? inputs.played_impact.trim()
      : "";
  const rule =
    typeof inputs.technical_rule === "string"
      ? inputs.technical_rule.trim()
      : "";
  const plan =
    typeof inputs.engine_line_plan === "string"
      ? inputs.engine_line_plan.trim()
      : "";
  const summary =
    typeof inputs.strategic_summary === "string"
      ? inputs.strategic_summary.trim()
      : "";

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

  if (impact) {
    aspects.push({
      polarity:
        tone === "praise" ? "good" : tone === "critique" ? "bad" : "neutral",
      topic: "impact",
      voice: "played",
      text: impact,
      priority: 26,
    });
  } else if (summary) {
    const first = summary.split(/(?<=[.!?])\s+/)[0] || summary;
    aspects.push({
      polarity: "neutral",
      topic: "context",
      voice: "context",
      text: first,
      priority: 18,
    });
  }

  if (plan) {
    aspects.push({
      polarity: tone === "critique" ? "neutral" : "good",
      topic: tone === "critique" ? "continuation" : "plan",
      voice: tone === "critique" ? "correct" : "context",
      text: plan,
      priority: 24,
    });
  }

  if (rule && (!impact || !impact.includes(rule))) {
    aspects.push({
      polarity: "neutral",
      topic: "idea",
      voice: tone === "critique" ? "correct" : "context",
      text: rule,
      priority: 14,
    });
  }

  const packCorrect =
    (tone === "critique"
      ? clauseFromPackNote(args.packNote, "bad") ||
        planFromPackNote(args.packNote) ||
        lessonFromPackNote(args.packNote)
      : lessonFromPackNote(args.packNote) ||
        clauseFromPackNote(args.packNote, "good")) ||
    clauseForSoftKey(
      softKeys[0] || "endgame.strategic.active_king",
      tone === "critique" ? "bad" : "good",
      used
    );

  if (packCorrect) {
    aspects.push({
      polarity: tone === "praise" ? "good" : "neutral",
      topic: tone === "critique" ? "continuation" : "lesson",
      voice: tone === "critique" ? "correct" : "lesson",
      text: packCorrect,
      softKeys: args.packKeyId ? [args.packKeyId] : [],
      priority: tone === "critique" ? 26 : 8,
    });
  }

  const woven = assembleFromAspects(tone, aspects, {
    priorTopics: args.priorTopics?.topics,
    priorClauses: args.priorTopics?.clauses,
    verdictFallback: verdict,
  });

  const text = woven.text
    .replace(/\b\d+\s*cp\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    text,
    softKeys: [...new Set([...softKeys, ...woven.softKeys].filter(Boolean))].slice(
      0,
      4
    ),
    metrics: [
      typeof inputs.endgame_type === "string" ? inputs.endgame_type : "",
      typeof inputs.conversion_state === "string"
        ? inputs.conversion_state
        : "",
    ].filter(Boolean),
    clauses: woven.clauses,
    topics: [...new Set([`tone:${tone}`, "eg_strategic", ...woven.topics])],
  };
}

export function hasEndgameStrategicLead(
  inputs?: Record<string, string | number | boolean | null> | null
): boolean {
  if (!inputs) return false;
  return Boolean(
    inputs.strategic_summary ||
      inputs.technical_rule ||
      inputs.endgame_type
  );
}
