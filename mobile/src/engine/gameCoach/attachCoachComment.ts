import { classifyMoment, type CoachEvent } from "./coachEvent";
import { composeComment } from "./commentComposer";
import { CoachSilenceManager } from "./coachSilence";
import {
  buildCoachLlmPayload,
  keyIdForLlmPayload,
  stitchCoachComment,
  type CoachLlmPayload,
} from "./llmComment";
import {
  buildLiveFacts,
  describeRankedNotes,
  rankNotes,
  RANKED_NOTE_LIMIT,
  type CoachLiveFacts,
  type GuardedCoachNote,
  type RankedNoteDump,
} from "./noteGuards";
import type { NoteTopic } from "./noteTopics";
import type { CoachMark } from "./coachMarkClassify";
import type { TacticalFact } from "./tacticalFact";

export type AttachCoachCommentResult = {
  text: string;
  note: GuardedCoachNote;
  event: CoachEvent;
  live: CoachLiveFacts;
  ranked: GuardedCoachNote[];
  noteDump: RankedNoteDump[];
  topics: NoteTopic[];
  llmPayload: CoachLlmPayload;
};

function syntheticNote(payload: CoachLlmPayload, event: CoachEvent): GuardedCoachNote {
  const keyId = keyIdForLlmPayload(payload);
  return {
    id: `llm:${keyId}`,
    keyId,
    eventKinds: [event.kind],
    guards: {},
    template: { attention: "" },
    source: "llm",
  };
}

export function attachCoachComment(args: {
  mark?: CoachMark | string | null;
  dropCp?: number;
  tacticalFact?: TacticalFact | null;
  structuralKind?: string | null;
  praiseMark?: string | null;
  primaryField?: string | null;
  ply: number;
  fen: string;
  userColor: "white" | "black";
  bestSan?: string | null;
  playedSan?: string | null;
  notes: GuardedCoachNote[];
  silence: CoachSilenceManager;
  phase?: "opening" | "middlegame" | "endgame";
  inputs?: Record<string, unknown> | null;
  llmText?: string | null;
}): AttachCoachCommentResult | null {
  const event = classifyMoment({
    mark: args.mark,
    dropCp: args.dropCp,
    tacticalFact: args.tacticalFact,
    structuralKind: args.structuralKind,
    praiseMark: args.praiseMark,
    primaryField: args.primaryField,
  });
  if (!event) return null;

  const praiseKind = event.kind === "praise" ? event.praiseKind : null;
  const live = buildLiveFacts({
    ply: args.ply,
    fen: args.fen,
    userColor: args.userColor,
    dropCp: args.dropCp,
    bestSan: args.bestSan,
    playedSan: args.playedSan,
    primaryField: args.primaryField,
    structuralKind: args.structuralKind,
    tacticalFact: args.tacticalFact,
    praiseKind,
  });
  const ranked = rankNotes(event, live, args.notes).slice(0, RANKED_NOTE_LIMIT);
  const llmPayload = buildCoachLlmPayload({
    ply: args.ply,
    playedSan: args.playedSan,
    bestSan: args.bestSan,
    mark: args.mark ? String(args.mark) : null,
    dropCp: args.dropCp,
    event,
    tacticalFact: args.tacticalFact,
    structuralKind: args.structuralKind,
    praiseMark: args.praiseMark,
    inputs: args.inputs,
    keyId: ranked[0]?.keyId,
  });
  const note = ranked[0] || syntheticNote(llmPayload, event);
  const catalogText = ranked[0] ? composeComment(note, event, live) : "";
  const text =
    String(args.llmText || "").trim() ||
    catalogText ||
    stitchCoachComment(llmPayload);
  if (!text) return null;
  if (args.silence.shouldSilence(args.ply, event, note)) return null;
  args.silence.recordSpeech(args.ply, note);
  const dump = describeRankedNotes({
    ranked: ranked.length ? ranked : [note],
    selectedId: note.id,
    commentText: text,
    phase: args.phase,
  });
  return {
    text,
    note,
    event,
    live,
    ranked: ranked.length ? ranked : [note],
    noteDump: dump.notes,
    topics: dump.topics,
    llmPayload,
  };
}
