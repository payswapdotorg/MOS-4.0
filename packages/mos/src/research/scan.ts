import { randomUUID } from "node:crypto";

import type { QuotaLedger } from "../quota/ledger.js";
import type { YouTubeClient } from "../youtube/client.js";
import { classifyVideo, type ClassificationResult, type ResultView } from "./classification.js";
import { computeBaseline, breakoutRatio, type ChannelBaseline } from "./baseline.js";
import { discoverVideos, type DiscoveryFailure, type DiscoveredVideo } from "./discovery.js";
import { enrichVideos, type EnrichedChannel, type EnrichedVideo } from "./enrichment.js";
import type { ProvenanceRecord } from "./evidence.js";
import { provenanceFor } from "./evidence.js";
import type { NicheDefinition } from "./niche.js";
import { buildSearchPlan, depthBudgetFor, type SearchPlan } from "./planner.js";
import { scoreVideo, SCORING_MODEL_VERSION, type VideoScore } from "./scoring.js";
import { enrichSampleStats, sampleChannelUploads, type SampleVideoStats } from "./sampling.js";
import type { SearchTheme } from "./themes.js";

/**
 * The end-to-end niche scan (Workflows D–G), shared verbatim by the Niche
 * Explorer UI and the agent's MCP tools. Pure orchestration: the YouTube
 * client, clock, and quota ledger are injected, so the whole pipeline is
 * unit-testable with a fake client and reproducible against persisted
 * evidence. A scan never reports success when upstream calls failed —
 * failures are surfaced and the status degrades to "partial".
 */

export interface ScanProgress {
  phase: "planning" | "discovery" | "enrichment" | "sampling" | "scoring" | "done";
  themeId?: string;
  candidatesSoFar?: number;
}

export interface ScanUsage {
  searchCalls: number;
  units: number;
}

export interface ScoredVideo {
  video: EnrichedVideo;
  baseline: ChannelBaseline;
  breakoutRatio: number | null;
  score: VideoScore;
  classification: ClassificationResult;
}

export interface ScanResult {
  scanId: string;
  niche: NicheDefinition;
  themes: SearchTheme[];
  plan: SearchPlan;
  status: "complete" | "partial" | "failed";
  statusReason: string;
  startedAt: string;
  finishedAt: string;
  usage: ScanUsage;
  searchFailures: DiscoveryFailure[];
  skippedChannels: string[];
  /** Live/upcoming videos are excluded from scoring and counted here. */
  excludedLiveCount: number;
  videos: ScoredVideo[];
  provenance: ProvenanceRecord[];
  modelVersion: string;
}

export interface ScanDeps {
  client: YouTubeClient;
  ledger?: QuotaLedger;
  now?: () => Date;
  /** Injectable scan id (services layer generates it up front so progress events are addressable). */
  scanId?: string;
  onProgress?: (progress: ScanProgress) => void;
}

