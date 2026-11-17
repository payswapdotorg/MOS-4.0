import type { ChannelBaseline } from "./baseline.js";

/**
 * Workflow F — the versioned, deterministic performance-scoring engine.
 * Full documentation lives in docs/product/SCORING-MODEL.md; the constants
 * here are the single implementation of that document.
 *
 * Honesty rules (product requirements):
 * - Missing metrics NEVER default to a perfect score; a missing factor is
 *   excluded from the weighted mean and lowers completeness/confidence.
 * - Views/day uses publication age as an estimate only ("estimated views per
 *   day"), never presented as observed velocity; observed momentum comes from
 *   repeated observations (evidence.ts).
 * - Engagement is a PROXY (public likes + comments ÷ views), labeled as such.
 * - Normalization uses fixed documented anchors, not within-scan fitting, so
 *   a score never changes because another video joined the result set.
 */

export const SCORING_MODEL_VERSION = "mos-scoring-v1";

export interface ScoringWeights {
  breakout: number;
  viewsPerDay: number;
  engagement: number;
  recency: number;
}

export const SCORING_WEIGHTS_V1: ScoringWeights = {
  breakout: 0.4,
  viewsPerDay: 0.3,
  engagement: 0.2,
  recency: 0.1,
};

// Normalization anchors (documented in SCORING-MODEL.md).
/** breakout: ratio 1× → 0.5; every doubling adds 1/8; 16× → 1.0. */
export const BREAKOUT_LOG2_SCALE = 8;
/** viewsPerDay: log10(vpd+1)/ANCHOR — 100k vpd ≈ 1.0. */
export const VIEWS_PER_DAY_LOG10_ANCHOR = 5;
/** engagement proxy: 5% like+comment rate → 1.0. */
export const ENGAGEMENT_RATE_ANCHOR = 0.05;
/** recency: 1.0 at ≤3 days, linear decay to 0 at 365 days. */
export const RECENCY_FRESH_DAYS = 3;
export const RECENCY_ZERO_DAYS = 365;
/** Minimum age (days) before views/day is computed; younger videos use 0.5d. */
export const MIN_AGE_DAYS = 0.5;
/**
 * A score is only reported when at least half of the model's weight actually
 * has data. Below this floor the overall score is null ("insufficient data")
 * — never a decent-looking number built from missing metrics.
 */
export const MIN_COMPLETENESS_FOR_SCORE = 0.5;

export type ScoreFactorName = "breakout" | "viewsPerDay" | "engagement" | "recency";

export interface FactorExplanation {
  factor: ScoreFactorName;
  /** Human-readable raw inputs, e.g. "1024 views vs 310 median baseline (ratio 3.3×)". */
  raw: string;
  /** Normalized 0–1 value, or null when the factor is unavailable. */
  normalized: number | null;
  weight: number;
  note: string;
}

export interface ScoreInputs {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  publishedAt: string;
  collectedAt: string;
  baseline: ChannelBaseline;
}

export interface VideoScore {
  modelVersion: string;
  /** 0–100 weighted mean over available factors; null when completeness is below the floor. */
  overall: number | null;
  /** 0–1: how much of the model actually had data, times a penalty when the flagship breakout factor is missing. */
  confidence: number;
  /** 0–1: Σ available weights ÷ Σ total weights. */
  completeness: number;
  factors: FactorExplanation[];
  /** True when the engagement proxy had to work with partial counts. */
  engagementPartial: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function ageDaysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return (to - from) / 86_400_000;
}

