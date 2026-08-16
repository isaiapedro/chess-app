/**
 * Metric-driven soft-key weights + FEN-free pack tip selection.
 * Games analyze picks notes from vault/heuristics/marks — not FEN/SAN match.
 */

import type { CoachMark } from "./coachMarks";
import type { DerivedCoachEntry, DerivedCoachNote } from "./derivedCoachPack";
import {
  reformatCoachNote,
  reformatCoachNoteOneClaim,
  isCorruptPackNote,
} from "./derivedPolish";
import type { CoachGameMetrics, CoachMetricMoment } from "./coachGameMetrics";
import type { CoachNoteRequest } from "./coachNoteRequest";
import {
  requestAlwaysAttaches,
} from "./coachNoteRequest";
import {
  type KeyTip,
  type PhaseGameKeys,
} from "./keyRetrieve";
import { softKeysForNoteRequest } from "./metricNoteKeys";
import { explainEngineLineVsPlayed } from "./engineLineExplain";
import { metricKeyLabel } from "./metricThemes";
import {
  METRIC_TIP_MIN_WEIGHT,
  STRUCTURE_THEMES,
  shouldAttachMetricTip,
  weightKeyForMoment,
  type PhaseName,
} from "./metricNoteWeights";
import type { GamePlanState } from "./gamePlanState";
import {
  softKeysFromOpeningPeerGaps,
} from "./openingCoachInputs";
import { softKeysFromMiddlegamePeerGaps } from "./middlegameCoachInputs";
import { composeMiddlegameJudgmentTipDetailed } from "./middlegameJudgmentTip";
import {
  composeMiddlegameStrategicTip,
  hasMiddlegameStrategicLead,
} from "./middlegameStrategicTip";
import {
  composeEndgameStrategicTip,
  hasEndgameStrategicLead,
} from "./endgameStrategicTip";
import {
  composeOpeningJudgmentTipDetailed,
  rankOpeningTipKeyIds,
  OPENING_TIP_KEY_ID_CAP,
  type OpeningJudgmentTipResult,
  type OpeningTipPrior,
} from "./openingJudgmentTip";
import { composeMomentJudgmentTip } from "./momentJudgmentTip";
import {
  softKeysForTacticalFact,
  type TacticalFact,
} from "./tacticalFact";

export type { OpeningTipPrior, OpeningJudgmentTipResult };

export {
  shouldAttachMetricTip,
  explainAttachMetricTip,
  weightKeyForMoment,
  rankMetricNoteWeights,
  formatWeightBreakdown,
  themesForPly,
  METRIC_TIP_MIN_WEIGHT,
  STRUCTURE_THEMES,
  type PhaseName,
  type KeyWeightBreakdown,
  type WeightPart,
} from "./metricNoteWeights";

export {
  COACH_NOTE_REQUEST_CONFIG,
  buildCoachNoteRequest,
  formatCoachNoteRequest,
  lineComparisonMomentInputs,
  coachRequestMetaInputs,
  durableUnusedStructureThemes,
  isPraiseMark,
  isFixedCheckpointMoment,
  requestAlwaysAttaches,
  playedMoveIsBest,
  openingEvalGapAllowsEngineLine,
  engineLineSansBudget,
  composePlayedAltLine,
  type CoachNoteRequest,
  type CoachNoteRequestKind,
} from "./coachNoteRequest";

function keyFamily(keyId: string): string {
  return (keyId || "").split(".")[0] || "";
}

function keyTail(keyId: string): string {
  const parts = (keyId || "").split(".");
  return parts[parts.length - 1] || keyId;
}

function notePhaseOk(note: DerivedCoachNote, phase: PhaseName): boolean {
  const p = (note.phase || "any").toLowerCase();
  return p === "any" || p === phase || !note.phase;
}

function isOpeningCheckpointRequest(
  request?: CoachNoteRequest | null,
  moment?: CoachMetricMoment | null
): boolean {
  const sk =
    request?.structuralKind || moment?.structuralKind || null;
  return sk === "opening_name" || sk === "opening_aggregate";
}

