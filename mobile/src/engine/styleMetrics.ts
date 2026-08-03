import { Chess, SQUARES, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
import { extractMoveTimesFromPgn } from "./clockFromPgn";
import {
  ENDGAME_MINOR_MAJOR,
  ENDGAME_NON_PAWN_MAX,
  ENDGAME_PIECE_VALUE,
  MATE_CP_THRESHOLD,
} from "./endgamePhase";
import { inMiddlegamePly } from "./middlegameBounds";
import type { MiddlegameEvalBucket } from "./middlegamePhase";
import {
  moveAccuracyPct,
  openingPhaseEndFullmove,
} from "./openingPhase";
import {
  DRAWISH_MIN_FULLMOVE,
  normalizeGameResult,
  userWinProbability,
  classifyEvalDrop,
  isMistakeOrWorse,
  isBlunderSwingUp,
  wpDropPp,
  WP_BLUNDER_DROP,
  CP_ENDGAME_ADVANTAGE_STICKY,
  WP_CRITICAL_CP,
  WP_CRITICAL_DELTA,
  WP_DISADVANTAGE,
  WP_DRAWISH_HI,
  WP_DRAWISH_LO,
  WP_ENDGAME_ADVANTAGE,
  WP_ENDGAME_ADVANTAGE_STICKY,
  WP_INACCURACY_DROP,
} from "./winProb";

const EVAL_CLAMP = 1000;

function clampCp(value: number): number {
  const abs = Math.abs(value);
  if (abs >= MATE_CP_THRESHOLD) {
    return value > 0 ? EVAL_CLAMP + 50 : -(EVAL_CLAMP + 50);
  }
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, value));
}

export type EndgameEvalBucket = {
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  tactics_made: number;
  missed_opportunity_chances: number;
  missed_opportunities: number;
  piece_trades: number;
  beneficial_trades: number;
  winning_trades: number;
  simplification_trades: number;
  mate_episodes: number;
  mate_converted: number;
  accidental_stalemate: boolean;
  mate_move_times: number[];
};

export type { MiddlegameEvalBucket };

export type EvalBucketExtras = {
  opening_accuracy_pct: number | null;
  opening_accuracy_moves: number;
  endgameEval: EndgameEvalBucket | null;
  middlegameEval: MiddlegameEvalBucket | null;
};

export const ENDGAME_NON_KING_MAX = 10;
export const EARLY_MOVE_MAX = 12;
export const EARLY_FLANK_FULLMOVE_MAX = 12;
export const EG_TRADE_WINDOW_PLIES = 3;
export const KING_TRADE_DIST = 2;
export const SACRIFICE_MIN_OFFER = 3;

export const STYLE_PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};
const PIECE_VALUE = STYLE_PIECE_VALUE;

export const STYLE_MINOR_MAJOR: PieceSymbol[] = ["n", "b", "r", "q"];
const MINOR_MAJOR = STYLE_MINOR_MAJOR;

export type StyleGameRow = {
  id: string;
  result: string;
  win: boolean;
  volatility_cp: number;
  sacrifice_moves: number;
  had_sacrifice: boolean;
  early_flank_pushes: number;
  had_early_flank: boolean;
  had_endgame_advantage: boolean;
  converted_endgame: boolean;
  territory_own: number;
  territory_opp: number;
  territory_opp_pct: number;
  early_trades: number;
  had_early_trade: boolean;
  trades_near_enemy_king: number;
  trades_near_user_king: number;
  forward_moves: number;
  backward_moves: number;
  lateral_moves: number;
  higher_threats: number;
  threat_escapes: number;
  user_moves: number;
  avg_time_per_move_s: number | null;
  opp_avg_time_per_move_s: number | null;
  clock_diff_s: number | null;
  drawishless: boolean;
  declined_recaptures: number;
  recapture_chances: number;
  critical_move_times: number[];
  avg_critical_time_s: number | null;
  critical_positions: number;
  endgame_advantage_start_ply: number | null;
  had_disadvantage: boolean;
  recovered_from_disadvantage: boolean;
  blunders: number;
  blunder_rate_pct: number;
  disadvantage_move_times: number[];
  avg_disadvantage_time_s: number | null;
  disadvantage_positions: number;
};

export type StyleMetricsAggregate = {
  games: number;
  wins: number;
  win_rate: number;
  avg_time_per_move_s: number | null;
  games_with_clock: number;
  initiative: {
    avg_eval_volatility_cp: number;
    sacrifice_rate_pct: number;
    avg_sacrifice_moves: number;
    early_flank_rate_pct: number;
    avg_early_flank_pushes: number;
    endgame_advantage_games: number;
    endgame_conversion_rate_pct: number | null;
    early_trade_rate_pct: number;
    avg_early_trades: number;
  } | Record<string, never>;
  attacking: {
    avg_higher_value_threats: number;
    avg_threat_escapes: number;
    avg_trades_near_enemy_king: number;
    avg_trades_near_user_king: number;
    territory_opp_pct: number;
    territory_own_pct: number;
    forward_move_pct: number;
    backward_move_pct: number;
    lateral_move_pct: number;
  } | Record<string, never>;
  creativity: {
    drawishless_games: number;
    drawishless_rate_pct: number;
    declined_recapture_rate_pct: number;
    declined_recaptures: number;
    recapture_chances: number;
    avg_declined_recaptures: number;
    avg_critical_time_s: number | null;
    critical_positions: number;
    avg_critical_positions: number;
  } | Record<string, never>;
  durability: {
    disadvantage_games: number;
    recovered_games: number;
    recovery_rate_pct: number | null;
    total_blunders: number;
    avg_blunders: number;
    blunder_rate_pct: number;
    avg_clock_diff_s: number | null;
    avg_disadvantage_time_s: number | null;
    disadvantage_positions: number;
  } | Record<string, never>;
  per_game: StyleGameRow[];
};

export function squareFile(sq: Square): number {
  return sq.charCodeAt(0) - "a".charCodeAt(0);
}

export function squareRank(sq: Square): number {
  return Number(sq[1]) - 1;
}

export function chebyshev(a: Square, b: Square): number {
  return Math.max(
    Math.abs(squareFile(a) - squareFile(b)),
    Math.abs(squareRank(a) - squareRank(b))
  );
}

export function isFlankFile(fileIdx: number): boolean {
  return fileIdx <= 1 || fileIdx >= 6;
}

export function isEarlyFlankPush(
  color: Color,
  toFile: number,
  toRank: number
): boolean {
  if (!isFlankFile(toFile)) return false;
  if (color === "w") return toRank >= 3;
  return toRank <= 4;
}

