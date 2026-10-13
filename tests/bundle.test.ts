import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { RunBundle } from "../lib/bundle/schema";
import { accessScore, affordableLeads, leaderboard } from "../lib/bundle/scoring";
import { positiveControls } from "../lib/bundle/validation";
import { buildTimeline, play } from "../lib/bundle/replay";
import { fixture } from "./fixture";

describe("schema", () => {
  it("accepts a valid bundle", () => expect(RunBundle.safeParse(fixture()).success).toBe(true));
  it("rejects dangling source and drug refs", () => {
    const b = fixture();
    b.targets[0]!.sourceIds = ["nope"];
    b.poses.push({ drugId: "ghost", targetId: "t1", rank: 1, confidence: 0, sdf: null });
    const r = RunBundle.safeParse(b);
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join()).toMatch(/nope.*ghost/);
  });
  it("rejects malformed PDB IDs", () => {
    const b = fixture();
    b.targets[0]!.pdbId = "ERK2";
    expect(RunBundle.safeParse(b).success).toBe(false);
  });
  const dir = new URL("../public/bundles/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`shipped bundle ${f} is valid`, () => RunBundle.parse(JSON.parse(readFileSync(new URL(f, dir), "utf8"))));
  }
});

describe("curation (python build script)", () => {
  it("selftest passes (FDA parsing, 2FMA guard, pose names)", () => {
    expect(execFileSync("python3", ["tools/build_run_bundle.py", "--selftest"]).toString()).toContain("ok");
  });
});

describe("scoring", () => {
  it("access score sums documented weights and reports unknowns", () => {
    const [a, b, c] = fixture().drugs;
    expect(accessScore(a!)).toEqual({ score: 1, unknowns: [] });
    expect(accessScore(b!).score).toBe(0.3);
    expect(accessScore(c!)).toEqual({ score: 0, unknowns: ["approval", "generic", "whoEml", "trials"] });
  });
  it("leaderboard uses rank-1 poses, sorts by confidence, hides controls by default", () => {
    const rows = leaderboard(fixture());
    expect(rows.map((r) => r.drug.id)).toEqual(["b", "a", "c"]);
    expect(rows[0]!.docking).toBe(0.875); // normalized over the whole run, control included
    expect(rows[2]!.docking).toBe(0);
    expect(rows.find((r) => r.drug.id === "a")!.confidence).toBe(-1);
  });
  it("affordable leads keep only approved generics", () => {
    expect(affordableLeads(leaderboard(fixture())).map((r) => r.drug.id)).toEqual(["a"]);
  });
});

describe("validation", () => {
  it("reports positive-control rank honestly", () => {
    expect(positiveControls(fixture())).toEqual([{ drugId: "ctrl", name: "CTRL", rank: 1, of: 4, percentile: 100 }]);
  });
});

describe("replay", () => {
  it("timeline fits the budget and ends with done", () => {
    const ev = buildTimeline(fixture(), 60_000);
    expect(ev.at(-1)).toMatchObject({ kind: "stage", stage: "done" });
    expect(ev.at(-1)!.atMs).toBeLessThan(90_000);
    expect(ev.filter((e) => e.kind === "pose")).toHaveLength(4);
  });
  it("plays in order and can be aborted", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const ac = new AbortController();
    const done = play(buildTimeline(fixture(), 1000), (e) => seen.push(e.kind), { signal: ac.signal });
    await vi.advanceTimersByTimeAsync(300);
    ac.abort();
    await done;
    const n = seen.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen.length).toBe(n);
    expect(seen[0]).toBe("stage");
    vi.useRealTimers();
  });
});
