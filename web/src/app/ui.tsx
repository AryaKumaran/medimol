import type { ReactNode } from "react";
import type { ActivitySignal } from "../../../lib/analysis/activity";
import type { Drug } from "../../../lib/bundle/schema";
import { useMotion, usePresence } from "../motion/react";

// A true minus sign, so negative docking scores line up and read as numbers.
export const signed = (x: number, digits = 2) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(digits);
export const pct = (x: number) => `${Math.round(x * 100)}%`;

const svg = (d: ReactNode, box = "0 0 20 20") => (
  <svg viewBox={box} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
export const Icon = {
  close: () => svg(<path d="M5 5l10 10M15 5L5 15" />),
  play: () => svg(<path d="M6.5 4.5v11l9-5.5z" fill="currentColor" stroke="none" />),
  pause: () => svg(<path d="M6.5 4.5v11M13.5 4.5v11" strokeWidth="2.6" />),
  restart: () => svg(<path d="M4.5 10a5.5 5.5 0 1 0 1.8-4.1M4.5 4v3h3" />),
  speaker: () => svg(<path d="M3.5 8v4h2.8L10 15V5L6.3 8zM13 7.5a3.5 3.5 0 0 1 0 5M15 5.2a6.6 6.6 0 0 1 0 9.6" />),
  mic: () => svg(<path d="M10 2.8a2.2 2.2 0 0 0-2.2 2.2v4.4a2.2 2.2 0 0 0 4.4 0V5A2.2 2.2 0 0 0 10 2.8zM5.2 9.6a4.8 4.8 0 0 0 9.6 0M10 14.4v2.8" />),
  down: () => svg(<path d="M10 3.5v9M6 9l4 4 4-4M4.5 16.5h11" />),
  chevron: () => <svg className="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 1.5L6.5 7l-5 5.5" /></svg>,
  mark: () => (
    <svg className="brand-mark" viewBox="0 0 22 22" aria-hidden="true">
      <rect width="22" height="22" rx="6" fill="var(--accent)" />
      <path d="M6 15.5V7.2l5 5.3 5-5.3v8.3" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const APPROVAL: Record<Drug["approval"], [string, string]> = {
  approved: ["chip-good", "Approved"],
  investigational: ["chip-warn", "Investigational"],
  withdrawn: ["chip-bad", "Withdrawn"],
  unknown: ["chip-unknown", "Approval unknown"],
};
export const ApprovalChip = ({ approval }: { approval: Drug["approval"] }) => (
  <span className={`chip ${APPROVAL[approval][0]}`}>{APPROVAL[approval][1]}</span>
);

// The lab-data signal sits beside the score and is never folded into it.
// A prediction outside the model's domain is never shown as a number.
export function SignalChip({ s }: { s: ActivitySignal }) {
  if (s.kind === "measured") return <span className="chip chip-good">Measured {s.pchembl.toFixed(1)}</span>;
  if (s.kind === "predicted") return <span className="chip">Model {pct(s.p)}</span>;
  if (s.kind === "out-of-domain") return <span className="chip chip-unknown">Too different</span>;
  return <span className="footnote">No result</span>;
}

// Scales and sharpens out of the control that opened it (transform-origin is the trigger's corner), and leaves the same way.
export function Popover({ open, label, children }: { open: boolean; label: string; children: ReactNode }) {
  const hidden = { opacity: 0, scale: 0.9, blur: 8 };
  const m = useMotion(hidden);
  const mounted = usePresence(open, m, hidden, { opacity: 1, scale: 1, blur: 0 });
  return mounted ? <div className="pop" role="dialog" aria-label={label} ref={m.attach}>{children}</div> : null;
}
