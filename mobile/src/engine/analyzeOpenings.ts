import { Chess, type Move, type Square } from "chess.js";
import type { ExplorerMove, MistakeItem } from "../api/client";
import type { StudyGame } from "./analyzeMistakes";
import { pvToSanLine } from "./analyzeMistakes";

export type OpeningChoice = {
  key: string;
  eco: string;
  name: string;
  games: number;
};

export type OpeningMoment = MistakeItem & {
  winrate_played: number | null;
  winrate_best: number | null;
  winrate_gap: number | null;
  popularity_pct: number | null;
  popularity_drop_pct: number | null;
  source: "lichess" | "masters" | "eval";
  alt_moves: Array<{ uci: string; san: string; score: number }>;
  best_pv: string[];
  priority_score: number;
};

export type OpeningProgress = {
  gamesScanned: number;
  positionsChecked: number;
  found: number;
  status: string;
};

type ExplorerFn = (
  fen: string,
  source: "lichess" | "masters",
  ratings?: string
) => Promise<{
  moves: ExplorerMove[];
  white: number;
  draws: number;
  black: number;
  fallback?: boolean;
}>;

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

const MAX_OPENING_MOVES = 10;
const TARGET_MOMENTS = 3;
const MIN_WINRATE_GAP = 0.1;
const STRICT_WINRATE_GAP = Math.round(MIN_WINRATE_GAP * 1.3 * 1000) / 1000;
const LOW_WINRATE = 0.35;
const ZERO_WINRATE = 0.05;
const DECENT_WINRATE = 0.45;
const DECENT_FREQ = 0.08;
const MIN_GAMES_AT_POS = 8;
const MIN_MOVE_GAMES = 3;
const MIN_MASTERS_GAMES = 3;
const GOOD_SCORE_GAP = 0.05;
const EVAL_GAP_CP = 100;
const ANALYSIS_DEPTH = 12;

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

function applyUci(chess: Chess, uci: string): Move | null {
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

function uciFromMove(move: Move): string {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

export function ratingsForElo(elo: number, spread = 300): string {
  const buckets = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];
  const lo = elo - spread;
  const hi = elo + spread;
  const selected = buckets.filter((b) => b >= lo - 100 && b <= hi + 100);
  return (selected.length ? selected : [1600, 1800, 2000]).join(",");
}

export function averageUserRating(games: StudyGame[]): number {
  const ratings = games
    .map((g) => Number(g.user_rating))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ratings.length) return 1600;
  return Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length);
}

export function topOpeningsForColor(
  games: StudyGame[],
  color: "white" | "black",
  limit = 3
): OpeningChoice[] {
  const counts = new Map<string, OpeningChoice>();
  for (const game of games) {
    if (String(game.user_color || "").toLowerCase() !== color) continue;
    const eco = String(game.opening_eco || "UNK").toUpperCase();
    const name = String(game.opening_name || "Unknown opening");
    const key = eco !== "UNK" ? eco : name.toLowerCase();
    const prev = counts.get(key);
    if (prev) {
      prev.games += 1;
      continue;
    }
    counts.set(key, { key, eco, name, games: 1 });
  }
  return [...counts.values()].sort((a, b) => b.games - a.games).slice(0, limit);
}

export function filterGamesByOpening(
  games: StudyGame[],
  color: "white" | "black",
  opening: OpeningChoice | { eco?: string; name: string }
): StudyGame[] {
  const eco = String(opening.eco || "").toUpperCase();
  const name = String(opening.name || "").toLowerCase().trim();
  return games.filter((game) => {
    if (String(game.user_color || "").toLowerCase() !== color) return false;
    const gEco = String(game.opening_eco || "").toUpperCase();
    const gName = String(game.opening_name || "").toLowerCase();
    if (eco && eco !== "UNK" && gEco === eco) return true;
    if (name && (gName === name || gName.includes(name) || name.includes(gName))) {
      return true;
    }
    return false;
  });
}

function moveTotal(m: ExplorerMove): number {
  return (m.white || 0) + (m.draws || 0) + (m.black || 0);
}

