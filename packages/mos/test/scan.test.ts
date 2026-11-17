import { describe, expect, it } from "vitest";

import { QuotaLedger } from "../src/quota/ledger.js";
import { YouTubeClient } from "../src/youtube/client.js";
import { nicheDefinitionSchema } from "../src/research/niche.js";
import { runNicheScan } from "../src/research/scan.js";
import type { SearchTheme } from "../src/research/themes.js";

/**
 * Integration test (mock tier): the whole niche-scan pipeline — planning,
 * discovery, dedup, enrichment, channel sampling, baselines, scoring,
 * classification, provenance, and quota accounting — against a fake but
 * faithful YouTube Data API. Live-API verification is a separate,
 * owner-gated acceptance gate (docs/testing/).
 */

const NOW = new Date("2026-05-18T12:00:00Z");

function videoResource(
  id: string,
  options: { channelId: string; viewCount: number; publishedAt: string; duration?: string; live?: boolean; likeCount?: number; commentCount?: number },
) {
  return {
    id,
    snippet: {
      title: `Video ${id}`,
      channelId: options.channelId,
      channelTitle: `Channel ${options.channelId}`,
      publishedAt: options.publishedAt,
      liveBroadcastContent: options.live ? "live" : "none",
    },
    statistics: {
      viewCount: String(options.viewCount),
      ...(options.likeCount !== undefined ? { likeCount: String(options.likeCount) } : {}),
      ...(options.commentCount !== undefined ? { commentCount: String(options.commentCount) } : {}),
    },
    contentDetails: { duration: options.duration ?? "PT10M" },
  };
}

/** The fake world: one breakout on a big channel, one small-channel result, one live stream. */
const VIDEOS = new Map([
  ["vid-hot", videoResource("vid-hot", { channelId: "channel-1", viewCount: 200_000, publishedAt: "2026-04-18T12:00:00Z", likeCount: 6_000, commentCount: 900 })],
  ["vid-small", videoResource("vid-small", { channelId: "channel-2", viewCount: 5_000, publishedAt: "2026-02-07T12:00:00Z", likeCount: 150, commentCount: 20 })],
  ["vid-live", videoResource("vid-live", { channelId: "channel-1", viewCount: 1_200, publishedAt: "2026-05-17T12:00:00Z", live: true })],
  // channel-1 uploads: ten comparable long-form videos at 10k views → median baseline 10k.
  ...Array.from({ length: 10 }, (_, index) => [
    `samp-1-${index}`,
    videoResource(`samp-1-${index}`, { channelId: "channel-1", viewCount: 10_000, publishedAt: "2026-03-01T00:00:00Z" }),
  ] as const),
  // channel-2 uploads: six comparable videos at 1k views → median baseline 1k.
  ...Array.from({ length: 6 }, (_, index) => [
    `samp-2-${index}`,
    videoResource(`samp-2-${index}`, { channelId: "channel-2", viewCount: 1_000, publishedAt: "2026-03-01T00:00:00Z" }),
  ] as const),
]);

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const fetchMock = async (url: string): Promise<Response> => {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/search")) {
    return jsonResponse({
      items: ["vid-hot", "vid-small", "vid-live"].map((videoId) => ({
        id: { videoId },
        snippet: {
          title: `Video ${videoId}`,
          channelId: VIDEOS.get(videoId)!.snippet.channelId,
          channelTitle: `Channel ${VIDEOS.get(videoId)!.snippet.channelId}`,
          publishedAt: VIDEOS.get(videoId)!.snippet.publishedAt,
          liveBroadcastContent: videoId === "vid-live" ? "live" : "none",
        },
      })),
    });
  }
  if (parsed.pathname.endsWith("/videos")) {
    const ids = (parsed.searchParams.get("id") ?? "").split(",").filter(Boolean);
    return jsonResponse({ items: ids.map((id) => VIDEOS.get(id)).filter(Boolean) });
  }
  if (parsed.pathname.endsWith("/channels")) {
    return jsonResponse({
      items: [
        {
          id: "channel-1",
          snippet: { title: "Big Channel" },
          statistics: { subscriberCount: "500000", videoCount: "300" },
          contentDetails: { relatedPlaylists: { uploads: "PL-1" } },
        },
        {
          id: "channel-2",
          snippet: { title: "Small Channel" },
          statistics: { subscriberCount: "5000", videoCount: "40" },
          contentDetails: { relatedPlaylists: { uploads: "PL-2" } },
        },
      ],
    });
  }
  if (parsed.pathname.endsWith("/playlistItems")) {
    const playlistId = parsed.searchParams.get("playlistId");
    const prefix = playlistId === "PL-1" ? "samp-1-" : "samp-2-";
    const count = playlistId === "PL-1" ? 10 : 6;
    return jsonResponse({
      items: Array.from({ length: count }, (_, index) => ({
        snippet: {
          channelId: playlistId === "PL-1" ? "channel-1" : "channel-2",
          title: `Sample ${index}`,
          publishedAt: "2026-03-01T00:00:00Z",
          resourceId: { videoId: `${prefix}${index}` },
        },
      })),
    });
  }
  throw new Error(`unexpected URL in fake world: ${url}`);
};

