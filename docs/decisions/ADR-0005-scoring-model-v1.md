# ADR-0005: Scoring model v1 — deterministic anchors, honest missing data

Date: 2026-11-17 · Status: accepted

## Context

Rankings must be transparent and reproducible: users must see why a video scores
highly, scores must not shuffle when the result set changes, and missing metrics
must never silently produce good scores. "Views per day" from publication age is an
estimate, not observed velocity; engagement from public counts is a proxy.

## Decision

Model `mos-scoring-v1` (implementation: `packages/mos/src/research/scoring.ts`,
full math in `docs/product/SCORING-MODEL.md`):

- Weights: breakout 0.40, viewsPerDay 0.30, engagement 0.20, recency 0.10.
- Fixed normalization anchors (no within-scan fitting):
  breakout `clamp01(0.5 + log2(ratio)/8)`; viewsPerDay
  `clamp01(log10(vpd+1)/5)`; engagement `clamp01(rate/0.05)`; recency linear
  1.0→0 over 3→365 days.
- Missing factors are excluded from the weighted mean and reduce
  `completeness`; below **0.5 completeness the overall score is `null`**
  ("insufficient data"), never a number built from gaps.
- Confidence = completeness × (baseline available ? 1.0 : 0.75) — the breakout
  factor is the flagship, so a missing channel baseline explicitly reduces trust.
- Scores are versioned (`modelVersion` on every result) and pure functions of
  their inputs; hand-computed test vectors pin the arithmetic
  (`packages/mos/test/scoring.test.ts`).

## Consequences

- Adding videos to a scan cannot change another video's score.
- Raising weights/anchors requires a new model version and a migration note in
  SCORING-MODEL.md; saved scans keep the version they were computed with.
