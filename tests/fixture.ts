import type { RunBundle } from "../lib/bundle/schema";

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
