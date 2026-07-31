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
  familyMatchesSelection,
  resolveEcoFamily,
} from "./ecoFamilies";
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
  ecoLabel?: string;
  variationHint?: string;
};

export type CompoundMoveEntry = {
  ply: number;
  san: string;
  uci: string;
  local_pct: number;
  compound_pct: number;
  rank: number | null;
};

export type OpeningMoment = MistakeItem & {
  winrate_played: number | null;
  winrate_best: number | null;
  winrate_gap: number | null;
  games_played: number | null;
  games_best: number | null;
  popularity_pct: number | null;
  popularity_drop_pct: number | null;
  path_frequency_pct: number | null;
  path_rank: number | null;
  frequency_note: string | null;
  compound_table: CompoundMoveEntry[];
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
const MIN_THRESHOLD = 5;
const STRICT_THRESHOLD = 10;
const HIGH_THRESHOLD = 15;
const MAX_MOMENTS_PER_GAME = 3;
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

export function winProbability(evalScore: number): number {
  return 1.0 / (1.0 + 10.0 ** (-evalScore / 4.0));
}

export function winrateToEval(winrate: number): number {
  const p = Math.min(0.99, Math.max(0.01, winrate));
  return 4.0 * Math.log10(p / (1.0 - p));
}

export function calculateThreshold(
  eval1: number,
  eval2: number,
  frequencyPct: number
): number {
  const p1 = winProbability(eval1);
  const p2 = winProbability(eval2);
  const deltaP = Math.abs(p2 - p1);
  const mFreq =
    1.0 + 0.25 * (Math.max(0, Math.min(100, frequencyPct)) / 100.0);
  return deltaP * mFreq * 100.0;
}

function toOrdinal(n: number): string {
  const abs = Math.abs(Math.round(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
  switch (abs % 10) {
    case 1:
      return `${abs}st`;
    case 2:
      return `${abs}nd`;
    case 3:
      return `${abs}rd`;
    default:
      return `${abs}th`;
  }
}

const COMPOUND_START_PLY = 2;
const RARE_COMPOUND_PCT = 1;

function formatFrequencyNote(
  table: CompoundMoveEntry[],
  focusPly: number
): string {
  const focus = table.find((entry) => entry.ply === focusPly);
  if (!focus || focus.compound_pct < RARE_COMPOUND_PCT) {
    return "This move is rare. Probability of occurrence: < 1%";
  }
  const firstSide = table.find(
    (entry) =>
      entry.ply <= focusPly && (entry.rank === 2 || entry.rank === 3)
  );
  const rankLabel =
    focus.rank == null
      ? "common"
      : focus.rank === 1
        ? "most common"
        : `${toOrdinal(focus.rank)} most common`;
  const pct = Math.max(1, Math.round(focus.compound_pct));
  if (firstSide) {
    return `After ${firstSide.san} this is the ${rankLabel} move. Probability of occurrence: ${pct}%.`;
  }
  return `This is the ${rankLabel} move. Probability of occurrence: ${pct}%.`;
}

function moveRankAmong(
  moves: ExplorerMove[],
  playedUci: string
): number | null {
  if (!moves.length) return null;
  const ranked = [...moves].sort(
    (a, b) =>
      moveTotal(b) - moveTotal(a) ||
      String(a.san).localeCompare(String(b.san))
  );
  const idx = ranked.findIndex((move) => move.uci === playedUci);
  return idx >= 0 ? idx + 1 : null;
}

function localMoveFrequency(
  moves: ExplorerMove[],
  total: number,
  playedUci: string,
  playedSan: string
): { freq: number; rank: number | null } {
  if (total <= 0) return { freq: 0, rank: null };
  const played =
    moves.find((m) => m.uci === playedUci) ||
    moves.find((m) => m.san === playedSan);
  if (!played) return { freq: 0, rank: moves.length + 1 };
  return {
    freq: moveTotal(played) / total,
    rank: moveRankAmong(moves, String(played.uci || playedUci)),
  };
}

function pushCompoundEntry(
  table: CompoundMoveEntry[],
  state: { compound: number; rare: boolean },
  ply: number,
  san: string,
  uci: string,
  localFreq: number,
  rank: number | null
): void {
  if (ply < COMPOUND_START_PLY) return;
  const localPct = Math.max(0, localFreq * 100);
  if (!state.rare) {
    if (localFreq > 0) state.compound *= localFreq;
    else state.compound *= 0.005;
  }
  const compoundPct = state.compound * 100;
  if (compoundPct < RARE_COMPOUND_PCT) state.rare = true;
  table.push({
    ply,
    san,
    uci,
    local_pct: Math.round(localPct * 10) / 10,
    compound_pct: Math.round(compoundPct * 10) / 10,
    rank,
  });
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
  const counts = new Map<
    string,
    OpeningChoice & { variationCounts: Map<string, number> }
  >();
  for (const game of games) {
    if (String(game.user_color || "").toLowerCase() !== color) continue;
    const eco = String(game.opening_eco || "UNK").toUpperCase();
    const variation = String(game.opening_name || "Unknown opening");
    const family = resolveEcoFamily(eco, variation);
    const key = family?.key || (eco !== "UNK" ? eco : variation.toLowerCase());
    const name = family?.name || variation;
    const ecoLabel = family?.ecoLabel || (eco !== "UNK" ? eco : "UNK");
    const prev = counts.get(key);
    if (prev) {
      prev.games += 1;
      prev.variationCounts.set(
        variation,
        (prev.variationCounts.get(variation) || 0) + 1
      );
      continue;
    }
    counts.set(key, {
      key,
      eco: ecoLabel,
      name,
      ecoLabel,
      games: 1,
      variationCounts: new Map([[variation, 1]]),
    });
  }
  return [...counts.values()]
    .map((item) => {
      const topVariation = [...item.variationCounts.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0];
      return {
        key: item.key,
        eco: item.eco,
        name: item.name,
        ecoLabel: item.ecoLabel,
        games: item.games,
        variationHint: topVariation,
      };
    })
    .sort((a, b) => b.games - a.games)
    .slice(0, limit);
}

export function searchOpeningsForColor(
  games: StudyGame[],
  color: "white" | "black",
  query: string,
  limit = 8
): OpeningChoice[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const all = topOpeningsForColor(games, color, 500);
  const matchedKeys = new Set<string>();
  for (const opening of all) {
    if (
      opening.name.toLowerCase().includes(q) ||
      opening.eco.toLowerCase().includes(q) ||
      (opening.ecoLabel || "").toLowerCase().includes(q)
    ) {
      matchedKeys.add(opening.key);
    }
  }
  for (const game of games) {
    if (String(game.user_color || "").toLowerCase() !== color) continue;
    const variation = String(game.opening_name || "").toLowerCase();
    if (!variation.includes(q)) continue;
    const family = resolveEcoFamily(game.opening_eco, game.opening_name);
    const key =
      family?.key ||
      (game.opening_eco
        ? String(game.opening_eco).toUpperCase()
        : variation);
    matchedKeys.add(key);
  }
  return all.filter((opening) => matchedKeys.has(opening.key)).slice(0, limit);
}

export function filterGamesByOpening(
  games: StudyGame[],
  color: "white" | "black",
  opening: OpeningChoice | { key?: string; eco?: string; name: string }
): StudyGame[] {
  return games.filter((game) => {
    if (String(game.user_color || "").toLowerCase() !== color) return false;
    return familyMatchesSelection(
      {
        key: "key" in opening && opening.key ? opening.key : "",
        eco: opening.eco,
        name: opening.name,
      },
      game.opening_eco,
      game.opening_name
    );
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

export type ThresholdPass = "strict" | "baseline";

export type OpeningAnalyzeBatchResult = {
  moments: OpeningMoment[];
  pendingCandidates: OpeningMoment[];
  scannedGameIds: string[];
  improved: boolean;
  remaining: number;
  thresholdPass: ThresholdPass;
  baselineAvailable: boolean;
};

function openingMomentKey(item: { game_id: string; ply: number }): string {
  return `${item.game_id}:${item.ply}`;
}

function openingPositionKey(item: { fen: string }): string {
  return fenKey(item.fen);
}

function passesOpeningCriteria(
  item: OpeningMoment,
  floor: number = MIN_THRESHOLD
): boolean {
  return (item.priority_score || 0) >= floor;
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
  thresholdPass?: ThresholdPass;
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
    thresholdPass: initialPass = "strict",
  } = options;
  const ratings = ratingsForElo(userRating);
  const candidates: OpeningMoment[] = [];
  const deferredPool = new Map<string, OpeningMoment>();
  let gamesScanned = 0;
  let positionsChecked = 0;
  let thresholdPass: ThresholdPass = initialPass;
  let acceptFloor =
    thresholdPass === "strict" ? STRICT_THRESHOLD : MIN_THRESHOLD;

  const excluded = new Set(excludeGameIds.map(String));
  let latestFirst = [...games]
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
    candidates.filter((item) => (item.priority_score || 0) >= HIGH_THRESHOLD)
      .length;

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
      .filter((item) => (item.priority_score || 0) >= HIGH_THRESHOLD)
      .sort(byPriority);
    const mid = [...pendingMap.values()]
      .filter((item) => (item.priority_score || 0) >= STRICT_THRESHOLD)
      .sort(byPriority);
    const low = [...pendingMap.values()]
      .filter((item) => passesOpeningCriteria(item, acceptFloor))
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
      const frequencyPct = moment.path_frequency_pct ?? 0;
      const evalScore =
        drop > 0
          ? calculateThreshold(userBefore / 100, userAfter / 100, frequencyPct)
          : 0;
      const winrateScore =
        moment.winrate_played != null && moment.winrate_best != null
          ? calculateThreshold(
              winrateToEval(moment.winrate_best),
              winrateToEval(moment.winrate_played),
              frequencyPct
            )
          : 0;
      moment.priority_score =
        Math.round(Math.max(winrateScore, evalScore, moment.priority_score || 0) * 10) /
        10;
      if (moment.best_uci && !canonicalUci(moment.fen, moment.best_uci)) {
        return null;
      }
      if (!passesOpeningCriteria(moment, acceptFloor)) return null;
    } catch {
      if (!moment.best_uci || !canonicalUci(moment.fen, moment.best_uci)) {
        return null;
      }
      if (!passesOpeningCriteria(moment, acceptFloor)) return null;
    }

    if (!moment.best_uci) return null;
    report(`Building continuation`, "continuation", {
      selected: selectedCount,
      candidates: candidates.length,
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

  for (;;) {
    report(`Threshold pass · ${thresholdPass}`, "scan", {
      log: `--- ${thresholdPass} pass · floor ${acceptFloor} ---`,
    });

  while (!signal?.cancelled && selected.length < targetSelected) {
    const slotsNeeded = targetSelected - selected.length;
    const batch = latestFirst
      .filter((game) => !scannedGameIds.includes(String(game.id)))
      .slice(0, batchSize);
    if (!batch.length && pendingMap.size === 0) break;

    const chunkCandidates: OpeningMoment[] = [];
    const chunkStrictCount = () =>
      chunkCandidates.filter(
        (item) => (item.priority_score || 0) >= HIGH_THRESHOLD
      ).length;

    for (const game of batch) {
    if (signal?.cancelled) break;
    if (
      stopOnStrict &&
      thresholdPass === "strict" &&
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
    report(`Opening scan · ${gameLabel}`, "scan", { currentGame: gameLabel });

    const userIsWhite = color === "white";
    const chess = new Chess();
    let prevPopularity: number | null = null;
    const gameMoments: OpeningMoment[] = [];
    const compoundTable: CompoundMoveEntry[] = [];
    const compoundState = { compound: 1, rare: false };

    const maxPly = Math.min(sans.length, MAX_OPENING_MOVES * 2);
    for (let ply = 0; ply < maxPly; ply += 1) {
      if (signal?.cancelled) break;
      const turnIsWhite = chess.turn() === "w";
      const isUserTurn = turnIsWhite === userIsWhite;
      const fenBefore = chess.fen();
      const moveNumber = Math.floor(ply / 2) + 1;

      let lichess;
      let masters;
      try {
        report(
          isUserTurn
            ? `DB lookup move ${moveNumber}`
            : `Path freq · move ${moveNumber}`,
          "scan",
          { currentGame: gameLabel }
        );
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
        if (!applySan(chess, sans[ply])) break;
        continue;
      }

      const probe = new Chess(fenBefore);
      const upcoming = applySan(probe, sans[ply]);
      if (!upcoming) break;
      const upcomingUci = uciFromMove(upcoming);
      const lichessTotal = positionTotal(lichess);
      const local = localMoveFrequency(
        lichess.moves || [],
        lichessTotal,
        upcomingUci,
        upcoming.san
      );
      pushCompoundEntry(
        compoundTable,
        compoundState,
        ply,
        upcoming.san,
        upcomingUci,
        local.freq,
        local.rank
      );
      const compoundEntry = compoundTable.find((entry) => entry.ply === ply);
      const frequencyPct = Math.max(
        0,
        Math.min(100, compoundEntry?.compound_pct ?? 100)
      );

      if (!isUserTurn) {
        if (!applySan(chess, sans[ply])) break;
        continue;
      }

      const played = applySan(chess, sans[ply]);
      if (!played) break;
      const playedUci = upcomingUci;
      const playedSan = upcoming.san;

      positionsChecked += 1;

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
      const earlyThreshold =
        winratePlayedEarly != null && winrateBestEarly != null
          ? calculateThreshold(
              winrateToEval(winrateBestEarly),
              winrateToEval(winratePlayedEarly),
              frequencyPct
            )
          : 0;
      const explorerDecisive =
        gamesPlayedEarly >= MIN_GAMES_FOR_WINRATE_UI &&
        gamesBestEarly >= MIN_GAMES_FOR_WINRATE_UI &&
        earlyThreshold >= HIGH_THRESHOLD;

      let evalBestUci: string | null = null;
      let evalBefore = 0;
      let evalAfter = 0;
      let evalDrop = 0;
      let userBeforePawns = 0;
      let userAfterPawns = 0;
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
          userBeforePawns = userBefore / 100;
          userAfterPawns = userAfter / 100;
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

      const playedRow =
        scored.find((row) => row.move.uci === playedUci) || null;
      const playedMove =
        (masters.moves || []).find((m) => m.uci === playedUci) ||
        (lichess.moves || []).find((m) => m.uci === playedUci);

      if (playedMove) {
        winratePlayed = expectedScore(playedMove, color);
        gamesPlayed = moveTotal(playedMove);
        popularityPct = posGames
          ? moveTotal(playedMove) / posGames
          : playedRow?.freq ?? 0;
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
      const winrateThreshold =
        winratePlayed != null && winrateBest != null
          ? calculateThreshold(
              winrateToEval(winrateBest),
              winrateToEval(winratePlayed),
              frequencyPct
            )
          : 0;
      const evalThreshold =
        evalDrop > 0
          ? calculateThreshold(
              userBeforePawns,
              userAfterPawns,
              frequencyPct
            )
          : 0;
      let priority = Math.max(winrateThreshold, evalThreshold);
      report(`Threshold check`, "scan", {
        currentGame: gameLabel,
        log: `${playedSan} ${Math.round(priority * 10) / 10} / strict ${STRICT_THRESHOLD} / broad ${MIN_THRESHOLD}`,
      });

      if (lowOrZero) {
        if (priority < MIN_THRESHOLD && evalDrop < EVAL_GAP_CP) continue;
        if (evalDrop >= EVAL_GAP_CP && evalBestUci && evalBestUci !== playedUci) {
          if (!bestUci || usedSource === "eval" || (winrateGap || 0) < 0.05) {
            bestUci = evalBestUci;
            usedSource = picked.best ? picked.source : "eval";
            const bestProbe = new Chess(fenBefore);
            const bm = applyUci(bestProbe, evalBestUci);
            bestSan = bm?.san || evalBestUci;
          }
        }
      } else if (posGames >= MIN_GAMES_AT_POS && winrateThreshold >= MIN_THRESHOLD) {
        /* keep */
      } else if (evalThreshold >= MIN_THRESHOLD && evalBestUci && evalBestUci !== playedUci) {
        bestUci = evalBestUci;
        usedSource = "eval";
        const bestProbe = new Chess(fenBefore);
        const bm = applyUci(bestProbe, evalBestUci);
        bestSan = bm?.san || evalBestUci;
        winrateGap = evalDrop / 1000;
        gamesBest = null;
        winrateBest = null;
        priority = evalThreshold;
      } else if (priority < MIN_THRESHOLD) {
        continue;
      }

      if (!bestUci || bestUci === playedUci) continue;
      if (usedSource === "eval") {
        gamesBest = null;
      }
      if (!bestSan) {
        const bestProbe = new Chess(fenBefore);
        const bm = applyUci(bestProbe, bestUci);
        bestSan = bm?.san || bestUci;
      }

      if (usedSource === "masters") priority *= 1.08;
      if (winratePlayed != null && winratePlayed <= ZERO_WINRATE) {
        priority *= 1.12;
      }
      priority = Math.round(priority * 10) / 10;

      const pathRank = compoundEntry?.rank ?? null;
      const frequencyNote = formatFrequencyNote(compoundTable, ply);

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
        path_frequency_pct: Math.round(frequencyPct * 10) / 10,
        path_rank: pathRank,
        frequency_note: frequencyNote,
        compound_table: compoundTable.map((entry) => ({ ...entry })),
        source: usedSource,
        alt_moves: altMoves,
        best_pv: bestUci ? [bestUci] : [],
        priority_score: priority,
      };

      gameMoments.push(item);
    }

    gameMoments.sort((a, b) => b.priority_score - a.priority_score);

    for (const moment of gameMoments.slice(0, MAX_MOMENTS_PER_GAME)) {
      const posKey = openingPositionKey(moment);
      if (chosenPositionKeys.has(posKey)) continue;

      if (moment.priority_score < acceptFloor) {
        const prevDeferred = deferredPool.get(posKey);
        if (!prevDeferred || moment.priority_score > prevDeferred.priority_score) {
          deferredPool.set(posKey, moment);
        }
        continue;
      }

      deferredPool.delete(posKey);
      const priorIdx = candidates.findIndex(
        (item) => openingPositionKey(item) === posKey
      );
      if (priorIdx >= 0) {
        if (moment.priority_score > candidates[priorIdx].priority_score) {
          candidates[priorIdx] = moment;
          chunkCandidates.push(moment);
        }
      } else {
        candidates.push(moment);
        chunkCandidates.push(moment);
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
      { candidates: candidates.length, selected: selectedCount }
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

    const remainingNow = Math.max(0, latestFirst.length - scannedGameIds.length);
    if (
      !signal?.cancelled &&
      thresholdPass === "strict" &&
      remainingNow <= 0 &&
      selected.length < targetSelected
    ) {
      thresholdPass = "baseline";
      acceptFloor = MIN_THRESHOLD;
      const revived = [...deferredPool.values()].filter(
        (item) => item.priority_score >= MIN_THRESHOLD
      );
      deferredPool.clear();
      for (const item of revived) {
        const key = openingMomentKey(item);
        const posKey = openingPositionKey(item);
        if (existingKeys.has(key) || chosenPositionKeys.has(posKey)) continue;
        if (!candidates.some((c) => openingPositionKey(c) === posKey)) {
          candidates.push(item);
        }
        const prev = pendingMap.get(key);
        if (!prev || item.priority_score > prev.priority_score) {
          pendingMap.set(key, item);
        }
      }
      if (!revived.length) {
        scannedGameIds.length = 0;
      }
      report(`Baseline pass · floor ${acceptFloor}`, "scan", {
        log: `baseline floor ${acceptFloor} · revived ${revived.length}`,
      });
      continue;
    }
    break;
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
  const baselineAvailable =
    thresholdPass === "strict" && remaining <= 0;

  report(
    selectedCount || selected.length
      ? "Opening analysis complete"
      : "No opening moments found",
    "scan",
    {
      candidates: candidates.length,
      selected: selectedCount,
      log: `done · ${thresholdPass} · ${selectedCount} new · deferred ${deferredPool.size}`,
    }
  );

  return {
    moments: selected,
    pendingCandidates,
    scannedGameIds,
    improved,
    remaining,
    thresholdPass,
    baselineAvailable,
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
