import { Chess } from "chess.js";
import type { TacticalFact } from "./tacticalFact";
import type { CoachEvent, CoachEventKind } from "./coachEvent";

export type NoteGuards = {
  tactical_kind?: string;
  self_inflicted?: boolean;
  user_castled?: boolean;
  opp_castled?: boolean;
  structural_kind?: string;
  praise_kind?: "brilliant" | "great_find";
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
  return true;
}

export function selectNote(
  event: CoachEvent,
  live: CoachLiveFacts,
  notes: GuardedCoachNote[]
): GuardedCoachNote | null {
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
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const d = countGuardMatches(b.guards) - countGuardMatches(a.guards);
    if (d) return d;
    return String(a.id).localeCompare(String(b.id));
  });
  return candidates[0] || null;
}
