import { Chess, type Square } from "chess.js";

export type AttackSide = "user" | "opponent" | "balanced";

export type PositionPov = {
  userColor: "w" | "b";
  oppColor: "w" | "b";
  userKingUncastled: boolean;
  oppKingUncastled: boolean;
  userKingExposed: boolean;
  oppKingExposed: boolean;
  /** Soft king still matters on THIS board (not a sticky game label) */
  kingMotifLive: boolean;
  attackSide: AttackSide;
  themes: string[];
};

function kingUncastled(fen: string, color: "w" | "b"): boolean {
  try {
    const board = new Chess(fen);
    const rights = (board.fen().split(" ")[2] || "-").replace(/-/g, "");
    if (color === "w") {
      if (rights.includes("K") || rights.includes("Q")) return true;
      const k = board.get("e1");
      return Boolean(k && k.type === "k" && k.color === "w");
    }
    if (rights.includes("k") || rights.includes("q")) return true;
    const k = board.get("e8");
    return Boolean(k && k.type === "k" && k.color === "b");
  } catch {
    return false;
  }
}

function kingSquare(board: Chess, color: "w" | "b"): Square | null {
  const FILES = "abcdefgh";
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = `${FILES[f]}${r}` as Square;
      const p = board.get(sq);
      if (p && p.type === "k" && p.color === color) return sq;
    }
  }
  return null;
}

function openFilesTowardKing(board: Chess, kingSq: Square): number {
  const file = kingSq.charCodeAt(0) - 97;
  const FILES = "abcdefgh";
  let open = 0;
  for (const df of [-1, 0, 1]) {
    const f = file + df;
    if (f < 0 || f > 7) continue;
    let pawns = 0;
    for (let r = 1; r <= 8; r++) {
      const sq = `${FILES[f]}${r}` as Square;
      const p = board.get(sq);
      if (p?.type === "p") pawns += 1;
    }
    if (pawns === 0) open += 1;
  }
  return open;
}

function attackersNearKing(board: Chess, kingSq: Square, byColor: "w" | "b"): number {
  const kr = Number(kingSq[1]);
  const kf = kingSq.charCodeAt(0) - 97;
  const FILES = "abcdefgh";
  let n = 0;
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = `${FILES[f]}${r}` as Square;
      const p = board.get(sq);
      if (!p || p.color !== byColor || p.type === "k" || p.type === "p") continue;
      if (Math.abs(f - kf) <= 3 && Math.abs(r - kr) <= 3) n += 1;
    }
  }
  return n;
}

function kingPressure(board: Chess, kingSq: Square, byColor: "w" | "b"): {
  open: number;
  atk: number;
  live: boolean;
} {
  const open = openFilesTowardKing(board, kingSq);
  const atk = attackersNearKing(board, kingSq, byColor);
  // Live only with real pressure — not "still has castling rights" alone
  const live = atk >= 2 && open >= 1;
  return { open, atk, live };
}

/**
 * Snapshot of THIS position only. Motifs die when the board changes.
 */
export function assessPositionPov(
  fen: string,
  userColor: "white" | "black"
): PositionPov {
  const user = userColor === "white" ? "w" : "b";
  const opp = user === "w" ? "b" : "w";
  const themes: string[] = [];

  const userKingUncastled = kingUncastled(fen, user);
  const oppKingUncastled = kingUncastled(fen, opp);

  let userKingExposed = false;
  let oppKingExposed = false;
  let kingMotifLive = false;

  try {
    const board = new Chess(fen);
    const uK = kingSquare(board, user);
    const oK = kingSquare(board, opp);
    if (uK) {
      const p = kingPressure(board, uK, opp);
      // Uncastled alone only counts early if attackers already gather
      userKingExposed =
        p.live || (userKingUncastled && p.atk >= 2) || (userKingUncastled && p.open >= 2);
      if (p.live || (userKingUncastled && p.atk >= 2)) kingMotifLive = true;
    }
    if (oK) {
      const p = kingPressure(board, oK, user);
      oppKingExposed =
        p.live || (oppKingUncastled && p.atk >= 2) || (oppKingUncastled && p.open >= 2);
      if (p.live || (oppKingUncastled && p.atk >= 2)) kingMotifLive = true;
    }
    // Motif over: both tucked and no pressure
    if (!userKingUncastled && !oppKingUncastled && !userKingExposed && !oppKingExposed) {
      kingMotifLive = false;
    }
  } catch {
    /* ignore */
  }

  // Themes only while motif is live on this board
  if (kingMotifLive && oppKingExposed) {
    themes.push("opp_king_exposed");
  }
  if (kingMotifLive && userKingExposed) {
    themes.push("user_king_exposed");
  }
  if (kingMotifLive && (oppKingExposed || userKingExposed)) {
    themes.push("king_safety");
  }

  let attackSide: AttackSide = "balanced";
  if (kingMotifLive) {
    if (oppKingExposed && !userKingExposed) attackSide = "user";
    else if (userKingExposed && !oppKingExposed) attackSide = "opponent";
    else if (oppKingExposed && userKingExposed) {
      attackSide = oppKingUncastled && !userKingUncastled ? "user" : "opponent";
    }
    if (attackSide === "user") {
      themes.push("attack");
    } else if (attackSide === "opponent") {
      themes.push("defense");
      themes.push("prophylaxis");
    }
  }

  return {
    userColor: user,
    oppColor: opp,
    userKingUncastled,
    oppKingUncastled,
    userKingExposed,
    oppKingExposed,
    kingMotifLive,
    attackSide,
    themes,
  };
}

/** Does this move actually engage the soft-king story? */
export function moveRelatesToKingMotif(args: {
  fenBefore: string;
  san: string | null;
  pov: PositionPov;
}): boolean {
  if (!args.pov.kingMotifLive || !args.san) return false;
  if (/[+#]/.test(args.san)) return true;
  try {
    const board = new Chess(args.fenBefore);
    const move = board.move(args.san);
    if (!move) return false;
    if (move.flags.includes("k") || move.flags.includes("q")) return true;

    const targetKing =
      args.pov.oppKingExposed
        ? kingSquare(new Chess(args.fenBefore), args.pov.oppColor)
        : args.pov.userKingExposed
          ? kingSquare(new Chess(args.fenBefore), args.pov.userColor)
          : null;
    if (!targetKing) return false;
    const kf = targetKing.charCodeAt(0) - 97;
    const kr = Number(targetKing[1]);
    const tf = move.to.charCodeAt(0) - 97;
    const tr = Number(move.to[1]);
    // Toward the soft king zone
    if (Math.abs(tf - kf) <= 2 && Math.abs(tr - kr) <= 2) return true;
    // Pawn break that opens toward king
    if (move.piece === "p" && Math.abs(tf - kf) <= 1) return true;
    return false;
  } catch {
    return /[+#]/.test(args.san);
  }
}

/** Pure tactics / material unrelated to king motif */
export function moveLooksTactical(fenBefore: string, san: string | null): boolean {
  if (!san) return false;
  if (/[+#x=]/.test(san)) return true;
  try {
    const board = new Chess(fenBefore);
    const move = board.move(san);
    return Boolean(move && (move.captured || move.san.includes("+") || move.san.includes("#")));
  } catch {
    return false;
  }
}

export { kingUncastled };
