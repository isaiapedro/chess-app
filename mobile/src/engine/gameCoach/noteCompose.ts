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
import {
  assessBoardFacts,
  noteHasSubstance,
  textFitsBoard,
} from "./noteRelevance";
import { detectTacticalFact, type TacticalFact } from "./tacticalFact";

const STRUCTURE_NOTE_THEMES = [
  "iqp",
  "hanging_pawns",
  "doubled_pawns",
  "passed_pawn",
  "pawn_chain",
] as const;

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

  if (args.openingTags.length && args.phase === "opening") {
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
  fenAfter?: string;
  userColor: "white" | "black";
  themes: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  citeKing: boolean;
  deltaCp: number;
  evalBeforeWhite?: number | null;
  evalAfterWhite?: number | null;
  opponentReplySan?: string | null;
}): string {
  const line = lineHint(args.bestSan, args.bestPvSan);
  const tact = detectTacticalFact({
    fenBefore: args.fenBefore,
    fenAfter: args.fenAfter,
    playedSan: args.playedSan,
    bestSan: args.bestSan,
    bestPvSan: args.bestPvSan,
    userColor: args.userColor,
    deltaCp: args.deltaCp,
    evalBeforeWhite: args.evalBeforeWhite,
    evalAfterWhite: args.evalAfterWhite,
    opponentReplySan: args.opponentReplySan,
  });
  const tactBit = tacticalJudgment(tact, args.playedSan, line, "miss", args.usedTips);
  if (tactBit) return tactBit;

  const structBit = structureDepthNote({
    themes: args.themes,
    san: args.playedSan,
    line,
    mode: "mistake",
  });
  if (structBit) return structBit;

  if (args.citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "miss-opp-king",
      line
        ? [
            `${args.playedSan} misses a chance to press their soft king; ${line} keeps the pressure on.`,
            `${args.playedSan} lets their king breathe — ${line} asks the harder question.`,
          ]
        : [
            `${args.playedSan} misses a chance to press their soft king while it still matters.`,
          ],
      args.usedTips
    );
  }

  return assetsVulnerabilitiesNote({
    themes: args.themes,
    san: args.playedSan,
    line,
    pov: args.pov,
    citeKing: args.citeKing,
    mode: "miss",
    usedTips: args.usedTips,
  });
}

function tacticalJudgment(
  tact: TacticalFact,
  playedSan: string,
  line: string,
  mode: "miss" | "mistake" | "opp",
  _usedTips: Set<string>
): string {
  if (!tact.kind) return "";
  if (tact.kind === "missed_capture" && tact.pieceLabel) {
    if (mode === "opp") return "";
    const cap = tact.captureSan || line;
    return cap
      ? `${playedSan} misses a free ${tact.pieceLabel} sitting there — ${cap}.`
      : `${playedSan} misses a free ${tact.pieceLabel} sitting there.`;
  }
  if (tact.kind === "gave_piece" && tact.pieceLabel) {
    if (mode === "opp") {
      return tact.takenNext
        ? `Their ${playedSan} hangs a ${tact.pieceLabel} — go ahead and take it.`
        : `Their ${playedSan} leaves a ${tact.pieceLabel} hanging — go ahead and take it.`;
    }
    if (tact.takenNext) {
      return line
        ? `${playedSan} hangs a ${tact.pieceLabel} and they take it; ${line} keeps it safer.`
        : `${playedSan} hangs a ${tact.pieceLabel} and they take it.`;
    }
    return line
      ? `${playedSan} leaves a ${tact.pieceLabel} hanging; ${line} keeps it safer.`
      : `${playedSan} leaves a ${tact.pieceLabel} hanging.`;
  }
  if (tact.kind === "bad_trade" && tact.pieceLabel) {
    if (mode === "opp") {
      return tact.takenNext
        ? `Their ${playedSan} is a losing trade of a ${tact.pieceLabel} — punish it.`
        : `Their ${playedSan} offers a losing trade of a ${tact.pieceLabel} — take the deal.`;
    }
    return line
      ? `${playedSan} is an uneven trade of a ${tact.pieceLabel}; ${line} keeps the material.`
      : `${playedSan} is an uneven trade — you drop a ${tact.pieceLabel}.`;
  }
  if (tact.kind === "sacrifice" && tact.pieceLabel) {
    if (mode === "opp") {
      return `Their ${playedSan} offers a ${tact.pieceLabel} sacrifice — weigh whether to take.`;
    }
    return tact.takenNext
      ? `${playedSan} is a ${tact.pieceLabel} sacrifice — check that the compensation is real.`
      : `${playedSan} offers a ${tact.pieceLabel}; keep the initiative if they decline.`;
  }
  if (tact.kind === "missed_tactic") {
    const hit = tact.captureSan || line;
    if (mode === "opp") {
      return hit
        ? `Their ${playedSan} walks into ${hit}.`
        : `Their ${playedSan} walks into a tactic.`;
    }
    return hit
      ? `${playedSan} misses the tactic ${hit}.`
      : `${playedSan} misses a forcing tactic that was there.`;
  }
  return "";
}

