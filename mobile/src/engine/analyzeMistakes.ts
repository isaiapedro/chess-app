import { Chess, type Move, type Square } from "chess.js";
import type { MistakeItem } from "../api/client";

export type StudyGame = {
  id: string;
  created_at: string;
  speed?: string;
  user_color: string;
  result: string;
  opening_name?: string;
  opening_eco?: string;
  opponent_name?: string;
  pgn_str?: string;
  moves_str?: string;
  user_rating?: number;
};

export type AnalyzeProgress = {
  gamesScanned: number;
  positionsChecked: number;
  found: number;
  status: string;
};

type EvalFn = (
  fen: string,
  depth?: number,
  multiPv?: number
) => Promise<{
  cpWhite: number;
  bestUci: string | null;
  bestPv?: string[];
  multipv: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
}>;

const OPENING_PLY_SKIP = 12;
const SAMPLE_EVERY = 2;
const MIN_DROP_CP = 100;
const MIN_PRIORITY = 800;
const STRICT_DROP_CP = Math.round(MIN_DROP_CP * 1.3);
const STRICT_PRIORITY = Math.round(MIN_PRIORITY * 1.3);
const TARGET_MOMENTS = 5;
const ANALYSIS_DEPTH = 12;
const EVAL_CLAMP = 2000;
const GOOD_MOVE_MAX_LOSS_CP = 50;
const CONTINUATION_PLIES = 6;

function clampCp(value: number): number {
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, value));
}

function toWhiteCp(fen: string, sideToMoveCp: number): number {
  const turn = fen.split(" ")[1];
  return turn === "b" ? -sideToMoveCp : sideToMoveCp;
}

function mistakePriority(userBefore: number, userAfter: number, drop: number): number {
  let priority = drop;
  if (userBefore >= 50 && userAfter <= -50) {
    priority += 3000;
    priority += Math.min(userBefore, 500);
    priority += Math.min(-userAfter, 500);
  } else if (userBefore >= 0) {
    priority += 800;
  }
  priority += Math.max(0, 500 - Math.abs(userBefore)) * 1.2;
  priority -= Math.max(0, -userBefore - 300) * 1.5;
  return priority;
}

