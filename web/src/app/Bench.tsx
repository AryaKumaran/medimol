import { useEffect, useRef, useState } from "react";
import type { RunBundle } from "../../../lib/bundle/schema";
import type { Row } from "../../../lib/bundle/scoring";
import { connectSerial, connectVirtual, hasWebSerial, type Device } from "../../../lib/device/device";
import type { DeviceMsg, HostMsg, TestedEvent } from "../../../lib/device/protocol";
import { download, shortlistCsv, testLogCsv } from "../../../lib/export/csv";
import type { Data } from "../data";
import { Pressable } from "../motion/react";
import { Icon } from "./ui";

const RANGE = { min: 2, max: 8 }; // fridge band in °C, sent to the device
type Virtual = ReturnType<typeof connectVirtual>;
type Key = "next" | "prev" | "tested";
type State = { kind: Device["kind"] | null; fw: string; temp: number | null; alert: "high" | "low" | "sensor" | null; idx: number; bad: number; error: string };
const OFF: State = { kind: null, fw: "", temp: null, alert: null, idx: 0, bad: 0, error: "" };

// The device has a 128x64 screen and 2 KB of RAM, so every field is cut to what the contract allows.
const shortlistOf = (leads: Row[]): Extract<HostMsg, { t: "shortlist" }>["items"] =>
  leads.slice(0, 10).map((r, i) => ({
    id: r.drug.id.slice(0, 32), name: r.drug.name.slice(0, 16), rank: i + 1,
    flag: (r.drug.safetyFlags[0] ?? "").slice(0, 16), store: (r.drug.storage ?? "").slice(0, 16),
  }));

