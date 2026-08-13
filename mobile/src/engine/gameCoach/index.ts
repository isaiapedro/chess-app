export { formatOpeningLabel } from "./ecoLabels";
export {
  retrieveKnowledgeNugget,
  retrieveKnowledgeNuggets,
  retrieveDerivedCoachNuggets,
  mergeHybridKnowledgeNuggets,
} from "./retrieve";
export { DERIVED_COACH_PACK } from "./derivedCoachPack";
export { composeCoachNote, expandCoachThemes, classifyUserError } from "./noteCompose";
export {
  lookupCoachGameMetrics,
  buildCoachGameMetrics,
  emptyCoachGameMetrics,
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
export { KNOWLEDGE_PACK } from "./knowledgePack";
export { BOOK_ARCHIVE } from "./bookArchive";
export { phasePlanNote, phasePlanSlotOpen, adaptCoachTipForSide } from "./phasePlans";

export { composeGameSummaryNote } from "./gameSummary";
export {
  loadCachedGameAnalysis,
  saveCachedGameAnalysis,
} from "./analysisCache";
export {
  detectStructureThemes,
  detectOpeningFamily,
} from "./structureDetect";
export {
  COACH_MARK_SOURCES,
  classifyCoachMark,
  type CoachMark,
} from "./coachMarks";
export { computePhaseSplits, type PhaseSplits } from "./phaseSplits";
