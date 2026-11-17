import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MosScanStore } from "../src/persistence/scanStore.js";
import type { ScanResult, ScoredVideo } from "../src/research/index.js";
import { SCORING_MODEL_VERSION } from "../src/research/scoring.js";

/**
 * The scan store is exercised against a REAL sqlite file in a temp dir,
 * through the shared migration runner — the same path the desktop Host will
 * run, minus the data-directory resolution (injected by the services layer).
 */

const tempDirs: string[] = [];

function makeStore(): { store: MosScanStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "mos-scan-store-"));
  tempDirs.push(dir);
  const store = new MosScanStore({
    dbPath: join(dir, "mos-youtube.sqlite"),
    backupDirectories: [join(dir, "backup")],
  });
  return { store, dir };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scanResultFixture(scanId: string, overrides: Partial<ScanResult> = {}): ScanResult {
  const scored: ScoredVideo = {
    video: {
      videoId: "vid-1",
      title: "Workout video",
      channelId: "ch-1",
      channelTitle: "Channel",
      publishedAt: "2026-05-01T00:00:00Z",
      durationSeconds: 600,
      viewCount: 100_000,
      likeCount: 3_000,
      commentCount: 500,
      isLiveOrUpcoming: false,
      format: "long",
      foundVia: [{ themeId: "t1", order: "relevance" }],
    },
    baseline: {
      channelId: "ch-1",
      formatGroup: "long",
      sampleSize: 10,
      medianViews: 10_000,
      baselineVideos: [],
      available: true,
      lowConfidence: false,
      note: "ok",
    },
    breakoutRatio: 10,
    score: {
      modelVersion: SCORING_MODEL_VERSION,
      overall: 81,
      confidence: 1,
      completeness: 1,
      engagementPartial: false,
      factors: [],
    },
    classification: { views: ["breakout"], notes: ["note"] },
  };
  return {
    scanId,
    niche: {
      description: "Home workout routines",
      dateWindowDays: 365,
      format: "all",
      exclusions: [],
      depth: "quick",
    },
    themes: [{ id: "t1", text: "home workout routines" }],
    plan: {
      requests: [
        {
          themeId: "t1",
          query: "home workout routines",
          order: "relevance",
          maxResults: 25,
          publishedAfter: "2025-05-18T00:00:00.000Z",
          publishedBefore: "2026-05-18T00:00:00.000Z",
          videoDuration: "any",
        },
      ],
      estimatedCost: { searchCalls: 1, units: 2 },
      skippedThemes: [],
      enrichmentRequests: 2,
    },
    status: "complete",
    statusReason: "All planned requests succeeded.",
    startedAt: "2026-05-18T12:00:00.000Z",
    finishedAt: "2026-05-18T12:01:00.000Z",
    usage: { searchCalls: 1, units: 3 },
    searchFailures: [],
    skippedChannels: [],
    excludedLiveCount: 1,
    videos: [scored],
    provenance: [
      {
        source: "youtube-data-api-v3",
        method: "search.list",
        capabilityId: "youtube.search.videos",
        requestDigest: "fnv1a-abc",
        collectedAt: "2026-05-18T12:00:30.000Z",
      },
    ],
    modelVersion: SCORING_MODEL_VERSION,
    ...overrides,
  };
}

