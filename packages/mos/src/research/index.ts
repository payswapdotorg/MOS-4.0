export { classifyVideo } from "./classification.js";
export type { ClassificationContext, ClassificationResult, ResultView } from "./classification.js";
export {
  BREAKOUT_RATIO_THRESHOLD,
  BREAKOUT_MIN_CONFIDENCE,
  EVERGREEN_MIN_AGE_DAYS,
  EVERGREEN_MIN_VPD_FACTOR,
  NEW_ENTRANT_MAX_SUBSCRIBERS,
  NEW_ENTRANT_MIN_OVERALL,
  RISING_MAX_AGE_DAYS,
  RISING_MIN_VPD_FACTOR,
} from "./classification.js";
export {
  breakoutRatio,
  computeBaseline,
  median,
  MIN_BASELINE_SAMPLE,
  RECOMMENDED_BASELINE_SAMPLE,
} from "./baseline.js";
export type { BaselineVideo, ChannelBaseline } from "./baseline.js";
export { discoverVideos } from "./discovery.js";
export type { DiscoveryFailure, DiscoveryResult, DiscoveredVideo } from "./discovery.js";
export { enrichVideos } from "./enrichment.js";
export type { EnrichedChannel, EnrichedVideo, EnrichmentResult } from "./enrichment.js";
export {
  computeMomentum,
  digestParams,
  isScanStale,
  isStatisticsFresh,
  provenanceFor,
  SCAN_STALE_DAYS,
  STATISTICS_TTL_DAYS,
} from "./evidence.js";
export type { MomentumResult, ProvenanceRecord, VideoObservation } from "./evidence.js";
export { classifyFormat, comparableFormatGroup, DEFAULT_SHORTS_THRESHOLD_SECONDS } from "./format.js";
export type { FormatClassification, VideoFormat } from "./format.js";
export { nicheDefinitionSchema, DEPTH_SEARCH_CALL_BUDGETS } from "./niche.js";
export type { NicheDefinition } from "./niche.js";
export { buildSearchPlan, depthBudgetFor } from "./planner.js";
export type { PlanBudget, SearchOrderPlan, SearchPlan, SearchRequestPlan } from "./planner.js";
export {
  scoreVideo,
  SCORING_MODEL_VERSION,
  SCORING_WEIGHTS_V1,
} from "./scoring.js";
export type { FactorExplanation, ScoreInputs, ScoreFactorName, ScoringWeights, VideoScore } from "./scoring.js";
export { runNicheScan } from "./scan.js";
export type { ScanDeps, ScanProgress, ScanResult, ScanUsage, ScoredVideo } from "./scan.js";
export {
  enrichSampleStats,
  sampleChannelUploads,
} from "./sampling.js";
export type { ChannelSample, SampleVideoStats, SamplingResult } from "./sampling.js";
export { deriveThemesFromNiche, ManualThemeExpander } from "./themes.js";
export type { SearchTheme, ThemeExpansion, ThemeExpander } from "./themes.js";
