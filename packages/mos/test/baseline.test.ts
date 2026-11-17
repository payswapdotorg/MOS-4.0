import { describe, expect, it } from "vitest";

import {
  breakoutRatio,
  computeBaseline,
  median,
  MIN_BASELINE_SAMPLE,
} from "../src/research/baseline.js";
import type { EnrichedVideo } from "../src/research/enrichment.js";

const candidate = {
  videoId: "candidate-1",
  channelId: "channel-1",
  format: "long",
  viewCount: 100_000,
} satisfies Pick<EnrichedVideo, "videoId" | "channelId" | "format" | "viewCount">;

function sample(videoId: string, viewCount: number, format = "long") {
  return { videoId, viewCount, publishedAt: "2026-09-01T00:00:00Z", format };
}

describe("median", () => {
  it("handles odd and even counts", () => {
    expect(median([100, 200, 300])).toBe(200);
    expect(median([100, 200, 300, 400])).toBe(250);
    expect(median([])).toBeNull();
  });
});

describe("computeBaseline", () => {
  it("uses the median of comparable uploads and excludes the candidate itself", () => {
    const samples = [sample("candidate-1", 999_999), ...[100, 200, 300, 400, 500, 600, 700, 800].map((views, index) => sample(`s${index}`, views))];
    const baseline = computeBaseline(candidate, samples);
    expect(baseline.available).toBe(true);
    expect(baseline.medianViews).toBe(450);
    expect(baseline.sampleSize).toBe(8);
    expect(baseline.baselineVideos.every((video) => video.videoId !== "candidate-1")).toBe(true);
  });

  it("never mixes Shorts with long-form", () => {
    const samples = [1, 2, 3, 4, 5, 6].map((views, index) => sample(`short-${index}`, views, "short"));
    const baseline = computeBaseline(candidate, samples);
    expect(baseline.available).toBe(false);
    expect(baseline.note).toContain("Insufficient");
  });

  it("marks baselines with too little history as unavailable", () => {
    const samples = [sample("a", 100), sample("b", 200)];
    const baseline = computeBaseline(candidate, samples);
    expect(baseline.available).toBe(false);
    expect(baseline.sampleSize).toBeLessThan(MIN_BASELINE_SAMPLE);
    expect(baseline.medianViews).toBeNull();
  });

  it("flags small-but-usable samples as low confidence", () => {
    const samples = [100, 250, 400, 900].map((views, index) => sample(`s${index}`, views));
    const baseline = computeBaseline(candidate, samples);
    expect(baseline.available).toBe(true);
    expect(baseline.lowConfidence).toBe(true);
  });

  it("ignores samples with missing view counts", () => {
    const samples = [sample("a", 100), sample("b", 200), { ...sample("c", 0), viewCount: null }];
    const baseline = computeBaseline(candidate, samples as never);
    expect(baseline.available).toBe(false);
  });

  it("live candidates never get a baseline (no comparable group)", () => {
    const baseline = computeBaseline(
      { ...candidate, format: "live" },
      [sample("a", 100), sample("b", 200), sample("c", 300)],
    );
    expect(baseline.available).toBe(false);
  });
});

describe("breakoutRatio", () => {
  it("computes views over baseline median", () => {
    const samples = [100, 200, 300, 400, 500].map((views, index) => sample(`s${index}`, views));
    const baseline = computeBaseline(candidate, samples);
    expect(baseline.medianViews).toBe(300);
    expect(breakoutRatio(100_000, baseline)).toBeCloseTo(100_000 / 300, 6);
  });

  it("returns null when the baseline is unavailable", () => {
    const baseline = computeBaseline(candidate, [sample("a", 1)]);
    expect(breakoutRatio(5_000, baseline)).toBeNull();
  });
});
