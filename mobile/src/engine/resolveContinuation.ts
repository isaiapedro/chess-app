import { Chess } from "chess.js";
import type { ExplorerTopGame } from "../api/client";
import {
  applyUciMove,
  canonicalUci,
  extractPvFromPgn,
  pvToSanLine,
} from "./chessMoves";
import { MIN_CONTINUATION_PLIES, REFINE_DEPTH, REFINE_MOVETIME } from "./analysisConfig";

export type ContEvalFn = (
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

export type ContExplorerFn = (
  fen: string,
  source: "lichess" | "masters",
  ratings?: string
) => Promise<{
  moves: Array<{ uci?: string }>;
  topGames?: ExplorerTopGame[];
}>;

export type ContPgnFn = (gameId: string) => Promise<{ pgn: string }>;

export type GmGameRef = {
  id?: string;
  white: string;
  black: string;
  date: string | null;
  event: string | null;
};

export type ContinuationResult = {
  pv: string[];
  source: "gm" | "engine";
  gm?: GmGameRef | null;
};

function gameRating(game: ExplorerTopGame): number {
  const w = game.white?.rating || 0;
  const b = game.black?.rating || 0;
  return Math.max(w, b) * 2 + Math.min(w, b);
}

function pgnTag(pgn: string, tag: string): string | null {
  const match = pgn.match(new RegExp(`\\[${tag}\\s+"([^"]*)"\\]`));
  const value = match?.[1]?.trim();
  if (!value || value === "?" || value === "????.??.??") return null;
  return value;
}

function formatPgnDate(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\?\?/g, "").replace(/\.$/, "").trim();
  if (!cleaned || cleaned === "????") return null;
  return cleaned;
}

export function parseGmFromPgn(
  pgn: string,
  fallback?: ExplorerTopGame | null
): GmGameRef {
  const white =
    pgnTag(pgn, "White") ||
    fallback?.white?.name ||
    "White";
  const black =
    pgnTag(pgn, "Black") ||
    fallback?.black?.name ||
    "Black";
  const date =
    formatPgnDate(pgnTag(pgn, "Date")) ||
    (fallback?.year != null ? String(fallback.year) : null);
  const event = pgnTag(pgn, "Event") || pgnTag(pgn, "Site");
  return {
    id: fallback?.id,
    white,
    black,
    date,
    event,
  };
}

export function formatGmGameLabel(gm: GmGameRef): string {
  const players = `${gm.white} vs ${gm.black}`;
  const parts = [players];
  if (gm.date) parts.push(gm.date);
  if (gm.event) parts.push(gm.event);
  return parts.join(" · ");
}

async function extendPvWithEngine(
  fen: string,
  seed: string[],
  evaluate: ContEvalFn,
  plies: number
): Promise<string[]> {
  const pv = seed.filter(Boolean).slice(0, plies);
  if (pv.length >= plies) return pv.slice(0, plies);

  const board = new Chess(fen);
  for (const uci of pv) {
    if (!applyUciMove(board, uci)) return pv;
  }

  while (pv.length < plies) {
    if (board.isGameOver()) break;
    try {
      const after = await evaluate(board.fen(), REFINE_DEPTH, 1, REFINE_MOVETIME);
      const next =
        (after.bestUci ? canonicalUci(board.fen(), after.bestUci) : null) ||
        (after.bestPv?.[0] ? canonicalUci(board.fen(), after.bestPv[0]) : null);
      if (!next || !applyUciMove(board, next)) break;
      pv.push(next);
      const rest = (after.bestPv || [])
        .slice(1)
        .map((move) => move)
        .filter(Boolean);
      for (const move of rest) {
        if (pv.length >= plies) break;
        const canon = canonicalUci(board.fen(), move) || move;
        if (!applyUciMove(board, canon)) break;
        pv.push(canon);
      }
    } catch {
      break;
    }
  }
  return pv.slice(0, plies);
}

export async function resolveContinuationPv(options: {
  fen: string;
  bestUci: string;
  fetchExplorer: ContExplorerFn;
  fetchMastersPgn?: ContPgnFn;
  evaluate?: ContEvalFn;
  plies?: number;
}): Promise<ContinuationResult> {
  const {
    fen,
    bestUci,
    fetchExplorer,
    fetchMastersPgn,
    evaluate,
    plies = MIN_CONTINUATION_PLIES,
  } = options;

  if (!bestUci) return { pv: [], source: "engine", gm: null };
  const canonBest = canonicalUci(fen, bestUci) || bestUci;

  if (fetchMastersPgn) {
    try {
      const masters = await fetchExplorer(fen, "masters");
      const matching = (masters.topGames || []).filter(
        (game) => game.id && canonicalUci(fen, game.uci) === canonBest
      );
      if (matching.length) {
        matching.sort((a, b) => gameRating(b) - gameRating(a));
        const top = matching[0];
        if (top.id) {
          const { pgn } = await fetchMastersPgn(top.id);
          const fromGm = extractPvFromPgn(pgn, fen, plies);
          const gm = parseGmFromPgn(pgn, top);
          let pv: string[] = [];
          if (fromGm.length && fromGm[0] === canonBest) {
            pv = fromGm.slice(0, plies);
          } else if (fromGm.length >= 1) {
            const board = new Chess(fen);
            if (applyUciMove(board, canonBest)) {
              pv = [canonBest, ...fromGm.slice(0, plies - 1)];
            }
          }
          if (pv.length) {
            if (evaluate && pv.length < plies) {
              pv = await extendPvWithEngine(fen, pv, evaluate, plies);
            }
            return { pv, source: "gm", gm };
          }
        }
      }
    } catch {
      /* fall through to engine */
    }
  }

  if (evaluate) {
    try {
      const multi = await evaluate(fen, REFINE_DEPTH, 5, REFINE_MOVETIME);
      const line =
        multi.multipv.find((row) => canonicalUci(fen, row.uci) === canonBest) ||
        (multi.bestUci && canonicalUci(fen, multi.bestUci) === canonBest
          ? { uci: canonBest, pv: multi.bestPv || [canonBest] }
          : null);
      let seed =
        line?.pv?.length
          ? line.pv
          : (() => {
              const board = new Chess(fen);
              if (!applyUciMove(board, canonBest)) return [canonBest];
              return [canonBest, ...(multi.bestPv || []).slice(0)];
            })();
      if (!seed.length || seed[0] !== canonBest) {
        seed = [canonBest, ...seed.filter((m) => m !== canonBest)];
      }
      const pv = await extendPvWithEngine(fen, seed, evaluate, plies);
      return { pv, source: "engine", gm: null };
    } catch {
      /* fall through */
    }
  }

  return { pv: [canonBest], source: "engine", gm: null };
}

export { pvToSanLine };
