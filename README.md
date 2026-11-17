# MOS 4.0

**MOS 4.0** is an AI-powered YouTube Content Intelligence desktop application built on
[ZCode](https://github.com/zai-org/zcode). Describe a YouTube niche in ordinary language;
MOS expands it into search themes, discovers public videos through the **official
YouTube Data API v3**, ranks them with a transparent, explainable performance model
(channel breakout, estimated views per day, engagement proxy, recency), and shows you
what is working and where the opportunities are.

- Enter a niche → approve AI-generated (or manual) search themes → run a scan.
- Every result explains its score: inputs, weights, normalization, and data gaps.
- Breakouts, Rising, Evergreen, and New Entrants are MOS analytical views.
- The full ZCode agent workbench remains available alongside the Niche Explorer.

## Status

Under active development. See [docs/handoff/IMPLEMENTATION-STATE.md](docs/handoff/IMPLEMENTATION-STATE.md)
for the authoritative stage-by-stage state and [docs/handoff/KNOWN-ISSUES.md](docs/handoff/KNOWN-ISSUES.md)
for verified limitations.

## Repository layout (MOS additions to ZCode)

| Path | Purpose |
|---|---|
| `packages/mos/` | MOS core: capability registry, quota ledger, official YouTube API client (OAuth PKCE + retry/backoff), and the research engine (planning → discovery → baselines → scoring → classification) |
| `packages/mos/src/research/scan.ts` | The end-to-end scan pipeline shared by the UI and agent tools |
| `docs/` | Product spec, scoring model, integration notes, decision records, handoff state |
| `.github/workflows/` | CI (Linux checks + production build) and the Windows installer/release pipeline |
| `scripts/mos/` | MOS tooling (e.g. product icon generation) |

Everything else is upstream ZCode, preserved with full history (see
[docs/handoff/UPSTREAM-BASELINE.md](docs/handoff/UPSTREAM-BASELINE.md)).

## Development

Requirements: Node.js **24.14.0**, pnpm **10.33.2** (`mise.toml` is the source of
truth), Git. Run commands from the repository root.

```bash
pnpm install          # dependencies (updates lockfile when needed)

pnpm typecheck        # full monorepo typecheck
                      # small machines: NODE_OPTIONS=--max-old-space-size=2600
pnpm test:engineering # repository engineering suite
pnpm test:mos         # MOS unit + mock-integration tests
```

Desktop development:

```bash
ZCODE_DATA_BASE_DIR="$HOME/.mos-dev-home" pnpm dev:desktop      # production env
ZCODE_DATA_BASE_DIR="$HOME/.mos-dev-home" pnpm dev:desktop:test # test env
```

Always set `ZCODE_DATA_BASE_DIR` for development — it keeps MOS dev data fully
separate from any installed copy.

Packaging (Windows x64 installer) runs on CI:
`pnpm bundle:desktop -- --os win --arch x64` must run on a Windows host (see
[docs/handoff/RELEASE-STATE.md](docs/handoff/RELEASE-STATE.md)).

## CI / release

- `.github/workflows/ci.yml` — on every push/PR: install, typecheck, engineering
  tests, MOS tests; on main: full production build on a resource-appropriate runner.
- `.github/workflows/windows-release.yml` — manual or on `v*` tags: native Windows
  x64 NSIS bundle, SHA-256 checksums, artifacts, and (for tags) a GitHub release.

## License

Apache-2.0 (inherited from ZCode; see `LICENSE` and `NOTICE.md`).
