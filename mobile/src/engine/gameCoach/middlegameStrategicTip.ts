/**
 * Tip lead from stamped MG strategic_summary / pawn_break_class.
 */

import { stripPackToClause } from "./openingJudgmentTip";

export function composeMiddlegameStrategicTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packClause?: string | null;
}): string {
  const inputs = args.inputs || {};
  const summary =
    typeof inputs.strategic_summary === "string"
      ? inputs.strategic_summary.trim()
      : "";
  const impact =
    typeof inputs.played_impact === "string" ? inputs.played_impact.trim() : "";
  const plan =
    typeof inputs.engine_line_plan === "string"
      ? inputs.engine_line_plan.trim()
      : "";
  const lead = summary || impact;
  const pack = args.packClause
    ? stripPackToClause(args.packClause)
    : null;
  const parts = [lead, plan && lead !== plan ? `Just remember: ${plan}` : null, pack]
    .filter(Boolean)
    .map((s) => String(s).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const text = parts.join(" ").slice(0, 420);
  return text.replace(/\b\d+\s*cp\b/gi, "").replace(/\s+/g, " ").trim();
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