function parseMoves(game: StudyGame): string[] {
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

function applySan(chess: Chess, san: string): Move | null {
  try {
    return chess.move(san);
  } catch {
    return null;
  }
}

function uciFromMove(move: Move): string {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function opponentName(game: StudyGame): string {
  if (game.opponent_name && game.opponent_name !== "Unknown") {
    return game.opponent_name;
  }
  if (game.pgn_str) {
    const color = String(game.user_color || "white").toLowerCase() === "white" ? "Black" : "White";
    const match = game.pgn_str.match(new RegExp(`\\[${color} "([^"]+)"\\]`));
    if (match?.[1]) return match[1];
  }
  return "Unknown opponent";
}

function applyUciMove(chess: Chess, uci: string): Move | null {
  if (!uci || uci.length < 4) return null;
  try {
    return chess.move({
      from: uci.slice(0, 2) as Square,
      to: uci.slice(2, 4) as Square,
      promotion: uci.length > 4 ? (uci[4] as "q" | "r" | "b" | "n") : undefined,
    });
  } catch {
    return null;
  }
}

export function pvToSanLine(
  fen: string,
  pv: string[],
  maxPlies = CONTINUATION_PLIES
): string {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv.slice(0, maxPlies)) {
    const move = applyUciMove(chess, uci);
    if (!move) break;
    sans.push(move.san);
  }
  return sans.join(" ");
}

export async function analyzeCriticalMistakes(options: {
  games: StudyGame[];
  evaluate: EvalFn;
  onProgress?: (progress: AnalyzeProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<MistakeItem[]> {
  const { games, evaluate, onProgress, signal } = options;
  type Ranked = MistakeItem & { priority_score: number };
  const candidates: Ranked[] = [];
  let positionsChecked = 0;
  let gamesScanned = 0;

  const latestFirst = [...games].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );

  const strictCount = () =>
    candidates.filter(
      (item) =>
        item.eval_drop_cp >= STRICT_DROP_CP &&
        item.priority_score >= STRICT_PRIORITY
    ).length;

  for (const game of latestFirst) {
    if (signal?.cancelled) break;
    if (strictCount() >= TARGET_MOMENTS) break;

    const sans = parseMoves(game);
    if (sans.length < 6) continue;

    gamesScanned += 1;
    onProgress?.({
      gamesScanned,
      positionsChecked,
      found: Math.min(strictCount() || candidates.length, TARGET_MOMENTS),
      status: `Scanning game ${gamesScanned} (strict ≥${STRICT_DROP_CP}cp)…`,
    });

    const userIsWhite = String(game.user_color || "white").toLowerCase() === "white";
    const chess = new Chess();
    let bestForGame: Ranked | null = null;
    let bestPriority = -Infinity;
    let userMoveIndex = -1;

    for (let ply = 0; ply < sans.length; ply += 1) {
      if (signal?.cancelled) break;

      const turnIsWhite = chess.turn() === "w";
      const isUserTurn = turnIsWhite === userIsWhite;
      if (!isUserTurn) {
        if (!applySan(chess, sans[ply])) break;
        continue;
      }

      userMoveIndex += 1;
      if (ply < OPENING_PLY_SKIP) {
        if (!applySan(chess, sans[ply])) break;
        continue;
      }
      if (userMoveIndex % SAMPLE_EVERY !== 0 && ply < sans.length - 1) {
        if (!applySan(chess, sans[ply])) break;
        continue;
      }

      const fenBefore = chess.fen();
      const played = applySan(chess, sans[ply]);
      if (!played) break;
      const fenAfter = chess.fen();
      const playedUci = uciFromMove(played);
      const playedSan = played.san;

      positionsChecked += 1;
      onProgress?.({
        gamesScanned,
        positionsChecked,
        found: Math.min(strictCount() || candidates.length, TARGET_MOMENTS),
        status: `Evaluating position ${positionsChecked}…`,
      });

      let beforeRaw;
      let afterRaw;
      try {
        beforeRaw = await evaluate(fenBefore, ANALYSIS_DEPTH, 1);
        afterRaw = await evaluate(fenAfter, ANALYSIS_DEPTH, 1);
      } catch {
        continue;
      }

      const beforeCp = clampCp(toWhiteCp(fenBefore, beforeRaw.cpWhite));
      const afterCp = clampCp(toWhiteCp(fenAfter, afterRaw.cpWhite));
      const userBefore = clampCp(userIsWhite ? beforeCp : -beforeCp);
      const userAfter = clampCp(userIsWhite ? afterCp : -afterCp);
      const drop = userBefore - userAfter;
      if (drop < MIN_DROP_CP) continue;

      const bestUci = beforeRaw.bestUci;
      if (bestUci && bestUci === playedUci) continue;

      let bestSan: string | null = null;
      if (bestUci && bestUci.length >= 4) {
        const probe = new Chess(fenBefore);
        try {
          const bestMove = probe.move({
            from: bestUci.slice(0, 2) as Square,
            to: bestUci.slice(2, 4) as Square,
            promotion:
              bestUci.length > 4
                ? (bestUci[4] as "q" | "r" | "b" | "n")
                : undefined,
          });
          bestSan = bestMove?.san || null;
        } catch {
          bestSan = null;
        }
      }

      const priority = mistakePriority(userBefore, userAfter, drop);
      const item: Ranked = {
        game_id: String(game.id),
        created_at: String(game.created_at),
        opening_name: game.opening_name,
        opening_eco: game.opening_eco,
        opponent_name: opponentName(game),
        speed: game.speed,
        user_color: String(game.user_color || "white"),
        result: String(game.result || ""),
        ply,
        move_number: Math.floor(ply / 2) + 1,
        fen: fenBefore,
        played_uci: playedUci,
        played_san: playedSan,
        best_uci: bestUci,
        best_san: bestSan,
        eval_before_cp: Math.round(beforeCp * 10) / 10,
        eval_after_cp: Math.round(afterCp * 10) / 10,
        eval_delta_cp: Math.round((afterCp - beforeCp) * 10) / 10,
        eval_drop_cp: Math.round(drop * 10) / 10,
        comment: `Your position worsened by ~${Math.round(drop)} cp after ${playedSan}.`,
        priority_score: Math.round(priority * 10) / 10,
      };

      if (priority > bestPriority) {
        bestPriority = priority;
        bestForGame = item;
      }
    }

    if (bestForGame && bestPriority >= MIN_PRIORITY) {
      candidates.push(bestForGame);
      onProgress?.({
        gamesScanned,
        positionsChecked,
        found: Math.min(strictCount() || candidates.length, TARGET_MOMENTS),
        status: `Candidate ${candidates.length} · strict ${strictCount()}/${TARGET_MOMENTS}`,
      });
    }
  }

  const byPriority = (a: Ranked, b: Ranked) =>
    b.priority_score - a.priority_score || b.eval_drop_cp - a.eval_drop_cp;

  let selected = candidates
    .filter(
      (item) =>
        item.eval_drop_cp >= STRICT_DROP_CP &&
        item.priority_score >= STRICT_PRIORITY
    )
    .sort(byPriority);

  if (selected.length < TARGET_MOMENTS) {
    onProgress?.({
      gamesScanned,
      positionsChecked,
      found: selected.length,
      status: `Relaxing threshold to ${MIN_DROP_CP}cp…`,
    });
    const picked = new Set(selected.map((item) => `${item.game_id}:${item.ply}`));
    const fallback = candidates
      .filter(
        (item) =>
          item.eval_drop_cp >= MIN_DROP_CP &&
          item.priority_score >= MIN_PRIORITY &&
          !picked.has(`${item.game_id}:${item.ply}`)
      )
      .sort(byPriority);
    selected = [...selected, ...fallback].slice(0, TARGET_MOMENTS);
  } else {
    selected = selected.slice(0, TARGET_MOMENTS);
  }

  onProgress?.({
    gamesScanned,
    positionsChecked,
    found: selected.length,
    status: selected.length ? "Analysis complete" : "No critical swings found",
  });

  return selected;
}

export type QuizVerdict = "best" | "good" | "retry" | "illegal";

export type QuizValidation = {
  legal: boolean;
  verdict: QuizVerdict;
  user_san: string | null;
  centipawn_loss: number | null;
  user_eval_cp: number | null;
  best_eval_cp: number | null;
  best_continuation_san: string | null;
  best_pv: string[];
  best_uci: string | null;
  correct: boolean;
  accepted_as_top_line: boolean;
};

export async function validateMoveLocal(
  evaluate: EvalFn,
  fen: string,
  userUci: string,
  bestUci: string
): Promise<QuizValidation> {
  const board = new Chess(fen);
  let userSan: string | null = null;
  let legal = false;
  try {
    const move = board.move({
      from: userUci.slice(0, 2) as Square,
      to: userUci.slice(2, 4) as Square,
      promotion: userUci.length > 4 ? (userUci[4] as "q" | "r" | "b" | "n") : "q",
    });
    legal = Boolean(move);
    userSan = move?.san || null;
  } catch {
    legal = false;
  }

  if (!legal) {
    return {
      legal: false,
      verdict: "illegal",
      user_san: null,
      centipawn_loss: null,
      user_eval_cp: null,
      best_eval_cp: null,
      best_continuation_san: null,
      best_pv: [],
      best_uci: bestUci,
      correct: false,
      accepted_as_top_line: false,
    };
  }

  try {
    const multi = await evaluate(fen, ANALYSIS_DEPTH, 5);
    const resolvedBestUci = bestUci || multi.bestUci || multi.multipv[0]?.uci || null;
    const bestLine =
      multi.multipv.find((line) => line.uci === resolvedBestUci) ||
      multi.multipv[0] ||
      null;
    const bestPv =
      bestLine?.pv ||
      multi.bestPv ||
      (resolvedBestUci ? [resolvedBestUci] : []);
    const bestContinuation = pvToSanLine(fen, bestPv, CONTINUATION_PLIES);

    let bestStm =
      bestLine?.cpWhite ??
      (multi.bestUci === resolvedBestUci ? multi.cpWhite : null);
    let userStm: number | null = null;
    const userLine = multi.multipv.find((line) => line.uci === userUci);
    if (userLine) {
      userStm = userLine.cpWhite;
    }

    if (bestStm == null || userStm == null) {
      const afterUser = await evaluate(board.fen(), ANALYSIS_DEPTH, 1);
      const userWhite = toWhiteCp(board.fen(), afterUser.cpWhite);
      let bestWhite: number;
      if (bestStm != null) {
        bestWhite = toWhiteCp(fen, bestStm);
      } else if (resolvedBestUci) {
        const bestBoard = new Chess(fen);
        if (applyUciMove(bestBoard, resolvedBestUci)) {
          const afterBest = await evaluate(bestBoard.fen(), ANALYSIS_DEPTH, 1);
          bestWhite = toWhiteCp(bestBoard.fen(), afterBest.cpWhite);
        } else {
          bestWhite = toWhiteCp(fen, multi.cpWhite);
        }
      } else {
        bestWhite = toWhiteCp(fen, multi.cpWhite);
      }
      const turn = fen.split(" ")[1];
      const loss =
        turn === "b" ? userWhite - bestWhite : bestWhite - userWhite;
      const centipawnLoss = Math.round(Math.max(0, loss) * 10) / 10;
      const isBest = userUci === resolvedBestUci;
      const verdict: QuizVerdict = isBest
        ? "best"
        : centipawnLoss <= GOOD_MOVE_MAX_LOSS_CP
          ? "good"
          : "retry";
      return {
        legal: true,
        verdict,
        user_san: userSan,
        centipawn_loss: centipawnLoss,
        user_eval_cp: Math.round(userWhite * 10) / 10,
        best_eval_cp: Math.round(bestWhite * 10) / 10,
        best_continuation_san: bestContinuation || null,
        best_pv: bestPv,
        best_uci: resolvedBestUci,
        correct: verdict === "best" || verdict === "good",
        accepted_as_top_line: verdict === "good",
      };
    }

    const loss = bestStm - userStm;
    const centipawnLoss = Math.round(Math.max(0, loss) * 10) / 10;
    const isBest = userUci === resolvedBestUci;
    const verdict: QuizVerdict = isBest
      ? "best"
      : centipawnLoss <= GOOD_MOVE_MAX_LOSS_CP
        ? "good"
        : "retry";

    return {
      legal: true,
      verdict,
      user_san: userSan,
      centipawn_loss: centipawnLoss,
      user_eval_cp: Math.round(toWhiteCp(fen, userStm) * 10) / 10,
      best_eval_cp: Math.round(toWhiteCp(fen, bestStm) * 10) / 10,
      best_continuation_san: bestContinuation || null,
      best_pv: bestPv,
      best_uci: resolvedBestUci,
      correct: verdict === "best" || verdict === "good",
      accepted_as_top_line: verdict === "good",
    };
  } catch {
    return {
      legal: true,
      verdict: "retry",
      user_san: userSan,
      centipawn_loss: null,
      user_eval_cp: null,
      best_eval_cp: null,
      best_continuation_san: null,
      best_pv: [],
      best_uci: bestUci,
      correct: false,
      accepted_as_top_line: false,
    };
  }
}