function expectedScore(m: ExplorerMove, side: "white" | "black"): number {
  const total = moveTotal(m);
  if (!total) return 0;
  const wins = side === "white" ? m.white || 0 : m.black || 0;
  return (wins + 0.5 * (m.draws || 0)) / total;
}

function positionTotal(payload: {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
}): number {
  const root = (payload.white || 0) + (payload.draws || 0) + (payload.black || 0);
  if (root > 0) return root;
  return payload.moves.reduce((sum, m) => sum + moveTotal(m), 0);
}

function scoreRows(
  moves: ExplorerMove[],
  side: "white" | "black",
  minGames: number
): Array<{ move: ExplorerMove; score: number; games: number; freq: number }> {
  const total = moves.reduce((sum, m) => sum + moveTotal(m), 0) || 1;
  return moves
    .map((move) => ({
      move,
      score: expectedScore(move, side),
      games: moveTotal(move),
      freq: moveTotal(move) / total,
    }))
    .filter((row) => row.games >= minGames)
    .sort((a, b) => b.games - a.games || b.score - a.score);
}

function pickBestMove(
  lichessMoves: ExplorerMove[],
  mastersMoves: ExplorerMove[],
  side: "white" | "black",
  evalBestUci: string | null
): {
  best: ExplorerMove | null;
  source: "lichess" | "masters" | "eval";
  scored: Array<{ move: ExplorerMove; score: number; games: number; freq: number }>;
  bestUci: string | null;
} {
  const mastersScored = scoreRows(mastersMoves, side, MIN_MASTERS_GAMES);
  if (mastersScored.length) {
    const top = [...mastersScored]
      .slice(0, 3)
      .sort((a, b) => b.score - a.score || b.games - a.games)[0];
    return {
      best: top.move,
      source: "masters",
      scored: mastersScored,
      bestUci: top.move.uci || null,
    };
  }

  const lichessScored = scoreRows(lichessMoves, side, MIN_MOVE_GAMES);
  if (lichessScored.length) {
    const top3 = lichessScored.slice(0, 3);
    const byWin = [...top3].sort((a, b) => b.score - a.score || b.games - a.games)[0];
    return {
      best: byWin.move,
      source: "lichess",
      scored: lichessScored,
      bestUci: byWin.move.uci || null,
    };
  }

  return {
    best: null,
    source: "eval",
    scored: [],
    bestUci: evalBestUci,
  };
}

function isPlayableMove(row: {
  score: number;
  freq: number;
  games: number;
} | null): boolean {
  if (!row) return false;
  if (row.score >= DECENT_WINRATE && row.freq >= DECENT_FREQ) return true;
  if (row.score >= DECENT_WINRATE && row.games >= 10) return true;
  return false;
}

async function buildContinuationPv(
  startFen: string,
  firstUci: string,
  fetchExplorer: ExplorerFn,
  ratings: string,
  plies = 5
): Promise<string[]> {
  const pv = [firstUci];
  const board = new Chess(startFen);
  if (!applyUci(board, firstUci)) return pv;
  let fen = board.fen();

  for (let i = 1; i < plies; i += 1) {
    const side = board.turn() === "w" ? "white" : "black";
    let mastersMoves: ExplorerMove[] = [];
    let lichessMoves: ExplorerMove[] = [];
    try {
      const masters = await fetchExplorer(fen, "masters");
      mastersMoves = masters.moves || [];
      const lichess = await fetchExplorer(fen, "lichess", ratings);
      lichessMoves = lichess.moves || [];
    } catch {
      break;
    }
    const picked = pickBestMove(lichessMoves, mastersMoves, side, null);
    if (!picked.bestUci) break;
    if (!applyUci(board, picked.bestUci)) break;
    pv.push(picked.bestUci);
    fen = board.fen();
  }
  return pv;
}

