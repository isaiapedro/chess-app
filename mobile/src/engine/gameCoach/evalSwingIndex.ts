/**
 * Deterministic eval-band + swing index for checkpoints and last-move summary.
 * User-POV win probability drives winning/losing tone; ply WP series drives swing prose.
 */

import {
  classifyEvalDrop,
  userWinProbability,
  wpDropPp,
  WP_DISADVANTAGE,
  WP_ENDGAME_ADVANTAGE,
} from "../winProb";

/** Extreme bands flip checkpoint tone/plans; milder bands only lighten wording. */
export type CheckpointEvalBand =
  | "winning"
  | "better"
  | "equal"
  | "worse"
  | "losing"
  | "unknown";

export type EvalSwingKind =
  | "crash"
  | "blunder_drop"
  | "mistake_drop"
  | "surge"
  | "recovery";

export type EvalSwingEvent = {
  ply: number;
  moveNumber: number;
  kind: EvalSwingKind;
  wpBefore: number;
  wpAfter: number;
  /** Positive = user got worse (WP drop). */
  dropPp: number;
};

export type EvalSwingIndex = {
  events: EvalSwingEvent[];
  peakWp: number | null;
  troughWp: number | null;
  finalWp: number | null;
  finalBand: CheckpointEvalBand;
  largestCrash: EvalSwingEvent | null;
  largestSurge: EvalSwingEvent | null;
  swingCount: number;
};

const WP_WINNING = 0.85;
const WP_BETTER = Math.max(0.62, WP_ENDGAME_ADVANTAGE - 0.05);
const WP_LOSING = 0.15;
const WP_WORSE = Math.min(0.38, WP_DISADVANTAGE + 0.15);

export function classifyCheckpointEvalBand(
  userWp: number | null | undefined
): CheckpointEvalBand {
  if (userWp == null || !Number.isFinite(userWp)) return "unknown";
  if (userWp >= WP_WINNING) return "winning";
  if (userWp >= WP_BETTER) return "better";
  if (userWp <= WP_LOSING) return "losing";
  if (userWp <= WP_WORSE) return "worse";
  return "equal";
}

export function isDecisiveEvalBand(band: CheckpointEvalBand): boolean {
  return band === "winning" || band === "losing";
}

/** White-cp series index after ply1 (evals[0]=start). */
export function whiteCpAtPly1(
  evalsWhiteCp: readonly number[] | null | undefined,
  ply1: number
): number | null {
  if (!evalsWhiteCp?.length || ply1 < 0) return null;
  const idx = Math.min(Math.max(0, ply1), evalsWhiteCp.length - 1);
  const cp = evalsWhiteCp[idx];
  return cp != null && Number.isFinite(cp) ? cp : null;
}

export function userWpFromWhiteCp(
  cpWhite: number | null | undefined,
  userIsWhite: boolean
): number | null {
  if (cpWhite == null || !Number.isFinite(cpWhite)) return null;
  return Math.round(userWinProbability(cpWhite, userIsWhite) * 1000) / 1000;
}

/** Stamp for structural moment / request inputs. */
export function checkpointEvalInputs(args: {
  evalCpWhite?: number | null;
  userWp?: number | null;
  userIsWhite: boolean;
}): Record<string, string | number | boolean | null> {
  const cp =
    args.evalCpWhite != null && Number.isFinite(args.evalCpWhite)
      ? args.evalCpWhite
      : null;
  const wp =
    args.userWp != null && Number.isFinite(args.userWp)
      ? args.userWp
      : userWpFromWhiteCp(cp, args.userIsWhite);
  const band = classifyCheckpointEvalBand(wp);
  return {
    eval_cp: cp,
    user_wp: wp,
    eval_band: band === "unknown" ? null : band,
  };
}

export function evalBandFromInputs(
  inputs?: Record<string, string | number | boolean | null> | null
): CheckpointEvalBand {
  if (!inputs) return "unknown";
  const raw = inputs.eval_band;
  let band: CheckpointEvalBand = "unknown";
  if (
    raw === "winning" ||
    raw === "better" ||
    raw === "equal" ||
    raw === "worse" ||
    raw === "losing"
  ) {
    band = raw;
  } else {
    const wp =
      typeof inputs.user_wp === "number"
        ? inputs.user_wp
        : typeof inputs.best_line_wp === "number"
          ? inputs.best_line_wp
          : null;
    band = classifyCheckpointEvalBand(wp);
  }
  if (band === "equal" || band === "unknown") {
    const mat = inputs.material_balance;
    if (typeof mat === "number" && mat >= 3) return "better";
    if (
      inputs.had_endgame_advantage === true ||
      inputs.had_endgame_advantage === 1
    ) {
      return "winning";
    }
    const bestWp =
      typeof inputs.best_line_wp === "number" ? inputs.best_line_wp : null;
    const lifted = classifyCheckpointEvalBand(bestWp);
    if (lifted === "winning" || lifted === "better") return lifted;
  }
  return band;
}

/**
 * Checkpoint tone/plan overlay from eval band.
 * Completely winning/losing flips plan; milder bands only light lead color.
 */
