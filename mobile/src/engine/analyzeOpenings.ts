import { Chess, type Move } from "chess.js";
import type { ExplorerMove, MistakeItem } from "../api/client";
import { clampCp, toWhiteCp, type StudyGame } from "./analyzeMistakes";
import {
  applyUciMove,
  canonicalUci,
  fenKey,
  pvToSanLine,
  sameMove,
  sanToUci,
} from "./chessMoves";
import { resolveContinuationPv } from "./resolveContinuation";
import {
  ENGINE_LABEL,
  MAX_OPENING_GAMES,
  MIN_CONTINUATION_PLIES,
  REFINE_DEPTH,
  REFINE_MOVETIME,
  SCAN_DEPTH,
  SCAN_MOVETIME,
  TARGET_OPENING_MOMENTS,
} from "./analysisConfig";

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
  games_played: number | null;
  games_best: number | null;
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
  candidates: number;
  selected: number;
  status: string;
  phase: "scan" | "refine" | "continuation";
  engine: string;
  currentGame?: string;
  log?: string;
};

type ExplorerFn = (
  fen: string,
  source: "lichess" | "masters",
  ratings?: string
) => Promise<{
  moves: ExplorerMove[];
  topGames?: import("../api/client").ExplorerTopGame[];
  white: number;
  draws: number;
  black: number;
  fallback?: boolean;
}>;

type EvalFn = (
  fen: string,
  depth?: number,
  multiPv?: number,
  movetimeMs?: number
) => Promise<{
  cpWhite: number;
  bestUci: string | null;
  bestPv?: string[];
  multipv: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
}>;

type MastersPgnFn = (gameId: string) => Promise<{ pgn: string }>;

const MAX_OPENING_MOVES = 10;
const TARGET_MOMENTS = TARGET_OPENING_MOMENTS;
const BASE_MIN_WINRATE_GAP = 0.1;
const BASE_STRICT_WINRATE_GAP =
  Math.round(BASE_MIN_WINRATE_GAP * 1.3 * 1000) / 1000;
const HIGH_WINRATE_GAP = Math.round(BASE_MIN_WINRATE_GAP * 3 * 1000) / 1000;
const LOW_WINRATE = 0.35;
const ZERO_WINRATE = 0.05;
const DECENT_WINRATE = 0.45;
const DECENT_FREQ = 0.08;
const MIN_GAMES_AT_POS = 8;
const MIN_MOVE_GAMES = 3;
const MIN_MASTERS_GAMES = 3;
const GOOD_SCORE_GAP = 0.05;
const SCORE_TOLERANCE_FRACTION = 0.2;
const EVAL_GAP_CP = 100;
const MIN_GAMES_FOR_WINRATE_UI = 10;

const MIN_WINRATE_GAP = BASE_MIN_WINRATE_GAP;

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
  return applyUciMove(chess, uci);
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

