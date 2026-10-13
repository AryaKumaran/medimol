import { describe, expect, it } from "vitest";
import { poseAssets } from "../lib/bundle/pose";
import { RunBundle } from "../lib/bundle/schema";
import { fixture } from "./fixture";

describe("poseAssets", () => {
  it("returns the rank-1 pose and the target's receptor file", () => {
    const b = fixture();
    b.poses = b.poses.map((p) => (p.drugId === "a" && p.rank === 1 ? { ...p, sdf: "x/poses/a__t1.sdf" } : p));
    b.targets[0]!.pdbFile = "x/receptors/1ABC.pdb";
    expect(poseAssets(b, "a", "t1")).toEqual({ sdf: "x/poses/a__t1.sdf", pdb: "x/receptors/1ABC.pdb", pdbId: "1ABC", confidence: -1 });
  });
  it("null for unknown drug or target; null files pass through", () => {
    const b = fixture();
    expect(poseAssets(b, "ghost", "t1")).toBeNull();
    expect(poseAssets(b, "a", "nope")).toBeNull();
    expect(poseAssets(b, "a", "t1")).toMatchObject({ sdf: null, pdb: null });
  });
  it("bundles built before receptors existed still parse, with pdbFile null", () => {
    const b = fixture() as unknown as { targets: Record<string, unknown>[] };
    delete b.targets[0]!.pdbFile;
    expect(RunBundle.parse(b).targets[0]!.pdbFile).toBeNull();
  });
});