export function swapColor(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function pieceMaterialFor(board: Chess, color: Color): number {
  let total = 0;
  for (const pt of MINOR_MAJOR) {
    total += board.findPiece({ type: pt, color }).length * PIECE_VALUE[pt];
  }
  return total;
}

export function pieceMaterialBalance(board: Chess, color: Color): number {
  return pieceMaterialFor(board, color) - pieceMaterialFor(board, swapColor(color));
}

export function nonKingCount(board: Chess): number {
  let total = 0;
  for (const pt of ["p", "n", "b", "r", "q"] as PieceSymbol[]) {
    total += board.findPiece({ type: pt, color: "w" }).length;
    total += board.findPiece({ type: pt, color: "b" }).length;
  }
  return total;
}

export function kingSquare(board: Chess, color: Color): Square | null {
  const squares = board.findPiece({ type: "k", color });
  return squares[0] ?? null;
}

export function maxUndefendedHangingPieces(board: Chess, color: Color): number {
  let best = 0;
  const opp = swapColor(color);
  for (const pt of MINOR_MAJOR) {
    const val = PIECE_VALUE[pt];
    for (const sq of board.findPiece({ type: pt, color })) {
      if (!board.isAttacked(sq, opp)) continue;
      if (board.isAttacked(sq, color)) continue;
      best = Math.max(best, val);
    }
  }
  return best;
}

export function hasMaterialWinTactic(board: Chess, color: Color): boolean {
  if (board.turn() !== color) return false;
  if (maxUndefendedHangingPieces(board, swapColor(color)) > 0) return true;
  const moves = board.moves({ verbose: true }) as Move[];
  for (const m of moves) {
    if (!m.isCapture() || !m.captured) continue;
    const gain = PIECE_VALUE[m.captured] || 0;
    if (gain < 1) continue;
    const dest = m.to;
    if (!board.isAttacked(dest, swapColor(color))) return true;
    const defenders = board.attackers(dest, swapColor(color));
    let minDef = 99;
    for (const d of defenders) {
      const dp = board.get(d);
      if (!dp) continue;
      minDef = Math.min(minDef, PIECE_VALUE[dp.type] || 99);
    }
    const attacker = board.get(m.from);
    const aVal = attacker ? PIECE_VALUE[attacker.type] || 0 : 0;
    if (gain > aVal || (gain >= aVal && aVal <= minDef)) return true;
  }
  return false;
}

export function threatensHigherValue(board: Chess, move: Move, color: Color): boolean {
  const applied = board.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });
  if (!applied) return false;
  try {
    return threatensHigherValueAfter(board, move, color);
  } finally {
    board.undo();
  }
}

export function threatensHigherValueAfter(
  boardAfter: Chess,
  move: Move,
  color: Color
): boolean {
  if (move.piece === "k") return false;
  const aVal = PIECE_VALUE[move.piece] ?? 0;
  if (
    move.isCapture() &&
    move.captured &&
    move.captured !== "k" &&
    move.captured !== "p" &&
    aVal < (PIECE_VALUE[move.captured] ?? 0)
  ) {
    return true;
  }
  const opp = swapColor(color);
  for (const pt of MINOR_MAJOR) {
    const vVal = PIECE_VALUE[pt] ?? 0;
    if (aVal >= vVal) continue;
    for (const sq of boardAfter.findPiece({ type: pt, color: opp })) {
      if (boardAfter.attackers(sq, color).includes(move.to)) return true;
    }
  }
  return false;
}

export function isUnderEnemyAttack(board: Chess, sq: Square, color: Color): boolean {
  const piece = board.get(sq);
  if (!piece || piece.color !== color || piece.type === "k") return false;
  return board.attackers(sq, swapColor(color)).length > 0;
}

export function isUnderLesserAttack(board: Chess, sq: Square, color: Color): boolean {
  const piece = board.get(sq);
  if (!piece || piece.color !== color || piece.type === "k" || piece.type === "p") {
    return false;
  }
  const vVal = PIECE_VALUE[piece.type] ?? 0;
  for (const atkSq of board.attackers(sq, swapColor(color))) {
    const atk = board.get(atkSq);
    if (!atk || atk.type === "k") continue;
    if ((PIECE_VALUE[atk.type] ?? 0) < vVal) return true;
  }
  return false;
}

export function canRecapture(board: Chess, captureToSq: Square): boolean {
  return board.attackers(captureToSq, board.turn()).length > 0;
}

export function sacrificeOfferAfterMove(
  boardAfter: Chess,
  move: Move,
  color: Color
): number {
  const opp = swapColor(color);
  const moverVal = PIECE_VALUE[move.piece] ?? 0;
  const capturedVal = move.captured ? PIECE_VALUE[move.captured] ?? 0 : 0;
  const destAttacked = boardAfter.isAttacked(move.to, opp);
  const destDefended = boardAfter.isAttacked(move.to, color);
  if (move.isCapture() && destAttacked) {
    const tradeLoss = moverVal - capturedVal;
    return tradeLoss >= SACRIFICE_MIN_OFFER ? tradeLoss : 0;
  }
  if (
    destAttacked &&
    !destDefended &&
    moverVal >= SACRIFICE_MIN_OFFER
  ) {
    return Math.max(0, moverVal - capturedVal);
  }
  return 0;
}

function isImmediateRecapture(
  move: Move,
  pendingSq: Square | null,
  isCapture: boolean
): boolean {
  return (
    pendingSq != null && isCapture && move.to === pendingSq
  );
}

export function nextCp(
  evalsWhiteCp: number[],
  evalIdx: number
): { cp: number | null; nextIdx: number } {
  if (evalIdx < evalsWhiteCp.length) {
    return { cp: evalsWhiteCp[evalIdx], nextIdx: evalIdx + 1 };
  }
  return { cp: null, nextIdx: evalIdx + 1 };
}

