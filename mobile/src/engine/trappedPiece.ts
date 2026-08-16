import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import { STYLE_PIECE_VALUE, pieceMaterialBalance } from "./styleMetrics";

const PIECE_NAME: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export const TRAPPED_PV_MIN_PLY = 2;
export const TRAPPED_PV_MAX_PLY = 6;

export type SafeMobilityResult = {
  square: Square;
  piece: PieceSymbol;
  color: Color;
  pieceLabel: string;
  legalMoves: Square[];
  safeMoves: Square[];
  safeMobility: number;
  blockedBy: string[];
};

export type PvMaterialSample = {
  ply: number;
  san: string;
  materialBalance: number;
  fen: string;
};

export type DelayedCaptureResult = {
  piece: PieceSymbol;
  square: Square;
  pieceLabel: string;
  color: Color;
  capturePlyDelay: number;
  captureSan: string;
  winningLine: string;
  materialAtRoot: number;
  materialAtCapture: number;
  finalMaterialDelta: number;
  samples: PvMaterialSample[];
  mobility: SafeMobilityResult;
};

function swapColor(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function isDarkSquare(sq: Square): boolean {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  return (file + rank) % 2 === 0;
}

export function pieceLabelFor(piece: PieceSymbol, square: Square): string {
  if (piece === "b") {
    return isDarkSquare(square) ? "dark_squared_bishop" : "light_squared_bishop";
  }
  return PIECE_NAME[piece];
}

function boardWithSideToMove(fen: string, color: Color): Chess | null {
  try {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) return null;
    parts[1] = color;
    const next = new Chess();
    next.load(parts.join(" "));
    return next;
  } catch {
    return null;
  }
}

function attackerValue(type: PieceSymbol): number {
  if (type === "k") return 99;
  return STYLE_PIECE_VALUE[type] ?? 99;
}

function cheapestAttacker(
  board: Chess,
  sq: Square,
  attackerColor: Color
): { square: Square; type: PieceSymbol; value: number } | null {
  let best: { square: Square; type: PieceSymbol; value: number } | null = null;
  for (const a of board.attackers(sq, attackerColor)) {
    const p = board.get(a);
    if (!p) continue;
    const value = attackerValue(p.type);
    if (!best || value < best.value) {
      best = { square: a, type: p.type, value };
    }
  }
  return best;
}

export function isLosingTrapCapture(
  board: Chess,
  square: Square,
  color: Color
): boolean {
  const piece = board.get(square);
  if (!piece || piece.color !== color || piece.type === "k") return false;
  const pieceValue = STYLE_PIECE_VALUE[piece.type] || 0;
  if (pieceValue < 3) return false;
  const opp = swapColor(color);
  const attackers = board.attackers(square, opp);
  const defenders = board.attackers(square, color);
  if (attackers.length <= defenders.length) return false;
  const cheap = cheapestAttacker(board, square, opp);
  if (!cheap) return false;
  if (cheap.type === "k") return defenders.length === 0;
  return cheap.value < pieceValue;
}

/** Destination unsafe if hanging or takeable by cheaper unit. */
export function isSafeDestination(
  boardAfter: Chess,
  dest: Square,
  moverColor: Color,
  pieceValue: number
): boolean {
  const opp = swapColor(moverColor);
  if (!boardAfter.isAttacked(dest, opp)) return true;
  const cheap = cheapestAttacker(boardAfter, dest, opp);
  if (!cheap) return true;
  if (cheap.type !== "k" && cheap.value < pieceValue) return false;
  const defenders = boardAfter.attackers(dest, moverColor);
  if (!defenders.length) return false;
  const attackers = boardAfter.attackers(dest, opp);
  if (attackers.length > defenders.length) return false;
  return true;
}

function blockReason(
  boardAfter: Chess,
  dest: Square,
  moverColor: Color
): string {
  const opp = swapColor(moverColor);
  const cheap = cheapestAttacker(boardAfter, dest, opp);
  if (cheap) {
    return `square_${dest}_controlled_by_${PIECE_NAME[cheap.type]}_${cheap.square}`;
  }
  return `square_${dest}_unsafe`;
}

/**
 * Per-piece safe mobility: legal destinations that do not land on a net-loss
 * square (hanging / cheaper attacker). Evaluates as if `color` to move.
 */
