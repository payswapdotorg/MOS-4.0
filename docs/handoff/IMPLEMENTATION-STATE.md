# Implementation state

Authoritative stage-by-stage state. Updated with every stage commit; green ticks
only for demonstrated work. (Legend: ✅ done+verified · 🔄 in progress · ⏳ not started ·
🚧 blocked on external prerequisite)

## Stage 0 — Repository and development foundation ✅ (2026-11-17)

- ✅ Complete ZCode history + tags imported into `payswapdotorg/MOS-4.0`; `main` at
  baseline `fec9759` (v3.18.2); `origin`/`upstream` remotes configured and
  verified (`docs/handoff/UPSTREAM-BASELINE.md`).
- ✅ Product identity: `MOS 4.0` productName, `org.payswapdotorg.mos4` appId,
  installer/icons/About/window-title/brand strings, generated icon set
  (`scripts/mos/generate-product-icons.py`); regression-tested
  (`docs/decisions/ADR-0002-product-identity.md`).
- ✅ Version line `4.0.0` across root/desktop/lock (enforced by test).
- ✅ Upstream `electron-updater` dev-mode crash ("App version 0.0") fixed by giving
  the desktop shell a semver version; regression test added
  (`packages/desktop/test/desktopProductIdentity.test.ts`). Narrow fix; packaged
  update behavior untouched.
- ✅ CI: `.github/workflows/ci.yml` (install → typecheck → engineering + MOS tests;
  full production build job on main) and `.github/workflows/windows-release.yml`
  (Windows x64 NSIS bundle, SHA-256, artifacts, tag releases). First CI run
  triggered by the stage push — run status recorded in RELEASE-STATE.md.
- ✅ Docs set (this tree) + development environment notes (isolated
  `ZCODE_DATA_BASE_DIR`; pinned toolchain; contained caches).

## Stage 1 — YouTube connection 🔄 (core complete; desktop wiring next)

- ✅ `packages/mos` capability registry: 6 typed capabilities with schemas,
  scopes, quota costs, retry policies, honest verification statuses
  (`verified-reachability` as of 2026-11-17; live verification pending owner
  Google Cloud project).
- ✅ Quota ledger: separate search bucket + unit pool, PT-midnight reset,
  pre-flight checks, post-call recording, scan-cost estimation (unit-tested).
- ✅ Official YouTube Data API v3 client: OAuth bearer or API key auth, 50-id
  batching, pinned zod response schemas, typed errors, fatal-quota vs retryable
  classification, exponential backoff with Retry-After (unit-tested with
  injected fetch).
- ✅ OAuth primitives: PKCE S256 (RFC 7636 vector pinned), authorization URL,
  loopback callback parsing + state validation, single-flight refresh,
  invalid_grant → reconnect-required error, revocation (unit-tested).
- ✅ Loopback OAuth callback server (`packages/mos/src/youtube/loopback.ts`):
  RFC 8252, port 0 on 127.0.0.1, state-first validation, denial/timeout/abort
  handling, injectable serverFactory — unit-tested against real sockets.
- ✅ Sqlite scan store (`packages/mos/src/persistence/scanStore.ts`):
  `mos-youtube.sqlite` via the shared migration runner (`0001_mos_youtube`),
  scan rehydration, observations with orphan sweep, PT-day usage sums —
  tested against real temp-database files.
- ✅ Services layer (`packages/services/src/mos`): `MosConnectionService`
  (Google OAuth loopback flow, PKCE, encrypted credential keys `mos:youtube:*`,
  single-flight refresh, revoke-on-disconnect, API-key path, config from
  env/`mos-youtube.json`) + `MosResearchService` (theme expansion, quota
  continuation from persisted scans, scan execution + progress events,
  saved-research CRUD); registered in `node.ts`, accessor, client getters,
  shared ServiceChannels; architecture module `mos-services` adopted
  (0 violations). Spec: `docs/mos/desktop-integration-spec.md`.
