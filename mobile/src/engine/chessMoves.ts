import { Chess, type Move, type Square } from "chess.js";

export function fenKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function applyUciMove(chess: Chess, uci: string): Move | null {
  if (!uci || uci.length < 4) return null;
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion =
    uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined;

  try {
    const direct = chess.move({ from, to, promotion });
    if (direct) return direct;
  } catch {
    /* try castling variants */
  }

  const piece = chess.get(from);
  if (piece?.type === "k") {
    const castles = chess
      .moves({ square: from, verbose: true })
      .filter((m) => m.flags.includes("k") || m.flags.includes("q"));
    for (const castle of castles) {
      const rookFile = castle.flags.includes("q") ? "a" : "h";
      const rookSq = `${rookFile}${from[1]}`;
      if (to === castle.to || to === rookSq) {
        try {
          return chess.move({ from: castle.from, to: castle.to });
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function tryMove(
  fen: string,
  from: Square,
  to: Square,
  promotion: "q" | "r" | "b" | "n" = "q"
): Move | null {
  const chess = new Chess(fen);
  const fromPiece = chess.get(from);
  if (!fromPiece) return null;

  if (fromPiece.type === "k") {
    const destPiece = chess.get(to);
    if (destPiece?.type === "r" && destPiece.color === fromPiece.color) {
      const castles = chess
        .moves({ square: from, verbose: true })
        .filter((m) => m.flags.includes("k") || m.flags.includes("q"));
      const castle = castles.find((m) => {
        if (m.flags.includes("q")) return to.startsWith("a");
        if (m.flags.includes("k")) return to.startsWith("h");
        return false;
      });
      if (castle) {
        try {
          return chess.move({ from: castle.from, to: castle.to });
        } catch {
          return null;
        }
      }
    }
  }

  const isPromo =
    fromPiece.type === "p" &&
    ((fromPiece.color === "w" && to[1] === "8") ||
      (fromPiece.color === "b" && to[1] === "1"));

  try {
    return chess.move({
      from,
      to,
      promotion: isPromo ? promotion : undefined,
    });
  } catch {
    return null;
  }
}

export function uciFromMove(move: Move): string {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

export function canonicalUci(fen: string, uci?: string | null): string {
  if (!uci) return "";
  try {
    const board = new Chess(fen);
    const move = applyUciMove(board, uci);
    return move ? uciFromMove(move) : "";
  } catch {
    return "";
  }
}

export function sanToUci(fen: string, san?: string | null): string {
  if (!san) return "";
  const board = new Chess(fen);
  try {
    const move = board.move(san);
    return move ? uciFromMove(move) : "";
  } catch {
    return "";
  }
}

export function sameMove(
  fen: string,
  a?: string | null,
  b?: string | null
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return canonicalUci(fen, a) === canonicalUci(fen, b);
}

export function pvToSanLine(fen: string, pv: string[], maxPlies = 6): string {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv.slice(0, maxPlies)) {
    const move = applyUciMove(chess, uci);
    if (!move) break;
    sans.push(move.san);
  }
  return sans.join(" ");
}

export function extractPvFromPgn(
  pgn: string,
  startFen: string,
  maxPlies: number
): string[] {
  try {
    const game = new Chess();
    game.loadPgn(pgn, { strict: false });
    const history = game.history({ verbose: true });
    const replay = new Chess();
    const target = fenKey(startFen);
    let idx = -1;
    if (fenKey(replay.fen()) === target) {
      idx = 0;
    } else {
      for (let i = 0; i < history.length; i += 1) {
        replay.move(history[i]);
        if (fenKey(replay.fen()) === target) {
          idx = i + 1;
          break;
        }
      }
    }
    if (idx < 0) return [];
    const pv: string[] = [];
    for (let i = idx; i < history.length && pv.length < maxPlies; i += 1) {
      pv.push(uciFromMove(history[i]));
    }
    return pv;
  } catch {
    return [];
  }
}
