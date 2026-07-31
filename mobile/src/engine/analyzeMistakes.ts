import { Chess, type Move } from "chess.js";
import type { MistakeItem } from "../api/client";
import {
  applyUciMove,
  canonicalUci,
  fenKey,
  pvToSanLine as pvLineFromMoves,
  uciFromMove,
} from "./chessMoves";
import { resolveContinuationPv } from "./resolveContinuation";
import {
  BATCH_GAMES,
  ENGINE_LABEL,
  MIN_CONTINUATION_PLIES,
  REFINE_DEPTH,
  REFINE_MOVETIME,
  SCAN_DEPTH,
  SCAN_MOVETIME,
  TARGET_MISTAKE_MOMENTS,
} from "./analysisConfig";

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
  candidates: number;
  selected: number;
  status: string;
  phase: "scan" | "refine" | "continuation";
  engine: string;
  currentGame?: string;
  log?: string;
};

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

type ExplorerFn = (
  fen: string,
  source: "lichess" | "masters",
  ratings?: string
) => Promise<{
  moves: Array<{ uci?: string }>;
  topGames?: import("../api/client").ExplorerTopGame[];
}>;

type MastersPgnFn = (gameId: string) => Promise<{ pgn: string }>;

const OPENING_PLY_SKIP = 12;
const SAMPLE_EVERY = 2;
const BASE_MIN_DROP_CP = 100;
const BASE_MIN_PRIORITY = 800;
const BASE_STRICT_DROP_CP = Math.round(BASE_MIN_DROP_CP * 1.3);
const BASE_STRICT_PRIORITY = Math.round(BASE_MIN_PRIORITY * 1.3);
const HIGH_MIN_DROP_CP = Math.round(BASE_MIN_DROP_CP * 1.5);
const HIGH_MIN_PRIORITY = Math.round(BASE_MIN_PRIORITY * 1.5);
const HIGH_STRICT_DROP_CP = Math.round(HIGH_MIN_DROP_CP * 1.3);
const HIGH_STRICT_PRIORITY = Math.round(HIGH_MIN_PRIORITY * 1.3);
const MIN_DROP_CP = BASE_MIN_DROP_CP;
const MIN_PRIORITY = BASE_MIN_PRIORITY;
const STRICT_DROP_CP = HIGH_STRICT_DROP_CP;
const STRICT_PRIORITY = HIGH_STRICT_PRIORITY;
const TARGET_MOMENTS = TARGET_MISTAKE_MOMENTS;
const EVAL_CLAMP = 2000;
const MATE_CP_THRESHOLD = 50000;
const GOOD_MOVE_MAX_LOSS_CP = 50;
const GAP_TOLERANCE_FRACTION = 0.2;
const GAP_TOLERANCE_MIN_CP = 20;
const GAP_TOLERANCE_MAX_CP = 150;
const CONTINUATION_PLIES = MIN_CONTINUATION_PLIES;

export function clampCp(value: number): number {
  const abs = Math.abs(value);
  if (abs >= MATE_CP_THRESHOLD) {
    const moves = Math.max(1, Math.min(99, Math.round((100000 - abs) / 1000)));
    const encoded = EVAL_CLAMP + moves;
    return value > 0 ? encoded : -encoded;
  }
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, value));
}

export function displayCp(value: number): number {
  const abs = Math.abs(value);
  if (abs > EVAL_CLAMP) return value > 0 ? EVAL_CLAMP : -EVAL_CLAMP;
  return value;
}

export function formatEval(value: number): string {
  const abs = Math.abs(value);
  if (abs > EVAL_CLAMP) {
    const moves = Math.max(1, Math.round(abs - EVAL_CLAMP));
    return `Mate in ${moves}`;
  }
  if (abs >= EVAL_CLAMP) {
    return "Mate";
  }
  const pawns = value / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
}