- ⚠️ Known issue (open): the root `pnpm typecheck` aggregate fails with 36
  TS2591-class errors confined to `packages/mos` Node-builtin typing
  (`node:fs`/`node:sqlite`/…), while `tsc -b` inside `packages/mos` passes and
  all 93 mos tests + architecture checks are green. Fix path (next session):
  align the mos tsconfig `types`/`typeRoots` with how upstream leaf packages
  (e.g. session-control) declare Node types inside the root build list, or
  register mos via a project reference.
- ⏳ Niche Explorer UI (Stage 4) — integration surfaces mapped, not yet built.
- ⏳ Live integration tests (owner-gated: Google Cloud project, OAuth client,
  test account).

## Stage 2 — Discovery engine ✅ (engine complete; services/UI wiring pending)

- ✅ Niche model with validated configuration and depth budgets.
- ✅ Theme expansion: deterministic derived + manual workflow (LLM expander
  interface ready for model-client wiring in Stage 5).
- ✅ Search planner: themes × orderings under depth/ledger budgets, estimated
  quota cost, skipped-theme reporting; Shorts-only niches use the API's short
  duration bucket.
- ✅ Discovery: multi-request dedup, niche post-filters (date window,
  exclusions), per-request failure recording, provenance per call.
- ✅ Enrichment: bulk statistics (≤50 ids/unit), channel resolution with uploads
  playlists, format classification (Shorts/long/live/upcoming).
- ✅ Channel sampling: uploads-playlist based, per-scan channel budget by depth,
  bulk sample statistics.
- ✅ Scan orchestrator (`runNicheScan`): full pipeline with honest status
  (complete/partial/failed), usage accounting, live-stream exclusion,
  provenance, progress hooks; mock-integration tested end to end.

## Stage 3 — Performance intelligence ✅ (engine complete; UI pending)

- ✅ Baselines: median of comparable same-format uploads, candidate exclusion,
  insufficiency → unavailable, small samples → low confidence (unit-tested).
- ✅ Scoring `mos-scoring-v1`: weights 40/30/20/10, fixed anchors, missing-data
  exclusion, completeness floor (null score below 0.5), confidence penalty
  without baseline, full factor explanations; hand-computed test vectors
  (`docs/product/SCORING-MODEL.md`).
- ✅ Classification: Breakout / Rising / Evergreen / New-Entrant with exported
  thresholds and honest notes (momentum only from repeated observations).
- ✅ Evidence: provenance records, observation model, 7-day statistics TTL,
  30-day scan staleness, momentum computation.

## Stage 4 — Niche Explorer UI ⏳

First-run experience, niche editor, theme approval, progress, results/filters,
video/channel details, insights, saved scans, refresh/comparison.

## Stage 5 — Agent workflow ⏳

Typed MCP tools over the same services, `youtube-niche-research` skill, agent
workflow tests.

## Stage 6 — Production readiness and release ⏳/🚧

Full suites (CI), desktop production build (CI build job), Windows installer
(Windows CI job), Windows installation + graphical acceptance on the owner's
machine (🚧 owner scheduling), security/policy/retention review, release notes +
checksums.

## Evidence log

| Date | Evidence |
|---|---|
| 2026-11-17 | `pnpm install` exit 0 (1m36s); `pnpm typecheck` exit 0 (NODE_OPTIONS=--max-old-space-size=2600, 2m20s); `pnpm test:mos` **77/77 passed** (10 files); `pnpm test:engineering` **1,032 passed / 10 skipped** (167 files, 95s) after `pnpm --filter @zcode/contracts build`; full `verify:pre-push` gate green (worktree, e2e targets, lint, docs, db schema, architecture tests, `architecture:check --changed` 0 violations); history+tags+stage commits pushed to origin (verified via ls-remote) |
| 2026-11-17 | **CI run 44113597403 green on `6367d835`**: Linux checks (install, typecheck, engineering + MOS tests) ✅ and Linux production build (full recursive build incl. desktop renderer) ✅ |
| 2026-11-17 (session 2) | `pnpm test:mos` **93/93 passed** (loopback real-socket tests, scan-store real-sqlite tests, quota helpers); `architecture:check --changed` **0 violations** (mos + new mos-services module); **typecheck RED**: 36 TS2591 errors confined to packages/mos Node-builtin types under the root aggregate build only (per-package build passes) — see Stage 1 note; engineering suite not re-run this session |
