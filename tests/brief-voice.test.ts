import { describe, expect, it } from "vitest";
import { brief, briefToText } from "../lib/brief/brief";
import { parseCommand } from "../lib/voice/voice";
import { leaderboard } from "../lib/bundle/scoring";
import { fixture } from "./fixture";

const b = fixture();
const rows = leaderboard(b);

describe("brief", () => {
  it("states facts from the bundle and always includes the limits", () => {
    const x = briefToText(brief(b, rows, "a"));
    expect(x).toContain("A cheaper generic version exists.");
    expect(x).toContain("3 pancreatic cancer clinical trial");
    expect(x).toContain("70% chance");
    expect(x).toContain("not medical advice");
  });
  it("is honest about unknowns and out-of-domain models", () => {
    expect(briefToText(brief(b, rows, "c"))).toMatch(/could not confirm.*do not know if a generic/s);
    const bx = briefToText(brief(b, rows, "b"));
    expect(bx).toContain("too different");
    expect(bx).not.toContain("90%");
  });
  it("spanish has the same structure and its own disclaimer", () => {
    const en = brief(b, rows, "a"), es = brief(b, rows, "a", "es");
    expect(es.sections).toHaveLength(en.sections.length);
    expect(briefToText(es)).toContain("No es un consejo médico");
  });
  it("property: every drug on the board gets a brief with no 'undefined'", () => {
    for (const r of rows) for (const l of ["en", "es"] as const) expect(briefToText(brief(b, rows, r.drug.id, l))).not.toMatch(/undefined|NaN/);
  });
  it("throws for drugs not on the board", () => expect(() => brief(b, rows, "ctrl")).toThrow());
});

describe("parseCommand", () => {
  const drugs = [{ id: "met", name: "Metformin" }, { id: "asp", name: "Aspirin" }, { id: "aspc", name: "Aspirin C" }];
  it.each([
    ["Next", "next"], ["siguiente", "next"], ["go back", "previous"], ["atrás", "previous"],
    ["read it to me", "read"], ["stop reading", "stop"], ["show affordable leads", "affordable"],
    ["Mark tested", "tested"], ["marcar probado", "tested"], ["ayuda", "help"], ["show all", "all"],
  ])("%s → %s", (said, kind) => expect(parseCommand(said, drugs).kind).toBe(kind));
  it("opens drugs by name, accent/case-insensitive, longest match wins", () => {
    expect(parseCommand("open METFORMIN", drugs)).toEqual({ kind: "open", drugId: "met" });
    expect(parseCommand("abrir aspirin c", drugs)).toEqual({ kind: "open", drugId: "aspc" });
  });
  it("does not match drug names without an open verb, or partial words", () => {
    expect(parseCommand("metformin", drugs).kind).toBe("unknown");
    expect(parseCommand("nextdoor", drugs).kind).toBe("unknown");
  });
  it("unknown keeps the transcript for display", () =>
    expect(parseCommand("banana", drugs)).toEqual({ kind: "unknown", heard: "banana" }));
});
