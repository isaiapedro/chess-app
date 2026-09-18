/**
 * Middlegame aggregate checkpoint — rigid weave:
 * so far (worked) + now (attention) + going forward (remember) + optional plan.
 */

import {
  composeSignalCheckpointTip,
  type PackNoteByKey,
} from "./phaseCheckpointTip";
import type { OpeningJudgmentTipResult, OpeningTipPrior } from "./openingJudgmentTip";
import { buildMiddlegamePeerSignals } from "./middlegameCoachInputs";
import type { DerivedCoachNote } from "./derivedCoachPack";

function mgPlanFromInputs(
  inputs?: Record<string, string | number | boolean | null> | null
): string | null {
  if (!inputs) return null;
  const plan =
    typeof inputs.engine_line_plan === "string"
      ? inputs.engine_line_plan.trim()
      : "";
  if (plan) return plan;
  const impact =
    typeof inputs.played_impact === "string" ? inputs.played_impact.trim() : "";
  if (impact && /plan is|queenside|kingside|centre|center/i.test(impact)) {
    return impact;
  }
  return null;
}

function mgFallbackWorked(
  inputs?: Record<string, string | number | boolean | null> | null
): string | null {
  const type = String(inputs?.mg_structure_type || "").replace(/_/g, " ");
  if (type && type !== "unclear") {
    return `you settled into a ${type}`;
  }
  if (inputs?.middlegame_pawn_breaks) {
    return "you found useful pawn breaks";
  }
  return "the middlegame structure is taking shape";
}

function mgFallbackAttention(
  inputs?: Record<string, string | number | boolean | null> | null
): string | null {
  const br = String(inputs?.pawn_break_class || "");
  if (br === "wrong_center_break" || br === "wrong_wing_break") {
    return "the wing break still needs aligning with the structure";
  }
  if (br === "thematic_wing_break") {
    return "the lever fits the structure even if another idea was available";
  }
  if (br === "passive_move") {
    return "the thematic pawn break still waits to be prepared";
  }
  const wing = String(inputs?.active_wing_user || "");
  if (wing === "queenside" || wing === "kingside" || wing === "center") {
    return `the ${wing} plan needs concrete pawn and piece support`;
  }
  return "piece activity and the next pawn break need attention";
}

export function composeMiddlegameJudgmentTipDetailed(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packByKey?: PackNoteByKey | null;
  priorTopics?: OpeningTipPrior | null;
}): OpeningJudgmentTipResult {
  const signals = buildMiddlegamePeerSignals(args.inputs);
  return composeSignalCheckpointTip({
    phase: "middlegame",
    signals,
    packByKey: args.packByKey,
    priorTopics: args.priorTopics,
    plan: mgPlanFromInputs(args.inputs),
    fallbackWorked: mgFallbackWorked(args.inputs),
    fallbackAttention: mgFallbackAttention(args.inputs),
    inputs: args.inputs,
  });
}

export function composeMiddlegameJudgmentTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packByKey?: PackNoteByKey | null;
  priorTopics?: OpeningTipPrior | null;
}): string {
  return composeMiddlegameJudgmentTipDetailed(args).text;
}

/** Attach primary pack note into packByKey for checkpoint weave. */
export function withPackNote(
  packByKey: PackNoteByKey | null | undefined,
  keyId: string | null | undefined,
  note: DerivedCoachNote | null | undefined
): PackNoteByKey {
  const out = { ...(packByKey || {}) };
  if (keyId && note) {
    out[keyId] = note;
  }
  return out;
}
