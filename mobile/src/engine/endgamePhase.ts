import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
import { extractMoveTimesFromPgn } from "./clockFromPgn";
import { HEURISTICS_EG_KING_EVERY } from "./analysisConfig";
import {
  userWinProbability,
  classifyEvalDrop,
  WP_BLUNDER_DROP,
  WP_ENDGAME_ADVANTAGE,
} from "./winProb";

export const ENDGAME_NON_PAWN_MAX = 7;
export const MATE_CP_THRESHOLD = 50000;

const CENTER_SQUARES: Square[] = ["d4", "e4", "d5", "e5"];
export const ENDGAME_MINOR_MAJOR: PieceSymbol[] = ["n", "b", "r", "q"];
const MINOR_MAJOR = ENDGAME_MINOR_MAJOR;

export const ENDGAME_PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};
const PIECE_VALUE = ENDGAME_PIECE_VALUE;

export const THEORETICAL_KEYS = [
  "te_pawn_endings",
  "te_queen_vs_pawn",
  "te_rook_vs_pawn",
  "te_bishop_pawn_vs_knight",
  "te_opp_bishop_two_pawns",
  "te_pawn_vs_knight",
  "te_two_pawns_vs_rook",
  "te_knight_pawn_vs_bishop",
  "te_rook_pawn_vs_rook",
] as const;

export type TheoreticalKey = (typeof THEORETICAL_KEYS)[number];

export const THEORETICAL_ADVANTAGE_KEYS: TheoreticalKey[] = [
  "te_queen_vs_pawn",
  "te_rook_vs_pawn",
  "te_bishop_pawn_vs_knight",
  "te_opp_bishop_two_pawns",
];

export const THEORETICAL_DRAW_KEYS: TheoreticalKey[] = [
  "te_pawn_vs_knight",
  "te_two_pawns_vs_rook",
  "te_knight_pawn_vs_bishop",
  "te_rook_pawn_vs_rook",
];

export type TheoreticalHit = {
  key: TheoreticalKey;
  advantageOnly: boolean;
  userHasAdvantage: boolean;
};

export type TheoreticalOutcome = {
  games: number;
  wins: number;
  draws: number;
  win_rate_pct: number;
  draw_rate_pct: number;
};

export type EndgameGameRow = {
  reached_endgame: boolean;
  endgame_start_ply: number | null;
  blunders: number;
  king_centralization: number | null;
  king_distance: number | null;
  pawn_diff: number | null;
  piece_trades: number;
  beneficial_trades: number;
  winning_trades: number;
  simplification_trades: number;
  mate_episodes: number;
  mate_converted: number;
  accidental_stalemate: boolean;
  mate_move_times: number[];
  theoretical: Partial<Record<TheoreticalKey, true>>;
  theoretical_saved: boolean;
  result: string;
};

export type EndgameMetricsAggregate = {
  games: number;
  endgame_games: number;
  endgame_blunder_avg: number | null;
  endgame_theoretical_saved_games: number;
  endgame_theoretical_saved_wins: number;
  endgame_theoretical_saved_draws: number;
  endgame_theoretical_saved_win_pct: number | null;
  endgame_theoretical_saved_draw_pct: number | null;
  endgame_king_centralization: number | null;
  endgame_king_distance: number | null;
  endgame_pawn_diff: number | null;
  endgame_beneficial_trade_pct: number | null;
  endgame_simplification_trade_pct: number | null;
  endgame_mate_conversion_pct: number | null;
  endgame_stalemate_pct: number | null;
  endgame_mate_avg_seconds: number | null;
  outcomes: Partial<Record<TheoreticalKey, TheoreticalOutcome>>;
};

type SideCount = {
  q: number;
  r: number;
  b: number;
  n: number;
  p: number;
  bishopSq: Square[];
};

function squareFile(sq: Square): number {
  return sq.charCodeAt(0) - "a".charCodeAt(0);
}

function squareRank(sq: Square): number {
  return Number(sq[1]) - 1;
}

function chebyshev(a: Square, b: Square): number {
  return Math.max(
    Math.abs(squareFile(a) - squareFile(b)),
    Math.abs(squareRank(a) - squareRank(b))
  );
}

