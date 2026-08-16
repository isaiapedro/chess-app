/**
 * Comment reference surface: top pack choices for a tip + only coach-moment
 * fields the tip actually references (drop unmentioned dumps).
 */

import { metricKeyLabel } from "./metricThemes";
import type { DetectedSituation } from "./situationProfiles";
import type { TacticalFact } from "./tacticalFact";
import type { CheckpointEvalBand } from "./evalSwingIndex";

export type CommentTopChoice = {
  keyId: string;
  weight: number;
  selected: boolean;
  parts?: string;
};

export type CommentRefs = {
  /** Ranked pack soft keys that competed for this comment. */
  topChoices: CommentTopChoice[];
  /** Soft keys stamped on / woven into the tip. */
  softKeys: string[];
  evalBand?: CheckpointEvalBand | null;
  userWp?: number | null;
  situations: string[];
  tactical?: string | null;
  gamePlan?: string | null;
  primaryField?: string | null;
  metrics: string[];
  topics: string[];
};

export type TipMetaBits = {
  softKeys?: readonly string[] | null;
  metrics?: readonly string[] | null;
  clauses?: readonly string[] | null;
  topics?: readonly string[] | null;
};

function tipHaystack(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9%.\s_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentions(hay: string, needle: string): boolean {
  const n = String(needle || "")
    .toLowerCase()
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.length < 3) return false;
  if (hay.includes(n)) return true;
  const compact = n.replace(/\s+/g, "");
  return compact.length >= 4 && hay.replace(/\s+/g, "").includes(compact);
}

function softKeyMentioned(hay: string, keyId: string): boolean {
  if (!keyId) return false;
  if (hay.includes(keyId.toLowerCase())) return true;
  const label = metricKeyLabel(keyId);
  return Boolean(label && mentions(hay, label));
}

const EVAL_WORDS: Record<string, string[]> = {
  winning: ["winning", "clearly winning", "convert", "conversion", "technical win"],
  losing: ["lost", "losing", "practical chances", "prove the win", "complicate"],
  better: ["clearly better", "press the edge"],
  worse: ["muddy the game", "stay solid"],
};

/**
 * Build topChoices + filtered refs from tip text / tipMeta / weight board.
 * Anything not selected and not mentioned in the tip is dropped.
 */
