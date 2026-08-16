export { formatOpeningLabel } from "./ecoLabels";
export {
  retrieveDerivedCoachNuggets,
  mergeHybridKnowledgeNuggets,
} from "./retrieve";
export {
  collectGameKeys,
  collectGameKeysByPhase,
  pickMomentKey,
  pickErrorKey,
  pickBestNoteInKey,
  indexComboResponse,
  PHASE_NOTE_LIMITS,
  OPENING_NOTES_PER_KEY,
  NOTE_SCORE_THRESHOLD,
  fenPlacementSimilarity,
} from "./keyRetrieve";
export {
  pickMetricTip,
  shouldAttachMetricTip,
  weightKeyForMoment,
  buildCoachNoteRequest,
  formatCoachNoteRequest,
  lineComparisonMomentInputs,
  COACH_NOTE_REQUEST_CONFIG,
} from "./metricNotes";
export {
  softKeysForNoteRequest,
  keysForCoachInputs,
  keysForMetricFields,
  primarySoftKeysFromMetricDeltas,
  METRIC_FIELD_TO_KEYS,
  STRUCTURAL_KIND_KEYS,
  OPENING_PLAN_KEYS,
} from "./metricNoteKeys";
export {
  enrichOpeningCoachMoments,
  buildOpeningMetricSnapshot,
  buildOpeningPeerComparison,
  buildOpeningPeerSignals,
  softKeysFromOpeningPeerGaps,
  buildAdvanceSnapshotSignals,
  OPENING_CHECKPOINT_SOFT_KEYS,
  OPENING_PEER_METRICS,
} from "./openingCoachInputs";
export {
  enrichMiddlegameCoachMoments,
  enrichLiveMiddlegamePeerGaps,
  mergeMiddlegameCoachInputs,
  buildMiddlegameMetricSnapshot,
  buildMiddlegamePeerComparison,
  buildMiddlegamePeerSignals,
  softKeysFromMiddlegamePeerGaps,
  MIDDLEGAME_PEER_METRICS,
  MIDDLEGAME_PEER_SIGNIFICANT,
} from "./middlegameCoachInputs";
export {
  buildMiddlegameStructureSnap,
  buildMiddlegameStrategicInputs,
  classifyPawnBreakClass,
  softKeysFromMgStructure,
  enrichMiddlegameStrategicMoments,
  isBenoniAsymmetric,
} from "./middlegameStructure";
export {
  composeMiddlegameStrategicTip,
  hasMiddlegameStrategicLead,
} from "./middlegameStrategicTip";
export {
  classifyEndgameType,
  buildEndgameStrategicInputs,
  softKeysFromEndgameContext,
  enrichEndgameCoachMoments,
} from "./endgameContext";
export {
  composeEndgameStrategicTip,
  hasEndgameStrategicLead,
} from "./endgameStrategicTip";
export {
  composeOpeningJudgmentTip,
  composeOpeningJudgmentTipDetailed,
  stripPackToClause,
  mergeOpeningTipPrior,
  rankOpeningTipKeyIds,
  OPENING_TIP_KEY_ID_CAP,
} from "./openingJudgmentTip";
export type {
  OpeningTipPrior,
  OpeningJudgmentTipResult,
} from "./openingJudgmentTip";
export {
  composeMiddlegameJudgmentTip,
  composeMiddlegameJudgmentTipDetailed,
} from "./middlegameJudgmentTip";
export {
  composeMomentJudgmentTip,
} from "./momentJudgmentTip";
export type { MomentJudgmentTipResult } from "./momentJudgmentTip";
export type {
  OpeningPeerContext,
  OpeningPeerSignal,
  OpeningPeerJudgment,
  OpeningPeerPolarity,
} from "./openingCoachInputs";
export type { MiddlegamePeerSignal } from "./middlegameCoachInputs";
export {
  PHASE_METRIC_KEYS,
  THEME_TO_METRIC_KEY,
  toPhaseMetricKeys,
  themeTagToMetricKey,
  openingPrincipleDirectives,
} from "./metricThemes";
export {
  explainEngineLineVsPlayed,
  buildMetricSignals,
  deltaHelpsEngine,
  formatMetricSignalShort,
} from "./engineLineExplain";
export type {
  EngineLineExplainResult,
  MetricSignal,
  MetricSignalPolarity,
} from "./engineLineExplain";
export type {
  CoachNoteRequest,
  CoachNoteRequestKind,
} from "./coachNoteRequest";
export { cleanBookProse, reformatCoachNote, reformatCoachNoteOneClaim } from "./derivedPolish";
export type {
  DerivedCoachPack,
  DerivedCoachEntry,
  DerivedFrequentLine,
} from "./derivedCoachPack";
export { loadCoachPack, getCachedCoachPack, getCoachPackEntriesByKeys } from "./loadCoachPack";
export {
  fenAfterUciPv,
  trimPvToHorizon,
  extendEnginePvUci,
} from "./extendEnginePv";
export {
  composeCoachNote,
  expandCoachThemes,
  classifyUserError,
  shouldComposeNote,
  acceptKeyNote,
} from "./noteCompose";
export {
  lookupCoachGameMetrics,
  buildCoachGameMetrics,
  emptyCoachGameMetrics,
  enrichMomentsWithPlies,
  ensureFixedOpeningMoments,
  upsertLiveMoment,
  isCriticalCoachMoment,
  type CoachGameMetrics,
  type CoachMetricMoment,
} from "./gameMetricsLookup";
export {
  analyzeSelectedGame,
  buildReplayPlies,
  parseGamePlies,
  linesFromEval,
  formatEval,
  type GameCoachPly,
  type GameCoachResult,
  type EngineLine,
} from "./analyzeGame";
export { phasePlanNote, phasePlanSlotOpen, adaptCoachTipForSide } from "./phasePlans";
export { adaptNoteSquares } from "./adaptNoteSquares";