export async function analyzeOpeningMoments(options: {
  games: StudyGame[];
  color: "white" | "black";
  userRating: number;
  fetchExplorer: ExplorerFn;
  evaluate: EvalFn;
  onProgress?: (progress: OpeningProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<OpeningMoment[]> {
  const { games, color, userRating, fetchExplorer, evaluate, onProgress, signal } =
    options;
  const ratings = ratingsForElo(userRating);
  const candidates: OpeningMoment[] = [];
  let gamesScanned = 0;
  let positionsChecked = 0;

  const latestFirst = [...games].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );

  for (const game of latestFirst) {
    if (signal?.cancelled) break;
    const sans = parseMoves(game);
    if (sans.length < 4) continue;

    gamesScanned += 1;
    onProgress?.({
      gamesScanned,
      positionsChecked,
      found: candidates.length,
      status: `Opening scan game ${gamesScanned}…`,
    });

    const userIsWhite = color === "white";
    const chess = new Chess();
    let bestForGame: OpeningMoment | null = null;
    let bestPriority = -Infinity;
    let prevPopularity: number | null = null;

    const maxPly = Math.min(sans.length, MAX_OPENING_MOVES * 2);
    for (let ply = 0; ply < maxPly; ply += 1) {
      if (signal?.cancelled) break;
      const turnIsWhite = chess.turn() === "w";
      const isUserTurn = turnIsWhite === userIsWhite;
      if (!isUserTurn) {
        if (!applySan(chess, sans[ply])) break;
        continue;
      }

      const fenBefore = chess.fen();
      const played = applySan(chess, sans[ply]);
      if (!played) break;
      const playedUci = uciFromMove(played);
      const playedSan = played.san;
      const moveNumber = Math.floor(ply / 2) + 1;

      positionsChecked += 1;
      onProgress?.({
        gamesScanned,
        positionsChecked,
        found: candidates.length,
        status: `DB lookup move ${moveNumber}…`,
      });

      let lichess;
      let masters;
      try {
        [lichess, masters] = await Promise.all([
          fetchExplorer(fenBefore, "lichess", ratings),
          fetchExplorer(fenBefore, "masters"),
        ]);
      } catch {
        continue;
      }

      const posGames = Math.max(
        positionTotal(lichess),
        positionTotal(masters)
      );

      let evalBestUci: string | null = null;
      let evalBefore = 0;
      let evalAfter = 0;
      let evalDrop = 0;
      try {
        const beforeRaw = await evaluate(fenBefore, ANALYSIS_DEPTH, 1);
        const afterRaw = await evaluate(chess.fen(), ANALYSIS_DEPTH, 1);
        const turn = fenBefore.split(" ")[1];
        const beforeCp = turn === "b" ? -beforeRaw.cpWhite : beforeRaw.cpWhite;
        const afterCp = turn === "b" ? -afterRaw.cpWhite : afterRaw.cpWhite;
        const userBefore = userIsWhite ? beforeCp : -beforeCp;
        const userAfter = userIsWhite ? afterCp : -afterCp;
        evalDrop = userBefore - userAfter;
        evalBefore = beforeCp;
        evalAfter = afterCp;
        evalBestUci = beforeRaw.bestUci;
      } catch {
        /* keep zeros */
      }

      const picked = pickBestMove(
        lichess.moves || [],
        masters.moves || [],
        color,
        evalBestUci
      );
      const scored = picked.scored;

      let winratePlayed: number | null = null;
      let winrateBest: number | null = null;
      let winrateGap: number | null = null;
      let popularityPct: number | null = null;
      let popularityDrop: number | null = null;
      let bestUci = picked.bestUci;
      let bestSan: string | null = picked.best?.san || null;
      let usedSource: "lichess" | "masters" | "eval" = picked.source;
      let priority = 0;

      const playedRow =
        scored.find((row) => row.move.uci === playedUci) || null;
      const playedMove =
        (masters.moves || []).find((m) => m.uci === playedUci) ||
        (lichess.moves || []).find((m) => m.uci === playedUci);

      if (playedMove) {
        winratePlayed = expectedScore(playedMove, color);
        popularityPct = posGames ? moveTotal(playedMove) / posGames : playedRow?.freq ?? 0;
      } else if (posGames > 0) {
        winratePlayed = 0;
        popularityPct = 0;
      }

      if (picked.best) {
        winrateBest = expectedScore(picked.best, color);
      }
      if (winrateBest != null && winratePlayed != null) {
        winrateGap = winrateBest - winratePlayed;
      }
      if (prevPopularity != null && popularityPct != null) {
        popularityDrop = prevPopularity - popularityPct;
      }
      if (popularityPct != null) prevPopularity = popularityPct;

      if (isPlayableMove(playedRow)) continue;
      if (bestUci && bestUci === playedUci) continue;

      const lowOrZero =
        winratePlayed != null &&
        (winratePlayed <= ZERO_WINRATE || winratePlayed < LOW_WINRATE);
      const bigWinGap = (winrateGap || 0) >= MIN_WINRATE_GAP;
      const bigEvalGap = evalDrop >= EVAL_GAP_CP;

      if (lowOrZero) {
        if (!bigEvalGap && !bigWinGap) continue;
        if (bigEvalGap && evalBestUci && evalBestUci !== playedUci) {
          if (!bestUci || usedSource === "eval" || (winrateGap || 0) < 0.05) {
            bestUci = evalBestUci;
            usedSource = picked.best ? picked.source : "eval";
            const probe = new Chess(fenBefore);
            const bm = applyUci(probe, evalBestUci);
            bestSan = bm?.san || evalBestUci;
          }
        }
      } else if (posGames >= MIN_GAMES_AT_POS && bigWinGap) {
        /* keep */
      } else if (bigEvalGap && evalBestUci && evalBestUci !== playedUci) {
        bestUci = evalBestUci;
        usedSource = "eval";
        const probe = new Chess(fenBefore);
        const bm = applyUci(probe, evalBestUci);
        bestSan = bm?.san || evalBestUci;
        winrateGap = evalDrop / 1000;
      } else {
        continue;
      }

      if (!bestUci || bestUci === playedUci) continue;
      if (!bestSan) {
        const probe = new Chess(fenBefore);
        const bm = applyUci(probe, bestUci);
        bestSan = bm?.san || bestUci;
      }

      const lateBias = moveNumber / MAX_OPENING_MOVES;
      priority =
        (winrateGap || 0) * 1000 +
        Math.max(0, popularityDrop || 0) * 400 +
        Math.max(0, evalDrop) * 0.5 +
        lateBias * 40;
      if (usedSource === "masters") priority += 120;
      if (winratePlayed != null && winratePlayed <= ZERO_WINRATE) priority += 200;

      const altMoves = scored.slice(0, 5).map((row) => ({
        uci: String(row.move.uci || ""),
        san: String(row.move.san || row.move.uci || ""),
        score: row.score,
      }));

      const item: OpeningMoment = {
        game_id: String(game.id),
        created_at: String(game.created_at),
        opening_name: game.opening_name,
        opening_eco: game.opening_eco,
        opponent_name: game.opponent_name,
        speed: game.speed,
        user_color: color,
        result: String(game.result || ""),
        ply,
        move_number: moveNumber,
        fen: fenBefore,
        played_uci: playedUci,
        played_san: playedSan,
        best_uci: bestUci,
        best_san: bestSan,
        eval_before_cp: Math.round(evalBefore * 10) / 10,
        eval_after_cp: Math.round(evalAfter * 10) / 10,
        eval_drop_cp: Math.round(evalDrop * 10) / 10,
        comment:
          usedSource !== "eval" && winratePlayed != null && winrateBest != null
            ? `Your position worsened in the opening — ${playedSan} scores ${(
                winratePlayed * 100
              ).toFixed(0)}% vs ${(winrateBest * 100).toFixed(0)}% for ${bestSan}.`
            : `Your position worsened by ~${Math.round(evalDrop)} cp after ${playedSan}.`,
        winrate_played: winratePlayed,
        winrate_best: winrateBest,
        winrate_gap: winrateGap,
        popularity_pct: popularityPct,
        popularity_drop_pct: popularityDrop,
        source: usedSource,
        alt_moves: altMoves,
        best_pv: bestUci ? [bestUci] : [],
        priority_score: Math.round(priority * 10) / 10,
      };

      if (priority > bestPriority) {
        bestPriority = priority;
        bestForGame = item;
      }
    }

    if (bestForGame) candidates.push(bestForGame);
  }

  const byPriority = (a: OpeningMoment, b: OpeningMoment) =>
    b.priority_score - a.priority_score;

  let selected = candidates
    .filter((item) => (item.winrate_gap || 0) >= STRICT_WINRATE_GAP)
    .sort(byPriority);

  if (selected.length < TARGET_MOMENTS) {
    onProgress?.({
      gamesScanned,
      positionsChecked,
      found: selected.length,
      status: "Relaxing opening threshold…",
    });
    const picked = new Set(selected.map((item) => `${item.game_id}:${item.ply}`));
    const fallback = candidates
      .filter(
        (item) =>
          (item.winrate_gap || 0) >= MIN_WINRATE_GAP &&
          !picked.has(`${item.game_id}:${item.ply}`)
      )
      .sort(byPriority);
    selected = [...selected, ...fallback].slice(0, TARGET_MOMENTS);
  } else {
    selected = selected.slice(0, TARGET_MOMENTS);
  }

  for (let i = 0; i < selected.length; i += 1) {
    const moment = selected[i];
    if (!moment.best_uci) continue;
    onProgress?.({
      gamesScanned,
      positionsChecked,
      found: selected.length,
      status: `Building continuation ${i + 1}/${selected.length}…`,
    });
    try {
      const pv = await buildContinuationPv(
        moment.fen,
        moment.best_uci,
        fetchExplorer,
        ratings,
        5
      );
      moment.best_pv = pv;
    } catch {
      moment.best_pv = moment.best_uci ? [moment.best_uci] : [];
    }
  }

  onProgress?.({
    gamesScanned,
    positionsChecked,
    found: selected.length,
    status: selected.length ? "Opening analysis complete" : "No opening moments found",
  });

  return selected;
}

export function validateOpeningMove(
  fen: string,
  userUci: string,
  moment: OpeningMoment
): {
  verdict: "best" | "good" | "retry" | "illegal";
  user_san: string | null;
  best_continuation_san: string | null;
  best_pv: string[];
  user_score: number | null;
  best_score: number | null;
} {
  const board = new Chess(fen);
  let userSan: string | null = null;
  try {
    const move = applyUci(board, userUci);
    if (!move) {
      return {
        verdict: "illegal",
        user_san: null,
        best_continuation_san: null,
        best_pv: [],
        user_score: null,
        best_score: null,
      };
    }
    userSan = move.san;
  } catch {
    return {
      verdict: "illegal",
      user_san: null,
      best_continuation_san: null,
      best_pv: [],
      user_score: null,
      best_score: null,
    };
  }

  const bestUci = moment.best_uci;
  const continuation = pvToSanLine(fen, moment.best_pv || [], 6);
  if (bestUci && userUci === bestUci) {
    return {
      verdict: "best",
      user_san: userSan,
      best_continuation_san: continuation || moment.best_san,
      best_pv: moment.best_pv || [],
      user_score: moment.winrate_best,
      best_score: moment.winrate_best,
    };
  }

  const userAlt = moment.alt_moves.find((m) => m.uci === userUci);
  const bestScore =
    moment.winrate_best ??
    moment.alt_moves.find((m) => m.uci === bestUci)?.score ??
    null;
  const userScore = userAlt?.score ?? null;
  const ranked = [...moment.alt_moves].sort((a, b) => b.score - a.score);
  const inTop3 = ranked.slice(0, 3).some((m) => m.uci === userUci);

  if (bestScore != null && userScore != null) {
    const gap = bestScore - userScore;
    const playable =
      gap <= GOOD_SCORE_GAP ||
      (inTop3 && userScore >= DECENT_WINRATE) ||
      (userScore >= DECENT_WINRATE && gap <= 0.08);
    if (playable) {
      return {
        verdict: "good",
        user_san: userSan,
        best_continuation_san: continuation || moment.best_san,
        best_pv: moment.best_pv || [],
        user_score: userScore,
        best_score: bestScore,
      };
    }
  }

  return {
    verdict: "retry",
    user_san: userSan,
    best_continuation_san: null,
    best_pv: moment.best_pv || [],
    user_score: userScore,
    best_score: bestScore,
  };
}
