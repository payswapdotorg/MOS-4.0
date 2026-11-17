import type { QuotaCostEstimate } from "../quota/ledger.js";
import { DEPTH_SEARCH_CALL_BUDGETS } from "./niche.js";
import type { NicheDefinition } from "./niche.js";
import type { SearchTheme } from "./themes.js";

/**
 * Workflow D planning: turn approved themes into concrete search requests
 * under the scan's search-call budget, then expose the estimated quota cost
 * to the user before anything runs.
 */

export type SearchOrderPlan = "relevance" | "date" | "viewCount";

export interface SearchRequestPlan {
  themeId: string;
  query: string;
  order: SearchOrderPlan;
  maxResults: number;
  regionCode?: string;
  relevanceLanguage?: string;
  publishedAfter: string;
  publishedBefore: string;
  /** Pre-filter to the API's own "short" bucket only when the niche is Shorts-only. */
  videoDuration: "any" | "short";
}

export interface SearchPlan {
  requests: SearchRequestPlan[];
  estimatedCost: QuotaCostEstimate;
  /** Themes dropped because the search-call budget was exhausted. */
  skippedThemes: { themeId: string; reason: string }[];
  /** Unit requests the enrichment phase is expected to spend (for the pre-run cost display). */
  enrichmentRequests: number;
}

export interface PlanBudget {
  /** Hard cap from the niche depth. */
  depthBudget: number;
  /** Calls still affordable in the shared ledger today (search bucket). */
  ledgerRemaining?: number;
}

const MAX_RESULTS_PER_REQUEST = 50;
const STANDARD_RESULTS = 25;

export function buildSearchPlan(niche: NicheDefinition, themes: SearchTheme[], budget: PlanBudget): SearchPlan {
  const effectiveBudget = Math.max(
    1,
    Math.min(budget.depthBudget, budget.ledgerRemaining ?? Number.MAX_SAFE_INTEGER),
  );

  const publishedAfter = new Date(Date.now() - niche.dateWindowDays * 86_400_000).toISOString();
  const publishedBefore = new Date().toISOString();
  const videoDuration = niche.format === "short" ? "short" : "any";

  // Order strategy: every theme gets a relevance pass first (broadest match),
  // then top themes get date and viewCount passes while budget remains —
  // never rely on a single query or a single ordering.
  const requests: SearchRequestPlan[] = [];
  const skippedThemes: { themeId: string; reason: string }[] = [];

  const base: Omit<SearchRequestPlan, "query" | "themeId" | "order"> = {
    maxResults: STANDARD_RESULTS,
    regionCode: niche.regionCode,
    relevanceLanguage: niche.language,
    publishedAfter,
    publishedBefore,
    videoDuration,
  };

  for (const theme of themes) {
    if (requests.length < effectiveBudget) {
      requests.push({ ...base, themeId: theme.id, query: theme.text, order: "relevance" });
    } else {
      skippedThemes.push({ themeId: theme.id, reason: "search-call budget reached" });
    }
  }

  // Secondary orderings: breadth first — every theme gets a viewCount pass
  // before any theme gets a date pass, until the budget is spent.
  const secondaryOrders: SearchOrderPlan[] = ["viewCount", "date"];
  const relevanceRequests = requests.filter((request) => request.order === "relevance");
  outer: for (const order of secondaryOrders) {
    for (const source of relevanceRequests) {
      if (requests.length >= effectiveBudget) break outer;
      requests.push({ ...source, order });
    }
  }

  const estimatedDiscoveryVideos = requests.length * STANDARD_RESULTS;
  const enrichmentRequests = Math.ceil(estimatedDiscoveryVideos / 50) * 2; // videos.list + channels.list (approx.)

  return {
    requests,
    estimatedCost: QuotaLedger_estimate(requests.length, enrichmentRequests),
    skippedThemes,
    enrichmentRequests,
  };
}

function QuotaLedger_estimate(searchCalls: number, units: number): QuotaCostEstimate {
  return { searchCalls, units };
}

export function depthBudgetFor(niche: NicheDefinition): number {
  return DEPTH_SEARCH_CALL_BUDGETS[niche.depth];
}
