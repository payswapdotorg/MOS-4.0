# Known issues and limitations

Verified, current items only. Each entry says what was verified and what the
impact is.

## Environment (TL container: 2 vCPU / 4 GiB / no swap)

1. **Production Vite builds exceed 4 GiB.** `@zcode/web`, `@zcode/web-share`,
   and the desktop renderer production builds are OOM-killed in this container
   (verified 2026-11-17 during environment assessment, 4 separate kills incl.
   serial and heap-capped attempts). Consequence: production builds run on CI
   (`ci.yml` build job) — not locally. Typecheck/tests/dev-mode run fine.
2. **Typecheck needs a heap bump locally.** Default heap aborts at
   `@zcode/session-control`; `NODE_OPTIONS=--max-old-space-size=2600` passes
   (2600 verified on a long-running container; 3000 worked on a fresh one).
   CI runners use 3000 with 16 GiB.
3. **Windows packaging cannot run on Linux** (missing cmake/mingw; signing is
   Windows-host-only by design). Windows bundle runs on the `windows-latest`
   CI job.
4. **`xvfb-run` requires absent `xauth`** — headless desktop dev/E2E must start
   `Xvfb :99` manually (verified during assessment).

## Product / upstream

5. **Auto-update still points at ZCode infrastructure.** The updater feed URLs
   derive from ZCode's CDN config; a MOS 4.0 build will simply find no updates
   there (no breakage), but **repointing to MOS GitHub Releases is required
   before any public release**. Update checks in dev are inert.
6. **macOS `.icns` still the ZCode mark.** The icon generator regenerates PNG +
   `.ico` sets; `.icns` regeneration is deferred until macOS becomes a target.
7. **Renderer marketing copy is only partially rebranded.** Structural identity
   (installer, app name, About, window title, logos, major surfaces) is MOS;
   a full copy pass happens with the Stage 4 UI work. The `zcode://` deep-link
   scheme and `ZCODE_*` env names are intentionally unchanged (infrastructure).
8. **`@zcode/contracts` (and possibly other CLI packages) must be built before
   the engineering suite runs** on a fresh checkout (one suite imports a dist
   entry). CI does `pnpm --filter @zcode/contracts build` first; documented in
   ci.yml.

## External prerequisites (blocking, not defects)

9. **Google Cloud project / OAuth client / test account** — owner action
   required before any live-API verification (docs/integrations/YOUTUBE.md).
10. **Windows acceptance machine** — owner's Windows PC, for final install +
    graphical acceptance + real consent-screen flow.
