export function winProbabilityFromPawns(evalPawns: number): number {
  return 1.0 / (1.0 + 10.0 ** (-evalPawns / 4.0));
}

export function winProbabilityFromCp(cpWhiteUserPov: number): number {
  if (Math.abs(cpWhiteUserPov) >= 50000) {
    return cpWhiteUserPov > 0 ? 0.99 : 0.01;
  }
  return winProbabilityFromPawns(cpWhiteUserPov / 100);
}

export function userWinProbability(
  cpWhite: number,
  userIsWhite: boolean
): number {
  const userCp = userIsWhite ? cpWhite : -cpWhite;
  return winProbabilityFromCp(userCp);
}

export const WP_DISADVANTAGE = 0.2;
export const WP_CRITICAL_DELTA = 0.1;
export const WP_CRITICAL_CP = 1;
export const WP_ENDGAME_ADVANTAGE = 0.7;
export const WP_ENDGAME_ADVANTAGE_STICKY = 0.65;
export const CP_ENDGAME_ADVANTAGE_STICKY = 100;
export const WP_DRAWISH_LO = 0.45;
export const WP_DRAWISH_HI = 0.55;
export const WP_BLUNDER_DROP = 0.15;
export const WP_MISTAKE_DROP = 0.1;
export const WP_INACCURACY_DROP = 0.05;
export const WP_MISSED_OPP_DROP = WP_MISTAKE_DROP;
export const DRAWISH_MIN_FULLMOVE = 40;

export type EvalDropKind = "blunder" | "mistake" | "inaccuracy" | null;

export function wpDropPp(wpBefore: number, wpAfter: number): number {
  return Math.round((wpBefore - wpAfter) * 10000) / 100;
}

export function classifyEvalDrop(
  wpBefore: number,
  wpAfter: number
): EvalDropKind {
  const dropPp = wpDropPp(wpBefore, wpAfter);
  if (dropPp > 15) return "blunder";
  if (dropPp >= 10) return "mistake";
  if (dropPp >= 5) return "inaccuracy";
  return null;
}

export function isMistakeOrWorse(wpBefore: number, wpAfter: number): boolean {
  const kind = classifyEvalDrop(wpBefore, wpAfter);
  return kind === "blunder" || kind === "mistake";
}

export function isBlunderSwingUp(wpBefore: number, wpAfter: number): boolean {
  return wpDropPp(wpBefore, wpAfter) < -15;
}

export function normalizeGameResult(
  result: string | null | undefined,
  userIsWhite: boolean
): "Win" | "Draw" | "Loss" | "" {
  const r = String(result || "").trim();
  if (r === "Win" || r === "Draw" || r === "Loss") return r;
  if (r === "1-0") return userIsWhite ? "Win" : "Loss";
  if (r === "0-1") return userIsWhite ? "Loss" : "Win";
  if (r === "1/2-1/2" || r === "½-½" || r.toLowerCase() === "draw") {
    return "Draw";
  }
  return "";
}