const themes: SearchTheme[] = [
  { id: "theme-1", text: "home workout routines" },
  { id: "theme-2", text: "home workout for beginners" },
];

async function runScan() {
  const ledger = new QuotaLedger();
  const client = new YouTubeClient({ auth: { type: "apiKey", key: "test" }, fetch: fetchMock, ledger });
  const niche = nicheDefinitionSchema.parse({ description: "Home workout routines", depth: "quick" });
  return {
    ledger,
    result: await runNicheScan({ client, ledger, now: () => NOW }, niche, themes),
  };
}

describe("runNicheScan (mock integration)", () => {
  it("runs the full pipeline with honest accounting", async () => {
    const { result, ledger } = await runScan();

    // Planning: 2 themes → 2 relevance + secondary orderings within the quick budget (5).
    expect(result.plan.requests.length).toBeGreaterThanOrEqual(2);
    expect(result.plan.requests.length).toBeLessThanOrEqual(5);
    expect(result.usage.searchCalls).toBe(result.plan.requests.length);

    // Discovery dedups the repeated ids across searches → 3 unique, 1 live excluded.
    expect(result.excludedLiveCount).toBe(1);
    expect(result.videos.length).toBe(2);

    // Status and provenance.
    expect(result.status).toBe("complete");
    expect(result.provenance.length).toBeGreaterThanOrEqual(result.plan.requests.length);

    // Quota: search bucket spent exactly the planned calls; units = candidates + channels + sample enrichment.
    expect(ledger.snapshot().searchCallsUsed).toBe(result.usage.searchCalls);
    expect(ledger.snapshot().unitsUsed).toBe(result.usage.units);
    expect(result.usage.units).toBeGreaterThanOrEqual(3);

    // Breakout: 200k views vs 10k median baseline on channel-1.
    const hot = result.videos.find((entry) => entry.video.videoId === "vid-hot");
    expect(hot).toBeDefined();
    expect(hot!.baseline.available).toBe(true);
    expect(hot!.baseline.medianViews).toBe(10_000);
    expect(hot!.breakoutRatio).toBe(20);
    expect(hot!.score.overall).not.toBeNull();
    expect(hot!.classification.views).toContain("breakout");

    // Small channel: 5k views vs 1k baseline, 5k subscribers → new entrant.
    const small = result.videos.find((entry) => entry.video.videoId === "vid-small");
    expect(small).toBeDefined();
    expect(small!.breakoutRatio).toBe(5);
    expect(small!.classification.views).toContain("new-entrant");

    // Sorting: best overall first; the model version is recorded for reproducibility.
    expect(result.videos[0]!.score.overall!).toBeGreaterThanOrEqual(result.videos[1]!.score.overall!);
    expect(result.modelVersion).toBe("mos-scoring-v1");
  });

  it("is deterministic across runs (same world → same scores)", async () => {
    const first = await runScan();
    const second = await runScan();
    expect(first.result.videos.map((entry) => entry.score.overall)).toEqual(
      second.result.videos.map((entry) => entry.score.overall),
    );
    expect(first.result.videos.map((entry) => entry.video.videoId)).toEqual(
      second.result.videos.map((entry) => entry.video.videoId),
    );
    // Scan ids are unique per run.
    expect(first.result.scanId).not.toBe(second.result.scanId);
  });
});
