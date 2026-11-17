import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_CALLS_PER_DAY,
  DEFAULT_UNITS_PER_DAY,
  QuotaExhaustedError,
  QuotaLedger,
} from "../src/quota/ledger.js";

describe("QuotaLedger", () => {
  it("fresh ledger affords both buckets", () => {
    const ledger = new QuotaLedger();
    expect(ledger.canAfford({ kind: "searchCall" })).toBe(true);
    expect(ledger.canAfford({ kind: "units", units: 10 })).toBe(true);
    const snapshot = ledger.snapshot();
    expect(snapshot.searchCallsLimit).toBe(DEFAULT_SEARCH_CALLS_PER_DAY);
    expect(snapshot.unitsLimit).toBe(DEFAULT_UNITS_PER_DAY);
    expect(snapshot.searchCallsUsed).toBe(0);
    expect(snapshot.unitsUsed).toBe(0);
  });

  it("search calls exhaust at the configured limit", () => {
    const ledger = new QuotaLedger({ searchCallsLimit: 3 });
    ledger.record({ kind: "searchCall" });
    ledger.record({ kind: "searchCall" });
    ledger.record({ kind: "searchCall" });
    expect(ledger.canAfford({ kind: "searchCall" })).toBe(false);
    // A record that blows past the limit still counts the real usage (the
    // canAfford() pre-flight gate is what normally prevents over-limit calls).
    expect(() => ledger.record({ kind: "searchCall" })).toThrow(QuotaExhaustedError);
    expect(ledger.snapshot().searchCallsUsed).toBe(4);
  });

  it("units accumulate and exhaust independently of search calls", () => {
    const ledger = new QuotaLedger({ unitsLimit: 5 });
    ledger.record({ kind: "units", units: 3 });
    ledger.record({ kind: "units", units: 2 });
    expect(ledger.canAfford({ kind: "units", units: 1 })).toBe(false);
    expect(() => ledger.record({ kind: "units", units: 1 })).toThrow(QuotaExhaustedError);
    // Search bucket untouched.
    expect(ledger.canAfford({ kind: "searchCall" })).toBe(true);
  });

  it("counters reset when the Pacific-Time date rolls over", () => {
    // 2026-11-17 22:00 PT == 2026-11-18 06:00 UTC; 2026-11-17 23:30 PT == 2026-11-18 07:30 UTC.
    let now = new Date("2026-11-18T06:00:00Z");
    const ledger = new QuotaLedger({ now: () => now, searchCallsLimit: 2 });
    ledger.record({ kind: "searchCall" });
    ledger.record({ kind: "searchCall" });
    expect(ledger.canAfford({ kind: "searchCall" })).toBe(false);
    // Still 2026-11-17 in PT.
    now = new Date("2026-11-18T07:30:00Z");
    expect(ledger.canAfford({ kind: "searchCall" })).toBe(false);
    // Past midnight PT (2026-11-18 01:00 PT == 09:00 UTC): counters reset.
    now = new Date("2026-11-18T09:00:00Z");
    expect(ledger.canAfford({ kind: "searchCall" })).toBe(true);
    expect(ledger.snapshot().datePt).toBe("2026-11-18");
    expect(ledger.snapshot().searchCallsUsed).toBe(0);
  });

  it("estimates scan cost for pre-run display", () => {
    const estimate = QuotaLedger.estimateScanCost({ requests: new Array(12), enrichmentRequests: 5 });
    expect(estimate).toEqual({ searchCalls: 12, units: 5 });
  });
});
