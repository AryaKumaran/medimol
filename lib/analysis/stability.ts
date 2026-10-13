import { z } from "zod";
import type { RunBundle } from "../bundle/schema";
import { ACCESS_WEIGHTS, accessScore, bestPoses, type AccessWeights } from "../bundle/scoring";

export const StabilityOpts = z.object({
  iterations: z.number().int().min(1).max(100_000).default(2000),
  seed: z.number().int().default(42),
  weightJitter: z.number().min(0).max(1).default(0.25), // each weight × U(1-X, 1+X), then renormalized
  dockingNoise: z.boolean().default(true), // Gaussian noise with the drug's own pose-score SD
  topN: z.number().int().min(1).default(5),
});
export type StabilityOpts = z.input<typeof StabilityOpts>;

export type DrugStability = {
  drugId: string;
  baselineRank: number;
  medianRank: number;
  rankP5: number;
  rankP95: number;
  pTopN: number;
  noiseSd: number | null; // null = fewer than 2 poses, so docking noise could not be estimated
};
export type StabilityResult = {
  opts: z.output<typeof StabilityOpts>;
  drugs: DrugStability[];
  kendallTau: { median: number; p5: number; p95: number }; // perturbed vs baseline ranking
};

// mulberry32: tiny, seedable, good enough for Monte Carlo at this scale (not crypto).
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller.
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

// Nearest-rank percentile on a sorted array.
export const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;

// Kendall tau-a over two rank vectors of equal length. Ties count as neither. O(n²): fine for < 1000 drugs.
export function kendallTau(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 1;
  let s = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) s += Math.sign(a[i]! - a[j]!) * Math.sign(b[i]! - b[j]!);
  return s / ((n * (n - 1)) / 2);
}

// 1-based ranks by descending score; ties broken by input order so results are deterministic.
const ranksOf = (scores: number[]) => {
  const order = scores.map((s, i) => [s, i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  const r = new Array<number>(scores.length);
  order.forEach(([, i], k) => (r[i] = k + 1));
  return r;
};

const sd = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

const combined = (confs: number[], access: number[]) => {
  const lo = Math.min(...confs), hi = Math.max(...confs);
  return confs.map((c, i) => (hi === lo ? 1 : (c - lo) / (hi - lo)) * access[i]!);
};

// How much does the combined (docking × access) ranking move under plausible perturbations?
// Positive controls are excluded, same as the default leaderboard.
export function rankStability(b: RunBundle, input: StabilityOpts = {}): StabilityResult {
  const opts = StabilityOpts.parse(input);
  const best = bestPoses(b);
  const drugs = b.drugs.filter((d) => !d.positiveControl && best.has(d.id));
  const conf = drugs.map((d) => best.get(d.id)!.conf);
  // Spread of DiffDock scores across this drug's poses on its best target.
  const noise = drugs.map((d) =>
    sd(b.poses.filter((p) => p.drugId === d.id && p.targetId === best.get(d.id)!.targetId).map((p) => p.confidence)),
  );
  const baseline = ranksOf(combined(conf, drugs.map((d) => accessScore(d).score)));

  const r = rng(opts.seed);
  const keys = Object.keys(ACCESS_WEIGHTS) as (keyof AccessWeights)[];
  const total = keys.reduce((a, k) => a + ACCESS_WEIGHTS[k], 0);
  const samples: number[][] = drugs.map(() => []);
  const taus: number[] = [];
  for (let it = 0; it < opts.iterations; it++) {
    const raw = keys.map((k) => ACCESS_WEIGHTS[k] * (1 + opts.weightJitter * (2 * r() - 1)));
    const sum = raw.reduce((a, x) => a + x, 0);
    const w = Object.fromEntries(keys.map((k, i) => [k, (raw[i]! / sum) * total])) as AccessWeights;
    const c = conf.map((x, i) => (opts.dockingNoise && noise[i] ? x + gauss(r) * noise[i]! : x));
    const ranks = ranksOf(combined(c, drugs.map((d) => accessScore(d, w).score)));
    ranks.forEach((rk, i) => samples[i]!.push(rk));
    taus.push(kendallTau(baseline, ranks));
  }
  taus.sort((a, b) => a - b);
  return {
    opts,
    drugs: drugs.map((d, i) => {
      const s = samples[i]!.sort((a, b) => a - b);
      return {
        drugId: d.id,
        baselineRank: baseline[i]!,
        medianRank: percentile(s, 50),
        rankP5: percentile(s, 5),
        rankP95: percentile(s, 95),
        pTopN: s.filter((x) => x <= opts.topN).length / s.length,
        noiseSd: noise[i] ?? null,
      };
    }).sort((a, b) => a.baselineRank - b.baselineRank),
    kendallTau: { median: percentile(taus, 50), p5: percentile(taus, 5), p95: percentile(taus, 95) },
  };
}
