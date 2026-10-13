import { z } from "zod";
import type { RunBundle } from "../bundle/schema";
import { bestPoses } from "../bundle/scoring";
import { percentile, rng } from "./stability";

// Standard virtual-screening metrics: do the known binders (positive controls) score above everything else?
// Background = every non-control drug. These are NOT confirmed inactives (decoys), so the metrics are a
// lower bound on how well docking separates real binders, and the UI must say so.

export const EnrichmentOpts = z.object({
  fractions: z.array(z.number().gt(0).lte(1)).default([0.01, 0.05, 0.1]),
  bedrocAlpha: z.number().positive().default(20), // Truchon & Bayly 2007: alpha=20 weights the top ~8%
  bootstrap: z.number().int().min(0).max(20_000).default(2000),
  seed: z.number().int().default(42),
});
export type EnrichmentOpts = z.input<typeof EnrichmentOpts>;

export type Enrichment = {
  nActives: number;
  nTotal: number;
  rocAuc: number;
  rocAucCi95: [number, number] | null; // null when bootstrap = 0
  bedroc: number;
  ef: { fraction: number; ef: number; maxEf: number }[];
};

// AUC = P(random active scores above random background); ties count half (Mann-Whitney U).
export function rocAuc(active: number[], background: number[]): number {
  let s = 0;
  for (const a of active) for (const b of background) s += a > b ? 1 : a === b ? 0.5 : 0;
  return s / (active.length * background.length);
}

// EF at fraction x: actives found in the top x of the list, divided by what random ordering would find.
export function enrichmentFactor(ranks: number[], n: number, x: number): number {
  const cut = Math.max(1, Math.ceil(n * x));
  const hits = ranks.filter((r) => r <= cut).length;
  return hits / ranks.length / (cut / n);
}

// BEDROC (Truchon & Bayly, J Chem Inf Model 2007, eq. 36). 1-based ranks of actives in a list of n.
export function bedroc(ranks: number[], n: number, alpha: number): number {
  const k = ranks.length, ra = k / n;
  const sum = ranks.reduce((s, r) => s + Math.exp((-alpha * r) / n), 0);
  const rie = sum / ((ra * (1 - Math.exp(-alpha))) / (Math.exp(alpha / n) - 1));
  return (rie * ra * Math.sinh(alpha / 2)) / (Math.cosh(alpha / 2) - Math.cosh(alpha / 2 - alpha * ra)) + 1 / (1 - Math.exp(alpha * (1 - ra)));
}

// Ranks by descending score; ties share the worse rank, so ties never flatter the actives.
const pessimisticRanks = (scores: number[], of: number[]) => of.map((s) => scores.filter((x) => x >= s).length);

export function enrichment(b: RunBundle, input: EnrichmentOpts = {}): Enrichment | null {
  const o = EnrichmentOpts.parse(input);
  const best = bestPoses(b);
  const docked = b.drugs.filter((d) => best.has(d.id));
  const act = docked.filter((d) => d.positiveControl).map((d) => best.get(d.id)!.conf);
  const bg = docked.filter((d) => !d.positiveControl).map((d) => best.get(d.id)!.conf);
  if (!act.length || !bg.length) return null; // nothing to validate against
  const all = [...act, ...bg], n = all.length;
  const ranks = pessimisticRanks(all, act);

  let ci: [number, number] | null = null;
  if (o.bootstrap > 0) {
    const r = rng(o.seed);
    const pick = (xs: number[]) => xs.map(() => xs[Math.floor(r() * xs.length)]!);
    const aucs = Array.from({ length: o.bootstrap }, () => rocAuc(pick(act), pick(bg))).sort((x, y) => x - y);
    ci = [percentile(aucs, 2.5), percentile(aucs, 97.5)];
  }
  return {
    nActives: act.length,
    nTotal: n,
    rocAuc: rocAuc(act, bg),
    rocAucCi95: ci,
    bedroc: bedroc(ranks, n, o.bedrocAlpha),
    ef: o.fractions.map((x) => {
      const cut = Math.max(1, Math.ceil(n * x));
      return { fraction: x, ef: enrichmentFactor(ranks, n, x), maxEf: Math.min(act.length, cut) / act.length / (cut / n) };
    }),
  };
}
