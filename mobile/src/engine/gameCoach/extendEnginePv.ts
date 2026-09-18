import { Chess } from "chess.js";
import {
  boardMetricSnap,
  COACH_NOTE_REQUEST_CONFIG,
  engineLineSansBudget,
} from "./coachNoteRequest";

export function fenAfterUciPv(
  startFen: string,
  pvUci: string[]
): string | null {
  try {
    const board = new Chess(startFen);
    for (const uci of pvUci) {
      if (!uci || uci.length < 4) return null;
      const move = board.move({
        from: uci.slice(0, 2) as `${string}${string}`,
        to: uci.slice(2, 4) as `${string}${string}`,
        promotion: (uci[4] as "q" | "r" | "b" | "n" | undefined) || undefined,
      });
      if (!move) return null;
    }
    return board.fen();
  } catch {
    return null;
  }
}

/**
 * Cap PV at horizon; keep +1 spare ply only when leaf still has hanging material.
 */
export function trimPvToHorizon(
  startFen: string,
  pvUci: string[],
  horizon: number = engineLineSansBudget()
): string[] {
  const base = COACH_NOTE_REQUEST_CONFIG.engineLineHorizonMoves;
  let pv = [...pvUci];
  if (pv.length > base) {
    const leaf = fenAfterUciPv(startFen, pv.slice(0, base));
    if (leaf) {
      try {
        const snap = boardMetricSnap(new Chess(leaf), "white");
        if (
          snap.hanging_material_own === 0 &&
          snap.hanging_material_opponent === 0
        ) {
          pv = pv.slice(0, base);
        }
      } catch {
        /* keep spare */
      }
    }
  }
  return pv.slice(0, horizon);
}

export type ExtendPvEvaluate = (
  fen: string,
  depth?: number,
  multiPv?: number,
  movetimeMs?: number
) => Promise<{
  bestUci?: string | null;
  bestPv?: string[];
}>;

/**
 * Chain-search from PV leaf until horizon (async mobile / shared evaluate).
 */
export async function extendEnginePvUci(args: {
  fen: string;
  pvUci: string[];
  evaluate: ExtendPvEvaluate;
  depth: number;
  movetimeMs: number;
  horizon?: number;
  signal?: { cancelled?: boolean };
}): Promise<string[]> {
  const horizon = args.horizon ?? engineLineSansBudget();
  let pv = [...(args.pvUci || [])].filter(Boolean);
  for (let round = 0; round < 4; round += 1) {
    if (args.signal?.cancelled) break;
    if (pv.length >= horizon) break;
    const leaf = fenAfterUciPv(args.fen, pv);
    if (!leaf) break;
    const raw = await args.evaluate(
      leaf,
      args.depth,
      1,
      args.movetimeMs
    );
    const add =
      raw.bestPv?.length
        ? raw.bestPv
        : raw.bestUci
          ? [raw.bestUci]
          : [];
    if (!add.length) break;
    for (const u of add) {
      if (pv.length >= horizon) break;
      if (!u || pv[pv.length - 1] === u) continue;
      pv.push(u);
    }
  }
  return trimPvToHorizon(args.fen, pv, horizon);
}

/**
 * Sync batch extend (annotate CLI): given leaf FENs + extension PVs, merge.
 * Caller runs Stockfish; this only merges + trims.
 */
export function mergeExtendedPvs(args: {
  startFens: string[];
  positions: Array<{ bestPvUci: string[] }>;
  leafJobs: Array<{ index: number; addPv: string[] }>;
  horizon: number;
}): Array<{ bestPvUci: string[] }> {
  const out = args.positions.map((p) => ({
    bestPvUci: [...(p.bestPvUci || [])],
  }));
  for (const job of args.leafJobs) {
    const cur = out[job.index];
    if (!cur) continue;
    for (const u of job.addPv) {
      if (cur.bestPvUci.length >= args.horizon) break;
      cur.bestPvUci.push(u);
    }
  }
  for (let i = 0; i < out.length; i += 1) {
    const fen = args.startFens[i];
    if (!fen || !out[i]) continue;
    out[i]!.bestPvUci = trimPvToHorizon(
      fen,
      out[i]!.bestPvUci,
      args.horizon
    );
  }
  return out;
}
