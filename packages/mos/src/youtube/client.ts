import { QuotaExhaustedError, type QuotaCost, type QuotaLedger } from "../quota/ledger.js";
import {
  buildQueryUrl,
  DEFAULT_RETRY_POLICY,
  fetchJsonWithRetry,
  type FetchLike,
  type RetryPolicy,
  type SleepLike,
  YouTubeApiError,
} from "./http.js";
import {
  channelListResponseSchema,
  playlistItemListResponseSchema,
  searchListResponseSchema,
  videoListResponseSchema,
  type ChannelListResponse,
  type PlaylistItemListResponse,
  type SearchListResponse,
  type VideoListResponse,
} from "./schemas.js";

export const YOUTUBE_DATA_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
export const MAX_IDS_PER_REQUEST = 50;

export type YouTubeAuth =
  | { type: "oauth"; getAccessToken: () => Promise<string> }
  | { type: "apiKey"; key: string };

export type SearchOrder = "relevance" | "date" | "viewCount" | "rating";
export type VideoDurationBucket = "any" | "short" | "medium" | "long";

export interface SearchVideosRequest {
  query: string;
  order?: SearchOrder;
  maxResults?: number;
  regionCode?: string;
  relevanceLanguage?: string;
  publishedAfter?: string;
  publishedBefore?: string;
  videoDuration?: VideoDurationBucket;
  pageToken?: string;
}

export interface SearchPage {
  items: SearchListResponse["items"];
  nextPageToken?: string;
}

export interface ListPlaylistItemsRequest {
  playlistId: string;
  maxResults?: number;
  pageToken?: string;
}

export interface YouTubeClientOptions {
  auth: YouTubeAuth;
  fetch?: FetchLike;
  baseUrl?: string;
  ledger?: QuotaLedger;
  retry?: RetryPolicy;
  sleep?: SleepLike;
  onRequest?: (info: { url: string; cost: QuotaCost }) => void;
}

/**
 * Typed client for the official YouTube Data API v3, wired to the quota
 * ledger. Every request: (1) checks the local ledger so exhausted budgets
 * fail fast without spending an API round-trip, (2) executes with the shared
 * retry policy, (3) records the real quota cost, and (4) validates the
 * response against the pinned zod schemas.
 */
export class YouTubeClient {
  private readonly auth: YouTubeAuth;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;
  private readonly ledger?: QuotaLedger;
  private readonly retry: RetryPolicy;
  private readonly sleep?: SleepLike;
  private readonly onRequest?: YouTubeClientOptions["onRequest"];

  constructor(options: YouTubeClientOptions) {
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = options.baseUrl ?? YOUTUBE_DATA_API_BASE_URL;
    this.ledger = options.ledger;
    this.retry = options.retry ?? DEFAULT_RETRY_POLICY;
    this.sleep = options.sleep;
    this.onRequest = options.onRequest;
  }

  /** search.list — its own daily bucket of 100 calls (cost 1 each). */
  async searchVideos(request: SearchVideosRequest): Promise<SearchPage> {
    const url = await this.buildUrl("search", {
      part: "snippet",
      type: "video",
      q: request.query,
      order: request.order ?? "relevance",
      maxResults: clamp(request.maxResults ?? 25, 1, 50),
      regionCode: request.regionCode,
      relevanceLanguage: request.relevanceLanguage,
      publishedAfter: request.publishedAfter,
      publishedBefore: request.publishedBefore,
      videoDuration: request.videoDuration ?? "any",
      pageToken: request.pageToken,
    });
    const body = await this.call(url, { kind: "searchCall" });
    const parsed = searchListResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw schemaError("search.list", url, parsed.error.message);
    }
    return { items: parsed.data.items, nextPageToken: parsed.data.nextPageToken };
  }

  /** Convenience: iterate search pages up to `maxPages` (each page = 1 search call). */
  async searchVideoPages(request: SearchVideosRequest, maxPages: number): Promise<SearchPage[]> {
    const pages: SearchPage[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.searchVideos({ ...request, pageToken });
      pages.push(result);
      pageToken = result.nextPageToken;
      if (!pageToken) break;
    }
    return pages;
  }

  /** videos.list — 1 unit per request, at most 50 ids per request. */
  async listVideos(videoIds: string[]): Promise<VideoListResponse["items"]> {
    const chunks = chunk(videoIds, MAX_IDS_PER_REQUEST);
    const items: VideoListResponse["items"] = [];
    for (const ids of chunks) {
      if (ids.length === 0) continue;
      const url = await this.buildUrl("videos", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
      const body = await this.call(url, { kind: "units", units: 1 });
      const parsed = videoListResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw schemaError("videos.list", url, parsed.error.message);
      }
      items.push(...parsed.data.items);
    }
    return items;
  }

  /** channels.list — 1 unit per request, at most 50 ids per request. */
  async listChannels(channelIds: string[]): Promise<ChannelListResponse["items"]> {
    const chunks = chunk(channelIds, MAX_IDS_PER_REQUEST);
    const items: ChannelListResponse["items"] = [];
    for (const ids of chunks) {
      if (ids.length === 0) continue;
      const url = await this.buildUrl("channels", { part: "snippet,statistics,contentDetails", id: ids.join(",") });
      const body = await this.call(url, { kind: "units", units: 1 });
      const parsed = channelListResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw schemaError("channels.list", url, parsed.error.message);
      }
      items.push(...parsed.data.items);
    }
    return items;
  }

  /** playlistItems.list — 1 unit per request; used to sample channel uploads. */
  async listPlaylistItems(request: ListPlaylistItemsRequest): Promise<PlaylistItemListResponse> {
    const url = await this.buildUrl("playlistItems", {
      part: "snippet",
      playlistId: request.playlistId,
      maxResults: clamp(request.maxResults ?? 25, 1, 50),
      pageToken: request.pageToken,
    });
    const body = await this.call(url, { kind: "units", units: 1 });
    const parsed = playlistItemListResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw schemaError("playlistItems.list", url, parsed.error.message);
    }
    return parsed.data;
  }

  private async buildUrl(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<string> {
    const url = new URL(buildQueryUrl(this.baseUrl, path, params));
    if (this.auth.type === "oauth") {
      // Bearer token goes on the Authorization header, applied in call().
      return url.toString();
    }
    url.searchParams.set("key", this.auth.key);
    return url.toString();
  }

  private async call(url: string, cost: QuotaCost): Promise<unknown> {
    if (this.ledger && !this.ledger.canAfford(cost)) {
      throw new QuotaExhaustedError(cost.kind === "searchCall" ? "searchCalls" : "units", this.ledger.snapshot());
    }
    const headers: Record<string, string> = {};
    if (this.auth.type === "oauth") {
      headers.Authorization = `Bearer ${await this.auth.getAccessToken()}`;
    }
    this.onRequest?.({ url, cost });
    const body = await fetchJsonWithRetry(url, {
      fetch: (requestUrl) => this.fetchImpl(requestUrl, { headers }),
      retry: this.retry,
      sleep: this.sleep,
    });
    this.ledger?.record(cost);
    return body;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function schemaError(method: string, url: string, detail: string): YouTubeApiError {
  return new YouTubeApiError(
    `${method} response did not match the pinned schema (upstream API change?): ${detail.slice(0, 300)}`,
    0,
    "schemaMismatch",
    false,
    url,
  );
}
