import { describe, expect, it } from "vitest";

import { nicheDefinitionSchema } from "../src/research/niche.js";
import { buildSearchPlan, depthBudgetFor } from "../src/research/planner.js";
import { deriveThemesFromNiche } from "../src/research/themes.js";
import type { SearchTheme } from "../src/research/themes.js";

const niche = nicheDefinitionSchema.parse({ description: "Home workout routines for women over 40" });

describe("deriveThemesFromNiche", () => {
  it("keeps the user's own description as the primary theme", () => {
    const expansion = deriveThemesFromNiche(niche);
    expect(expansion.source).toBe("derived");
    expect(expansion.themes[0]!.text).toBe("Home workout routines for women over 40");
  });

  it("is deterministic and deduplicated", () => {
    const first = deriveThemesFromNiche(niche);
    const second = deriveThemesFromNiche(niche);
    expect(first).toEqual(second);
    const texts = first.themes.map((theme) => theme.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("drops stopwords from derived keyword themes (templates keep natural phrasing)", () => {
    const expansion = deriveThemesFromNiche(niche);
    // The keyword-core themes ("... tips" / "... mistakes") carry no stopwords…
    const keywordThemes = expansion.themes.filter((theme) => /(tips|mistakes)$/.test(theme.text));
    expect(keywordThemes.length).toBeGreaterThan(0);
    for (const theme of keywordThemes) {
      expect(theme.text).not.toContain(" for ");
    }
    // …while template themes stay natural ("… for beginners") for real YouTube phrasing.
    expect(expansion.themes.some((theme) => theme.text.endsWith("for beginners"))).toBe(true);
  });
});

function themes(count: number): SearchTheme[] {
  return Array.from({ length: count }, (_, index) => ({ id: `t${index}`, text: `theme ${index}` }));
}

describe("buildSearchPlan", () => {
  it("spreads themes over relevance first, then viewCount, then date, within budget", () => {
    const plan = buildSearchPlan(niche, themes(6), { depthBudget: 12 });
    expect(plan.requests.length).toBe(12);
    expect(plan.requests.filter((request) => request.order === "relevance").length).toBe(6);
    expect(plan.requests.filter((request) => request.order === "viewCount").length).toBe(6);
    expect(plan.requests.filter((request) => request.order === "date").length).toBe(0);
    expect(plan.skippedThemes).toEqual([]);
    expect(plan.estimatedCost.searchCalls).toBe(12);
  });

  it("respects the ledger's remaining search budget and records skips", () => {
    const plan = buildSearchPlan(niche, themes(6), { depthBudget: 12, ledgerRemaining: 3 });
    expect(plan.requests.length).toBe(3);
    expect(plan.skippedThemes.length).toBe(3);
    expect(plan.skippedThemes[0]).toMatchObject({ themeId: "t3", reason: expect.stringContaining("budget") });
  });

  it("uses the API's short-duration bucket only for Shorts-only niches", () => {
    const shortNiche = nicheDefinitionSchema.parse({ description: "Quick stretching", format: "short" });
    const plan = buildSearchPlan(shortNiche, themes(2), { depthBudget: 4 });
    expect(plan.requests.every((request) => request.videoDuration === "short")).toBe(true);

    const longNiche = nicheDefinitionSchema.parse({ description: "Deep dives", format: "long" });
    const longPlan = buildSearchPlan(longNiche, themes(2), { depthBudget: 4 });
    expect(longPlan.requests.every((request) => request.videoDuration === "any")).toBe(true);
  });

  it("never exceeds a single-request page size and exposes the enrichment estimate", () => {
    const plan = buildSearchPlan(niche, themes(5), { depthBudget: 10 });
    expect(plan.requests.every((request) => request.maxResults <= 50)).toBe(true);
    // 10 requests × 25 results → 250 ids → ceil(250/50)=5 video chunks + channel chunks.
    expect(plan.enrichmentRequests).toBeGreaterThanOrEqual(5);
    expect(plan.estimatedCost.units).toBe(plan.enrichmentRequests);
  });

  it("depth budgets map quick < standard < deep", () => {
    expect(depthBudgetFor(nicheDefinitionSchema.parse({ description: "niche", depth: "quick" }))).toBeLessThan(
      depthBudgetFor(nicheDefinitionSchema.parse({ description: "niche", depth: "standard" })),
    );
    expect(depthBudgetFor(nicheDefinitionSchema.parse({ description: "niche", depth: "standard" }))).toBeLessThan(
      depthBudgetFor(nicheDefinitionSchema.parse({ description: "niche", depth: "deep" })),
    );
  });
});
