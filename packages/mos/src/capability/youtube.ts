import { z } from "zod";

import type { CapabilityDefinition, CapabilityId } from "./types.js";
import {
  YOUTUBE_ANALYTICS_READONLY_SCOPE,
  YOUTUBE_READONLY_SCOPE,
} from "../youtube/oauth.js";
import {
  channelListResponseSchema,
  playlistItemListResponseSchema,
  searchListResponseSchema,
  videoListResponseSchema,
} from "../youtube/schemas.js";

/**
 * The typed YouTube capability registry. Verification statuses are honest:
 * as of 2026-11-17 every Google endpoint was probed for reachability and
 * correct unauthenticated error semantics from the build environment, but no
 * authorized live call has been made yet (owner Google Cloud project pending).
 * Nothing here may be surfaced to users as "verified" beyond that.
 */

const REACHABILITY_EVIDENCE =
  "Endpoint reachability and unauthenticated error semantics verified via HTTPS probes from the build environment on 2026-11-17 (accounts.google.com 302, googleapis.com 401/403 with structured error bodies).";

const searchRequestSchema = z.object({
  query: z.string().min(1).max(100),
  order: z.enum(["relevance", "date", "viewCount", "rating"]).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
  regionCode: z.string().length(2).optional(),
  relevanceLanguage: z.string().min(2).max(35).optional(),
  publishedAfter: z.string().optional(),
  publishedBefore: z.string().optional(),
  videoDuration: z.enum(["any", "short", "medium", "long"]).optional(),
  pageToken: z.string().optional(),
});

const videoDetailRequestSchema = z.object({ videoId: z.string().min(1) });
const statsBulkRequestSchema = z.object({ videoIds: z.array(z.string().min(1)).min(1).max(50) });
const channelProfileRequestSchema = z.object({ channelId: z.string().min(1) });
const channelUploadsRequestSchema = z.object({
  channelId: z.string().min(1),
  maxResults: z.number().int().min(1).max(50).optional(),
});
const channelAnalyticsRequestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metrics: z.string().min(1),
});

