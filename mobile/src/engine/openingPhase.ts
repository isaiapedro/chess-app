import { Chess, type Color, type Move, type Square } from "chess.js";
import type { StudyGame } from "./analyzeMistakes";
import { resolveEcoFamily } from "./ecoFamilies";
import { winProbabilityFromCp } from "./winProb";

export const OPENING_PHASE_MIN_FULLMOVE = 12;
export const OPENING_PHASE_NEVER_CASTLE_FULLMOVE = 15;
export const DEVELOPMENT_CHECK_FULLMOVE = 10;

const CENTER_SQUARES: Square[] = ["d4", "e4", "d5", "e5"];
const WHITE_MINOR_START = new Set<string>(["b1", "g1", "c1", "f1"]);
const BLACK_MINOR_START = new Set<string>(["b8", "g8", "c8", "f8"]);

const ACCURACY_A = 103.1668;
const ACCURACY_B = 0.04354;
const ACCURACY_C = 3.1669;

export type OpeningGameRow = {
  opening_accuracy_pct: number | null;
  opening_minors_developed_by_10: number | null;
  opening_center_control_pct: number | null;
  opening_castle_fullmove: number | null;
  uncastled: boolean;
  opening_tempo_waste_rate_pct: number | null;
  accuracy_moves: number;
  phase_end_fullmove: number;
  user_color?: string;
  opening_eco?: string;
  opening_name?: string;
  result?: string;
};

export type OpeningMetricsAggregate = {
  opening_accuracy_pct: number | null;
  opening_minors_developed_by_10: number | null;
  opening_center_control_pct: number | null;
  opening_castle_fullmove: number | null;
  opening_uncastled_rate_pct: number | null;
  opening_tempo_waste_rate_pct: number | null;
  games: number;
  castled_games: number;
  accuracy_games: number;
};

export type OpeningSideCard = {
  opening_eco: string;
  opening_name: string;
  eco_label?: string;
  games: number;
  win_rate: number;
  opening_accuracy_pct: number | null;
  opening_minors_developed_by_10: number | null;
  opening_center_control_pct: number | null;
  opening_castle_fullmove: number | null;
  opening_uncastled_rate_pct: number | null;
  opening_tempo_waste_rate_pct: number | null;
};

export function moveAccuracyPct(
  winPctBefore: number,
  winPctAfter: number
): number {
  const delta = winPctBefore - winPctAfter;
  const raw = ACCURACY_A * Math.exp(-ACCURACY_B * delta) - ACCURACY_C;
  return Math.max(0, Math.min(100, raw));
}

export function openingPhaseEndFullmove(
  castleFullmove: number | null
): number {
  if (castleFullmove == null) {
    return Math.max(
      OPENING_PHASE_MIN_FULLMOVE,
      OPENING_PHASE_NEVER_CASTLE_FULLMOVE
    );
  }
  return Math.max(OPENING_PHASE_MIN_FULLMOVE, castleFullmove);
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

export function countMinorsDeveloped(board: Chess, color: Color): number {
  const start = color === "w" ? WHITE_MINOR_START : BLACK_MINOR_START;
  let developed = 0;
  const grid = board.board();
  const files = "abcdefgh";
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = grid[rank][file];
      if (!piece || piece.color !== color) continue;
      if (piece.type !== "n" && piece.type !== "b") continue;
      const sq = `${files[file]}${8 - rank}`;
      if (!start.has(sq)) developed += 1;
    }
  }
  return Math.min(4, developed);
}

