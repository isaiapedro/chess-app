/**
 * Soft-key weight math for metric-driven coach notes (FEN-free).
 * Node-safe — no React Native. Used by metricNotes + annotate_metrics_pgn.
 */

import type { DerivedCoachEntry } from "./derivedCoachPack";
import type { CoachGameMetrics, CoachMetricMoment } from "./coachGameMetrics";
import { detectOpeningFamily } from "./structureDetect";
import type { CoachNoteRequest } from "./coachNoteRequest";
import {
  isPraiseMark,
  isFixedCheckpointMoment,
  requestAlwaysAttaches,
} from "./coachNoteRequest";
import {
  explainEngineLineVsPlayed,
  type MetricSignal,
} from "./engineLineExplain";
import {
  keysForCoachInputs,
  keysForMetricDeltas,
  softKeysForNoteRequest,
} from "./metricNoteKeys";
import {
  softKeysFromOpeningPeerGaps,
} from "./openingCoachInputs";
import { softKeysFromMiddlegamePeerGaps } from "./middlegameCoachInputs";
import { softKeysFromMgStructure } from "./middlegameStructure";
import { softKeysFromEndgameContext } from "./endgameContext";
import {
  PHASE_METRIC_KEYS,
  themeTagToMetricKey,
} from "./metricThemes";
import { situationLockBoostForKey } from "./situationProfiles";
import {
  planLockBoostForKey,
  type GamePlanState,
} from "./gamePlanState";
import { tacticalLockBoostForKey } from "./tacticalFact";

export type PhaseName = "opening" | "middlegame" | "endgame";

export type MetricCoachMark =
  | "book"
  | "best"
  | "important"
  | "excellent"
  | "good"
  | "brilliant"
  | "missed"
  | "inaccuracy"
  | "mistake"
  | "blunder";

const CANON_KEY =
  /^(structure|opening|endgame|imbalance|positional|piece|motif|attack|methodology)\./;

const ERROR_MARKS = new Set<MetricCoachMark>([
  "blunder",
  "mistake",
  "missed",
]);

const TACTICAL_FAMILIES = new Set([
  "motif",
  "attack",
  "methodology",
]);

export const STRUCTURE_THEMES = new Set([
  "iqp",
  "doubled_pawns",
  "hanging_pawns",
  "pawn_chain",
  "passed_pawn",
  "open_file",
  "space",
  "bishop_pair",
  "outpost",
  "sacrifice",
  "lucena",
  "philidor",
  "vancura",
  "fortress",
  "opposite_bishops",
  "active_king",
  "pawn_break",
  "simplification",
  "closed_center",
  "opposite_side_castling",
  "maroczy_bind",
  "carlsbad",
  "minority_attack",
  "caro_slav",
  "hedgehog",
  "scheveningen",
  "dragon_formation",
  "pawn_storm",
  "knight_vs_bishop",
  "good_vs_bad_bishop",
]);

/** Minimum weight for pickMetricTip to accept a pack key. */
export const METRIC_TIP_MIN_WEIGHT = 4;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keyFamily(keyId: string): string {
  return (keyId || "").split(".")[0] || "";
}

function keyTail(keyId: string): string {
  const parts = (keyId || "").split(".");
  return parts[parts.length - 1] || keyId;
}

function whyBetterContext(request?: CoachNoteRequest | null): {
  primarySoftKeys: string[];
  primarySoftHint: string | null;
  primaryField: string | null;
  metricSignals: MetricSignal[];
} {
  if (
    !request ||
    (!request.engineVsPlayedMetricDelta?.length &&
      !request.engineLineMetricDelta?.length)
  ) {
    return {
      primarySoftKeys: [],
      primarySoftHint: null,
      primaryField: null,
      metricSignals: [],
    };
  }
  const explained = explainEngineLineVsPlayed({
    engineVsPlayedMetricDelta: request.engineVsPlayedMetricDelta,
    engineLineMetricDelta: request.engineLineMetricDelta,
    playedLineMetricDelta: request.playedLineMetricDelta,
    phase: request.phase,
  });
  return {
    primarySoftKeys: explained.primarySoftKeys,
    primarySoftHint: explained.primarySoftHint,
    primaryField: explained.primaryField,
    metricSignals: explained.metricSignals,
  };
}

