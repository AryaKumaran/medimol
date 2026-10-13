import type { RunBundle } from "./schema";

export type ReplayEvent =
  | { atMs: number; kind: "stage"; stage: "targets" | "docking" | "ranking" | "done"; message: string }
  | { atMs: number; kind: "target"; targetId: string }
  | { atMs: number; kind: "pose"; drugId: string; targetId: string; confidence: number };

// Pure: turns a recorded run into a timeline that fits in `budgetMs` (Explore must finish < 90s).
export function buildTimeline(b: RunBundle, budgetMs = 60_000): ReplayEvent[] {
  const top = b.poses.filter((p) => p.rank === 1);
  const steps = b.targets.length + top.length + 4;
  const dt = Math.floor(budgetMs / steps);
  let t = 0;
  const ev: ReplayEvent[] = [];
  const at = () => (t += dt) - dt;
  ev.push({ atMs: at(), kind: "stage", stage: "targets", message: `Loading ${b.targets.length} protein targets` });
  for (const x of b.targets) ev.push({ atMs: at(), kind: "target", targetId: x.id });
  ev.push({ atMs: at(), kind: "stage", stage: "docking", message: `Replaying ${top.length} recorded ${b.provenance.model} dockings` });
  for (const p of top) ev.push({ atMs: at(), kind: "pose", drugId: p.drugId, targetId: p.targetId, confidence: p.confidence });
  ev.push({ atMs: at(), kind: "stage", stage: "ranking", message: "Ranking by docking confidence and access" });
  ev.push({ atMs: at(), kind: "stage", stage: "done", message: "Done (replay of a recorded run, not a live computation)" });
  return ev;
}

export function play(
  events: ReplayEvent[],
  onEvent: (e: ReplayEvent) => void,
  opts: { speed?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const speed = opts.speed ?? 1;
  return new Promise((resolve) => {
    const timers = events.map((e) => setTimeout(() => onEvent(e), e.atMs / speed));
    const last = setTimeout(resolve, (events.at(-1)?.atMs ?? 0) / speed + 1);
    opts.signal?.addEventListener("abort", () => {
      [...timers, last].forEach(clearTimeout);
      resolve();
    });
  });
}