export function searchOpeningsForColor(
  games: StudyGame[],
  color: "white" | "black",
  query: string,
  limit = 8
): OpeningChoice[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return topOpeningsForColor(games, color, 500)
    .filter(
      (opening) =>
        opening.name.toLowerCase().includes(q) ||
        opening.eco.toLowerCase().includes(q)
    )
    .slice(0, limit);
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

function normalizeExplorerMoves(
  fen: string,
  moves: ExplorerMove[]
): ExplorerMove[] {
  return moves.map((move) => {
    const uci = sanToUci(fen, move.san) || canonicalUci(fen, move.uci);
    return uci && uci !== move.uci ? { ...move, uci } : move;
  });
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

export type OpeningAnalyzeBatchResult = {
  moments: OpeningMoment[];
  pendingCandidates: OpeningMoment[];
  scannedGameIds: string[];
  improved: boolean;
  remaining: number;
};

function openingMomentKey(item: { game_id: string; ply: number }): string {
  return `${item.game_id}:${item.ply}`;
}

function openingPositionKey(item: { fen: string }): string {
  return fenKey(item.fen);
}

function passesOpeningCriteria(item: OpeningMoment): boolean {
  if ((item.winrate_gap || 0) >= BASE_MIN_WINRATE_GAP) return true;
  if ((item.eval_drop_cp || 0) >= EVAL_GAP_CP) return true;
  return false;
}

export async function analyzeOpeningMoments(options: {
  games: StudyGame[];
  color: "white" | "black";
  userRating: number;
  fetchExplorer: ExplorerFn;
  fetchMastersPgn: MastersPgnFn;
  evaluate: EvalFn;
  onProgress?: (progress: OpeningProgress) => void;
  signal?: { cancelled: boolean };
  excludeGameIds?: string[];
  existingMoments?: OpeningMoment[];
  existingCandidates?: OpeningMoment[];
  batchSize?: number;
  stopOnStrict?: boolean;
  appendCount?: number;
}): Promise<OpeningAnalyzeBatchResult> {
  const {
    games,
    color,
    userRating,
    fetchExplorer,
    fetchMastersPgn,
    evaluate,
    onProgress,
    signal,
    excludeGameIds = [],
    existingMoments = [],
    existingCandidates = [],
    batchSize = MAX_OPENING_GAMES,
    stopOnStrict = true,
    appendCount,
  } = options;
  const ratings = ratingsForElo(userRating);
  const candidates: OpeningMoment[] = [];
  let gamesScanned = 0;
  let positionsChecked = 0;

  const excluded = new Set(excludeGameIds.map(String));
  const latestFirst = [...games]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .filter((game) => game.id && !excluded.has(String(game.id)));
  const scannedGameIds: string[] = [];
  let selectedCount = 0;

  const report = (
    status: string,
    phase: OpeningProgress["phase"],
    extra?: Partial<OpeningProgress>
  ) => {
    onProgress?.({
      gamesScanned,
      positionsChecked,
      found: Math.min(strictCount(), TARGET_MOMENTS),
      candidates: candidates.length,
      selected: selectedCount,
      status,
      phase,
      engine: ENGINE_LABEL,
      ...extra,
    });
  };

  const existingKeys = new Set(existingMoments.map(openingMomentKey));
  const existingByKey = new Map(
    existingMoments.map((item) => [openingMomentKey(item), item])
  );
  const chosenPositionKeys = new Set(
    existingMoments.map((item) => openingPositionKey(item))
  );

  const strictCount = () =>
    candidates.filter(
      (item) => (item.winrate_gap || 0) >= HIGH_WINRATE_GAP
    ).length;

  const wantNew =
    appendCount != null && appendCount > 0
      ? appendCount
      : Math.max(0, TARGET_MOMENTS - existingMoments.length);

  const byPriority = (a: OpeningMoment, b: OpeningMoment) =>
    b.priority_score - a.priority_score;

  const pendingMap = new Map<string, OpeningMoment>();
  for (const item of existingCandidates) {
    const key = openingMomentKey(item);
    const posKey = openingPositionKey(item);
    if (existingKeys.has(key) || chosenPositionKeys.has(posKey)) continue;
    pendingMap.set(key, item);
  }

  let selected: OpeningMoment[] = existingMoments.map(
    (item) => existingByKey.get(openingMomentKey(item)) || item
  );

  const pickFromPool = (need: number): OpeningMoment[] => {
    if (need <= 0) return [];
    const high = [...pendingMap.values()]
      .filter((item) => (item.winrate_gap || 0) >= HIGH_WINRATE_GAP)
      .sort(byPriority);
    const mid = [...pendingMap.values()]
      .filter((item) => (item.winrate_gap || 0) >= BASE_STRICT_WINRATE_GAP)
      .sort(byPriority);
    const low = [...pendingMap.values()]
      .filter((item) => passesOpeningCriteria(item))
      .sort(byPriority);
    const ordered: OpeningMoment[] = [];
    const seen = new Set<string>();
    const seenPositions = new Set<string>();
    for (const list of [high, mid, low]) {
      for (const item of list) {
        const key = openingMomentKey(item);
        const posKey = openingPositionKey(item);
        if (seen.has(key) || seenPositions.has(posKey)) continue;
        if (chosenPositionKeys.has(posKey)) continue;
        seen.add(key);
        seenPositions.add(posKey);
        ordered.push(item);
        if (ordered.length >= need) return ordered;
      }
    }
    return ordered;
  };

  const refineOne = async (
    moment: OpeningMoment
  ): Promise<OpeningMoment | null> => {
    report(`Refining opening`, "refine", {
      selected: selectedCount,
      candidates: candidates.length,
      log: `${ENGINE_LABEL} · refine · ${moment.played_san}`,
    });
    try {
      const fenAfterBoard = new Chess(moment.fen);
      if (!applyUci(fenAfterBoard, moment.played_uci)) {
        return null;
      }
      const fenAfter = fenAfterBoard.fen();
      const userIsWhite = moment.user_color === "white";
      const beforeRaw = await evaluate(
        moment.fen,
        REFINE_DEPTH,
        1,
        REFINE_MOVETIME
      );
      const afterRaw = await evaluate(
        fenAfter,
        REFINE_DEPTH,
        1,
        REFINE_MOVETIME
      );
      const beforeCp = clampCp(toWhiteCp(moment.fen, beforeRaw.cpWhite));
      const afterCp = clampCp(toWhiteCp(fenAfter, afterRaw.cpWhite));
      const userBefore = clampCp(userIsWhite ? beforeCp : -beforeCp);
      const userAfter = clampCp(userIsWhite ? afterCp : -afterCp);
      const drop = userBefore - userAfter;
      const evalBestUci = beforeRaw.bestUci
        ? canonicalUci(moment.fen, beforeRaw.bestUci)
        : "";
      moment.eval_before_cp = Math.round(beforeCp * 10) / 10;
      moment.eval_after_cp = Math.round(afterCp * 10) / 10;
      moment.eval_drop_cp = Math.round(drop * 10) / 10;
      if (
        moment.source === "eval" &&
        evalBestUci &&
        evalBestUci !== moment.played_uci
      ) {
        moment.best_uci = evalBestUci;
        const probe = new Chess(moment.fen);
        const bm = applyUci(probe, evalBestUci);
        moment.best_san = bm?.san || evalBestUci;
      }
      if (moment.best_uci && !canonicalUci(moment.fen, moment.best_uci)) {
        return null;
      }
      if (!passesOpeningCriteria(moment)) return null;
    } catch {
      if (!moment.best_uci || !canonicalUci(moment.fen, moment.best_uci)) {
        return null;
      }
      if (!passesOpeningCriteria(moment)) return null;
    }

    if (!moment.best_uci) return null;
    report(`Building continuation`, "continuation", {
      selected: selectedCount,
      candidates: candidates.length,
      log: `${ENGINE_LABEL} · continuation · ${moment.best_san || moment.best_uci}`,
    });
    try {
      const cont = await resolveContinuationPv({
        fen: moment.fen,
        bestUci: moment.best_uci,
        fetchExplorer,
        fetchMastersPgn,
        evaluate,
        plies: MIN_CONTINUATION_PLIES,
      });
      moment.best_pv = cont.pv;
      moment.continuation_source = cont.source;
      moment.gm_game = cont.gm || null;
    } catch {
      moment.best_pv = moment.best_uci ? [moment.best_uci] : [];
      moment.continuation_source = "engine";
      moment.gm_game = null;
    }
    return moment;
  };

  const targetSelected =
    appendCount != null && appendCount > 0
      ? selected.length + appendCount
      : TARGET_MOMENTS;

  while (!signal?.cancelled && selected.length < targetSelected) {
    const slotsNeeded = targetSelected - selected.length;
    const batch = latestFirst
      .filter((game) => !scannedGameIds.includes(String(game.id)))
      .slice(0, batchSize);
    if (!batch.length && pendingMap.size === 0) break;

    const chunkCandidates: OpeningMoment[] = [];
    const chunkStrictCount = () =>
      chunkCandidates.filter(
        (item) => (item.winrate_gap || 0) >= HIGH_WINRATE_GAP
      ).length;

    for (const game of batch) {
    if (signal?.cancelled) break;
    if (
      stopOnStrict &&
      appendCount == null &&
      chunkStrictCount() >= slotsNeeded
    ) {
      break;
    }
    if (
      appendCount != null &&
      candidates.filter((item) => !existingKeys.has(openingMomentKey(item)))
        .length >= Math.max(wantNew * 2, wantNew + 2)
    ) {
      break;
    }

    const sans = parseMoves(game);
    if (sans.length < 4) {
      scannedGameIds.push(String(game.id));
      continue;
    }

    gamesScanned += 1;
    scannedGameIds.push(String(game.id));
    const gameLabel =
      game.opponent_name || game.opening_name || String(game.id).slice(0, 8);
    report(`Opening scan · ${gameLabel}`, "scan", {
      currentGame: gameLabel,
      log: `${ENGINE_LABEL} · game ${gamesScanned} · batch ${batch.length} · ${gameLabel}`,
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
      report(`DB lookup move ${moveNumber}`, "scan", {
        currentGame: gameLabel,
        log: `${ENGINE_LABEL} · explorer · move ${moveNumber}`,
      });

      let lichess;
      let masters;
      try {
        const [lichessRaw, mastersRaw] = await Promise.all([
          fetchExplorer(fenBefore, "lichess", ratings),
          fetchExplorer(fenBefore, "masters"),
        ]);
        lichess = {
          ...lichessRaw,
          moves: normalizeExplorerMoves(fenBefore, lichessRaw.moves || []),
        };
        masters = {
          ...mastersRaw,
          moves: normalizeExplorerMoves(fenBefore, mastersRaw.moves || []),
        };
      } catch {
        continue;
      }

      const posGames = Math.max(
        positionTotal(lichess),
        positionTotal(masters)
      );

      const fenAfter = chess.fen();
      const pickedEarly = pickBestMove(
        lichess.moves || [],
        masters.moves || [],
        color,
        null
      );
      const playedMoveEarly =
        (masters.moves || []).find((m) => m.uci === playedUci) ||
        (lichess.moves || []).find((m) => m.uci === playedUci);
      const gamesPlayedEarly = playedMoveEarly
        ? moveTotal(playedMoveEarly)
        : 0;
      const gamesBestEarly = pickedEarly.best
        ? moveTotal(pickedEarly.best)
        : 0;
      const winratePlayedEarly = playedMoveEarly
        ? expectedScore(playedMoveEarly, color)
        : posGames > 0
          ? 0
          : null;
      const winrateBestEarly = pickedEarly.best
        ? expectedScore(pickedEarly.best, color)
        : null;
      const winrateGapEarly =
        winrateBestEarly != null && winratePlayedEarly != null
          ? winrateBestEarly - winratePlayedEarly
          : null;
      const explorerDecisive =
        gamesPlayedEarly >= MIN_GAMES_FOR_WINRATE_UI &&
        gamesBestEarly >= MIN_GAMES_FOR_WINRATE_UI &&
        (winrateGapEarly || 0) >= HIGH_WINRATE_GAP;

      let evalBestUci: string | null = null;
      let evalBefore = 0;
      let evalAfter = 0;
      let evalDrop = 0;
      if (!explorerDecisive) {
        try {
          const beforeRaw = await evaluate(
            fenBefore,
            SCAN_DEPTH,
            1,
            SCAN_MOVETIME
          );
          const afterRaw = await evaluate(
            fenAfter,
            SCAN_DEPTH,
            1,
            SCAN_MOVETIME
          );
          const beforeCp = clampCp(toWhiteCp(fenBefore, beforeRaw.cpWhite));
          const afterCp = clampCp(toWhiteCp(fenAfter, afterRaw.cpWhite));
          const userBefore = clampCp(userIsWhite ? beforeCp : -beforeCp);
          const userAfter = clampCp(userIsWhite ? afterCp : -afterCp);
          evalDrop = userBefore - userAfter;
          evalBefore = beforeCp;
          evalAfter = afterCp;
          evalBestUci = beforeRaw.bestUci
            ? canonicalUci(fenBefore, beforeRaw.bestUci)
            : null;
        } catch {
          /* keep zeros */
        }
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
      let gamesPlayed: number | null = null;
      let gamesBest: number | null = null;
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
        gamesPlayed = moveTotal(playedMove);
        popularityPct = posGames ? moveTotal(playedMove) / posGames : playedRow?.freq ?? 0;
      } else if (posGames > 0) {
        winratePlayed = 0;
        gamesPlayed = 0;
        popularityPct = 0;
      }

      if (picked.best) {
        winrateBest = expectedScore(picked.best, color);
        gamesBest = moveTotal(picked.best);
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
        gamesBest = null;
        winrateBest = null;
      } else {
        continue;
      }

      if (!bestUci || bestUci === playedUci) continue;
      if (usedSource === "eval") {
        gamesBest = null;
      }
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
        games_played: gamesPlayed,
        games_best: gamesBest,
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

    if (bestForGame) {
      const posKey = openingPositionKey(bestForGame);
      if (chosenPositionKeys.has(posKey)) {
        report(`Skipping duplicate position`, "scan", {
          currentGame: gameLabel,
          log: `skip · same board as prior chosen · ${bestForGame.played_san}`,
        });
      } else {
        const priorIdx = candidates.findIndex(
          (item) => openingPositionKey(item) === posKey
        );
        if (priorIdx >= 0) {
          if (
            bestForGame.priority_score > candidates[priorIdx].priority_score
          ) {
            candidates[priorIdx] = bestForGame;
            chunkCandidates.push(bestForGame);
          }
        } else {
          candidates.push(bestForGame);
          chunkCandidates.push(bestForGame);
          report(`Candidate ${candidates.length} found`, "scan", {
            currentGame: gameLabel,
            log: `candidate · ${bestForGame.played_san}`,
          });
        }
      }
    }
  }

    for (const item of chunkCandidates) {
      const key = openingMomentKey(item);
      const posKey = openingPositionKey(item);
      if (existingKeys.has(key) || chosenPositionKeys.has(posKey)) continue;
      const prev = pendingMap.get(key);
      if (!prev || item.priority_score > prev.priority_score) {
        pendingMap.set(key, item);
      }
    }

    if (!batch.length && pendingMap.size === 0) break;

    report(
      slotsNeeded
        ? `Selecting up to ${slotsNeeded} opening moment${slotsNeeded === 1 ? "" : "s"}`
        : "Target opening moments already filled",
      "scan",
      {
        candidates: candidates.length,
        selected: selectedCount,
        log: `pool · ${pendingMap.size} pending · need ${slotsNeeded} · skip ${existingKeys.size} selected`,
      }
    );

    let attempts = 0;
    const maxAttempts = pendingMap.size + slotsNeeded + 2;
    while (selected.length < targetSelected && pendingMap.size > 0) {
      if (signal?.cancelled) break;
      if (attempts >= maxAttempts) break;
      attempts += 1;
      const need = targetSelected - selected.length;
      const nextBatch = pickFromPool(need);
      if (!nextBatch.length) break;
      for (const candidate of nextBatch) {
        const key = openingMomentKey(candidate);
        const posKey = openingPositionKey(candidate);
        pendingMap.delete(key);
        if (selected.some((item) => openingMomentKey(item) === key)) continue;
        if (existingKeys.has(key) && appendCount != null) continue;
        if (chosenPositionKeys.has(posKey)) continue;
        const refined = await refineOne(candidate);
        if (refined) {
          selected.push(refined);
          chosenPositionKeys.add(openingPositionKey(refined));
          selectedCount = selected.length - existingMoments.length;
          if (selected.length >= targetSelected) break;
        }
      }
    }

    if (appendCount != null && selected.length >= targetSelected) break;
    if (selected.length >= targetSelected) break;
    if (!batch.length) break;
  }

  if (appendCount == null) {
    selected = selected.slice(0, TARGET_MOMENTS);
  }
  selectedCount = Math.max(0, selected.length - existingMoments.length);
  const selectedKeySet = new Set(selected.map(openingMomentKey));
  const pendingCandidates = [...pendingMap.values()]
    .filter((item) => !selectedKeySet.has(openingMomentKey(item)))
    .sort(byPriority);
  const improved = selected.some(
    (item) => !existingKeys.has(openingMomentKey(item))
  );
  const remaining = Math.max(0, latestFirst.length - scannedGameIds.length);

  report(
    selectedCount || selected.length
      ? "Opening analysis complete"
      : "No opening moments found",
    "scan",
    {
      candidates: candidates.length,
      selected: selectedCount,
      log: `${ENGINE_LABEL} · done · ${selectedCount} new moments · ${pendingCandidates.length} pending`,
    }
  );

  return {
    moments: selected,
    pendingCandidates,
    scannedGameIds,
    improved,
    remaining,
  };
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
  const continuation = pvToSanLine(
    fen,
    moment.best_pv || [],
    MIN_CONTINUATION_PLIES
  );
  if (bestUci && sameMove(fen, userUci, bestUci)) {
    return {
      verdict: "best",
      user_san: userSan,
      best_continuation_san: continuation || moment.best_san,
      best_pv: moment.best_pv || [],
      user_score: moment.winrate_best,
      best_score: moment.winrate_best,
    };
  }

  const userAlt = moment.alt_moves.find((m) => sameMove(fen, m.uci, userUci));
  const bestScore =
    moment.winrate_best ??
    moment.alt_moves.find((m) => sameMove(fen, m.uci, bestUci))?.score ??
    null;
  const userScore = userAlt?.score ?? null;
  const ranked = [...moment.alt_moves].sort((a, b) => b.score - a.score);
  const inTop3 = ranked.slice(0, 3).some((m) => sameMove(fen, m.uci, userUci));

  const isPlayed = moment.played_uci
    ? sameMove(fen, userUci, moment.played_uci)
    : false;

  if (!isPlayed && bestScore != null && userScore != null) {
    const gap = bestScore - userScore;
    const referenceGap =
      moment.winrate_played != null ? bestScore - moment.winrate_played : null;
    const tolerance =
      referenceGap != null && referenceGap > 0
        ? Math.min(
            GOOD_SCORE_GAP,
            Math.max(0.02, referenceGap * SCORE_TOLERANCE_FRACTION)
          )
        : GOOD_SCORE_GAP;
    const playable =
      gap <= tolerance ||
      (inTop3 && userScore >= DECENT_WINRATE && gap <= tolerance * 2);
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
