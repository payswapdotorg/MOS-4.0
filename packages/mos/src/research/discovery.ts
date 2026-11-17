import type { YouTubeClient } from "../youtube/client.js";
import type { ProvenanceRecord } from "./evidence.js";
import { provenanceFor } from "./evidence.js";
import type { SearchPlan } from "./planner.js";
import type { NicheDefinition } from "./niche.js";

/**
 * Workflow D — discovery. Executes the approved search plan, deduplicates
 * video IDs across themes and orderings, applies the niche's post-filters,
 * and records provenance for every collected result. Failed requests are
 * collected per-request: a scan that lost a theme reports partial, never a
 * silent success.
 */

export interface DiscoveredVideo {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle?: string;
  publishedAt: string;
  foundVia: { themeId: string; order: string }[];
}

export interface DiscoveryFailure {
  themeId: string;
  order: string;
  query: string;
  message: string;
}

export interface DiscoveryResult {
  videos: DiscoveredVideo[];
  failures: DiscoveryFailure[];
  provenance: ProvenanceRecord[];
  searchCallsMade: number;
}

export interface DiscoveryHooks {
  onProgress?: (progress: { phase: string; themeId?: string; candidatesSoFar: number }) => void;
  now?: () => Date;
}

export async function discoverVideos(
  client: YouTubeClient,
  niche: NicheDefinition,
  plan: SearchPlan,
  hooks: DiscoveryHooks = {},
): Promise<DiscoveryResult> {
  const now = hooks.now ?? ((): Date => new Date());
  const byVideo = new Map<string, DiscoveredVideo>();
  const failures: DiscoveryFailure[] = [];
  const provenance: ProvenanceRecord[] = [];
  let searchCallsMade = 0;

  for (const request of plan.requests) {
    hooks.onProgress?.({ phase: "search", themeId: request.themeId, candidatesSoFar: byVideo.size });
    try {
      const page = await client.searchVideos({
        query: request.query,
        order: request.order,
        maxResults: request.maxResults,
        regionCode: request.regionCode,
        relevanceLanguage: request.relevanceLanguage,
        publishedAfter: request.publishedAfter,
        publishedBefore: request.publishedBefore,
        videoDuration: request.videoDuration,
      });
      searchCallsMade += 1;
      provenance.push(
        provenanceFor(
          "youtube-data-api-v3",
          "search.list",
          "youtube.search.videos",
          { q: request.query, order: request.order, maxResults: request.maxResults },
          now().toISOString(),
        ),
      );
      for (const item of page.items) {
        const existing = byVideo.get(item.id.videoId);
        if (existing) {
          existing.foundVia.push({ themeId: request.themeId, order: request.order });
          continue;
        }
        byVideo.set(item.id.videoId, {
          videoId: item.id.videoId,
          title: item.snippet.title,
          channelId: item.snippet.channelId,
          channelTitle: item.snippet.channelTitle,
          publishedAt: item.snippet.publishedAt,
          foundVia: [{ themeId: request.themeId, order: request.order }],
        });
      }
    } catch (error) {
      failures.push({
        themeId: request.themeId,
        order: request.order,
        query: request.query,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const videos = [...byVideo.values()].filter((video) => passesNicheFilters(video, niche, now()));
  return { videos, failures, provenance, searchCallsMade };
}

function passesNicheFilters(video: DiscoveredVideo, niche: NicheDefinition, now: Date): boolean {
  const publishedMs = Date.parse(video.publishedAt);
  if (Number.isFinite(publishedMs)) {
    const ageDays = (now.getTime() - publishedMs) / 86_400_000;
    if (ageDays > niche.dateWindowDays) return false;
  }
  if (niche.exclusions.length > 0) {
    const title = video.title.toLowerCase();
    if (niche.exclusions.some((exclusion) => title.includes(exclusion.toLowerCase()))) {
      return false;
    }
  }
  return true;
}