/** Keep at most two sentences; drop empty chunks. */
function limitSentences(chunks: Array<string | null | undefined>, max = 2): string {
  const text = chunks
    .filter((c): c is string => Boolean(c && c.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts || parts.length <= max) return text;
  return parts
    .slice(0, max)
    .map((s) => s.trim())
    .join(" ");
}

function structureDepthNote(args: {
  themes: string[];
  san: string;
  line: string;
  mode: "mistake" | "good" | "opp";
}): string {
  if (args.themes.includes("iqp")) {
    if (args.mode === "good") {
      return `${args.san} keeps the isolani useful — stay active on the open files and outposts before a quiet ending.`;
    }
    if (args.mode === "opp") {
      return `Their ${args.san} leaves the isolani soft — blockade d5/d4, trade pieces, steer for the ending.`;
    }
    return args.line
      ? `${args.san} doesn't handle the isolani well; ${args.line} keeps activity or heads for a favorable trade.`
      : `${args.san} lets the isolani sit quiet — use the open files or trade into a better ending.`;
  }
  if (args.themes.includes("hanging_pawns")) {
    if (args.mode === "good") {
      return `${args.san} treats the hanging pawns right — keep them mobile or break before they get fixed.`;
    }
    if (args.mode === "opp") {
      return `Their ${args.san} freezes hanging pawns — restrain the duo, then pile on the base.`;
    }
    return args.line
      ? `${args.san} lets the hanging pawns get fixed; ${args.line} keeps mobility or pressure.`
      : `${args.san} risks freezing the hanging pawns — break or restrain; don't leave them static.`;
  }
  if (args.themes.includes("doubled_pawns")) {
    if (args.mode === "good") {
      return `${args.san} lives with the doubled complex — use the open file or undouble cleanly.`;
    }
    if (args.mode === "opp") {
      return `Their ${args.san} leaves doubled pawns — fix and pressure the front pawn.`;
    }
    return args.line
      ? `${args.san} makes the doubled pawns worse; ${args.line} keeps the structure healthier.`
      : `${args.san} softens the doubled complex — pressure the front pawn or undouble.`;
  }
  if (args.themes.includes("passed_pawn")) {
    if (args.mode === "good") {
      return `${args.san} respects the passer — escort it or force their pieces into a passive block.`;
    }
    if (args.mode === "opp") {
      return `Their ${args.san} doesn't handle the passer well — blockade it or create a second weakness.`;
    }
    return args.line
      ? `${args.san} loses the thread vs the passer; ${args.line} blockades or pushes correctly.`
      : `${args.san} doesn't handle the passed pawn well — blockade theirs or escort yours.`;
  }
  if (args.themes.includes("pawn_chain")) {
    if (args.mode === "good") {
      return `${args.san} plays the chain — attack the base or advance on the tip's wing.`;
    }
    return args.line
      ? `${args.san} ignores the chain plan; ${args.line} hits the base or the right wing.`
      : `${args.san} drifts from the chain — hit the base or play where the tip points.`;
  }
  return "";
}

function assetsVulnerabilitiesNote(args: {
  themes: string[];
  san: string;
  line: string;
  pov: PositionPov;
  citeKing: boolean;
  mode: "mistake" | "miss" | "good" | "opp";
  usedTips: Set<string>;
}): string {
  if (STRUCTURE_NOTE_THEMES.some((t) => args.themes.includes(t))) {
    return "";
  }

  const assets: string[] = [];
  const vulns: string[] = [];

  if (args.themes.includes("bishop_pair")) assets.push("the bishop pair");
  if (args.themes.includes("space")) assets.push("the space advantage");
  if (args.themes.includes("open_c_file")) assets.push("the open c-file");
  else if (args.themes.includes("open_file")) assets.push("the open file");

  if (args.citeKing && args.pov.userKingExposed) vulns.push("your king safety");
  if (args.citeKing && args.pov.oppKingExposed) vulns.push("their exposed king");

  if (!assets.length && !vulns.length) return "";

  if (args.citeKing && (args.pov.userKingExposed || args.pov.oppKingExposed)) {
    markKingMotifCited(args.usedTips);
  }

  const assetBit = assets[0] || null;
  const vulnBit = vulns[0] || null;
  const prefix =
    args.mode === "opp" ? `Their ${args.san}` : args.san;

  if (assetBit && vulnBit) {
    if (args.mode === "good") {
      return `${prefix} leans on ${assetBit} while keeping an eye on ${vulnBit}.`;
    }
    if (args.mode === "opp") {
      return `${prefix} overlooks ${vulnBit} — use ${assetBit} now.`;
    }
    return args.line
      ? `${prefix} drifts from ${assetBit} while ${vulnBit} still matters; ${args.line} stays concrete.`
      : `${prefix} drifts from ${assetBit} while ${vulnBit} still matters.`;
  }
  if (vulnBit) {
    if (args.mode === "good") {
      return `${prefix} treats ${vulnBit} as the live problem on the board.`;
    }
    if (args.mode === "opp") {
      return `${prefix} softens ${vulnBit} — hit it before they fix it.`;
    }
    return args.line
      ? `${prefix} undersells ${vulnBit}; ${args.line} deals with it.`
      : `${prefix} undersells ${vulnBit} in this position.`;
  }
  if (assetBit) {
    if (args.mode === "good") {
      return `${prefix} uses ${assetBit} — keep that plus working.`;
    }
    if (args.mode === "opp") {
      return `${prefix} underuses ${assetBit} — take over that plus.`;
    }
    return args.line
      ? `${prefix} lets ${assetBit} go idle; ${args.line} keeps the plus.`
      : `${prefix} lets ${assetBit} go idle without a clear follow-up.`;
  }
  return "";
}

function explainUserMistake(args: {
  playedSan: string;
  bestSan: string | null;
  bestPvSan: string[];
  themes: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  citeKing: boolean;
  fenBefore: string;
  fenAfter?: string;
  userColor: "white" | "black";
  deltaCp: number;
  evalBeforeWhite?: number | null;
  evalAfterWhite?: number | null;
  opponentReplySan?: string | null;
}): string {
  const line = lineHint(args.bestSan, args.bestPvSan);
  const tact = detectTacticalFact({
    fenBefore: args.fenBefore,
    fenAfter: args.fenAfter,
    playedSan: args.playedSan,
    bestSan: args.bestSan,
    bestPvSan: args.bestPvSan,
    userColor: args.userColor,
    deltaCp: args.deltaCp,
    evalBeforeWhite: args.evalBeforeWhite,
    evalAfterWhite: args.evalAfterWhite,
    opponentReplySan: args.opponentReplySan,
  });
  const tactBit = tacticalJudgment(
    tact,
    args.playedSan,
    line,
    "mistake",
    args.usedTips
  );
  if (tactBit) return tactBit;

  const structBit = structureDepthNote({
    themes: args.themes,
    san: args.playedSan,
    line,
    mode: "mistake",
  });
  if (structBit) return structBit;

  if (args.citeKing && args.pov.oppKingExposed && !args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "mist-but-attack",
      line
        ? [
            `${args.playedSan} drifts while their king is still soft; ${line} keeps you pressing.`,
            `${args.playedSan} hands back the initiative; ${line} was the pressing idea.`,
          ]
        : [`${args.playedSan} drifts while their king is still soft — stay pressing.`],
      args.usedTips
    );
  }

  if (args.citeKing && args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "mist-own-king",
      line
        ? [
            `${args.playedSan} leaves your king a bit more open; ${line} keeps you safer while holding the plan.`,
            `${args.playedSan} opens air around your king; ${line} covers the danger first.`,
          ]
        : [
            `${args.playedSan} leaves your king a bit more open without enough compensation.`,
          ],
      args.usedTips
    );
  }

  return assetsVulnerabilitiesNote({
    themes: args.themes,
    san: args.playedSan,
    line,
    pov: args.pov,
    citeKing: args.citeKing,
    mode: "mistake",
    usedTips: args.usedTips,
  });
}

