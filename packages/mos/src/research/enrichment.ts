import type { ChannelResource, VideoResource } from "../youtube/schemas.js";
import { classifyFormat, type FormatClassification } from "./format.js";
import type { DiscoveredVideo } from "./discovery.js";

/**
 * Workflow D (steps 5–6): bulk statistics enrichment via the official
 * videos.list batching operation, plus channel resolution. Channel uploads
 * playlists are captured here so baselines can sample cheaply later.
 */

export interface EnrichedVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle?: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  isLiveOrUpcoming: boolean;
  format: FormatClassification["format"];
  foundVia: DiscoveredVideo["foundVia"];
}

export interface EnrichedChannel {
  channelId: string;
  title: string | null;
  subscriberCount: number | null;
  subscriberCountHidden: boolean;
  videoCount: number | null;
  uploadsPlaylistId: string | null;
}

export interface EnrichmentResult {
  videos: EnrichedVideo[];
  channels: Map<string, EnrichedChannel>;
  /** videos.list / channels.list requests spent. */
  unitRequests: number;
}

function toCount(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function enrichVideos(
  listVideos: (videoIds: string[]) => Promise<VideoResource[]>,
  listChannels: (channelIds: string[]) => Promise<ChannelResource[]>,
  discovered: DiscoveredVideo[],
): Promise<EnrichmentResult> {
  if (discovered.length === 0) {
    return { videos: [], channels: new Map(), unitRequests: 0 };
  }

  const videoIds = discovered.map((video) => video.videoId);
  const chunkCount = Math.ceil(videoIds.length / 50);
  const videoResources = await listVideos(videoIds);
  const resourceById = new Map(videoResources.map((resource) => [resource.id, resource]));
  const discoveredById = new Map(discovered.map((video) => [video.videoId, video]));

  const videos: EnrichedVideo[] = [];
  for (const [videoId, discoveredVideo] of discoveredById) {
    const resource = resourceById.get(videoId);
    const classification = classifyFormat({
      durationIso: resource?.contentDetails?.duration,
      liveBroadcastContent: resource?.snippet.liveBroadcastContent,
    });
    videos.push({
      videoId,
      title: resource?.snippet.title ?? discoveredVideo.title,
      channelId: discoveredVideo.channelId,
      channelTitle: resource?.snippet.channelTitle ?? discoveredVideo.channelTitle,
      publishedAt: resource?.snippet.publishedAt ?? discoveredVideo.publishedAt,
      durationSeconds: classification.durationSeconds,
      viewCount: resource?.statistics ? toCount(resource.statistics.viewCount) : null,
      likeCount: resource?.statistics ? toCount(resource.statistics.likeCount) : null,
      commentCount: resource?.statistics ? toCount(resource.statistics.commentCount) : null,
      isLiveOrUpcoming: classification.format === "live" || classification.format === "upcoming",
      format: classification.format,
      foundVia: discoveredVideo.foundVia,
    });
  }

  const uniqueChannelIds = [...new Set(discovered.map((video) => video.channelId))];
  const channelResources = await listChannels(uniqueChannelIds);
  const channelChunkCount = Math.ceil(uniqueChannelIds.length / 50);
  const channels = new Map<string, EnrichedChannel>();
  for (const resource of channelResources) {
    channels.set(resource.id, {
      channelId: resource.id,
      title: resource.snippet?.title ?? null,
      subscriberCount: resource.statistics ? toCount(resource.statistics.subscriberCount) : null,
      subscriberCountHidden: resource.statistics?.hiddenSubscriberCount === true,
      videoCount: resource.statistics ? toCount(resource.statistics.videoCount) : null,
      uploadsPlaylistId: resource.contentDetails?.relatedPlaylists?.uploads ?? null,
    });
  }

  return { videos, channels, unitRequests: chunkCount + channelChunkCount };
}
