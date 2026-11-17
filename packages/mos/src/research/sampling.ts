import type { YouTubeClient } from "../youtube/client.js";
import type { VideoResource } from "../youtube/schemas.js";
import type { EnrichedChannel, EnrichedVideo } from "./enrichment.js";
import { classifyFormat, comparableFormatGroup, type VideoFormat } from "./format.js";
import type { NicheDefinition } from "./niche.js";
import { DEPTH_CHANNEL_SAMPLE_BUDGETS, DEPTH_PER_CHANNEL_SAMPLE_SIZE } from "./niche.js";

/**
 * Workflow E — channel sampling. Baselines are built from each channel's
 * recent comparable uploads (its uploads playlist — 1 cheap unit request per
 * channel), never from more searches. Channels are prioritized by how many
 * candidate videos they contributed, and the per-scan channel budget from the
 * niche depth is always respected.
 */

export interface ChannelSample {
  videoId: string;
  channelId: string;
  title: string | null;
  publishedAt: string | null;
}

export interface SamplingResult {
  samplesByChannel: Map<string, ChannelSample[]>;
  unitRequests: number;
  /** Channels skipped because the scan budget was reached. */
  skippedChannels: string[];
}

export async function sampleChannelUploads(
  client: YouTubeClient,
  niche: NicheDefinition,
  videos: EnrichedVideo[],
  channels: Map<string, EnrichedChannel>,
): Promise<SamplingResult> {
  const budget = DEPTH_CHANNEL_SAMPLE_BUDGETS[niche.depth];
  const perChannel = DEPTH_PER_CHANNEL_SAMPLE_SIZE[niche.depth];

  const candidateCount = new Map<string, number>();
  for (const video of videos) {
    candidateCount.set(video.channelId, (candidateCount.get(video.channelId) ?? 0) + 1);
  }
  const rankedChannelIds = [...candidateCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([channelId]) => channelId);

  const samplesByChannel = new Map<string, ChannelSample[]>();
  const skippedChannels: string[] = [];
  let unitRequests = 0;

  for (const channelId of rankedChannelIds) {
    if (samplesByChannel.size >= budget) {
      skippedChannels.push(channelId);
      continue;
    }
    const channel = channels.get(channelId);
    const uploadsPlaylistId = channel?.uploadsPlaylistId;
    if (!uploadsPlaylistId) {
      // No uploads playlist → baseline will be unavailable for this channel.
      samplesByChannel.set(channelId, []);
      continue;
    }
    try {
      const page = await client.listPlaylistItems({ playlistId: uploadsPlaylistId, maxResults: perChannel });
      unitRequests += 1;
      samplesByChannel.set(
        channelId,
        page.items.map((item) => ({
          videoId: item.snippet.resourceId.videoId,
          channelId: item.snippet.channelId,
          title: item.snippet.title ?? null,
          publishedAt: item.snippet.publishedAt ?? null,
        })),
      );
    } catch {
      // Sampling failure marks the baseline unavailable; it must not fail the scan.
      samplesByChannel.set(channelId, []);
    }
  }

  return { samplesByChannel, unitRequests, skippedChannels };
}

/** Formats that participate in baseline comparisons for a given niche format filter. */
export function comparableFormatsForNiche(nicheFormat: NicheDefinition["format"]): VideoFormat[] {
  if (nicheFormat === "short") return ["short"];
  if (nicheFormat === "long") return ["long"];
  return ["short", "long"];
}

export interface SampleVideoStats {
  videoId: string;
  viewCount: number | null;
  publishedAt: string | null;
  format: VideoFormat;
}

/**
 * Baseline math needs each sample's view count and format; playlist items
 * carry neither, so sampled ids are bulk-enriched through videos.list (the
 * efficient batch statistics operation, ≤50 ids per unit).
 */
export async function enrichSampleStats(
  listVideos: (videoIds: string[]) => Promise<import("../youtube/schemas.js").VideoResource[]>,
  samplesByChannel: Map<string, ChannelSample[]>,
): Promise<{ statsByVideo: Map<string, SampleVideoStats>; unitRequests: number }> {
  const allIds = [...new Set([...samplesByChannel.values()].flat().map((sample) => sample.videoId))];
  if (allIds.length === 0) {
    return { statsByVideo: new Map(), unitRequests: 0 };
  }
  const resources = await listVideos(allIds);
  const statsByVideo = new Map<string, SampleVideoStats>();
  for (const resource of resources) {
    const classification = classifyFormat({
      durationIso: resource.contentDetails?.duration,
      liveBroadcastContent: resource.snippet.liveBroadcastContent,
    });
    const viewCount = resource.statistics?.viewCount !== undefined ? Number(resource.statistics.viewCount) : null;
    statsByVideo.set(resource.id, {
      videoId: resource.id,
      viewCount: Number.isFinite(viewCount) ? viewCount : null,
      publishedAt: resource.snippet.publishedAt ?? null,
      format: classification.format,
    });
  }
  return { statsByVideo, unitRequests: Math.ceil(allIds.length / 50) };
}

export function isComparableSample(
  sample: ChannelSample,
  candidate: EnrichedVideo,
  sampleFormats: Map<string, VideoFormat>,
): boolean {
  if (sample.videoId === candidate.videoId) return false;
  const candidateGroup = comparableFormatGroup(candidate.format);
  const sampleGroup = comparableFormatGroup(sampleFormats.get(sample.videoId) ?? "unknown");
  return candidateGroup !== null && sampleGroup === candidateGroup;
}
