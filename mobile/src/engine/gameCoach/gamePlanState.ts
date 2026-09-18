/**
 * Game-long plan preferences: opening + durable structures + conditional events.
 * Soft keys stick across plies; new situations reshuffle priority; tips teach
 * against that filter (mistakes still lead with immediate why_better / tactical).
 */

import type { DetectedSituation } from "./situationProfiles";
import { softKeysFromSituations } from "./situationProfiles";
import { themeTagToMetricKey } from "./metricThemes";

export const GAME_PLAN_KEY_CAP = 8;

/** Boost for sticky plan keys (below whyBetterPrimary ~28, near situationLock). */
export const GAME_PLAN_LOCK_BASE = 10;

/** Drop sticky soft key after this many consecutive user plies without a live source. */
export const GAME_PLAN_COLD_DEMOTE_PLIES = 3;

export type GamePlanState = {
  openingKeyId: string | null;
  /** Ordered preference: earlier = stronger plan lock. */
  stickyKeys: string[];
  /** Situation ids that last reshaped the plan. */
  situationIds: string[];
  /** Soft keys already used in a tip this game (diversity, not hard ban). */
  taughtKeys: string[];
  /** Consecutive user plies each sticky key was not live from situations/structure. */
  keyColdPlies: Record<string, number>;
};

export function emptyGamePlanState(
  openingKeyId?: string | null
): GamePlanState {
  const opening = openingKeyId || null;
  return {
    openingKeyId: opening,
    stickyKeys: opening ? [opening] : [],
    situationIds: [],
    taughtKeys: [],
    keyColdPlies: {},
  };
}

function uniqFront(keys: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= cap) break;
  }
  return out;
}