export function buildCommentRefs(args: {
  tipText: string;
  keyIds?: readonly string[] | null;
  tipMeta?: TipMetaBits | null;
  weightTop?: Array<{
    keyId: string;
    weight: number;
    formatted?: string;
    parts?: unknown;
  }> | null;
  softKeysPool?: readonly string[] | null;
  inputs?: Record<string, string | number | boolean | null> | null;
  situations?: DetectedSituation[] | null;
  tacticalFact?: TacticalFact | null;
  primaryField?: string | null;
  primarySoftKeys?: readonly string[] | null;
  limitChoices?: number;
}): CommentRefs {
  const hay = tipHaystack(args.tipText);
  const selected = new Set(
    (args.keyIds || []).filter(Boolean).map(String)
  );
  const wovenSoft = new Set(
    (args.tipMeta?.softKeys || []).filter(Boolean).map(String)
  );
  for (const k of selected) wovenSoft.add(k);

  const limit = args.limitChoices ?? 5;
  const topChoices: CommentTopChoice[] = (args.weightTop || [])
    .slice(0, Math.max(limit, selected.size + 2))
    .map((w) => ({
      keyId: w.keyId,
      weight: w.weight,
      selected: selected.has(w.keyId),
      parts: w.formatted,
    }));

  // Ensure selected keys appear even if outside weightTop cap.
  for (const id of selected) {
    if (!topChoices.some((c) => c.keyId === id)) {
      topChoices.unshift({
        keyId: id,
        weight: 0,
        selected: true,
      });
    }
  }

  const softKeys: string[] = [];
  const softSeen = new Set<string>();
  const pushSoft = (k: string | null | undefined) => {
    if (!k || softSeen.has(k)) return;
    softSeen.add(k);
    softKeys.push(k);
  };
  for (const k of selected) pushSoft(k);
  for (const k of wovenSoft) {
    if (selected.has(k) || softKeyMentioned(hay, k)) pushSoft(k);
  }
  for (const k of args.primarySoftKeys || []) {
    if (softKeyMentioned(hay, k) || wovenSoft.has(k)) pushSoft(k);
  }
  for (const k of args.softKeysPool || []) {
    if (softKeyMentioned(hay, k) && softKeys.length < 6) pushSoft(k);
  }

  const inputs = args.inputs || {};
  const bandRaw = inputs.eval_band;
  const evalBand =
    bandRaw === "winning" ||
    bandRaw === "better" ||
    bandRaw === "equal" ||
    bandRaw === "worse" ||
    bandRaw === "losing"
      ? bandRaw
      : null;
  const userWp =
    typeof inputs.user_wp === "number"
      ? inputs.user_wp
      : typeof inputs.best_line_wp === "number"
        ? inputs.best_line_wp
        : null;

  let keepEval = false;
  if (evalBand && EVAL_WORDS[evalBand]) {
    keepEval = EVAL_WORDS[evalBand]!.some((w) => mentions(hay, w));
  }
  if (
    !keepEval &&
    (args.tipMeta?.topics || []).some((t) => String(t).startsWith("eval:"))
  ) {
    keepEval = true;
  }
  if (
    !keepEval &&
    (evalBand === "winning" || evalBand === "losing") &&
    (mentions(hay, "plan:") || mentions(hay, "typical idea"))
  ) {
    keepEval = true;
  }

  const situations: string[] = [];
  for (const s of args.situations || []) {
    const id = s.id;
    const label = id.replace(/_/g, " ");
    if (
      mentions(hay, label) ||
      mentions(hay, id) ||
      (s.softKeys || []).some((k) => wovenSoft.has(k) || softKeyMentioned(hay, k))
    ) {
      situations.push(id);
    }
  }

  let tactical: string | null = null;
  const fact = args.tacticalFact;
  if (fact?.kind) {
    const bits = [
      fact.kind.replace(/_/g, " "),
      fact.pieceLabel,
      fact.captureSan,
      fact.selfInflicted ? "trapped" : "",
      fact.motif,
    ].filter(Boolean);
    if (bits.some((b) => mentions(hay, String(b))) || wovenSoft.has(`motif.${fact.motif || ""}`)) {
      tactical = bits.filter(Boolean).join(" / ");
    }
  }

  let gamePlan: string | null = null;
  const planRaw =
    typeof inputs.game_plan === "string" ? inputs.game_plan.trim() : "";
  if (
    planRaw &&
    (mentions(hay, "plan") ||
      mentions(hay, "typical idea") ||
      planRaw
        .split(/[|,]/)
        .some((p) => softKeyMentioned(hay, p.trim()) || wovenSoft.has(p.trim())))
  ) {
    gamePlan = planRaw;
  }

  const primaryField =
    args.primaryField &&
    (mentions(hay, args.primaryField.replace(/_/g, " ")) ||
      (args.primarySoftKeys || []).some((k) => wovenSoft.has(k)))
      ? args.primaryField
      : null;

  const metrics: string[] = [];
  for (const m of args.tipMeta?.metrics || []) {
    if (!m) continue;
    if (String(m).startsWith("eval:")) {
      if (keepEval) metrics.push(String(m));
      continue;
    }
    if (mentions(hay, String(m).replace(/_/g, " ")) || softKeys.length) {
      // keep woven metrics only when tipMeta listed them (already tip-scoped)
      metrics.push(String(m));
    }
  }

  const topics = (args.tipMeta?.topics || [])
    .map(String)
    .filter((t) => {
      if (t.startsWith("eval:")) return keepEval;
      if (t.startsWith("checkpoint:")) return true;
      if (t.startsWith("tone:")) return true;
      return mentions(hay, t.replace(/[_:]/g, " ")) || softKeys.length > 0;
    });

  return {
    topChoices: topChoices.slice(0, limit),
    softKeys,
    evalBand: keepEval ? evalBand : null,
    userWp: keepEval ? userWp : null,
    situations,
    tactical,
    gamePlan,
    primaryField,
    metrics: [...new Set(metrics)].slice(0, 6),
    topics: [...new Set(topics)].slice(0, 8),
  };
}

/** Human dump block for script / debug. */
export function formatCommentRefs(refs: CommentRefs): string {
  const lines: string[] = [];
  lines.push("─ comment refs (top choices + only what the tip references) ─");
  if (refs.topChoices.length) {
    lines.push("topChoices:");
    for (const c of refs.topChoices) {
      const mark = c.selected ? "*" : " ";
      lines.push(
        `  ${mark} ${c.keyId}  w=${c.weight}` +
          (c.parts ? `  ${c.parts}` : "")
      );
    }
  } else {
    lines.push("topChoices: (none)");
  }
  lines.push(
    `softKeys: ${refs.softKeys.length ? refs.softKeys.join(", ") : "(none)"}`
  );
  if (refs.evalBand) {
    lines.push(
      `eval: band=${refs.evalBand}` +
        (refs.userWp != null ? ` wp=${refs.userWp}` : "")
    );
  }
  if (refs.situations.length) {
    lines.push(`situations: ${refs.situations.join(", ")}`);
  }
  if (refs.tactical) lines.push(`tactical: ${refs.tactical}`);
  if (refs.gamePlan) lines.push(`game_plan: ${refs.gamePlan}`);
  if (refs.primaryField) lines.push(`primaryField: ${refs.primaryField}`);
  if (refs.metrics.length) lines.push(`metrics: ${refs.metrics.join(", ")}`);
  if (refs.topics.length) lines.push(`topics: ${refs.topics.join(", ")}`);
  return lines.join("\n");
}

/** Compact one-liner for app subtitle under the note. */
export function formatCommentRefsCompact(refs: CommentRefs | null | undefined): string {
  if (!refs) return "";
  const bits: string[] = [];
  if (refs.softKeys.length) bits.push(refs.softKeys.slice(0, 3).join(" · "));
  if (refs.evalBand) bits.push(`eval:${refs.evalBand}`);
  if (refs.situations[0]) bits.push(refs.situations[0].replace(/_/g, " "));
  if (refs.tactical) bits.push(refs.tactical.split(" / ")[0]!);
  return bits.filter(Boolean).join(" · ");
}
