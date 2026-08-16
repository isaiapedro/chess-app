import { Chess, type Square } from "chess.js";

export type BoardFacts = {
  ply: number;
  phase: "opening" | "middlegame" | "endgame";
  playedSan: string;
  themes: string[];
  whiteQueenHome: boolean;
  blackQueenHome: boolean;
  whiteCastled: boolean;
  blackCastled: boolean;
  oppositeCastling: boolean;
  wingPawnsAdvanced: boolean;
  minorsOffHome: number;
};

function onHome(fen: string, sq: Square, type: string, color: "w" | "b"): boolean {
  try {
    const p = new Chess(fen).get(sq);
    return Boolean(p && p.type === type && p.color === color);
  } catch {
    return true;
  }
}

function castled(fen: string, color: "w" | "b"): boolean {
  try {
    const board = new Chess(fen);
    for (const sq of board.findPiece({ type: "k", color })) {
      if (color === "w") return sq === "g1" || sq === "c1";
      return sq === "g8" || sq === "c8";
    }
  } catch {
    /* ignore */
  }
  return false;
}

function kingFile(fen: string, color: "w" | "b"): number | null {
  try {
    const board = new Chess(fen);
    const sqs = board.findPiece({ type: "k", color });
    if (!sqs.length) return null;
    return sqs[0].charCodeAt(0) - "a".charCodeAt(0);
  } catch {
    return null;
  }
}

