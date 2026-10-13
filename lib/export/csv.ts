import type { Row } from "../bundle/scoring";
import type { TestedEvent } from "../device/protocol";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // RFC 4180 quoting + neutralize spreadsheet formula injection
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function shortlistCsv(rows: Row[], bundleId: string): string {
  return toCsv([
    ["rank", "drug", "drugbank_id", "best_target", "diffdock_confidence", "docking_norm", "access_score", "combined", "approval", "generic", "who_eml", "cost_tier", "cancer_trials", "unknowns", "safety_flags", "bundle", "disclaimer"],
    ...rows.map((r, i) => [
      i + 1, r.drug.name, r.drug.drugbankId, r.bestTargetId, r.confidence, r.docking.toFixed(3), r.access, r.combined.toFixed(3),
      r.drug.approval, r.drug.access.generic, r.drug.access.whoEml, r.drug.access.costTier, r.drug.access.trials?.count,
      r.unknowns.join(";"), r.drug.safetyFlags.join(";"), bundleId,
      "Computational hypothesis for lab testing; not medical advice",
    ]),
  ]);
}

export function testLogCsv(events: TestedEvent[]): string {
  return toCsv([["received_at", "drug_id", "device_ms", "source"], ...events.map((e) => [e.receivedAt, e.drugId, e.ms, e.source])]);
}

export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