function pickNoteFromEntry(args: {
  entry: DerivedCoachEntry;
  phase: PhaseName;
  excludeNoteIds?: Set<string>;
  /** Prefer mid-specificity didactic notes; skip bookwalk when possible. */
  preferDidactic?: boolean;
  /** Opening tips: one claim only. */
  oneClaim?: boolean;
}): { note: DerivedCoachNote; text: string } | null {
  const exclude = args.excludeNoteIds || new Set<string>();
  let notes = (args.entry.notes || []).filter((n) => {
    if (!(n.text || "").trim()) return false;
    if (n.id && exclude.has(n.id)) return false;
    if (!notePhaseOk(n, args.phase)) return false;
    return true;
  });
  if (args.preferDidactic) {
    // Never fall back to bookwalk game stories — metric template instead.
    notes = notes.filter(
      (n) => !String(n.id || "").startsWith("bookwalk:")
    );
  }
  notes = notes.filter((n) => !isCorruptPackNote(n.text || ""));
  if (!notes.length) return null;
  notes.sort((a, b) => {
    const sa = a.specificity ?? 3;
    const sb = b.specificity ?? 3;
    const da = Math.abs(sa - 3);
    const db = Math.abs(sb - 3);
    return da - db || (b.text || "").length - (a.text || "").length;
  });
  const note = notes[0]!;
  let text = args.oneClaim
    ? reformatCoachNoteOneClaim(note.text, 420)
    : reformatCoachNote(note.text, 420);
  if ((!text || text.length < 40) && args.oneClaim) {
    text = reformatCoachNote(note.text, 280, 1);
  }
  if (!text || text.length < 28 || isCorruptPackNote(text)) return null;
  return { note, text };
}

/**
 * Opening tip = woven peer judgments + short pack clauses (one natural phrase).
 * No raw metric dumps, peer Δ numbers, SAN lines, or book titles.
 * Diversifies vs priorTopics when peers barely changed between moments.
 */
function composeOpeningCheckpointTip(args: {
  inputs?: Record<string, string | number | boolean | null> | null;
  openingName?: string | null;
  openingKeyId?: string | null;
  packByKey?: Record<string, string> | null;
  packText?: string | null;
  packKeyId?: string | null;
  priorTopics?: OpeningTipPrior | null;
}): OpeningJudgmentTipResult {
  const packByKey: Record<string, string> = {
    ...(args.packByKey || {}),
  };
  if (args.packKeyId && args.packText?.trim()) {
    packByKey[args.packKeyId] = args.packText.trim();
  }
  return composeOpeningJudgmentTipDetailed({
    inputs: args.inputs,
    openingName: args.openingName,
    openingKeyId: args.openingKeyId,
    packByKey,
    priorTopics: args.priorTopics,
  });
}

/** Quiet opening bad_move with no engine why_better — weave peer judgments. */
function isQuietOpeningPeerTip(args: {
  phase: PhaseName;
  request?: CoachNoteRequest | null;
  mark: CoachMark | null;
  lineExplain: ReturnType<typeof lineExplainFromRequest>;
}): boolean {
  if (args.phase !== "opening") return false;
  if (args.request?.kind !== "bad_move") return false;
  if (!args.mark || !["blunder", "mistake", "missed"].includes(args.mark)) {
    return false;
  }
  if (args.lineExplain?.reasons?.length) return false;
  const inputs = args.request?.inputs;
  if (!inputs) return false;
  return softKeysFromOpeningPeerGaps(inputs).length > 0;
}


