# Testing strategy

## Tiers (reported separately, never conflated)

| Tier | What it covers | Where it runs | Status |
|---|---|---|---|
| **Unit** | Quota ledger, OAuth primitives (PKCE, loopback parsing, single-flight refresh), format classification, baselines, scoring vectors, classification thresholds, evidence/momentum | `pnpm test:mos` — every push/PR (CI + locally) | ✅ active |
| **Mock integration** | Full scan pipeline (plan → discover → dedup → enrich → sample → baseline → score → classify → provenance → quota accounting) against a faithful fake API | `pnpm test:mos` (scan.test.ts) | ✅ active |
| **Repository engineering suite** | ZCode engineering tests incl. MOS identity/version regression guards | `pnpm test:engineering` — every push/PR | ✅ active (1,032 passing at 2026-11-17) |
| **Typecheck** | Whole monorepo incl. `packages/mos` under `strict` | `pnpm typecheck` (heap note: `--max-old-space-size=2600` on 4 GiB machines) | ✅ active |
| **Live API (owner-gated)** | Authorized calls against the real YouTube Data API: connect, own channel, search, stats, full scan, ranked results, save/reopen | Separate, explicitly labeled runs; **blocked on the owner's Google Cloud project** | ⏳ gate open |
| **Desktop E2E** | Niche Explorer journey in the packaged app | CI (Windows/Linux runners) + Docker E2E image | ⏳ later stage |
| **Windows acceptance** | Installer on the owner's Windows machine: install, launch, connect YouTube, complete a niche scan | Human acceptance with evidence | ⏳ gate open |

Mocked and live results are never reported as the same tier. A green mock
integration test is never claimed as live verification.

## Pinned regression guards (in the engineering suite)

- `packages/desktop/test/desktopProductIdentity.test.ts`: root/desktop/lock
  versions stay in lockstep **and** the desktop shell carries a semver `version`
  (the electron-updater dev-crash regression), plus the full MOS identity matrix.
- Scan determinism: identical inputs must yield identical scores (mos project).

## Live-test prerequisites (owner actions)

Google Cloud project with YouTube Data API v3 enabled, a Desktop-type OAuth
client, and an authorized test account. The client id/secret enter CI/localhost
via environment secrets, never the repository. Live tests are opt-in
(`MOS_LIVE_YOUTUBE=1` + credentials) so default CI runs never touch quota.

## Acceptance evidence

Each stage's evidence (commands, exit codes, screenshots, run URLs) is recorded in
`docs/handoff/IMPLEMENTATION-STATE.md` and `docs/handoff/RELEASE-STATE.md`.
Green ticks are used only for demonstrated work.