export function scoreVideo(inputs: ScoreInputs): VideoScore {
  const weights = SCORING_WEIGHTS_V1;
  const ageDays = ageDaysBetween(inputs.publishedAt, inputs.collectedAt);
  const factors: FactorExplanation[] = [];

  // --- breakout (40%) ---
  let breakoutNormalized: number | null = null;
  let breakoutRaw = "no baseline";
  if (inputs.viewCount !== null && inputs.baseline.available && inputs.baseline.medianViews !== null) {
    const ratio = inputs.viewCount / inputs.baseline.medianViews;
    breakoutNormalized = clamp01(0.5 + Math.log2(Math.max(ratio, Number.MIN_VALUE)) / BREAKOUT_LOG2_SCALE);
    breakoutRaw = `${inputs.viewCount} views vs ${inputs.baseline.medianViews} median baseline (${ratio.toFixed(2)}× over ${inputs.baseline.sampleSize} comparable videos)`;
  }
  factors.push({
    factor: "breakout",
    raw: breakoutRaw,
    normalized: breakoutNormalized,
    weight: weights.breakout,
    note: breakoutNormalized === null ? `Unavailable: ${inputs.baseline.note}` : "Channel breakout vs median of recent comparable uploads.",
  });

  // --- estimated views per day (30%) ---
  let vpdNormalized: number | null = null;
  let vpdRaw = "no view count";
  if (inputs.viewCount !== null && ageDays !== null) {
    const effectiveAgeDays = Math.max(ageDays, MIN_AGE_DAYS);
    const viewsPerDay = inputs.viewCount / effectiveAgeDays;
    vpdNormalized = clamp01(Math.log10(viewsPerDay + 1) / VIEWS_PER_DAY_LOG10_ANCHOR);
    vpdRaw = `${Math.round(viewsPerDay).toLocaleString("en-US")} estimated views/day (${inputs.viewCount.toLocaleString("en-US")} views ÷ ${effectiveAgeDays.toFixed(1)}d publication age)`;
  }
  factors.push({
    factor: "viewsPerDay",
    raw: vpdRaw,
    normalized: vpdNormalized,
    weight: weights.viewsPerDay,
    note: "Estimate from publication age, not observed velocity; observed momentum needs repeated scans.",
  });

  // --- engagement proxy (20%) ---
  let engagementNormalized: number | null = null;
  let engagementRaw = "likes and comments hidden";
  let engagementPartial = false;
  if (inputs.viewCount !== null && inputs.viewCount > 0) {
    const parts: string[] = [];
    let signals = 0;
    if (inputs.likeCount !== null) {
      signals += inputs.likeCount;
      parts.push(`${inputs.likeCount} likes`);
    }
    if (inputs.commentCount !== null) {
      signals += inputs.commentCount;
      parts.push(`${inputs.commentCount} comments`);
    }
    if (parts.length > 0) {
      const rate = signals / inputs.viewCount;
      engagementNormalized = clamp01(rate / ENGAGEMENT_RATE_ANCHOR);
      engagementPartial = parts.length < 2;
      engagementRaw = `${(rate * 100).toFixed(2)}% engagement proxy (${parts.join(" + ")} ÷ ${inputs.viewCount} views)`;
    }
  }
  factors.push({
    factor: "engagement",
    raw: engagementRaw,
    normalized: engagementNormalized,
    weight: weights.engagement,
    note: engagementPartial
      ? "Proxy computed from partial public counts; the channel hides some engagement."
      : "Proxy from public counts only — not watch time, retention, or CTR.",
  });

  // --- recency (10%) ---
  let recencyNormalized: number | null = null;
  let recencyRaw = "unknown publish date";
  if (ageDays !== null) {
    if (ageDays <= RECENCY_FRESH_DAYS) {
      recencyNormalized = 1;
    } else if (ageDays >= RECENCY_ZERO_DAYS) {
      recencyNormalized = 0;
    } else {
      recencyNormalized = 1 - (ageDays - RECENCY_FRESH_DAYS) / (RECENCY_ZERO_DAYS - RECENCY_FRESH_DAYS);
    }
    recencyRaw = `published ${ageDays.toFixed(1)} days ago`;
  }
  factors.push({
    factor: "recency",
    raw: recencyRaw,
    normalized: recencyNormalized,
    weight: weights.recency,
    note: "Publication recency; not a momentum measurement.",
  });

  // --- weighted mean over available factors ---
  const totalWeight = weights.breakout + weights.viewsPerDay + weights.engagement + weights.recency;
  const available = factors.filter((factor): factor is FactorExplanation & { normalized: number } => factor.normalized !== null);
  const availableWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
  const completeness = totalWeight > 0 ? availableWeight / totalWeight : 0;
  const weightedSum = available.reduce((sum, factor) => sum + factor.weight * factor.normalized, 0);
  const overall =
    completeness >= MIN_COMPLETENESS_FOR_SCORE && availableWeight > 0
      ? Math.round(((weightedSum / availableWeight) * 100) * 100) / 100
      : null;

  // The flagship factor is breakout; without a baseline the score is explicitly less trustworthy.
  const confidence = completeness * (inputs.baseline.available ? 1 : 0.75);

  return {
    modelVersion: SCORING_MODEL_VERSION,
    overall,
    confidence: Math.round(confidence * 1000) / 1000,
    completeness: Math.round(completeness * 1000) / 1000,
    factors,
    engagementPartial,
  };
}
