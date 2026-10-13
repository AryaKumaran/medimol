import { describe, expect, it } from "vitest";
import { bedroc, enrichment, enrichmentFactor, rocAuc } from "../lib/analysis/enrichment";
import { rng } from "../lib/analysis/stability";
import { fixture } from "./fixture";

describe("rocAuc", () => {
  it("1 when separated, 0 when inverted, 0.5 on ties", () => {
    expect(rocAuc([3, 4], [1, 2])).toBe(1);
    expect(rocAuc([1], [2, 3])).toBe(0);
    expect(rocAuc([1, 1], [1, 1])).toBe(0.5);
  });
  it("property: AUC(a,b) + AUC(b,a) = 1", () => {
    const r = rng(5);
    for (let i = 0; i < 100; i++) {
      const a = Array.from({ length: 1 + Math.floor(r() * 8) }, () => Math.round(r() * 5));
      const b = Array.from({ length: 1 + Math.floor(r() * 8) }, () => Math.round(r() * 5));
      expect(rocAuc(a, b) + rocAuc(b, a)).toBeCloseTo(1);
    }
  });
});

describe("enrichmentFactor", () => {
  it("max when all actives in the top slice, 0 when none", () => {
    expect(enrichmentFactor([1, 2], 100, 0.1)).toBe(10);
    expect(enrichmentFactor([99, 100], 100, 0.1)).toBe(0);
  });
});

describe("bedroc", () => {
  it("near 1 for actives at the top, near 0 at the bottom, monotone in between", () => {
    const n = 1000, top = bedroc([1, 2, 3, 4, 5], n, 20), bottom = bedroc([996, 997, 998, 999, 1000], n, 20);
    expect(top).toBeGreaterThan(0.99);
    expect(bottom).toBeLessThan(0.01);
    expect(bedroc([50, 60, 70, 80, 90], n, 20)).toBeLessThan(top);
    expect(bedroc([50, 60, 70, 80, 90], n, 20)).toBeGreaterThan(bottom);
  });
  it("property: always in [0,1] for random rank sets", () => {
    const r = rng(9);
    for (let i = 0; i < 200; i++) {
      const n = 20 + Math.floor(r() * 500), k = 1 + Math.floor(r() * 10);
      const ranks = [...new Set(Array.from({ length: k }, () => 1 + Math.floor(r() * n)))];
      const v = bedroc(ranks, n, 20);
      expect(v).toBeGreaterThanOrEqual(-1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe("enrichment on a bundle", () => {
  it("control on top of the fixture → perfect separation, deterministic CI", () => {
    const e = enrichment(fixture(), { bootstrap: 500 })!;
    expect(e).toMatchObject({ nActives: 1, nTotal: 4, rocAuc: 1 });
    expect(e.ef[0]).toEqual({ fraction: 0.01, ef: 4, maxEf: 4 });
    expect(e.rocAucCi95).toEqual([1, 1]);
    expect(enrichment(fixture(), { bootstrap: 500 })).toEqual(e);
  });
  it("ties go against the actives", () => {
    const b = fixture();
    b.poses = b.poses.map((p) => ({ ...p, confidence: 0 }));
    const e = enrichment(b, { bootstrap: 0 })!;
    expect(e.rocAuc).toBe(0.5);
    expect(e.ef[0]!.ef).toBe(0); // the control shares last place
    expect(e.rocAucCi95).toBeNull();
  });
  it("null without controls", () => {
    const b = fixture();
    b.drugs = b.drugs.map((d) => ({ ...d, positiveControl: false }));
    expect(enrichment(b)).toBeNull();
  });
});
