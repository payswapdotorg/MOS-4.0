import type { z } from "zod";

import type { QuotaCost } from "../quota/ledger.js";

/**
 * Capability definitions describe one auditable, typed YouTube operation each.
 * Modeled on TREG's capability catalog (src/treg/catalog), reduced to a single
 * provider. Every capability pins: request/response schemas, required OAuth
 * scope, quota cost, retry policy, and an honest verification status.
 */

export type CapabilityId =
  | "youtube.search.videos"
  | "youtube.video.detail"
  | "youtube.video.stats.bulk"
  | "youtube.channel.profile"
  | "youtube.channel.uploads"
  | "youtube.channel.analytics";

export type CredentialType = "oauth" | "apiKey" | "oauth-analytics";

export type VerificationStatus =
  /** Endpoint reachability and unauthenticated error semantics verified from the build environment. */
  | "verified-reachability"
  /** Full request/response behavior verified with authorized credentials against the live API. */
  | "verified-live"
  /** Not yet exercised; claims in this registry must not be presented as verified. */
  | "pending-live-verification";

export interface CapabilityVerification {
  status: VerificationStatus;
  evidence: string;
  verifiedAt?: string;
}

export interface CapabilityDefinition {
  id: CapabilityId;
  /** User-facing description (shown in the UI's connection/quota surfaces). */
  description: string;
  endpoint: { baseUrl: string; method: "GET" | "POST"; path: string };
  scopes: string[];
  credentialType: CredentialType;
  quota: QuotaCost;
  rateLimit: {
    maxRetries: number;
    /** HTTP statuses / error reasons that are retried with backoff. */
    retryOn: string[];
    notes?: string;
  };
  errorHandling: string;
  verification: CapabilityVerification;
  requestSchema: z.ZodType;
  responseSchema: z.ZodType;
  /** Analytics capabilities are opt-in (separate sensitive scope, owner-controlled). */
  enabledByDefault: boolean;
}
