import { encode, lineParser, type DeviceMsg, type HostMsg } from "./protocol";

export type Device = {
  kind: "serial" | "virtual";
  send(m: HostMsg): Promise<void>;
  close(): Promise<void>;
};
export type Handlers = { onMsg: (m: DeviceMsg) => void; onBad?: (line: string, err: string) => void; onClose?: () => void };

// Minimal Web Serial typing (Chromium desktop only).
type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};
const serial = () => (globalThis.navigator as unknown as { serial?: { requestPort(): Promise<SerialPortLike> } })?.serial;

export const hasWebSerial = () => !!serial();

export async function connectSerial(h: Handlers): Promise<Device> {
  const s = serial();
  if (!s) throw new Error("Web Serial not available. Use Chrome or Edge on desktop, or the virtual device.");
  const port = await s.requestPort();
  await port.open({ baudRate: 115200 });
  const reader = port.readable!.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
  const feed = lineParser(h.onMsg, h.onBad);
  let open = true;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        feed(value);
      }
    } catch { /* unplugged */ }
    open = false;
    h.onClose?.();
  })();
  const enc = new TextEncoder();
  return {
    kind: "serial",
    async send(m) {
      if (!open) throw new Error("device disconnected");
      const w = port.writable!.getWriter();
      try { await w.write(enc.encode(encode(m))); } finally { w.releaseLock(); }
    },
    async close() {
      await reader.cancel().catch(() => {});
      await port.close().catch(() => {});
    },
  };
}

// Emits the same NDJSON lines as the firmware, through the same parser, so the UI path is identical.
export function connectVirtual(h: Handlers, opts: { intervalMs?: number; tempC?: () => number } = {}): Device & {
  press(b: "next" | "prev" | "tested"): void;
  setTemp(c: number | null): void;
} {
  const feed = lineParser(h.onMsg, h.onBad);
  const emit = (o: object) => feed(JSON.stringify(o) + "\n");
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  let items: { id: string }[] = [];
  let idx = 0;
  let range = { min: 2, max: 8 }; // default fridge band; host overrides with "range"
  let forced: number | null = null;
  const temp = () => forced ?? opts.tempC?.() ?? 4.5 + Math.sin(ms() / 20_000) * 0.8;

  emit({ t: "hello", fw: "virtual-1", board: "virtual" });
  const timer = setInterval(() => {
    const c = Math.round(temp() * 10) / 10;
    emit({ t: "temp", c, ms: ms() });
    if (c > range.max) emit({ t: "alert", kind: "high", c, ms: ms() });
    if (c < range.min) emit({ t: "alert", kind: "low", c, ms: ms() });
  }, opts.intervalMs ?? 2000);

  return {
    kind: "virtual",
    async send(m) {
      encode(m); // same validation as the serial path
      if (m.t === "shortlist") { items = m.items; idx = 0; }
      if (m.t === "range") range = { min: m.min, max: m.max };
    },
    async close() { clearInterval(timer); h.onClose?.(); },
    press(b) {
      if (!items.length) return;
      if (b === "next") idx = (idx + 1) % items.length;
      if (b === "prev") idx = (idx - 1 + items.length) % items.length;
      if (b === "tested") return emit({ t: "tested", drugId: items[idx]!.id, ms: ms() });
      emit({ t: "select", idx });
    },
    setTemp(c) { forced = c; }, // null = back to simulated fridge drift
  };
}
