import { describe, expect, it } from "vitest";

import { computeBaseline } from "../src/research/baseline.js";
import {
  MIN_COMPLETENESS_FOR_SCORE,
  SCORING_MODEL_VERSION,
  SCORING_WEIGHTS_V1,
  scoreVideo,
} from "../src/research/scoring.js";
import type { EnrichedVideo } from "../src/research/enrichment.js";

/**
 * Hand-computed vectors (SCORING-MODEL.md, model mos-scoring-v1):
 *
 * Vector A — views 100k, likes 3k, comments 500, published exactly 30 days
 * before collection, baseline median 10k (10 comparable videos):
 *   breakout   = 0.5 + log2(10)/8        = 0.9152410
 *   viewsPerDay= log10(100000/30 + 1)/5  = 0.7046018   (3333.33 vpd)
 *   engagement = 0.035 / 0.05            = 0.7000000
 *   recency    = 1 - (30-3)/(365-3)      = 0.9254144
 *   overall    = (0.4·0.9152410 + 0.3·0.7046018 + 0.2·0.7 + 0.1·0.9254144)·100
 *              = 81.00
 */
const PUBLISHED_AT = "2026-04-18T12:00:00.000Z";
const COLLECTED_AT = "2026-05-18T12:00:00.000Z"; // exactly 30 days later

function baselineWith(medianViews: number, sampleSize: number, available = true) {
  const computed = computeBaseline(
    { videoId: "v1", channelId: "c1", format: "long", viewCount: 100 } as Pick<EnrichedVideo, "videoId" | "channelId" | "format" | "viewCount">,
    Array.from({ length: sampleSize }, (_, index) => ({
      videoId: `s${index}`,
      viewCount: medianViews,
      publishedAt: "2026-01-01T00:00:00Z",
      format: "long",
    })),
  );
  if (available) return computed;
  return { ...computed, available: false, medianViews: null, note: "Unavailable for test." };
}

function factor(score: ReturnType<typeof scoreVideo>, name: string) {
  const found = score.factors.find((entry) => entry.factor === name);
  expect(found).toBeDefined();
  return found!;
}

describe("scoreVideo (mos-scoring-v1)", () => {
  it("vector A: full data, available baseline", () => {
    const score = scoreVideo({
      viewCount: 100_000,
      likeCount: 3_000,
      commentCount: 500,
      publishedAt: PUBLISHED_AT,
      collectedAt: COLLECTED_AT,
      baseline: baselineWith(10_000, 10),
    });

    expect(score.modelVersion).toBe(SCORING_MODEL_VERSION);
    expect(factor(score, "breakout")!.normalized).toBeCloseTo(0.915241, 6);
    expect(factor(score, "viewsPerDay")!.normalized).toBeCloseTo(0.7046018, 6);
    expect(factor(score, "engagement")!.normalized).toBeCloseTo(0.7, 6);
    expect(factor(score, "recency")!.normalized).toBeCloseTo(0.9254144, 6);
    expect(score.overall).toBe(81);
    expect(score.completeness).toBe(1);
    expect(score.confidence).toBe(1);
    expect(score.engagementPartial).toBe(false);
  });

  it("vector B: no baseline — score drops, confidence penalized, explanation stays honest", () => {
    const score = scoreVideo({
      viewCount: 100_000,
      likeCount: 3_000,
      commentCount: 500,
      publishedAt: PUBLISHED_AT,
      collectedAt: COLLECTED_AT,
      baseline: baselineWith(0, 0, false),
    });

    expect(factor(score, "breakout")!.normalized).toBeNull();
    // overall = (0.3·0.7046018 + 0.2·0.7 + 0.1·0.9254144) / 0.6 × 100 = 73.99
    expect(score.overall).toBeCloseTo(73.99, 2);
    expect(score.completeness).toBe(0.6);
    expect(score.confidence).toBe(0.45); // 0.6 × 0.75 (no-baseline penalty)
    expect(factor(score, "breakout")!.note).toContain("Unavailable");
  });

  it("vector C: hidden engagement counts — factor excluded, never defaulted", () => {
    const score = scoreVideo({
      viewCount: 100_000,
      likeCount: null,
      commentCount: null,
      publishedAt: PUBLISHED_AT,
      collectedAt: COLLECTED_AT,
      baseline: baselineWith(10_000, 10),
    });

    expect(factor(score, "engagement")!.normalized).toBeNull();
    // overall = (0.4·0.915241 + 0.3·0.7046018 + 0.1·0.9254144) / 0.8 × 100 = 83.75
    expect(score.overall).toBeCloseTo(83.75, 2);
    expect(score.completeness).toBe(0.8);
    expect(score.confidence).toBe(0.8);
  });

  it("partial engagement (likes hidden, comments visible) is flagged", () => {
    const score = scoreVideo({
      viewCount: 100_000,
      likeCount: null,
      commentCount: 500,
      publishedAt: PUBLISHED_AT,
      collectedAt: COLLECTED_AT,
      baseline: baselineWith(10_000, 10),
    });
    expect(factor(score, "engagement")!.normalized).not.toBeNull();
    expect(score.engagementPartial).toBe(true);
  });

  it("below the completeness floor the score is null — missing data never yields a good-looking number", () => {
    const score = scoreVideo({
      viewCount: null,
      likeCount: null,
      commentCount: null,
      publishedAt: PUBLISHED_AT,
      collectedAt: COLLECTED_AT,
      baseline: baselineWith(0, 0, false),
    });
    // Only recency (10% weight) has data → completeness 0.1 < 0.5 floor.
    expect(score.completeness).toBeLessThan(MIN_COMPLETENESS_FOR_SCORE);
    expect(score.overall).toBeNull();
  });

  it("weights always sum to 1 and factor explanations carry raw inputs", () => {
    const score = scoreVideo({
      viewCount: 50_000,
      likeCount: 1_000,
      commentCount: 100,
      publishedAt: PUBLISHED_AT,
      collectedAt: COLLECTED_AT,
      baseline: baselineWith(10_000, 8),
    });
    const total = Object.values(SCORING_WEIGHTS_V1).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
    for (const entry of score.factors) {
      expect(entry.raw.length).toBeGreaterThan(0);
      expect(entry.note.length).toBeGreaterThan(0);
    }
    expect(factor(score, "viewsPerDay")!.raw).toContain("estimated views/day");
    expect(factor(score, "engagement")!.note).toContain("Proxy");
  });
});
