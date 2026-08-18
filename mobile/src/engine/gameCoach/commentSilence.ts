import { PHASE_NOTE_LIMITS } from "./keyRetrieve";
import type { OpeningTipPrior } from "./openingJudgmentTip";

export const COMMENT_SILENCE_PLY_WINDOW = 8;
export const COMMENT_PLY_COOLDOWN = 2;
export const COMMENT_MAJOR_BLUNDER_CP = 300;

const BAD_MOVE_MARKS = new Set(["mistake", "blunder", "missed"]);
const FIXED_CHECKPOINT_KINDS = new Set([
  "opening_name",
  "opening_aggregate",
  "middlegame_aggregate",
  "endgame_advantage",
]);

export type CommentSilenceReason =
  | "ok"
  | "empty"
  | "repeat_text"
  | "repeat_note"
  | "same_best_san"
  | "ply_cooldown"
  | "key_cooldown"
  | "phase_limit";

export type AttachedCoachComment = {
  ply: number;
  bestSan: string;
  noteId: string;
  keyId: string;
};

export type CommentSilenceState = {
  texts: Set<string>;
  noteIds: Set<string>;
  attached: AttachedCoachComment[];
};

export type CoachCommentSession = CommentSilenceState & {
  usedTips: Set<string>;
  priorTopics: OpeningTipPrior | null;
  phaseNoteCounts: { opening: number; middlegame: number; endgame: number };
  ignorePhaseLimits: boolean;
};

export type CoachCommentCandidate = {
  text: string;
  noteId?: string | null;
  keyId?: string | null;
  ply: number;
  bestSan?: string | null;
  kind?: string | null;
  mark?: string | null;
  structuralKind?: string | null;
  dropCp?: number;
};

export function createCommentSilenceState(
  noteIds?: Set<string>
): CommentSilenceState {
  return {
    texts: new Set(),
    noteIds: noteIds ?? new Set(),
    attached: [],
  };
}

export function createCoachCommentSession(args?: {
  noteIds?: Set<string>;
  ignorePhaseLimits?: boolean;
}): CoachCommentSession {
  return {
    ...createCommentSilenceState(args?.noteIds),
    usedTips: new Set(),
    priorTopics: null,
    phaseNoteCounts: { opening: 0, middlegame: 0, endgame: 0 },
    ignorePhaseLimits: Boolean(args?.ignorePhaseLimits),
  };
}

export function normalizeCommentText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeBestSan(san: string | null | undefined): string {
  return String(san || "")
    .trim()
    .replace(/[+#?!]+$/g, "");
}

export function isFixedCheckpointComment(args: {
  kind?: string | null;
  structuralKind?: string | null;
}): boolean {
  const structural = String(args.structuralKind || "");
  return (
    args.kind === "fixed_checkpoint" ||
    FIXED_CHECKPOINT_KINDS.has(structural)
  );
}

export function windowRuleApplies(args: {
  kind?: string | null;
  mark?: string | null;
  structuralKind?: string | null;
}): boolean {
  if (isFixedCheckpointComment(args)) return false;
  if (args.kind === "praise_move" || args.mark === "brilliant") {
    return false;
  }
  if (args.kind === "bad_move") return true;
  return Boolean(args.mark && BAD_MOVE_MARKS.has(args.mark));
}

function plyCooldownExempt(args: CoachCommentCandidate): boolean {
  if (isFixedCheckpointComment(args)) return true;
  if (args.mark === "brilliant") return true;
  return (args.dropCp ?? 0) >= COMMENT_MAJOR_BLUNDER_CP;
}

function sameBestSanInWindow(
  state: CommentSilenceState,
  ply: number,
  bestSan: string
): boolean {
  if (!bestSan) return false;
  for (const prev of state.attached) {
    if (!prev.bestSan) continue;
    const gap = ply - prev.ply;
    if (
      gap >= 1 &&
      gap <= COMMENT_SILENCE_PLY_WINDOW &&
      prev.bestSan === bestSan
    ) {
      return true;
    }
  }
  return false;
}

function sameKeyIdInWindow(
  state: CommentSilenceState,
  ply: number,
  keyId: string
): boolean {
  if (!keyId) return false;
  for (const prev of state.attached) {
    if (!prev.keyId || prev.keyId !== keyId) continue;
    const gap = ply - prev.ply;
    if (gap >= 1 && gap <= COMMENT_SILENCE_PLY_WINDOW) return true;
  }
  return false;
}

export function sessionAllowsPhase(
  session: CoachCommentSession,
  phase: "opening" | "middlegame" | "endgame",
  alwaysCall: boolean
): boolean {
  if (alwaysCall || session.ignorePhaseLimits) return true;
  return session.phaseNoteCounts[phase] < PHASE_NOTE_LIMITS[phase];
}

export function sessionRecordPhase(
  session: CoachCommentSession,
  phase: "opening" | "middlegame" | "endgame"
): void {
  session.phaseNoteCounts[phase] += 1;
}

export function claimCoachComment(
  state: CommentSilenceState,
  candidate: CoachCommentCandidate
): { attach: boolean; reason: CommentSilenceReason } {
  const text = normalizeCommentText(candidate.text);
  if (!text) return { attach: false, reason: "empty" };
  const noteId = String(candidate.noteId || "").trim();
  const keyId = String(candidate.keyId || "").trim();
  const bestSan = normalizeBestSan(candidate.bestSan);
  const ply = Number(candidate.ply) || 0;

  if (state.attached.length > 0) {
    if (state.texts.has(text)) {
      return { attach: false, reason: "repeat_text" };
    }
    if (noteId && state.noteIds.has(noteId)) {
      return { attach: false, reason: "repeat_note" };
    }
    const last = state.attached[state.attached.length - 1];
    if (last && ply - last.ply <= COMMENT_PLY_COOLDOWN && !plyCooldownExempt(candidate)) {
      return { attach: false, reason: "ply_cooldown" };
    }
    if (
      windowRuleApplies(candidate) &&
      sameBestSanInWindow(state, ply, bestSan)
    ) {
      return { attach: false, reason: "same_best_san" };
    }
    if (
      !isFixedCheckpointComment(candidate) &&
      sameKeyIdInWindow(state, ply, keyId)
    ) {
      return { attach: false, reason: "key_cooldown" };
    }
  }

  state.texts.add(text);
  if (noteId) state.noteIds.add(noteId);
  state.attached.push({ ply, bestSan, noteId, keyId });
  return { attach: true, reason: "ok" };
}
