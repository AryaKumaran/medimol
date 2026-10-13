import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildTimeline, type ReplayEvent } from "../../../lib/bundle/replay";
import type { Data } from "../data";
import { clock } from "../motion/engine";
import { Fill, Pressable, Reveal, Segmented, useFlip, useMotion } from "../motion/react";
import { go } from "./App";
import { Icon, signed } from "./ui";

const SPEEDS = [{ value: "1", label: "1×" }, { value: "4", label: "4×" }, { value: "10", label: "10×" }] as const;
type PoseEvent = Extract<ReplayEvent, { kind: "pose" }>;
const key = (p: PoseEvent) => `${p.drugId}|${p.targetId}`;

// Plays the recorded run back on the motion clock: targets load, dockings arrive one by one, then the tiles
// fly into rank order. One timer at a time, so pause and speed changes take hold on the very next step.
export function Replay({ data }: { data: Data }) {
  const { bundle } = data;
  const events = useMemo(() => buildTimeline(bundle), [bundle]);
  const all = useMemo(() => events.flatMap((e) => (e.kind === "pose" ? [e] : [])), [events]);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]["value"]>("1");
  const [n, setN] = useState(0); // events played so far
  const [running, setRunning] = useState(false);
  const stage = useMotion();
  const done = n === events.length;

  useEffect(() => {
    const next = events[n];
    if (!running || !next) return setRunning(false);
    return clock.after((next.atMs - (events[n - 1]?.atMs ?? 0)) / Number(speed), () => setN(n + 1));
  }, [running, n, speed]);

  const seen = events.slice(0, n);
  let message = "Ready to replay the recorded run.";
  let ranked = false;
  for (const e of seen) if (e.kind === "stage") (message = e.message, ranked ||= e.stage === "ranking");
  const targets = seen.flatMap((e) => (e.kind === "target" ? bundle.targets.filter((t) => t.id === e.targetId) : []));
  const arrived = seen.filter((e) => e.kind === "pose").length;
  const drug = (id: string) => bundle.drugs.find((d) => d.id === id)?.name ?? id;
  const gene = (id: string) => bundle.targets.find((t) => t.id === id)?.gene ?? id;

  // Every tile holds its place from the start, so the card never changes size while the run plays.
  // Each one appears when its docking arrives; ranking then changes the order and the tiles spring to it.
  const order = ranked ? [...all].sort((a, b) => b.confidence - a.confidence) : all;
  const flip = useFlip(order.map(key), { enter: false });
  const shown = useRef(0);
  useLayoutEffect(() => {
    if (arrived < shown.current) shown.current = 0;
    if (!arrived) for (const p of all) flip.motion(key(p)).jump({ opacity: 0, y: 8, scale: 0.98 });
    for (let i = shown.current; i < arrived; i++) flip.motion(key(all[i]!)).to({ opacity: 1, y: 0, scale: 1 });
    shown.current = arrived;
  }, [arrived]);

  // Leave the way it came: the stage fades, resets while unseen, and comes back already running.
  const again = () => stage.to({ opacity: 0 }, { onRest: () => { setN(0); setRunning(true); stage.to({ opacity: 1 }); } });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="title-2">Replay</h1>
          <p className="callout muted">A replay of the recorded {bundle.provenance.model} run from {bundle.provenance.runDate}. Nothing here is computed live.</p>
        </div>
        <div className="page-tools">
          <Segmented label="Playback speed" value={speed} options={SPEEDS} onChange={(v) => setSpeed(v)} />
          {done ? (
            <Pressable className="btn btn-primary" onClick={again}><Icon.restart />Replay</Pressable>
          ) : (
            <Pressable className="btn btn-primary" onClick={() => setRunning(!running)}>
              {running ? <><Icon.pause />Pause</> : <><Icon.play />{n ? "Resume" : "Play"}</>}
            </Pressable>
          )}
        </div>
      </header>

      <section className="card stage" ref={stage.attach} aria-label="Run replay">
        <div className="stage-top">
          <p className="title-3" role="status">{message}</p>
          <span className="callout muted num">{arrived} of {all.length} dockings</span>
        </div>
        <div className="track progress"><Fill value={n / events.length} /></div>
        <div className="targets">
          {targets.map((t) => (
            <Reveal key={t.id} className="target">{t.gene}<small>PDB {t.pdbId}</small></Reveal>
          ))}
        </div>
        <div className="poses">
          {order.map((p) => (
            <div key={key(p)} className={`pose ${all.indexOf(p) < arrived ? "" : "pose-unseen"}`} ref={flip.motion(key(p)).attach}>
              <span>{drug(p.drugId)}<small>{gene(p.targetId)}</small></span>
              <span className="cell-num">{signed(p.confidence)}</span>
            </div>
          ))}
        </div>
        <div className="stage-end">
          {done && <Reveal><Pressable className="btn" onClick={() => go("leads")}>See the leads</Pressable></Reveal>}
        </div>
      </section>
    </div>
  );
}
