import { Chess } from "chess.js";
import type { TacticalFact } from "./tacticalFact";
import type { CoachEvent, CoachEventKind } from "./coachEvent";
import {
  classifyNoteTopic,
  topicRank,
  type NoteTopic,
} from "./noteTopics";

export const RANKED_NOTE_LIMIT = 3;

export type NoteGuards = {
  tactical_kind?: string;
  self_inflicted?: boolean;
  user_castled?: boolean;
  opp_castled?: boolean;
  structural_kind?: string;
  praise_kind?: "brilliant" | "great_find";
  played_san?: string;
  ply?: number;
};

export type NoteTemplate = {
  attention?: string;
  lesson?: string;
  plan?: string;
};

export type GuardedCoachNote = {
  id: string;
  keyId: string;
  eventKinds: CoachEventKind[];
  guards: NoteGuards;
  template: NoteTemplate;
  text?: string;
  source?: string;
};

export type CoachLiveFacts = {
  ply: number;
  fen: string;
  userColor: "white" | "black";
  dropCp: number;
  bestSan: string | null;
  playedSan: string | null;
  primaryField: string | null;
  structuralKind: string | null;
  tacticalKind: string | null;
  selfInflicted: boolean;
  piece: string | null;
  square: string | null;
  userCastled: boolean;
  oppCastled: boolean;
  praiseKind: "brilliant" | "great_find" | null;
};

function kingUncastled(fen: string, color: "w" | "b"): boolean {
  try {
    const board = new Chess(fen);
    const rights = (board.fen().split(" ")[2] || "-").replace(/-/g, "");
    if (color === "w") {
      if (rights.includes("K") || rights.includes("Q")) return true;
      const k = board.get("e1");
      return Boolean(k && k.type === "k" && k.color === "w");
    }
    if (rights.includes("k") || rights.includes("q")) return true;
    const k = board.get("e8");
    return Boolean(k && k.type === "k" && k.color === "b");
  } catch {
    return false;
  }
}

export function kingIsCastled(fen: string, color: "w" | "b"): boolean {
  return !kingUncastled(fen, color);
}

export function buildLiveFacts(args: {
  ply: number;
  fen: string;
  userColor: "white" | "black";
  dropCp?: number;
  bestSan?: string | null;
  playedSan?: string | null;
  primaryField?: string | null;
  structuralKind?: string | null;
  tacticalFact?: TacticalFact | null;
  praiseKind?: "brilliant" | "great_find" | null;
}): CoachLiveFacts {
  const user: "w" | "b" = args.userColor === "black" ? "b" : "w";
  const opp: "w" | "b" = user === "w" ? "b" : "w";
  const fact = args.tacticalFact || null;
  return {
    ply: args.ply,
    fen: args.fen || "",
    userColor: args.userColor,
    dropCp: Math.max(0, Math.round(Number(args.dropCp) || 0)),
    bestSan: args.bestSan || null,
    playedSan: args.playedSan || null,
    primaryField: args.primaryField || null,
    structuralKind: args.structuralKind || null,
    tacticalKind: fact?.kind || null,
    selfInflicted: Boolean(fact?.selfInflicted),
    piece: fact?.pieceLabel || null,
    square: fact?.trapSquare || null,
    userCastled: args.fen ? kingIsCastled(args.fen, user) : false,
    oppCastled: args.fen ? kingIsCastled(args.fen, opp) : false,
    praiseKind: args.praiseKind || null,
  };
}

export function countGuardMatches(guards: NoteGuards | null | undefined): number {
  if (!guards) return 0;
  return Object.values(guards).filter((v) => v !== undefined && v !== null && v !== "")
    .length;
}

export function validateFactGuards(
  guards: NoteGuards | null | undefined,
  live: CoachLiveFacts
): boolean {
  if (!guards) return true;
  if (
    guards.tactical_kind !== undefined &&
    live.tacticalKind !== guards.tactical_kind
  ) {
    return false;
  }
  if (
    guards.self_inflicted !== undefined &&
    live.selfInflicted !== guards.self_inflicted
  ) {
    return false;
  }
  if (
    guards.user_castled !== undefined &&
    live.userCastled !== guards.user_castled
  ) {
    return false;
  }
  if (
    guards.opp_castled !== undefined &&
    live.oppCastled !== guards.opp_castled
  ) {
    return false;
  }
  if (
    guards.structural_kind !== undefined &&
    live.structuralKind !== guards.structural_kind
  ) {
    return false;
  }
  if (
    guards.praise_kind !== undefined &&
    live.praiseKind !== guards.praise_kind
  ) {
    return false;
  }
  if (
    guards.played_san !== undefined &&
    live.playedSan !== guards.played_san
  ) {
    return false;
  }
  if (guards.ply !== undefined && live.ply !== Number(guards.ply)) {
    return false;
  }
  return true;
}

export function rankNotes(
  event: CoachEvent,
  live: CoachLiveFacts,
  notes: GuardedCoachNote[]
): GuardedCoachNote[] {
  const candidates = notes.filter((note) => {
    if (!note.eventKinds?.includes(event.kind)) return false;
    if (event.kind === "tactical_blunder") {
      const key = note.keyId || "";
      if (!key.startsWith("motif.") && !key.startsWith("attack.")) {
        return false;
      }
    }
    return validateFactGuards(note.guards, live);
  });
  candidates.sort((a, b) => {
    const d = countGuardMatches(b.guards) - countGuardMatches(a.guards);
    if (d) return d;
    return String(a.id).localeCompare(String(b.id));
  });
  return candidates;
}

export function selectNote(
  event: CoachEvent,
  live: CoachLiveFacts,
  notes: GuardedCoachNote[]
): GuardedCoachNote | null {
  return rankNotes(event, live, notes)[0] || null;
}

export type RankedNoteDump = {
  id: string;
  keyId: string;
  guards: number;
  topic: NoteTopic;
  selected: boolean;
};

function themesFromNote(note: GuardedCoachNote): string[] {
  const key = note.keyId || "";
  const parts = key.split(".").filter(Boolean);
  return [...new Set([key, ...parts, ...(note.eventKinds || [])])];
}

function noteTopicFromTemplate(
  note: GuardedCoachNote,
  commentText?: string | null,
  phase?: "opening" | "middlegame" | "endgame"
): NoteTopic {
  const slots = [
    note.template?.attention,
    note.template?.lesson,
    note.template?.plan,
    commentText,
  ]
    .filter(Boolean)
    .join(" ");
  return classifyNoteTopic({
    text: slots || note.keyId,
    themes: themesFromNote(note),
    phase,
  });
}

export function describeRankedNotes(args: {
  ranked: GuardedCoachNote[];
  selectedId?: string | null;
  commentText?: string | null;
  phase?: "opening" | "middlegame" | "endgame";
  limit?: number;
}): { notes: RankedNoteDump[]; topics: NoteTopic[] } {
  const limit = args.limit ?? RANKED_NOTE_LIMIT;
  const notes = args.ranked.slice(0, limit).map((note, i) => ({
    id: note.id,
    keyId: note.keyId,
    guards: countGuardMatches(note.guards),
    topic: noteTopicFromTemplate(note, i === 0 ? args.commentText : null, args.phase),
    selected: Boolean(args.selectedId && note.id === args.selectedId),
  }));
  const topics = [...new Set(notes.map((n) => n.topic))].sort(
    (a, b) => topicRank(a) - topicRank(b)
  );
  return { notes, topics };
}
