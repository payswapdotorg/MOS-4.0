import { describe, expect, it } from "vitest";

import {
  computeMomentum,
  digestParams,
  isScanStale,
  isStatisticsFresh,
  provenanceFor,
  SCAN_STALE_DAYS,
  STATISTICS_TTL_DAYS,
} from "../src/research/evidence.js";

const NOW = new Date("2026-11-17T12:00:00Z");

describe("freshness", () => {
  it("statistics stay fresh for the documented TTL and expire after", () => {
    expect(isStatisticsFresh("2026-11-15T12:00:00Z", NOW)).toBe(true); // 2 days
    expect(isStatisticsFresh(new Date(NOW.getTime() - STATISTICS_TTL_DAYS * 86_400_000).toISOString(), NOW)).toBe(true);
    expect(isStatisticsFresh("2026-11-01T12:00:00Z", NOW)).toBe(false); // 16 days
  });

  it("scans go stale after the scan window", () => {
    expect(isScanStale("2026-11-10T12:00:00Z", NOW)).toBe(false);
    expect(isScanStale(new Date(NOW.getTime() - (SCAN_STALE_DAYS + 1) * 86_400_000).toISOString(), NOW)).toBe(true);
  });
});

describe("provenance", () => {
  it("records source, method, capability, digest, and time", () => {
    const record = provenanceFor("youtube-data-api-v3", "search.list", "youtube.search.videos", { q: "x", order: "date" }, NOW.toISOString());
    expect(record).toEqual({
      source: "youtube-data-api-v3",
      method: "search.list",
      capabilityId: "youtube.search.videos",
      requestDigest: expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/),
      collectedAt: NOW.toISOString(),
    });
  });

  it("digests are stable and parameter-order insensitive", () => {
    expect(digestParams({ a: "1", b: "2" })).toBe(digestParams({ b: "2", a: "1" }));
    expect(digestParams({ a: "1" })).not.toBe(digestParams({ a: "2" }));
  });
});

describe("computeMomentum", () => {
  it("measures observed views/day across two observations ≥1 day apart", () => {
    const momentum = computeMomentum([
      { videoId: "v1", observedAt: "2026-11-07T12:00:00Z", viewCount: 10_000, likeCount: 1, commentCount: 1 },
      { videoId: "v1", observedAt: "2026-11-17T12:00:00Z", viewCount: 12_000, likeCount: 1, commentCount: 1 },
    ]);
    expect(momentum).not.toBeNull();
    expect(momentum!.observedViewsPerDay).toBeCloseTo(200, 6);
    expect(momentum!.spanDays).toBeCloseTo(10, 6);
    expect(momentum!.observationCount).toBe(2);
  });

  it("a single observation is never a growth rate", () => {
    expect(
      computeMomentum([{ videoId: "v1", observedAt: "2026-11-17T12:00:00Z", viewCount: 1, likeCount: null, commentCount: null }]),
    ).toBeNull();
  });

  it("observations less than a day apart do not claim momentum", () => {
    expect(
      computeMomentum([
        { videoId: "v1", observedAt: "2026-11-17T00:00:00Z", viewCount: 100, likeCount: null, commentCount: null },
        { videoId: "v1", observedAt: "2026-11-17T12:00:00Z", viewCount: 200, likeCount: null, commentCount: null },
      ]),
    ).toBeNull();
  });

  it("ignores observations without view counts", () => {
    expect(
      computeMomentum([
        { videoId: "v1", observedAt: "2026-11-07T12:00:00Z", viewCount: null, likeCount: null, commentCount: null },
        { videoId: "v1", observedAt: "2026-11-17T12:00:00Z", viewCount: 5_000, likeCount: null, commentCount: null },
      ]),
    ).toBeNull();
  });
});