function metricFallbackText(args: {
  mark: CoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  themes: string[];
  request?: CoachNoteRequest | null;
  openingKeyId?: string | null;
  openingName?: string | null;
  phase?: PhaseName;
  priorTopics?: OpeningTipPrior | null;
  gamePlan?: GamePlanState | null;
}): string {
  const theme =
    args.themes.find((t) => STRUCTURE_THEMES.has(t)) ||
    args.themes[0] ||
    "the position";
  const themeLabel = theme.includes(".")
    ? metricKeyLabel(theme)
    : theme.replace(/_/g, " ");

  const lineExplain = lineExplainFromRequest(args.request, {
    phase: args.phase,
    openingKeyId: args.openingKeyId,
    openingName: args.openingName,
  });

  if (
    args.request?.kind === "fixed_checkpoint" ||
    args.request?.kind === "structural_moment"
  ) {
    const sk = args.request.structuralKind || "checkpoint";
    if (sk === "decisive_pawn_break") {
      const san =
        args.request.playedLineSans?.[0] ||
        args.moment?.playedSan ||
        args.request.inputs?.san ||
        "the break";
      if (hasMiddlegameStrategicLead(args.request.inputs)) {
        const tip = composeMiddlegameStrategicTip({
          inputs: args.request.inputs,
        });
        return tip.startsWith("Pawn break")
          ? tip
          : `Pawn break (${san}) — ${tip.charAt(0).toLowerCase()}${tip.slice(1)}`;
      }
      const woven = composeMomentJudgmentTip({
        mark: args.mark,
        deltaCp: args.deltaCp,
        moment: args.moment,
        kind: "structural_moment",
        explained: lineExplain,
        gamePlan: args.gamePlan,
        situations: args.request.situations,
        engineLineSans: args.request.engineLineSans,
        playedMetricDelta: args.request.playedLineMetricDelta.length
          ? args.request.playedLineMetricDelta
          : args.request.playedMetricDelta,
        engineVsPlayedMetricDelta: args.request.engineVsPlayedMetricDelta,
        priorTopics: args.priorTopics,
      }).text;
      if (/^(Serious|Costly) miss/i.test(woven)) {
        return woven.replace(/^(Serious|Costly) miss/i, `Pawn break (${san})`);
      }
      return `Pawn break (${san}) — ${woven.charAt(0).toLowerCase()}${woven.slice(1)}`;
    }
    if (sk === "opening_aggregate" || sk === "opening_name") {
      return composeOpeningCheckpointTip({
        inputs: args.request.inputs,
        openingName: args.openingName,
        openingKeyId: args.openingKeyId,
        priorTopics: args.priorTopics,
      }).text;
    }
    if (sk === "middlegame_aggregate") {
      if (hasMiddlegameStrategicLead(args.request.inputs)) {
        const strategic = composeMiddlegameStrategicTip({
          inputs: args.request.inputs,
        });
        if (strategic.length > 40) return strategic;
      }
      return composeMiddlegameJudgmentTipDetailed({
        inputs: args.request.inputs,
        priorTopics: args.priorTopics,
      }).text;
    }
    if (sk === "endgame_advantage") {
      if (hasEndgameStrategicLead(args.request.inputs)) {
        return composeEndgameStrategicTip({
          inputs: args.request.inputs,
        });
      }
    }
    if (sk === "opponent_mistake") {
      if (lineExplain?.reasons.length) {
        return composeWhyBetterTip({
          explained: lineExplain,
          mark: args.mark,
          deltaCp: args.deltaCp,
          moment: args.moment,
          kind: args.request.kind,
          gamePlan: args.gamePlan,
          request: args.request,
          priorTopics: args.priorTopics,
        });
      }
      if (lineExplain?.text) return lineExplain.text;
    }
    return composeMomentJudgmentTip({
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      kind: args.request.kind,
      explained: lineExplain,
      gamePlan: args.gamePlan,
      situations: args.request.situations,
      engineLineSans: args.request.engineLineSans,
      playedMetricDelta: args.request.playedMetricDelta,
      engineVsPlayedMetricDelta: args.request.engineVsPlayedMetricDelta,
      priorTopics: args.priorTopics,
    }).text;
  }

  if (args.request?.kind === "praise_move") {
    return composeMomentJudgmentTip({
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      kind: "praise_move",
      packText: null,
      gamePlan: args.gamePlan,
      situations: args.request.situations,
      engineLineSans: args.request.engineLineSans,
      playedMetricDelta: args.request.playedMetricDelta,
      engineVsPlayedMetricDelta: args.request.engineVsPlayedMetricDelta,
      priorTopics: args.priorTopics,
      explained: lineExplain,
    }).text;
  }

  if (args.request?.kind === "bad_move" && args.request.tacticalFact?.kind) {
    return composeTacticalTip({
      fact: args.request.tacticalFact,
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      gamePlan: args.gamePlan,
      request: args.request,
      priorTopics: args.priorTopics,
    });
  }

  if (args.request?.kind === "bad_move" && lineExplain?.reasons.length) {
    return composeWhyBetterTip({
      explained: lineExplain,
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      kind: args.request.kind,
      gamePlan: args.gamePlan,
      request: args.request,
      priorTopics: args.priorTopics,
    });
  }

  if (args.request?.kind === "bad_move") {
    return composeMomentJudgmentTip({
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      kind: "bad_move",
      gamePlan: args.gamePlan,
      situations: args.request.situations,
      playedMetricDelta: args.request.playedMetricDelta,
      priorTopics: args.priorTopics,
    }).text;
  }

  if (args.mark === "blunder" || (args.moment && args.moment.dropCp >= 150)) {
    return composeMomentJudgmentTip({
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      kind: "bad_move",
      gamePlan: args.gamePlan,
      priorTopics: args.priorTopics,
    }).text;
  }
  if (
    args.mark === "mistake" ||
    args.mark === "missed" ||
    (args.moment && args.moment.severity === "mistake")
  ) {
    return composeMomentJudgmentTip({
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      kind: "bad_move",
      gamePlan: args.gamePlan,
      priorTopics: args.priorTopics,
    }).text;
  }
  if (args.mark === "brilliant" || args.mark === "important") {
    return composeMomentJudgmentTip({
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      kind: "praise_move",
      gamePlan: args.gamePlan,
      priorTopics: args.priorTopics,
    }).text;
  }
  if (args.mark === "excellent") {
    return `Excellent accuracy around ${themeLabel} — keep the same standard on the next decision.`;
  }
  return `Pay attention to ${themeLabel} here — the metrics flag it as a theme of this game.`;
}

