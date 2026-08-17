import type { CoachMark } from "./coachMarks";
import type { CoachGameMetrics } from "./gameMetricsLookup";
import { type KeyTip, type PhaseName } from "./keyRetrieve";
import type { DerivedCoachEntry } from "./derivedCoachPack";
import { cleanBookProse } from "./derivedPolish";
import {
  buildEvalSwingIndex,
  formatEvalSwingSummary,
} from "./evalSwingIndex";

type SummaryPly = {
  side: "white" | "black";
  analyzed?: boolean;
  mark: CoachMark | null;
  note?: string;
  themes?: string[];
  ply?: number;
  fenAfter?: string;
  deltaCp?: number;
  evalBeforeCp?: number;
  evalAfterCp?: number;
};

function tipPhase(tip: KeyTip): PhaseName {
  const p = (tip.phase || "").toLowerCase();
  if (p === "opening" || p === "middlegame" || p === "endgame") return p;
  const kid = tip.keyId || "";
  if (kid.startsWith("opening.")) return "opening";
  if (kid.startsWith("endgame.")) return "endgame";
  return "middlegame";
}

function firstHumanSentence(raw: string, max = 160): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^[^.!?]+[.!?]?/);
  const s = (m ? m[0] : t).trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}.`;
}

function tipLesson(tip: KeyTip | null | undefined, max = 160): string {
  if (!tip) return "";
  const fromText = firstHumanSentence(cleanBookProse(tip.text || "", max) || tip.text || "", max);
  if (fromText) return fromText;
  return firstHumanSentence(
    cleanBookProse(tip.compactDefinition || tip.noteCompact || "", max),
    max
  );
}

function plyNoteAt(
  plies: SummaryPly[],
  ply: number | undefined
): string {
  if (ply == null) return "";
  const hit = plies.find((p) => p.ply === ply && p.note);
  return firstHumanSentence(hit?.note || "", 160);
}

function sortedTips(tips: KeyTip[]): KeyTip[] {
  return [...tips].sort(
    (a, b) => b.score - a.score || b.text.length - a.text.length
  );
}

function uniqueTips(tips: KeyTip[]): KeyTip[] {
  const seen = new Set<string>();
  const out: KeyTip[] = [];
  for (const t of tips) {
    const id = t.noteId || t.keyId || t.label;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

function structuralMoments(
  metrics?: CoachGameMetrics | null,
  kindPrefix?: string
) {
  return Object.values(metrics?.momentsByPly || {})
    .filter((m) =>
      kindPrefix
        ? (m.structuralKind || "").startsWith(kindPrefix)
        : Boolean(m.structuralKind)
    )
    .sort((a, b) => a.ply - b.ply);
}

function reachedEndgame(
  metrics?: CoachGameMetrics | null,
  plies?: SummaryPly[]
): boolean {
  if (metrics?.phaseBounds?.endgameStartPly0 != null) return true;
  if (metrics?.themesByPhase.endgame?.length) return true;
  if (!plies?.length) return false;
  for (const p of plies) {
    const fen = p.fenAfter || "";
    if (!fen) continue;
    const pieces = fen.split(" ")[0]?.replace(/\d/g, "").length || 32;
    if (pieces <= 12) return true;
  }
  return false;
}

/**
 * Last-move summary: Early / Middlegame / Late — metrics-first didactic wrap.
 *
 * Early = opening plan + development/castle metrics (eco + aggregate moments).
 * Middlegame = space/king/pawn-break/accuracy + bad/good pivots.
 * Late = endgame advantage / technique when the phase was reached.
 */
export function composeGameSummaryNote(args: {
  plies: SummaryPly[];
  userColor: "white" | "black";
  metrics?: CoachGameMetrics | null;
  openingLabel?: string;
  openingPackKey?: string | null;
  usedKeyTips?: KeyTip[];
  gameKeys?: DerivedCoachEntry[];
  selectedNotes?: string[];
}): string {
  const metrics = args.metrics;
  const tips = uniqueTips(args.usedKeyTips || []);
  const byPhase: Record<PhaseName, KeyTip[]> = {
    opening: [],
    middlegame: [],
    endgame: [],
  };
  for (const tip of tips) {
    byPhase[tipPhase(tip)].push(tip);
  }

  const parts: string[] = [];
  const label = (args.openingLabel || "").trim();
  const userPlies = args.plies.filter((p) => p.side === args.userColor);

  const openMom = structuralMoments(metrics).find(
    (m) =>
      m.structuralKind === "opening_name" ||
      m.structuralKind === "opening_aggregate"
  );
  const openTip =
    sortedTips(byPhase.opening)[0] ||
    (args.openingPackKey
      ? tips.find((t) => t.keyId === args.openingPackKey) || null
      : null);
  const openLesson =
    plyNoteAt(args.plies, openMom?.ply) || tipLesson(openTip, 160);
  {
    const name = label || "the opening";
    const body = openLesson
      ? `${name}. ${openLesson}`
      : `${name}. Develop, castle, and fight for the typical plan of this opening.`;
    parts.push(`Early game: ${firstHumanSentence(body, 200)}`);
  }

  const mgAgg = structuralMoments(metrics).find(
    (m) => m.structuralKind === "middlegame_aggregate"
  );
  const midTip = sortedTips(byPhase.middlegame)[0] || null;
  const midLesson =
    plyNoteAt(args.plies, mgAgg?.ply) || tipLesson(midTip, 160);
  {
    const body = midLesson
      ? midLesson
      : "The middlegame turned on pawn levers, king safety, and whether you converted the edge.";
    parts.push(`Middlegame: ${firstHumanSentence(body, 200)}`);
  }

  const late = reachedEndgame(metrics, args.plies);
  if (late) {
    const egAdv = structuralMoments(metrics).find(
      (m) => m.structuralKind === "endgame_advantage"
    );
    const endTip = sortedTips(byPhase.endgame)[0] || null;
    const endLesson =
      plyNoteAt(args.plies, egAdv?.ply) || tipLesson(endTip, 160);
    const last = userPlies[userPlies.length - 1];
    const mated = /#/.test(String(last?.note || "")) || last?.mark === "best";
    const body = endLesson
      ? endLesson
      : mated
        ? "You finished the game by delivering mate."
        : "The ending asked for clean conversion without giving counterplay.";
    parts.push(`Late game: ${firstHumanSentence(body, 200)}`);
  } else {
    parts.push(
      "Late game: the game never fully entered a technical ending."
    );
  }

  const swingIndex = buildEvalSwingIndex({
    plies: args.plies,
    userColor: args.userColor,
  });
  const swingProse = formatEvalSwingSummary(swingIndex);
  if (swingProse) {
    parts.push(swingProse);
  }

  return parts.join("\n\n");
}