export function parseSans(game: StudyGame): string[] {
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

function mean(vals: number[]): number {
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0.0;
}

export type StyleScanSession = {
  game: StudyGame;
  board: Chess;
  userIsWhite: boolean;
  userColor: Color;
  result: string;
  evalsWhite: number[];
  userWps: number[];
  territoryOwn: number;
  territoryOpp: number;
  forwardMoves: number;
  backwardMoves: number;
  lateralMoves: number;
  earlyTrades: number;
  tradesNearEnemyKing: number;
  tradesNearUserKing: number;
  higherThreats: number;
  threatEscapes: number;
  userMoves: number;
  earlyFlankPushes: number;
  sacrificeMoves: number;
  declinedRecaptures: number;
  recaptureChances: number;
  criticalTimes: number[];
  disadvantageTimes: number[];
  blunders: number;
  hadDisadvantage: boolean;
  hadEndgameAdvantage: boolean;
  pieceTradePending: number | null;
  pendingRecaptureSq: Square | null;
  castleFullmove: number | null;
  phaseEnd: number;
  accuracySamples: number[];
  mgAccuracySamples: number[];
  mgBlunders: number;
  mgMistakes: number;
  mgInaccuracies: number;
  mgTacticsMade: number;
  mgPendingOppBlunder: boolean;
  mgPendingOppTactic: boolean;
  mgPendingOppWp: number | null;
  mgMissedOppChances: number;
  mgMissedOpps: number;
  mgMissedTacticChances: number;
  mgMissedTactics: number;
  mgPendingAllowed: boolean;
  mgAllowedChances: number;
  mgAllowedFound: number;
  endgameStartPly: number | null;
  egBlunders: number;
  egMistakes: number;
  egInaccuracies: number;
  egTacticsMade: number;
  egMissedOppChances: number;
  egMissedOpps: number;
  egPendingOppBlunder: boolean;
  egPendingOppWp: number | null;
  egPieceTrades: number;
  egBeneficialTrades: number;
  egWinningTrades: number;
  egSimplificationTrades: number;
  egTradePending: number | null;
  egPendingUserStart: boolean;
  egPendingWpBefore: number;
  egPendingCpBefore: number;
  egPendingUserNet: number;
  egPendingUserPieceVal: number;
  egPendingCapturedVal: number;
  egPendingPieceSeen: boolean;
  pendingSacrificeSq: Square | null;
  pendingSacrificeOk: boolean;
  pendingSacrificeAccepted: boolean;
  pendingSacrificeOfferVal: number;
  lastCapture: {
    ply: number;
    color: Color;
    piece: PieceSymbol;
    captured: PieceSymbol;
    to: Square;
  } | null;
  mateEpisodes: number;
  mateConverted: number;
  inMateEpisode: boolean;
  mateEpisodeClean: boolean;
  mateMoveTimes: number[];
  wpBeforeLastMove: number | null;
  userTimes: number[];
  userJustCaptured: boolean;
  endgameAdvantageStartPly: number | null;
  criticalPositions: number;
  clock: ReturnType<typeof extractMoveTimesFromPgn>;
  alive: boolean;
};

export function createStyleScanSession(game: StudyGame): StyleScanSession | null {
  const sans = parseSans(game);
  if (!sans.length) return null;
  const userIsWhite =
    String(game.user_color || "white").toLowerCase() === "white";
  const clock = extractMoveTimesFromPgn(
    game.pgn_str,
    game.time_control,
    game.user_color || "white"
  );
  return {
    game,
    board: new Chess(),
    userIsWhite,
    userColor: userIsWhite ? "w" : "b",
    result: normalizeGameResult(game.result, userIsWhite),
    evalsWhite: [],
    userWps: [],
    territoryOwn: 0,
    territoryOpp: 0,
    forwardMoves: 0,
    backwardMoves: 0,
    lateralMoves: 0,
    earlyTrades: 0,
    tradesNearEnemyKing: 0,
    tradesNearUserKing: 0,
    higherThreats: 0,
    threatEscapes: 0,
    userMoves: 0,
    earlyFlankPushes: 0,
    sacrificeMoves: 0,
    declinedRecaptures: 0,
    recaptureChances: 0,
    criticalTimes: [],
    disadvantageTimes: [],
    blunders: 0,
    hadDisadvantage: false,
    hadEndgameAdvantage: false,
    pieceTradePending: null,
    pendingRecaptureSq: null,
    castleFullmove: null,
    phaseEnd: openingPhaseEndFullmove(null),
    accuracySamples: [],
    mgAccuracySamples: [],
    mgBlunders: 0,
    mgMistakes: 0,
    mgInaccuracies: 0,
    mgTacticsMade: 0,
    mgPendingOppBlunder: false,
    mgPendingOppTactic: false,
    mgPendingOppWp: null,
    mgMissedOppChances: 0,
    mgMissedOpps: 0,
    mgMissedTacticChances: 0,
    mgMissedTactics: 0,
    mgPendingAllowed: false,
    mgAllowedChances: 0,
    mgAllowedFound: 0,
    endgameStartPly: null,
    egBlunders: 0,
    egMistakes: 0,
    egInaccuracies: 0,
    egTacticsMade: 0,
    egMissedOppChances: 0,
    egMissedOpps: 0,
    egPendingOppBlunder: false,
    egPendingOppWp: null,
    egPieceTrades: 0,
    egBeneficialTrades: 0,
    egWinningTrades: 0,
    egSimplificationTrades: 0,
    egTradePending: null,
    egPendingUserStart: false,
    egPendingWpBefore: 0,
    egPendingCpBefore: 0,
    egPendingUserNet: 0,
    egPendingUserPieceVal: 0,
    egPendingCapturedVal: 0,
    egPendingPieceSeen: false,
    pendingSacrificeSq: null,
    pendingSacrificeOk: false,
    pendingSacrificeAccepted: false,
    pendingSacrificeOfferVal: 0,
    lastCapture: null,
    mateEpisodes: 0,
    mateConverted: 0,
    inMateEpisode: false,
    mateEpisodeClean: false,
    mateMoveTimes: [],
    wpBeforeLastMove: null,
    userTimes: clock?.user_times || [],
    userJustCaptured: false,
    endgameAdvantageStartPly: null,
    criticalPositions: 0,
    clock,
    alive: true,
  };
}

export function styleScanConsumeRoot(session: StyleScanSession, cpWhite: number): void {
  const cp = clampCp(cpWhite);
  session.evalsWhite.push(cp);
  session.userWps.push(userWinProbability(cp, session.userIsWhite));
}

export function styleScanProcessPly(
  session: StyleScanSession,
  san: string,
  evalBefore: number | null,
  evalAfter: number | null,
  plyIdx: number
): boolean {
  if (!session.alive) return false;
  const board = session.board;
  const userColor = session.userColor;
  const userIsWhite = session.userIsWhite;
  const isUser = board.turn() === userColor;
  const balBefore = pieceMaterialBalance(board, userColor);
  const enemyKing = kingSquare(board, swapColor(userColor));
  const userKing = kingSquare(board, userColor);
  const beforeCp = evalBefore != null ? clampCp(evalBefore) : null;
  const wpBeforeMove =
    beforeCp != null ? userWinProbability(beforeCp, userIsWhite) : null;
  session.wpBeforeLastMove = wpBeforeMove;

  let hadTacticBefore = false;
  let pendingCanRecapture = false;
  const pendingRecaptureSq = session.pendingRecaptureSq;
  if (isUser) {
    hadTacticBefore = hasMaterialWinTactic(board, userColor);
    if (pendingRecaptureSq != null) {
      pendingCanRecapture = canRecapture(board, pendingRecaptureSq);
    }
  }

  let move: Move | null = null;
  try {
    move = board.move(san) as Move;
  } catch {
    move = null;
  }
  if (!move) {
    session.alive = false;
    return false;
  }

  const fullMove = Math.floor(plyIdx / 2) + 1;
  const fromSq = move.from;
  const toSq = move.to;
  const fromRank = squareRank(fromSq);
  const toRank = squareRank(toSq);
  const toFile = squareFile(toSq);
  const isCapture = move.isCapture();
  const captured = move.captured;
  const movingPiece = move.piece;
  const isCastle = move.isKingsideCastle() || move.isQueensideCastle();
  if (isUser && isCastle && session.castleFullmove == null) {
    session.castleFullmove = fullMove;
    session.phaseEnd = openingPhaseEndFullmove(session.castleFullmove);
  }
  const inOpening = fullMove <= session.phaseEnd;
  let userBalDelta = 0;

  if (isUser) {
    const userMoveIdx = session.userMoves;
    session.userMoves += 1;

    if (
      session.pendingSacrificeAccepted &&
      session.pendingSacrificeSq != null
    ) {
      const recovered =
        isCapture &&
        captured != null &&
        (PIECE_VALUE[captured] || 0) >=
          Math.max(3, session.pendingSacrificeOfferVal - 1);
      if (
        !recovered &&
        !isImmediateRecapture(move, session.pendingSacrificeSq, isCapture)
      ) {
        session.sacrificeMoves += 1;
      }
      session.pendingSacrificeSq = null;
      session.pendingSacrificeOk = false;
      session.pendingSacrificeAccepted = false;
      session.pendingSacrificeOfferVal = 0;
    }

    if (session.userWps.length) {
      const wpBeforeStyle = session.userWps[session.userWps.length - 1];
      if (wpBeforeStyle <= WP_DISADVANTAGE) {
        session.hadDisadvantage = true;
        if (userMoveIdx < session.userTimes.length) {
          session.disadvantageTimes.push(session.userTimes[userMoveIdx]);
        }
      }
    }

    if (pendingRecaptureSq != null) {
      if (pendingCanRecapture) {
        session.recaptureChances += 1;
        if (!(isCapture && toSq === pendingRecaptureSq)) {
          session.declinedRecaptures += 1;
        }
      }
      session.pendingRecaptureSq = null;
    }

    let inOpp = false;
    if (userIsWhite) {
      inOpp = toRank >= 4;
      if (inOpp) session.territoryOpp += 1;
      else session.territoryOwn += 1;
      if (toRank > fromRank) session.forwardMoves += 1;
      else if (toRank < fromRank) session.backwardMoves += 1;
      else session.lateralMoves += 1;
    } else {
      inOpp = toRank <= 3;
      if (inOpp) session.territoryOpp += 1;
      else session.territoryOwn += 1;
      if (toRank < fromRank) session.forwardMoves += 1;
      else if (toRank > fromRank) session.backwardMoves += 1;
      else session.lateralMoves += 1;
    }

    if (
      movingPiece === "p" &&
      fullMove <= EARLY_FLANK_FULLMOVE_MAX &&
      isEarlyFlankPush(userColor, toFile, toRank)
    ) {
      session.earlyFlankPushes += 1;
    }

    if (threatensHigherValueAfter(board, move, userColor)) {
      session.higherThreats += 1;
    }

    session.userJustCaptured = isCapture;

    if (movingPiece !== "p" && movingPiece !== "k") {
      const opp = swapColor(userColor);
      const fromThreatened = board.isAttacked(fromSq, opp);
      if (
        fromThreatened &&
        !isUnderEnemyAttack(board, toSq, userColor) &&
        !isUnderLesserAttack(board, toSq, userColor)
      ) {
        session.threatEscapes += 1;
      }
    }

    const cpRaw = evalAfter;
    const cp = cpRaw != null ? clampCp(cpRaw) : null;
    if (cp != null) {
      session.evalsWhite.push(cp);
      session.userWps.push(userWinProbability(cp, userIsWhite));
    }

    if (beforeCp != null && cp != null) {
      const balAfter = pieceMaterialBalance(board, userColor);
      userBalDelta = balAfter - balBefore;
      const offered = sacrificeOfferAfterMove(board, move, userColor);
      const evalBeforeUser = userIsWhite ? beforeCp : -beforeCp;
      const evalAfterUser = userIsWhite ? cp : -cp;
      const evalDelta = evalAfterUser - evalBeforeUser;
      const wpBefore = userWinProbability(beforeCp, userIsWhite);
      const wpAfterLocal = userWinProbability(cp, userIsWhite);
      const wpDrop = wpBefore - wpAfterLocal;
      if (
        offered >= SACRIFICE_MIN_OFFER &&
        evalDelta >= -50 &&
        wpAfterLocal >= wpBefore - 0.03 &&
        wpDrop < WP_INACCURACY_DROP
      ) {
        session.pendingSacrificeSq = toSq;
        session.pendingSacrificeOk = true;
        session.pendingSacrificeAccepted = false;
        session.pendingSacrificeOfferVal = offered;
      }

      const dropKind = classifyEvalDrop(wpBefore, wpAfterLocal);
      if (!inOpening && dropKind === "blunder") session.blunders += 1;

      const cpSwing = Math.abs(evalAfterUser - evalBeforeUser);
      if (
        Math.abs(wpAfterLocal - wpBefore) >= WP_CRITICAL_DELTA &&
        cpSwing >= WP_CRITICAL_CP
      ) {
        session.criticalPositions += 1;
        if (userMoveIdx < session.userTimes.length) {
          session.criticalTimes.push(session.userTimes[userMoveIdx]);
        }
      }

      if (wpAfterLocal <= WP_DISADVANTAGE) {
        session.hadDisadvantage = true;
      }

      if (inOpening) {
        session.accuracySamples.push(
          moveAccuracyPct(wpBefore * 100, wpAfterLocal * 100)
        );
      }
    }

    if (isCapture && captured && MINOR_MAJOR.includes(captured)) {
      if (fullMove <= EARLY_MOVE_MAX) {
        if (
          session.pieceTradePending != null &&
          plyIdx - session.pieceTradePending <= 2
        ) {
          session.earlyTrades += 1;
          if (enemyKing != null && chebyshev(toSq, enemyKing) <= KING_TRADE_DIST) {
            session.tradesNearEnemyKing += 1;
          }
          if (userKing != null && chebyshev(toSq, userKing) <= KING_TRADE_DIST) {
            session.tradesNearUserKing += 1;
          }
          session.pieceTradePending = null;
        } else {
          session.pieceTradePending = plyIdx;
        }
      }
    }
  } else {
    if (
      session.pendingSacrificeOk &&
      session.pendingSacrificeSq != null &&
      !session.pendingSacrificeAccepted
    ) {
      if (isImmediateRecapture(move, session.pendingSacrificeSq, isCapture)) {
        session.pendingSacrificeAccepted = true;
      } else {
        session.pendingSacrificeSq = null;
        session.pendingSacrificeOk = false;
        session.pendingSacrificeAccepted = false;
        session.pendingSacrificeOfferVal = 0;
      }
    }

    if (isCapture && !session.userJustCaptured) {
      session.pendingRecaptureSq = toSq;
    } else {
      session.pendingRecaptureSq = null;
    }
    session.userJustCaptured = false;

    if (isCapture && captured && MINOR_MAJOR.includes(captured)) {
      if (fullMove <= EARLY_MOVE_MAX) {
        if (
          session.pieceTradePending != null &&
          plyIdx - session.pieceTradePending <= 2
        ) {
          session.earlyTrades += 1;
          if (enemyKing != null && chebyshev(toSq, enemyKing) <= KING_TRADE_DIST) {
            session.tradesNearEnemyKing += 1;
          }
          if (userKing != null && chebyshev(toSq, userKing) <= KING_TRADE_DIST) {
            session.tradesNearUserKing += 1;
          }
          session.pieceTradePending = null;
        } else {
          session.pieceTradePending = plyIdx;
        }
      }
    }

    const cp = evalAfter != null ? clampCp(evalAfter) : null;
    if (cp != null) {
      session.evalsWhite.push(cp);
      const wp = userWinProbability(cp, userIsWhite);
      session.userWps.push(wp);
      if (wp <= WP_DISADVANTAGE) {
        session.hadDisadvantage = true;
      }
    }
  }

  const cpAfter = evalAfter != null ? clampCp(evalAfter) : null;
  const wpAfter =
    cpAfter != null ? userWinProbability(cpAfter, userIsWhite) : null;

  if (session.endgameStartPly == null) {
    let np = 0;
    for (const pt of ENDGAME_MINOR_MAJOR) {
      np += board.findPiece({ type: pt, color: "w" }).length;
      np += board.findPiece({ type: pt, color: "b" }).length;
    }
    if (np <= ENDGAME_NON_PAWN_MAX) session.endgameStartPly = plyIdx;
  }

  if (
    !session.hadEndgameAdvantage &&
    session.endgameStartPly != null &&
    plyIdx >= session.endgameStartPly &&
    cpAfter != null
  ) {
    const userCp = userIsWhite ? cpAfter : -cpAfter;
    const wp = userWinProbability(cpAfter, userIsWhite);
    if (
      wp >= WP_ENDGAME_ADVANTAGE_STICKY ||
      userCp >= CP_ENDGAME_ADVANTAGE_STICKY
    ) {
      session.hadEndgameAdvantage = true;
      session.endgameAdvantageStartPly = plyIdx;
    }
  }

  const inMg = inMiddlegamePly(
    plyIdx,
    session.phaseEnd,
    session.endgameStartPly
  );
  if (inMg) {
    if (isUser && wpBeforeMove != null && wpAfter != null) {
      session.mgAccuracySamples.push(
        moveAccuracyPct(wpBeforeMove * 100, wpAfter * 100)
      );
      const kind = classifyEvalDrop(wpBeforeMove, wpAfter);
      if (kind === "blunder") session.mgBlunders += 1;
      else if (kind === "mistake") session.mgMistakes += 1;
      else if (kind === "inaccuracy") session.mgInaccuracies += 1;
      if (hadTacticBefore && isCapture && userBalDelta >= 2) {
        session.mgTacticsMade += 1;
      }
    }

    if (isUser && session.mgPendingOppBlunder) {
      session.mgMissedOppChances += 1;
      if (session.mgPendingOppTactic) session.mgMissedTacticChances += 1;
      const missed =
        wpBeforeMove != null &&
        wpAfter != null &&
        (isMistakeOrWorse(wpBeforeMove, wpAfter) ||
          (session.mgPendingOppWp != null &&
            wpDropPp(session.mgPendingOppWp, wpAfter) >= 10));
      if (missed) {
        session.mgMissedOpps += 1;
        if (session.mgPendingOppTactic) session.mgMissedTactics += 1;
      }
      session.mgPendingOppBlunder = false;
      session.mgPendingOppTactic = false;
      session.mgPendingOppWp = null;
    }

    if (!isUser && session.mgPendingAllowed) {
      const found =
        (wpBeforeMove != null &&
          wpAfter != null &&
          wpDropPp(wpBeforeMove, wpAfter) >= 7.5) ||
        isCapture;
      if (found) session.mgAllowedFound += 1;
      session.mgPendingAllowed = false;
    }

    if (!isUser && wpBeforeMove != null && wpAfter != null) {
      if (isBlunderSwingUp(wpBeforeMove, wpAfter)) {
        session.mgPendingOppBlunder = true;
        session.mgPendingOppWp = wpAfter;
        session.mgPendingOppTactic = hasMaterialWinTactic(board, userColor);
      }
    }

    if (isUser && wpBeforeMove != null && wpAfter != null) {
      if (
        classifyEvalDrop(wpBeforeMove, wpAfter) === "blunder" &&
        hasMaterialWinTactic(board, swapColor(userColor))
      ) {
        session.mgAllowedChances += 1;
        session.mgPendingAllowed = true;
      }
    }
  } else {
    if (!isUser && session.mgPendingAllowed) session.mgPendingAllowed = false;
    if (isUser && session.mgPendingOppBlunder) {
      session.mgPendingOppBlunder = false;
      session.mgPendingOppTactic = false;
      session.mgPendingOppWp = null;
    }
  }

  if (session.endgameStartPly != null && plyIdx >= session.endgameStartPly) {
    if (isUser && wpBeforeMove != null && wpAfter != null) {
      const kind = classifyEvalDrop(wpBeforeMove, wpAfter);
      if (kind === "blunder") session.egBlunders += 1;
      else if (kind === "mistake") session.egMistakes += 1;
      else if (kind === "inaccuracy") session.egInaccuracies += 1;
      if (hadTacticBefore && isCapture && userBalDelta >= 2) {
        session.egTacticsMade += 1;
      }
    }

    if (isUser && session.egPendingOppBlunder) {
      session.egMissedOppChances += 1;
      const missed =
        wpBeforeMove != null &&
        wpAfter != null &&
        (isMistakeOrWorse(wpBeforeMove, wpAfter) ||
          (session.egPendingOppWp != null &&
            wpDropPp(session.egPendingOppWp, wpAfter) >= 10));
      if (missed) session.egMissedOpps += 1;
      session.egPendingOppBlunder = false;
      session.egPendingOppWp = null;
    }

    if (!isUser && wpBeforeMove != null && wpAfter != null) {
      if (isBlunderSwingUp(wpBeforeMove, wpAfter)) {
        session.egPendingOppBlunder = true;
        session.egPendingOppWp = wpAfter;
      }
    }

    if (isCapture && captured) {
      const capVal = ENDGAME_PIECE_VALUE[captured] || 0;
      const moverVal = ENDGAME_PIECE_VALUE[movingPiece] || 0;
      const pieceCap = ENDGAME_MINOR_MAJOR.includes(captured);
      const userGain = isUser ? capVal : -capVal;
      const last = session.lastCapture;

      if (
        session.egTradePending != null &&
        plyIdx - session.egTradePending <= EG_TRADE_WINDOW_PLIES
      ) {
        session.egPendingUserNet += userGain;
        if (pieceCap) {
          const completerIsPiece = ENDGAME_MINOR_MAJOR.includes(movingPiece);
          const majorInvolved =
            capVal >= 5 ||
            session.egPendingCapturedVal >= 5 ||
            session.egPendingUserPieceVal >= 5;
          if (completerIsPiece || majorInvolved) {
            session.egPieceTrades += 1;
            const tradeWpBefore = session.egPendingWpBefore;
            const tradeWpAfter = wpAfter ?? tradeWpBefore;
            const tradeCpBefore = session.egPendingCpBefore;
            const tradeCpAfter =
              cpAfter != null
                ? userIsWhite
                  ? cpAfter
                  : -cpAfter
                : tradeCpBefore;
            if (
              tradeWpAfter > tradeWpBefore ||
              tradeCpAfter > tradeCpBefore
            ) {
              session.egBeneficialTrades += 1;
            }
            if (session.egPendingUserNet > 0) {
              session.egWinningTrades += 1;
            }
            if (tradeWpBefore >= WP_ENDGAME_ADVANTAGE) {
              const userGaveMore = session.egPendingUserStart
                ? session.egPendingUserPieceVal >
                  session.egPendingCapturedVal
                : session.egPendingCapturedVal >
                  session.egPendingUserPieceVal;
              if (
                userGaveMore &&
                tradeWpBefore - tradeWpAfter < WP_BLUNDER_DROP
              ) {
                session.egSimplificationTrades += 1;
              }
            }
          }
          session.egTradePending = null;
        }
      } else if (pieceCap) {
        let net = userGain;
        let userPieceVal = isUser ? moverVal : capVal;
        let capturedVal = isUser ? capVal : moverVal;
        let userStart = isUser;
        if (last && last.ply === plyIdx - 1 && last.to === toSq) {
          const lastWasUser = last.color === userColor;
          const lastCapVal = ENDGAME_PIECE_VALUE[last.captured] || 0;
          if (lastWasUser && !isUser) {
            net = lastCapVal - capVal;
            userStart = true;
            userPieceVal = ENDGAME_PIECE_VALUE[last.piece] || 0;
            capturedVal = lastCapVal;
          } else if (!lastWasUser && isUser) {
            net = capVal - lastCapVal;
            userStart = false;
            userPieceVal = lastCapVal;
            capturedVal = capVal;
          }
        }
        session.egTradePending = plyIdx;
        session.egPendingUserStart = userStart;
        session.egPendingWpBefore = wpBeforeMove ?? 0;
        session.egPendingCpBefore =
          beforeCp != null
            ? userIsWhite
              ? beforeCp
              : -beforeCp
            : 0;
        session.egPendingUserNet = net;
        session.egPendingUserPieceVal = userPieceVal;
        session.egPendingCapturedVal = capturedVal;
        session.egPendingPieceSeen = true;
      }
    }
    if (cpAfter != null) {
      const rawAfter = evalAfter ?? cpAfter;
      const userCpRaw = userIsWhite ? rawAfter : -rawAfter;
      const mateNow =
        Math.abs(rawAfter) >= 9000 || userCpRaw >= MATE_CP_THRESHOLD;
      if (mateNow && !session.inMateEpisode) {
        session.inMateEpisode = true;
        session.mateEpisodeClean = true;
        session.mateEpisodes += 1;
      } else if (session.inMateEpisode && !mateNow) {
        session.mateEpisodeClean = false;
        session.inMateEpisode = false;
      }
      if (session.inMateEpisode && isUser) {
        const tIdx = session.userMoves - 1;
        if (tIdx >= 0 && tIdx < session.userTimes.length) {
          session.mateMoveTimes.push(session.userTimes[tIdx]);
        }
      }
    }
  }

  if (isCapture && captured) {
    session.lastCapture = {
      ply: plyIdx,
      color: isUser ? userColor : swapColor(userColor),
      piece: movingPiece,
      captured,
      to: toSq,
    };
  } else {
    session.lastCapture = null;
  }
  return true;
}

export function styleScanFinalize(
  session: StyleScanSession,
  extras?: EvalBucketExtras
): StyleGameRow | null {
  const board = session.board;
  const userIsWhite = session.userIsWhite;
  const result = session.result;
  const clock = session.clock;
  const userWps = session.userWps;

  if (session.pendingSacrificeAccepted) {
    session.sacrificeMoves += 1;
    session.pendingSacrificeSq = null;
    session.pendingSacrificeOk = false;
    session.pendingSacrificeAccepted = false;
    session.pendingSacrificeOfferVal = 0;
  } else if (session.pendingSacrificeOk) {
    session.pendingSacrificeSq = null;
    session.pendingSacrificeOk = false;
    session.pendingSacrificeOfferVal = 0;
  }

  if (session.inMateEpisode && session.mateEpisodeClean && board.isCheckmate()) {
    const winnerIsWhite = board.turn() === "b";
    const userWonMate =
      (userIsWhite && winnerIsWhite) || (!userIsWhite && !winnerIsWhite);
    if (userWonMate) session.mateConverted += 1;
  }
  let accidentalStalemate = false;
  if (session.endgameStartPly != null && board.isStalemate()) {
    if (
      session.wpBeforeLastMove != null &&
      session.wpBeforeLastMove >= WP_ENDGAME_ADVANTAGE
    ) {
      accidentalStalemate = true;
    }
  }
  if (extras) {
    extras.opening_accuracy_pct = session.accuracySamples.length
      ? Math.round(
          (session.accuracySamples.reduce((a, b) => a + b, 0) /
            session.accuracySamples.length) *
            10
        ) / 10
      : null;
    extras.opening_accuracy_moves = session.accuracySamples.length;
    const mgStart = session.phaseEnd * 2;
    const reachedMg =
      session.mgAccuracySamples.length > 0 ||
      session.mgBlunders > 0 ||
      session.mgMistakes > 0 ||
      session.mgInaccuracies > 0 ||
      session.mgMissedOppChances > 0 ||
      session.mgAllowedChances > 0 ||
      (session.endgameStartPly == null
        ? session.board.history().length > mgStart
        : session.endgameStartPly > mgStart);
    extras.middlegameEval = reachedMg
      ? {
          accuracy_pct: session.mgAccuracySamples.length
            ? Math.round(
                (session.mgAccuracySamples.reduce((a, b) => a + b, 0) /
                  session.mgAccuracySamples.length) *
                  10
              ) / 10
            : null,
          accuracy_moves: session.mgAccuracySamples.length,
          blunders: session.mgBlunders,
          mistakes: session.mgMistakes,
          inaccuracies: session.mgInaccuracies,
          tactics_made: session.mgTacticsMade,
          missed_opportunity_chances: session.mgMissedOppChances,
          missed_opportunities: session.mgMissedOpps,
          missed_tactic_chances: session.mgMissedTacticChances,
          missed_tactics: session.mgMissedTactics,
          allowed_tactic_chances: session.mgAllowedChances,
          allowed_tactics_found: session.mgAllowedFound,
        }
      : null;
    extras.endgameEval =
      session.endgameStartPly == null
        ? null
        : {
            blunders: session.egBlunders,
            mistakes: session.egMistakes,
            inaccuracies: session.egInaccuracies,
            tactics_made: session.egTacticsMade,
            missed_opportunity_chances: session.egMissedOppChances,
            missed_opportunities: session.egMissedOpps,
            piece_trades: session.egPieceTrades,
            beneficial_trades: session.egBeneficialTrades,
            winning_trades: session.egWinningTrades,
            simplification_trades: session.egSimplificationTrades,
            mate_episodes: session.mateEpisodes,
            mate_converted: session.mateConverted,
            accidental_stalemate: accidentalStalemate,
            mate_move_times: session.mateMoveTimes,
          };
  }

  let volatility = 0.0;
  if (session.evalsWhite.length >= 2) {
    const userEvals = session.evalsWhite.map((cp) =>
      userIsWhite ? cp : -cp
    );
    const diffs: number[] = [];
    for (let i = 1; i < userEvals.length; i += 1) {
      if (
        Math.abs(userEvals[i]) < 50000 &&
        Math.abs(userEvals[i - 1]) < 50000
      ) {
        diffs.push(Math.abs(userEvals[i] - userEvals[i - 1]));
      }
    }
    if (diffs.length) {
      volatility = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    }
  }

  let drawishless = false;
  const drawishPly = DRAWISH_MIN_FULLMOVE * 2 - 1;
  if (result !== "Draw" && userWps.length > drawishPly) {
    const wpAtMove = userWps[drawishPly];
    if (wpAtMove >= WP_DRAWISH_LO && wpAtMove <= WP_DRAWISH_HI) {
      drawishless = true;
    }
  }

  if (!session.hadDisadvantage) {
    for (const v of userWps) {
      if (v <= WP_DISADVANTAGE) {
        session.hadDisadvantage = true;
        break;
      }
    }
  }

  const recovered =
    session.hadDisadvantage && (result === "Win" || result === "Draw");
  let clockDiff: number | null = null;
  if (clock) {
    clockDiff = Math.round((clock.user_avg - clock.opp_avg) * 10) / 10;
  }

  const terrTotal = session.territoryOwn + session.territoryOpp;
  return {
    id: session.game.id,
    result,
    win: result === "Win",
    volatility_cp: Math.round(volatility * 10) / 10,
    sacrifice_moves: session.sacrificeMoves,
    had_sacrifice: session.sacrificeMoves > 0,
    early_flank_pushes: session.earlyFlankPushes,
    had_early_flank: session.earlyFlankPushes > 0,
    had_endgame_advantage: session.hadEndgameAdvantage,
    converted_endgame: session.hadEndgameAdvantage && result === "Win",
    endgame_advantage_start_ply: session.endgameAdvantageStartPly,
    territory_own: session.territoryOwn,
    territory_opp: session.territoryOpp,
    territory_opp_pct: terrTotal
      ? Math.round((session.territoryOpp / terrTotal) * 1000) / 10
      : 0.0,
    early_trades: session.earlyTrades,
    had_early_trade: session.earlyTrades > 0,
    trades_near_enemy_king: session.tradesNearEnemyKing,
    trades_near_user_king: session.tradesNearUserKing,
    forward_moves: session.forwardMoves,
    backward_moves: session.backwardMoves,
    lateral_moves: session.lateralMoves,
    higher_threats: session.higherThreats,
    threat_escapes: session.threatEscapes,
    user_moves: session.userMoves,
    avg_time_per_move_s: clock ? clock.user_avg : null,
    opp_avg_time_per_move_s: clock ? clock.opp_avg : null,
    clock_diff_s: clockDiff,
    drawishless,
    declined_recaptures: session.declinedRecaptures,
    recapture_chances: session.recaptureChances,
    critical_move_times: session.criticalTimes,
    avg_critical_time_s: session.criticalTimes.length
      ? Math.round(
          (session.criticalTimes.reduce((a, b) => a + b, 0) /
            session.criticalTimes.length) *
            10
        ) / 10
      : null,
    critical_positions: session.criticalPositions,
    had_disadvantage: session.hadDisadvantage,
    recovered_from_disadvantage: recovered,
    blunders: session.blunders,
    blunder_rate_pct: session.userMoves
      ? Math.round((session.blunders / session.userMoves) * 1000) / 10
      : 0.0,
    disadvantage_move_times: session.disadvantageTimes,
    avg_disadvantage_time_s: session.disadvantageTimes.length
      ? Math.round(
          (session.disadvantageTimes.reduce((a, b) => a + b, 0) /
            session.disadvantageTimes.length) *
            10
        ) / 10
      : null,
    disadvantage_positions: session.disadvantageTimes.length,
  };
}

export function analyzeStyleGame(
  game: StudyGame,
  evalsWhiteCp: number[],
  extras?: EvalBucketExtras
): StyleGameRow | null {
  const session = createStyleScanSession(game);
  if (!session) return null;
  let evalIdx = 0;
  const root = nextCp(evalsWhiteCp, evalIdx);
  evalIdx = root.nextIdx;
  if (root.cp != null) styleScanConsumeRoot(session, root.cp);
  const sans = parseSans(game);
  for (let plyIdx = 0; plyIdx < sans.length; plyIdx += 1) {
    const before =
      session.evalsWhite.length > 0
        ? session.evalsWhite[session.evalsWhite.length - 1]
        : null;
    const after = nextCp(evalsWhiteCp, evalIdx);
    evalIdx = after.nextIdx;
    if (!styleScanProcessPly(session, sans[plyIdx], before, after.cp, plyIdx)) {
      break;
    }
  }
  return styleScanFinalize(session, extras);
}

export function aggregateStyleMetrics(rows: StyleGameRow[]): StyleMetricsAggregate {
  const n = rows.length;
  if (n === 0) {
    return {
      games: 0,
      wins: 0,
      win_rate: 0.0,
      avg_time_per_move_s: null,
      games_with_clock: 0,
      initiative: {},
      attacking: {},
      creativity: {},
      durability: {},
      per_game: [],
    };
  }

  const wins = rows.filter((r) => r.win).length;
  const times = rows
    .map((r) => r.avg_time_per_move_s)
    .filter((t): t is number => t != null);
  const egAdv = rows.filter((r) => r.had_endgame_advantage);
  const egConv = egAdv.filter((r) => r.converted_endgame);

  const own = rows.reduce((s, r) => s + r.territory_own, 0);
  const opp = rows.reduce((s, r) => s + r.territory_opp, 0);
  const terr = own + opp;
  const fwd = rows.reduce((s, r) => s + r.forward_moves, 0);
  const back = rows.reduce((s, r) => s + r.backward_moves, 0);
  const lat = rows.reduce((s, r) => s + r.lateral_moves, 0);
  const dirTotal = fwd + back + lat;

  const recaptureChances = rows.reduce((s, r) => s + r.recapture_chances, 0);
  const declined = rows.reduce((s, r) => s + r.declined_recaptures, 0);
  const criticalAll = rows.flatMap((r) => r.critical_move_times || []);
  const drawishlessN = rows.filter((r) => r.drawishless).length;
  const disadvGames = rows.filter((r) => r.had_disadvantage);
  const recovered = disadvGames.filter((r) => r.recovered_from_disadvantage);
  const totalBlunders = rows.reduce((s, r) => s + (r.blunders || 0), 0);
  const totalUserMoves = rows.reduce((s, r) => s + (r.user_moves || 0), 0);
  const clockDiffs = rows
    .map((r) => r.clock_diff_s)
    .filter((t): t is number => t != null);
  const disadvTimes = rows.flatMap((r) => r.disadvantage_move_times || []);

  return {
    games: n,
    wins,
    win_rate: Math.round((wins / n) * 1000) / 10,
    avg_time_per_move_s: times.length ? mean(times) : null,
    games_with_clock: times.length,
    initiative: {
      avg_eval_volatility_cp: mean(rows.map((r) => r.volatility_cp)),
      sacrifice_rate_pct: totalUserMoves
        ? Math.round(
            (rows.reduce((s, r) => s + r.sacrifice_moves, 0) / totalUserMoves) *
              1000
          ) / 10
        : 0.0,
      avg_sacrifice_moves: mean(rows.map((r) => r.sacrifice_moves)),
      early_flank_rate_pct:
        Math.round((rows.filter((r) => r.had_early_flank).length / n) * 1000) / 10,
      avg_early_flank_pushes: mean(rows.map((r) => r.early_flank_pushes)),
      endgame_advantage_games: egAdv.length,
      endgame_conversion_rate_pct: egAdv.length
        ? Math.round((egConv.length / egAdv.length) * 1000) / 10
        : null,
      early_trade_rate_pct:
        Math.round((rows.filter((r) => r.had_early_trade).length / n) * 1000) / 10,
      avg_early_trades: mean(rows.map((r) => r.early_trades)),
    },
    attacking: {
      avg_higher_value_threats: mean(rows.map((r) => r.higher_threats)),
      avg_threat_escapes: mean(rows.map((r) => r.threat_escapes)),
      avg_trades_near_enemy_king: mean(rows.map((r) => r.trades_near_enemy_king)),
      avg_trades_near_user_king: mean(rows.map((r) => r.trades_near_user_king)),
      territory_opp_pct: terr ? Math.round((opp / terr) * 1000) / 10 : 0.0,
      territory_own_pct: terr ? Math.round((own / terr) * 1000) / 10 : 0.0,
      forward_move_pct: dirTotal ? Math.round((fwd / dirTotal) * 1000) / 10 : 0.0,
      backward_move_pct: dirTotal ? Math.round((back / dirTotal) * 1000) / 10 : 0.0,
      lateral_move_pct: dirTotal ? Math.round((lat / dirTotal) * 1000) / 10 : 0.0,
    },
    creativity: {
      drawishless_games: drawishlessN,
      drawishless_rate_pct: Math.round((drawishlessN / n) * 1000) / 10,
      declined_recapture_rate_pct: recaptureChances
        ? Math.round((declined / recaptureChances) * 1000) / 10
        : 0.0,
      declined_recaptures: declined,
      recapture_chances: recaptureChances,
      avg_declined_recaptures: mean(rows.map((r) => r.declined_recaptures)),
      avg_critical_time_s: criticalAll.length ? mean(criticalAll) : null,
      critical_positions: criticalAll.length,
      avg_critical_positions: mean(rows.map((r) => r.critical_positions)),
    },
    durability: {
      disadvantage_games: disadvGames.length,
      recovered_games: recovered.length,
      recovery_rate_pct: disadvGames.length
        ? Math.round((recovered.length / disadvGames.length) * 1000) / 10
        : null,
      total_blunders: totalBlunders,
      avg_blunders: mean(rows.map((r) => r.blunders || 0)),
      blunder_rate_pct: totalUserMoves
        ? Math.round((totalBlunders / totalUserMoves) * 1000) / 10
        : 0.0,
      avg_clock_diff_s: clockDiffs.length ? mean(clockDiffs) : null,
      avg_disadvantage_time_s: disadvTimes.length ? mean(disadvTimes) : null,
      disadvantage_positions: disadvTimes.length,
    },
    per_game: rows,
  };
}
