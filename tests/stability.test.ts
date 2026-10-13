import { describe, expect, it } from "vitest";
import { kendallTau, percentile, rankStability, rng } from "../lib/analysis/stability";
import { fixture } from "./fixture";

describe("rng", () => {
  it("is deterministic per seed and in [0,1)", () => {
    const a = rng(7), b = rng(7), c = rng(8);
    const xs = Array.from({ length: 1000 }, a);
    expect(xs).toEqual(Array.from({ length: 1000 }, b));
    expect(xs.slice(0, 5)).not.toEqual(Array.from({ length: 5 }, c));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("kendallTau", () => {
  it("is 1 for identical, -1 for reversed, 1 for n<2", () => {
    expect(kendallTau([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
    expect(kendallTau([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(kendallTau([1], [1])).toBe(1);
  });
  it("property: symmetric and within [-1,1] for random permutations", () => {
    const r = rng(1);
    for (let t = 0; t < 200; t++) {
      const n = 2 + Math.floor(r() * 12);
      const perm = () => Array.from({ length: n }, (_, i) => i + 1).sort(() => r() - 0.5);
      const a = perm(), b = perm();
      const tau = kendallTau(a, b);
      expect(tau).toBeGreaterThanOrEqual(-1);
      expect(tau).toBeLessThanOrEqual(1);
      expect(kendallTau(b, a)).toBeCloseTo(tau);
    }
  });
});

describe("percentile", () => {
  it("nearest-rank on edges", () => {
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 100)).toBe(4);
  });
});

describe("rankStability", () => {
  const b = fixture();
  it("no perturbation reproduces the baseline exactly", () => {
    const s = rankStability(b, { iterations: 50, weightJitter: 0, dockingNoise: false, topN: 1 });
    for (const d of s.drugs) {
      expect(d.medianRank).toBe(d.baselineRank);
      expect(d.rankP5).toBe(d.baselineRank);
      expect(d.rankP95).toBe(d.baselineRank);
    }
    expect(s.kendallTau).toEqual({ median: 1, p5: 1, p95: 1 });
    expect(s.drugs[0]!.pTopN).toBe(1);
  });
  it("is deterministic for a seed", () => {
    expect(rankStability(b, { seed: 3, iterations: 300 })).toEqual(rankStability(b, { seed: 3, iterations: 300 }));
  });
  it("excludes positive controls and reports missing noise estimates", () => {
    const s = rankStability(b, { iterations: 10 });
    expect(s.drugs.map((d) => d.drugId)).not.toContain("ctrl");
    expect(s.drugs.find((d) => d.drugId === "a")!.noiseSd).toBeCloseTo(Math.SQRT1_2); // poses -1, -2
    expect(s.drugs.find((d) => d.drugId === "b")!.noiseSd).toBeNull();
  });
  it("property: intervals are ordered, ranks in range, P(top-N) a probability, across seeds", () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = rankStability(b, { seed, iterations: 200, weightJitter: 0.9, topN: 2 });
      const n = s.drugs.length;
      for (const d of s.drugs) {
        expect(1 <= d.rankP5 && d.rankP5 <= d.medianRank && d.medianRank <= d.rankP95 && d.rankP95 <= n).toBe(true);
        expect(d.pTopN).toBeGreaterThanOrEqual(0);
        expect(d.pTopN).toBeLessThanOrEqual(1);
      }
      expect(s.kendallTau.p5).toBeLessThanOrEqual(s.kendallTau.p95);
    }
  });
  it("rejects invalid options at the boundary", () => {
    expect(() => rankStability(b, { weightJitter: 2 })).toThrow();
    expect(() => rankStability(b, { iterations: 0 })).toThrow();
  });
});
