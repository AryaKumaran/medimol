import { describe, expect, it } from "vitest";
import { RunBundle, Screen } from "../lib/bundle/schema";
import { fixture } from "./fixture";

const access = { generic: "yes" as const, whoEml: "no" as const, trials: { count: 2, query: "q", fetchedAt: "2026-01-01" }, boxedWarning: null };
const screen = (): Screen => ({
  generatedAt: "2026-01-01", approvedDrugs: 3000, activeCutoffPchembl: 6, adMinSim: 0.3,
  targets: [{
    targetId: "kras", gene: "KRAS", uniprot: "P01116", chemblId: "CHEMBL1", role: "", nCompounds: 100,
    metrics: { split: "scaffold", nTrain: 80, nTest: 20, positiveRate: 0.5, rocAuc: 0.8, prAuc: 0.7, cv: { randomForest: { rocAucMean: 0.8, rocAucSd: 0.05, folds: 5 } } },
    counts: { measured: 1, predicted: 1, "out-of-domain": 2998 },
    hits: [
      { kind: "measured", chemblId: "CHEMBL2", name: "X", withdrawn: false, pchembl: 7, access },
      { kind: "predicted", chemblId: "CHEMBL3", name: "Y", withdrawn: false, p: 0.8, maxSim: 0.4, access },
    ],
  }],
});

describe("screen", () => {
  it("bundle accepts a screen and defaults to null without one", () => {
    expect(RunBundle.parse({ ...fixture(), screen: screen() }).screen?.targets[0]!.hits).toHaveLength(2);
    const { screen: _, ...old } = fixture();
    expect(RunBundle.parse(old).screen).toBeNull();
  });
  it("rejects a predicted hit without a probability, and out-of-domain hits", () => {
    const s = screen();
    (s.targets[0]!.hits as unknown[]).push({ kind: "predicted", chemblId: "C", name: "Z", withdrawn: false, maxSim: 0.1, access });
    expect(Screen.safeParse(s).success).toBe(false);
    const t = screen();
    (t.targets[0]!.hits as unknown[]).push({ kind: "out-of-domain", chemblId: "C", name: "Z", withdrawn: false, access });
    expect(Screen.safeParse(t).success).toBe(false);
  });
});