export function safeMobilityForSquare(
  board: Chess,
  square: Square
): SafeMobilityResult | null {
  const piece = board.get(square);
  if (!piece || piece.type === "k") return null;

  const turnBoard = boardWithSideToMove(board.fen(), piece.color);
  if (!turnBoard) return null;
  const onSq = turnBoard.get(square);
  if (!onSq || onSq.color !== piece.color || onSq.type !== piece.type) {
    return null;
  }

  const pieceValue = STYLE_PIECE_VALUE[piece.type] ?? 0;
  const moves = turnBoard.moves({
    square,
    verbose: true,
  }) as Move[];

  const legalMoves: Square[] = [];
  const safeMoves: Square[] = [];
  const blockedBy: string[] = [];
  const seenLegal = new Set<string>();

  for (const m of moves) {
    if (m.captured === "k") continue;
    const dest = m.to as Square;
    if (seenLegal.has(dest)) continue;
    seenLegal.add(dest);
    legalMoves.push(dest);

    const probe = boardWithSideToMove(board.fen(), piece.color);
    if (!probe) continue;
    try {
      const played = probe.move({
        from: m.from,
        to: m.to,
        promotion: m.promotion,
      });
      if (!played) {
        blockedBy.push(`square_${dest}_illegal`);
        continue;
      }
      if (isSafeDestination(probe, dest, piece.color, pieceValue)) {
        safeMoves.push(dest);
      } else {
        blockedBy.push(blockReason(probe, dest, piece.color));
      }
    } catch {
      blockedBy.push(`square_${dest}_illegal`);
    }
  }

  if (!legalMoves.length) {
    blockedBy.push("no_legal_moves");
  }

  return {
    square,
    piece: piece.type,
    color: piece.color,
    pieceLabel: pieceLabelFor(piece.type, square),
    legalMoves,
    safeMoves,
    safeMobility: safeMoves.length,
    blockedBy: [...new Set(blockedBy)],
  };
}

/** Zero safe-mobility minors/majors for `color` (king skipped). */
export function findZeroSafeMobilityPieces(
  board: Chess,
  color: Color,
  opts?: { includePawns?: boolean }
): SafeMobilityResult[] {
  const types: PieceSymbol[] = opts?.includePawns
    ? ["p", "n", "b", "r", "q"]
    : ["n", "b", "r", "q"];
  const out: SafeMobilityResult[] = [];
  for (const pt of types) {
    for (const sq of board.findPiece({ type: pt, color })) {
      const snap = safeMobilityForSquare(board, sq as Square);
      if (snap && snap.safeMobility === 0) out.push(snap);
    }
  }
  return out;
}

/** Per-ply material from `color` POV along a SAN line. */
export function sampleMaterialAlongSans(args: {
  fen: string;
  sans: string[];
  color: Color;
  maxPly?: number;
}): PvMaterialSample[] {
  const maxPly = args.maxPly ?? TRAPPED_PV_MAX_PLY;
  const board = new Chess();
  try {
    board.load(args.fen);
  } catch {
    return [];
  }
  const samples: PvMaterialSample[] = [];
  for (const san of args.sans.slice(0, maxPly)) {
    try {
      const m = board.move(san);
      if (!m) break;
      samples.push({
        ply: samples.length + 1,
        san: m.san,
        materialBalance: pieceMaterialBalance(board, args.color),
        fen: board.fen(),
      });
    } catch {
      break;
    }
  }
  return samples;
}

function pieceStillOn(
  board: Chess,
  square: Square,
  color: Color,
  piece: PieceSymbol
): boolean {
  const p = board.get(square);
  return Boolean(p && p.color === color && p.type === piece);
}

/**
 * Delayed capture of a zero-safe-mobility piece along engine PV.
 * Requires capture ply in [minPly, maxPly] and material drop ≥ piece value.
 */