describe("MosScanStore", () => {
  it("persists and rehydrates a full scan result byte-for-byte on the fields that matter", async () => {
    const { store } = makeStore();
    await store.ensureReady();
    const result = scanResultFixture("scan-1");
    store.persistScanResult(result);

    const rehydrated = store.getScanResult("scan-1");
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.scanId).toBe("scan-1");
    expect(rehydrated!.niche.description).toBe("Home workout routines");
    expect(rehydrated!.status).toBe("complete");
    expect(rehydrated!.videos.length).toBe(1);
    expect(rehydrated!.videos[0]!.video.videoId).toBe("vid-1");
    expect(rehydrated!.videos[0]!.score.overall).toBe(81);
    expect(rehydrated!.videos[0]!.baseline.medianViews).toBe(10_000);
    expect(rehydrated!.usage).toEqual({ searchCalls: 1, units: 3 });
    expect(rehydrated!.provenance.length).toBe(1);
  });

  it("lists scans newest-first with summaries, staleness, and save flags", async () => {
    const { store } = makeStore();
    await store.ensureReady();
    store.persistScanResult(scanResultFixture("scan-old", { finishedAt: "2026-01-01T00:00:00.000Z" }));
    store.persistScanResult(scanResultFixture("scan-new", { finishedAt: "2026-05-18T12:01:00.000Z" }));
    store.setSaved("scan-old", true);

    const summaries = store.listScans(new Date("2026-05-20T00:00:00Z"));
    expect(summaries.map((summary) => summary.scanId)).toEqual(["scan-new", "scan-old"]);
    expect(summaries[0]!.saved).toBe(false);
    expect(summaries[1]!.saved).toBe(true);
    expect(summaries[1]!.stale).toBe(true); // > 30 days old
    expect(summaries[0]!.stale).toBe(false);
    expect(summaries[0]!.nicheDescription).toBe("Home workout routines");
    expect(summaries[0]!.videoCount).toBe(1);
    expect(summaries[0]!.topScore).toBe(81);
  });

  it("idempotently re-persists the same scan and dedups observations", async () => {
    const { store, dir } = makeStore();
    await store.ensureReady();
    store.persistScanResult(scanResultFixture("scan-1"));
    store.persistScanResult(scanResultFixture("scan-1", { status: "partial", statusReason: "one failed" }));

    const summaries = store.listScans();
    expect(summaries.length).toBe(1);
    expect(summaries[0]!.status).toBe("partial");
    const db = new (await import("node:sqlite")).DatabaseSync(join(dir, "mos-youtube.sqlite"), { readOnly: true });
    const observationCount = (db.prepare("SELECT COUNT(*) AS count FROM observations").get() as { count: number }).count;
    db.close();
    expect(observationCount).toBe(1);
  });

  it("deleting a scan removes its videos and sweeps orphaned observations", async () => {
    const { store, dir } = makeStore();
    await store.ensureReady();
    store.persistScanResult(scanResultFixture("scan-1"));
    store.deleteScan("scan-1");

    expect(store.getScanResult("scan-1")).toBeNull();
    expect(store.listScans().length).toBe(0);
    const db = new (await import("node:sqlite")).DatabaseSync(join(dir, "mos-youtube.sqlite"), { readOnly: true });
    const videos = (db.prepare("SELECT COUNT(*) AS count FROM scan_videos").get() as { count: number }).count;
    const observations = (db.prepare("SELECT COUNT(*) AS count FROM observations").get() as { count: number }).count;
    db.close();
    expect(videos).toBe(0);
    expect(observations).toBe(0); // no remaining scan references vid-1
  });

  it("keeps observations for videos still referenced by another stored scan", async () => {
    const { store } = makeStore();
    await store.ensureReady();
    store.persistScanResult(scanResultFixture("scan-1"));
    store.persistScanResult(scanResultFixture("scan-2"));
    store.deleteScan("scan-1");
    const rehydrated = store.getScanResult("scan-2");
    expect(rehydrated!.videos.length).toBe(1);
  });

  it("runs migrations exactly once (idempotent ensureReady)", async () => {
    const { store } = makeStore();
    await store.ensureReady();
    await store.ensureReady();
    store.close();
    // Reopen the same file: the journal table prevents re-application.
    const reopened = new MosScanStore({ dbPath: store["options"].dbPath, backupDirectories: [store["options"].backupDirectories[0]!] });
    await reopened.ensureReady();
    expect(reopened.listScans().length).toBe(0);
  });

  it("getUsageSince sums only scans collected at or after the cutoff", async () => {
    const { store } = makeStore();
    await store.ensureReady();
    store.persistScanResult(scanResultFixture("scan-early", { finishedAt: "2026-11-16T23:00:00.000Z", usage: { searchCalls: 2, units: 5 } }));
    store.persistScanResult(scanResultFixture("scan-late", { finishedAt: "2026-11-18T15:00:00.000Z", usage: { searchCalls: 3, units: 7 } }));

    expect(store.getUsageSince("2026-11-18T00:00:00.000Z")).toEqual({ searchCalls: 3, units: 7 });
    expect(store.getUsageSince("2026-11-16T00:00:00.000Z")).toEqual({ searchCalls: 5, units: 12 });
  });
});
