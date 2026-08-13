import { Chess } from "chess.js";
import type { CoachGameMetrics, CoachMetricMoment } from "./gameMetricsLookup";
import {
  assessPositionPov,
  kingUncastled,
  moveLooksTactical,
  moveRelatesToKingMotif,
  type AttackSide,
  type PositionPov,
} from "./positionPov";

import { phasePlanNote } from "./phasePlans";

export type NotePerspective = "user" | "opponent";

export type UserErrorKind = "mistake" | "missed_opportunity" | "good" | null;

const KING_MOTIF_THEMES = new Set([
  "king_safety",
  "opp_king_exposed",
  "user_king_exposed",
  "attack",
  "defense",
]);

const MAX_KING_MOTIF_MENTIONS = 2;

function kingMotifMentionCount(usedTips: Set<string>): number {
  return [...usedTips].filter((k) => k.startsWith("motif:king:")).length;
}

function canCiteKingMotif(usedTips: Set<string>): boolean {
  return kingMotifMentionCount(usedTips) < MAX_KING_MOTIF_MENTIONS;
}

function markKingMotifCited(usedTips: Set<string>): void {
  usedTips.add(`motif:king:${kingMotifMentionCount(usedTips)}`);
}

/** Motif only if still live AND this move engages it (or best does) */
export function kingMotifRelevant(args: {
  fenBefore: string;
  playedSan: string;
  bestSan: string | null;
  pov: PositionPov;
  usedTips: Set<string>;
}): boolean {
  if (!args.pov.kingMotifLive) return false;
  if (!canCiteKingMotif(args.usedTips)) return false;
  const playedHit = moveRelatesToKingMotif({
    fenBefore: args.fenBefore,
    san: args.playedSan,
    pov: args.pov,
  });
  const bestHit = moveRelatesToKingMotif({
    fenBefore: args.fenBefore,
    san: args.bestSan,
    pov: args.pov,
  });
  // Pure tactics elsewhere → motif not the story
  if (
    moveLooksTactical(args.fenBefore, args.bestSan) &&
    !bestHit &&
    !playedHit
  ) {
    return false;
  }
  return playedHit || bestHit;
}

/**
 * Themes from board + live POV. Sticky motifs stripped when dead / unrelated.
 */
export function expandCoachThemes(args: {
  structure: string[];
  openingTags: string[];
  phase: "opening" | "middlegame" | "endgame";
  deltaCp: number;
  playedBest: boolean;
  metricsThemes?: string[];
  moment?: CoachMetricMoment | null;
  perspective: NotePerspective;
  errorKind?: UserErrorKind;
  noteWorthy: boolean;
  pov?: PositionPov | null;
  fenBefore?: string;
  playedSan?: string;
  bestSan?: string | null;
  usedTips?: Set<string>;
}): string[] {
  if (!args.noteWorthy) return [];
  if (args.perspective === "opponent" && args.deltaCp < 80) return [];

  const themes = new Set<string>(args.structure);
  const pov = args.pov;
  const used = args.usedTips || new Set<string>();
  const citeKing =
    pov &&
    args.fenBefore &&
    args.playedSan
      ? kingMotifRelevant({
          fenBefore: args.fenBefore,
          playedSan: args.playedSan,
          bestSan: args.bestSan || null,
          pov,
          usedTips: used,
        })
      : Boolean(pov?.kingMotifLive && canCiteKingMotif(used));

  if (pov && citeKing) {
    for (const t of pov.themes) {
      if (KING_MOTIF_THEMES.has(t) || t === "prophylaxis") themes.add(t);
    }
  }

  if (args.perspective === "opponent") {
    themes.add("weakness_exploitation");
    themes.add("counterplay");
    if (citeKing && pov?.oppKingExposed) {
      themes.add("opp_king_exposed");
      themes.add("forcing_moves");
    } else {
      themes.add("forcing_moves");
      themes.add("piece_activity");
    }
    return [...themes];
  }

  if (args.errorKind === "missed_opportunity") {
    themes.add("missed_opportunity");
    themes.add("forcing_moves");
    themes.add("initiative");
    if (citeKing && pov?.oppKingExposed) themes.add("opp_king_exposed");
  }
  if (args.errorKind === "mistake") {
    themes.add("prophylaxis");
    if (citeKing && pov?.userKingExposed) {
      themes.add("user_king_exposed");
      themes.add("defense");
    } else if (citeKing && pov?.oppKingExposed) {
      themes.add("opp_king_exposed");
      themes.add("missed_opportunity");
    } else {
      themes.add("piece_activity");
      themes.add("forcing_moves");
    }
  }
  if (args.phase === "opening" && (args.deltaCp >= 80 || args.moment)) {
    themes.add("development");
    themes.add("centre");
  }
  if (args.phase === "endgame" && (args.deltaCp >= 80 || args.moment)) {
    themes.add("endgame_technique");
    themes.add("conversion");
  }

  if (args.openingTags.length && (args.phase === "opening" || args.phase === "middlegame")) {
    themes.add("centre");
    themes.add("pawn_breaks");
    themes.add("named_opening");
    themes.add("opening_plan");
    for (const t of args.openingTags) themes.add(t);
  }
  if (args.phase === "middlegame" && args.noteWorthy) {
    themes.add("piece_activity");
    themes.add("planning");
  }
  if (args.phase === "endgame" && args.noteWorthy) {
    themes.add("endgame_technique");
  }

  // Metrics: drop sticky king-safety labels when motif is dead on this board
  for (const t of args.metricsThemes || []) {
    if (!(args.moment || args.deltaCp >= 80)) continue;
    if (KING_MOTIF_THEMES.has(t) && !citeKing) continue;
    themes.add(t);
  }

  if (args.moment) {
    themes.add("initiative");
    if (args.moment.severity === "blunder") {
      if (citeKing && pov?.userKingExposed) {
        themes.add("user_king_exposed");
        themes.add("defense");
      } else {
        themes.add("forcing_moves");
      }
    }
  }

  if (args.deltaCp >= 80) themes.add("initiative");

  return [...themes];
}

