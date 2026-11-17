# Release state

## Pipelines (this repository)

| Workflow | Trigger | Produces |
|---|---|---|
| `ci.yml → checks` | push/PR | install, typecheck (heap 3000), `@zcode/contracts` prebuild, engineering tests, MOS tests |
| `ci.yml → build` | push to main / manual | full recursive production build (incl. desktop renderer) on a 16 GiB runner |
| `windows-release.yml` | manual / `v*` tags | Windows x64 NSIS installer, `SHA256SUMS.txt`, `BUILD-INFO.txt` (commit/ref/node/pnpm), artifact upload; tag builds create a GitHub Release with the assets |

## Current status (2026-11-17)

- **No MOS release has been cut yet.** The product is at Stage 1–3 (engine) with
  Stages 4–6 pending (see IMPLEMENTATION-STATE.md).
- First CI run was triggered by the Stage 0–3 push; its outcome will be recorded
  here. A green CI build is **not** Windows acceptance (see below).
- Release blockers, in order: Niche Explorer UI (Stage 4), agent workflow
  (Stage 5), live YouTube verification (owner Google Cloud project), Windows
  installer run on CI, and human Windows acceptance on the owner's machine.

## Release checklist (per release)

1. `main` green in CI (checks + build jobs).
2. `windows-release.yml` run on the release commit; artifacts + checksums uploaded.
3. Live-API verification evidence attached (labeled as live, not mock).
4. Windows acceptance on the owner's machine: install, launch, connect YouTube
   (real consent screen), complete + save a niche scan. Evidence recorded here.
5. Tag `v4.x.y`, release notes with known limitations, `RELEASE-STATE.md` updated
   with build commit, artifact names, and SHA-256 values.
