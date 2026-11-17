/**
 * @zcode/mos — MOS 4.0 YouTube Content Intelligence core.
 *
 * Layers:
 * - capability: typed YouTube capability registry (TREG-inspired, single provider)
 * - quota: day-level quota accounting (search bucket + unit pool, PT reset)
 * - youtube: official YouTube Data API v3 client, schemas, OAuth primitives,
 *   and the RFC 8252 loopback callback server (node-only sub-entry)
 * - research: the niche → themes → discovery → baselines → scoring →
 *   classification engine shared by the Niche Explorer UI and agent tools
 * - persistence: the local scan store (node:sqlite + shared migration runner;
 *   node-only sub-entry)
 *
 * Browser/renderer consumers must import ONLY the pure sub-entries
 * (`/capability`, `/quota`, `/research`); `/youtube` and `/persistence` use
 * Node built-ins.
 */
export * from "./capability/index.js";
export * from "./quota/index.js";
export * from "./youtube/index.js";
export * from "./research/index.js";
export * from "./persistence/index.js";
