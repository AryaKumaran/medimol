import { z } from "zod";

// Newline-delimited JSON over USB serial, 115200 baud. Firmware must match this exactly.
export const DeviceMsg = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), fw: z.string(), board: z.string() }),
  z.object({ t: z.literal("temp"), c: z.number().min(-55).max(125), ms: z.number().int() }), // DS18B20 range
  z.object({ t: z.literal("alert"), kind: z.enum(["high", "low", "sensor"]), c: z.number().nullable(), ms: z.number().int() }),
  z.object({ t: z.literal("select"), idx: z.number().int().nonnegative() }),
  z.object({ t: z.literal("tested"), drugId: z.string().min(1).max(32), ms: z.number().int() }),
]);
export type DeviceMsg = z.infer<typeof DeviceMsg>;

export const HostMsg = z.discriminatedUnion("t", [
  // Short fields: the Uno has 2KB RAM and a 128x64 OLED.
  z.object({
    t: z.literal("shortlist"),
    items: z.array(z.object({ id: z.string().max(32), name: z.string().max(16), rank: z.number().int(), flag: z.string().max(16), store: z.string().max(16) })).max(10),
  }),
  z.object({ t: z.literal("range"), min: z.number(), max: z.number() }),
]);
export type HostMsg = z.infer<typeof HostMsg>;

export type TestedEvent = { drugId: string; ms: number; receivedAt: string; source: "serial" | "virtual" };

export const encode = (m: HostMsg) => JSON.stringify(HostMsg.parse(m)) + "\n";

// Feeds arbitrary chunks, emits validated messages. Bad lines are reported, never thrown:
// a noisy USB link must not crash the page.
export function lineParser(onMsg: (m: DeviceMsg) => void, onBad: (line: string, err: string) => void = () => {}) {
  let buf = "";
  return (chunk: string) => {
    buf += chunk;
    if (buf.length > 4096) buf = buf.slice(-4096); // ponytail: guard against a device that never sends \n
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let json: unknown;
      try { json = JSON.parse(line); } catch { onBad(line, "invalid json"); continue; }
      const r = DeviceMsg.safeParse(json);
      if (r.success) onMsg(r.data);
      else onBad(line, r.error.issues[0]?.message ?? "invalid");
    }
  };
}
