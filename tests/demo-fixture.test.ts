import { describe, expect, it } from "vitest";
import { RunBundle } from "../lib/bundle/schema";
import { affordableLeads, leaderboard } from "../lib/bundle/scoring";
import { positiveControls } from "../lib/bundle/validation";
import { enrichment } from "../lib/analysis/enrichment";
import { rankStability } from "../lib/analysis/stability";
import { activitySignal } from "../lib/analysis/activity";
import { HostMsg } from "../lib/device/protocol";
import { demoFixture } from "./fixture";

describe("demoFixture (synthetic bundle the web app falls back to)", () => {
  const b = RunBundle.parse(demoFixture());
  const rows = leaderboard(b);

  it("is valid, deterministic and labelled synthetic everywhere a reader could look", () => {
    expect(demoFixture()).toEqual(demoFixture());
    expect(b.provenance.builder).toBe("tests/fixture.ts");
    expect(`${b.title} ${b.provenance.model} ${b.provenance.notes} ${b.sources[0]!.label}`.match(/synthetic/gi)!.length).toBeGreaterThanOrEqual(4);
    for (const d of b.drugs) expect(d.name).toMatch(/^(Compound|Control) [A-Z]$/);
    for (const t of b.targets) expect(t.pdbId).toMatch(/^0/); // no real PDB entry starts with 0
  });

  it("exercises every state the UI has to draw", () => {
    expect(new Set(b.drugs.map((d) => d.approval)).size).toBe(4);
    expect(new Set(b.drugs.map((d) => d.access.generic)).size).toBe(3);
    expect(b.drugs.some((d) => d.access.trials === null)).toBe(true);
    expect(new Set(b.drugs.map((d) => activitySignal(b, d.id).kind))).toEqual(new Set(["measured", "predicted", "out-of-domain", "none"]));
    expect(rows.length).toBe(14);
    const leads = affordableLeads(rows);
    expect(leads.length).toBeGreaterThan(3);
    expect(leads.length).toBeLessThan(rows.length);
    expect(positiveControls(b).map((c) => c.rank)).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(enrichment(b)).not.toBeNull();
    expect(rankStability(b, { iterations: 200 }).drugs.some((d) => d.rankP5 !== d.rankP95)).toBe(true);
  });

  it("fits the Bench Companion's short fields", () => {
    const items = affordableLeads(rows).slice(0, 10).map((r, i) => ({ id: r.drug.id, name: r.drug.name, rank: i + 1, flag: r.drug.safetyFlags[0]?.slice(0, 16) ?? "", store: r.drug.storage ?? "" }));
    expect(HostMsg.safeParse({ t: "shortlist", items }).success).toBe(true);
  });
});