export async function runNicheScan(
  deps: ScanDeps,
  niche: NicheDefinition,
  themes: SearchTheme[],
): Promise<ScanResult> {
  const now = deps.now ?? ((): Date => new Date());
  const startedAt = now().toISOString();
  const usage: ScanUsage = { searchCalls: 0, units: 0 };
  const provenance: ProvenanceRecord[] = [];

  // --- planning (Workflow D pre-flight) ---
  deps.onProgress?.({ phase: "planning" });
  const ledgerRemaining = deps.ledger
    ? deps.ledger.snapshot().searchCallsLimit - deps.ledger.snapshot().searchCallsUsed
    : undefined;
  const plan = buildSearchPlan(niche, themes, { depthBudget: depthBudgetFor(niche), ledgerRemaining });

  // --- discovery ---
  const discovery = await discoverVideos(deps.client, niche, plan, {
    now,
    onProgress: (progress) => deps.onProgress?.({ ...progress, phase: "discovery" }),
  });
  usage.searchCalls += discovery.searchCallsMade;
  provenance.push(...discovery.provenance);

  // --- enrichment (bulk stats + channels) ---
  deps.onProgress?.({ phase: "enrichment", candidatesSoFar: discovery.videos.length });
  const enrichment = await enrichVideos(
    (ids) => {
      usage.units += Math.ceil(ids.length / 50);
      provenance.push(
        provenanceFor("youtube-data-api-v3", "videos.list", "youtube.video.stats.bulk", { count: ids.length }, now().toISOString()),
      );
      return deps.client.listVideos(ids);
    },
    (ids) => {
      usage.units += Math.ceil(ids.length / 50);
      provenance.push(
        provenanceFor("youtube-data-api-v3", "channels.list", "youtube.channel.profile", { count: ids.length }, now().toISOString()),
      );
      return deps.client.listChannels(ids);
    },
    discovery.videos,
  );

  const excludedLive = enrichment.videos.filter((video) => video.isLiveOrUpcoming);
  const scoreable = enrichment.videos.filter((video) => !video.isLiveOrUpcoming && video.viewCount !== null);

  // --- channel sampling for baselines ---
  deps.onProgress?.({ phase: "sampling", candidatesSoFar: scoreable.length });
  const sampling = await sampleChannelUploads(deps.client, niche, scoreable, enrichment.channels);
  usage.units += sampling.unitRequests;
  const sampleStats = await enrichSampleStats((ids) => {
    usage.units += Math.ceil(ids.length / 50);
    provenance.push(
      provenanceFor("youtube-data-api-v3", "videos.list", "youtube.video.stats.bulk", { count: ids.length, purpose: "baseline" }, now().toISOString()),
    );
    return deps.client.listVideos(ids);
  }, sampling.samplesByChannel);
  const { statsByVideo } = sampleStats;

  // --- baselines + scoring + classification ---
  deps.onProgress?.({ phase: "scoring", candidatesSoFar: scoreable.length });
  const videos: ScoredVideo[] = [];
  for (const video of scoreable) {
    const samples = sampling.samplesByChannel.get(video.channelId) ?? [];
    const baseline = computeBaseline(video, samples.map(toBaselineSample(statsByVideo)));
    const ratio = video.viewCount !== null ? breakoutRatio(video.viewCount, baseline) : null;
    const score = scoreVideo({
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      commentCount: video.commentCount,
      publishedAt: video.publishedAt,
      collectedAt: now().toISOString(),
      baseline,
    });
    const channel = enrichment.channels.get(video.channelId);
    const publishedAgeDays = ageDays(video.publishedAt, now());
    const classification = classifyVideo(score, {
      ageDays: publishedAgeDays,
      breakoutRatio: ratio,
      channelSubscribers: channel?.subscriberCount ?? null,
      momentum: null, // single-observation scans never claim momentum
    });
    videos.push({ video, baseline, breakoutRatio: ratio, score, classification });
  }

  // Null overall scores (insufficient data) sort last, never first.
  videos.sort((a, b) => (b.score.overall ?? -1) - (a.score.overall ?? -1));

  const failed = discovery.failures.length > 0;
  const status: ScanResult["status"] =
    discovery.videos.length === 0 && failed ? "failed" : failed ? "partial" : "complete";
  const statusReason =
    status === "failed"
      ? "Every search request failed; no results collected."
      : status === "partial"
        ? `${discovery.failures.length} search request(s) failed; results are incomplete.`
        : "All planned requests succeeded.";

  deps.onProgress?.({ phase: "done" });
  return {
    scanId: deps.scanId ?? randomUUID(),
    niche,
    themes,
    plan,
    status,
    statusReason,
    startedAt,
    finishedAt: now().toISOString(),
    usage,
    searchFailures: discovery.failures,
    skippedChannels: sampling.skippedChannels,
    excludedLiveCount: excludedLive.length,
    videos,
    provenance,
    modelVersion: SCORING_MODEL_VERSION,
  };
}

function toBaselineSample(statsByVideo: Map<string, SampleVideoStats>) {
  return (sample: { videoId: string; publishedAt: string | null }): {
    videoId: string;
    viewCount: number | null;
    publishedAt: string | null;
    format: string;
  } => {
    const stats = statsByVideo.get(sample.videoId);
    return {
      videoId: sample.videoId,
      viewCount: stats?.viewCount ?? null,
      publishedAt: stats?.publishedAt ?? sample.publishedAt,
      format: stats?.format ?? "unknown",
    };
  };
}

function ageDays(publishedAt: string, now: Date): number | null {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return null;
  return (now.getTime() - published) / 86_400_000;
}

export type { DiscoveredVideo, EnrichedChannel, EnrichedVideo, ResultView, SearchPlan };
