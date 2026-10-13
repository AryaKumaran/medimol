import type { Drug, RunBundle } from "./schema";

// Coarse, documented weights. Unknown counts as 0 and is surfaced, never hidden.
export const ACCESS_WEIGHTS = { approved: 0.3, generic: 0.3, whoEml: 0.2, trials: 0.2 } as const;

export function accessScore(d: Drug): { score: number; unknowns: string[] } {
  const a = d.access;
  const unknowns: string[] = [];
  if (d.approval === "unknown") unknowns.push("approval");
  if (a.generic === "unknown") unknowns.push("generic");
  if (a.whoEml === "unknown") unknowns.push("whoEml");
  if (a.trials === null) unknowns.push("trials");
  const w = ACCESS_WEIGHTS;
  const score =
    (d.approval === "approved" ? w.approved : 0) +
    (a.generic === "yes" ? w.generic : 0) +
    (a.whoEml === "yes" ? w.whoEml : 0) +
    (a.trials && a.trials.count > 0 ? w.trials : 0);
  return { score: Math.round(score * 100) / 100, unknowns };
}

export type Row = {
  drug: Drug;
  bestTargetId: string | null;
  confidence: number | null; // raw DiffDock confidence of best rank-1 pose
  docking: number; // 0..1, min-max across the bundle's drugs
  access: number;
  unknowns: string[];
  combined: number; // docking × access
};

export function leaderboard(b: RunBundle, opts: { includeControls?: boolean } = {}): Row[] {
  const best = new Map<string, { conf: number; targetId: string }>();
  for (const p of b.poses) {
    if (p.rank !== 1) continue;
    const cur = best.get(p.drugId);
    if (!cur || p.confidence > cur.conf) best.set(p.drugId, { conf: p.confidence, targetId: p.targetId });
  }
  const confs = [...best.values()].map((v) => v.conf);
  const lo = Math.min(...confs), hi = Math.max(...confs);
  const norm = (c: number) => (hi === lo ? 1 : (c - lo) / (hi - lo));

  return b.drugs
    .filter((d) => opts.includeControls || !d.positiveControl)
    .map((drug) => {
      const hit = best.get(drug.id);
      const docking = hit ? norm(hit.conf) : 0;
      const { score, unknowns } = accessScore(drug);
      return {
        drug,
        bestTargetId: hit?.targetId ?? null,
        confidence: hit?.conf ?? null,
        docking,
        access: score,
        unknowns,
        combined: docking * score,
      };
    })
    .sort((a, b) => (b.confidence ?? -Infinity) - (a.confidence ?? -Infinity));
}

// "Affordable leads": approved drugs with a generic, sorted by combined score.
export function affordableLeads(rows: Row[]): Row[] {
  return rows
    .filter((r) => r.drug.approval === "approved" && r.drug.access.generic === "yes")
    .sort((a, b) => b.combined - a.combined);
}
