import type { EnrichedVideo } from "./enrichment.js";
import { comparableFormatGroup } from "./format.js";

/**
 * Workflow E — channel baselines. A video's total views alone say little; the
 * baseline is the MEDIAN view count of the channel's recent comparable public
 * videos (same format group, candidate excluded). Channels with too little
 * comparable history get an explicitly unavailable baseline, which lowers the
 * score confidence instead of inventing a number.
 */

export const MIN_BASELINE_SAMPLE = 3;
export const RECOMMENDED_BASELINE_SAMPLE = 5;

export interface BaselineVideo {
  videoId: string;
  viewCount: number;
  publishedAt: string | null;
  format: string;
}

export interface ChannelBaseline {
  channelId: string;
  formatGroup: "short" | "long";
  sampleSize: number;
  medianViews: number | null;
  baselineVideos: BaselineVideo[];
  available: boolean;
  lowConfidence: boolean;
  note: string;
}

export function computeBaseline(
  candidate: Pick<EnrichedVideo, "videoId" | "channelId" | "format" | "viewCount">,
  samples: { videoId: string; viewCount: number | null; publishedAt: string | null; format: string }[],
): ChannelBaseline {
  const formatGroup = comparableFormatGroup(candidate.format);
  if (formatGroup === null) {
    return unavailable(candidate.channelId, "short", samples.length, "Candidate is a live stream or has no format; baselines compare only Shorts or long-form.");
  }

  const comparable = samples.filter((sample) => {
    if (sample.videoId === candidate.videoId) return false;
    const sampleGroup = comparableFormatGroup(sample.format as Parameters<typeof comparableFormatGroup>[0]);
    return sampleGroup === formatGroup && sample.viewCount !== null && sample.viewCount > 0;
  });

  if (comparable.length < MIN_BASELINE_SAMPLE) {
    return unavailable(
      candidate.channelId,
      formatGroup,
      comparable.length,
      `Insufficient public history: ${comparable.length} comparable ${formatGroup} video(s) found (need ${MIN_BASELINE_SAMPLE}).`,
    );
  }

  const viewCounts = comparable
    .map((sample) => sample.viewCount)
    .filter((count): count is number => count !== null)
    .sort((a, b) => a - b);
  const medianViews = median(viewCounts);
  const lowConfidence = comparable.length < RECOMMENDED_BASELINE_SAMPLE;

  return {
    channelId: candidate.channelId,
    formatGroup,
    sampleSize: comparable.length,
    medianViews,
    baselineVideos: comparable.map((sample) => ({
      videoId: sample.videoId,
      viewCount: sample.viewCount ?? 0,
      publishedAt: sample.publishedAt,
      format: sample.format,
    })),
    available: medianViews !== null,
    lowConfidence,
    note: lowConfidence
      ? `Baseline from ${comparable.length} comparable videos (below the recommended ${RECOMMENDED_BASELINE_SAMPLE}); confidence reduced.`
      : `Baseline from ${comparable.length} comparable ${formatGroup} videos (median).`,
  };
}

function unavailable(channelId: string, formatGroup: "short" | "long", sampleSize: number, note: string): ChannelBaseline {
  return {
    channelId,
    formatGroup,
    sampleSize,
    medianViews: null,
    baselineVideos: [],
    available: false,
    lowConfidence: true,
    note,
  };
}

export function median(sortedValues: number[]): number | null {
  if (sortedValues.length === 0) return null;
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle] ?? null;
  }
  const left = sortedValues[middle - 1] ?? 0;
  const right = sortedValues[middle] ?? 0;
  return (left + right) / 2;
}

/** Breakout ratio: candidate views vs the channel baseline median. */
export function breakoutRatio(candidateViews: number, baseline: ChannelBaseline): number | null {
  if (!baseline.available || baseline.medianViews === null || baseline.medianViews <= 0) return null;
  return candidateViews / baseline.medianViews;
}