function kingSafetySupportedBySignals(signals: MetricSignal[]): boolean {
  for (const s of signals) {
    if (
      s.field === "opp_king_attackers_pct" &&
      s.polarity === "betterForEngine"
    ) {
      return true;
    }
    if (
      s.field === "king_attackers_pct" &&
      s.polarity === "betterForEngine"
    ) {
      return true;
    }
  }
  return false;
}

function gameOpeningTags(
  eco?: string | null,
  opening?: string | null,
  themes?: string[]
): string[] {
  return [
    ...detectOpeningFamily(eco, opening),
    ...(themes || []).filter((t) => t.startsWith("opening_")),
  ];
}

function entryClaimedOpeningTags(entry: DerivedCoachEntry): string[] {
  const kid = entry.keyId || "";
  const out: string[] = [];
  if (kid.startsWith("opening.")) {
    out.push(`opening_${keyTail(kid)}`);
  }
  for (const t of entry.themes || []) {
    if (t.startsWith("opening_") || t.startsWith("opening.")) out.push(t);
  }
  return out.map(norm);
}

function openingFamilyConflict(
  entry: DerivedCoachEntry,
  eco?: string | null,
  opening?: string | null,
  themes?: string[]
): boolean {
  const game = gameOpeningTags(eco, opening, themes).map(norm);
  if (!game.length) return false;
  const claimed = entryClaimedOpeningTags(entry);
  if (!claimed.length) return false;
  return !claimed.some((t) =>
    game.some((g) => g === t || g.includes(t) || t.includes(g))
  );
}

function themeHitsKey(keyId: string, themes: string[]): number {
  const kid = norm(keyId);
  const tail = norm(keyTail(keyId));
  let best = 0;
  for (const t of themes) {
    const key = norm(t);
    if (!key || key.length < 3) continue;
    const underscored = key.replace(/\s+/g, "_");
    if (kid === key || kid === underscored) {
      best = Math.max(best, 16);
    } else if (kid === `opening.${underscored}` || kid.endsWith(`.${underscored}`)) {
      best = Math.max(best, 14);
    } else if (tail === key || tail === underscored) {
      best = Math.max(best, 12);
    } else if (kid.includes(underscored) || underscored.includes(tail)) {
      best = Math.max(best, 4);
    }
  }
  return best;
}

export type WeightPart = { label: string; delta: number };

export type KeyWeightBreakdown = {
  keyId: string;
  weight: number;
  parts: WeightPart[];
};

/**
 * Score one soft key for the current ply context.
 * Returns total + additive parts (for annotate dump / debugging).
 */
