/**
 * Evidence, provenance, and retention (Workflow D/H/I).
 *
 * Every retained API fact carries its source, collection time, and an expiry
 * per YouTube's applicable data-retention requirements: statistics go stale
 * after STATISTICS_TTL_DAYS and must be re-observed before being trusted;
 * whole scans are flagged stale after SCAN_STALE_DAYS. Records can be purged
 * by collectedAt for user-initiated deletion.
 */

export const STATISTICS_TTL_DAYS = 7;
export const SCAN_STALE_DAYS = 30;

export type EvidenceSource = "youtube-data-api-v3" | "youtube-analytics-api-v2";

export interface ProvenanceRecord {
  source: EvidenceSource;
  /** API method, e.g. "search.list". */
  method: string;
  capabilityId: string;
  /** Digest of the request parameters (stable JSON hash), not the raw query. */
  requestDigest: string;
  collectedAt: string;
}

export interface VideoObservation {
  videoId: string;
  observedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export function provenanceFor(
  source: EvidenceSource,
  method: string,
  capabilityId: string,
  requestParams: Record<string, unknown>,
  collectedAt: string,
): ProvenanceRecord {
  return {
    source,
    method,
    capabilityId,
    requestDigest: digestParams(requestParams),
    collectedAt,
  };
}

export function digestParams(params: Record<string, unknown>): string {
  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join("&");
  // FNV-1a 32-bit: short, deterministic, collision-safe enough for display digests.
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}

export function isStatisticsFresh(observedAt: string, now: Date): boolean {
  return ageDays(observedAt, now) <= STATISTICS_TTL_DAYS;
}

export function isScanStale(scanCollectedAt: string, now: Date): boolean {
  return ageDays(scanCollectedAt, now) > SCAN_STALE_DAYS;
}

export function ageDays(isoTimestamp: string, now: Date): number {
  const then = Date.parse(isoTimestamp);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - then) / 86_400_000;
}

/**
 * Workflow F honesty rule: a single observation is never a growth rate.
 * Momentum requires at least two observations at least one day apart; the
 * result is labeled as observed views/day across the observation span.
 */
export interface MomentumResult {
  observedViewsPerDay: number;
  spanDays: number;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
}

export function computeMomentum(observations: VideoObservation[]): MomentumResult | null {
  const withViews = observations
    .filter((observation) => observation.viewCount !== null)
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  if (withViews.length < 2) return null;
  const first = withViews[0]!;
  const last = withViews[withViews.length - 1]!;
  const spanMs = Date.parse(last.observedAt) - Date.parse(first.observedAt);
  const spanDays = spanMs / 86_400_000;
  if (spanDays < 1) return null;
  const deltaViews = (last.viewCount ?? 0) - (first.viewCount ?? 0);
  return {
    observedViewsPerDay: deltaViews / spanDays,
    spanDays,
    firstObservedAt: first.observedAt,
    lastObservedAt: last.observedAt,
    observationCount: withViews.length,
  };
}