export { composeGameSummaryNote } from "./gameSummary";
export {
  loadCachedGameAnalysis,
  saveCachedGameAnalysis,
} from "./analysisCache";
export {
  detectStructureThemes,
  detectOpeningFamily,
  resolveOpeningPackKey,
} from "./structureDetect";
export {
  SITUATION_PROFILES,
  detectSituations,
  softKeysFromSituations,
  situationLockBoostForKey,
  formatSituationsShort,
  formatSituationRolesShort,
  situationCastlingSnaps,
  isClosedCenter,
  isOppositeSideCastling,
  isMaroczyBind,
  maroczyBinderColor,
  isCarlsbad,
  isMinorityAttack,
  isCaroSlav,
  isHedgehog,
  isScheveningen,
  isDragonFormation,
  pickSicilianShell,
  castlingWingForColor,
  applyRoleSoftKeys,
} from "./situationProfiles";
export type {
  SituationProfileId,
  DetectedSituation,
  SituationRole,
} from "./situationProfiles";
export {
  emptyGamePlanState,
  advanceGamePlan,
  mergeOpeningPlanKeys,
  mergeSituationPlanKeys,
  mergeStructurePlanKeys,
  softKeysFromStructureThemes,
  markPlanKeysTaught,
  planLockBoostForKey,
  formatGamePlanShort,
  GAME_PLAN_KEY_CAP,
  GAME_PLAN_COLD_DEMOTE_PLIES,
} from "./gamePlanState";
export type { GamePlanState } from "./gamePlanState";
export {
  detectTacticalFact,
  softKeysForTacticalFact,
  formatTacticalFactHead,
  formatTacticalFactShort,
  tacticalFactInputs,
  tacticalLockBoostForKey,
  forcingPrefix,
  missedForcingLine,
} from "./tacticalFact";
export type { TacticalFact } from "./tacticalFact";
export {
  knightVsBishopSnap,
  goodVsBadBishopSnap,
  pawnStormTempoSnap,
  classifyRookEndingShape,
  PawnStormTracker,
} from "./tier3Metrics";
export type { RookEndingShape } from "./tier3Metrics";
export {
  COACH_MARK_SOURCES,
  classifyCoachMark,
  type CoachMark,
} from "./coachMarks";
export { computePhaseSplits, type PhaseSplits } from "./phaseSplits";
