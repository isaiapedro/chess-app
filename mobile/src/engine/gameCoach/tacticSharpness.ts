import { userWinProbability } from "../winProb";

export const SHARP_FORCING_RATIO = 0.5;
export const SHARP_PV_GAP_WP = 0.05;
export const IMPORTANT_PV_GAP = SHARP_PV_GAP_WP;
const FORCING_RATIO_HORIZON = 8;

function isForceSan(san: string): boolean {
  return /[+#]$/.test(san);
}

export function forcingRatio(
  pvSan: string[],
  horizon = FORCING_RATIO_HORIZON
): number {
  const moves = pvSan.filter(Boolean).slice(0, horizon);
  if (!moves.length) return 0;
  let force = 0;
  for (const san of moves) {
    if (isForceSan(san)) force += 1;
  }
  return Math.round((force / moves.length) * 100) / 100;
}

export function multipvWpGap(
  lines: { cpWhite: number }[] | undefined,
  side: "white" | "black"
): number {
  if (!lines || lines.length < 2) return 0;
  const userIsWhite = side === "white";
  const wp1 = userWinProbability(lines[0]!.cpWhite, userIsWhite);
  const wp2 = userWinProbability(lines[1]!.cpWhite, userIsWhite);
  return Math.round(Math.max(0, wp1 - wp2) * 1000) / 1000;
}

export function stmScoreFromWhiteCp(fen: string, cpWhite: number): number {
  return fen.split(" ")[1] === "b" ? -cpWhite : cpWhite;
}

export function rankLinesByStm<T extends { cpWhite: number }>(
  fen: string,
  lines: T[]
): T[] {
  return [...lines].sort(
    (a, b) =>
      stmScoreFromWhiteCp(fen, b.cpWhite) - stmScoreFromWhiteCp(fen, a.cpWhite)
  );
}

export function mergeMultiPvGapLines<T extends { san: string; cpWhite?: number }>(
  shallow: T[] | undefined,
  deep: T[] | undefined,
  fen?: string
): T[] {
  const a = shallow?.length ? shallow : [];
  const b = deep?.length ? deep : [];
  let merged: T[];
  if (b.length >= 2) merged = b;
  else if (a.length < 2) merged = b.length ? b : a;
  else {
    const pv1 = b[0];
    if (!pv1) merged = a;
    else {
      const rest = a.filter((l) => l.san !== pv1.san).slice(0, 2);
      merged = rest.length ? [pv1, ...rest] : b.length ? b : a;
    }
  }
  if (!fen || merged.some((l) => l.cpWhite == null || !Number.isFinite(l.cpWhite))) {
    return merged;
  }
  return rankLinesByStm(
    fen,
    merged as Array<T & { cpWhite: number }>
  );
}

export type TacticSharpness = {
  pvGapWp: number;
  forcingRatio: number;
  sharp: boolean;
  forcingSharp: boolean;
};

export function measureTacticSharpness(args: {
  pvSan?: string[] | null;
  lines?: { cpWhite: number }[] | null;
  side: "white" | "black";
}): TacticSharpness {
  const pvSan = args.pvSan || [];
  const pvGapWp = multipvWpGap(args.lines || undefined, args.side);
  const ratio = forcingRatio(pvSan);
  const first = pvSan[0] || "";
  const forcingSharp = ratio >= SHARP_FORCING_RATIO || isForceSan(first);
  return {
    pvGapWp,
    forcingRatio: ratio,
    forcingSharp,
    sharp: forcingSharp,
  };
}

export function tacticSharpnessInputs(
  sharp: TacticSharpness | null | undefined
): Record<string, number> {
  if (!sharp) return {};
  return {
    tactical_pv_gap_wp: sharp.pvGapWp,
    tactical_forcing_ratio: sharp.forcingRatio,
    tactical_sharp: sharp.sharp ? 1 : 0,
  };
}
