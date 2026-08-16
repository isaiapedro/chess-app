import type { CoachMark } from "./coachMarks";
import type { CoachGameMetrics } from "./gameMetricsLookup";
import { type KeyTip, type PhaseName } from "./keyRetrieve";
import type { DerivedCoachEntry } from "./derivedCoachPack";
import { cleanBookProse } from "./derivedPolish";

type SummaryPly = {
  side: "white" | "black";
  analyzed?: boolean;
  mark: CoachMark | null;
  note?: string;
  themes?: string[];
  ply?: number;
  fenAfter?: string;
  deltaCp?: number;
};

const GOOD_MARKS = new Set<CoachMark>([
  "best",
  "important",
  "excellent",
  "good",
  "brilliant",
]);

const BAD_MARKS = new Set<CoachMark>([
  "blunder",
  "mistake",
  "missed",
  "inaccuracy",
]);

function tipPhase(tip: KeyTip): PhaseName {
  const p = (tip.phase || "").toLowerCase();
  if (p === "opening" || p === "middlegame" || p === "endgame") return p;
  const kid = tip.keyId || "";
  if (kid.startsWith("opening.")) return "opening";
  if (kid.startsWith("endgame.")) return "endgame";
  return "middlegame";
}

function tipLesson(tip: KeyTip | null | undefined, max = 140): string {
  if (!tip) return "";
  const fromCompact = cleanBookProse(
    tip.compactDefinition || tip.noteCompact || "",
    max
  );
  const fromText = cleanBookProse(tip.text || "", max);
  return fromCompact || fromText;
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

function formatThemeList(themes: string[], max = 4): string {
  const cleaned = themes
    .map((t) =>
      t.includes(".")
        ? t.split(".").slice(1).join(".").replace(/_/g, " ")
        : t.replace(/_/g, " ")
    )
    .filter((t) => t.length >= 3)
    .slice(0, max);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
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

  // —— Early game ——
  const openThemes = metrics?.themesByPhase.opening || [];
  const openTip =
    sortedTips(byPhase.opening)[0] ||
    (args.openingPackKey
      ? tips.find((t) => t.keyId === args.openingPackKey) || null
      : null);
  const openLesson = tipLesson(openTip, 130);
  const openThemeStr = formatThemeList(openThemes, 3);
  const openStructural = structuralMoments(metrics).filter(
    (m) =>
      m.structuralKind === "opening_name" ||
      m.structuralKind === "opening_aggregate"
  );
  const earlyBad = userPlies.filter(
    (p) =>
      p.mark &&
      BAD_MARKS.has(p.mark) &&
      (p.ply == null ||
        (metrics?.phaseBounds?.middlegameStartPly0 != null
          ? p.ply - 1 < metrics.phaseBounds.middlegameStartPly0
          : (p.ply || 0) <= 20))
  ).length;
  {
    let body = label || "Early game";
    if (openThemeStr) body += ` — metrics flagged ${openThemeStr}`;
    if (openStructural.length) {
      body += `. Checkpoints at moves 5/10 locked the opening plan`;
    }
    if (earlyBad) {
      body += `. ${earlyBad} early inaccuracy${earlyBad === 1 ? "" : "ies"} need review`;
    }
    if (openLesson) body += `. ${openLesson}`;
    else if (!openThemeStr) {
      body +=
        ". Develop minors, claim a centre share, and castle before the middlegame plan starts.";
    }
    parts.push(`Early game: ${body}`);
  }

  // —— Middlegame ——
  const midThemes = formatThemeList(metrics?.themesByPhase.middlegame || [], 4);
  const midTip = sortedTips(byPhase.middlegame)[0] || null;
  const midLesson = tipLesson(midTip, 120);
  const mgAgg = structuralMoments(metrics).find(
    (m) => m.structuralKind === "middlegame_aggregate"
  );
  const liveStruct = structuralMoments(metrics).filter(
    (m) => m.structuralKind === "decisive_pawn_break"
  );
  const midBad = userPlies.filter(
    (p) => p.mark && BAD_MARKS.has(p.mark)
  ).length;
  const midGood = userPlies.filter(
    (p) => p.mark && GOOD_MARKS.has(p.mark) && (p.mark === "brilliant" || p.mark === "important")
  ).length;
  {
    let body = midThemes
      ? `Metrics highlight ${midThemes}`
      : "Plans, pawn levers, and king safety decided the phase";
    if (mgAgg) body += ". Middlegame aggregate checkpoint closed the phase";
    if (liveStruct.length) {
      body += `. ${liveStruct.length} live pivot${liveStruct.length === 1 ? "" : "s"} (pawn break)`;
    }
    if (midBad || midGood) {
      body += `. Accuracy: ${midGood} praise mark${midGood === 1 ? "" : "s"}, ${midBad} costly mark${midBad === 1 ? "" : "s"}`;
    }
    if (midLesson) body += `. ${midLesson}`;
    else if (metrics?.weaknesses?.[0]) body += `. ${metrics.weaknesses[0]}`;
    parts.push(`Middlegame: ${body}`);
  }

  // —— Late game ——
  const late = reachedEndgame(metrics, args.plies);
  if (late) {
    const endThemes = formatThemeList(metrics?.themesByPhase.endgame || [], 3);
    const endTip = sortedTips(byPhase.endgame)[0] || null;
    const endLesson = tipLesson(endTip, 120);
    const egAdv = structuralMoments(metrics).find(
      (m) => m.structuralKind === "endgame_advantage"
    );
    let body = endThemes
      ? `Technique themes: ${endThemes}`
      : "King activity, trades, and conversion paths take over";
    if (egAdv?.inputs?.best_line_wp != null) {
      body += `. Advantage checkpoint (~${egAdv.inputs.best_line_wp} WP)`;
    } else if (egAdv) {
      body += ". Endgame advantage checkpoint fired";
    }
    if (endLesson) body += `. ${endLesson}`;
    parts.push(`Late game: ${body}`);
  } else {
    parts.push(
      "Late game: the game never fully entered a technical ending — treat the last phase as a converted middlegame."
    );
  }

  return parts.join("\n\n");
}