export function detectDelayedPieceCapture(args: {
  fen: string;
  sans: string[];
  victimColor: Color;
  pieceSquare?: Square | null;
  minPly?: number;
  maxPly?: number;
}): DelayedCaptureResult | null {
  const minPly = args.minPly ?? TRAPPED_PV_MIN_PLY;
  const maxPly = args.maxPly ?? TRAPPED_PV_MAX_PLY;
  let root: Chess;
  try {
    root = new Chess(args.fen);
  } catch {
    return null;
  }

  const candidates: SafeMobilityResult[] = [];
  if (args.pieceSquare) {
    const snap = safeMobilityForSquare(root, args.pieceSquare);
    if (snap && snap.color === args.victimColor && snap.safeMobility === 0) {
      candidates.push(snap);
    }
  } else {
    candidates.push(...findZeroSafeMobilityPieces(root, args.victimColor));
  }
  if (!candidates.length) return null;

  const materialAtRoot = pieceMaterialBalance(root, args.victimColor);
  const samples = sampleMaterialAlongSans({
    fen: args.fen,
    sans: args.sans,
    color: args.victimColor,
    maxPly,
  });
  if (!samples.length) return null;

  for (const cand of candidates) {
    const pieceValue = STYLE_PIECE_VALUE[cand.piece] ?? 0;
    if (pieceValue < 1) continue;
    if (!pieceStillOn(root, cand.square, cand.color, cand.piece)) continue;

    const board = new Chess();
    try {
      board.load(args.fen);
    } catch {
      continue;
    }

    let trackSq: Square | null = cand.square;
    let capturePly = 0;
    let captureSan = "";

    for (let i = 0; i < args.sans.length && i < maxPly; i += 1) {
      let m: Move | null = null;
      try {
        m = board.move(args.sans[i]!) as Move | null;
      } catch {
        break;
      }
      if (!m) break;

      if (trackSq && m.color === cand.color && m.from === trackSq) {
        trackSq = m.to as Square;
      }

      const capturedHere =
        Boolean(m.captured) &&
        m.captured !== "k" &&
        trackSq != null &&
        m.to === trackSq &&
        m.color !== cand.color;

      const vanished =
        trackSq != null &&
        !pieceStillOn(board, trackSq, cand.color, cand.piece);

      if (capturedHere || (vanished && m.captured === cand.piece)) {
        capturePly = i + 1;
        captureSan = m.san;
        break;
      }
      if (trackSq && !pieceStillOn(board, trackSq, cand.color, cand.piece)) {
        trackSq = null;
      }
    }

    if (capturePly < minPly || capturePly > maxPly) continue;

    const atCapture = samples[capturePly - 1];
    if (!atCapture) continue;
    const finalMaterialDelta = atCapture.materialBalance - materialAtRoot;
    if (finalMaterialDelta > -pieceValue + 1e-9) continue;

    const lineSans = samples.slice(0, capturePly).map((s) => s.san);
    return {
      piece: cand.piece,
      square: cand.square,
      pieceLabel: cand.pieceLabel,
      color: cand.color,
      capturePlyDelay: capturePly,
      captureSan,
      winningLine: lineSans.join(" "),
      materialAtRoot,
      materialAtCapture: atCapture.materialBalance,
      finalMaterialDelta,
      samples: samples.slice(0, Math.max(capturePly, samples.length)),
      mobility: cand,
    };
  }

  return null;
}

function trappedSquaresAt(
  board: Chess,
  color: Color
): SafeMobilityResult[] {
  return findZeroSafeMobilityPieces(board, color).filter(
    (z) =>
      (STYLE_PIECE_VALUE[z.piece] ?? 0) >= 3 &&
      isLosingTrapCapture(board, z.square, color)
  );
}

export function detectNewlyTrappedAlongSans(args: {
  fen: string;
  sans: string[];
  victimColor: Color;
  maxPly?: number;
}): DelayedCaptureResult | null {
  const maxPly = args.maxPly ?? TRAPPED_PV_MAX_PLY;
  let root: Chess;
  try {
    root = new Chess(args.fen);
  } catch {
    return null;
  }
  const rootZero = new Set(
    trappedSquaresAt(root, args.victimColor).map((z) => z.square)
  );
  const board = new Chess();
  try {
    board.load(args.fen);
  } catch {
    return null;
  }

  for (let i = 0; i < args.sans.length && i < maxPly; i += 1) {
    try {
      if (!board.move(args.sans[i]!)) break;
    } catch {
      break;
    }
    const newly = trappedSquaresAt(board, args.victimColor).filter(
      (z) => !rootZero.has(z.square)
    );
    newly.sort(
      (a, b) =>
        (STYLE_PIECE_VALUE[b.piece] ?? 0) - (STYLE_PIECE_VALUE[a.piece] ?? 0)
    );
    const cand = newly[0];
    if (!cand) continue;

    const rest = args.sans.slice(i + 1);
    const cap = rest.length
      ? detectDelayedPieceCapture({
          fen: board.fen(),
          sans: rest,
          victimColor: args.victimColor,
          pieceSquare: cand.square,
          minPly: 1,
          maxPly: Math.max(1, maxPly - i),
        })
      : null;
    if (cap) {
      const prefix = args.sans.slice(0, i + 1);
      return {
        ...cap,
        capturePlyDelay: i + 1 + cap.capturePlyDelay,
        winningLine: [...prefix, ...cap.winningLine.split(/\s+/).filter(Boolean)].join(" "),
      };
    }
    return {
      piece: cand.piece,
      square: cand.square,
      pieceLabel: cand.pieceLabel,
      color: cand.color,
      capturePlyDelay: i + 1,
      captureSan: args.sans[i]!,
      winningLine: args.sans.slice(0, i + 1).join(" "),
      materialAtRoot: pieceMaterialBalance(root, args.victimColor),
      materialAtCapture: pieceMaterialBalance(board, args.victimColor),
      finalMaterialDelta: 0,
      samples: [],
      mobility: cand,
    };
  }
  return null;
}