export function centerControlShare(board: Chess, color: Color): number {
  let controlled = 0;
  for (const sq of CENTER_SQUARES) {
    const piece = board.get(sq);
    if (piece && piece.color === color) {
      controlled += 1;
      continue;
    }
    if (board.attackers(sq, color).length > 0) controlled += 1;
  }
  return (controlled / 4) * 100;
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

export function analyzeOpeningGame(
  game: StudyGame,
  evalsWhiteCp?: number[] | null
): OpeningGameRow | null {
  const sans = parseSans(game);
  if (!sans.length) return null;

  const board = new Chess();
  const userIsWhite =
    String(game.user_color || "white").toLowerCase() === "white";
  const color: Color = userIsWhite ? "w" : "b";
  const evals = evalsWhiteCp ? [...evalsWhiteCp] : [];
  let evalIdx = 0;
  const nextEval = (): number | null => {
    if (evalIdx < evals.length) {
      const cp = evals[evalIdx];
      evalIdx += 1;
      return cp;
    }
    return null;
  };

  let lastWhiteCp = nextEval();
  let castleFullmove: number | null = null;
  let phaseEnd = openingPhaseEndFullmove(null);
  const centerSamples: number[] = [];
  const accuracySamples: number[] = [];
  let tempoMoves = 0;
  let tempoWastes = 0;
  const timesMoved = new Map<string, number>();
  let minorsAt10: number | null = null;

  for (let plyIdx = 0; plyIdx < sans.length; plyIdx += 1) {
    let move: Move | null = null;
    try {
      move = board.move(sans[plyIdx]) as Move;
    } catch {
      move = null;
    }
    if (!move) break;
    board.undo();

    const fullMove = Math.floor(plyIdx / 2) + 1;
    const isUser = board.turn() === color;
    const moving = board.get(move.from);
    const cpBeforeWhite = lastWhiteCp;
    const isCastle = move.isKingsideCastle() || move.isQueensideCastle();

    if (isUser && isCastle && castleFullmove == null) {
      castleFullmove = fullMove;
      phaseEnd = openingPhaseEndFullmove(castleFullmove);
    }

    const inPhase = fullMove <= phaseEnd;

    if (isUser && moving && inPhase && moving.type !== "p") {
      tempoMoves += 1;
      const prior = timesMoved.get(move.from) || 0;
      const developed = countMinorsDeveloped(board, color);
      if (prior >= 1 && developed < 4) tempoWastes += 1;
      timesMoved.set(move.to, prior + 1);
      if (move.to !== move.from) timesMoved.set(move.from, 0);
    }

    board.move(move);

    if (
      minorsAt10 == null &&
      fullMove === DEVELOPMENT_CHECK_FULLMOVE &&
      board.turn() === "w"
    ) {
      minorsAt10 = countMinorsDeveloped(board, color);
    }

    const cpAfterWhite = nextEval();
    if (cpAfterWhite != null) lastWhiteCp = cpAfterWhite;

    if (inPhase) centerSamples.push(centerControlShare(board, color));

    if (
      isUser &&
      inPhase &&
      cpBeforeWhite != null &&
      cpAfterWhite != null
    ) {
      const beforeUser = userIsWhite ? cpBeforeWhite : -cpBeforeWhite;
      const afterUser = userIsWhite ? cpAfterWhite : -cpAfterWhite;
      accuracySamples.push(
        moveAccuracyPct(
          winProbabilityFromCp(beforeUser) * 100,
          winProbabilityFromCp(afterUser) * 100
        )
      );
    }

    if (fullMove > phaseEnd && castleFullmove != null) break;
    if (fullMove > 40) break;
  }

  if (minorsAt10 == null) {
    minorsAt10 = countMinorsDeveloped(board, color);
  }

  return {
    opening_accuracy_pct: mean(accuracySamples, 1),
    opening_minors_developed_by_10: minorsAt10,
    opening_center_control_pct: mean(centerSamples, 1),
    opening_castle_fullmove: castleFullmove,
    uncastled: castleFullmove == null,
    opening_tempo_waste_rate_pct:
      tempoMoves > 0
        ? Math.round((tempoWastes / tempoMoves) * 1000) / 10
        : null,
    accuracy_moves: accuracySamples.length,
    phase_end_fullmove: openingPhaseEndFullmove(castleFullmove),
    user_color: String(game.user_color || "white"),
    opening_eco: game.opening_eco,
    opening_name: game.opening_name,
    result: game.result,
  };
}

export function aggregateOpeningMetrics(
  rows: OpeningGameRow[]
): OpeningMetricsAggregate {
  const empty: OpeningMetricsAggregate = {
    opening_accuracy_pct: null,
    opening_minors_developed_by_10: null,
    opening_center_control_pct: null,
    opening_castle_fullmove: null,
    opening_uncastled_rate_pct: null,
    opening_tempo_waste_rate_pct: null,
    games: 0,
    castled_games: 0,
    accuracy_games: 0,
  };
  if (!rows.length) return empty;

  const accuracy = rows
    .map((r) => r.opening_accuracy_pct)
    .filter((v): v is number => v != null);
  const minors = rows
    .map((r) => r.opening_minors_developed_by_10)
    .filter((v): v is number => v != null);
  const center = rows
    .map((r) => r.opening_center_control_pct)
    .filter((v): v is number => v != null);
  const castles = rows
    .map((r) => r.opening_castle_fullmove)
    .filter((v): v is number => v != null);
  const tempo = rows
    .map((r) => r.opening_tempo_waste_rate_pct)
    .filter((v): v is number => v != null);
  const uncastledN = rows.filter((r) => r.uncastled).length;
  const n = rows.length;
  return {
    opening_accuracy_pct: mean(accuracy, 1),
    opening_minors_developed_by_10: mean(minors, 1),
    opening_center_control_pct: mean(center, 1),
    opening_castle_fullmove: mean(castles, 1),
    opening_uncastled_rate_pct:
      n > 0 ? Math.round((uncastledN / n) * 1000) / 10 : null,
    opening_tempo_waste_rate_pct: mean(tempo, 1),
    games: n,
    castled_games: castles.length,
    accuracy_games: accuracy.length,
  };
}

export function topOpeningsBySide(
  rows: OpeningGameRow[],
  limit = 5,
  minGames = 3
): { white: OpeningSideCard[]; black: OpeningSideCard[] } {
  const buckets = new Map<string, OpeningGameRow[]>();
  const labels = new Map<string, { name: string; ecoLabel: string }>();

  for (const row of rows) {
    const color = String(row.user_color || "white").toLowerCase();
    if (color !== "white" && color !== "black") continue;
    const eco = String(row.opening_eco || "UNK").trim().toUpperCase() || "UNK";
    const variation = String(row.opening_name || eco || "Unknown");
    const family = resolveEcoFamily(eco, variation);
    const familyKey =
      family?.key || (eco !== "UNK" ? eco : variation.toLowerCase());
    const key = `${color}::${familyKey}`;
    const list = buckets.get(key) || [];
    list.push(row);
    buckets.set(key, list);
    if (!labels.has(key)) {
      labels.set(key, {
        name: family?.name || variation,
        ecoLabel: family?.ecoLabel || (eco !== "UNK" ? eco : "UNK"),
      });
    }
  }

  const build = (side: "white" | "black"): OpeningSideCard[] => {
    const items: OpeningSideCard[] = [];
    for (const [key, group] of buckets) {
      if (!key.startsWith(`${side}::`) || group.length < minGames) continue;
      const label = labels.get(key) || {
        name: "Unknown",
        ecoLabel: "UNK",
      };
      const agg = aggregateOpeningMetrics(group);
      const wins = group.filter((g) => String(g.result) === "Win").length;
      items.push({
        opening_eco: label.ecoLabel,
        opening_name: label.name,
        eco_label: label.ecoLabel,
        games: group.length,
        win_rate: Math.round((wins / group.length) * 1000) / 10,
        opening_accuracy_pct: agg.opening_accuracy_pct,
        opening_minors_developed_by_10: agg.opening_minors_developed_by_10,
        opening_center_control_pct: agg.opening_center_control_pct,
        opening_castle_fullmove: agg.opening_castle_fullmove,
        opening_uncastled_rate_pct: agg.opening_uncastled_rate_pct,
        opening_tempo_waste_rate_pct: agg.opening_tempo_waste_rate_pct,
      });
    }
    items.sort(
      (a, b) =>
        b.games - a.games || a.opening_name.localeCompare(b.opening_name)
    );
    return items.slice(0, limit);
  };

  return { white: build("white"), black: build("black") };
}

export async function analyzeOpeningGamesBatched(
  games: StudyGame[],
  evalsById: Record<string, number[]> | undefined,
  options?: {
    batchSize?: number;
    signal?: { cancelled: boolean };
    onPartial?: (
      rows: OpeningGameRow[],
      scanned: number,
      total: number
    ) => void;
  }
): Promise<OpeningGameRow[]> {
  const batchSize = options?.batchSize ?? 3;
  const rows: OpeningGameRow[] = [];
  const total = games.length;
  for (let i = 0; i < games.length; i += batchSize) {
    if (options?.signal?.cancelled) break;
    const chunk = games.slice(i, i + batchSize);
    for (const game of chunk) {
      const evals = evalsById?.[String(game.id)];
      const row = analyzeOpeningGame(game, evals);
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

export function analyzeOpeningGames(
  games: StudyGame[],
  evalsById?: Record<string, number[]>
): OpeningGameRow[] {
  const rows: OpeningGameRow[] = [];
  for (const game of games) {
    const evals = evalsById?.[String(game.id)];
    const row = analyzeOpeningGame(game, evals);
    if (row) rows.push(row);
  }
  return rows;
}
