# ADR-0001: Repository import, baseline, and versioning

Date: 2026-11-17 · Status: accepted

## Context

`payswapdotorg/MOS-4.0` was empty; the product must be a downstream fork of ZCode
with full upstream history, able to merge upstream updates later.

## Decision

- Import via full `git clone` of `zai-org/zcode`; `main` starts at the pinned
  baseline `fec9759` (tag `v3.18.2`); all upstream tags pushed.
  Remotes: `origin` = payswapdotorg/MOS-4.0, `upstream` = zai-org/zcode.
- MOS versions on its own line starting at **4.0.0**, kept in lockstep across root
  `package.json`, `package-lock.json`, and `packages/desktop/package.json`
  (enforced by `packages/desktop/test/desktopProductIdentity.test.ts`).
- Upstream READMEs preserved at `docs/upstream/ZCODE-README{,.en}.md`; product
  README is repository-root `README.md`.

## Consequences

- Upstream merges touch the version fields and the small identity file set
  (see ADR-0002); merge friction is bounded and listed.
- Tag namespace is shared with upstream (`v3.x`); MOS releases use `v4.x`+ tags,
  which cannot collide with the imported `v3.x` series.