export const youtubeCapabilities: Record<CapabilityId, CapabilityDefinition> = {
  "youtube.search.videos": {
    id: "youtube.search.videos",
    description: "Discover public videos matching a search theme.",
    endpoint: { baseUrl: "https://www.googleapis.com/youtube/v3", method: "GET", path: "/search" },
    scopes: [YOUTUBE_READONLY_SCOPE],
    credentialType: "oauth",
    quota: { kind: "searchCall" },
    rateLimit: {
      maxRetries: 3,
      retryOn: ["429", "5xx", "403/userRateLimitExceeded"],
      notes: "search.list has its own 100-calls/day default bucket (cost 1 per call), separate from the 10,000-unit pool.",
    },
    errorHandling:
      "403 quotaExceeded/dailyLimitExceeded/rateLimitExceeded → QuotaExhaustedApiError (no retry, user-facing exhaustion message); 429/5xx/userRateLimitExceeded → bounded backoff with Retry-After; other 4xx → typed error surfaced to the scan report.",
    verification: { status: "verified-reachability", evidence: REACHABILITY_EVIDENCE, verifiedAt: "2026-11-17" },
    requestSchema: searchRequestSchema,
    responseSchema: searchListResponseSchema,
    enabledByDefault: true,
  },
  "youtube.video.detail": {
    id: "youtube.video.detail",
    description: "Retrieve public metadata and statistics for one video.",
    endpoint: { baseUrl: "https://www.googleapis.com/youtube/v3", method: "GET", path: "/videos" },
    scopes: [YOUTUBE_READONLY_SCOPE],
    credentialType: "oauth",
    quota: { kind: "units", units: 1 },
    rateLimit: { maxRetries: 3, retryOn: ["429", "5xx", "403/userRateLimitExceeded"] },
    errorHandling: "Same policy as youtube.search.videos; schema mismatches fail loudly (API drift protection).",
    verification: { status: "verified-reachability", evidence: REACHABILITY_EVIDENCE, verifiedAt: "2026-11-17" },
    requestSchema: videoDetailRequestSchema,
    responseSchema: videoListResponseSchema,
    enabledByDefault: true,
  },
  "youtube.video.stats.bulk": {
    id: "youtube.video.stats.bulk",
    description: "Efficiently enrich up to 50 video IDs in one videos.list request.",
    endpoint: { baseUrl: "https://www.googleapis.com/youtube/v3", method: "GET", path: "/videos" },
    scopes: [YOUTUBE_READONLY_SCOPE],
    credentialType: "oauth",
    quota: { kind: "units", units: 1 },
    rateLimit: { maxRetries: 3, retryOn: ["429", "5xx", "403/userRateLimitExceeded"] },
    errorHandling: "Chunked by the client at 50 ids/request; each request costs 1 unit and is recorded in the ledger.",
    verification: { status: "verified-reachability", evidence: REACHABILITY_EVIDENCE, verifiedAt: "2026-11-17" },
    requestSchema: statsBulkRequestSchema,
    responseSchema: videoListResponseSchema,
    enabledByDefault: true,
  },
  "youtube.channel.profile": {
    id: "youtube.channel.profile",
    description: "Retrieve public channel information (title, subscribers, uploads playlist).",
    endpoint: { baseUrl: "https://www.googleapis.com/youtube/v3", method: "GET", path: "/channels" },
    scopes: [YOUTUBE_READONLY_SCOPE],
    credentialType: "oauth",
    quota: { kind: "units", units: 1 },
    rateLimit: { maxRetries: 3, retryOn: ["429", "5xx", "403/userRateLimitExceeded"] },
    errorHandling: "Same policy as youtube.search.videos; hidden subscriber counts are surfaced as hidden, not zero.",
    verification: { status: "verified-reachability", evidence: REACHABILITY_EVIDENCE, verifiedAt: "2026-11-17" },
    requestSchema: channelProfileRequestSchema,
    responseSchema: channelListResponseSchema,
    enabledByDefault: true,
  },
  "youtube.channel.uploads": {
    id: "youtube.channel.uploads",
    description: "Sample a channel's recent public uploads via its uploads playlist (cheap alternative to repeated searches).",
    endpoint: { baseUrl: "https://www.googleapis.com/youtube/v3", method: "GET", path: "/playlistItems" },
    scopes: [YOUTUBE_READONLY_SCOPE],
    credentialType: "oauth",
    quota: { kind: "units", units: 1 },
    rateLimit: { maxRetries: 3, retryOn: ["429", "5xx", "403/userRateLimitExceeded"] },
    errorHandling: "Same policy as youtube.search.videos; used for channel baselines, never for discovery expansion.",
    verification: { status: "verified-reachability", evidence: REACHABILITY_EVIDENCE, verifiedAt: "2026-11-17" },
    requestSchema: channelUploadsRequestSchema,
    responseSchema: playlistItemListResponseSchema,
    enabledByDefault: true,
  },
  "youtube.channel.analytics": {
    id: "youtube.channel.analytics",
    description:
      "Retrieve private analytics reports for the user's own authorized channel (watch time, average view duration, impressions, CTR).",
    endpoint: { baseUrl: "https://youtubeanalytics.googleapis.com/v2", method: "GET", path: "/reports" },
    scopes: [YOUTUBE_ANALYTICS_READONLY_SCOPE],
    credentialType: "oauth-analytics",
    quota: { kind: "units", units: 1 },
    rateLimit: { maxRetries: 3, retryOn: ["429", "5xx", "403/userRateLimitExceeded"] },
    errorHandling:
      "Opt-in only: requires a separate sensitive scope and the owner's Google Cloud project; failures never break public research.",
    verification: { status: "pending-live-verification", evidence: "Endpoint reachability verified (401 unauthenticated); authorized behavior not yet exercised." },
    requestSchema: channelAnalyticsRequestSchema,
    responseSchema: z.object({ rows: z.array(z.array(z.union([z.string(), z.number()]))).optional() }),
    enabledByDefault: false,
  },
};

export function getCapability(id: CapabilityId): CapabilityDefinition {
  return youtubeCapabilities[id];
}

export function listCapabilities(): CapabilityDefinition[] {
  return Object.values(youtubeCapabilities);
}
