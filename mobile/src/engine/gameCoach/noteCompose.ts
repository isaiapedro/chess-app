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

export type NotePerspective = "user" | "opponent";

export type UserErrorKind = "mistake" | "missed_opportunity" | null;

const PHASE_PLAN_KEY = {
  opening: "plan:opening",
  middlegame: "plan:middlegame",
  endgame: "plan:endgame",
} as const;

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

  if (args.openingTags.length && args.phase === "opening") {
    themes.add("centre");
    themes.add("pawn_breaks");
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
  pov: PositionPov;
  usedTips: Set<string>;
  fenBefore: string;
}): string {
  const abandoned = args.opponentBestSan
    ? ` They could have held with ${args.opponentBestSan}.`
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
        `Their ${args.san} leaves the king soft — keep forcing answers.${abandoned}`,
        `Capitalize: their king is still soft after ${args.san}.${abandoned}`,
      ],
      args.usedTips
    );
  }
  return pickVariant(
    "opp-soft",
    [
      `Their ${args.san} leaves something soft — take the square, file, or tempo before they repair it.${abandoned}`,
      `Capitalize on ${args.san}: hit the loose point they just created.${abandoned}`,
    ],
    args.usedTips
  );
}

function openingPlanBit(
  openingLabel: string,
  pov: PositionPov,
  usedTips: Set<string>
): string {
  if (usedTips.has(PHASE_PLAN_KEY.opening)) return "";
  usedTips.add(PHASE_PLAN_KEY.opening);
  const name = openingLabel || "this opening";
  if (pov.kingMotifLive && pov.oppKingExposed) {
    return `${name}: develop with tempo while their king is still soft.`;
  }
  if (pov.kingMotifLive && pov.userKingExposed) {
    return `${name}: finish development and tuck your king before starting wing play.`;
  }
  return `${name}: fight the centre, develop minors, and castle before pawn storms.`;
}

function middlegamePlanBit(pov: PositionPov, usedTips: Set<string>): string {
  if (usedTips.has(PHASE_PLAN_KEY.middlegame)) return "";
  usedTips.add(PHASE_PLAN_KEY.middlegame);
  // Only name king attack/defense if motif still live now
  if (pov.kingMotifLive && (pov.attackSide === "user" || pov.oppKingExposed)) {
    return "Middlegame plan: their king is still a live target — open lines and improve attackers.";
  }
  if (pov.kingMotifLive && (pov.attackSide === "opponent" || pov.userKingExposed)) {
    return "Middlegame plan: your king needs cover — contest open files, trade their lead attacker, then counterbreak.";
  }
  return "Middlegame plan: name a target (weak pawn, open file, or outpost), improve pieces toward it, restrain their break.";
}

function momentBit(moment: CoachMetricMoment, usedTips: Set<string>): string {
  const key = `moment:${moment.ply}`;
  if (usedTips.has(key)) return "";
  usedTips.add(key);
  return `Move ${moment.moveNumber} is a turning point in the evaluation.`;
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
}): boolean {
  if (args.perspective === "user") {
    if (args.moment) return true;
    return Boolean(args.errorKind) || args.deltaCp >= 80;
  }
  // Opponent mistakes only — how to capitalize
  return args.deltaCp >= 100;
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
  ply: number;
  phase: "opening" | "middlegame" | "endgame";
  metrics?: CoachGameMetrics | null;
  moment?: CoachMetricMoment | null;
  errorKind?: UserErrorKind;
  pov?: PositionPov | null;
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

  const parts: string[] = [];

  if (args.phase === "opening" && args.ply <= 10) {
    const op = openingPlanBit(args.openingLabel, pov, args.usedTips);
    if (op) parts.push(op);
  }
  if (args.phase === "middlegame") {
    const mg = middlegamePlanBit(pov, args.usedTips);
    if (mg) parts.push(mg);
  }

  if (perspective === "opponent") {
    if (args.deltaCp < 100) return parts.join(" ");
    parts.push(
      explainOpponentMistake({
        san: args.san,
        deltaCp: args.deltaCp,
        opponentBestSan: args.bestSan,
        pov,
        usedTips: args.usedTips,
        fenBefore: args.fenBefore,
      })
    );
    if (args.concepts[0]) {
      parts.push(
        rephraseConcept(
          args.concepts[0],
          pov.attackSide,
          pov,
          args.usedTips,
          citeKing
        )
      );
    }
    return parts.join(" ");
  }

  const errorKind =
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

  if (!errorKind && !moment) {
    return parts.join(" ");
  }

  if (moment) {
    const bit = momentBit(moment, args.usedTips);
    if (bit) parts.push(bit);
  }

  if (args.concepts[0]) {
    parts.push(
      rephraseConcept(
        args.concepts[0],
        pov.attackSide,
        pov,
        args.usedTips,
        citeKing
      )
    );
  }

  const preferMiss =
    errorKind === "missed_opportunity" ||
    (moment && !errorKind && args.deltaCp < 150) ||
    (errorKind === "mistake" && citeKing && pov.oppKingExposed && !pov.userKingExposed);

  if (preferMiss) {
    parts.push(
      explainUserMissed({
        playedSan: args.san,
        bestSan: args.bestSan,
        bestPvSan: args.bestPvSan,
        fenBefore: args.fenBefore,
        userColor: args.userColor,
        pov,
        usedTips: args.usedTips,
        citeKing,
      })
    );
  } else if (errorKind || moment) {
    parts.push(
      explainUserMistake({
        playedSan: args.san,
        bestSan: args.bestSan,
        bestPvSan: args.bestPvSan,
        themes: args.themes,
        pov,
        usedTips: args.usedTips,
        citeKing,
      })
    );
  }

  return parts.join(" ");
}

export { assessPositionPov };
