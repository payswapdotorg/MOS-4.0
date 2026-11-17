# Upstream baseline

This repository is a downstream product fork of **ZCode** with the complete upstream
Git history preserved. This file is the authoritative record of the import.

| Field | Value |
|---|---|
| Product | MOS 4.0 (YouTube Content Intelligence) |
| Upstream | https://github.com/zai-org/zcode |
| Baseline commit | `fec975905a2abd4c07e35c40d51fa097a2258ec9` |
| Baseline tag | `v3.18.2` ("chore: sync ZCode source v3.18.2", 2026-11-13) |
| Import date | 2026-11-17 |
| Import method | full `git clone` (all objects and tags), remotes configured as `upstream` (zai-org/zcode) and `origin` (payswapdotorg/MOS-4.0); `main` pushed at the baseline commit with all upstream tags |
| MOS version line | `4.0.0` (root `package.json`, `package-lock.json`, and `packages/desktop/package.json` are kept in lockstep — enforced by `packages/desktop/test/desktopProductIdentity.test.ts`) |

## Remotes

```bash
git remote -v
# origin   https://github.com/payswapdotorg/MOS-4.0.git   (push/pull product work)
# upstream https://github.com/zai-org/zcode.git            (fetch upstream updates)
```

## Upstream merge policy

1. Fetch `upstream` and inspect the delta (`git log main..upstream/main`).
2. Merge or rebase onto `main`; upstream history is never rewritten here.
3. Resolve expected friction points first: root `package.json` version (keep the MOS
   line), `packages/desktop/scripts/desktop-product-identity.mjs` (keep MOS identity),
   `packages/desktop/package.json` `version` field (must stay — it fixes the dev-mode
   `electron-updater` crash), and branding strings listed in
   `docs/decisions/ADR-0002-product-identity.md`.
4. Run `pnpm typecheck && pnpm test:engineering && pnpm test:mos` before pushing.
5. All MOS product code lives in `packages/mos/` and MOS-specific repo files
   (`docs/`, `.github/workflows/`, `scripts/mos/`) — these never conflict with
   upstream. Modified upstream files are listed in ADR-0002 and ADR-0003.
