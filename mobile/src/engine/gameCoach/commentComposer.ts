import type { CoachEvent } from "./coachEvent";
import type { CoachLiveFacts, GuardedCoachNote } from "./noteGuards";

const TOKEN_KEYS = ["piece", "square", "bestSan", "playedSan"] as const;

function interpolate(templateStr: string, live: CoachLiveFacts): string {
  const raw = String(templateStr || "").trim();
  if (!raw) return "";
  const values: Record<(typeof TOKEN_KEYS)[number], string | null> = {
    piece: live.piece,
    square: live.square,
    bestSan: live.bestSan,
    playedSan: live.playedSan,
  };
  let out = raw;
  for (const key of TOKEN_KEYS) {
    const token = `{${key}}`;
    if (!out.includes(token)) continue;
    const value = values[key];
    if (!value) return "";
    out = out.split(token).join(value);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function composeComment(
  note: GuardedCoachNote,
  event: CoachEvent,
  live: CoachLiveFacts
): string {
  const prewritten = interpolate(note.text || "", live);
  if (prewritten) return prewritten;

  const attention = interpolate(note.template?.attention || "", live);
  const lesson = interpolate(note.template?.lesson || "", live);
  const plan = interpolate(note.template?.plan || "", live);
  const dropCp =
    event.kind === "tactical_blunder" || event.kind === "positional_error"
      ? event.dropCp
      : live.dropCp;

  if (event.kind === "tactical_blunder" && dropCp >= 200) {
    const parts = [attention];
    if (live.bestSan && lesson) {
      parts.push(`Best was ${live.bestSan} (${lesson}).`);
    } else if (live.bestSan) {
      parts.push(`Best was ${live.bestSan}.`);
    }
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  return [attention, plan].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
