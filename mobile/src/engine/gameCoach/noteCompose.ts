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

import { adaptCoachTipForSide, phasePlanNote } from "./phasePlans";
import {
  assessBoardFacts,
  claimNoteText,
  isWeakFillerNote,
  noteHasSubstance,
  noteTextAlreadySaid,
  textFitsBoard,
} from "./noteRelevance";
import {
  describeStructureFeatures,
  WINDOWED_STRUCTURE_THEMES,
  type StructureFeature,
} from "./structureDetect";
import {
  claimNoteTopic,
  classifyNoteTopic,
  classifyPawnMoveTopic,
  kingMotifOutranksStructure,
  topicAlreadyUsed,
  topicRank,
  type NoteTopic,
} from "./noteTopics";
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

const MAX_KING_MOTIF_MENTIONS = 5;

const HIGH_VALUE_NOTE_THEMES = new Set([
  "king_safety",
  "opp_king_exposed",
  "user_king_exposed",
  "attack",
  "defense",
  "missed_opportunity",
  "counterplay",
  "weakness_exploitation",
  "forcing_moves",
  "tactics",
  "initiative",
  "imbalances",
]);

function highValueMotifActive(args: {
  pov?: PositionPov | null;
  themes: string[];
}): boolean {
  if (args.pov?.kingMotifLive) return true;
  return args.themes.some((t) => HIGH_VALUE_NOTE_THEMES.has(t));
}

function moveLooksForcing(san: string | null | undefined): boolean {
  if (!san) return false;
  return /[+#x]/.test(san) || san.includes("=");
}

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

  // Keep attack/imbalance RAG themes while motif live — even after king-cite cap.
  if (pov?.kingMotifLive) {
    themes.add("imbalances");
    themes.add("initiative");
    themes.add("king_safety");
    if (pov.oppKingExposed) {
      themes.add("attack");
      themes.add("opp_king_exposed");
    }
    if (pov.userKingExposed) {
      themes.add("defense");
      themes.add("user_king_exposed");
    }
    if (!pov.oppKingExposed && !pov.userKingExposed) {
      themes.add("attack");
    }
  }

  if (moveLooksForcing(args.bestSan) || moveLooksForcing(args.playedSan)) {
    themes.add("forcing_moves");
    themes.add("tactics");
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
    themes.add("tactics");
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
      themes.add("tactics");
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
    themes.add("imbalances");
  }
  if (args.phase === "endgame" && args.noteWorthy) {
    themes.add("endgame_technique");
  }
  if (
    args.structure.some((t) =>
      ["bishop_pair", "space", "passed_pawn", "iqp"].includes(t)
    )
  ) {
    themes.add("imbalances");
  }

  // Metrics: drop sticky king-safety labels when motif is dead on this board.
  // Structural labels must also survive the ply window (board structure set).
  for (const t of args.metricsThemes || []) {
    if (!(args.moment || args.deltaCp >= 80)) continue;
    if (KING_MOTIF_THEMES.has(t) && !citeKing) continue;
    if (WINDOWED_STRUCTURE_THEMES.has(t) && !args.structure.includes(t)) {
      continue;
    }
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
  return moveLooksForcing(san);
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
  const used = [...usedTips].filter((k) => k.startsWith(`var:${key}:`)).length;
  if (used >= options.length) return "";
  usedTips.add(`var:${key}:${used}`);
  return options[used];
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

  const kingFirst = kingMotifOutranksStructure({
    citeKing: args.citeKing,
    userKingExposed: args.pov.userKingExposed,
    oppKingExposed: args.pov.oppKingExposed,
    themes: args.themes,
  });

  if (kingFirst && args.citeKing && args.pov.oppKingExposed) {
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
  if (kingFirst && args.citeKing && args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "miss-own-king",
      line
        ? [
            `${args.playedSan} doesn't fix your king safety; ${line} covers the danger first.`,
            `${args.playedSan} leaves your king under fire — ${line} was the defensive priority.`,
          ]
        : [
            `${args.playedSan} leaves your king under fire — fix safety before chasing other plans.`,
          ],
      args.usedTips
    );
  }

  const skipStructure = highValueMotifActive({
    pov: args.pov,
    themes: args.themes,
  });
  if (!skipStructure) {
    const pawnBit = pawnPlayDepthNote({
      fenBefore: args.fenBefore,
      san: args.playedSan,
      line,
      mode: "miss",
    });
    if (pawnBit) return pawnBit.text;

    const structBit = structureDepthNote({
      themes: args.themes,
      san: args.playedSan,
      line,
      mode: "mistake",
      fenAfter: args.fenAfter,
      userColor: args.userColor,
    });
    if (structBit) return structBit;
  }

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
        ? `Their ${playedSan} misses ${hit}.`
        : `Their ${playedSan} misses a forcing tactic.`;
    }
    return hit
      ? `${playedSan} misses the forcing line ${hit}.`
      : `${playedSan} misses a forcing tactic that was there.`;
  }
  if (tact.kind === "missed_mate") {
    const hit = tact.captureSan || line;
    const mateBit =
      tact.mateIn != null && tact.mateIn > 0 ? `mate in ${tact.mateIn}` : "mate";
    if (mode === "opp") {
      return hit
        ? `Their ${playedSan} misses ${mateBit} — ${hit} finishes it.`
        : `Their ${playedSan} misses a forced ${mateBit}.`;
    }
    return hit
      ? `${playedSan} misses ${mateBit}; ${hit} is the forcing finish.`
      : `${playedSan} misses a forced ${mateBit} that was on the board.`;
  }
  if (tact.kind === "hung_mate") {
    const mateBit =
      tact.mateIn != null && tact.mateIn > 0 ? `mate in ${tact.mateIn}` : "mate";
    if (mode === "opp") {
      return `Their ${playedSan} walks into ${mateBit} — take it.`;
    }
    return line
      ? `${playedSan} hangs ${mateBit}; ${line} was the way out.`
      : `${playedSan} hangs a forced ${mateBit}.`;
  }
  return "";
}

