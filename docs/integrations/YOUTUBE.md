# YouTube integration notes

Official APIs only. No scraping, no third-party YouTube data providers, no
fallback around API restrictions (product brief §5.4, §14).

## APIs and capabilities

| Capability | API | Cost (verified 2026-11-17) | Scope |
|---|---|---|---|
| `youtube.search.videos` | Data API v3 `search.list` | **own bucket: 100 calls/day, cost 1 per call** | `youtube.readonly` |
| `youtube.video.detail` / `youtube.video.stats.bulk` | `videos.list` (≤50 ids per request) | 1 unit per request (10,000 units/day pool) | `youtube.readonly` |
| `youtube.channel.profile` | `channels.list` | 1 unit per request | `youtube.readonly` |
| `youtube.channel.uploads` | `playlistItems.list` (uploads playlist) | 1 unit per request | `youtube.readonly` |
| `youtube.channel.analytics` | Analytics API v2 `reports` | 1 unit per request | `yt-analytics.readonly` (opt-in) |

Quota facts verified against Google's official quota documentation on 2026-11-17
(`developers.google.com/youtube/v3/determine_quota_cost`): the search bucket is
separate from the unit pool; every request (even invalid) costs ≥ 1; quotas reset
**midnight Pacific Time**; accounting is per Google Cloud project. TREG's manifest
notes were stale here and were not copied. Live limits can be raised by the owner —
the ledger takes limits as configuration.

## OAuth (desktop app)

- Google OAuth 2.0 native-app profile: **PKCE (S256)**, loopback redirect
  `http://127.0.0.1:{ephemeral port}` (RFC 8252), `state` CSRF validation,
  authorization-code exchange, single-flight refresh, revocation on disconnect.
  Implementation primitives: `packages/mos/src/youtube/oauth.ts`; the loopback
  HTTP server (`packages/mos/src/youtube/loopback.ts`) runs inside the services
  Host process via `packages/services/src/mos` (same placement rule as the
  existing `cloudContentService` loopback server — Electron Main stays a pure
  window/router process). Flow contract: `docs/mos/desktop-integration-spec.md`.
- **Read-only scopes only**: `youtube.readonly`. The analytics scope
  (`yt-analytics.readonly`) is opt-in and only ever for the user's own channel.
  No upload, publish, comment, or channel-management scopes.
- Desktop clients are public clients: the client secret is not treated as
  confidential, but tokens are still stored only in the OS-secure credential
  store (ZCode keyring integration) — never in scan records, logs, tool output,
  or source control.
- Known Google behaviors to design around (verified from official docs):
  - While the OAuth consent screen is in **Testing** status, refresh tokens
    expire after **7 days** (re-consent needed weekly during development).
  - Limit of 100 refresh tokens per account per client id (oldest silently
    invalidated).
  - Publishing to production with sensitive scopes requires Google verification.

## Error handling and rate limits

- `403 quotaExceeded` / `dailyLimitExceeded` / `rateLimitExceeded` → fatal for the
  day; clear exhaustion message; no retry.
- `429`, `5xx`, `403 userRateLimitExceeded` → bounded exponential backoff
  (500 ms base, ×2, cap 8 s; `Retry-After` honored), max 3 retries.
- Other `4xx` → typed error, surfaced in the scan report; a scan with failed
  requests reports `partial`, never silent success.
- Response-schema drift → loud failure (pinned zod schemas on every endpoint).

## Owner prerequisites (blocking live use, not development)

1. Google Cloud project for MOS; 2. YouTube Data API v3 enabled; 3. OAuth client
   (application type **Desktop app**); 4. authorized test account; 5. consent
   screen configured (External/testing, owner account as test user). No Google
   Cloud changes are made from this repository without owner authorization.

## Data retention and deletion

Retained API data carries source, method, request digest, collection time, and
expiry: statistics are re-observed after 7 days (`STATISTICS_TTL_DAYS`), scans are
flagged stale after 30 days (`SCAN_STALE_DAYS`). Users can delete saved scans and
their collected observations; deletion removes derived scores and evidence rows.
Public metadata is retained only as long as the owning scan exists or the user
keeps the item saved.
