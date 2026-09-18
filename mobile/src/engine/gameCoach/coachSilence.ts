import type { CoachEvent } from "./coachEvent";
import type { GuardedCoachNote } from "./noteGuards";

export const COMMENT_GAP_PLIES = 2;
export const COMMENT_EMERGENCY_CP = 300;

export class CoachSilenceManager {
  lastCommentPly = -999;
  usedKeyIds = new Set<string>();
  usedNoteIds = new Set<string>();
  ignoreSilence = false;

  constructor(args?: { ignoreSilence?: boolean }) {
    this.ignoreSilence = Boolean(args?.ignoreSilence);
  }

  shouldSilence(ply: number, event: CoachEvent, note: GuardedCoachNote): boolean {
    if (this.ignoreSilence) return false;
    const isEmergency =
      (event.kind === "tactical_blunder" && event.dropCp >= COMMENT_EMERGENCY_CP) ||
      (event.kind === "praise" && event.praiseKind === "brilliant");
    if (!isEmergency && ply - this.lastCommentPly < COMMENT_GAP_PLIES) {
      return true;
    }
    if (this.usedKeyIds.has(note.keyId) || this.usedNoteIds.has(note.id)) {
      return true;
    }
    return false;
  }

  recordSpeech(ply: number, note: GuardedCoachNote): void {
    this.lastCommentPly = ply;
    if (note.keyId) this.usedKeyIds.add(note.keyId);
    if (note.id) this.usedNoteIds.add(note.id);
  }
}