/** Map windowed structure theme tags → soft-key ids. */
export function softKeysFromStructureThemes(
  themes: string[] | null | undefined
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of themes || []) {
    const key = themeTagToMetricKey(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Seed / refresh from opening checkpoint soft keys (named opening first).
 */
export function mergeOpeningPlanKeys(
  state: GamePlanState,
  softKeys: string[] | null | undefined,
  openingKeyId?: string | null
): GamePlanState {
  const opening = openingKeyId || state.openingKeyId;
  const front = [
    ...(opening ? [opening] : []),
    ...(softKeys || []),
    ...state.stickyKeys,
  ];
  const stickyKeys = uniqFront(front, GAME_PLAN_KEY_CAP);
  const keyColdPlies = { ...state.keyColdPlies };
  if (opening) keyColdPlies[opening] = 0;
  for (const k of softKeys || []) keyColdPlies[k] = 0;
  return {
    ...state,
    openingKeyId: opening,
    stickyKeys,
    keyColdPlies,
  };
}

/**
 * Reshape sticky keys when Tier-1/2 situations fire (structures / events).
 * New situation soft keys rise to the front (after opening key).
 */
export function mergeSituationPlanKeys(
  state: GamePlanState,
  situations: DetectedSituation[] | null | undefined
): GamePlanState {
  const sits = situations || [];
  if (!sits.length) return state;
  const fromSit = softKeysFromSituations(sits);
  if (!fromSit.length) return state;
  const opening = state.openingKeyId;
  const front = [
    ...(opening ? [opening] : []),
    ...fromSit,
    ...state.stickyKeys.filter((k) => k !== opening),
  ];
  const keyColdPlies = { ...state.keyColdPlies };
  for (const k of fromSit) keyColdPlies[k] = 0;
  return {
    ...state,
    stickyKeys: uniqFront(front, GAME_PLAN_KEY_CAP),
    situationIds: [
      ...new Set([...sits.map((s) => s.id), ...state.situationIds]),
    ].slice(0, 6),
    keyColdPlies,
  };
}

/**
 * Merge windowed structure themes into sticky (same front-after-opening rule).
 */
export function mergeStructurePlanKeys(
  state: GamePlanState,
  structureThemes: string[] | null | undefined
): GamePlanState {
  const fromStruct = softKeysFromStructureThemes(structureThemes);
  if (!fromStruct.length) return state;
  const opening = state.openingKeyId;
  const front = [
    ...(opening ? [opening] : []),
    ...fromStruct,
    ...state.stickyKeys.filter((k) => k !== opening),
  ];
  const keyColdPlies = { ...state.keyColdPlies };
  for (const k of fromStruct) keyColdPlies[k] = 0;
  return {
    ...state,
    stickyKeys: uniqFront(front, GAME_PLAN_KEY_CAP),
    keyColdPlies,
  };
}

/**
 * Every user ply: merge live situations + windowed structures, then demote
 * sticky keys that stayed cold for GAME_PLAN_COLD_DEMOTE_PLIES plies.
 * Opening.* sticky only while phase is opening (or phase omitted for legacy).
 */
export function advanceGamePlan(
  state: GamePlanState,
  args: {
    situations?: DetectedSituation[] | null;
    structureThemes?: string[] | null;
    phase?: "opening" | "middlegame" | "endgame" | null;
  }
): GamePlanState {
  let next = mergeSituationPlanKeys(state, args.situations);
  next = mergeStructurePlanKeys(next, args.structureThemes);

  const keepOpening =
    args.phase == null || args.phase === "opening";
  const opening = keepOpening ? next.openingKeyId : null;
  const live = new Set([
    ...softKeysFromSituations(args.situations),
    ...softKeysFromStructureThemes(args.structureThemes),
  ]);
  const keyColdPlies: Record<string, number> = { ...next.keyColdPlies };

  let stickyBase = next.stickyKeys;
  if (!keepOpening) {
    stickyBase = stickyBase.filter((k) => !k.startsWith("opening."));
  }

  for (const k of stickyBase) {
    if ((opening && k === opening) || live.has(k)) {
      keyColdPlies[k] = 0;
    } else {
      keyColdPlies[k] = (keyColdPlies[k] || 0) + 1;
    }
  }
  for (const k of Object.keys(keyColdPlies)) {
    if (!stickyBase.includes(k)) delete keyColdPlies[k];
  }

  const stickyKeys = uniqFront(
    stickyBase.filter(
      (k) =>
        (opening && k === opening) ||
        (keyColdPlies[k] || 0) < GAME_PLAN_COLD_DEMOTE_PLIES
    ),
    GAME_PLAN_KEY_CAP
  );

  const situationIds = (args.situations?.length
    ? [
        ...new Set([
          ...args.situations.map((s) => s.id),
          ...next.situationIds,
        ]),
      ]
    : next.situationIds
  ).slice(0, 6);

  return {
    ...next,
    stickyKeys,
    situationIds,
    keyColdPlies,
  };
}

export function markPlanKeysTaught(
  state: GamePlanState,
  keyIds: string[] | null | undefined
): GamePlanState {
  if (!keyIds?.length) return state;
  const taught = [...state.taughtKeys];
  const seen = new Set(taught);
  for (const k of keyIds) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    taught.push(k);
  }
  return { ...state, taughtKeys: taught.slice(-16) };
}

/**
 * Additive weight when key is in the sticky plan.
 * Untaught plan keys get a small extra nudge so continuity surfaces.
 */
export function planLockBoostForKey(
  keyId: string,
  state: GamePlanState | null | undefined
): number {
  if (!state?.stickyKeys?.length || !keyId) return 0;
  const idx = state.stickyKeys.indexOf(keyId);
  if (idx < 0) return 0;
  const rank = Math.max(4, GAME_PLAN_LOCK_BASE - idx * 2);
  const untaught = state.taughtKeys.includes(keyId) ? 0 : 2;
  return rank + untaught;
}

export function formatGamePlanShort(
  state: GamePlanState | null | undefined
): string {
  if (!state?.stickyKeys?.length) return "";
  return state.stickyKeys.slice(0, 5).join(",");
}
