import type { RunBundle } from "../lib/bundle/schema";
import { rng } from "../lib/analysis/stability";

// SYNTHETIC test data. Not real drugs, not real docking results. Never ship this.
export const fixture = (): RunBundle => ({
  schemaVersion: 1,
  id: "test",
  title: "synthetic",
  provenance: { runDate: "2026-01-01", model: "DiffDock", modelVersion: "x", compute: "none", builtAt: "x", builder: "test", notes: "" },
  sources: [{ id: "s1", label: "src", url: "https://example.org", accessed: "2026-01-01" }],
  targets: [{ id: "t1", gene: "G1", name: "Target 1", pdbId: "1ABC", role: "", sourceIds: ["s1"] }],
  drugs: [
    drug("a", { approval: "approved", generic: "yes", whoEml: "yes", trials: 3 }),
    drug("b", { approval: "approved", generic: "no", whoEml: "no", trials: 0 }),
    drug("c", { approval: "unknown", generic: "unknown", whoEml: "unknown", trials: null }),
    { ...drug("ctrl", { approval: "investigational", generic: "no", whoEml: "no", trials: 0 }), positiveControl: true },
  ],
  poses: [
    pose("a", 1, -1.0), pose("a", 2, -2.0),
    pose("b", 1, 0.5),
    pose("c", 1, -3.0),
    pose("ctrl", 1, 1.0),
  ],
  models: [
    {
      targetId: "t1", chemblId: "CHEMBL0", fetchedAt: "2026-01-01", model: "synthetic", activeCutoffPchembl: 6, nCompounds: 100,
      metrics: { split: "scaffold", nTrain: 80, nTest: 20, positiveRate: 0.3, rocAuc: 0.8, prAuc: 0.5 },
      predictions: {
        a: { p: 0.7, maxSim: 0.5, inDomain: true, inTraining: false, measuredPchembl: null },
        b: { p: 0.9, maxSim: 0.1, inDomain: false, inTraining: false, measuredPchembl: null },
        ctrl: { p: 0.95, maxSim: 1, inDomain: true, inTraining: true, measuredPchembl: 7.2 },
      },
    },
  ],
});

function drug(id: string, o: { approval: RunBundle["drugs"][0]["approval"]; generic: "yes" | "no" | "unknown"; whoEml: "yes" | "no" | "unknown"; trials: number | null }) {
  return {
    id, name: id.toUpperCase(), drugbankId: null, smiles: null, approval: o.approval, approvedFor: null,
    positiveControl: false, safetyFlags: [], storage: null,
    access: {
      generic: o.generic, whoEml: o.whoEml, costTier: "unknown" as const, sourceIds: ["s1"],
      trials: o.trials === null ? null : { count: o.trials, query: "q", fetchedAt: "2026-01-01" },
    },
  };
}
const pose = (drugId: string, rank: number, confidence: number) => ({ drugId, targetId: "t1", rank, confidence, sdf: null });

