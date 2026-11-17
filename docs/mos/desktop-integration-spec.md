# MOS 4.0 desktop integration spec

Status: active · Owner: TL · Implements: `docs/product/MVP-SPEC.md` Workflows A–I (desktop parts) ·
State owner map and acceptance scenarios are normative for the services/UI stages.

## Process placement (who owns what)

| Concern | Owner | Rationale |
|---|---|---|
| Google OAuth flow state, loopback HTTP server, scan execution, sqlite persistence | `packages/services/src/mos/*` (runs in the per-window Host utilityProcess) | AGENTS.md: Main 不承载 task/session 业务状态. Precedent: `cloudContentService` loopback server runs in services. |
| Pure logic (loopback server implementation, scan store, OAuth/API primitives, engine) | `packages/mos` | ADR-0003: testable core; app-business unit tests are only allowed in the `mos` vitest project. |
| Opening the system browser for consent | renderer via `IPlatformService.openExternal` (Main `shell.openExternal`) | Existing sanctioned path; Main stays a router. |
| Google token storage | `ICredentialService` under MOS-owned keys | Encryption/keyring/fallback for free; NOT entangled with ZCode login providers (`zai`/`bigmodel`). |

## Configuration

Google OAuth client configuration is owner-provided and never committed:

- `MOS_GOOGLE_OAUTH_CLIENT_ID` / `MOS_GOOGLE_OAUTH_CLIENT_SECRET` (env), or
- `~/.zcode/v2/mos-youtube.json` → `{ "googleOAuthClientId": "...", "googleOAuthClientSecret": "..." }` (0600).

Precedence: env > config file. With no client id configured, `startGoogleConnect`
returns `{ ok: false, reason: "client-id-missing" }` and the UI shows the
configuration note in `docs/integrations/YOUTUBE.md` — never a broken flow.
Read-only `youtube.readonly` scope only.

## Connection flow (Workflow A)

1. Renderer: `mosConnectionService.startGoogleConnect()`.
2. Service: resolve client id → generate PKCE verifier/challenge + state → start
   loopback server on `127.0.0.1:0` (TTL 5 min, single pending flow) → return
   `{ ok: true, authorizeUrl }`.
3. Renderer: `platform.openExternal(authorizeUrl)`; UI state `connecting`.
4. Google redirects to `http://127.0.0.1:{port}/?code=…&state=…`.
5. Loopback server (services process): validates state, resolves the pending
   flow, replies with a minimal "return to MOS 4.0" HTML page, closes.
6. Service: `exchangeAuthorizationCode` (PKCE) → store `{accessToken,
   refreshToken, expiresAt, scope}` at credential key `mos:youtube:token_set`
   (encrypted, never in logs/scan records/RPC payloads) → fire
   `onDidChangeConnection {google: "connected"}`.
7. Failures: user denies (`access_denied`), state mismatch, timeout
   (5 min), `invalid_grant` on later refresh → state back to `disconnected`
   with the reason surfaced in `getConnectionState()`; `TokenInvalidGrantError`
   ⇒ reconnect required (Google testing-status 7-day refresh expiry is the
   expected cause during development).
8. `disconnectGoogle()` revokes the refresh token (best-effort) and clears the
   credential key. API-key mode: `configureApiKey(key)` stores
   `mos:youtube:api_key`; state reports both paths.

## Research flow (Workflows B–I)

Renderer → `mosResearchService`:

- `expandThemes(niche)` → derived themes today (`ThemeExpansion.source =
  "derived"`); LLM expansion lands with Stage 5 and must stay user-editable.
- `estimateScanCost(niche, themes)` → search calls + units, shown before run.
- `runScan(niche, themes)` → executes `runNicheScan` from `@zcode/mos` with the
  credential-backed client + a persistent `QuotaLedger` seeded from the daily
  history; progress pushed via `onDidScanProgress {scanId, phase, themeId?,
  candidatesSoFar?}`; result persisted (below) and returned.
- Saved research: `listSavedScans()` / `getSavedScan(scanId)` / `saveScan(scanId)` /
  `deleteScan(scanId)`; staleness badges from `collectedAt`
  (7-day statistics TTL / 30-day scan staleness, `research/evidence.ts`).

Scan honesty rules are inherited from the engine: `partial`/`failed` statuses
and per-request failures are surfaced, never dropped; a scan records quota usage
actually spent, and repeat scans of the same video produce `observations` rows
used for momentum.

## Persistence (scan store)

- File: `{dataBaseDir}/.zcode/v2/mos-youtube.sqlite` (path injected by the
  services layer; the store itself is pure `node:sqlite` in `packages/mos`).
- PRAGMAs: `journal_mode = WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`.
- Migrations via `@zcode/shared/sqlite-migrations` (`sqliteMigrations.migrate`),
  `database: "mos_youtube"`, backups under `~/.zcode/backup`, `applied_at`
  journal. Released migration SQL is checksum-frozen (runner rule).

Schema v1 (`0001_mos_youtube`):

```
scans          (scan_id PK, niche_json, themes_json, status, status_reason,
                started_at, finished_at, usage_json, search_failures_json,
                excluded_live_count, model_version, provenance_json,
                saved INTEGER NOT NULL DEFAULT 0, collected_at)
scan_videos    (scan_id, video_id, channel_id, rank, score_overall,
                score_json, video_json, PRIMARY KEY(scan_id, video_id))
observations   (video_id, observed_at, view_count, like_count, comment_count,
                PRIMARY KEY(video_id, observed_at))
```

Deletion: `deleteScan` removes the scan row + its videos; observations are kept
only while some saved scan references the video (swept on delete). Users can
always delete saved research entirely.

## UI (Niche Explorer panel) — Stage 4

- First-class `WorkspaceMainView: "niche-explorer"` (automations/plugin-store
  precedent), sidebar entry with `TID_NICHE_EXPLORER_OPEN`, history entry,
  breadcrumb frame, scoped error boundary. Hidden in the web-remote shell.
- States: ConnectionBar (Google connected/disconnected/connecting + quota
  snapshot) → NicheForm (description*, format, depth, date window, region,
  exclusions) → ThemeStep (editable derived themes + estimated cost + Run) →
  Progress (phase + candidates) → Results (ranked table: thumbnail, title link
  via `openExternal`, channel, views, est. views/day, engagement, score,
  confidence, MOS classification labels, per-factor explanations on expand;
  partial/failed banner; excluded-live note) → Saved research (list, staleness,
  open, delete).
- All copy via i18n catalogs (en/zh/ja/ko/ru); no hard-coded strings.

## Acceptance scenarios (mock-verified now, live-verified when owner creds exist)

1. Unconfigured client id → connect returns `client-id-missing`; UI shows the
   configuration note (unit test + UI state).
2. Happy path connect: authorize URL contains PKCE + loopback redirect; callback
   with matching state exchanges and stores the token set; connection event
   fires; no token value in any log/record (unit tests with fake fetch + real
   loopback on port 0).
3. Denied/timeout/state-mismatch → disconnected with reason (unit tests).
4. Scan: derived themes → cost estimate → run → persisted, ranked, explained
   results; quota ledger debited exactly the calls made (mock-integration test
   already pins the engine; service test pins wiring).
5. Saved scan reopen reproduces the stored result with staleness badge;
   delete removes rows (store unit tests).
6. Live variants of 2–5 on the owner's machine remain the Stage 6 gate.
