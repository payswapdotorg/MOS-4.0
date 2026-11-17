import { describe, expect, it } from "vitest";

import { QuotaLedger, QuotaExhaustedError } from "../src/quota/ledger.js";
import {
  QuotaExhaustedApiError,
  YouTubeApiError,
} from "../src/youtube/http.js";
import { YouTubeClient } from "../src/youtube/client.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function searchPage(videoIds: string[]) {
  return {
    items: videoIds.map((videoId) => ({
      id: { videoId },
      snippet: {
        title: `Video ${videoId}`,
        channelId: "channel-1",
        channelTitle: "Channel One",
        publishedAt: "2026-10-01T00:00:00Z",
        liveBroadcastContent: "none",
      },
    })),
  };
}

describe("YouTubeClient", () => {
  it("sends the OAuth bearer token and parses search results", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const client = new YouTubeClient({
      auth: { type: "oauth", getAccessToken: async () => "token-123" },
      fetch: async (url, init) => {
        calls.push({ url, headers: new Headers(init?.headers) });
        return jsonResponse(searchPage(["v1", "v2"]));
      },
    });
    const page = await client.searchVideos({ query: "home workout" });
    expect(page.items.map((item) => item.id.videoId)).toEqual(["v1", "v2"]);
    expect(calls.length).toBe(1);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer token-123");
    expect(calls[0]!.url).toContain("q=home+workout");
    expect(calls[0]!.url).toContain("type=video");
  });

  it("uses the API key as a query parameter in apiKey mode", async () => {
    const urls: string[] = [];
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "my-key" },
      fetch: async (url) => {
        urls.push(url);
        return jsonResponse(searchPage([]));
      },
    });
    await client.searchVideos({ query: "test" });
    expect(urls[0]).toContain("key=my-key");
  });

  it("does not retry a fatal quota 403 and throws QuotaExhaustedApiError", async () => {
    let fetchCount = 0;
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "k" },
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse(
          { error: { code: 403, message: "Quota exceeded", errors: [{ reason: "quotaExceeded" }] } },
          403,
        );
      },
    });
    await expect(client.searchVideos({ query: "x" })).rejects.toBeInstanceOf(QuotaExhaustedApiError);
    expect(fetchCount).toBe(1);
  });

  it("retries a 500 once and then succeeds, with exponential backoff", async () => {
    const sleeps: number[] = [];
    let fetchCount = 0;
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "k" },
      fetch: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return jsonResponse({ error: { code: 500, message: "backendError" } }, 500);
        }
        return jsonResponse(searchPage(["v1"]));
      },
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const page = await client.searchVideos({ query: "x" });
    expect(page.items.length).toBe(1);
    expect(fetchCount).toBe(2);
    expect(sleeps).toEqual([500]);
  });

  it("honors Retry-After on 429 responses", async () => {
    const sleeps: number[] = [];
    let fetchCount = 0;
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "k" },
      fetch: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return jsonResponse({ error: { code: 429, message: "rate" } }, 429, { "retry-after": "2" });
        }
        return jsonResponse(searchPage([]));
      },
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await client.searchVideos({ query: "x" });
    expect(sleeps).toEqual([2000]);
  });

  it("does not retry plain 400 errors", async () => {
    let fetchCount = 0;
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "k" },
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse({ error: { code: 400, message: "Bad request", errors: [{ reason: "badRequest" }] } }, 400);
      },
    });
    await expect(client.searchVideos({ query: "x" })).rejects.toBeInstanceOf(YouTubeApiError);
    expect(fetchCount).toBe(1);
  });

  it("chunks listVideos at 50 ids per request and records one unit each", async () => {
    const ledger = new QuotaLedger();
    const urls: string[] = [];
    const ids = Array.from({ length: 120 }, (_, index) => `v${index}`);
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "k" },
      ledger,
      fetch: async (url) => {
        urls.push(url);
        const requested = new URL(url).searchParams.get("id")?.split(",") ?? [];
        return jsonResponse({
          items: requested.map((id) => ({
            id,
            snippet: { title: id, channelId: "c", publishedAt: "2026-10-01T00:00:00Z" },
            statistics: { viewCount: "10" },
            contentDetails: { duration: "PT10M" },
          })),
        });
      },
    });
    const videos = await client.listVideos(ids);
    expect(videos.length).toBe(120);
    expect(urls.length).toBe(3);
    expect(ledger.snapshot().unitsUsed).toBe(3);
  });

  it("fails fast from the local ledger when the budget is exhausted (no API call)", async () => {
    const ledger = new QuotaLedger({ searchCallsLimit: 1 });
    let fetchCount = 0;
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "k" },
      ledger,
      fetch: async () => {
        fetchCount += 1;
        return jsonResponse(searchPage([]));
      },
    });
    await client.searchVideos({ query: "first" });
    await expect(client.searchVideos({ query: "second" })).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(fetchCount).toBe(1);
  });

  it("throws a schema error when the response shape drifts", async () => {
    const client = new YouTubeClient({
      auth: { type: "apiKey", key: "k" },
      fetch: async () => jsonResponse({ items: [{ unexpected: true }] }),
    });
    await expect(client.searchVideos({ query: "x" })).rejects.toThrow(/did not match the pinned schema/);
  });
});
