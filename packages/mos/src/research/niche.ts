import { z } from "zod";

/**
 * A niche as entered by the user in ordinary language, plus the research
 * scope. Defaults make it easy to start: standard depth, all formats, last
 * 365 days, no region/language restriction.
 */

export const nicheDefinitionSchema = z.object({
  /** Ordinary-language niche, e.g. "Home workout routines for women over 40". */
  description: z.string().min(3).max(300),
  /** ISO 3166-1 alpha-2 region code (YouTube regionCode parameter). */
  regionCode: z.string().length(2).optional(),
  /** BCP-47 language hint (YouTube relevanceLanguage parameter). */
  language: z.string().min(2).max(35).optional(),
  /** Only videos published inside this window are considered. */
  dateWindowDays: z.number().int().min(7).max(730).default(365),
  format: z.enum(["all", "short", "long"]).default("all"),
  /** Free-text terms; videos whose title contains one are dropped post-filter. */
  exclusions: z.array(z.string().min(1).max(100)).max(20).default([]),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
});

export type NicheDefinition = z.infer<typeof nicheDefinitionSchema>;

export const DEPTH_SEARCH_CALL_BUDGETS: Record<NicheDefinition["depth"], number> = {
  quick: 5,
  standard: 12,
  deep: 24,
};

/** Channels whose baselines are sampled per scan, by depth. */
export const DEPTH_CHANNEL_SAMPLE_BUDGETS: Record<NicheDefinition["depth"], number> = {
  quick: 12,
  standard: 30,
  deep: 60,
};

/** Recent uploads sampled per channel for the baseline. */
export const DEPTH_PER_CHANNEL_SAMPLE_SIZE: Record<NicheDefinition["depth"], number> = {
  quick: 10,
  standard: 15,
  deep: 25,
};
