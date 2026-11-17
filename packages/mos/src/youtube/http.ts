import { googleErrorSchema } from "./schemas.js";

/**
 * HTTP core for Google APIs: typed errors, quota classification, and bounded
 * exponential backoff. `fetch` and `sleep` are injected so tests are fully
 * deterministic and no network is touched.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type SleepLike = (ms: number) => Promise<void>;

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 8_000 };

/** Fatal 403 reasons: the project's daily quota is gone — retrying cannot help. */
const FATAL_QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"]);
/** Retryable rate reasons: per-user/short-window throttles. */
const RETRYABLE_RATE_REASONS = new Set(["userRateLimitExceeded", "backendError", "internalError"]);

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: string | null,
    public readonly retryable: boolean,
    public readonly url: string,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export class QuotaExhaustedApiError extends YouTubeApiError {
  constructor(message: string, url: string) {
    super(message, 403, "quotaExceeded", false, url);
    this.name = "QuotaExhaustedApiError";
  }
}

export class SchemaMismatchError extends Error {
  constructor(
    message: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "SchemaMismatchError";
  }
}

function parseErrorReason(body: unknown): { message: string; reason: string | null } {
  const parsed = googleErrorSchema.safeParse(body);
  if (!parsed.success) {
    return { message: "YouTube API request failed with an unparseable error body.", reason: null };
  }
  const first = parsed.data.error.errors?.[0];
  return {
    message: parsed.data.error.message ?? "YouTube API request failed.",
    reason: first?.reason ?? null,
  };
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: text.slice(0, 500) } };
  }
}

function delayForAttempt(policy: RetryPolicy, attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1_000, policy.maxDelayMs * 4);
  }
  return Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
}

export interface FetchJsonOptions {
  fetch: FetchLike;
  sleep?: SleepLike;
  retry?: RetryPolicy;
  onRetry?: (info: { attempt: number; status: number; reason: string | null; delayMs: number }) => void;
}

/**
 * GET a JSON document with the documented retry policy:
 * - 403 quotaExceeded / dailyLimitExceeded / rateLimitExceeded → QuotaExhaustedApiError, no retry;
 * - 429, 5xx, 403 userRateLimitExceeded → bounded exponential backoff (Retry-After honored);
 * - any other 4xx → immediate typed error, no retry.
 */
export async function fetchJsonWithRetry(url: string, options: FetchJsonOptions): Promise<unknown> {
  const policy = options.retry ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? (async (ms: number) => { await new Promise((r) => setTimeout(r, ms)); });

  let attempt = 0;
  // attempt 0 = first try; retries happen while attempt <= policy.maxRetries
  for (;;) {
    let response: Response;
    try {
      response = await options.fetch(url);
    } catch (cause) {
      if (attempt >= policy.maxRetries) {
        throw new YouTubeApiError(
          `Network error calling YouTube API: ${cause instanceof Error ? cause.message : String(cause)}`,
          0,
          null,
          false,
          url,
        );
      }
      const delayMs = delayForAttempt(policy, attempt, null);
      options.onRetry?.({ attempt, status: 0, reason: null, delayMs });
      await sleep(delayMs);
      attempt += 1;
      continue;
    }

    if (response.ok) {
      return await readBody(response);
    }

    const body = await readBody(response);
    const { message, reason } = parseErrorReason(body);

    if (response.status === 403 && reason !== null && FATAL_QUOTA_REASONS.has(reason)) {
      throw new QuotaExhaustedApiError(
        `${message} (reason=${reason}; daily quota for this Google Cloud project is exhausted)`,
        url,
      );
    }

    const retryable =
      response.status === 429 ||
      response.status >= 500 ||
      (response.status === 403 && reason !== null && RETRYABLE_RATE_REASONS.has(reason));

    if (!retryable || attempt >= policy.maxRetries) {
      throw new YouTubeApiError(
        `${message} (status=${response.status}${reason ? `, reason=${reason}` : ""})`,
        response.status,
        reason,
        retryable,
        url,
      );
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader !== null ? Number(retryAfterHeader) : null;
    const delayMs = delayForAttempt(policy, attempt, Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null);
    options.onRetry?.({ attempt, status: response.status, reason, delayMs });
    await sleep(delayMs);
    attempt += 1;
  }
}

export function buildQueryUrl(baseUrl: string, path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