export function weightKeyBreakdown(args: {
  keyId: string;
  entry?: DerivedCoachEntry | null;
  phase: PhaseName;
  themes: string[];
  mark: MetricCoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  openingKeyId?: string | null;
  eco?: string | null;
  opening?: string | null;
  request?: CoachNoteRequest | null;
  gamePlan?: GamePlanState | null;
}): KeyWeightBreakdown {
  const keyId = args.keyId;
  const parts: WeightPart[] = [];
  const zero = (): KeyWeightBreakdown => ({ keyId, weight: 0, parts });

  if (!CANON_KEY.test(keyId)) return zero();

  const tactKind = args.request?.tacticalFact?.kind || null;
  const tacticalGate =
    args.request?.kind === "bad_move" || Boolean(tactKind);
  if (tacticalGate && keyId.startsWith("endgame.")) {
    parts.push({ label: "tacticalSuppressEg", delta: -999 });
    return { keyId, weight: -999, parts };
  }
  if (tacticalGate && keyId.startsWith("positional.")) {
    parts.push({ label: "tacticalSuppressGeneric", delta: -999 });
    return { keyId, weight: -999, parts };
  }

  if (args.entry) {
    if (
      openingFamilyConflict(
        args.entry,
        args.eco,
        args.opening,
        args.themes
      )
    ) {
      parts.push({ label: "openingFamilyConflict", delta: 0 });
      return zero();
    }
  }

  let w = 0;
  const themeHit = themeHitsKey(keyId, args.themes);
  if (themeHit) {
    w += themeHit;
    parts.push({ label: `themeHit`, delta: themeHit });
  }

  if (
    args.phase === "opening" &&
    args.openingKeyId &&
    keyId === args.openingKeyId
  ) {
    w += 12;
    parts.push({ label: "openingKeyLock", delta: 12 });
  }

  if (
    (args.request?.kind === "fixed_checkpoint" ||
      args.request?.kind === "structural_moment") &&
    args.request.structuralKind === "opening_name" &&
    args.openingKeyId &&
    keyId === args.openingKeyId
  ) {
    w += 8;
    parts.push({ label: "fixedCheckpointOpening", delta: 8 });
  }

  if (
    (args.request?.kind === "fixed_checkpoint" ||
      args.request?.kind === "structural_moment") &&
    (args.request.structuralKind === "opening_name" ||
      args.request.structuralKind === "opening_aggregate")
  ) {
    const peerGaps = softKeysFromOpeningPeerGaps(args.request.inputs);
    const gapIdx = peerGaps.indexOf(keyId);
    if (gapIdx >= 0) {
      const boost = Math.max(6, 16 - gapIdx * 2);
      w += boost;
      parts.push({ label: "openingPeerJudgment", delta: boost });
    }
    if (keyId === "piece.coordination") {
      w -= 10;
      parts.push({ label: "openingDownrankCoordination", delta: -10 });
    }
    if (
      args.openingKeyId &&
      (keyId === "imbalance.space" ||
        keyId === "piece.centralization" ||
        keyId === "attack.king_safety")
    ) {
      w -= 14;
      parts.push({ label: "openingDownrankFiller", delta: -14 });
    }
  }

  if (args.phase === "middlegame" && args.request) {
    const peerGaps = softKeysFromMiddlegamePeerGaps(args.request.inputs);
    const structKeys = softKeysFromMgStructure(args.request.inputs);
    const onAggregate =
      args.request.structuralKind === "middlegame_aggregate";
    if (onAggregate || peerGaps.length > 0) {
      const gapIdx = peerGaps.indexOf(keyId);
      if (gapIdx >= 0) {
        const boost = Math.max(6, 16 - gapIdx * 2);
        w += boost;
        parts.push({ label: "middlegamePeerJudgment", delta: boost });
      }
      if (
        keyId === "attack.initiative" &&
        peerGaps.length &&
        !peerGaps.includes(keyId)
      ) {
        w -= 8;
        parts.push({ label: "mgDownrankGenericInitiative", delta: -8 });
      }
    }
    const evalBand = String(args.request.inputs?.eval_band || "");
    if (
      onAggregate &&
      (evalBand === "winning" || evalBand === "better")
    ) {
      if (keyId === "piece.simplification") {
        w += 18;
        parts.push({ label: "mgWinningSimplification", delta: 18 });
      }
      if (
        keyId === "attack.initiative" ||
        keyId === "positional.pawn_break"
      ) {
        w -= 14;
        parts.push({ label: "mgWinningDownrankAttackPlan", delta: -14 });
      }
    }
    const sIdx = structKeys.indexOf(keyId);
    if (sIdx >= 0) {
      const boost = Math.max(5, 14 - sIdx * 2);
      w += boost;
      parts.push({ label: "mgStructureVector", delta: boost });
    }
  }

  if (args.phase === "endgame" && args.request) {
    const egKeys = softKeysFromEndgameContext(args.request.inputs);
    const eIdx = egKeys.indexOf(keyId);
    if (eIdx >= 0) {
      const boost = Math.max(6, 16 - eIdx * 2);
      w += boost;
      parts.push({ label: "endgameTechnique", delta: boost });
    }
    if (
      keyId === "attack.initiative" &&
      egKeys.length &&
      !egKeys.includes(keyId)
    ) {
      w -= 10;
      parts.push({ label: "egDownrankGenericInitiative", delta: -10 });
    }
  }

  if (args.themes.includes("sacrifice") && keyId === "motif.sacrifice") {
    w += 10;
    parts.push({ label: "sacrificeTheme", delta: 10 });
  }

  const family = keyFamily(keyId);

  if (args.request) {
    const metricKeys = [
      ...keysForCoachInputs(
        args.request.inputs,
        args.request.structuralKind
      ),
      ...keysForMetricDeltas(args.request.playedMetricDelta || []),
      ...keysForMetricDeltas(args.request.playedLineMetricDelta || []),
      ...keysForMetricDeltas(args.request.engineLineMetricDelta || []),
      ...keysForMetricDeltas(args.request.engineVsPlayedMetricDelta || []),
    ];
    if (metricKeys.includes(keyId)) {
      w += 16;
      parts.push({ label: "metricInputKey", delta: 16 });
    } else if (metricKeys.some((k) => k.split(".")[0] === family)) {
      w += 6;
      parts.push({ label: "metricInputFamily", delta: 6 });
    }

    const why = whyBetterContext(args.request);
    if (why.primarySoftKeys.includes(keyId)) {
      w += 28;
      parts.push({ label: "whyBetterPrimary", delta: 28 });
    } else if (why.primarySoftKeys.length) {
      const primaryFamily = why.primarySoftKeys[0]?.split(".")[0];
      if (primaryFamily && family === primaryFamily) {
        w += 10;
        parts.push({ label: "whyBetterFamily", delta: 10 });
      }
      if (
        keyId === "attack.king_safety" &&
        why.primarySoftHint !== "king_safety" &&
        !kingSafetySupportedBySignals(why.metricSignals)
      ) {
        w -= 22;
        parts.push({ label: "whyBetterDownrankKingSafety", delta: -22 });
      } else if (
        why.primarySoftHint &&
        why.primarySoftHint !== "king_safety" &&
        !why.primarySoftKeys.includes(keyId) &&
        family === "attack" &&
        why.primaryField === "mobility"
      ) {
        w -= 8;
        parts.push({ label: "whyBetterDownrankUnrelatedAttack", delta: -8 });
      }
    }

    if (
      args.phase === "opening" &&
      (args.request.inputs?.played_tempo_waste === true ||
        args.request.inputs?.played_tempo_waste === 1)
    ) {
      if (
        keyId === "piece.centralization" ||
        keyId === "methodology.candidate_moves"
      ) {
        w += 18;
        parts.push({ label: "openingTempoWaste", delta: 18 });
      }
      if (keyId === "piece.coordination") {
        w -= 14;
        parts.push({ label: "openingTempoDownrankCoordination", delta: -14 });
      }
    }
  }

  const sitBoost = situationLockBoostForKey(
    keyId,
    args.request?.situations
  );
  if (sitBoost > 0) {
    w += sitBoost;
    parts.push({ label: "situationLock", delta: sitBoost });
  }

  const tactBoost = tacticalLockBoostForKey(
    keyId,
    args.request?.tacticalFact
  );
  if (tactBoost > 0) {
    w += tactBoost;
    parts.push({ label: "tacticalLock", delta: tactBoost });
  }

  const planBoost = planLockBoostForKey(keyId, args.gamePlan);
  if (planBoost > 0) {
    w += planBoost;
    parts.push({ label: "gamePlanLock", delta: planBoost });
  }

  if (
    (args.request?.kind === "fixed_checkpoint" ||
      args.request?.kind === "structural_moment") &&
    args.request.structuralKind === "decisive_pawn_break" &&
    (keyId === "positional.pawn_break" ||
      keyId === "endgame.strategic.pawn_break" ||
      family === "opening" ||
      family === "structure")
  ) {
    w += 10;
    parts.push({ label: "decisivePawnBreak", delta: 10 });
  }

  if (
    (args.request?.kind === "fixed_checkpoint" ||
      args.request?.kind === "structural_moment") &&
    args.request.structuralKind === "opponent_mistake" &&
    (family === "methodology" ||
      family === "motif" ||
      family === "attack" ||
      keyId === "methodology.candidate_moves")
  ) {
    w += 10;
    parts.push({ label: "opponentMistakeEngine", delta: 10 });
  }

  if (
    args.request?.kind === "praise_move" &&
    (family === "motif" ||
      family === "methodology" ||
      family === "attack" ||
      family === "positional")
  ) {
    w += 8;
    parts.push({ label: "praiseMove", delta: 8 });
  }

  if (
    args.mark &&
    ERROR_MARKS.has(args.mark) &&
    TACTICAL_FAMILIES.has(family)
  ) {
    w += 8;
    parts.push({ label: "errorTacticalFamily", delta: 8 });
  }
  if (args.deltaCp >= 100 && TACTICAL_FAMILIES.has(family)) {
    w += 4;
    parts.push({ label: "deltaCpTactical", delta: 4 });
  }
  if (
    args.request?.inputs?.tactical_sharp &&
    TACTICAL_FAMILIES.has(family)
  ) {
    w += 6;
    parts.push({ label: "tacticalSharp", delta: 6 });
  }

  if (args.request?.kind === "bad_move") {
    const hangRise = args.request.playedMetricDelta.some(
      (d) =>
        d.field === "hanging_material_own" && (d.delta ?? 0) > 0
    );
    const engineFixesHang = args.request.engineLineMetricDelta.some(
      (d) =>
        d.field === "hanging_material_opponent" && (d.delta ?? 0) > 0
    );
    if (hangRise && (family === "motif" || family === "attack")) {
      w += 6;
      parts.push({ label: "badMoveHangingRise", delta: 6 });
    }
    if (engineFixesHang && (family === "motif" || family === "methodology")) {
      w += 4;
      parts.push({ label: "engineLineThreatGain", delta: 4 });
    }
  }

  const kind = args.moment?.candidateKind;
  if (kind === "opening" && (family === "opening" || family === "positional")) {
    w += 6;
    parts.push({ label: "openingCandidate", delta: 6 });
  }
  if (
    kind === "mistake" &&
    (family === "motif" || family === "attack" || family === "piece")
  ) {
    w += 6;
    parts.push({ label: "mistakeCandidate", delta: 6 });
  }

  if (w > 0 && !tacticalGate) {
    w += 2;
    parts.push({ label: "phaseThemeBagSoft", delta: 2 });
  } else if (args.themes.length && themeHit === 0 && args.entry) {
    const bag = [
      ...(args.entry.themes || []),
      ...(args.entry.motifs || []),
      args.entry.label || "",
    ]
      .join(" ")
      .toLowerCase();
    for (const t of args.themes) {
      if (t.length >= 4 && bag.includes(t.replace(/_/g, " "))) {
        w += 4;
        parts.push({ label: "labelMotifBag", delta: 4 });
        break;
      }
    }
  }

  if (family === "endgame" && args.phase === "endgame" && !tacticalGate) {
    w += 3;
    parts.push({ label: "endgamePhase", delta: 3 });
  }
  if (
    !tacticalGate &&
    args.themes.some((t) =>
      ["lucena", "philidor", "vancura", "fortress"].includes(t)
    ) &&
    keyId.startsWith("endgame.theoretical.")
  ) {
    w += 3;
    parts.push({ label: "theoreticalEndgame", delta: 3 });
  }

  return { keyId, weight: w, parts };
}

