import { z } from "zod";

/**
 * Quota model — verified against Google's official quota documentation
 * (developers.google.com/youtube/v3/determine_quota_cost, checked 2026-11-17):
 *
 * - `search.list` and `videos.insert` each have their OWN default daily bucket
 *   of 100 calls (cost 1 per call), separate from the general pool.
 * - All other methods share a default project quota of 10,000 units/day;
 *   `videos.list` and `channels.list` cost 1 unit per request.
 * - Every request (even invalid ones) costs at least 1 unit.
 * - Quotas reset at midnight Pacific Time, per Google Cloud project.
 *
 * Project limits can be raised by the owner; the ledger takes the limits as
 * configuration and never assumes values beyond these defaults.
 */

export const DEFAULT_SEARCH_CALLS_PER_DAY = 100;
export const DEFAULT_UNITS_PER_DAY = 10_000;

/** One quota cost unit. `searchCall` draws from the separate search bucket. */
export type QuotaCost = { kind: "searchCall" } | { kind: "units"; units: number };

export class QuotaExhaustedError extends Error {
  constructor(
    public readonly bucket: "searchCalls" | "units",
    public readonly snapshot: QuotaSnapshot,
  ) {
    super(
      `YouTube API ${bucket === "searchCalls" ? "search call" : "quota unit"} daily limit reached ` +
        `(used ${bucket === "searchCalls" ? snapshot.searchCallsUsed : snapshot.unitsUsed}/` +
        `${bucket === "searchCalls" ? snapshot.searchCallsLimit : snapshot.unitsLimit}); resets at midnight PT.`,
    );
    this.name = "QuotaExhaustedError";
  }
}

export interface QuotaSnapshot {
  /** Pacific-Time date the counters belong to (YYYY-MM-DD). */
  datePt: string;
  searchCallsUsed: number;
  searchCallsLimit: number;
  unitsUsed: number;
  unitsLimit: number;
}

export interface QuotaCostEstimate {
  searchCalls: number;
  units: number;
}

function pacificDate(now: Date): string {
  return currentPacificDate(now);
}

/** Current Pacific-Time calendar date (YYYY-MM-DD) — the Google quota day. */
export function currentPacificDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Day-level quota accounting for one Google Cloud project. The ledger is the
 * single source of truth shared by the UI scan planner and the API client, so
 * a scan can display its estimated cost before running and can never silently
 * exceed the configured budget.
 */
export class QuotaLedger {
  private datePt: string;
  private searchCallsUsed = 0;
  private unitsUsed = 0;
  private readonly now: () => Date;

  constructor(
    private readonly options: {
      now?: () => Date;
      searchCallsLimit?: number;
      unitsLimit?: number;
    } = {},
  ) {
    this.now = options.now ?? ((): Date => new Date());
    this.datePt = pacificDate(this.now());
  }

  get searchCallsLimit(): number {
    return this.options.searchCallsLimit ?? DEFAULT_SEARCH_CALLS_PER_DAY;
  }

  get unitsLimit(): number {
    return this.options.unitsLimit ?? DEFAULT_UNITS_PER_DAY;
  }

  snapshot(): QuotaSnapshot {
    this.rollDateIfNeeded();
    return {
      datePt: this.datePt,
      searchCallsUsed: this.searchCallsUsed,
      searchCallsLimit: this.searchCallsLimit,
      unitsUsed: this.unitsUsed,
      unitsLimit: this.unitsLimit,
    };
  }

  /** Pre-flight check: whether one more operation of this cost is allowed. */
  canAfford(cost: QuotaCost): boolean {
    this.rollDateIfNeeded();
    if (cost.kind === "searchCall") {
      return this.searchCallsUsed + 1 <= this.searchCallsLimit;
    }
    return this.unitsUsed + cost.units <= this.unitsLimit;
  }

  /** Post-call accounting. Throws if the call pushed usage past a limit. */
  record(cost: QuotaCost): void {
    this.rollDateIfNeeded();
    if (cost.kind === "searchCall") {
      this.searchCallsUsed += 1;
      if (this.searchCallsUsed > this.searchCallsLimit) {
        throw new QuotaExhaustedError("searchCalls", this.snapshot());
      }
      return;
    }
    this.unitsUsed += cost.units;
    if (this.unitsUsed > this.unitsLimit) {
      throw new QuotaExhaustedError("units", this.snapshot());
    }
  }

  /** Estimated cost of a scan plan, for display before the user approves it. */
  static estimateScanCost(plan: { requests: unknown[]; enrichmentRequests: number }): QuotaCostEstimate {
    return {
      searchCalls: plan.requests.length,
      units: plan.enrichmentRequests,
    };
  }

  /**
   * Seed the ledger with usage already spent today (recomputed from persisted
   * scans when the service restarts mid-day). Never marks the ledger over
   * limit — the numbers are historical facts; the next pre-flight check fails.
   */
  applyExistingUsage(usage: QuotaCostEstimate): void {
    this.rollDateIfNeeded();
    this.searchCallsUsed += usage.searchCalls;
    this.unitsUsed += usage.units;
  }

  private rollDateIfNeeded(): void {
    const today = pacificDate(this.now());
    if (today !== this.datePt) {
      this.datePt = today;
      this.searchCallsUsed = 0;
      this.unitsUsed = 0;
    }
  }
}

/**
 * UTC instant of the most recent Pacific-Time midnight — the moment the Google
 * quota day started. Derived from the PT wall clock of `now`, so it stays
 * correct across PDT/PST switches within the same PT day.
 */
export function startOfCurrentPacificDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
  const [hour, minute, second] = parts.split(":").map((value) => Number(value));
  const msSincePtMidnight = ((hour ?? 0) * 3_600 + (minute ?? 0) * 60 + (second ?? 0)) * 1_000;
  return new Date(now.getTime() - msSincePtMidnight);
}

export const quotaCostSchema: z.ZodType<QuotaCost> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("searchCall") }),
  z.object({ kind: z.literal("units"), units: z.number().int().min(1) }),
]) as z.ZodType<QuotaCost>;
