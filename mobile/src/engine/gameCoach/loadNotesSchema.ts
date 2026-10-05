import type { GuardedCoachNote } from "./noteGuards";

type NotesPack = { notes?: GuardedCoachNote[] } | GuardedCoachNote[];

let cached: GuardedCoachNote[] | null = null;

export function loadNotesSchema(): GuardedCoachNote[] {
  if (cached) return cached;
  const pack = require("../../../assets/coach/notes_schema.json") as NotesPack;
  const notes = Array.isArray(pack) ? pack : pack.notes || [];
  cached = notes
    .map((n) => {
      if (!n || !n.id || !n.keyId) return null;
      const template = n.template || (n.text ? { attention: n.text } : null);
      if (!template) return null;
      return { ...n, template };
    })
    .filter((n): n is GuardedCoachNote => Boolean(n));
  return cached;
}

export function resetNotesSchemaCache(): void {
  cached = null;
}