function explainOpponentMistake(args: {
  san: string;
  deltaCp: number;
  opponentBestSan: string | null;
  bestPvSan: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  fenBefore: string;
  fenAfter?: string;
  themes: string[];
  userColor: "white" | "black";
  evalBeforeWhite?: number | null;
  evalAfterWhite?: number | null;
  opponentReplySan?: string | null;
}): string {
  const line = lineHint(args.opponentBestSan, args.bestPvSan);
  const tact = detectTacticalFact({
    fenBefore: args.fenBefore,
    fenAfter: args.fenAfter,
    playedSan: args.san,
    bestSan: args.opponentBestSan,
    bestPvSan: args.bestPvSan,
    userColor: args.userColor === "white" ? "black" : "white",
    deltaCp: args.deltaCp,
    evalBeforeWhite: args.evalBeforeWhite,
    evalAfterWhite: args.evalAfterWhite,
    opponentReplySan: args.opponentReplySan,
  });
  const tactBit = tacticalJudgment(tact, args.san, line, "opp", args.usedTips);
  if (tactBit) return tactBit;

  const citeKing = kingMotifRelevant({
    fenBefore: args.fenBefore,
    playedSan: args.san,
    bestSan: args.opponentBestSan,
    pov: args.pov,
    usedTips: args.usedTips,
  });
  if (citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return `After ${args.san} their king is soft — keep forcing moves coming.`;
  }
  const structBit = structureDepthNote({
    themes: args.themes,
    san: args.san,
    line,
    mode: "opp",
  });
  if (structBit) return structBit;
  if (args.themes.includes("open_file") || args.themes.includes("open_c_file")) {
    return `Their ${args.san} gives up the file — claim it.`;
  }
  return assetsVulnerabilitiesNote({
    themes: args.themes,
    san: args.san,
    line,
    pov: args.pov,
    citeKing,
    mode: "opp",
    usedTips: args.usedTips,
  });
}

