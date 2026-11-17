# ADR-0004: Official YouTube APIs only, with first-class quota accounting

Date: 2026-11-17 · Status: accepted

## Context

The product must use official YouTube APIs; scraping (including TREG's third-party
scraper providers) is forbidden by the product brief and Google's developer
policies. The quota reality (verified against Google's documentation on
2026-11-17) is unusual: **`search.list` has its own 100-calls/day default bucket**
(cost 1 per call) separate from the 10,000-units/day pool that other methods share
(`videos.list`/`channels.list` = 1 unit per request); every request — even invalid
— costs at least 1 unit; quotas reset midnight Pacific Time, per Google Cloud
project. TREG's YouTube manifest notes on search quota were stale in this respect
and were not copied.

## Decision

- One typed capability registry (`packages/mos/src/capability/youtube.ts`) with six
  capabilities; each pins request/response zod schemas, scopes, quota cost, retry
  policy, and an honest verification status (`verified-reachability` today;
  `verified-live` only after owner-gated live verification).
- A `QuotaLedger` that models BOTH buckets, resets on the PT date rollover, is
  checked pre-flight (exhausted budgets fail fast without an API round-trip) and
  recorded post-call; scan plans expose their estimated cost before execution.
- Search strategy shaped by the bucket: multiple themes × multiple orderings
  under a depth budget; discovery dedups across requests; channel baselines come
  from uploads playlists (`playlistItems.list`, 1 unit) plus bulk
  `videos.list` (≤50 ids/unit) — never from extra searches.
- Error policy: `403 quotaExceeded/dailyLimitExceeded/rateLimitExceeded` → fatal
  `QuotaExhaustedApiError` with a user-facing exhaustion message; `429`/`5xx`/
  `userRateLimitExceeded` → bounded exponential backoff honoring `Retry-After`;
  other 4xx → typed errors surfaced in scan reports.
- Read-only scopes only (`youtube.readonly`; `yt-analytics.readonly` is opt-in for
  the user's own channel). No upload/publish/comment/manage scopes ever.

## Consequences

- Discovery depth is bounded by the search bucket (5/12/24 calls for
  quick/standard/deep scans by default; limits configurable per project).
- Live-API verification remains an owner-gated acceptance gate until the Google
  Cloud project exists (see docs/testing/STRATEGY.md).
