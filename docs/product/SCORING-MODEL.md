# MOS 4.0 scoring model

**Model version: `mos-scoring-v1`** · Implementation: `packages/mos/src/research/scoring.ts`
· Decision record: `docs/decisions/ADR-0005-scoring-model-v1.md`

These are MOS product metrics, **not** official YouTube metrics. Every value the
model uses is public data from the official YouTube Data API v3, collected with a
timestamp and provenance.

## Factors and weights

| Factor | Weight | Input | Normalization (fixed anchors) |
|---|---:|---|---|
| Channel breakout | 40% | `views ÷ median(views of the channel's recent comparable uploads)` | `clamp01(0.5 + log2(ratio) / 8)` — 1× → 0.50, 2× → 0.625, 16× → 1.00 |
| Views per day (estimate) | 30% | `views ÷ max(publication age in days, 0.5)` | `clamp01(log10(vpd + 1) / 5)` — 100 vpd ≈ 0.60, 100k vpd ≈ 1.00 |
| Engagement proxy | 20% | `(likes + comments) ÷ views` (public counts only) | `clamp01(rate / 0.05)` — 5% → 1.00 |
| Recency | 10% | publication age in days | 1.00 at ≤ 3 days, linear to 0.00 at 365 days |

## Baselines (the breakout input)

- Sample: the channel's recent uploads from its **uploads playlist** (official,
  cheap — 1 quota unit per channel), enriched in bulk (≤50 ids per unit).
- Comparable = same format group (Shorts vs long-form; live/upcoming never
  participate) and the candidate video itself is always excluded.
- Baseline = **median** view count of comparable samples (not the mean — one viral
  outlier must not define "normal").
- Fewer than 3 comparable videos → baseline **unavailable** (score confidence
  drops; never an invented baseline). 3–4 samples → available but low-confidence.

## Missing data — the honesty rules

1. A missing factor is excluded from the weighted mean; it is **never** scored as
   0 or 1. `completeness = Σ available weights ÷ Σ total weights`.
2. **Completeness < 0.5 → `overall = null`** ("insufficient data"), because a
   mean over less than half the model would produce plausible-looking numbers
   from gaps.
3. Hidden likes/comments: if one signal is available the proxy is computed from
   it and flagged `engagementPartial`; if both are hidden the factor is excluded.
4. `confidence = completeness × (baseline available ? 1.0 : 0.75)` — the breakout
   factor is the model's flagship, so a missing channel baseline explicitly
   reduces trust in the score.

## What these numbers are NOT

- "Views per day" is an **estimate from publication age**, not observed velocity.
  Observed momentum requires repeated observations across scans
  (`computeMomentum` in `research/evidence.ts`); a single observation is never a
  growth rate.
- "Engagement" is a **proxy** from public counts — not watch time, retention,
  click-through, or revenue. Competitors' private metrics are never inferred.
- Breakout/Rising/Evergreen/New-Entrant labels are **MOS analytical
  classifications** (thresholds in `research/classification.ts`), not YouTube
  categories.

## Worked example (pinned by unit tests)

100,000 views · 3,000 likes · 500 comments · published exactly 30 days ago ·
baseline median 10,000 (10 comparable videos):

```
breakout    = 0.5 + log2(10)/8        = 0.9152   (10× the channel median)
viewsPerDay = log10(3333.33+1)/5      = 0.7046   (≈3,333 est. views/day)
engagement  = 0.035/0.05              = 0.7000   (3.5% like+comment rate)
recency     = 1 − 27/362              = 0.9254
overall     = 0.4·0.9152 + 0.3·0.7046 + 0.2·0.7 + 0.1·0.9254 = 81.00 / 100
confidence  = 1.00   completeness = 1.00
```

Same video with **no baseline**: overall 73.99, confidence 0.45.
Same video with **hidden engagement**: overall 83.75, completeness 0.80.

## Versioning

The model version ships with every score (`modelVersion`), and saved scans keep
the version they were computed with. Changing weights, anchors, or missing-data
policy requires a new version (`mos-scoring-v2`, …) plus an entry here describing
the change and its effect on saved-scan comparability.
