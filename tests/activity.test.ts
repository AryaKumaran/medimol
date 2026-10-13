import { describe, expect, it } from "vitest";
import { activitySignal } from "../lib/analysis/activity";
import { RunBundle } from "../lib/bundle/schema";
import { fixture } from "./fixture";

describe("activitySignal", () => {
  const b = fixture();
  it("prefers real measurements over predictions", () =>
    expect(activitySignal(b, "ctrl")).toEqual({ kind: "measured", targetId: "t1", pchembl: 7.2, chemblId: "CHEMBL0" }));
  it("reports in-domain predictions with model quality", () =>
    expect(activitySignal(b, "a")).toMatchObject({ kind: "predicted", p: 0.7, rocAuc: 0.8 }));
  it("never surfaces an out-of-domain probability", () => {
    const s = activitySignal(b, "b");
    expect(s).toEqual({ kind: "out-of-domain", targetId: "t1", maxSim: 0.1 });
    expect(s).not.toHaveProperty("p");
  });
  it("none when no model covers the drug", () => expect(activitySignal(b, "c")).toEqual({ kind: "none" }));
  it("ignores models that could not be trained", () => {
    const x = fixture();
    x.models[0]!.metrics = null;
    expect(activitySignal(x, "a")).toEqual({ kind: "none" });
  });
  it("schema rejects predictions for unknown drugs and bad ChEMBL ids", () => {
    const x = fixture();
    x.models[0]!.predictions["ghost"] = { p: 0.5, maxSim: 0.5, inDomain: true, inTraining: false, measuredPchembl: null };
    expect(RunBundle.safeParse(x).success).toBe(false);
    const y = fixture();
    y.models[0]!.chemblId = "P12345";
    expect(RunBundle.safeParse(y).success).toBe(false);
  });
  it("old bundles without models still parse", () => {
    const { models: _, ...old } = fixture();
    expect(RunBundle.parse(old).models).toEqual([]);
  });
});
