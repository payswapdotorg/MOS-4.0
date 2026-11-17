import type { MomentumResult } from "./evidence.js";
import type { VideoScore } from "./scoring.js";

/**
 * Workflow G — MOS analytical classifications. These are MOS product
 * categories, NOT official YouTube categories; thresholds are exported and
 * documented so the UI can explain every label.
 */

export const BREAKOUT_RATIO_THRESHOLD = 2.0;
export const BREAKOUT_MIN_CONFIDENCE = 0.5;
export const RISING_MAX_AGE_DAYS = 21;
export const RISING_MIN_VPD_FACTOR = 0.5;
export const EVERGREEN_MIN_AGE_DAYS = 90;
export const EVERGREEN_MIN_VPD_FACTOR = 0.4;
export const NEW_ENTRANT_MAX_SUBSCRIBERS = 10_000;
export const NEW_ENTRANT_MIN_OVERALL = 60;

export type ResultView = "breakout" | "rising" | "evergreen" | "new-entrant";

export interface ClassificationContext {
  ageDays: number | null;
  /** views ÷ baseline median, or null when the baseline is unavailable. */
  breakoutRatio: number | null;
  channelSubscribers: number | null;
  /** Observed momentum from repeated observations (evidence.computeMomentum). */
  momentum: MomentumResult | null;
}

export interface ClassificationResult {
  views: ResultView[];
  notes: string[];
}

export function classifyVideo(score: VideoScore, context: ClassificationContext): ClassificationResult {
  const views: ResultView[] = [];
  const notes: string[] = [];

  const breakoutFactor = score.factors.find((factor) => factor.factor === "breakout");
  const vpdFactor = score.factors.find((factor) => factor.factor === "viewsPerDay");

  if (
    context.breakoutRatio !== null &&
    context.breakoutRatio >= BREAKOUT_RATIO_THRESHOLD &&
    score.confidence >= BREAKOUT_MIN_CONFIDENCE
  ) {
    views.push("breakout");
    notes.push(`Outperforming its channel baseline by ${context.breakoutRatio.toFixed(1)}×.`);
  } else if (context.breakoutRatio === null && breakoutFactor?.normalized === null) {
    notes.push("No channel baseline available; breakout comparison not made (score confidence reduced).");
  }

  if (context.ageDays !== null && context.ageDays <= RISING_MAX_AGE_DAYS && (vpdFactor?.normalized ?? 0) >= RISING_MIN_VPD_FACTOR) {
    views.push("rising");
    if (context.momentum) {
      notes.push(
        `Observed momentum: ${Math.round(context.momentum.observedViewsPerDay).toLocaleString("en-US")} views/day measured across ${context.momentum.observationCount} observations over ${context.momentum.spanDays.toFixed(1)} days.`,
      );
    } else {
      notes.push("Recent with strong estimated pace; measured momentum requires a repeat scan (a single observation is not a growth rate).");
    }
  }

  if (context.ageDays !== null && context.ageDays >= EVERGREEN_MIN_AGE_DAYS && (vpdFactor?.normalized ?? 0) >= EVERGREEN_MIN_VPD_FACTOR) {
    views.push("evergreen");
    notes.push(`Sustained estimated pace ${context.ageDays.toFixed(0)} days after publication.`);
  }

  if (
    context.channelSubscribers !== null &&
    context.channelSubscribers <= NEW_ENTRANT_MAX_SUBSCRIBERS &&
    score.overall !== null &&
    score.overall >= NEW_ENTRANT_MIN_OVERALL
  ) {
    views.push("new-entrant");
    notes.push(`Strong result from a smaller channel (${context.channelSubscribers.toLocaleString("en-US")} subscribers).`);
  }

  return { views, notes };
}