function moveIsForcing(san: string | null): boolean {
  if (!san) return false;
  return /[+#x]/.test(san) || san.includes("=");
}

function bestLooksAggressive(args: {
  fenBefore: string;
  bestSan: string | null;
  oppColor: "w" | "b";
}): boolean {
  if (!args.bestSan) return false;
  if (moveIsForcing(args.bestSan)) return true;
  try {
    const board = new Chess(args.fenBefore);
    const move = board.move(args.bestSan);
    if (!move) return false;
    if (move.captured || move.san.includes("+") || move.san.includes("#")) return true;
    if (args.oppColor === "b" && kingUncastled(args.fenBefore, "b")) {
      const toRank = Number(move.to[1]);
      if (
        toRank >= 5 &&
        (move.piece === "n" || move.piece === "b" || move.piece === "q" || move.piece === "r")
      ) {
        return true;
      }
    }
    if (args.oppColor === "w" && kingUncastled(args.fenBefore, "w")) {
      const toRank = Number(move.to[1]);
      if (
        toRank <= 4 &&
        (move.piece === "n" || move.piece === "b" || move.piece === "q" || move.piece === "r")
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return moveIsForcing(args.bestSan);
  }
}

function playedCreatesWeakness(args: {
  fenBefore: string;
  playedSan: string;
  pov: PositionPov | null;
}): boolean {
  if (args.pov?.userKingExposed) return true;
  try {
    const board = new Chess(args.fenBefore);
    const move = board.move(args.playedSan);
    if (!move) return false;
    if (move.flags.includes("k") || move.flags.includes("q")) return false;
    const after = board.fen();
    if (
      kingUncastled(after, move.color) &&
      move.piece === "p" &&
      Math.abs(Number(move.to[1]) - Number(move.from[1])) === 2
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function classifyUserError(args: {
  fenBefore: string;
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  deltaCp: number;
  themes: string[];
  userColor: "white" | "black";
  moment?: CoachMetricMoment | null;
  pov?: PositionPov | null;
}): UserErrorKind {
  const threshold = args.moment ? 60 : 80;
  if (args.deltaCp < threshold && !args.moment) return null;
  if (args.bestSan && args.bestSan === args.playedSan) return null;

  const pov = args.pov || assessPositionPov(args.fenBefore, args.userColor);
  const oppColor = pov.oppColor;
  const aggressive = bestLooksAggressive({
    fenBefore: args.fenBefore,
    bestSan: args.bestSan,
    oppColor,
  });
  const motifHit =
    pov.kingMotifLive &&
    (moveRelatesToKingMotif({
      fenBefore: args.fenBefore,
      san: args.bestSan,
      pov,
    }) ||
      moveRelatesToKingMotif({
        fenBefore: args.fenBefore,
        san: args.playedSan,
        pov,
      }));
  const weakness = playedCreatesWeakness({
    fenBefore: args.fenBefore,
    playedSan: args.playedSan,
    pov,
  });

  // Motif only steers classification when the move actually touches it
  if (motifHit && pov.oppKingExposed && aggressive) return "missed_opportunity";
  if (aggressive && !weakness) return "missed_opportunity";
  if (weakness && !aggressive) return "mistake";
  if (aggressive && weakness) {
    return args.deltaCp >= 150 ? "mistake" : "missed_opportunity";
  }
  if (motifHit && pov.userKingExposed) return "mistake";
  return aggressive ? "missed_opportunity" : "mistake";
}

function lineHint(bestSan: string | null, bestPvSan: string[]): string {
  if (!bestSan) return "";
  return bestPvSan.slice(0, 3).join(" ") || bestSan;
}

function pickVariant(key: string, options: string[], usedTips: Set<string>): string {
  const idx = [...usedTips].filter((k) => k.startsWith(`var:${key}`)).length % options.length;
  usedTips.add(`var:${key}:${idx}`);
  return options[idx];
}

function explainUserMissed(args: {
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  fenBefore: string;
  userColor: "white" | "black";
  pov: PositionPov;
  usedTips: Set<string>;
  citeKing: boolean;
}): string {
  const line = lineHint(args.bestSan, args.bestPvSan);
  if (args.citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "miss-opp-king",
      line
        ? [
            `${args.playedSan} misses the chance to punish their soft king; ${line} keeps the pressure on.`,
            `${args.playedSan} lets their king breathe — ${line} asks the harder question.`,
          ]
        : [
            `${args.playedSan} misses the chance to punish their soft king while it still matters.`,
          ],
      args.usedTips
    );
  }
  if (line) {
    return pickVariant(
      "miss-generic",
      [
        `${args.playedSan} misses the chance to seize the initiative; ${line} takes the temporary weakness.`,
        `${args.playedSan} is too slow here — ${line} capitalizes while the chance is open.`,
        `A concrete chance goes by with ${args.playedSan}; ${line} was the way to take it.`,
      ],
      args.usedTips
    );
  }
  return `${args.playedSan} misses a chance to punish the position while the opportunity is still open.`;
}

function explainUserMistake(args: {
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  themes: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  citeKing: boolean;
}): string {
  const line = lineHint(args.bestSan, args.bestPvSan);

  if (args.citeKing && args.pov.oppKingExposed && !args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "mist-but-attack",
      line
        ? [
            `${args.playedSan} drifts while their king is soft; ${line} keeps you pressing.`,
            `${args.playedSan} hands back the initiative; ${line} was the pressing idea.`,
          ]
        : [`${args.playedSan} drifts while their king is soft — stay pressing.`],
      args.usedTips
    );
  }

  if (args.citeKing && args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "mist-own-king",
      line
        ? [
            `${args.playedSan} leaves your king more exposed; ${line} keeps you safer while holding the plan.`,
            `${args.playedSan} opens air around your king; ${line} covers the danger first.`,
          ]
        : [
            `${args.playedSan} leaves your king more exposed without enough compensation.`,
          ],
      args.usedTips
    );
  }

  if (
    args.themes.includes("iqp") ||
    args.themes.includes("hanging_pawns") ||
    args.themes.includes("pawn_chain") ||
    args.themes.includes("passed_pawn")
  ) {
    return line
      ? `${args.playedSan} softens the pawn structure; ${line} keeps the skeleton healthier.`
      : `${args.playedSan} softens the pawn structure without enough activity in return.`;
  }

  return pickVariant(
    "mist-generic",
    line
      ? [
          `${args.playedSan} creates problems that were avoidable; ${line} holds the position better.`,
          `${args.playedSan} loses the thread; ${line} keeps coordination and the plan intact.`,
        ]
      : [
          `${args.playedSan} creates problems that were avoidable in this structure.`,
        ],
    args.usedTips
  );
}

function explainOpponentMistake(args: {
  san: string;
  deltaCp: number;
  opponentBestSan: string | null;
  bestPvSan: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  fenBefore: string;
  themes: string[];
}): string {
  const abandoned = args.opponentBestSan
    ? ` A sturdier try was ${args.bestPvSan.slice(0, 3).join(" ") || args.opponentBestSan}.`
    : "";
  const citeKing = kingMotifRelevant({
    fenBefore: args.fenBefore,
    playedSan: args.san,
    bestSan: args.opponentBestSan,
    pov: args.pov,
    usedTips: args.usedTips,
  });
  if (citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "opp-soft-king",
      [
        `Their ${args.san} softens the king cover — open a line or check before they repair it.${abandoned}`,
        `Capitalize: after ${args.san} their king is still soft; keep forcing answers instead of slow improving moves.${abandoned}`,
      ],
      args.usedTips
    );
  }
  if (args.themes.includes("iqp") || args.themes.includes("hanging_pawns")) {
    return pickVariant(
      "opp-struct",
      [
        `Their ${args.san} mishandles the pawn structure — blockade or pressure the new weakness before they untangle.${abandoned}`,
        `Structure gift: ${args.san} leaves a soft pawn complex; sit on the hole and pile up.${abandoned}`,
        `After ${args.san} the pawn skeleton softens — freeze the weakness and bring a second attacker before they repair it.${abandoned}`,
      ],
      args.usedTips
    );
  }
  if (args.themes.includes("open_file") || args.themes.includes("open_c_file")) {
    return pickVariant(
      "opp-file",
      [
        `Their ${args.san} concedes file control — seize the open line and eye the 7th before they contest it.${abandoned}`,
        `File gift after ${args.san}: double or invade while their majors are still off the highway.${abandoned}`,
      ],
      args.usedTips
    );
  }
  if (args.themes.includes("space") || args.themes.includes("development")) {
    return pickVariant(
      "opp-dev",
      [
        `Their ${args.san} loses a tempo in development/space — open the position or hit the lagging piece now.${abandoned}`,
        `Capitalize: ${args.san} leaves them behind in mobilization; force before they catch up.${abandoned}`,
      ],
      args.usedTips
    );
  }
  return pickVariant(
    "opp-soft",
    [
      `Their ${args.san} leaves a concrete soft spot — take the square, file, or tempo before they fix it.${abandoned}`,
      `Capitalize on ${args.san}: the evaluation swing means a loose piece, open line, or missed threat is available now.${abandoned}`,
      `They erred with ${args.san}; name the gap (hanging unit, soft square, delayed development) and hit it immediately.${abandoned}`,
      `After ${args.san} you get a free question — answer with a forcing move that makes their next repair costly.${abandoned}`,
    ],
    args.usedTips
  );
}

function explainGoodMove(args: {
  san: string;
  bestPvSan: string[];
  themes: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  citeKing: boolean;
}): string {
  const follow = args.bestPvSan.slice(1, 3).join(" ");
  if (args.citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "good-attack",
      [
        `${args.san} keeps the pressure on their soft king${follow ? ` — ideas like ${follow} stay alive` : ""}.`,
        `${args.san} asks the right question while their king is still exposed.`,
        `${args.san} keeps the attack tempo — do not trade the initiative for a quiet side plan.`,
      ],
      args.usedTips
    );
  }
  if (args.themes.some((t) => t.startsWith("opening_") || t === "named_opening")) {
    return pickVariant(
      "good-book",
      [
        `${args.san} fits the book plan for this opening — stay with the structure's natural break.`,
        `${args.san} matches the opening's typical jobs (develop, centre, prepare the thematic break).`,
        `${args.san} keeps you inside the opening's intended middlegame — next: improve the piece that serves that plan.`,
      ],
      args.usedTips
    );
  }
  if (args.themes.includes("development") || args.themes.includes("centre")) {
    return pickVariant(
      "good-open",
      [
        `${args.san} fits the opening jobs: develop, centre, or king safety.`,
        `${args.san} keeps the opening plan coherent — pieces and centre moving together.`,
        `${args.san} is a healthy developing move; connect the remaining pieces before inventing a wing attack.`,
      ],
      args.usedTips
    );
  }
  if (
    args.themes.includes("iqp") ||
    args.themes.includes("hanging_pawns") ||
    args.themes.includes("pawn_chain") ||
    args.themes.includes("space") ||
    args.themes.includes("minority_attack")
  ) {
    return pickVariant(
      "good-struct",
      [
        `${args.san} respects the structure — the plan stays tied to the pawn skeleton.`,
        `${args.san} improves a piece that actually hits the structural target.`,
        `${args.san} plays the structure correctly; keep restraining their break while you build on yours.`,
      ],
      args.usedTips
    );
  }
  if (args.themes.includes("endgame_technique") || args.themes.includes("passed_pawn")) {
    return pickVariant(
      "good-end",
      [
        `${args.san} is clean endgame technique — activate, create/pass the passer, cut counterplay.`,
        `${args.san} keeps the ending under control; next improve the king or the rook behind the passer.`,
      ],
      args.usedTips
    );
  }
  return pickVariant(
    "good-generic",
    [
      `${args.san} matches what the position asks for — keep the same plan on the next move.`,
      `${args.san} is the clean choice; the follow-up is to improve the worst-placed piece toward the same target.`,
      `${args.san} holds the thread — compare any alternative to this idea before drifting.`,
      `${args.san} is accurate; treat quieter alternatives as wrong unless they serve the same target.`,
    ],
    args.usedTips
  );
}

const MOMENT_OPENERS = [
  (n: number) => `Move ${n}`,
  (n: number) => `Around move ${n}`,
  (n: number) => `Here at move ${n}`,
  (n: number) => `At move ${n}`,
  (n: number) => `By move ${n}`,
] as const;

const MOMENT_HINGE = [
  "is a turning point",
  "is a hinge moment",
  "marks a real shift",
  "is where the game tilts",
  "is the inflection",
  "is where the thread changes",
] as const;

const MOMENT_HINGE_TAIL = [
  "in the evaluation",
  "on the board",
  "for both sides",
  "in this game",
] as const;

const MOMENT_SWING = [
  "the score swung",
  "the balance shifted hard",
  "the assessment flipped",
  "the evaluation jumped",
  "the position changed character",
] as const;

const MOMENT_CHANCE = [
  "this is where the chance mattered",
  "the opportunity was real here",
  "the window was open here",
  "this is the moment that counted",
  "the practical chance lived here",
] as const;

const MOMENT_FRAME = [
  "this is the critical stretch",
  "treat this as the decisive stretch",
  "the game's direction is decided around here",
  "pay attention — the fight pivots here",
] as const;

function momentBit(moment: CoachMetricMoment, usedTips: Set<string>): string {
  const key = `moment:${moment.ply}`;
  if (usedTips.has(key)) return "";
  usedTips.add(key);

  const n = moment.moveNumber;
  const opener = pickVariant(
    "moment-opener",
    MOMENT_OPENERS.map((fn) => fn(n)),
    usedTips
  );
  const shape = pickVariant(
    "moment-shape",
    [
      "hinge",
      "swing-chance",
      "hinge-chance",
      "swing-frame",
      "frame",
      "swing-hinge",
    ],
    usedTips
  );

  if (shape === "hinge") {
    const hinge = pickVariant("moment-hinge", [...MOMENT_HINGE], usedTips);
    const tail = pickVariant("moment-hinge-tail", [...MOMENT_HINGE_TAIL], usedTips);
    return `${opener} ${hinge} ${tail}.`;
  }
  if (shape === "swing-chance") {
    const swing = pickVariant("moment-swing", [...MOMENT_SWING], usedTips);
    const chance = pickVariant("moment-chance", [...MOMENT_CHANCE], usedTips);
    return `${opener} ${swing} — ${chance}.`;
  }
  if (shape === "hinge-chance") {
    const hinge = pickVariant("moment-hinge", [...MOMENT_HINGE], usedTips);
    const chance = pickVariant("moment-chance", [...MOMENT_CHANCE], usedTips);
    return `${opener} ${hinge} — ${chance}.`;
  }
  if (shape === "swing-frame") {
    const swing = pickVariant("moment-swing", [...MOMENT_SWING], usedTips);
    const frame = pickVariant("moment-frame", [...MOMENT_FRAME], usedTips);
    return `${opener} ${swing}; ${frame}.`;
  }
  if (shape === "frame") {
    const frame = pickVariant("moment-frame", [...MOMENT_FRAME], usedTips);
    return `${opener}: ${frame}.`;
  }
  const swing = pickVariant("moment-swing", [...MOMENT_SWING], usedTips);
  const hinge = pickVariant("moment-hinge", [...MOMENT_HINGE], usedTips);
  const tail = pickVariant("moment-hinge-tail", [...MOMENT_HINGE_TAIL], usedTips);
  return `${opener} ${swing} — ${hinge} ${tail}.`;
}

function rephraseConcept(
  text: string,
  attackSide: AttackSide,
  pov: PositionPov,
  usedTips: Set<string>,
  citeKing: boolean
): string {
  let out = text;
  if (!citeKing && /king/i.test(out)) {
    return pickVariant(
      "concept-non-king",
      [
        "Stay concrete — checks, captures, and threats before quiet improving moves.",
        "Name the current target: loose piece, open file, or weak pawn — then move toward it.",
        "Improve the worst-placed piece that hits today's weakness, not yesterday's motif.",
      ],
      usedTips
    );
  }
  if (citeKing && /king/i.test(out)) {
    if (pov.oppKingExposed && !pov.userKingExposed) {
      out = out
        .replace(/your king/gi, "their king")
        .replace(/While your king/gi, "While their king");
    } else if (pov.userKingExposed && !pov.oppKingExposed) {
      out = out.replace(/their king/gi, "your king");
    }
  }
  if (
    citeKing &&
    attackSide === "user" &&
    /defence|defense|protect/i.test(out) &&
    pov.oppKingExposed
  ) {
    out = pickVariant(
      "concept-attack",
      [
        "With their king soft, forcing moves and open lines beat slow prophylaxis.",
        "You should be asking questions — keep the attack tempo.",
      ],
      usedTips
    );
  }
  const fp = out.slice(0, 40);
  if (usedTips.has(`concept:${fp}`)) {
    return pickVariant(
      "concept-alt",
      [
        "Same idea, different words: improve the piece that hits the soft spot.",
        "Stay concrete — checks, captures, and threats before quiet moves.",
        "Keep naming today's target — then move toward it.",
      ],
      usedTips
    );
  }
  usedTips.add(`concept:${fp}`);
  return out;
}

export function shouldComposeNote(args: {
  perspective: NotePerspective;
  deltaCp: number;
  playedBest: boolean;
  moment?: CoachMetricMoment | null;
  structure: string[];
  errorKind?: UserErrorKind;
  ply: number;
  /** Count of user plies so far — for ~1/4 good-move notes */
  userPlyCount?: number;
}): boolean {
  if (args.perspective === "user") {
    if (args.moment) return true;
    if (args.errorKind === "mistake" || args.errorKind === "missed_opportunity") {
      return true;
    }
    if (args.deltaCp >= 80) return true;
    // Good / quiet teaching notes ~1 in 4 user moves
    const good =
      args.playedBest || args.deltaCp < 40 || args.errorKind === "good";
    if (good) {
      const n = args.userPlyCount ?? Math.ceil(args.ply / 2);
      return n % 4 === 1;
    }
    return false;
  }
  // Opponent mistakes — slightly lower bar, richer capitalize notes
  return args.deltaCp >= 80;
}

function assembleParts(
  chunks: Array<string | null | undefined>,
  orderSeed: number
): string {
  const parts = chunks.filter((c): c is string => Boolean(c && c.trim()));
  if (parts.length <= 2) return parts.join(" ");
  // Vary order: concept before/after judgment
  if (orderSeed % 3 === 1 && parts.length >= 2) {
    const [a, b, ...rest] = parts;
    return [b, a, ...rest].join(" ");
  }
  if (orderSeed % 3 === 2 && parts.length >= 3) {
    const [a, b, c, ...rest] = parts;
    return [a, c, b, ...rest].join(" ");
  }
  return parts.join(" ");
}

export function composeCoachNote(args: {
  side: "white" | "black";
  userColor: "white" | "black";
  san: string;
  fenBefore: string;
  fenAfter?: string;
  deltaCp: number;
  bestSan: string | null;
  bestPvSan: string[];
  themes: string[];
  concepts: string[];
  usedTips: Set<string>;
  openingLabel: string;
  openingTags?: string[];
  ply: number;
  phase: "opening" | "middlegame" | "endgame";
  metrics?: CoachGameMetrics | null;
  moment?: CoachMetricMoment | null;
  errorKind?: UserErrorKind;
  pov?: PositionPov | null;
  playedBest?: boolean;
  userPlyCount?: number;
}): string {
  const perspective: NotePerspective =
    args.side === args.userColor ? "user" : "opponent";
  const pov =
    args.pov ||
    assessPositionPov(args.fenAfter || args.fenBefore, args.userColor);
  const moment = perspective === "user" ? args.moment || null : null;
  const citeKing = kingMotifRelevant({
    fenBefore: args.fenBefore,
    playedSan: args.san,
    bestSan: args.bestSan,
    pov,
    usedTips: args.usedTips,
  });
  const playedBest =
    args.playedBest ?? Boolean(args.bestSan && args.bestSan === args.san);

  const plan = phasePlanNote({
    phase: args.phase,
    ply: args.ply,
    openingLabel: args.openingLabel,
    openingTags: args.openingTags || [],
    structure: args.themes,
    pov,
    usedTips: args.usedTips,
  });

  const conceptBits = args.concepts
    .slice(0, perspective === "opponent" ? 2 : 1)
    .map((c) =>
      rephraseConcept(c, pov.attackSide, pov, args.usedTips, citeKing)
    );

  if (perspective === "opponent") {
    if (args.deltaCp < 80) {
      return plan || "";
    }
    return assembleParts(
      [
        plan,
        explainOpponentMistake({
          san: args.san,
          deltaCp: args.deltaCp,
          opponentBestSan: args.bestSan,
          bestPvSan: args.bestPvSan,
          pov,
          usedTips: args.usedTips,
          fenBefore: args.fenBefore,
          themes: args.themes,
        }),
        ...conceptBits,
      ],
      args.ply
    );
  }

  let errorKind =
    args.errorKind ??
    classifyUserError({
      fenBefore: args.fenBefore,
      playedSan: args.san,
      bestSan: args.bestSan,
      bestPvSan: args.bestPvSan,
      deltaCp: args.deltaCp,
      themes: args.themes,
      userColor: args.userColor,
      moment,
      pov,
    });

  const wantGood =
    !errorKind &&
    !moment &&
    (playedBest || args.deltaCp < 40) &&
    shouldComposeNote({
      perspective: "user",
      deltaCp: args.deltaCp,
      playedBest,
      moment,
      structure: args.themes,
      errorKind: "good",
      ply: args.ply,
      userPlyCount: args.userPlyCount,
    });
  if (wantGood) errorKind = "good";

  if (!errorKind && !moment && !plan) {
    return "";
  }

  const turnBit = moment ? momentBit(moment, args.usedTips) : "";

  let judgment = "";
  if (errorKind === "good") {
    judgment = explainGoodMove({
      san: args.san,
      bestPvSan: args.bestPvSan,
      themes: args.themes,
      pov,
      usedTips: args.usedTips,
      citeKing,
    });
  } else if (
    errorKind === "missed_opportunity" ||
    (moment && !errorKind && args.deltaCp < 150) ||
    (errorKind === "mistake" && citeKing && pov.oppKingExposed && !pov.userKingExposed)
  ) {
    judgment = explainUserMissed({
      playedSan: args.san,
      bestSan: args.bestSan,
      bestPvSan: args.bestPvSan,
      fenBefore: args.fenBefore,
      userColor: args.userColor,
      pov,
      usedTips: args.usedTips,
      citeKing,
    });
  } else if (errorKind === "mistake" || moment) {
    judgment = explainUserMistake({
      playedSan: args.san,
      bestSan: args.bestSan,
      bestPvSan: args.bestPvSan,
      themes: args.themes,
      pov,
      usedTips: args.usedTips,
      citeKing,
    });
  }

  return assembleParts(
    [plan, turnBit, ...conceptBits, judgment],
    args.ply
  );
}

export { assessPositionPov };
