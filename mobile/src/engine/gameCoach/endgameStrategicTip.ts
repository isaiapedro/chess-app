/**
 * Tip lead from stamped EG strategic_summary + technical_rule.
 */

import { stripPackToClause } from "./openingJudgmentTip";

export function composeEndgameStrategicTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  packClause?: string | null;
}): string {
  const inputs = args.inputs || {};
  const summary =
    typeof inputs.strategic_summary === "string"
      ? inputs.strategic_summary.trim()
      : "";
  const rule =
    typeof inputs.technical_rule === "string"
      ? inputs.technical_rule.trim()
      : "";
  const pack = args.packClause
    ? stripPackToClause(args.packClause)
    : null;
  const parts = [
    summary,
    rule && !summary.includes(rule) ? rule : null,
    pack,
  ]
    .filter(Boolean)
    .map((s) => String(s).replace(/\s+/g, " ").trim());
  return parts
    .join(" ")
    .replace(/\b\d+\s*cp\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
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
