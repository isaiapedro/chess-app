import type { DerivedCoachEntry, DerivedCoachPack } from "./derivedCoachPack";

let cached: DerivedCoachPack | null = null;
let byKey: Map<string, DerivedCoachEntry> | null = null;
let inflight: Promise<DerivedCoachPack> | null = null;

const CANON_KEY =
  /^(structure|opening|endgame|imbalance|positional|piece|motif|attack|methodology)\./;

function indexByKey(entries: DerivedCoachEntry[]): Map<string, DerivedCoachEntry> {
  const map = new Map<string, DerivedCoachEntry>();
  for (const entry of entries) {
    const keyId = entry.keyId || entry.id || "";
    if (!keyId || !CANON_KEY.test(keyId)) continue;
    if (!map.has(keyId)) map.set(keyId, entry);
  }
  return map;
}

/**
 * Coach pack ships inside the app install (assets/coach/mobile_coach_pack.json).
 * Canon soft-keys only (structure|opening|endgame|…). No theme/eco/template cards.
 * Not Analytics cold load. Parsed once on first analyze, then held in memory.
 * Tip pick uses getCoachPackEntriesByKeys — not a full entries scan.
 */
export async function loadCoachPack(): Promise<DerivedCoachPack> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = Promise.resolve().then(() => {
    const pack =
      require("../../../assets/coach/mobile_coach_pack.json") as DerivedCoachPack;
    const raw = Array.isArray(pack?.entries) ? pack.entries : [];
    const entries = raw.filter((e) => CANON_KEY.test(e.keyId || ""));
    cached = {
      version: Number(pack?.version) || 0,
      generatedBy: String(pack?.generatedBy || ""),
      source: pack?.source,
      entryCount: entries.length,
      entries,
    };
    byKey = indexByKey(entries);
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

export function getCoachPackByKey(): Map<string, DerivedCoachEntry> | null {
  return byKey;
}

/** Exact soft-key hits first; family fallback only when no exact match. */
export function getCoachPackEntriesByKeys(
  keyIds: readonly string[]
): DerivedCoachEntry[] {
  if (!byKey?.size || !keyIds.length) return [];
  const exact: DerivedCoachEntry[] = [];
  const seen = new Set<string>();
  for (const raw of keyIds) {
    const keyId = String(raw || "").trim();
    if (!keyId || seen.has(keyId)) continue;
    const hit = byKey.get(keyId);
    if (!hit) continue;
    seen.add(keyId);
    exact.push(hit);
  }
  if (exact.length) return exact;

  const families = new Set(
    keyIds.map((k) => String(k || "").split(".")[0] || "").filter(Boolean)
  );
  if (!families.size) return [];
  const out: DerivedCoachEntry[] = [];
  for (const [keyId, entry] of byKey) {
    const fam = keyId.split(".")[0] || "";
    if (!families.has(fam) || seen.has(keyId)) continue;
    seen.add(keyId);
    out.push(entry);
  }
  return out;
}