function poolEntriesForMetricKeys(
  entries: DerivedCoachEntry[],
  allowedKeys: string[],
  excludeKeys: Set<string>,
  byKey?: Map<string, DerivedCoachEntry> | null
): DerivedCoachEntry[] {
  if (!allowedKeys.length) return [];
  const allow = new Set(allowedKeys);
  if (byKey?.size) {
    const exact: DerivedCoachEntry[] = [];
    for (const keyId of allowedKeys) {
      if (excludeKeys.has(keyId)) continue;
      const hit = byKey.get(keyId);
      if (hit) exact.push(hit);
    }
    if (exact.length) return exact;
    const families = new Set(allowedKeys.map((k) => k.split(".")[0] || ""));
    const out: DerivedCoachEntry[] = [];
    for (const [keyId, entry] of byKey) {
      if (excludeKeys.has(keyId)) continue;
      if (families.has(keyFamily(keyId))) out.push(entry);
    }
    return out;
  }
  const exact: DerivedCoachEntry[] = [];
  for (const entry of entries) {
    const keyId = entry.keyId || entry.id || "";
    if (!keyId || excludeKeys.has(keyId)) continue;
    if (allow.has(keyId)) exact.push(entry);
  }
  if (exact.length) return exact;
  const families = new Set(allowedKeys.map((k) => k.split(".")[0] || ""));
  return entries.filter((entry) => {
    const keyId = entry.keyId || entry.id || "";
    if (!keyId || excludeKeys.has(keyId)) return false;
    return families.has(keyFamily(keyId));
  });
}