export function checkpointEvalOverlay(
  band: CheckpointEvalBand,
  phase: "opening" | "middlegame" | "endgame"
): {
  leadPrefix: string | null;
  plan: string | null;
  attentionFallback: string | null;
  lessonHint: string | null;
} {
  if (band === "winning") {
    return {
      leadPrefix:
        phase === "opening"
          ? "You're clearly winning already"
          : phase === "middlegame"
            ? "So far you're clearly winning"
            : "You're clearly winning into the ending",
      plan:
        phase === "endgame"
          ? "simplify into a technical win and avoid unnecessary pawn races"
          : "trade into a clean conversion and deny counterplay",
      attentionFallback:
        "the job is clean conversion without allowing counterplay",
      lessonHint: "converting the advantage without giving them practical chances",
    };
  }
  if (band === "losing") {
    return {
      leadPrefix:
        phase === "opening"
          ? "The opening already looks lost on the engine"
          : phase === "middlegame"
            ? "So far the position is lost on the engine"
            : "The ending is lost on the engine",
      plan:
        phase === "endgame"
          ? "create practical chances and force them to prove the win"
          : "complicate, keep pieces on, and make them prove the win",
      attentionFallback:
        "practical resistance and forcing them to find accurate wins",
      lessonHint: "creating practical chances instead of cooperating with the conversion",
    };
  }
  if (band === "better") {
    return {
      leadPrefix: null,
      plan:
        phase === "endgame"
          ? "keep converting without rushing pawns"
          : "press the edge without allowing a clean equaliser",
      attentionFallback: null,
      lessonHint: null,
    };
  }
  if (band === "worse") {
    return {
      leadPrefix: null,
      plan: "stay solid and look for the first chance to muddy the game",
      attentionFallback: null,
      lessonHint: null,
    };
  }
  return {
    leadPrefix: null,
    plan: null,
    attentionFallback: null,
    lessonHint: null,
  };
}

function swingKindFromDrop(dropPp: number): EvalSwingKind | null {
  if (dropPp >= 20) return "crash";
  if (dropPp >= 10) return "blunder_drop";
  if (dropPp >= 5) return "mistake_drop";
  if (dropPp <= -20) return "surge";
  if (dropPp <= -10) return "recovery";
  return null;
}

export type EvalSwingPly = {
  ply?: number;
  side: "white" | "black";
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
  deltaCp?: number | null;
};

/**
 * Build swing index from analyzed plies (user moves only).
 * Deterministic — same plies → same events/prose.
 */
export function buildEvalSwingIndex(args: {
  plies: EvalSwingPly[];
  userColor: "white" | "black";
}): EvalSwingIndex {
  const userIsWhite = args.userColor === "white";
  const events: EvalSwingEvent[] = [];
  let peakWp: number | null = null;
  let troughWp: number | null = null;
  let finalWp: number | null = null;

  for (const p of args.plies) {
    if (p.side !== args.userColor) continue;
    const before = p.evalBeforeCp;
    const after = p.evalAfterCp;
    if (
      before == null ||
      after == null ||
      !Number.isFinite(before) ||
      !Number.isFinite(after)
    ) {
      continue;
    }
    const wpBefore = userWinProbability(before, userIsWhite);
    const wpAfter = userWinProbability(after, userIsWhite);
    finalWp = Math.round(wpAfter * 1000) / 1000;
    peakWp =
      peakWp == null ? finalWp : Math.max(peakWp, finalWp);
    troughWp =
      troughWp == null ? finalWp : Math.min(troughWp, finalWp);

    const dropPp = wpDropPp(wpBefore, wpAfter);
    const kind = swingKindFromDrop(dropPp);
    if (!kind) continue;
    const ply = p.ply || 0;
    events.push({
      ply,
      moveNumber: ply > 0 ? Math.ceil(ply / 2) : 0,
      kind,
      wpBefore: Math.round(wpBefore * 1000) / 1000,
      wpAfter: finalWp,
      dropPp,
    });
  }

  let largestCrash: EvalSwingEvent | null = null;
  let largestSurge: EvalSwingEvent | null = null;
  for (const e of events) {
    if (e.dropPp > 0) {
      if (!largestCrash || e.dropPp > largestCrash.dropPp) largestCrash = e;
    } else if (e.dropPp < 0) {
      if (!largestSurge || e.dropPp < largestSurge.dropPp) largestSurge = e;
    }
  }

  return {
    events,
    peakWp,
    troughWp,
    finalWp,
    finalBand: classifyCheckpointEvalBand(finalWp),
    largestCrash,
    largestSurge,
    swingCount: events.filter(
      (e) => e.kind === "crash" || e.kind === "surge" || e.kind === "blunder_drop"
    ).length,
  };
}

/** Last-move summary prose from the swing index. */
export function formatEvalSwingSummary(index: EvalSwingIndex): string {
  const bits: string[] = [];
  if (index.largestCrash) {
    const m = index.largestCrash.moveNumber || "?";
    bits.push(`the biggest swing against you came around move ${m}`);
  }
  if (index.largestSurge) {
    const m = index.largestSurge.moveNumber || "?";
    bits.push(`you recovered around move ${m}`);
  }
  if (index.finalWp != null) {
    const band = index.finalBand;
    const bandBit =
      band === "winning"
        ? "you finished clearly winning"
        : band === "losing"
          ? "you finished clearly losing"
          : band === "better"
            ? "you finished better"
            : band === "worse"
              ? "you finished worse"
              : "you finished roughly equal";
    bits.push(bandBit);
  }
  if (!bits.length) return "";
  const head = bits[0] || "";
  const rest = bits.slice(1);
  const text = rest.length
    ? `${head.charAt(0).toUpperCase()}${head.slice(1)}. ${rest.join(". ")}`
    : `${head.charAt(0).toUpperCase()}${head.slice(1)}`;
  return text.endsWith(".") ? text : `${text}.`;
}

/** @deprecated classify path kept for callers that only need drop kind. */
export function swingDropKind(wpBefore: number, wpAfter: number) {
  return classifyEvalDrop(wpBefore, wpAfter);
}