function swapColor(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function sqColor(sq: Square): 0 | 1 {
  return ((squareFile(sq) + squareRank(sq)) % 2) as 0 | 1;
}

function mean(vals: number[], digits = 1): number | null {
  if (!vals.length) return null;
  const factor = 10 ** digits;
  return (
    Math.round(
      (vals.reduce((a, b) => a + b, 0) / vals.length) * factor
    ) / factor
  );
}

function parseSans(game: StudyGame): string[] {
  if (game.moves_str?.trim()) {
    return game.moves_str.trim().split(/\s+/).filter(Boolean);
  }
  if (!game.pgn_str?.trim()) return [];
  try {
    const chess = new Chess();
    chess.loadPgn(game.pgn_str, { strict: false });
    return chess.history();
  } catch {
    return [];
  }
}

export function nonPawnPieceCount(board: Chess): number {
  let total = 0;
  for (const pt of MINOR_MAJOR) {
    total += board.findPiece({ type: pt, color: "w" }).length;
    total += board.findPiece({ type: pt, color: "b" }).length;
  }
  return total;
}

function kingSquare(board: Chess, color: Color): Square | null {
  return board.findPiece({ type: "k", color })[0] ?? null;
}

function sideCount(board: Chess, color: Color): SideCount {
  return {
    q: board.findPiece({ type: "q", color }).length,
    r: board.findPiece({ type: "r", color }).length,
    b: board.findPiece({ type: "b", color }).length,
    n: board.findPiece({ type: "n", color }).length,
    p: board.findPiece({ type: "p", color }).length,
    bishopSq: board.findPiece({ type: "b", color }),
  };
}

function barePieces(s: SideCount): boolean {
  return s.q === 0 && s.r === 0 && s.b === 0 && s.n === 0;
}

function onlyKnight(s: SideCount): boolean {
  return s.q === 0 && s.r === 0 && s.b === 0 && s.n === 1;
}

function onlyQueen(s: SideCount): boolean {
  return s.q === 1 && s.r === 0 && s.b === 0 && s.n === 0;
}

function onlyRook(s: SideCount): boolean {
  return s.q === 0 && s.r === 1 && s.b === 0 && s.n === 0;
}

function onlyBishop(s: SideCount): boolean {
  return s.q === 0 && s.r === 0 && s.b === 1 && s.n === 0;
}

function findStrongSide(
  w: SideCount,
  b: SideCount,
  pred: (strong: SideCount, weak: SideCount) => boolean
): Color | null {
  if (pred(w, b)) return "w";
  if (pred(b, w)) return "b";
  return null;
}

function hitFor(
  key: TheoreticalKey,
  advantageOnly: boolean,
  strongSide: Color | null,
  userColor: Color
): TheoreticalHit {
  return {
    key,
    advantageOnly,
    userHasAdvantage: strongSide == null ? true : strongSide === userColor,
  };
}

export function classifyTheoretical(
  board: Chess,
  userColor: Color = "w"
): TheoreticalHit | null {
  const w = sideCount(board, "w");
  const b = sideCount(board, "b");
  const totalPawns = w.p + b.p;

  if (barePieces(w) && barePieces(b) && totalPawns > 0) {
    return hitFor("te_pawn_endings", false, null, userColor);
  }

  const rookPawnStrong = findStrongSide(
    w,
    b,
    (strong, weak) =>
      onlyRook(strong) &&
      onlyRook(weak) &&
      strong.p >= 1 &&
      weak.p === 0
  );
  if (rookPawnStrong) {
    return hitFor("te_rook_pawn_vs_rook", false, null, userColor);
  }

  if (
    onlyBishop(w) &&
    onlyBishop(b) &&
    w.bishopSq[0] &&
    b.bishopSq[0] &&
    sqColor(w.bishopSq[0]) !== sqColor(b.bishopSq[0]) &&
    totalPawns === 2
  ) {
    const strongSide: Color | null =
      w.p > b.p ? "w" : b.p > w.p ? "b" : null;
    if (strongSide) {
      return hitFor("te_opp_bishop_two_pawns", true, strongSide, userColor);
    }
  }

  const bishopPawnVsKnight = findStrongSide(
    w,
    b,
    (strong, weak) =>
      onlyBishop(strong) &&
      strong.p >= 1 &&
      onlyKnight(weak) &&
      weak.p === 0
  );
  if (bishopPawnVsKnight) {
    return hitFor(
      "te_bishop_pawn_vs_knight",
      true,
      bishopPawnVsKnight,
      userColor
    );
  }

  const knightPawnVsBishop = findStrongSide(
    w,
    b,
    (strong, weak) =>
      onlyKnight(strong) &&
      strong.p >= 1 &&
      onlyBishop(weak) &&
      weak.p === 0
  );
  if (knightPawnVsBishop) {
    return hitFor("te_knight_pawn_vs_bishop", false, null, userColor);
  }

  const twoPawnsVsRook = findStrongSide(
    w,
    b,
    (strong, weak) =>
      barePieces(strong) &&
      strong.p === 2 &&
      onlyRook(weak) &&
      weak.p === 0
  );
  if (twoPawnsVsRook) {
    return hitFor("te_two_pawns_vs_rook", false, null, userColor);
  }

  const rookVsPawn = findStrongSide(
    w,
    b,
    (strong, weak) =>
      onlyRook(strong) && barePieces(weak) && weak.p >= 1 && strong.p === 0
  );
  if (rookVsPawn) {
    return hitFor("te_rook_vs_pawn", true, rookVsPawn, userColor);
  }

  const queenVsPawn = findStrongSide(
    w,
    b,
    (strong, weak) =>
      onlyQueen(strong) && barePieces(weak) && weak.p >= 1 && strong.p === 0
  );
  if (queenVsPawn) {
    return hitFor("te_queen_vs_pawn", true, queenVsPawn, userColor);
  }

  const pawnVsKnight = findStrongSide(
    w,
    b,
    (strong, weak) =>
      onlyKnight(strong) && barePieces(weak) && weak.p >= 1 && strong.p === 0
  );
  if (pawnVsKnight) {
    return hitFor("te_pawn_vs_knight", false, null, userColor);
  }

  return null;
}

export function kingCentralizationScore(
  board: Chess,
  color: Color
): number | null {
  const king = kingSquare(board, color);
  if (!king) return null;
  let best = Infinity;
  for (const sq of CENTER_SQUARES) {
    best = Math.min(best, chebyshev(king, sq));
  }
  return Math.max(0, 4 - best);
}

function isEnemyPasser(
  board: Chess,
  pawnSq: Square,
  enemyColor: Color
): boolean {
  const file = squareFile(pawnSq);
  const rank = squareRank(pawnSq);
  const dir = enemyColor === "w" ? 1 : -1;
  const promoteRank = enemyColor === "w" ? 7 : 0;
  for (let r = rank + dir; dir > 0 ? r <= promoteRank : r >= promoteRank; r += dir) {
    for (const df of [-1, 0, 1]) {
      const f = file + df;
      if (f < 0 || f > 7) continue;
      const sq = `${"abcdefgh"[f]}${r + 1}` as Square;
      const piece = board.get(sq);
      if (piece?.type === "p" && piece.color !== enemyColor) return false;
    }
  }
  return true;
}

function interceptDistance(
  king: Square,
  pawnSq: Square,
  enemyColor: Color
): number {
  const file = squareFile(pawnSq);
  const promoteRank = enemyColor === "w" ? 7 : 0;
  const target = `${"abcdefgh"[file]}${promoteRank + 1}` as Square;
  return chebyshev(king, target);
}

export function kingDistanceToEnemyPawns(
  board: Chess,
  color: Color
): number | null {
  const king = kingSquare(board, color);
  if (!king) return null;
  const enemy = swapColor(color);
  const pawns = board.findPiece({ type: "p", color: enemy });
  if (!pawns.length) return null;
  let best = Infinity;
  for (const pawn of pawns) {
    best = Math.min(best, chebyshev(king, pawn));
    if (isEnemyPasser(board, pawn, enemy)) {
      best = Math.min(best, interceptDistance(king, pawn, enemy));
    }
  }
  return best === Infinity ? null : best;
}

export function pawnDiffDeltaForCapture(
  isUser: boolean,
  captured: PieceSymbol | undefined
): number {
  if (captured !== "p") return 0;
  return isUser ? 1 : -1;
}

function isMateForUser(cpWhite: number, userIsWhite: boolean): boolean {
  const userCp = userIsWhite ? cpWhite : -cpWhite;
  return userCp >= MATE_CP_THRESHOLD;
}

function emptyRow(result: string): EndgameGameRow {
  return {
    reached_endgame: false,
    endgame_start_ply: null,
    blunders: 0,
    king_centralization: null,
    king_distance: null,
    pawn_diff: null,
    piece_trades: 0,
    beneficial_trades: 0,
    winning_trades: 0,
    simplification_trades: 0,
    mate_episodes: 0,
    mate_converted: 0,
    accidental_stalemate: false,
    mate_move_times: [],
    theoretical: {},
    theoretical_saved: false,
    result,
  };
}

export function analyzeEndgameGame(
  game: StudyGame,
  evalsWhiteCp?: number[] | null
): EndgameGameRow | null {
  const sans = parseSans(game);
  if (!sans.length) return null;

  const board = new Chess();
  const userIsWhite =
    String(game.user_color || "white").toLowerCase() === "white";
  const userColor: Color = userIsWhite ? "w" : "b";
  const result = String(game.result || "");
  const evals = evalsWhiteCp ? [...evalsWhiteCp] : [];
  let evalIdx = 0;
  const nextEval = (): number | null => {
    if (evalIdx < evals.length) {
      const cp = evals[evalIdx];
      evalIdx += 1;
      return Number.isFinite(cp) ? cp : null;
    }
    return null;
  };

  let lastWhiteCp = nextEval();
  let endgameStartPly: number | null = null;
  const centerScores: number[] = [];
  const kingDists: number[] = [];
  let pawnDiff = 0;
  let egKingSampleIdx = 0;
  let blunders = 0;
  let pieceTrades = 0;
  let beneficialTrades = 0;
  let winningTrades = 0;
  let simplificationTrades = 0;
  let pieceTradePending: number | null = null;
  let pendingTradeIsUserStart = false;
  let pendingWpBefore = 0;
  let pendingUserPieceVal = 0;
  let pendingCapturedVal = 0;

  let mateEpisodes = 0;
  let mateConverted = 0;
  let inMateEpisode = false;
  let mateEpisodeClean = false;
  const mateMoveTimes: number[] = [];
  let userMoveIdx = 0;
  const theoretical: Partial<Record<TheoreticalKey, true>> = {};
  let theoreticalSaved = false;

  const clock = extractMoveTimesFromPgn(
    game.pgn_str,
    game.time_control,
    game.user_color || "white"
  );
  const userTimes = clock?.user_times || [];

  let wpBeforeLastMove: number | null = null;

  for (let plyIdx = 0; plyIdx < sans.length; plyIdx += 1) {
    let move: Move | null = null;
    try {
      move = board.move(sans[plyIdx]) as Move;
    } catch {
      move = null;
    }
    if (!move) break;
    board.undo();

    const isUser = board.turn() === userColor;
    const isCapture = move.isCapture();
    const captured = move.captured;
    const movingPiece = move.piece;
    const cpBeforeWhite = lastWhiteCp;
    const wpBefore =
      cpBeforeWhite != null
        ? userWinProbability(cpBeforeWhite, userIsWhite)
        : null;
    wpBeforeLastMove = wpBefore;

    board.move(move);
    const cpAfterWhite = nextEval();
    if (cpAfterWhite != null) lastWhiteCp = cpAfterWhite;
    const wpAfter =
      lastWhiteCp != null
        ? userWinProbability(lastWhiteCp, userIsWhite)
        : null;

    if (endgameStartPly == null && nonPawnPieceCount(board) <= ENDGAME_NON_PAWN_MAX) {
      endgameStartPly = plyIdx;
    }

    const inEndgame = endgameStartPly != null && plyIdx >= endgameStartPly;

    if (inEndgame) {
      pawnDiff += pawnDiffDeltaForCapture(isUser, captured);
      if (egKingSampleIdx % HEURISTICS_EG_KING_EVERY === 0) {
        const centr = kingCentralizationScore(board, userColor);
        if (centr != null) centerScores.push(centr);
        const dist = kingDistanceToEnemyPawns(board, userColor);
        if (dist != null) kingDists.push(dist);
      }
      egKingSampleIdx += 1;

      const te = classifyTheoretical(board, userColor);
      if (te) {
        if (!te.advantageOnly || te.userHasAdvantage) {
          theoretical[te.key] = true;
        } else {
          theoreticalSaved = true;
        }
      }

      if (isUser && wpBefore != null && wpAfter != null) {
        if (classifyEvalDrop(wpBefore, wpAfter) === "blunder") blunders += 1;
      }

      if (
        isCapture &&
        captured &&
        MINOR_MAJOR.includes(captured) &&
        MINOR_MAJOR.includes(movingPiece)
      ) {
        if (pieceTradePending != null && plyIdx - pieceTradePending <= 2) {
          pieceTrades += 1;
          const tradeWpBefore = pendingWpBefore;
          const tradeWpAfter = wpAfter ?? tradeWpBefore;
          if (tradeWpAfter > tradeWpBefore) beneficialTrades += 1;
          if (tradeWpBefore >= WP_ENDGAME_ADVANTAGE) {
            winningTrades += 1;
            const userGaveMore =
              pendingTradeIsUserStart
                ? pendingUserPieceVal > pendingCapturedVal
                : pendingCapturedVal > pendingUserPieceVal;
            const drop = tradeWpBefore - tradeWpAfter;
            if (userGaveMore && drop < WP_BLUNDER_DROP) {
              simplificationTrades += 1;
            }
          }
          pieceTradePending = null;
        } else {
          pieceTradePending = plyIdx;
          pendingTradeIsUserStart = isUser;
          pendingWpBefore = wpBefore ?? 0;
          pendingUserPieceVal = PIECE_VALUE[movingPiece] || 0;
          pendingCapturedVal = PIECE_VALUE[captured] || 0;
        }
      }

      if (lastWhiteCp != null) {
        const mateNow = isMateForUser(lastWhiteCp, userIsWhite);
        if (mateNow && !inMateEpisode) {
          inMateEpisode = true;
          mateEpisodeClean = true;
          mateEpisodes += 1;
        } else if (inMateEpisode && !mateNow) {
          mateEpisodeClean = false;
          inMateEpisode = false;
        }
        if (inMateEpisode && isUser) {
          const tIdx = userMoveIdx;
          if (tIdx < userTimes.length) mateMoveTimes.push(userTimes[tIdx]);
        }
      }
    }

    if (isUser) userMoveIdx += 1;
  }

  if (inMateEpisode && mateEpisodeClean && board.isCheckmate()) {
    const winnerIsWhite = board.turn() === "b";
    const userWonMate =
      (userIsWhite && winnerIsWhite) || (!userIsWhite && !winnerIsWhite);
    if (userWonMate) mateConverted += 1;
  }

  let accidentalStalemate = false;
  if (endgameStartPly != null && board.isStalemate()) {
    if (
      wpBeforeLastMove != null &&
      wpBeforeLastMove >= WP_ENDGAME_ADVANTAGE
    ) {
      accidentalStalemate = true;
    }
  }

  if (endgameStartPly == null) {
    return emptyRow(result);
  }

  return {
    reached_endgame: true,
    endgame_start_ply: endgameStartPly,
    blunders,
    king_centralization: mean(centerScores, 2),
    king_distance: mean(kingDists, 2),
    pawn_diff: pawnDiff,
    piece_trades: pieceTrades,
    beneficial_trades: beneficialTrades,
    winning_trades: winningTrades,
    simplification_trades: simplificationTrades,
    mate_episodes: mateEpisodes,
    mate_converted: mateConverted,
    accidental_stalemate: accidentalStalemate,
    mate_move_times: mateMoveTimes,
    theoretical,
    theoretical_saved: theoreticalSaved,
    result,
  };
}

export function aggregateEndgameMetrics(
  rows: EndgameGameRow[]
): EndgameMetricsAggregate {
  const endRows = rows.filter((r) => r.reached_endgame);
  const empty: EndgameMetricsAggregate = {
    games: rows.length,
    endgame_games: 0,
    endgame_blunder_avg: null,
    endgame_theoretical_saved_games: 0,
    endgame_theoretical_saved_wins: 0,
    endgame_theoretical_saved_draws: 0,
    endgame_theoretical_saved_win_pct: null,
    endgame_theoretical_saved_draw_pct: null,
    endgame_king_centralization: null,
    endgame_king_distance: null,
    endgame_pawn_diff: null,
    endgame_beneficial_trade_pct: null,
    endgame_simplification_trade_pct: null,
    endgame_mate_conversion_pct: null,
    endgame_stalemate_pct: null,
    endgame_mate_avg_seconds: null,
    outcomes: {},
  };
  if (!endRows.length) return { ...empty, games: rows.length };

  const totalTrades = endRows.reduce((s, r) => s + r.piece_trades, 0);
  const beneficial = endRows.reduce((s, r) => s + r.beneficial_trades, 0);
  const winningTrades = endRows.reduce((s, r) => s + r.winning_trades, 0);
  const simplifications = endRows.reduce(
    (s, r) => s + r.simplification_trades,
    0
  );
  const mateEps = endRows.reduce((s, r) => s + r.mate_episodes, 0);
  const mateConv = endRows.reduce((s, r) => s + r.mate_converted, 0);
  const stalemates = endRows.filter((r) => r.accidental_stalemate).length;
  const mateTimes = endRows.flatMap((r) => r.mate_move_times);
  const savedRows = endRows.filter((r) => r.theoretical_saved);
  const savedWins = savedRows.filter((r) => r.result === "Win").length;
  const savedDraws = savedRows.filter((r) => r.result === "Draw").length;

  const outcomes: Partial<Record<TheoreticalKey, TheoreticalOutcome>> = {};
  for (const key of THEORETICAL_KEYS) {
    const tagged = endRows.filter((r) => r.theoretical[key]);
    if (!tagged.length) continue;
    const wins = tagged.filter((r) => r.result === "Win").length;
    const draws = tagged.filter((r) => r.result === "Draw").length;
    outcomes[key] = {
      games: tagged.length,
      wins,
      draws,
      win_rate_pct: Math.round((wins / tagged.length) * 1000) / 10,
      draw_rate_pct: Math.round((draws / tagged.length) * 1000) / 10,
    };
  }

  return {
    games: rows.length,
    endgame_games: endRows.length,
    endgame_blunder_avg: mean(
      endRows.map((r) => r.blunders),
      1
    ),
    endgame_theoretical_saved_games: savedRows.length,
    endgame_theoretical_saved_wins: savedWins,
    endgame_theoretical_saved_draws: savedDraws,
    endgame_theoretical_saved_win_pct: savedRows.length
      ? Math.round((savedWins / savedRows.length) * 1000) / 10
      : null,
    endgame_theoretical_saved_draw_pct: savedRows.length
      ? Math.round((savedDraws / savedRows.length) * 1000) / 10
      : null,
    endgame_king_centralization: mean(
      endRows
        .map((r) => r.king_centralization)
        .filter((v): v is number => v != null),
      2
    ),
    endgame_king_distance: mean(
      endRows
        .map((r) => r.king_distance)
        .filter((v): v is number => v != null),
      2
    ),
    endgame_pawn_diff: mean(
      endRows.map((r) => r.pawn_diff).filter((v): v is number => v != null),
      2
    ),
    endgame_beneficial_trade_pct:
      totalTrades > 0
        ? Math.round((beneficial / totalTrades) * 1000) / 10
        : null,
    endgame_simplification_trade_pct:
      winningTrades > 0
        ? Math.round((simplifications / winningTrades) * 1000) / 10
        : null,
    endgame_mate_conversion_pct:
      mateEps > 0 ? Math.round((mateConv / mateEps) * 1000) / 10 : null,
    endgame_stalemate_pct:
      Math.round((stalemates / endRows.length) * 1000) / 10,
    endgame_mate_avg_seconds: mean(mateTimes, 1),
    outcomes,
  };
}

export async function analyzeEndgameGamesBatched(
  games: StudyGame[],
  evalsById: Record<string, number[]> | undefined,
  options?: {
    batchSize?: number;
    signal?: { cancelled: boolean };
    onPartial?: (
      rows: EndgameGameRow[],
      scanned: number,
      total: number
    ) => void;
  }
): Promise<EndgameGameRow[]> {
  const batchSize = options?.batchSize ?? 2;
  const rows: EndgameGameRow[] = [];
  const total = games.length;
  for (let i = 0; i < games.length; i += batchSize) {
    if (options?.signal?.cancelled) break;
    const chunk = games.slice(i, i + batchSize);
    for (const game of chunk) {
      const evals = evalsById?.[String(game.id)];
      const row = analyzeEndgameGame(game, evals);
      if (row) rows.push(row);
    }
    const scanned = Math.min(i + batchSize, total);
    options?.onPartial?.([...rows], scanned, total);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  }
  return rows;
}