export function toWhiteCp(fen: string, sideToMoveCp: number): number {
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

export function pvToSanLine(
  fen: string,
  pv: string[],
  maxPlies = CONTINUATION_PLIES
): string {
  return pvLineFromMoves(fen, pv, maxPlies);
}

export type AnalyzeBatchResult = {
  moments: MistakeItem[];
  pendingCandidates: MistakeItem[];
  scannedGameIds: string[];
  improved: boolean;
  remaining: number;
};

function momentKey(item: { game_id: string; ply: number }): string {
  return `${item.game_id}:${item.ply}`;
}

function positionKey(item: { fen: string }): string {
  return fenKey(item.fen);
}

function passesMistakeCriteria(item: {
  eval_drop_cp: number;
  priority_score: number;
}): boolean {
  return (
    item.eval_drop_cp >= BASE_MIN_DROP_CP &&
    item.priority_score >= BASE_MIN_PRIORITY
  );
}

export async function analyzeCriticalMistakes(options: {
  games: StudyGame[];
  evaluate: EvalFn;
  fetchExplorer?: ExplorerFn;
  fetchMastersPgn?: MastersPgnFn;
  onProgress?: (progress: AnalyzeProgress) => void;
  signal?: { cancelled: boolean };
  excludeGameIds?: string[];
  existingMoments?: MistakeItem[];
  existingCandidates?: MistakeItem[];
  batchSize?: number;
  stopOnStrict?: boolean;
  appendCount?: number;
}): Promise<AnalyzeBatchResult> {
  const {
    games,
    evaluate,
    fetchExplorer,
    fetchMastersPgn,
    onProgress,
    signal,
    excludeGameIds = [],
    existingMoments = [],
    existingCandidates = [],
    batchSize = BATCH_GAMES,
    stopOnStrict = true,
    appendCount,
  } = options;
  type Ranked = MistakeItem & { priority_score: number };
  const candidates: Ranked[] = [];
  let positionsChecked = 0;
  let gamesScanned = 0;
  let selectedCount = 0;

  const report = (
    status: string,
    phase: AnalyzeProgress["phase"],
    extra?: Partial<AnalyzeProgress>
  ) => {
    onProgress?.({
      gamesScanned,
      positionsChecked,
      found: Math.min(
        candidates.filter(
          (item) =>
            item.eval_drop_cp >= STRICT_DROP_CP &&
            item.priority_score >= STRICT_PRIORITY
        ).length || candidates.length,
        TARGET_MOMENTS
      ),
      candidates: candidates.length,
      selected: selectedCount,
      status,
      phase,
      engine: ENGINE_LABEL,
      ...extra,
    });
  };

  const excluded = new Set(excludeGameIds.map(String));
  const latestFirst = [...games]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .filter((game) => game.id && !excluded.has(String(game.id)));
  const batch = latestFirst.slice(0, batchSize);
  const scannedGameIds: string[] = [];

  const existingKeys = new Set(existingMoments.map(momentKey));
  const existingByKey = new Map(
    existingMoments.map((item) => [
      momentKey(item),
      {
        ...item,
        priority_score:
          (item as Ranked).priority_score ??
          Math.round(item.eval_drop_cp * 10) / 10,
      } as Ranked,
    ])
  );
  const chosenPositionKeys = new Set(
    existingMoments.map((item) => positionKey(item))
  );

  const toRanked = (item: MistakeItem): Ranked => ({
    ...item,
    priority_score:
      (item as Ranked).priority_score ??
      Math.round(item.eval_drop_cp * 10) / 10,
  });

  const strictCount = () =>
    candidates.filter(
      (item) =>
        item.eval_drop_cp >= STRICT_DROP_CP &&
        item.priority_score >= STRICT_PRIORITY
    ).length;

  const wantNew =
    appendCount != null && appendCount > 0
      ? appendCount
      : Math.max(0, TARGET_MOMENTS - existingMoments.length);

  for (const game of batch) {
    if (signal?.cancelled) break;
    if (
      stopOnStrict &&
      appendCount == null &&
      strictCount() >= TARGET_MOMENTS
    ) {
      break;
    }
    if (
      appendCount != null &&
      candidates.filter((item) => !existingKeys.has(momentKey(item))).length >=
        Math.max(wantNew * 2, wantNew + 2)
    ) {
      break;
    }

    const sans = parseMoves(game);
    if (sans.length < 6) {
      scannedGameIds.push(String(game.id));
      continue;
    }

    gamesScanned += 1;
    scannedGameIds.push(String(game.id));
    const gameLabel =
      opponentName(game) || game.opening_name || String(game.id).slice(0, 8);
    report(`Scanning ${gameLabel}`, "scan", {
      currentGame: gameLabel,
      log: `${ENGINE_LABEL} · game ${gamesScanned}/${batch.length} · ${gameLabel}`,
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
      report(`Checking position ${positionsChecked}`, "scan", {
        currentGame: gameLabel,
        log: `${ENGINE_LABEL} · eval · ply ${ply + 1}`,
      });

      let beforeRaw;
      let afterRaw;
      try {
        beforeRaw = await evaluate(fenBefore, SCAN_DEPTH, 1, SCAN_MOVETIME);
        afterRaw = await evaluate(fenAfter, SCAN_DEPTH, 1, SCAN_MOVETIME);
      } catch {
        continue;
      }

      const beforeCp = clampCp(toWhiteCp(fenBefore, beforeRaw.cpWhite));
      const afterCp = clampCp(toWhiteCp(fenAfter, afterRaw.cpWhite));
      const userBefore = clampCp(userIsWhite ? beforeCp : -beforeCp);
      const userAfter = clampCp(userIsWhite ? afterCp : -afterCp);
      const drop = userBefore - userAfter;
      if (drop < MIN_DROP_CP) continue;

      const bestUci = beforeRaw.bestUci
        ? canonicalUci(fenBefore, beforeRaw.bestUci)
        : "";
      if (!bestUci || bestUci === playedUci) continue;
      const probeLegal = new Chess(fenBefore);
      if (!applyUciMove(probeLegal, bestUci)) continue;

      let bestSan: string | null = null;
      if (bestUci && bestUci.length >= 4) {
        const probe = new Chess(fenBefore);
        const bestMove = applyUciMove(probe, bestUci);
        bestSan = bestMove?.san || null;
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
        best_pv: bestUci ? [bestUci] : [],
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
      const posKey = positionKey(bestForGame);
      if (chosenPositionKeys.has(posKey)) {
        report(`Skipping duplicate position`, "scan", {
          currentGame: gameLabel,
          log: `skip · same board as prior chosen · ${bestForGame.played_san}`,
        });
      } else {
        const priorIdx = candidates.findIndex(
          (item) => positionKey(item) === posKey
        );
        if (priorIdx >= 0) {
          if (
            bestForGame.priority_score > candidates[priorIdx].priority_score
          ) {
            candidates[priorIdx] = bestForGame;
          }
        } else {
          candidates.push(bestForGame);
          report(`Candidate ${candidates.length} found`, "scan", {
            currentGame: gameLabel,
            log: `candidate · ${bestForGame.played_san} · drop ${bestForGame.eval_drop_cp}cp`,
          });
        }
      }
    }
  }

  const byPriority = (a: Ranked, b: Ranked) =>
    b.priority_score - a.priority_score || b.eval_drop_cp - a.eval_drop_cp;

  const pendingMap = new Map<string, Ranked>();
  for (const item of existingCandidates) {
    const ranked = toRanked(item);
    const key = momentKey(ranked);
    const posKey = positionKey(ranked);
    if (existingKeys.has(key) || chosenPositionKeys.has(posKey)) continue;
    pendingMap.set(key, ranked);
  }
  for (const item of candidates) {
    const key = momentKey(item);
    const posKey = positionKey(item);
    if (existingKeys.has(key) || chosenPositionKeys.has(posKey)) continue;
    const prev = pendingMap.get(key);
    if (!prev || item.priority_score > prev.priority_score) {
      pendingMap.set(key, item);
    }
  }

  let selected: Ranked[] = existingMoments.map(
    (item) => existingByKey.get(momentKey(item)) || toRanked(item)
  );

  const pickFromPool = (need: number): Ranked[] => {
    if (need <= 0) return [];
    const highStrict = [...pendingMap.values()]
      .filter(
        (item) =>
          item.eval_drop_cp >= HIGH_STRICT_DROP_CP &&
          item.priority_score >= HIGH_STRICT_PRIORITY
      )
      .sort(byPriority);
    const highMin = [...pendingMap.values()]
      .filter(
        (item) =>
          item.eval_drop_cp >= HIGH_MIN_DROP_CP &&
          item.priority_score >= HIGH_MIN_PRIORITY
      )
      .sort(byPriority);
    const baseStrict = [...pendingMap.values()]
      .filter(
        (item) =>
          item.eval_drop_cp >= BASE_STRICT_DROP_CP &&
          item.priority_score >= BASE_STRICT_PRIORITY
      )
      .sort(byPriority);
    const baseMin = [...pendingMap.values()]
      .filter(
        (item) =>
          item.eval_drop_cp >= BASE_MIN_DROP_CP &&
          item.priority_score >= BASE_MIN_PRIORITY
      )
      .sort(byPriority);
    const ordered: Ranked[] = [];
    const seen = new Set<string>();
    const seenPositions = new Set<string>();
    for (const list of [highStrict, highMin, baseStrict, baseMin]) {
      for (const item of list) {
        const key = momentKey(item);
        const posKey = positionKey(item);
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

  const refineOne = async (moment: Ranked): Promise<Ranked | null> => {
    report(`Refining moment`, "refine", {
      selected: selectedCount,
      candidates: candidates.length,
      log: `${ENGINE_LABEL} · refine · ${moment.played_san} · depth ${REFINE_DEPTH}`,
    });
    try {
      const fenAfterBoard = new Chess(moment.fen);
      if (!applyUciMove(fenAfterBoard, moment.played_uci)) {
        return null;
      }
      const fenAfter = fenAfterBoard.fen();
      const userIsWhite =
        String(moment.user_color || "white").toLowerCase() === "white";
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
      const bestUci = beforeRaw.bestUci
        ? canonicalUci(moment.fen, beforeRaw.bestUci)
        : "";
      if (!bestUci) return null;
      const probe = new Chess(moment.fen);
      const bestMove = applyUciMove(probe, bestUci);
      if (!bestMove) return null;
      moment.eval_before_cp = Math.round(beforeCp * 10) / 10;
      moment.eval_after_cp = Math.round(afterCp * 10) / 10;
      moment.eval_delta_cp = Math.round((afterCp - beforeCp) * 10) / 10;
      moment.eval_drop_cp = Math.round(drop * 10) / 10;
      moment.best_uci = bestUci;
      moment.best_san = bestMove.san;
      moment.comment = `Your position worsened by ~${Math.round(drop)} cp after ${moment.played_san}.`;
      moment.priority_score =
        Math.round(mistakePriority(userBefore, userAfter, drop) * 10) / 10;
      if (!passesMistakeCriteria(moment)) return null;
    } catch {
      if (!moment.best_uci || !canonicalUci(moment.fen, moment.best_uci)) {
        return null;
      }
      if (!passesMistakeCriteria(moment)) return null;
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
        fetchExplorer:
          fetchExplorer ||
          (async () => ({ moves: [], topGames: [] })),
        fetchMastersPgn,
        evaluate,
        plies: CONTINUATION_PLIES,
      });
      moment.best_pv = cont.pv;
      moment.continuation_source = cont.source;
      moment.gm_game = cont.gm || null;
    } catch {
      moment.best_pv = [moment.best_uci];
      moment.continuation_source = "engine";
      moment.gm_game = null;
    }
    return moment;
  };

  const targetSelected =
    appendCount != null && appendCount > 0
      ? selected.length + appendCount
      : TARGET_MOMENTS;
  const slotsNeeded = Math.max(0, targetSelected - selected.length);
  report(
    slotsNeeded
      ? `Selecting up to ${slotsNeeded} moment${slotsNeeded === 1 ? "" : "s"}`
      : "Target moments already filled",
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
      const key = momentKey(candidate);
      const posKey = positionKey(candidate);
      pendingMap.delete(key);
      if (selected.some((item) => momentKey(item) === key)) continue;
      if (existingKeys.has(key) && appendCount != null) continue;
      if (chosenPositionKeys.has(posKey)) continue;
      const refined = await refineOne(candidate);
      if (refined) {
        selected.push(refined);
        chosenPositionKeys.add(positionKey(refined));
        selectedCount = selected.length - existingMoments.length;
        if (selected.length >= targetSelected) break;
      }
    }
  }

  if (appendCount == null) {
    selected = selected.slice(0, TARGET_MOMENTS);
  }
  selectedCount = Math.max(0, selected.length - existingMoments.length);
  const selectedKeySet = new Set(selected.map(momentKey));
  const pendingCandidates = [...pendingMap.values()]
    .filter((item) => !selectedKeySet.has(momentKey(item)))
    .sort(byPriority);
  const improved = selected.some((item) => !existingKeys.has(momentKey(item)));
  const remaining = Math.max(0, latestFirst.length - scannedGameIds.length);

  report(
    selectedCount || selected.length
      ? "Analysis complete"
      : "No critical swings found",
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

export function acceptableLossCp(gapCp?: number | null): number {
  if (gapCp == null || !Number.isFinite(gapCp) || gapCp <= 0) {
    return GOOD_MOVE_MAX_LOSS_CP;
  }
  return Math.min(
    GAP_TOLERANCE_MAX_CP,
    Math.max(GAP_TOLERANCE_MIN_CP, Math.round(gapCp * GAP_TOLERANCE_FRACTION))
  );
}

export async function validateMoveLocal(
  evaluate: EvalFn,
  fen: string,
  userUci: string,
  bestUci: string,
  knownBestPv?: string[],
  options?: { gapCp?: number | null; playedUci?: string | null }
): Promise<QuizValidation> {
  const maxLoss = acceptableLossCp(options?.gapCp);
  const playedCanon = options?.playedUci
    ? canonicalUci(fen, options.playedUci)
    : null;
  const board = new Chess(fen);
  let userSan: string | null = null;
  let legal = false;
  const move = applyUciMove(board, userUci);
  if (move) {
    legal = true;
    userSan = move.san;
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

  const canonUserUci = canonicalUci(fen, userUci);

  try {
    const multi = await evaluate(fen, REFINE_DEPTH, 5, REFINE_MOVETIME);
    const lines = multi.multipv.map((line) => ({
      ...line,
      uci: canonicalUci(fen, line.uci),
    }));
    const engineBestUci = multi.bestUci ? canonicalUci(fen, multi.bestUci) : null;
    const resolvedBestUci =
      (bestUci ? canonicalUci(fen, bestUci) : null) ||
      engineBestUci ||
      lines[0]?.uci ||
      null;
    const bestLine =
      lines.find((line) => line.uci === resolvedBestUci) || lines[0] || null;
    const bestPv =
      (knownBestPv && knownBestPv.length ? knownBestPv : null) ||
      bestLine?.pv ||
      multi.bestPv ||
      (resolvedBestUci ? [resolvedBestUci] : []);
    const bestContinuation = pvToSanLine(fen, bestPv, CONTINUATION_PLIES);

    let bestStm =
      bestLine?.cpWhite ??
      (engineBestUci === resolvedBestUci ? multi.cpWhite : null);
    let userStm: number | null = null;
    const userLine = lines.find((line) => line.uci === canonUserUci);
    if (userLine) {
      userStm = userLine.cpWhite;
    }

    if (bestStm == null || userStm == null) {
      const afterUser = await evaluate(board.fen(), REFINE_DEPTH, 1, REFINE_MOVETIME);
      const userWhite = toWhiteCp(board.fen(), afterUser.cpWhite);
      let bestWhite: number;
      if (bestStm != null) {
        bestWhite = toWhiteCp(fen, bestStm);
      } else if (resolvedBestUci) {
        const bestBoard = new Chess(fen);
        if (applyUciMove(bestBoard, resolvedBestUci)) {
          const afterBest = await evaluate(bestBoard.fen(), REFINE_DEPTH, 1, REFINE_MOVETIME);
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
      const isBest = canonUserUci === resolvedBestUci;
      const isPlayed = playedCanon != null && canonUserUci === playedCanon;
      const verdict: QuizVerdict = isBest
        ? "best"
        : !isPlayed && centipawnLoss <= maxLoss
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
    const isBest = canonUserUci === resolvedBestUci;
    const isPlayed = playedCanon != null && canonUserUci === playedCanon;
    const verdict: QuizVerdict = isBest
      ? "best"
      : !isPlayed && centipawnLoss <= maxLoss
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
