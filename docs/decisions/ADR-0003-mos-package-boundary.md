# ADR-0003: MOS code lives in one new package with its own test project

Date: 2026-11-17 · Status: accepted

## Context

MOS must share one research engine between UI and agent tools, keep upstream merge
friction minimal, and be testable in the 4 GiB build container (where production
Vite builds OOM but tsc/vitest run fine). Upstream deliberately has no app-business
unit-test project (root `vitest.config.ts` runs only `engineering` + `zcode-cua`).

## Decision

- All MOS logic lives in **`packages/mos`** (`@zcode/mos`), pure TypeScript with
  only `zod` as a runtime dependency; no Electron imports; `fetch`, clock, and
  quota ledger are injected everywhere. Sub-entry exports:
  `/capability`, `/quota`, `/youtube`, `/research`.
- The package exports **source TS** (`./src/index.ts`, matching the repo's
  internal-package convention) and compiles under `strict: true` via the root
  `tsc -b` list.
- Tests live in `packages/mos/test` under a dedicated vitest project (`mos`,
  registered in root `vitest.config.ts`, run via `pnpm test:mos`), using mocked
  `fetch` — no network in unit tests.
- Modified upstream wiring (the complete list): root `package.json` (adds
  `test:mos` script and `packages/mos` in the typecheck list) and
  `vitest.config.ts` (adds the project entry). Nothing else.

## Consequences

- The whole engine is runnable and verifiable in constrained environments; CI
  runs it everywhere; the desktop/services integration (later stages) consumes
  the same package.
- Upstream merges can only conflict on the two wiring files above.