export function pickMetricTip(args: {
  entries: DerivedCoachEntry[];
  byKey?: Map<string, DerivedCoachEntry> | null;
  metrics: CoachGameMetrics;
  phase: PhaseName;
  mark: CoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  openingKeyId?: string | null;
  eco?: string | null;
  opening?: string | null;
  themes?: string[];
  excludeKeyIds?: Set<string>;
  excludeNoteIds?: Set<string>;
  structureThemeUsed?: Set<string>;
  allowStructureQuiet?: boolean;
  request?: CoachNoteRequest | null;
  userColor?: "white" | "black" | null;
  /** Soft keys / judgments / clauses already used on earlier opening tips. */
  priorTopics?: OpeningTipPrior | null;
  /** Updated when an opening judgment tip is composed. */
  onOpeningTipUsed?: (meta: OpeningJudgmentTipResult) => void;
  /** Sticky opening/structure plan for this game. */
  gamePlan?: GamePlanState | null;
}): KeyTip | null {
  const themes = uniqThemes([
    ...(args.themes || []),
    ...(args.metrics.themesByPhase[args.phase] || []),
    ...(args.moment ||
    (args.request &&
      (args.request.kind === "bad_move" ||
        args.request.kind === "fixed_checkpoint" ||
        args.request.kind === "structural_moment"))
      ? args.metrics.globalThemes
      : []),
  ]);

  const openingCheckpoint = isOpeningCheckpointRequest(
    args.request,
    args.moment
  );
  const excludeKeys = args.excludeKeyIds || new Set<string>();
  const lineExplain = lineExplainFromRequest(args.request, {
    phase: args.phase,
    openingKeyId: args.openingKeyId,
    openingName: args.opening,
  });
  const quietOpeningPeer = isQuietOpeningPeerTip({
    phase: args.phase,
    request: args.request,
    mark: args.mark,
    lineExplain,
  });
  const useOpeningWeave = openingCheckpoint || quietOpeningPeer;
  const mgAggregate =
    args.request?.structuralKind === "middlegame_aggregate" ||
    args.moment?.structuralKind === "middlegame_aggregate";
  const usePeerWeave = useOpeningWeave || mgAggregate;
  const allowedKeys = softKeysForNoteRequest({
    structuralKind: args.request?.structuralKind || args.moment?.structuralKind,
    inputs: args.request?.inputs || args.moment?.inputs,
    playedMetricDelta: args.request?.playedMetricDelta,
    playedLineMetricDelta: args.request?.playedLineMetricDelta,
    engineLineMetricDelta: args.request?.engineLineMetricDelta,
    engineVsPlayedMetricDelta: args.request?.engineVsPlayedMetricDelta,
    kind: args.request?.kind,
    openingKeyId: args.openingKeyId,
    phase: args.phase,
    phaseMetricKeys: usePeerWeave
      ? []
      : [
          ...(args.metrics.themesByPhase[args.phase] || []),
          ...(lineExplain?.softKeys || []),
        ],
    situations: args.request?.situations,
    planKeys: args.gamePlan?.stickyKeys,
    tacticalFact: args.request?.tacticalFact,
  });
  const tacticalKeys = softKeysForTacticalFact(args.request?.tacticalFact);
  const pool = poolEntriesForMetricKeys(
    args.entries,
    allowedKeys,
    excludeKeys,
    args.byKey
  );
  const openingPeerRank = useOpeningWeave
    ? softKeysFromOpeningPeerGaps(
        args.request?.inputs || args.moment?.inputs
      )
    : mgAggregate
      ? softKeysFromMiddlegamePeerGaps(
          args.request?.inputs || args.moment?.inputs
        )
      : [];
  const ranked = (pool.length ? pool : []).map((entry) => {
      const keyId = entry.keyId || entry.id || "";
      const weight = weightKeyForMoment({
        entry,
        phase: args.phase,
        themes,
        mark: args.mark,
        deltaCp: args.deltaCp,
        moment: args.moment,
        openingKeyId: args.openingKeyId,
        eco: args.eco,
        opening: args.opening,
        request: args.request,
        gamePlan: args.gamePlan,
      });
      const inPool = allowedKeys.includes(keyId) ? 4 : 0;
      const primaryBoost =
        !usePeerWeave && lineExplain?.primarySoftKeys?.includes(keyId)
          ? 8
          : 0;
      const tacticalBoost =
        !usePeerWeave && tacticalKeys.includes(keyId) ? 10 : 0;
      const openingLockBoost =
        useOpeningWeave && args.openingKeyId && keyId === args.openingKeyId
          ? 12
          : 0;
      const peerRankIdx = openingPeerRank.indexOf(keyId);
      const peerRankBoost =
        usePeerWeave && peerRankIdx >= 0
          ? Math.max(4, 14 - peerRankIdx * 2)
          : 0;
      const total =
        weight +
        inPool +
        primaryBoost +
        tacticalBoost +
        openingLockBoost +
        peerRankBoost;
      if (total < METRIC_TIP_MIN_WEIGHT && !requestAlwaysAttaches(args.request?.kind)) {
        return null;
      }
      return { entry, keyId, weight: Math.max(total, METRIC_TIP_MIN_WEIGHT) };
    })
    .filter((r): r is { entry: DerivedCoachEntry; keyId: string; weight: number } =>
      Boolean(r)
    )
    .sort((a, b) => {
      if (useOpeningWeave && args.openingKeyId) {
        const aOpen = a.keyId === args.openingKeyId ? 1 : 0;
        const bOpen = b.keyId === args.openingKeyId ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen;
      }
      if (usePeerWeave && openingPeerRank.length) {
        const aGap = openingPeerRank.indexOf(a.keyId);
        const bGap = openingPeerRank.indexOf(b.keyId);
        const aRank = aGap < 0 ? 999 : aGap;
        const bRank = bGap < 0 ? 999 : bGap;
        if (aRank !== bRank) return aRank - bRank;
      }
      if (!usePeerWeave && tacticalKeys.length) {
        const aTac = tacticalKeys.indexOf(a.keyId);
        const bTac = tacticalKeys.indexOf(b.keyId);
        const aRank = aTac < 0 ? 999 : aTac;
        const bRank = bTac < 0 ? 999 : bTac;
        if (aRank !== bRank) return aRank - bRank;
      }
      const aPri =
        !usePeerWeave && lineExplain?.primarySoftKeys?.includes(a.keyId)
          ? 1
          : 0;
      const bPri =
        !usePeerWeave && lineExplain?.primarySoftKeys?.includes(b.keyId)
          ? 1
          : 0;
      return (
        bPri - aPri ||
        b.weight - a.weight ||
        a.keyId.localeCompare(b.keyId)
      );
    });

  const ERROR_MARKS = new Set<CoachMark>([
    "blunder",
    "mistake",
    "missed",
  ]);

  const openingPackByKey: Record<string, string> = {};
  let openingPrimary:
    | {
        entry: DerivedCoachEntry;
        keyId: string;
        weight: number;
        note: DerivedCoachNote;
        text: string;
      }
    | null = null;

  for (const row of ranked.slice(0, 8)) {
    const tail = keyTail(row.keyId);
    if (
      STRUCTURE_THEMES.has(tail) &&
      args.structureThemeUsed?.has(tail) &&
      !args.moment &&
      !(args.mark && ERROR_MARKS.has(args.mark)) &&
      !(args.request && requestAlwaysAttaches(args.request.kind))
    ) {
      continue;
    }

    const picked = pickNoteFromEntry({
      entry: row.entry,
      phase: args.phase,
      excludeNoteIds: args.excludeNoteIds,
      preferDidactic: true,
      oneClaim: usePeerWeave,
    });
    if (!picked) continue;
    if (
      usePeerWeave &&
      String(picked.note.id || "").startsWith("bookwalk:") &&
      picked.text.length < 60
    ) {
      continue;
    }

    if (usePeerWeave) {
      openingPackByKey[row.keyId] = picked.text;
      if (!openingPrimary) {
        openingPrimary = {
          entry: row.entry,
          keyId: row.keyId,
          weight: row.weight,
          note: picked.note,
          text: picked.text,
        };
      }
      continue;
    }

    if (STRUCTURE_THEMES.has(tail)) {
      args.structureThemeUsed?.add(tail);
    }

    let text: string;
    let tipMeta: {
      softKeys: string[];
      metrics: string[];
      clauses: string[];
      topics: string[];
    } | null = null;
    if (args.request?.tacticalFact?.kind) {
      const woven = composeMomentJudgmentTip({
        mark: args.mark,
        deltaCp: args.deltaCp,
        moment: args.moment,
        kind: args.request.kind,
        fact: args.request.tacticalFact,
        packText: picked.text,
        packKeyId: row.keyId,
        gamePlan: args.gamePlan,
        situations: args.request.situations,
        engineLineSans: args.request.engineLineSans,
        playedMetricDelta: args.request.playedMetricDelta,
        engineVsPlayedMetricDelta: args.request.engineVsPlayedMetricDelta,
        priorTopics: args.priorTopics,
      });
      text = woven.text;
      tipMeta = woven;
    } else if (lineExplain?.reasons.length) {
      const woven = composeMomentJudgmentTip({
        mark: args.mark,
        deltaCp: args.deltaCp,
        moment: args.moment,
        kind: args.request?.kind,
        explained: lineExplain,
        packText: picked.text,
        packKeyId: row.keyId,
        gamePlan: args.gamePlan,
        situations: args.request?.situations,
        engineLineSans: args.request?.engineLineSans,
        playedMetricDelta: args.request?.playedMetricDelta,
        engineVsPlayedMetricDelta: args.request?.engineVsPlayedMetricDelta,
        priorTopics: args.priorTopics,
      });
      text = woven.text;
      tipMeta = woven;
    } else if (
      args.phase === "middlegame" &&
      hasMiddlegameStrategicLead(
        args.request?.inputs || args.moment?.inputs
      )
    ) {
      text = composeMiddlegameStrategicTip({
        inputs: args.request?.inputs || args.moment?.inputs,
        packClause: picked.text,
      });
    } else if (
      args.phase === "endgame" &&
      hasEndgameStrategicLead(args.request?.inputs || args.moment?.inputs)
    ) {
      text = composeEndgameStrategicTip({
        inputs: args.request?.inputs || args.moment?.inputs,
        packClause: picked.text,
      });
    } else {
      text = picked.text;
    }
    if (tipMeta) {
      args.onOpeningTipUsed?.(tipMeta);
    }

    const primaryKey =
      (tacticalKeys.includes(row.keyId) && row.keyId) ||
      tacticalKeys[0] ||
      (lineExplain?.primarySoftKeys?.includes(row.keyId) && row.keyId) ||
      lineExplain?.primarySoftKeys?.[0] ||
      row.keyId;
    const keyIds = [
      ...new Set([
        primaryKey,
        ...tacticalKeys,
        ...(lineExplain?.primarySoftKeys || []),
        ...(lineExplain?.softKeys || []),
        row.keyId,
      ]),
    ].slice(0, OPENING_TIP_KEY_ID_CAP);
    return {
      keyId: primaryKey,
      keyIds,
      keyType: row.entry.keyType || keyFamily(primaryKey),
      label: row.entry.label || primaryKey,
      text,
      games: row.entry.games || [],
      score: row.weight,
      noteId: picked.note.id,
      principle: picked.note.principle,
      phase: picked.note.phase || args.phase,
      compactDefinition: row.entry.compactDefinition,
      noteCompact: picked.note.compact,
      modelGame: row.entry.modelGame,
    };
  }

  if (usePeerWeave && openingPrimary) {
    const prim = openingPrimary;
    const tail = keyTail(prim.keyId);
    if (STRUCTURE_THEMES.has(tail)) {
      args.structureThemeUsed?.add(tail);
    }
    const woven = useOpeningWeave
      ? composeOpeningCheckpointTip({
          inputs: args.request?.inputs || args.moment?.inputs,
          openingName: args.opening,
          openingKeyId: args.openingKeyId,
          packByKey: openingPackByKey,
          packText: prim.text,
          packKeyId: prim.keyId,
          priorTopics: args.priorTopics,
        })
      : (() => {
          const packByKey = { ...openingPackByKey };
          if (prim.keyId && prim.text?.trim()) {
            packByKey[prim.keyId] = prim.text.trim();
          }
          return composeMiddlegameJudgmentTipDetailed({
            inputs: args.request?.inputs || args.moment?.inputs,
            packByKey,
            priorTopics: args.priorTopics,
          });
        })();
    args.onOpeningTipUsed?.(woven);
    const keyIds = useOpeningWeave
      ? rankOpeningTipKeyIds({
          wovenSoftKeys: woven.softKeys,
          peerSoftKeys: openingPeerRank,
          openingKeyId: args.openingKeyId,
          openingName: args.opening,
        })
      : [...new Set([...woven.softKeys, ...openingPeerRank, prim.keyId])].slice(
          0,
          OPENING_TIP_KEY_ID_CAP
        );
    const primaryKey =
      keyIds[0] ||
      (args.openingKeyId === prim.keyId && prim.keyId) ||
      prim.keyId;
    return {
      keyId: primaryKey,
      keyIds,
      keyType: prim.entry.keyType || keyFamily(primaryKey),
      label: prim.entry.label || primaryKey,
      text: woven.text,
      games: prim.entry.games || [],
      score: prim.weight,
      noteId: prim.note.id,
      principle: prim.note.principle,
      phase: prim.note.phase || args.phase,
      compactDefinition: prim.entry.compactDefinition,
      noteCompact: prim.note.compact,
      modelGame: prim.entry.modelGame,
    };
  }

  if (
    (args.request && requestAlwaysAttaches(args.request.kind)) ||
    args.moment ||
    (args.mark && ERROR_MARKS.has(args.mark)) ||
    args.deltaCp >= 80 ||
    args.allowStructureQuiet
  ) {
    const text = metricFallbackText({
      mark: args.mark,
      deltaCp: args.deltaCp,
      moment: args.moment,
      themes,
      request: args.request,
      openingKeyId: args.openingKeyId,
      openingName: args.opening,
      phase: args.phase,
      priorTopics: args.priorTopics,
      gamePlan: args.gamePlan,
    });
    const openingFallbackKey =
      useOpeningWeave
        ? args.openingKeyId ||
          softKeysFromOpeningPeerGaps(
            args.request?.inputs || args.moment?.inputs
          )[0] ||
          null
        : null;
    return {
      keyId:
        openingFallbackKey ||
        lineExplain?.primarySoftKeys?.[0] ||
        lineExplain?.softKeys?.[0] ||
        args.openingKeyId ||
        (args.metrics.themesByPhase[args.phase] || [])[0] ||
        `piece.centralization`,
      keyType: "methodology",
      label: "Game metrics",
      text,
      games: [],
      score: 3,
      phase: args.phase,
    };
  }

  return null;
}