function wingPawns(fen: string): boolean {
  try {
    const board = new Chess(fen);
    const files = ["a", "b", "g", "h"];
    for (const f of files) {
      for (let r = 3; r <= 6; r++) {
        const p = board.get(`${f}${r}` as Square);
        if (p?.type === "p") return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function countMinorsOffHome(fen: string): number {
  let n = 0;
  try {
    const board = new Chess(fen);
    const homes: Array<[Square, "w" | "b"]> = [
      ["b1", "w"],
      ["g1", "w"],
      ["c1", "w"],
      ["f1", "w"],
      ["b8", "b"],
      ["g8", "b"],
      ["c8", "b"],
      ["f8", "b"],
    ];
    for (const [sq, color] of homes) {
      const p = board.get(sq);
      if (!p || p.color !== color) n += 1;
    }
  } catch {
    /* ignore */
  }
  return n;
}

export function assessBoardFacts(args: {
  fenAfter: string;
  playedSan: string;
  ply: number;
  phase: "opening" | "middlegame" | "endgame";
  themes: string[];
}): BoardFacts {
  const fen = args.fenAfter;
  const whiteCastled = castled(fen, "w");
  const blackCastled = castled(fen, "b");
  const wf = kingFile(fen, "w");
  const bf = kingFile(fen, "b");
  const oppositeCastling =
    whiteCastled &&
    blackCastled &&
    wf != null &&
    bf != null &&
    Math.abs(wf - bf) >= 3;
  return {
    ply: args.ply,
    phase: args.phase,
    playedSan: args.playedSan,
    themes: args.themes,
    whiteQueenHome: onHome(fen, "d1", "q", "w"),
    blackQueenHome: onHome(fen, "d8", "q", "b"),
    whiteCastled,
    blackCastled,
    oppositeCastling,
    wingPawnsAdvanced: wingPawns(fen),
    minorsOffHome: countMinorsOffHome(fen),
  };
}

/**
 * Drop canned book/plan lines that name pieces/plans not live on this board.
 */
export function textFitsBoard(text: string, facts: BoardFacts): boolean {
  const t = text.toLowerCase();
  const queenMention =
    /queen raid|queens without|qa5|qd6|qd8|qh4|qh5|qb6|against the queen|queen decisions|tricks against the queen|tests the bishop/.test(
      t
    ) || (/\bqueen\b/.test(t) && /hang|raid|early|grab|storm/.test(t));
  const queenMoved =
    !facts.whiteQueenHome ||
    !facts.blackQueenHome ||
    /q/i.test(facts.playedSan);
  if (queenMention && !queenMoved) return false;

  if (
    (/english attack|opposite-side|opposite side|yugoslav/.test(t) ||
      (/g\/h pawns|h-pawn|h4|h5/.test(t) && /attack|storm|race/.test(t))) &&
    !facts.oppositeCastling &&
    facts.ply < 24 &&
    !facts.wingPawnsAdvanced
  ) {
    return false;
  }

  if (
    /pawn storm|launching pawn storms|pawn storms/.test(t) &&
    facts.ply < 14 &&
    !facts.wingPawnsAdvanced
  ) {
    return false;
  }

  if (
    /minority attack|b4–b5|b4-b5|carlsbad/.test(t) &&
    !facts.themes.includes("minority_attack") &&
    !facts.themes.includes("carlsbad") &&
    facts.ply < 22
  ) {
    return false;
  }

  if (
    /lucena|philidor|rook endings|opposition/.test(t) &&
    facts.phase !== "endgame"
  ) {
    return false;
  }

  if (
    /bishop pair/.test(t) &&
    !facts.themes.includes("bishop_pair") &&
    facts.phase === "opening"
  ) {
    return false;
  }

  if (
    (/iqp|isolani/.test(t) && !facts.themes.includes("iqp")) ||
    (/hanging pawns/.test(t) && !facts.themes.includes("hanging_pawns")) ||
    (/doubled/.test(t) && !facts.themes.includes("doubled_pawns"))
  ) {
    return false;
  }

  if (
    /connect the rooks/.test(t) &&
    facts.minorsOffHome < 4 &&
    facts.ply < 8
  ) {
    return false;
  }

  return true;
}

const WEAK_FILLER_PATTERNS: RegExp[] = [
  /creates avoidable problems/,
  /loses the thread/,
  /misses a concrete chance/,
  /misses a chance while/,
  /is too slow here/,
  /a real chance goes by/,
  /leaves a soft spot/,
  /matches what the position asks/,
  /is a healthy developing move/,
  /fits the opening plan\.?$/,
  /name a target \(weak pawn/,
  /compare two candidates/,
  /list imbalances/,
  /stay concrete [—-] checks/,
  /same idea, different words/,
  /keep naming today's target/,
  /improve the worst-placed piece that hits today's/,
  /name the current target: loose piece/,
  /opening phase: develop, fight the centre/,
  /finish developing the minors before starting a wing/,
  /decide which pawn structure you are heading into/,
];

export function isWeakFillerNote(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return true;
  return WEAK_FILLER_PATTERNS.some((p) => p.test(t));
}

export function noteHasSubstance(text: string): boolean {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (t.length < 18) return false;
  if (isWeakFillerNote(t)) return false;
  return true;
}

export function noteTextFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\.\.\./g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .slice(0, 16)
    .join(" ");
}

export function noteTextAlreadySaid(
  text: string,
  usedTips: Set<string>
): boolean {
  const fp = noteTextFingerprint(text);
  if (!fp) return false;
  if (usedTips.has(`note:${fp}`)) return true;
  for (const key of usedTips) {
    if (!key.startsWith("note:")) continue;
    const prev = key.slice(5);
    if (!prev) continue;
    if (prev === fp) return true;
    if (fp.startsWith(prev) || prev.startsWith(fp)) return true;
    const a = new Set(fp.split(" "));
    const b = prev.split(" ");
    let hit = 0;
    for (const w of b) if (a.has(w)) hit += 1;
    if (b.length >= 5 && hit / b.length >= 0.72) return true;
    if (a.size >= 5 && hit / a.size >= 0.72) return true;
  }
  return false;
}

export function claimNoteText(text: string, usedTips: Set<string>): void {
  const fp = noteTextFingerprint(text);
  if (fp) usedTips.add(`note:${fp}`);
}
