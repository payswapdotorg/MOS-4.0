# MOS 4.0 MVP specification

The MVP is complete when a real user can go from a blank first-launch screen to a
useful, saved, evidence-backed niche research result. This file is the user-facing
requirement set; implementation state lives in `docs/handoff/IMPLEMENTATION-STATE.md`.

## Scope

In: YouTube public-content research (one connected account at a time), niche →
themes → discovery → ranking → insights → saved scans; the retained ZCode agent
workbench; own-channel analytics as an opt-in extra.

Out (explicitly): other platforms, scraping, publishing/uploading/commenting,
multi-provider marketplaces, multi-tenant administration, TREG's billing/org
architecture, video editing/generation, ad management.

## Workflows

### A. First launch and connection
The app presents its purpose, explains how YouTube research works, and offers
"Connect YouTube" (read-only permissions, plainly explained). Connection health
and authorization status are visible. **Public niche research is not blocked** if
the user skips connecting (an API-key path may serve public data); the parts that
need a connected account are labeled. Verification: first-run journey test.

### B. Create a niche
Ordinary-language niche + optional region, language, date window (7–730 days),
format (all/Shorts/long-form), exclusions (≤20), depth (quick/standard/deep).
Sensible defaults: all formats, 365 days, standard depth. Verification: config
round-trips into a scan plan; invalid input is rejected with clear messages.

### C. AI search-theme expansion
The model expands the niche into 4–7 editable themes; the user reviews, edits,
adds, removes, and approves before any search runs. **If no LLM is available, a
manual/derived theme workflow is offered — never a broken screen.** Verification:
derived/manual themes produce a valid plan (unit-tested; UI test later stage).

### D. Discover and enrich videos
Plan executes under the quota budget with visible progress (current theme,
candidate count). Dedup across requests and orderings; region/language/date
filters; bulk statistics enrichment (≤50 ids per unit); channel resolution;
uploads-playlist sampling for baselines; provenance and quota recorded per call.
**A failed upstream call shows as a failure — results are never silently
inflated.** Verification: mock-integration test pins the full pipeline;
live-API gate separately (see testing strategy).

### E. Channel baselines
Median (not mean) of recent comparable public uploads; same-format comparison
only (Shorts vs long-form; live excluded); candidate excluded from its own
baseline; insufficient history → baseline explicitly unavailable with reduced
confidence. Verification: unit tests incl. exclusion, segmentation, and
insufficiency paths.

### F. Rank the videos
Versioned, deterministic scoring (`mos-scoring-v1`; weights 40/30/20/10;
fixed anchors; missing-data rules; completeness floor 0.5). Score explanations
show inputs, weights, normalization, and limitations for every video.
Verification: hand-computed unit vectors; determinism test.

### G. Results exploration
Views: **Breakouts** (ratio ≥ 2× baseline with adequate confidence), **Rising**
(recent + strong estimated pace; measured momentum only after repeat
observations), **Evergreen** (age ≥ 90 days with sustained pace), **New
Entrants** (channels ≤ 10k subscribers scoring ≥ 60). Sort by score / views /
estimated views-per-day; filter by channel size, format, age, theme; score
explanations on demand; open the original video/channel. These are MOS
classifications, not YouTube's.

### H. Content intelligence
LLM analysis over collected evidence: repeated topics, formats, title/hooks,
duration patterns, breakout commonalities, channel-size patterns, underserved
subtopics, opportunities. Every factual claim links to the videos/channels it
rests on. Observed data, statistical interpretation, AI hypotheses, and suggested
opportunities are visually separated; speculative causes are never presented as
confirmed explanations.

### I. Save and revisit research
Save niches and scans; reopen with original collection date; staleness badges
(7-day statistics TTL, 30-day scan staleness); refresh research; compare scans
over time; track changes between observations (momentum). Scoring version and
input evidence persist so ranking changes are explainable. Deletion honors the
retention rules in `docs/integrations/YOUTUBE.md`.

## Non-functional requirements

- A normal person can use it without knowing what an API, MCP, agent, or
  capability registry is.
- The UI is the primary surface; the agent can drive the same services; neither
  is the only path in or out.
- Credentials never reach the LLM, tool output, logs, or ordinary storage.
- Development always uses isolated data directories (`ZCODE_DATA_BASE_DIR`).
