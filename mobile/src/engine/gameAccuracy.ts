import { isMateScore } from "./winProb";

const CP_INITIAL = 15;
const CP_CEILING = 1000;
const WIN_CHANCE_K = -0.00368208;
const ACC_A = 103.1668100711649;
const ACC_K = 0.04354415386753951;
const ACC_B = -3.166924740191411;
const VOL_MIN = 0.5;
const VOL_MAX = 12;
const INACCURACY_WP_PP = 5;
const CP_INACCURACY_DROP = 150;
const CP_PER_WP_PP = CP_INACCURACY_DROP / INACCURACY_WP_PP;
const BAD_MOVE_ACC_SCALE = 0.7;

export type AccuracyPly = {
  side?: string;
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ceilCp(cp: number): number {
  if (isMateScore(cp)) return cp > 0 ? CP_CEILING : -CP_CEILING;
  return clamp(cp, -CP_CEILING, CP_CEILING);
}

export function lichessWinPercent(cpWhite: number): number {
  const chances = 2 / (1 + Math.exp(WIN_CHANCE_K * ceilCp(cpWhite))) - 1;
  return 50 + 50 * clamp(chances, -1, 1);
}

export function accuracyDropPp(
  winPctBefore: number,
  winPctAfter: number,
  cpDrop = 0
): number {
  const wpDrop = Math.max(0, winPctBefore - winPctAfter);
  const cpFloor = Math.max(0, cpDrop) / CP_PER_WP_PP;
  return Math.max(wpDrop, cpFloor);
}

export function lichessMoveAccuracyPct(
  winPctBefore: number,
  winPctAfter: number
): number {
  if (winPctAfter >= winPctBefore) return 100;
  const raw = ACC_A * Math.exp(-ACC_K * (winPctBefore - winPctAfter)) + ACC_B;
  return clamp(raw, 0, 100);
}

export function overlayMoveAccuracyPct(
  winPctBefore: number,
  winPctAfter: number,
  cpDrop = 0
): number {
  const drop = accuracyDropPp(winPctBefore, winPctAfter, cpDrop);
  if (drop <= 0) return 100;
  let acc = lichessMoveAccuracyPct(100, 100 - drop);
  if (drop >= INACCURACY_WP_PP) {
    acc = clamp(acc * BAD_MOVE_ACC_SCALE, 0, 100);
  }
  return acc;
}

function populationStdev(xs: number[]): number {
  if (!xs.length) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const varSum = xs.reduce((s, x) => s + (x - mean) ** 2, 0);
  return Math.sqrt(varSum / xs.length);
}

function harmonicMean(xs: number[]): number | null {
  if (!xs.length) return null;
  let inv = 0;
  for (const x of xs) {
    if (x <= 0) return 0;
    inv += 1 / x;
  }
  return xs.length / inv;
}

function weightedMean(pairs: Array<{ value: number; weight: number }>): number | null {
  let sum = 0;
  let wsum = 0;
  for (const p of pairs) {
    sum += p.value * p.weight;
    wsum += p.weight;
  }
  if (wsum <= 0) return null;
  return sum / wsum;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function cpSeries(plies: AccuracyPly[]): Array<number | null> {
  const start = plies[0]?.evalBeforeCp;
  const cps: Array<number | null> = [start == null ? CP_INITIAL : start];
  for (let i = 0; i < plies.length; i += 1) {
    const after = plies[i]?.evalAfterCp;
    if (after != null) {
      cps.push(after);
      continue;
    }
    const nextBefore = plies[i + 1]?.evalBeforeCp;
    cps.push(nextBefore ?? null);
  }
  return cps;
}

function slidingWindows<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length < size) return [];
  const out: T[][] = [];
  for (let i = 0; i + size <= items.length; i += 1) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function volatilityWeights(winPercents: Array<number | null>, nMoves: number): Array<number | null> {
  const windowSize = clamp(Math.floor(nMoves / 10), 2, 8);
  const first = winPercents.slice(0, Math.min(windowSize, winPercents.length));
  const pad = Math.max(0, Math.min(windowSize, winPercents.length) - 2);
  const windows = [
    ...Array.from({ length: pad }, () => first),
    ...slidingWindows(winPercents, windowSize),
  ];
  return windows.slice(0, nMoves).map((win) => {
    if (win.some((w) => w == null)) return null;
    return clamp(populationStdev(win as number[]), VOL_MIN, VOL_MAX);
  });
}

export function gameAccuracyForSide(
  plies: AccuracyPly[],
  side: "white" | "black"
): number | null {
  if (!plies.length) return null;
  const cps = cpSeries(plies);
  const winPercents = cps.map((cp) => (cp == null ? null : lichessWinPercent(cp)));
  const nMoves = Math.max(0, winPercents.length - 1);
  if (!nMoves) return null;
  const weights = volatilityWeights(winPercents, nMoves);

  const weighted: Array<{ value: number; weight: number }> = [];
  const accuracies: number[] = [];
  for (let i = 0; i < nMoves; i += 1) {
    const plySide = plies[i]?.side === "black" ? "black" : "white";
    if (plySide !== side) continue;
    const prev = winPercents[i];
    const next = winPercents[i + 1];
    const weight = weights[i];
    const prevCp = cps[i];
    const nextCp = cps[i + 1];
    if (prev == null || next == null || weight == null || prevCp == null || nextCp == null) {
      continue;
    }
    const cpDrop =
      side === "white"
        ? ceilCp(prevCp) - ceilCp(nextCp)
        : ceilCp(nextCp) - ceilCp(prevCp);
    const accuracy =
      side === "white"
        ? overlayMoveAccuracyPct(prev, next, cpDrop)
        : overlayMoveAccuracyPct(next, prev, cpDrop);
    accuracies.push(accuracy);
    weighted.push({ value: accuracy, weight });
  }
  if (!accuracies.length) return null;
  const volMean = weightedMean(weighted);
  const harm = harmonicMean(accuracies);
  if (volMean == null || harm == null) return null;
  return round1((volMean + harm) / 2);
}