function explainGoodMove(args: {
  san: string;
  bestPvSan: string[];
  themes: string[];
  pov: PositionPov;
  usedTips: Set<string>;
  citeKing: boolean;
}): string {
  if (args.citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return `${args.san} keeps useful pressure on their king.`;
  }
  const structBit = structureDepthNote({
    themes: args.themes,
    san: args.san,
    line: "",
    mode: "good",
  });
  if (structBit) return structBit;
  return assetsVulnerabilitiesNote({
    themes: args.themes,
    san: args.san,
    line: "",
    pov: args.pov,
    citeKing: args.citeKing,
    mode: "good",
    usedTips: args.usedTips,
  });
}

function momentBit(_moment: CoachMetricMoment, _usedTips: Set<string>): string {
  return "";
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
    return "";
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
        "With their king soft, forcing moves and open lines beat slow defence.",
        "Keep asking questions — hold the attack tempo.",
      ],
      usedTips
    );
  }
  const fp = out.slice(0, 40);
  if (usedTips.has(`concept:${fp}`)) {
    return "";
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
  userPlyCount?: number;
}): boolean {
  const hasStructure = STRUCTURE_NOTE_THEMES.some((t) =>
    args.structure.includes(t)
  );
  if (args.perspective === "user") {
    if (args.moment) return true;
    if (args.errorKind === "mistake" || args.errorKind === "missed_opportunity") {
      return true;
    }
    if (args.deltaCp >= 80) return true;
    if (hasStructure) return true;
    const good =
      args.playedBest || args.deltaCp < 40 || args.errorKind === "good";
    if (good) {
      const n = args.userPlyCount ?? Math.ceil(args.ply / 2);
      return n % 4 === 1;
    }
    return false;
  }
  return args.deltaCp >= 80;
}

