export function middlegameStartPly(phaseEndFullmove: number): number {
  return phaseEndFullmove * 2;
}

export function inMiddlegamePly(
  plyIdx: number,
  phaseEndFullmove: number,
  endgameStartPly: number | null
): boolean {
  const start = middlegameStartPly(phaseEndFullmove);
  if (plyIdx < start) return false;
  if (endgameStartPly != null && plyIdx >= endgameStartPly) return false;
  return true;
}
