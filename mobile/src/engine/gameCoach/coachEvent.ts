import type { CoachMark } from "./coachMarkClassify";
import type { TacticalFact } from "./tacticalFact";

export const CHECKPOINT_KINDS = [
  "opening_name",
  "opening_aggregate",
  "middlegame_aggregate",
  "endgame_advantage",
  "decisive_pawn_break",
] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export type CoachEvent =
  | {
      tier: 1;
      kind: "tactical_blunder";
      tacticalKind: string;
      dropCp: number;
    }
  | {
      tier: 2;
      kind: "positional_error";
      primaryField: string;
      dropCp: number;
    }
  | {
      tier: 3;
      kind: "fixed_checkpoint";
      structuralKind: CheckpointKind;
    }
  | {
      tier: 4;
      kind: "praise";
      praiseKind: "brilliant" | "great_find";
    };

export type CoachEventKind = CoachEvent["kind"];

const CHECKPOINT_SET = new Set<string>(CHECKPOINT_KINDS);

export function classifyMoment(args: {
  mark?: CoachMark | string | null;
  dropCp?: number;
  tacticalFact?: TacticalFact | null;
  structuralKind?: string | null;
  praiseMark?: string | null;
  primaryField?: string | null;
}): CoachEvent | null {
  const mark = String(args.mark || "");
  const praise = String(args.praiseMark || mark || "");
  const dropCp = Math.max(0, Math.round(Number(args.dropCp) || 0));
  const tacticalKind = args.tacticalFact?.kind || null;
  const structural = String(args.structuralKind || "");
  const muteError = mark === "inaccuracy" || mark === "important";

  if (
    !muteError &&
    (tacticalKind || mark === "blunder" || mark === "missed" || dropCp >= 200)
  ) {
    return {
      tier: 1,
      kind: "tactical_blunder",
      tacticalKind: tacticalKind || "blunder",
      dropCp,
    };
  }

  if (!muteError && (mark === "mistake" || dropCp >= 100)) {
    return {
      tier: 2,
      kind: "positional_error",
      primaryField: args.primaryField || "structure",
      dropCp,
    };
  }

  if (CHECKPOINT_SET.has(structural)) {
    return {
      tier: 3,
      kind: "fixed_checkpoint",
      structuralKind: structural as CheckpointKind,
    };
  }

  if (praise === "brilliant" || mark === "brilliant") {
    return { tier: 4, kind: "praise", praiseKind: "brilliant" };
  }
  if (praise === "excellent" || mark === "excellent") {
    return { tier: 4, kind: "praise", praiseKind: "great_find" };
  }

  return null;
}
