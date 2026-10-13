import { describe, expect, it } from "vitest";
import { parseStorage, storageBand } from "../lib/device/storage";

describe("parseStorage", () => {
  it("reads ranges and upper limits, rejects anything else", () => {
    expect(parseStorage("20-25C")).toEqual({ min: 20, max: 25 });
    expect(parseStorage("2-8C")).toEqual({ min: 2, max: 8 });
    expect(parseStorage("30C")).toEqual({ max: 30 });
    expect(parseStorage("room temp")).toBeNull();
    expect(parseStorage(null)).toBeNull();
  });
});

describe("storageBand", () => {
  it("intersects label ranges", () => expect(storageBand(["20-25C", "15-30C", null])).toEqual({ min: 20, max: 25 }));
  it("an upper limit alone narrows the top", () => expect(storageBand(["20-25C", "22C"])).toEqual({ min: 20, max: 22 }));
  it("only upper limits → 10 °C band below the limit", () => expect(storageBand(["30C"])).toEqual({ min: 20, max: 30 }));
  it("no ranges → null; disjoint ranges → conflict", () => {
    expect(storageBand([null, "?"])).toBeNull();
    expect(storageBand(["2-8C", "20-25C"])).toBe("conflict");
  });
  it("property: the band is inside every input range", () => {
    const inputs = ["15-30C", "20-25C", "18-26C", "28C"];
    const b = storageBand(inputs);
    if (!b || b === "conflict") throw new Error("expected a band");
    for (const s of inputs) {
      const r = parseStorage(s)!;
      expect(b.max).toBeLessThanOrEqual(r.max!);
      if (r.min !== undefined) expect(b.min).toBeGreaterThanOrEqual(r.min);
    }
  });
});
