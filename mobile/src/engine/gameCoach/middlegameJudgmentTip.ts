/**
 * Middlegame peer judgment tip — same weave as opening (praise + nudge + pack).
 */

import {
  composeOpeningJudgmentTipDetailed,
  type OpeningJudgmentTipResult,
  type OpeningTipPrior,
} from "./openingJudgmentTip";
import { buildMiddlegamePeerSignals } from "./middlegameCoachInputs";

export function composeMiddlegameJudgmentTipDetailed(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packByKey?: Record<string, string> | null;
  priorTopics?: OpeningTipPrior | null;
}): OpeningJudgmentTipResult {
  return composeOpeningJudgmentTipDetailed({
    inputs: args.inputs,
    packByKey: args.packByKey,
    priorTopics: args.priorTopics,
    signals: buildMiddlegamePeerSignals(args.inputs),
  });
}

export function composeMiddlegameJudgmentTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packByKey?: Record<string, string> | null;
  priorTopics?: OpeningTipPrior | null;
}): string {
  return composeMiddlegameJudgmentTipDetailed(args).text;
}
