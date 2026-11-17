import { parseIsoDuration } from "../youtube/schemas.js";

/**
 * Format classification. Shorts and long-form are never directly compared
 * (Workflow E); live streams are flagged and excluded from comparisons.
 *
 * YouTube's own duration buckets: short < 4 min, medium 4–20, long > 20.
 * Shorts currently run up to 3 minutes, so the default threshold here is 180
 * seconds; it is a MOS classification, not an official YouTube signal, and is
 * configurable when YouTube policy changes.
 */

export const DEFAULT_SHORTS_THRESHOLD_SECONDS = 180;

export type VideoFormat = "short" | "long" | "live" | "upcoming" | "unknown";

export interface FormatInput {
  durationIso?: string;
  liveBroadcastContent?: string;
}

export interface FormatClassification {
  format: VideoFormat;
  durationSeconds: number | null;
  thresholdSeconds: number;
}

export function classifyFormat(
  input: FormatInput,
  thresholdSeconds: number = DEFAULT_SHORTS_THRESHOLD_SECONDS,
): FormatClassification {
  if (input.liveBroadcastContent === "live") {
    return { format: "live", durationSeconds: parseIsoDuration(input.durationIso), thresholdSeconds };
  }
  if (input.liveBroadcastContent === "upcoming") {
    return { format: "upcoming", durationSeconds: parseIsoDuration(input.durationIso), thresholdSeconds };
  }
  const durationSeconds = parseIsoDuration(input.durationIso);
  if (durationSeconds === null) {
    return { format: "unknown", durationSeconds: null, thresholdSeconds };
  }
  return {
    format: durationSeconds <= thresholdSeconds ? "short" : "long",
    durationSeconds,
    thresholdSeconds,
  };
}

/** Comparable formats for baseline math: never mix Shorts with long-form. */
export function comparableFormatGroup(format: VideoFormat): "short" | "long" | null {
  if (format === "short" || format === "long") return format;
  return null;
}
