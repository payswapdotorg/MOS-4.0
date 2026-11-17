import { describe, expect, it } from "vitest";

import { classifyFormat, comparableFormatGroup } from "../src/research/format.js";
import { parseIsoDuration } from "../src/youtube/schemas.js";

describe("parseIsoDuration", () => {
  it.each([
    ["PT4M13S", 253],
    ["PT1H2M3S", 3723],
    ["PT30S", 30],
    ["P1DT2H", 93_600],
    ["PT59M59S", 3_599],
  ])("parses %s", (input, expected) => {
    expect(parseIsoDuration(input)).toBe(expected);
  });

  it("returns null for garbage or missing durations", () => {
    expect(parseIsoDuration("forever")).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration("")).toBeNull();
  });
});

describe("classifyFormat", () => {
  it("classifies live and upcoming streams first", () => {
    expect(classifyFormat({ liveBroadcastContent: "live" }).format).toBe("live");
    expect(classifyFormat({ liveBroadcastContent: "upcoming" }).format).toBe("upcoming");
  });

  it("splits Shorts from long-form at the configurable threshold (default 180s)", () => {
    expect(classifyFormat({ durationIso: "PT2M" }).format).toBe("short");
    expect(classifyFormat({ durationIso: "PT3M" }).format).toBe("short"); // exactly 180s
    expect(classifyFormat({ durationIso: "PT4M" }).format).toBe("long");
  });

  it("marks unknown when no duration is available", () => {
    expect(classifyFormat({}).format).toBe("unknown");
  });

  it("comparable groups never mix live or unknown with rated content", () => {
    expect(comparableFormatGroup("short")).toBe("short");
    expect(comparableFormatGroup("long")).toBe("long");
    expect(comparableFormatGroup("live")).toBeNull();
    expect(comparableFormatGroup("unknown")).toBeNull();
  });
});
