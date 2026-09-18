/**
 * Endgame advantage checkpoint — rigid weave:
 * so far (worked) + now (attention) + from here (remember) + optional plan.
 */

import type { OpeningPeerSignal } from "./openingCoachInputs";
import {
  composeSignalCheckpointTip,
  type PackNoteByKey,
} from "./phaseCheckpointTip";
import type { OpeningJudgmentTipResult, OpeningTipPrior } from "./openingJudgmentTip";
import { clauseForSoftKey } from "./metricClauseTemplates";

function egPlanFromInputs(
  inputs?: Record<string, string | number | boolean | null> | null
): string | null {
  if (!inputs) return null;
  const plan =
    typeof inputs.engine_line_plan === "string"
      ? inputs.engine_line_plan.trim()
      : "";
  if (plan) return plan;
  const rule =
    typeof inputs.technical_rule === "string"
      ? inputs.technical_rule.trim()
      : "";
  return rule || null;
}

function buildEndgameCheckpointSignals(
  inputs?: Record<string, string | number | boolean | null> | null
): OpeningPeerSignal[] {
  if (!inputs) return [];
  const out: OpeningPeerSignal[] = [];

  const conversion = String(inputs.conversion_state || "");
  if (conversion === "winning_conversion") {
    out.push({
      metric: "conversion_state",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: 4,
      softKeys: ["piece.simplification", "endgame.strategic.active_king"],
    });
  } else if (conversion === "holding_draw") {
    out.push({
      metric: "conversion_state",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: -3,
      softKeys: ["endgame.strategic.active_king", "piece.simplification"],
    });
  } else if (conversion === "pawn_race") {
    out.push({
      metric: "conversion_state",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: -2,
      softKeys: ["structure.passed_pawn", "endgame.strategic.active_king"],
    });
  }

  const kingMech = String(inputs.vector_king_mechanics || "");
  if (kingMech === "king_leads_pawn") {
    out.push({
      metric: "vector_king_mechanics",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: 3,
      softKeys: ["endgame.strategic.active_king"],
    });
  } else if (
    kingMech === "passive_king" ||
    kingMech === "pawn_advanced_without_king_lead"
  ) {
    out.push({
      metric: "vector_king_mechanics",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: -4,
      softKeys: ["endgame.strategic.active_king"],
    });
  }

  const rook = String(inputs.vector_rook_activity || "");
  if (rook === "seventh_rank_cut_off" || rook === "lucena_bridge") {
    out.push({
      metric: "vector_rook_activity",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: 3,
      softKeys: ["piece.seventh_rank_invasion"],
    });
  } else if (rook === "passive_rook_behind_pawn") {
    out.push({
      metric: "vector_rook_activity",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: -3,
      softKeys: ["piece.seventh_rank_invasion"],
    });
  }

  const simpl = String(inputs.vector_simplification || "");
  if (simpl === "missed_simplification" || simpl === "traded_into_drawn_endgame") {
    out.push({
      metric: "vector_simplification",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: -3,
      softKeys: ["piece.simplification"],
    });
  }

  const shape = String(inputs.theoretical_shape || "");
  if (shape === "lucena") {
    out.push({
      metric: "theoretical_shape",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: 2,
      softKeys: ["endgame.theoretical.lucena"],
    });
  } else if (shape === "philidor") {
    out.push({
      metric: "theoretical_shape",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: -2,
      softKeys: ["endgame.theoretical.philidor"],
    });
  }

  const kc = inputs.king_centralization;
  if (typeof kc === "number" && kc >= 3) {
    out.push({
      metric: "king_centralization",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "good",
      impact: 2,
      softKeys: ["endgame.strategic.active_king"],
    });
  } else if (typeof kc === "number" && kc <= 1) {
    out.push({
      metric: "king_centralization",
      peerDelta: null,
      polarity: "higher_better",
      judgment: "bad",
      impact: -2,
      softKeys: ["endgame.strategic.active_king"],
    });
  }

  return out.sort(
    (a, b) =>
      Math.abs(b.impact) - Math.abs(a.impact) ||
      a.metric.localeCompare(b.metric)
  );
}

function egFallbackWorked(
  inputs?: Record<string, string | number | boolean | null> | null
): string | null {
  const type = String(inputs?.endgame_type || "").replace(/_/g, " ");
  const conversion = String(inputs?.conversion_state || "").replace(/_/g, " ");
  if (type) {
    return conversion
      ? `you reached a ${type} (${conversion})`
      : `you reached a ${type}`;
  }
  return "you entered a technical ending";
}

function egFallbackAttention(
  inputs?: Record<string, string | number | boolean | null> | null
): string | null {
  const err = String(inputs?.played_move_error || "");
  if (err === "pawn_move_before_king_activation") {
    return "the king must lead before further pawn pushes";
  }
  if (err === "missed_opposition" || err === "passive_rook") {
    return clauseForSoftKey("endgame.strategic.active_king", "bad") ||
      "king and rook activity still decide the conversion";
  }
  if (err === "missed_simplification") {
    return "a clean simplification into a known win is still available";
  }
  return "king activity and accurate conversion technique need attention";
}

export function composeEndgameJudgmentTipDetailed(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packByKey?: PackNoteByKey | null;
  priorTopics?: OpeningTipPrior | null;
}): OpeningJudgmentTipResult {
  return composeSignalCheckpointTip({
    phase: "endgame",
    signals: buildEndgameCheckpointSignals(args.inputs),
    packByKey: args.packByKey,
    priorTopics: args.priorTopics,
    plan: egPlanFromInputs(args.inputs),
    fallbackWorked: egFallbackWorked(args.inputs),
    fallbackAttention: egFallbackAttention(args.inputs),
    inputs: args.inputs,
  });
}

export function composeEndgameJudgmentTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packByKey?: PackNoteByKey | null;
  priorTopics?: OpeningTipPrior | null;
}): string {
  return composeEndgameJudgmentTipDetailed(args).text;
}
