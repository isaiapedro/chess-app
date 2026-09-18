import type { GuardedCoachNote } from "./noteGuards";

type NotesPack = { notes?: GuardedCoachNote[] } | GuardedCoachNote[];

let cached: GuardedCoachNote[] | null = null;

export function loadNotesSchema(): GuardedCoachNote[] {
  if (cached) return cached;
  const pack = require("../../../assets/coach/notes_schema.json") as NotesPack;
  const notes = Array.isArray(pack) ? pack : pack.notes || [];
  cached = notes.filter((n) => n && n.id && n.keyId && n.template);
  return cached;
}

export function resetNotesSchemaCache(): void {
  cached = null;
}
