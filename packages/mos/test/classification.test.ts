import { describe, expect, it } from "vitest";

import {
  BREAKOUT_RATIO_THRESHOLD,
  classifyVideo,
  NEW_ENTRANT_MAX_SUBSCRIBERS,
} from "../src/research/classification.js";
import type { VideoScore } from "../src/research/scoring.js";
import { scoreVideo } from "../src/research/scoring.js";

function baseContext(overrides: Partial<Parameters<typeof classifyVideo>[1]> = {}) {
  return {
    ageDays: 30,
    breakoutRatio: null,
    channelSubscribers: null,
    momentum: null,
    ...overrides,
  };
}

function scoreWith(overrides: Partial<Parameters<typeof scoreVideo>[0]> = {}): VideoScore {
  return scoreVideo({
    viewCount: 100_000,
    likeCount: 3_000,
    commentCount: 500,
    publishedAt: "2026-04-18T12:00:00.000Z",
    collectedAt: "2026-05-18T12:00:00.000Z",
    baseline: {
      channelId: "c1",
      formatGroup: "long",
      sampleSize: 10,
      medianViews: 10_000,
      baselineVideos: [],
      available: true,
      lowConfidence: false,
      note: "ok",
    },
    ...overrides,
  });
}

describe("classifyVideo", () => {
  it("flags breakouts only with a real baseline ratio and adequate confidence", () => {
    const score = scoreWith();
    const result = classifyVideo(score, baseContext({ breakoutRatio: BREAKOUT_RATIO_THRESHOLD }));
    expect(result.views).toContain("breakout");
    expect(result.notes.join(" ")).toContain("Outperforming");
  });

  it("does not flag a breakout without a baseline and says so", () => {
    const score = scoreWith({
      baseline: {
        channelId: "c1",
        formatGroup: "long",
        sampleSize: 0,
        medianViews: null,
        baselineVideos: [],
        available: false,
        lowConfidence: true,
        note: "Insufficient public history.",
      },
    });
    const result = classifyVideo(score, baseContext({ breakoutRatio: null }));
    expect(result.views).not.toContain("breakout");
    expect(result.notes.join(" ")).toContain("No channel baseline available");
  });

  it("rising requires recency plus strong estimated pace; single observation is not momentum", () => {
    const score = scoreWith();
    const result = classifyVideo(score, baseContext({ ageDays: 10, breakoutRatio: null }));
    // viewsPerDay factor for this vector is 0.70 ≥ 0.5.
    expect(result.views).toContain("rising");
    expect(result.notes.join(" ")).toContain("repeat scan");
  });

  it("rising with repeated observations reports measured momentum instead", () => {
    const score = scoreWith();
    const result = classifyVideo(score, baseContext({
      ageDays: 10,
      momentum: {
        observedViewsPerDay: 5_000,
        spanDays: 7,
        firstObservedAt: "2026-05-11T00:00:00Z",
        lastObservedAt: "2026-05-18T00:00:00Z",
        observationCount: 2,
      },
    }));
    expect(result.views).toContain("rising");
    expect(result.notes.join(" ")).toContain("Observed momentum");
  });

  it("evergreen requires age and sustained pace", () => {
    const score = scoreWith();
    expect(classifyVideo(score, baseContext({ ageDays: 200, breakoutRatio: 3 })).views).toContain("evergreen");
    expect(classifyVideo(score, baseContext({ ageDays: 200, breakoutRatio: null, channelSubscribers: null })).views).toContain("evergreen");
  });

  it("new-entrant needs a small-channel subscriber count AND a real score", () => {
    const score = scoreWith();
    expect(
      classifyVideo(score, baseContext({ channelSubscribers: NEW_ENTRANT_MAX_SUBSCRIBERS })).views,
    ).toContain("new-entrant");
    expect(classifyVideo(score, baseContext({ channelSubscribers: 500_000 })).views).not.toContain("new-entrant");
    expect(classifyVideo(score, baseContext({ channelSubscribers: null })).views).not.toContain("new-entrant");
  });

  it("null overall scores never classify as new-entrant", () => {
    const degraded = scoreWith({
      viewCount: null,
      likeCount: null,
      commentCount: null,
      baseline: {
        channelId: "c1",
        formatGroup: "long",
        sampleSize: 0,
        medianViews: null,
        baselineVideos: [],
        available: false,
        lowConfidence: true,
        note: "none",
      },
    });
    expect(degraded.overall).toBeNull();
    expect(
      classifyVideo(degraded, baseContext({ channelSubscribers: 100 })).views,
    ).not.toContain("new-entrant");
  });
});