export function weightKeyForMoment(args: {
  entry: DerivedCoachEntry;
  phase: PhaseName;
  themes: string[];
  mark: MetricCoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  openingKeyId?: string | null;
  eco?: string | null;
  opening?: string | null;
  request?: CoachNoteRequest | null;
  gamePlan?: GamePlanState | null;
}): number {
  const keyId = args.entry.keyId || args.entry.id || "";
  return weightKeyBreakdown({
    ...args,
    keyId,
    entry: args.entry,
  }).weight;
}

/** Theme → illustrative soft-key ids scored when pack is absent (annotate dump). */
function illustrativeKeysForThemes(
  themes: string[],
  phase: PhaseName
): string[] {
  const keys: string[] = [];
  for (const t of themes) {
    const mapped = themeTagToMetricKey(t);
    if (mapped) keys.push(mapped);
  }
  if (!keys.length) {
    keys.push(...PHASE_METRIC_KEYS[phase]);
  }
  return [...new Set(keys)];
}

/**
 * Rank soft keys for a ply — metric-request pool first (annotate / debug).
 * Falls back to theme-illustrative keys only when no request keys exist.
 */
export function rankMetricNoteWeights(args: {
  phase: PhaseName;
  themes: string[];
  mark: MetricCoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  openingKeyId?: string | null;
  eco?: string | null;
  opening?: string | null;
  limit?: number;
  request?: CoachNoteRequest | null;
  gamePlan?: GamePlanState | null;
}): KeyWeightBreakdown[] {
  const fromRequest = softKeysForNoteRequest({
    structuralKind:
      args.request?.structuralKind || args.moment?.structuralKind,
    inputs: args.request?.inputs || args.moment?.inputs,
    playedMetricDelta: args.request?.playedMetricDelta,
    playedLineMetricDelta: args.request?.playedLineMetricDelta,
    engineLineMetricDelta: args.request?.engineLineMetricDelta,
    engineVsPlayedMetricDelta: args.request?.engineVsPlayedMetricDelta,
    kind: args.request?.kind,
    openingKeyId: args.openingKeyId,
    phase: args.phase,
    phaseMetricKeys: args.themes,
    situations: args.request?.situations,
    planKeys: args.gamePlan?.stickyKeys,
    tacticalFact: args.request?.tacticalFact,
    deltaCp: args.deltaCp,
  });
  const keys = fromRequest.length
    ? fromRequest
    : illustrativeKeysForThemes(args.themes, args.phase);
  if (
    args.phase === "opening" &&
    args.openingKeyId &&
    !keys.includes(args.openingKeyId)
  ) {
    keys.unshift(args.openingKeyId);
  }
  return [...new Set(keys)]
    .map((keyId) =>
      weightKeyBreakdown({
        keyId,
        phase: args.phase,
        themes: args.themes,
        mark: args.mark,
        deltaCp: args.deltaCp,
        moment: args.moment,
        openingKeyId: args.openingKeyId,
        eco: args.eco,
        opening: args.opening,
        request: args.request,
        gamePlan: args.gamePlan,
      })
    )
    .filter(
      (r) =>
        r.weight >= METRIC_TIP_MIN_WEIGHT ||
        (fromRequest.includes(r.keyId) && r.weight > -500)
    )
    .map((r) =>
      fromRequest.includes(r.keyId) &&
      r.weight < METRIC_TIP_MIN_WEIGHT &&
      r.weight > -500
        ? {
            ...r,
            weight: METRIC_TIP_MIN_WEIGHT,
            parts: [...r.parts, { label: "metricKeyPool", delta: METRIC_TIP_MIN_WEIGHT }],
          }
        : r
    )
    .sort((a, b) => b.weight - a.weight || a.keyId.localeCompare(b.keyId))
    .slice(0, args.limit ?? 5);
}