const CHESS_ELLIPSIS = "\u2026";

function protectNotationDots(text: string): string {
  return text
    .replace(/\.{3}(?=[NBRQKOa-h0-9])/g, CHESS_ELLIPSIS)
    .replace(/\.{3}(?=\/)/g, CHESS_ELLIPSIS)
    .replace(/(^|[\s(/—\-])(\d{1,3})\.(?=[NBRQKOa-h])/g, "$1$2⟦MD⟧")
    .replace(/(^|[\s(/—\-])(\d{1,3})\.(?=O-O|0-0)/g, "$1$2⟦MD⟧");
}

function restoreNotationDots(text: string): string {
  return text.replaceAll(CHESS_ELLIPSIS, "...").replaceAll("⟦MD⟧", ".");
}

function splitRealSentences(text: string): string[] {
  const masked = protectNotationDots(text);
  const parts = masked.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts) return text.trim() ? [text.trim()] : [];
  return parts
    .map((s) => restoreNotationDots(s).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function sentenceValue(sentence: string): number {
  const s = sentence.trim();
  if (!s) return -999;
  let score = Math.min(s.length, 140);
  if (isWeakFillerNote(s)) score -= 100;
  if (s.length < 24) score -= 25;
  if (
    /\b(break|attack|defend|structure|isolani|passer|castle|develop|pressure|file|diagonal|sacrifice|tactic|hang|outpost|chain|minority|initiative|compensation)\b/i.test(
      s
    )
  ) {
    score += 45;
  }
  if (/\.\.\.|[NBRQK]?[a-h]?[1-8]?x?[a-h][1-8]|O-O|0-0/.test(s)) {
    score += 30;
  }
  if (/^(Black|White)\b/i.test(s) || /\b(Black|White)\s*[—\-:]/i.test(s)) {
    score += 20;
  }
  if (/\b(plan|idea|theme|key|critical|main)\b/i.test(s)) score += 12;
  return score;
}

function limitSentences(chunks: Array<string | null | undefined>, max = 2): string {
  const text = chunks
    .filter((c): c is string => Boolean(c && c.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const parts = splitRealSentences(text);
  if (parts.length <= max) return parts.join(" ");
  const picked = parts
    .map((s, i) => ({ s, i, score: sentenceValue(s) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
  return picked.join(" ");
}

function pawnPlayDepthNote(args: {
  fenBefore: string;
  san: string;
  line: string;
  mode: "mistake" | "good" | "opp" | "miss";
}): { text: string; topic: NoteTopic } | null {
  const topic = classifyPawnMoveTopic(args.fenBefore, args.san);
  if (!topic) return null;

  const san = args.san;
  const line = args.line;
  if (topic === "center_break") {
    if (args.mode === "good") {
      return {
        topic,
        text: `${san} is a centre break — open lines and get pieces behind the new tension.`,
      };
    }
    if (args.mode === "opp") {
      return {
        topic,
        text: `Their ${san} hits the centre — meet the break or lock it before pieces pour through.`,
      };
    }
    return {
      topic,
      text: line
        ? `${san} mistimes the centre break; ${line} keeps the structure healthier.`
        : `${san} is a centre-break moment — calculate the open files before pushing.`,
    };
  }
  if (topic === "flank_push") {
    if (args.mode === "good") {
      return {
        topic,
        text: `${san} is a flank push — useful when the centre is stable and you need a second front.`,
      };
    }
    if (args.mode === "opp") {
      return {
        topic,
        text: `Their ${san} expands on the flank — restrain it or counter in the centre.`,
      };
    }
    return {
      topic,
      text: line
        ? `${san} pushes the flank early; ${line} keeps the centre under control first.`
        : `${san} is a flank idea — make sure the centre can hold before the wing races.`,
    };
  }
  // pawn_sacrifice
  if (args.mode === "good") {
    return {
      topic,
      text: `${san} offers a pawn — only good if the open lines and activity are real.`,
    };
  }
  if (args.mode === "opp") {
    return {
      topic,
      text: `Their ${san} is a pawn offer — take only if you can survive the initiative.`,
    };
  }
  return {
    topic,
    text: line
      ? `${san} gives a pawn without enough activity; ${line} keeps the material.`
      : `${san} is a pawn sacrifice moment — check that the compensation is concrete.`,
  };
}

function structureDepthNote(args: {
  themes: string[];
  san: string;
  line: string;
  mode: "mistake" | "good" | "opp";
  fenAfter?: string;
  userColor?: "white" | "black";
}): string {
  const features =
    args.fenAfter && args.userColor
      ? describeStructureFeatures(args.fenAfter, args.userColor)
      : [];
  const pick = (theme: string): StructureFeature | null =>
    features.find((f) => f.theme === theme) || null;

  if (args.themes.includes("iqp")) {
    const feat = pick("iqp");
    const label = feat?.label || "the isolani";
    const theirs = feat?.owner === "opponent";
    if (args.mode === "good") {
      return theirs
        ? `${args.san} keeps pressure on ${label} — blockade and trade toward a favorable ending.`
        : `${args.san} keeps ${label} useful — stay active on the open files before a quiet ending.`;
    }
    if (args.mode === "opp") {
      return theirs
        ? `Their ${args.san} softens ${label} — blockade d5/d4, trade pieces, steer for the ending.`
        : `Their ${args.san} doesn't handle ${label} — keep activity or head for a better ending.`;
    }
    if (theirs) {
      return args.line
        ? `${args.san} doesn't punish ${label}; ${args.line} keeps the blockade or trades.`
        : `${args.san} lets ${label} sit — blockade it or trade into a better ending.`;
    }
    return args.line
      ? `${args.san} doesn't handle ${label} well; ${args.line} keeps activity or a favorable trade.`
      : `${args.san} lets ${label} sit quiet — use the open files or trade into a better ending.`;
  }

  if (args.themes.includes("hanging_pawns")) {
    const feat = pick("hanging_pawns");
    const label = feat?.label || "the hanging pawns";
    const theirs = feat?.owner === "opponent";
    if (args.mode === "good") {
      return theirs
        ? `${args.san} treats ${label} right — restrain the duo before they get mobile.`
        : `${args.san} treats ${label} right — keep them mobile or break before they get fixed.`;
    }
    if (args.mode === "opp") {
      return theirs
        ? `Their ${args.san} freezes ${label} — restrain the duo, then pile on the base.`
        : `Their ${args.san} lets ${label} breathe — keep them mobile or break.`;
    }
    if (theirs) {
      return args.line
        ? `${args.san} doesn't restrain ${label}; ${args.line} keeps them fixed.`
        : `${args.san} lets ${label} stay mobile — restrain the duo and pile on the base.`;
    }
    return args.line
      ? `${args.san} lets ${label} get fixed; ${args.line} keeps mobility or pressure.`
      : `${args.san} risks freezing ${label} — break or restrain; don't leave them static.`;
  }

  if (args.themes.includes("doubled_pawns")) {
    const feat = pick("doubled_pawns");
    const label = feat?.label || "the doubled pawns";
    const theirs = feat?.owner === "opponent";
    if (args.mode === "good") {
      return theirs
        ? `${args.san} improves vs ${label} — fix and pressure the front pawn.`
        : `${args.san} lives with ${label} — use the open file or undouble cleanly.`;
    }
    if (args.mode === "opp") {
      return theirs
        ? `Their ${args.san} softens ${label} — fix and pressure the front pawn.`
        : `Their ${args.san} doesn't use ${label} — keep the file or undouble.`;
    }
    // Mistake: never say the user "worsened" opponent's pawns
    if (theirs) {
      return args.line
        ? `${args.san} doesn't punish ${label}; ${args.line} keeps pressure on the front pawn.`
        : `${args.san} leaves ${label} alone — pressure the front pawn.`
    }
    return args.line
      ? `${args.san} softens ${label}; ${args.line} keeps the structure healthier.`
      : `${args.san} softens ${label} — pressure the front pawn or undouble.`;
  }

  if (args.themes.includes("passed_pawn")) {
    const feat = pick("passed_pawn");
    const label = feat?.label || "the passed pawn";
    const theirs = feat?.owner === "opponent";
    if (args.mode === "good") {
      return theirs
        ? `${args.san} respects ${label} — blockade it or create a second weakness.`
        : `${args.san} respects ${label} — escort it or force their pieces into a passive block.`;
    }
    if (args.mode === "opp") {
      return theirs
        ? `Their ${args.san} doesn't handle ${label} — blockade it or create a second weakness.`
        : `Their ${args.san} lets ${label} run — escort it or force a passive block.`;
    }
    if (theirs) {
      return args.line
        ? `${args.san} loses the thread vs ${label}; ${args.line} blockades correctly.`
        : `${args.san} doesn't handle ${label} well — blockade it or create a second weakness.`;
    }
    return args.line
      ? `${args.san} loses the thread with ${label}; ${args.line} escorts or pushes correctly.`
      : `${args.san} doesn't handle ${label} well — escort it or force a passive block.`;
  }

  if (args.themes.includes("pawn_chain")) {
    const feat = pick("pawn_chain");
    const label = feat?.label || "the pawn chain";
    const theirs = feat?.owner === "opponent";
    if (args.mode === "good") {
      return theirs
        ? `${args.san} plays vs ${label} — attack the base or the tip's wing.`
        : `${args.san} plays ${label} — attack the base or advance on the tip's wing.`;
    }
    if (theirs) {
      return args.line
        ? `${args.san} ignores ${label}; ${args.line} hits the base or the right wing.`
        : `${args.san} drifts from ${label} — hit the base or play where the tip points.`;
    }
    return args.line
      ? `${args.san} ignores ${label}; ${args.line} hits the base or the right wing.`
      : `${args.san} drifts from ${label} — hit the base or play where the tip points.`;
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

  const kingFirst = kingMotifOutranksStructure({
    citeKing: args.citeKing,
    userKingExposed: args.pov.userKingExposed,
    oppKingExposed: args.pov.oppKingExposed,
    themes: args.themes,
  });

  if (kingFirst && args.citeKing && args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return pickVariant(
      "mist-own-king",
      line
        ? [
            `${args.playedSan} leaves your king under fire; ${line} covers the danger first.`,
            `${args.playedSan} opens air around your king — ${line} was the safety move.`,
          ]
        : [
            `${args.playedSan} leaves your king under fire without enough compensation.`,
          ],
      args.usedTips
    );
  }
  if (kingFirst && args.citeKing && args.pov.oppKingExposed) {
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

  const skipStructure = highValueMotifActive({
    pov: args.pov,
    themes: args.themes,
  });
  if (!skipStructure) {
    const pawnBit = pawnPlayDepthNote({
      fenBefore: args.fenBefore,
      san: args.playedSan,
      line,
      mode: "mistake",
    });
    if (pawnBit) return pawnBit.text;

    const structBit = structureDepthNote({
      themes: args.themes,
      san: args.playedSan,
      line,
      mode: "mistake",
      fenAfter: args.fenAfter,
      userColor: args.userColor,
    });
    if (structBit) return structBit;
  }

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
  const kingFirst = kingMotifOutranksStructure({
    citeKing,
    userKingExposed: args.pov.userKingExposed,
    oppKingExposed: args.pov.oppKingExposed,
    themes: args.themes,
  });
  if (kingFirst && citeKing && args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return `Their ${args.san} keeps heat on your king — contest open lines or trade the attackers.`;
  }
  if (kingFirst && citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return `After ${args.san} their king is soft — keep forcing moves coming.`;
  }
  if (citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return `After ${args.san} their king is soft — keep forcing moves coming.`;
  }
  const skipStructure = highValueMotifActive({
    pov: args.pov,
    themes: args.themes,
  });
  if (!skipStructure) {
    const pawnBit = pawnPlayDepthNote({
      fenBefore: args.fenBefore,
      san: args.san,
      line,
      mode: "opp",
    });
    if (pawnBit) return pawnBit.text;
    const structBit = structureDepthNote({
      themes: args.themes,
      san: args.san,
      line,
      mode: "opp",
      fenAfter: args.fenAfter,
      userColor: args.userColor,
    });
    if (structBit) return structBit;
  }
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
  fenBefore?: string;
  fenAfter?: string;
  userColor?: "white" | "black";
}): string {
  if (args.citeKing && args.pov.userKingExposed) {
    markKingMotifCited(args.usedTips);
    return `${args.san} helps your king safety — keep covering the open lines.`;
  }
  if (args.citeKing && args.pov.oppKingExposed) {
    markKingMotifCited(args.usedTips);
    return `${args.san} keeps useful pressure on their king.`;
  }
  const skipStructure = highValueMotifActive({
    pov: args.pov,
    themes: args.themes,
  });
  if (!skipStructure && args.fenBefore) {
    const pawnBit = pawnPlayDepthNote({
      fenBefore: args.fenBefore,
      san: args.san,
      line: "",
      mode: "good",
    });
    if (pawnBit) return pawnBit.text;
  }
  if (!skipStructure) {
    const structBit = structureDepthNote({
      themes: args.themes,
      san: args.san,
      line: "",
      mode: "good",
      fenAfter: args.fenAfter,
      userColor: args.userColor,
    });
    if (structBit) return structBit;
  }
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
  if (noteTextAlreadySaid(out, usedTips)) {
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

function finalizeNote(
  text: string,
  usedTips: Set<string>,
  maxSentences = 2,
  topicCtx?: {
    themes?: string[];
    fenBefore?: string;
    san?: string;
    phase?: "opening" | "middlegame" | "endgame";
    topic?: NoteTopic;
  }
): string {
  const out = limitSentences([text], maxSentences);
  if (!noteHasSubstance(out)) return "";
  if (noteTextAlreadySaid(out, usedTips)) return "";
  const topic =
    topicCtx?.topic ||
    classifyNoteTopic({
      text: out,
      themes: topicCtx?.themes,
      fenBefore: topicCtx?.fenBefore,
      san: topicCtx?.san,
      phase: topicCtx?.phase,
    });
  if (topicAlreadyUsed(usedTips, topic)) return "";
  claimNoteText(out, usedTips);
  claimNoteTopic(usedTips, topic);
  return out;
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

  const openingCap = args.phase === "opening" ? 1 : 2;

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
      userColor: args.userColor,
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
      .slice(0, 2)
      .map((c) => {
        const sided = adaptCoachTipForSide(c, args.userColor);
        if (!sided) return "";
        return rephraseConcept(
          sided,
          pov.attackSide,
          pov,
          args.usedTips,
          citeKing
        );
      })
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
    if (judgment) {
      const out = finalizeNote(judgment, args.usedTips, openingCap, {
        themes: args.themes,
        fenBefore: args.fenBefore,
        san: args.san,
        phase: args.phase,
      });
      if (out) return out;
    }
    if (args.phase === "opening") return "";
    const plan = buildPlan();
    return finalizeNote(plan, args.usedTips, openingCap, {
      themes: args.themes,
      fenBefore: args.fenBefore,
      san: args.san,
      phase: args.phase,
    });
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
      fenBefore: args.fenBefore,
      fenAfter: args.fenAfter,
      userColor: args.userColor,
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

  const topicCtx = {
    themes: args.themes,
    fenBefore: args.fenBefore,
    san: args.san,
    phase: args.phase,
  };

  const firstFresh = (
    candidates: Array<string | null | undefined>,
    maxSentences = 2
  ): string => {
    const ranked = candidates
      .filter((c): c is string => Boolean(c && noteHasSubstance(c)))
      .map((c) => ({
        c,
        rank: topicRank(
          classifyNoteTopic({
            text: c,
            themes: args.themes,
            fenBefore: args.fenBefore,
            san: args.san,
            phase: args.phase,
          })
        ),
      }))
      .sort((a, b) => a.rank - b.rank);
    for (const { c } of ranked) {
      const out = finalizeNote(c, args.usedTips, maxSentences, topicCtx);
      if (out) return out;
    }
    return "";
  };

  if (args.phase === "opening") {
    return firstFresh([judgment, plan, conceptBits[0], conceptBits[1]], 1);
  }

  if (errorKind === "mistake" || errorKind === "missed_opportunity") {
    return firstFresh([
      judgment,
      limitSentences([plan, conceptBits[0]]),
      plan,
      conceptBits[0],
      conceptBits[1],
    ]);
  }
  if (errorKind === "good") {
    return firstFresh([
      limitSentences([judgment, plan]),
      judgment,
      plan,
      conceptBits[0],
      conceptBits[1],
    ]);
  }
  if (moment) {
    return firstFresh([
      judgment,
      limitSentences([plan, conceptBits[0]]),
      plan,
      conceptBits[0],
      conceptBits[1],
    ]);
  }
  return firstFresh([
    limitSentences([plan, conceptBits[0]]),
    plan,
    conceptBits[0],
    conceptBits[1],
  ]);
}

export { assessPositionPov };
