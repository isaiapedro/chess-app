import type { CoachMark } from "./coachMarks";
import type { CoachGameMetrics } from "./gameMetricsLookup";
import {
  detectStructureThemes,
  WINDOWED_STRUCTURE_THEMES,
} from "./structureDetect";

const GOOD_MARKS = new Set<CoachMark>([
  "best",
  "excellent",
  "good",
  "important",
  "brilliant",
]);

const BAD_MARKS = new Set<CoachMark>([
  "inaccuracy",
  "mistake",
  "blunder",
  "missed",
]);

type SummaryPly = {
  side: "white" | "black";
  analyzed: boolean;
  mark: CoachMark | null;
  fenAfter?: string;
  note?: string;
  san?: string;
};

const FEATURE_LABEL: Record<string, string> = {
  iqp: "an isolated queen's pawn fight",
  hanging_pawns: "hanging-pawn tension",
  doubled_pawns: "doubled-pawn pressure",
  passed_pawn: "a passed-pawn race",
  pawn_chain: "a locked pawn-chain battle",
  open_c_file: "the open c-file",
  open_file: "open-file play",
  bishop_pair: "the bishop pair",
  space: "a space squeeze",
};

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > 18 ? cut.slice(0, sp) : cut).trim();
}

function softenMetricLine(text: string): string {
  return clip(text, 72)
    .replace(/\bblunder(ed|s)?\b/gi, "slip")
    .replace(/\bwobbled\b/gi, "needed care")
    .replace(/\bhurt\b/gi, "mattered")
    .replace(/\bhigh for this game\b/gi, "worth reviewing")
    .replace(/\bneed[s]?\b/gi, "can grow with");
}

function mainStructuralFeature(plies: SummaryPly[]): string | null {
  const counts = new Map<string, number>();
  for (const p of plies) {
    if (!p.fenAfter) continue;
    for (const t of detectStructureThemes(p.fenAfter)) {
      if (!WINDOWED_STRUCTURE_THEMES.has(t)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [t, n] of counts) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  if (!best || bestN < 3) return null;
  return FEATURE_LABEL[best] || null;
}

function themeHint(metrics?: CoachGameMetrics | null): string | null {
  const themes = [
    ...(metrics?.globalThemes || []),
    ...(metrics?.themesByPhase?.middlegame || []),
    ...(metrics?.themesByPhase?.opening || []),
  ];
  for (const t of themes) {
    if (FEATURE_LABEL[t]) return FEATURE_LABEL[t];
  }
  if (themes.includes("king_safety") || themes.includes("attack")) {
    return "king-safety questions";
  }
  if (themes.includes("initiative") || themes.includes("forcing_moves")) {
    return "initiative and forcing moves";
  }
  if (themes.includes("endgame_technique")) {
    return "endgame technique";
  }
  return null;
}

/**
 * Closing coach note: main features of the game + friendly next-step tone.
 */
export function composeGameSummaryNote(args: {
  plies: SummaryPly[];
  userColor: "white" | "black";
  metrics?: CoachGameMetrics | null;
  openingLabel?: string;
}): string {
  const userPlies = args.plies.filter(
    (p) => p.side === args.userColor && p.analyzed && p.mark && p.mark !== "book"
  );

  let good = 0;
  let brilliant = 0;
  let blunders = 0;
  let mistakes = 0;
  let missed = 0;
  let soft = 0;
  for (const p of userPlies) {
    const m = p.mark!;
    if (GOOD_MARKS.has(m)) good += 1;
    if (m === "brilliant") brilliant += 1;
    if (m === "blunder") blunders += 1;
    if (m === "mistake") mistakes += 1;
    if (m === "missed") missed += 1;
    if (m === "inaccuracy") soft += 1;
  }

  const opening = (args.openingLabel || "").trim();
  const feature =
    mainStructuralFeature(args.plies) || themeHint(args.metrics);

  let lead = "";
  if (opening && feature) {
    lead = `This ${opening} turned into ${feature}.`;
  } else if (opening) {
    lead = `Solid ${opening} game to learn from.`;
  } else if (feature) {
    lead = `The game lived around ${feature}.`;
  } else {
    lead = "A useful game for pattern review.";
  }

  let strength = "";
  if (brilliant > 0) {
    strength =
      "You found a sharp idea in there — keep trusting that tactical eye.";
  } else if (good >= 5) {
    strength =
      "You stayed accurate through long stretches; that calm decision-making is a real strength.";
  } else if (good >= 2) {
    strength =
      "Several clean moves showed you understood the plan when the position was clear.";
  } else if (args.metrics?.strengths?.[0]) {
    strength = softenMetricLine(args.metrics.strengths[0]) + ".";
  }

  let growth = "";
  if (blunders > 0 || missed >= 2) {
    growth =
      "Next time, pause one extra second on forcing checks and captures — those moments are gold for training.";
  } else if (mistakes >= 2) {
    growth =
      "A few positions reward naming the opponent's threat before your own plan; replay those turns slowly.";
  } else if (missed > 0) {
    growth =
      "You left a tactic on the table once — a quick rewind of that line will lock the pattern in.";
  } else if (soft >= 2) {
    growth =
      "Small inaccuracies crept in; asking \"what changed in the pawn structure?\" on those moves will help.";
  } else if (args.metrics?.weaknesses?.[0]) {
    growth =
      "A gentle focus area: " +
      softenMetricLine(args.metrics.weaknesses[0]).replace(/^[A-Z]/, (c) =>
        c.toLowerCase()
      ) +
      ".";
  } else if (!strength) {
    growth =
      "Replaying the critical turns with the engine off first is a great study habit from here.";
  }

  const bits = [lead, strength, growth].filter(Boolean);
  if (bits.length === 1) return bits[0];
  if (bits.length === 2) return `${bits[0]} ${bits[1]}`;
  return `${bits[0]} ${bits[1]} ${bits[2]}`;
}
