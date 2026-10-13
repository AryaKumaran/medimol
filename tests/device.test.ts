import { describe, expect, it, vi } from "vitest";
import { encode, lineParser, type DeviceMsg } from "../lib/device/protocol";
import { connectVirtual } from "../lib/device/device";
import { shortlistCsv, testLogCsv, toCsv } from "../lib/export/csv";
import { leaderboard } from "../lib/bundle/scoring";
import { fixture } from "./fixture";

describe("protocol", () => {
  it("reassembles split chunks and reports bad lines without throwing", () => {
    const got: DeviceMsg[] = [], bad: string[] = [];
    const feed = lineParser((m) => got.push(m), (l) => bad.push(l));
    feed('{"t":"temp","c":4.');
    feed('5,"ms":10}\r\n{garbage}\n{"t":"temp","c":999,"ms":1}\n{"t":"sel');
    expect(got).toEqual([{ t: "temp", c: 4.5, ms: 10 }]);
    expect(bad).toHaveLength(2);
    feed('ect","idx":2}\n');
    expect(got.at(-1)).toEqual({ t: "select", idx: 2 });
  });
  it("encode validates host messages and adds newline", () => {
    expect(encode({ t: "range", min: 2, max: 8 })).toBe('{"t":"range","min":2,"max":8}\n');
    expect(() => encode({ t: "shortlist", items: [{ id: "x", name: "a-name-way-too-long-for-oled", rank: 1, flag: "", store: "" }] })).toThrow();
  });
});

describe("virtual device", () => {
  it("emits hello, temps, excursion alerts, selection and tested events", async () => {
    vi.useFakeTimers();
    const got: DeviceMsg[] = [];
    const d = connectVirtual({ onMsg: (m) => got.push(m) }, { intervalMs: 100 });
    await d.send({ t: "shortlist", items: [{ id: "a", name: "A", rank: 1, flag: "", store: "" }, { id: "b", name: "B", rank: 2, flag: "", store: "" }] });
    d.setTemp(12);
    vi.advanceTimersByTime(100);
    d.press("next");
    d.press("tested");
    await d.close();
    vi.useRealTimers();
    expect(got[0]).toMatchObject({ t: "hello" });
    expect(got).toContainEqual(expect.objectContaining({ t: "alert", kind: "high", c: 12 }));
    expect(got).toContainEqual({ t: "select", idx: 1 });
    expect(got.at(-1)).toMatchObject({ t: "tested", drugId: "b" });
  });
});

describe("csv", () => {
  it("quotes and neutralizes formulas", () => {
    expect(toCsv([['a,b', 'say "hi"', "=cmd()", null]])).toBe('"a,b","say ""hi""",\'=cmd(),\r\n');
  });
  it("shortlist and test log have headers and disclaimer", () => {
    const s = shortlistCsv(leaderboard(fixture()), "test");
    expect(s.split("\r\n")[0]).toMatch(/^rank,drug,/);
    expect(s).toContain("not medical advice");
    expect(testLogCsv([{ drugId: "a", ms: 5, receivedAt: "t", source: "virtual" }])).toBe("received_at,drug_id,device_ms,source\r\nt,a,5,virtual\r\n");
  });
});
