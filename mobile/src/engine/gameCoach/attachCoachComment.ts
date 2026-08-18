import { classifyMoment, type CoachEvent } from "./coachEvent";
import { composeComment } from "./commentComposer";
import { CoachSilenceManager } from "./coachSilence";
import {
  buildLiveFacts,
  selectNote,
  type CoachLiveFacts,
  type GuardedCoachNote,
} from "./noteGuards";
import type { CoachMark } from "./coachMarkClassify";
import type { TacticalFact } from "./tacticalFact";

export type AttachCoachCommentResult = {
  text: string;
  note: GuardedCoachNote;
  event: CoachEvent;
  live: CoachLiveFacts;
};

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
  const note = selectNote(event, live, args.notes);
  if (!note) return null;
  const text = composeComment(note, event, live);
  if (!text) return null;
  if (args.silence.shouldSilence(args.ply, event, note)) return null;
  args.silence.recordSpeech(args.ply, note);
  return { text, note, event, live };
}
