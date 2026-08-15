import type { DerivedCoachPack } from "./derivedCoachPack";

let cached: DerivedCoachPack | null = null;
let inflight: Promise<DerivedCoachPack> | null = null;

/**
 * Coach pack ships inside the app install (assets/coach/mobile_coach_pack.json).
 * Not Analytics cold load. Parsed once on first analyze, then held in memory.
 */
export async function loadCoachPack(): Promise<DerivedCoachPack> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = Promise.resolve().then(() => {
    const pack =
      require("../../../../assets/coach/mobile_coach_pack.json") as DerivedCoachPack;
    const entries = Array.isArray(pack?.entries) ? pack.entries : [];
    cached = {
      version: Number(pack?.version) || 0,
      generatedBy: String(pack?.generatedBy || ""),
      source: pack?.source,
      entryCount: Number(pack?.entryCount) || entries.length,
      entries,
    };
    return cached;
  });
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export function getCachedCoachPack(): DerivedCoachPack | null {
  return cached;
}