export function formatWeightBreakdown(row: KeyWeightBreakdown): string {
  const parts = row.parts
    .filter((p) => p.delta)
    .map((p) =>
      p.delta > 0
        ? `${p.label}+${p.delta}`
        : `${p.label}${p.delta}`
    )
    .join(",");
  return `${row.keyId}=${row.weight}${parts ? `(${parts})` : ""}`;
}

export function explainAttachMetricTip(args: {
  phase: PhaseName;
  moment?: CoachMetricMoment | null;
  mark: MetricCoachMark | null;
  deltaCp: number;
  phaseThemes: string[];
  structureThemeUsed?: Set<string>;
  /** Prefer request-driven attach when present. */
  request?: CoachNoteRequest | null;
}): { attach: boolean; reasons: string[] } {
  if (args.mark === "inaccuracy") {
    const always =
      (args.request != null && requestAlwaysAttaches(args.request.kind)) ||
      isFixedCheckpointMoment(args.moment);
    if (!always) {
      return { attach: false, reasons: ["skipInaccuracy"] };
    }
  }

  const praiseMark = String(args.moment?.inputs?.praise_mark || "");
  const quietPraise =
    args.moment &&
    praiseMark &&
    praiseMark !== "brilliant" &&
    praiseMark !== "excellent" &&
    !args.moment.structuralKind;
  if (quietPraise && !ERROR_MARKS.has(args.mark || ("" as MetricCoachMark))) {
    return { attach: false, reasons: ["skipQuietPraise"] };
  }

  const reasons: string[] = [];
  if (args.request) {
    if (requestAlwaysAttaches(args.request.kind)) {
      reasons.push(`request=${args.request.kind}`);
    }
    if (args.request.kind === "bad_move") {
      reasons.push("bad_move");
      if (args.request.playedMetricDelta.length) {
        reasons.push(`playedΔn=${args.request.playedMetricDelta.length}`);
      }
      if (args.request.engineLineMetricDelta.length) {
        reasons.push(`engineΔn=${args.request.engineLineMetricDelta.length}`);
      }
      if (args.request.engineVsPlayedMetricDelta.length) {
        reasons.push(
          `engineVsPlayedΔn=${args.request.engineVsPlayedMetricDelta.length}`
        );
      }
      if (args.request.inputs?.why_better) {
        reasons.push("why_better");
      }
    } else {
      if (args.request.playedMetricDelta.length) {
        reasons.push(`playedΔn=${args.request.playedMetricDelta.length}`);
      }
      if (args.request.engineLineMetricDelta.length) {
        reasons.push(`engineΔn=${args.request.engineLineMetricDelta.length}`);
      }
    }
    if (args.request.structuralKind) {
      reasons.push(`structural=${args.request.structuralKind}`);
    }
    return { attach: reasons.length > 0, reasons: [...new Set(reasons)] };
  }

  const giftOnly =
    args.moment?.structuralKind === "opponent_mistake" &&
    !args.moment.inputs?.critical_mark;
  if (giftOnly && !args.mark) {
    return { attach: false, reasons: ["skipOpponentGift"] };
  }

  if (args.moment && !giftOnly) {
    reasons.push(
      args.moment.structuralKind
        ? `moment=structural:${args.moment.structuralKind}`
        : `moment=${args.moment.severity}:${args.moment.dropCp}cp${
            args.moment.candidateKind ? `:${args.moment.candidateKind}` : ""
          }`
    );
  }
  if (args.mark && ERROR_MARKS.has(args.mark)) {
    reasons.push(`errorMark=${args.mark}`);
  }
  if (isPraiseMark(args.mark)) {
    reasons.push(`praiseMark=${args.mark}`);
  }
  // Bare Δ without moment/mark is not a coach call — never attach.
  if (args.moment?.inputs?.why_better) {
    reasons.push("why_better");
  }
  return { attach: reasons.length > 0, reasons };
}

