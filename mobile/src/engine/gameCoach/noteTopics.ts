import { Chess, type Move, type PieceSymbol } from "chess.js";
import { STYLE_PIECE_VALUE, sacrificeOfferAfterMove } from "../styleMetrics";

/**
 * Comment topics — at most one note per topic per game.
 */
export type NoteTopic =
  | "tactic"
  | "king_safety"
  | "pawn_sacrifice"
  | "passed_pawn"
  | "iqp"
  | "hanging_pawns"
  | "doubled_pawns"
  | "pawn_chain"
  | "center_break"
  | "flank_push"
  | "opening_plan"
  | "endgame"
  | "general";

/**
 * Tier list (0 = highest). Always emit the highest-priority topic available.
 *
 * 1. Tactics / forcing (mate, hangs, misses)
 * 2. King safety under pressure
 * 3. Pawn sacrifice (high-stakes decision)
 * 4. Decisive structure (passer, IQP, hanging, doubled)
 * 5. Plans (chain, centre break, flank)
 * 6. Opening / endgame frames
 * 7. General filler
 */
export const NOTE_TOPIC_PRIORITY: NoteTopic[] = [
  "tactic",
  "king_safety",
  "pawn_sacrifice",
  "passed_pawn",
  "iqp",
  "hanging_pawns",
  "doubled_pawns",
  "pawn_chain",
  "center_break",
  "flank_push",
  "opening_plan",
  "endgame",
  "general",
];

function topicKey(topic: NoteTopic): string {
  return `topic:${topic}`;
}

export function topicAlreadyUsed(
  usedTips: Set<string>,
  topic: NoteTopic
): boolean {
  return usedTips.has(topicKey(topic));
}

export function claimNoteTopic(
  usedTips: Set<string>,
  topic: NoteTopic
): void {
  usedTips.add(topicKey(topic));
}

function pieceVal(p: PieceSymbol): number {
  return STYLE_PIECE_VALUE[p] ?? 0;
}

/**
 * Pawn-play subtype from the move itself (centre break, flank, sac).
 */
export function classifyPawnMoveTopic(
  fenBefore: string,
  san: string
): NoteTopic | null {
  try {
    const board = new Chess(fenBefore);
    const move = board.move(san) as Move | null;
    if (!move || move.piece !== "p") return null;

    const color = move.color;
    const offered = sacrificeOfferAfterMove(board, move, color);
    if (offered >= 1) return "pawn_sacrifice";
    if (move.captured && move.captured !== "p" && pieceVal(move.captured) >= 3) {
      return "pawn_sacrifice";
    }

    const toFile = move.to.charCodeAt(0) - 97;
    const fromFile = move.from.charCodeAt(0) - 97;
    const centerFile =
      toFile === 3 || toFile === 4 || fromFile === 3 || fromFile === 4;
    if (
      centerFile &&
      (move.isCapture() ||
        Math.abs(Number(move.to[1]) - Number(move.from[1])) >= 1)
    ) {
      return "center_break";
    }
    if (toFile <= 1 || toFile >= 6 || fromFile <= 1 || fromFile >= 6) {
      return "flank_push";
    }
    if (move.isCapture() && (toFile === 2 || toFile === 5)) {
      return "center_break";
    }
    return null;
  } catch {
    return null;
  }
}

function textLooksLikeTactic(text: string): boolean {
  return /\bwalks into\b|\bmisses\b|\bhangs a\b|\bforcing\b|\btactic\b|\bmate in\b|\bfree \w+\b|\blosing trade\b/.test(
    text
  );
}

function textLooksLikeKing(text: string): boolean {
  return /\bking\b|\bcheckmate\b|\bcastl/.test(text);
}

/**
 * Classify by content first (highest tiers), then move/themes.
 * Never let a pawn move steal king/tactic labels from the text.
 */
export function classifyNoteTopic(args: {
  text: string;
  themes?: string[];
  fenBefore?: string;
  san?: string;
  phase?: "opening" | "middlegame" | "endgame";
}): NoteTopic {
  const themes = args.themes || [];
  const text = args.text.toLowerCase();

  if (textLooksLikeTactic(text)) return "tactic";
  if (textLooksLikeKing(text)) return "king_safety";
  if (
    themes.includes("user_king_exposed") ||
    themes.includes("opp_king_exposed") ||
    themes.includes("king_safety") ||
    themes.includes("attack")
  ) {
    // Don't let bare king themes override an explicit structure sentence
    if (
      !/\bdoubled|pawn chain|isolani|hanging (c\/d-)?pawns|flank push|centre break|center break\b/.test(
        text
      )
    ) {
      return "king_safety";
    }
  }

  if (
    /\bpawn sac|\bsacrific(?:e|es|ing) (?:a )?pawn\b|\boffers? a pawn\b/.test(
      text
    )
  ) {
    return "pawn_sacrifice";
  }
  if (
    themes.includes("passed_pawn") ||
    /\bpassed [a-h]-pawn\b|\bpasser\b/.test(text)
  ) {
    return "passed_pawn";
  }
  if (themes.includes("iqp") || /\bisolani\b|\biqp\b/.test(text)) {
    return "iqp";
  }
  if (
    themes.includes("hanging_pawns") ||
    /\bhanging (c\/d-)?pawns\b/.test(text)
  ) {
    return "hanging_pawns";
  }
  if (themes.includes("doubled_pawns") || /\bdoubled\b/.test(text)) {
    return "doubled_pawns";
  }
  if (
    themes.includes("pawn_chain") ||
    /\bpawn chain\b|\bchain tip\b|\bchain plan\b|\bbase of the chain\b/.test(
      text
    )
  ) {
    return "pawn_chain";
  }
  if (
    /\bcentr(?:e|er) break\b|\b\.\.\.d5\b|\b\.\.\.e5\b|\bd4 break\b|\be4 break\b|\bbreak in the centr/.test(
      text
    )
  ) {
    return "center_break";
  }
  if (
    /\bflank\b|\b[abgh]-pawn\b|\bminority\b|\bb4–b5\b|\b\.\.\.b5\b|\bh-pawn\b/.test(
      text
    )
  ) {
    return "flank_push";
  }

  if (args.fenBefore && args.san) {
    const pawnTopic = classifyPawnMoveTopic(args.fenBefore, args.san);
    if (pawnTopic) return pawnTopic;
  }

  if (
    args.phase === "opening" ||
    themes.includes("opening_plan") ||
    themes.includes("named_opening")
  ) {
    return "opening_plan";
  }
  if (args.phase === "endgame" || themes.includes("endgame_technique")) {
    return "endgame";
  }
  return "general";
}

export function topicRank(topic: NoteTopic): number {
  const i = NOTE_TOPIC_PRIORITY.indexOf(topic);
  return i < 0 ? NOTE_TOPIC_PRIORITY.length : i;
}

/** True when king-safety / attack outranks structure for this board. */
export function kingMotifOutranksStructure(args: {
  citeKing: boolean;
  userKingExposed?: boolean;
  oppKingExposed?: boolean;
  themes?: string[];
}): boolean {
  const themes = args.themes || [];
  const motifInThemes =
    themes.includes("user_king_exposed") ||
    themes.includes("opp_king_exposed") ||
    themes.includes("king_safety") ||
    themes.includes("attack");
  if (args.userKingExposed || args.oppKingExposed || motifInThemes) {
    return Boolean(args.citeKing) || motifInThemes;
  }
  return false;
}