// Lives in the app shell, so the connection and the test log survive moving between sections.
export function useBench(bundle: RunBundle, leads: Row[]) {
  const [state, setState] = useState<State>(OFF);
  const [log, setLog] = useState<TestedEvent[]>([]);
  const dev = useRef<Device | Virtual | null>(null);
  const items = shortlistOf(leads);

  const onMsg = (source: TestedEvent["source"]) => (m: DeviceMsg) => {
    if (m.t === "hello") setState((s) => ({ ...s, fw: `${m.board} · ${m.fw}` }));
    else if (m.t === "temp") setState((s) => ({ ...s, temp: m.c, alert: m.c >= RANGE.min && m.c <= RANGE.max ? null : s.alert }));
    else if (m.t === "alert") setState((s) => ({ ...s, alert: m.kind, temp: m.c ?? s.temp }));
    else if (m.t === "select") setState((s) => ({ ...s, idx: m.idx }));
    else {
      navigator.vibrate?.(12); // the commit and its haptic land together
      setLog((l) => [...l, { drugId: m.drugId, ms: m.ms, receivedAt: new Date().toISOString(), source }]);
    }
  };

  const disconnect = () => {
    const d = dev.current;
    dev.current = null;
    setState(OFF);
    void d?.close();
  };
  const connect = async (kind: Device["kind"]) => {
    disconnect();
    try {
      const h = { onMsg: onMsg(kind), onBad: () => setState((s) => ({ ...s, bad: s.bad + 1 })), onClose: () => dev.current && disconnect() };
      const d = kind === "virtual" ? connectVirtual(h) : await connectSerial(h);
      dev.current = d;
      setState((s) => ({ ...s, kind }));
      await d.send({ t: "shortlist", items });
      await d.send({ t: "range", ...RANGE });
    } catch (e) {
      setState({ ...OFF, error: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => () => void dev.current?.close(), []);

  return {
    state, log, items, connect, disconnect, bundleId: bundle.id,
    // Only the virtual device has on-screen keys; a real one has its own.
    press(k: Key): boolean {
      const d = dev.current;
      if (!d || !("press" in d)) return false;
      d.press(k);
      return true;
    },
    warm(on: boolean) {
      const d = dev.current;
      if (d && "setTemp" in d) d.setTemp(on ? 9.4 : null);
    },
  };
}

export function Bench({ data, leads, bench }: { data: Data; leads: Row[]; bench: ReturnType<typeof useBench> }) {
  const { state: s, log, items } = bench;
  const [warm, setWarm] = useState(false);
  const item = items[s.idx];
  const name = (id: string) => data.bundle.drugs.find((d) => d.id === id)?.name ?? id;
  const virtual = s.kind === "virtual";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="title-2">Bench</h1>
          <p className="callout muted">
            The Bench Companion is a small USB device that sits by the fridge. It shows the shortlist, watches storage temperature and records what was tested.
          </p>
        </div>
        <div className="page-tools">
          {s.kind ? (
            <Pressable className="btn" onClick={bench.disconnect}>Disconnect</Pressable>
          ) : (
            <>
              <Pressable className="btn btn-primary" onClick={() => bench.connect("virtual")}>Use the virtual device</Pressable>
              <Pressable className="btn" disabled={!hasWebSerial()} onClick={() => bench.connect("serial")}>Connect over USB</Pressable>
            </>
          )}
        </div>
      </header>

      <div className="cols">
        <section className="card card-pad stack" aria-label="Device">
          <div className="oled" role="img" aria-label={item ? `Device screen: ${item.name}, rank ${item.rank}` : "Device screen: nothing connected"}>
            <div className="oled-top"><span>{s.kind && item ? `#${item.rank}/${items.length}` : "--"}</span><span>{s.temp === null ? "--.- C" : `${s.temp.toFixed(1)} C`}</span></div>
            <div className="oled-name">{s.kind ? (item?.name ?? "No shortlist") : "Not connected"}</div>
            <div className={s.alert ? "oled-alert" : undefined}>
              {s.alert ? (s.alert === "sensor" ? "SENSOR ERROR" : `TEMP ${s.alert.toUpperCase()}`) : (s.kind && item ? [item.store, item.flag].filter(Boolean).join(" | ") || "OK" : "")}
            </div>
          </div>
          {virtual && (
            <div className="bench-keys">
              <Pressable className="btn" onClick={() => bench.press("prev")}>Previous</Pressable>
              <Pressable className="btn" onClick={() => bench.press("next")}>Next</Pressable>
              <Pressable className="btn btn-primary" onClick={() => bench.press("tested")}>Mark tested</Pressable>
              <label className="switch"><input type="checkbox" checked={warm} onChange={(e) => (setWarm(e.target.checked), bench.warm(e.target.checked))} />Simulate a warm fridge</label>
            </div>
          )}
          <p className="footnote" role="status">
            {s.error || (s.kind
              ? `${virtual ? "Virtual device" : "USB device"}${s.fw ? ` (${s.fw})` : ""}. Safe range ${RANGE.min}–${RANGE.max} °C.${s.bad ? ` ${s.bad} unreadable lines ignored.` : ""}`
              : hasWebSerial() ? "Nothing connected. The virtual device behaves exactly like the real one." : "USB needs Chrome or Edge on a desktop. The virtual device works everywhere.")}
          </p>
        </section>

        <section className="card card-pad stack" aria-label="Test log">
          <div className="page-head">
            <h2 className="headline">Test log</h2>
            <div className="page-tools">
              <Pressable className="btn" onClick={() => download(`${bench.bundleId}-shortlist.csv`, shortlistCsv(leads, bench.bundleId))}><Icon.down />Shortlist CSV</Pressable>
              <Pressable className="btn" disabled={!log.length} onClick={() => download(`${bench.bundleId}-test-log.csv`, testLogCsv(log))}><Icon.down />Log CSV</Pressable>
            </div>
          </div>
          {log.length ? (
            <table className="table">
              <thead><tr><th>Drug</th><th>Received</th><th>Source</th></tr></thead>
              <tbody>{log.map((e, i) => <tr key={i}><td>{name(e.drugId)}</td><td><span className="num">{e.receivedAt.slice(11, 19)}</span> UTC</td><td>{e.source}</td></tr>)}</tbody>
            </table>
          ) : (
            <p className="callout muted">Nothing marked yet. Press “Mark tested” on the device after running a compound.</p>
          )}
        </section>
      </div>
    </div>
  );
}