function uniqThemes(themes: string[]): string[] {
  return [...new Set(themes.filter(Boolean))];
}

function lineExplainFromRequest(
  request: CoachNoteRequest | null | undefined,
  opts?: {
    phase?: PhaseName;
    openingKeyId?: string | null;
    openingName?: string | null;
  }
) {
  if (!request) return null;
  return explainEngineLineVsPlayed({
    bestSan: request.moment?.bestSan,
    engineLineSans: request.engineLineSans,
    playedLineSans: request.playedLineSans,
    engineVsPlayedMetricDelta: request.engineVsPlayedMetricDelta,
    engineLineMetricDelta: request.engineLineMetricDelta,
    playedLineMetricDelta: request.playedLineMetricDelta,
    phase: opts?.phase || request.phase,
    openingKeyId: opts?.openingKeyId,
    openingName:
      opts?.openingName ||
      (typeof request.inputs?.opening_name === "string"
        ? request.inputs.opening_name
        : null),
    punishFrame: request.structuralKind === "opponent_mistake",
  });
}

/** Primary = board-true tactic + polished weave (situations / plan / lesson). */
function composeTacticalTip(args: {
  fact: TacticalFact;
  packText?: string | null;
  packKeyId?: string | null;
  mark: CoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  gamePlan?: GamePlanState | null;
  request?: CoachNoteRequest | null;
  priorTopics?: OpeningTipPrior | null;
}): string {
  return composeMomentJudgmentTip({
    mark: args.mark,
    deltaCp: args.deltaCp,
    moment: args.moment,
    kind: args.request?.kind || "bad_move",
    fact: args.fact,
    packText: args.packText,
    packKeyId: args.packKeyId,
    gamePlan: args.gamePlan,
    situations: args.request?.situations,
    engineLineSans: args.request?.engineLineSans,
    playedMetricDelta: args.request?.playedMetricDelta,
    engineVsPlayedMetricDelta: args.request?.engineVsPlayedMetricDelta,
    priorTopics: args.priorTopics,
  }).text;
}

/** Primary = why_better reasons woven into natural dialogue + pack lesson. */
function composeWhyBetterTip(args: {
  explained: NonNullable<ReturnType<typeof lineExplainFromRequest>>;
  packText?: string | null;
  packKeyId?: string | null;
  mark: CoachMark | null;
  deltaCp: number;
  moment?: CoachMetricMoment | null;
  kind?: string | null;
  gamePlan?: GamePlanState | null;
  request?: CoachNoteRequest | null;
  priorTopics?: OpeningTipPrior | null;
}): string {
  return composeMomentJudgmentTip({
    mark: args.mark,
    deltaCp: args.deltaCp,
    moment: args.moment,
    kind: args.kind || args.request?.kind,
    explained: args.explained,
    packText: args.packText,
    packKeyId: args.packKeyId,
    gamePlan: args.gamePlan,
    situations: args.request?.situations,
    engineLineSans: args.request?.engineLineSans,
    playedMetricDelta: args.request?.playedMetricDelta,
    engineVsPlayedMetricDelta: args.request?.engineVsPlayedMetricDelta,
    priorTopics: args.priorTopics,
  }).text;
}

export type { PhaseGameKeys };
