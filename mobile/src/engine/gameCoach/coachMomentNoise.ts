import { isMateScore } from "../winProb";

export function isPreMoveMateLock(
  evalBeforeCp: number | null | undefined
): boolean {
  return evalBeforeCp != null && isMateScore(evalBeforeCp);
}

function stillSameSideMate(
  evalBeforeCp: number,
  evalAfterCp: number | null | undefined
): boolean {
  if (evalAfterCp == null) return true;
  return (
    isMateScore(evalAfterCp) && Math.sign(evalAfterCp) === Math.sign(evalBeforeCp)
  );
}

/**
 * Drop already-decided mate conversions and non-deviations.
 * Keep live mistakes/blunders — including equal → mate-in-N hangs.
 * Keep lost mates (had mate, played off the mating line).
 */
export function shouldDropNoiseCoachMoment(m: {
  structuralKind?: string | null;
  inputs?: { praise_mark?: unknown } | null;
  severity?: string | null;
  source?: string | null;
  evalBeforeCp?: number | null;
  evalAfterCp?: number | null;
  playedSan?: string | null;
  bestSan?: string | null;
}): boolean {
  if (m.structuralKind || m.inputs?.praise_mark) return false;
  if (isPreMoveMateLock(m.evalBeforeCp)) {
    if (
      m.playedSan &&
      m.bestSan &&
      m.playedSan !== m.bestSan &&
      !stillSameSideMate(m.evalBeforeCp!, m.evalAfterCp)
    ) {
      return false;
    }
    return true;
  }
  if (m.severity && m.source === "live") return false;
  if (m.playedSan && m.bestSan && m.playedSan === m.bestSan) return true;
  return false;
}
