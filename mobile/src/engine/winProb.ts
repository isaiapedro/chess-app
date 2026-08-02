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
export const WP_CRITICAL_DELTA = 0.15;
export const WP_ENDGAME_ADVANTAGE = 0.7;
export const WP_DRAWISH_LO = 0.45;
export const WP_DRAWISH_HI = 0.55;
export const WP_BLUNDER_DROP = 0.2;
export const DRAWISH_MIN_FULLMOVE = 40;
