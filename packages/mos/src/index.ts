/**
 * @zcode/mos — MOS 4.0 YouTube Content Intelligence core.
 *
 * Layers:
 * - capability: typed YouTube capability registry (TREG-inspired, single provider)
 * - quota: day-level quota accounting (search bucket + unit pool, PT reset)
 * - youtube: official YouTube Data API v3 client, schemas, OAuth primitives
 * - research: the niche → themes → discovery → baselines → scoring →
 *   classification engine shared by the Niche Explorer UI and agent tools
 */
export * from "./capability/index.js";
export * from "./quota/index.js";
export * from "./youtube/index.js";
export * from "./research/index.js";