function finalizeNote(text: string): string {
  const out = limitSentences([text]);
  return noteHasSubstance(out) ? out : "";
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
  evalBeforeWhite?: number | null;
  evalAfterWhite?: number | null;
  opponentReplySan?: string | null;
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

  const buildPlan = () =>
    phasePlanNote({
      phase: args.phase,
      ply: args.ply,
      openingLabel: args.openingLabel,
      openingTags: args.openingTags || [],
      structure: args.themes,
      pov,
      usedTips: args.usedTips,
      fenAfter: args.fenAfter || args.fenBefore,
      playedSan: args.san,
    });

  const facts = assessBoardFacts({
    fenAfter: args.fenAfter || args.fenBefore,
    playedSan: args.san,
    ply: args.ply,
    phase: args.phase,
    themes: args.themes,
  });
  const buildConcepts = () =>
    args.concepts
      .slice(0, 1)
      .map((c) =>
        rephraseConcept(c, pov.attackSide, pov, args.usedTips, citeKing)
      )
      .filter((c) => c && textFitsBoard(c, facts) && noteHasSubstance(c));

  if (perspective === "opponent") {
    if (args.deltaCp < 80) return "";
    const judgment = explainOpponentMistake({
      san: args.san,
      deltaCp: args.deltaCp,
      opponentBestSan: args.bestSan,
      bestPvSan: args.bestPvSan,
      pov,
      usedTips: args.usedTips,
      fenBefore: args.fenBefore,
      fenAfter: args.fenAfter,
      themes: args.themes,
      userColor: args.userColor,
      evalBeforeWhite: args.evalBeforeWhite,
      evalAfterWhite: args.evalAfterWhite,
      opponentReplySan: args.opponentReplySan,
    });
    if (judgment) return finalizeNote(judgment);
    const plan = buildPlan();
    return finalizeNote(plan);
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
    (errorKind === "mistake" &&
      citeKing &&
      pov.oppKingExposed &&
      !pov.userKingExposed)
  ) {
    judgment = explainUserMissed({
      playedSan: args.san,
      bestSan: args.bestSan,
      bestPvSan: args.bestPvSan,
      fenBefore: args.fenBefore,
      fenAfter: args.fenAfter,
      userColor: args.userColor,
      themes: args.themes,
      pov,
      usedTips: args.usedTips,
      citeKing,
      deltaCp: args.deltaCp,
      evalBeforeWhite: args.evalBeforeWhite,
      evalAfterWhite: args.evalAfterWhite,
      opponentReplySan: args.opponentReplySan,
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
      fenBefore: args.fenBefore,
      fenAfter: args.fenAfter,
      userColor: args.userColor,
      deltaCp: args.deltaCp,
      evalBeforeWhite: args.evalBeforeWhite,
      evalAfterWhite: args.evalAfterWhite,
      opponentReplySan: args.opponentReplySan,
    });
  }

  const plan = buildPlan();
  const conceptBits = buildConcepts();

  if (errorKind === "mistake" || errorKind === "missed_opportunity") {
    if (judgment && noteHasSubstance(judgment)) {
      return finalizeNote(judgment);
    }
    return finalizeNote(limitSentences([plan, conceptBits[0]]));
  }
  if (errorKind === "good") {
    if (judgment && noteHasSubstance(judgment)) {
      return finalizeNote(limitSentences([judgment, plan]));
    }
    return finalizeNote(limitSentences([plan, conceptBits[0]]));
  }
  if (moment) {
    if (judgment && noteHasSubstance(judgment)) {
      return finalizeNote(judgment);
    }
    return finalizeNote(limitSentences([plan, conceptBits[0]]));
  }
  return finalizeNote(limitSentences([plan, conceptBits[0]]));
}

export { assessPositionPov };