export function shouldAttachMetricTip(args: {
  phase: PhaseName;
  moment?: CoachMetricMoment | null;
  mark: MetricCoachMark | null;
  deltaCp: number;
  phaseThemes: string[];
  structureThemeUsed?: Set<string>;
  request?: CoachNoteRequest | null;
}): boolean {
  return explainAttachMetricTip(args).attach;
}

export function themesForPly(args: {
  metrics: CoachGameMetrics;
  phase: PhaseName;
  moment?: CoachMetricMoment | null;
  deltaCp: number;
  extra?: string[];
  request?: CoachNoteRequest | null;
}): string[] {
  const sk =
    args.request?.structuralKind || args.moment?.structuralKind || null;
  const openingCheckpoint =
    sk === "opening_name" || sk === "opening_aggregate";
  const openingKeyId =
    typeof args.request?.inputs?.openingKeyId === "string"
      ? args.request.inputs.openingKeyId
      : typeof args.moment?.inputs?.openingKeyId === "string"
        ? String(args.moment.inputs.openingKeyId)
        : null;

  if (args.request || args.moment) {
    const inputs = args.request?.inputs || args.moment?.inputs || null;
    const evidenced = softKeysForNoteRequest({
      structuralKind: sk,
      inputs,
      playedMetricDelta: args.request?.playedMetricDelta,
      playedLineMetricDelta: args.request?.playedLineMetricDelta,
      engineLineMetricDelta: args.request?.engineLineMetricDelta,
      engineVsPlayedMetricDelta: args.request?.engineVsPlayedMetricDelta,
      kind: args.request?.kind,
      openingKeyId,
      phaseMetricKeys: [],
      situations: args.request?.situations,
      tacticalFact: args.request?.tacticalFact,
    });
    if (evidenced.length) {
      return [...new Set([...(args.extra || []), ...evidenced].filter(Boolean))];
    }
    if (openingCheckpoint) {
      return softKeysFromOpeningPeerGaps(inputs);
    }
  }

  const base = [
    ...(args.extra || []),
    ...(args.metrics.themesByPhase[args.phase] || []),
  ];
  return [...new Set(base.filter(Boolean))];
}