// SYNTHETIC demo bundle for the web app and its recorded loops. The app uses it only when public/bundles/
// holds no real bundle, and shows a permanent "synthetic" banner over it. Every name is a placeholder and
// every number comes from a seeded RNG, so nothing here can be mistaken for a finding. Never ship as real.
export function demoFixture(): RunBundle {
  const r = rng(7);
  const round = (x: number) => Math.round(x * 100) / 100;
  const targets = [1, 2, 3].map((n) => ({
    id: `t${n}`, gene: `SYN${n}`, name: `Synthetic target ${n}`, pdbId: `0SY${n}`, // PDB never assigns IDs starting with 0
    role: "Placeholder protein. Not a real target.", sourceIds: ["demo"],
  }));
  type Tri = "yes" | "no" | "unknown";
  type Spec = [string, RunBundle["drugs"][0]["approval"], Tri, Tri, number | null, RunBundle["drugs"][0]["access"]["costTier"], string | null, string[]];
  // name, approval, generic, WHO EML, trials, cost tier, storage, flags: chosen by hand so every UI state appears
  const specs: Spec[] = [
    ["A", "approved", "yes", "yes", 12, "generic", "Room temp", []],
    ["B", "approved", "yes", "yes", 3, "generic", "Room temp", ["placeholder caution (synthetic)"]],
    ["C", "approved", "yes", "no", 0, "generic", "Room temp", []],
    ["D", "approved", "no", "no", 5, "brand-only", "2-8 C", []],
    ["E", "approved", "yes", "unknown", null, "unknown", null, []],
    ["F", "investigational", "no", "no", 2, "unknown", "-20 C", []],
    ["G", "approved", "yes", "yes", 0, "generic", "2-8 C", ["placeholder interaction (synthetic)", "placeholder dose limit (synthetic)"]],
    ["H", "unknown", "unknown", "unknown", null, "unknown", null, []],
    ["I", "approved", "yes", "no", 7, "generic", "Room temp", []],
    ["J", "withdrawn", "no", "no", 1, "unknown", null, ["withdrawn (synthetic)"]],
    ["K", "approved", "no", "yes", 4, "brand-only", "Room temp", []],
    ["L", "approved", "yes", "yes", 9, "generic", "Room temp", []],
    ["M", "investigational", "no", "no", 0, "unknown", "-20 C", []],
    ["N", "approved", "yes", "no", null, "generic", "Room temp", []],
  ];
  const drugs: RunBundle["drugs"] = specs.map(([n, approval, generic, whoEml, trials, costTier, storage, safetyFlags], i) => ({
    id: `c-${n.toLowerCase()}`, name: `Compound ${n}`, drugbankId: null, smiles: null, approval,
    approvedFor: approval === "approved" ? `synthetic indication ${i + 1}` : null,
    positiveControl: false, safetyFlags, storage,
    access: {
      generic, whoEml, costTier, sourceIds: ["demo"],
      trials: trials === null ? null : { count: trials, query: "synthetic", fetchedAt: "2026-01-01" },
    },
  }));
  for (const n of ["X", "Y"])
    drugs.push({
      id: `ctrl-${n.toLowerCase()}`, name: `Control ${n}`, drugbankId: null, smiles: null, approval: "investigational",
      approvedFor: null, positiveControl: true, safetyFlags: [], storage: null,
      access: { generic: "no", whoEml: "no", costTier: "unknown", sourceIds: ["demo"], trials: { count: 0, query: "synthetic", fetchedAt: "2026-01-01" } },
    });
  const poses: RunBundle["poses"] = [];
  for (const d of drugs)
    for (const t of targets) {
      // One control lands near the top and one in the middle, so the validation screens show a mixed result.
      let conf = d.id === "ctrl-x" ? 0.6 + 0.3 * r() : d.id === "ctrl-y" ? -0.9 + 0.4 * r() : -2.2 + 2.6 * r();
      for (let rank = 1; rank <= 5; rank++) {
        poses.push({ drugId: d.id, targetId: t.id, rank, confidence: round(conf), sdf: null });
        conf -= 0.15 + 0.5 * r();
      }
    }
  const models: RunBundle["models"] = targets.map((t, i) => {
    const predictions: RunBundle["models"][0]["predictions"] = {};
    for (const d of drugs) {
      if (d.id === "c-h" || d.id === "c-m") continue; // two drugs with no model result at all
      const k = r();
      if (k < 0.45) predictions[d.id] = { p: round(0.15 + 0.8 * r()), maxSim: round(0.3 + 0.5 * r()), inDomain: true, inTraining: false, measuredPchembl: null };
      else if (k < 0.7) predictions[d.id] = { p: round(r()), maxSim: round(0.05 + 0.2 * r()), inDomain: false, inTraining: false, measuredPchembl: null };
      else if (k < 0.85) predictions[d.id] = { p: round(0.6 + 0.4 * r()), maxSim: 1, inDomain: true, inTraining: true, measuredPchembl: round(4.5 + 3 * r()) };
    }
    return {
      targetId: t.id, chemblId: `CHEMBL${i}`, fetchedAt: "2026-01-01", model: "synthetic", activeCutoffPchembl: 6, nCompounds: 1000 + i * 400,
      metrics: { split: "scaffold", nTrain: 800 + i * 320, nTest: 200 + i * 80, positiveRate: 0.3, rocAuc: round(0.7 + 0.1 * r()), prAuc: round(0.5 + 0.1 * r()) },
      predictions,
    };
  });
  return {
    schemaVersion: 1, id: "synthetic-demo", title: "Synthetic demo run",
    provenance: {
      runDate: "2026-01-01", model: "synthetic", modelVersion: "n/a", compute: "none", builtAt: "2026-01-01T00:00:00+00:00",
      builder: "tests/fixture.ts", notes: "Synthetic demo. Not real drugs, not real docking results.",
    },
    sources: [{ id: "demo", label: "Synthetic demo data (tests/fixture.ts)", url: "https://example.org/synthetic", accessed: "2026-01-01" }],
    targets, drugs, poses, models,
  };
}
