/**
 * MG strategic tip — flexible good/bad/neutral aspects by break/plan tone.
 * Engine plan / pack = correct answer on critique — never narrated as played fact.
 */

import { type OpeningTipPrior } from "./openingJudgmentTip";
import type { DerivedCoachNote } from "./derivedCoachPack";
import {
  clauseFromPackNote,
  lessonFromPackNote,
  planFromPackNote,
} from "./packNoteContent";
import {
  clauseForBreakClass,
  clauseForSoftKey,
} from "./metricClauseTemplates";
import { softKeysFromMgStructure } from "./middlegameStructure";
import {
  assembleFromAspects,
  strategicToneFromInputs,
  toneVerdictLead,
  type TipAspect,
} from "./tipAspectAssemble";
import type { CoachMark } from "./coachMarks";

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

export function composeMiddlegameStrategicTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packClause?: string | null;
  packNote?: DerivedCoachNote | null;
  packKeyId?: string | null;
  priorTopics?: OpeningTipPrior | null;
  mark?: string | null;
}): StrategicTipResult {
  const inputs = args.inputs || {};
  const used = new Set(
    (args.priorTopics?.clauses || []).map(dedupeKey).filter(Boolean)
  );
  const softKeys = softKeysFromMgStructure(inputs);
  if (args.packKeyId) softKeys.unshift(args.packKeyId);

  const tone = strategicToneFromInputs(inputs, args.mark);
  const verdict = toneVerdictLead({
    tone,
    mark: args.mark as CoachMark | null | undefined,
    kind: "structural_moment",
    varietyKey:
      args.packKeyId ||
      String(inputs.pawn_break_class || inputs.active_wing_user || tone),
  });
  const impact =
    typeof inputs.played_impact === "string"
      ? inputs.played_impact.trim()
      : "";
  const plan =
    typeof inputs.engine_line_plan === "string"
      ? inputs.engine_line_plan.trim()
      : "";
  const summary =
    typeof inputs.strategic_summary === "string"
      ? inputs.strategic_summary.trim()
      : "";
  const breakClass =
    typeof inputs.pawn_break_class === "string"
      ? inputs.pawn_break_class
      : null;

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

  const playedLead =
    /^Played\s+\S+\s+instead of\s+\S+/i.test(summary)
      ? summary.match(/^Played\s+\S+\s+instead of\s+\S+[.]?/i)?.[0] || null
      : null;

  if (tone === "critique" && playedLead) {
    aspects.push({
      polarity: "bad",
      topic: "severity",
      voice: "played",
      text: playedLead.replace(/\.$/, ""),
      priority: 28,
    });
  }

  if (impact) {
    aspects.push({
      polarity:
        tone === "praise" ? "good" : tone === "critique" ? "bad" : "neutral",
      topic: breakClass ? `break:${breakClass}` : "impact",
      voice: tone === "critique" ? "played" : "played",
      text: impact,
      priority: 26,
    });
  }

  if (plan) {
    aspects.push({
      polarity: tone === "praise" ? "good" : "neutral",
      topic: tone === "critique" ? "continuation" : "plan",
      voice: tone === "critique" ? "correct" : "context",
      text: plan,
      priority: tone === "critique" ? 32 : tone === "neutral" ? 24 : 16,
    });
  }

  if (tone === "critique" && playedLead && summary.includes("instead of")) {
    const better = summary.match(/instead of\s+(\S+)/i)?.[1];
    if (better) {
      aspects.push({
        polarity: "neutral",
        topic: "continuation",
        voice: "correct",
        text: better.replace(/[.,]$/, ""),
        priority: 34,
      });
    }
  }

  if (tone === "praise" && !impact) {
    aspects.push({
      polarity: "good",
      topic: "idea",
      voice: "played",
      text: plan || "the wing break opens useful lines for your pieces",
      priority: 22,
    });
  }

  if (tone === "neutral" && !impact && summary) {
    const cleaned = summary
      .replace(/\bPlan:\s*[a-z_]+.*/i, "")
      .replace(/^Played\s+\S+\s+instead of\s+\S+[.]?\s*/i, "")
      .trim();
    if (cleaned) {
      aspects.push({
        polarity: "neutral",
        topic: "context",
        voice: "context",
        text: cleaned,
        priority: 18,
      });
    }
  }

  const packCorrect =
    (tone === "critique"
      ? clauseFromPackNote(args.packNote, "bad") ||
        planFromPackNote(args.packNote) ||
        lessonFromPackNote(args.packNote)
      : tone === "praise"
        ? clauseFromPackNote(args.packNote, "good") ||
          lessonFromPackNote(args.packNote)
        : lessonFromPackNote(args.packNote)) ||
    (tone === "critique"
      ? clauseForBreakClass(breakClass, used) ||
        clauseForSoftKey(softKeys[0] || "positional.pawn_break", "bad", used)
      : tone === "praise"
        ? clauseForSoftKey(softKeys[0] || "positional.pawn_break", "good", used)
        : clauseForSoftKey(
            softKeys[0] || "imbalance.space",
            "good",
            used
          ) || clauseForBreakClass(breakClass, used));

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
      typeof inputs.mg_structure_type === "string"
        ? inputs.mg_structure_type
        : "",
      typeof inputs.pawn_break_class === "string"
        ? inputs.pawn_break_class
        : "",
    ].filter(Boolean),
    clauses: woven.clauses,
    topics: [...new Set([`tone:${tone}`, "mg_strategic", ...woven.topics])],
  };
}

export function hasMiddlegameStrategicLead(
  inputs?: Record<string, string | number | boolean | null> | null
): boolean {
  if (!inputs) return false;
  return Boolean(
    inputs.strategic_summary ||
      inputs.pawn_break_class ||
      inputs.mg_structure_type
  );
}
