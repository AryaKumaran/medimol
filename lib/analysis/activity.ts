import type { RunBundle } from "../bundle/schema";

export type ActivitySignal =
  | { kind: "measured"; targetId: string; pchembl: number; chemblId: string }
  | { kind: "predicted"; targetId: string; p: number; maxSim: number; rocAuc: number | null }
  | { kind: "out-of-domain"; targetId: string; maxSim: number }
  | { kind: "none" };

// Strongest honest statement we can make per drug: a real measurement beats a prediction,
// an in-domain prediction beats an out-of-domain one, and an out-of-domain score is never shown as a number.
export function activitySignal(b: RunBundle, drugId: string): ActivitySignal {
  let measured: Extract<ActivitySignal, { kind: "measured" }> | null = null;
  let predicted: Extract<ActivitySignal, { kind: "predicted" }> | null = null;
  let ood: Extract<ActivitySignal, { kind: "out-of-domain" }> | null = null;
  for (const m of b.models) {
    const p = m.predictions[drugId];
    if (!p || !m.metrics) continue;
    if (p.inTraining && p.measuredPchembl !== null) {
      if (!measured || p.measuredPchembl > measured.pchembl)
        measured = { kind: "measured", targetId: m.targetId, pchembl: p.measuredPchembl, chemblId: m.chemblId };
    } else if (p.p !== null && p.maxSim !== null && p.inDomain) {
      if (!predicted || p.p > predicted.p)
        predicted = { kind: "predicted", targetId: m.targetId, p: p.p, maxSim: p.maxSim, rocAuc: m.metrics.rocAuc };
    } else if (p.maxSim !== null) {
      if (!ood || p.maxSim > ood.maxSim) ood = { kind: "out-of-domain", targetId: m.targetId, maxSim: p.maxSim };
    }
  }
  return measured ?? predicted ?? ood ?? { kind: "none" };
}
