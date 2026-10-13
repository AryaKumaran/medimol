import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { enrichment } from "../../../lib/analysis/enrichment";
import { rankStability } from "../../../lib/analysis/stability";
import { leaderboard } from "../../../lib/bundle/scoring";
import { positiveControls } from "../../../lib/bundle/validation";
import type { Data } from "../data";
import { invalidate, Spring } from "../motion/engine";
import { Num, reduced, useMotion } from "../motion/react";
import { SPRING } from "../motion/spring";
import { pct } from "./ui";

// A chart mark placed by percent of its lane. It springs to a new place when the numbers change.
function Mark({ className, x, children }: { className: string; x: number; children?: ReactNode }) {
  const m = useMotion({ x }, SPRING.move, "%");
  useEffect(() => m.to({ x }), [x]);
  return <span className={className} ref={m.attach}>{children}</span>;
}

// The 90% band. Its two ends are separate springs and it is drawn by moving a clip: scaling a bar this thin
// makes the browser paint it at low resolution and it goes soft.
function Band({ from, to }: { from: number; to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [ends] = useState(() => {
    const write = () => void (ref.current && (ref.current.style.clipPath = `inset(0 ${100 - e.b.x}% 0 ${e.a.x}% round 0.25rem)`));
    const e: { a: Spring; b: Spring; write: () => void } = {
      a: new Spring(from, SPRING.move, () => invalidate(write)), b: new Spring(to, SPRING.move, () => invalidate(write)), write,
    };
    return e;
  });
  useLayoutEffect(() => {
    if (!reduced()) return void (ends.a.to(from), ends.b.to(to));
    ends.a.jump(from);
    ends.b.jump(to);
    ends.write();
  }, [from, to]);
  return <span className="band" ref={(el) => { ref.current = el; ends.write(); }} />;
}

// Rank 1 sits at the left edge and the last rank at the right.
const lane = (n: number) => (rank: number) => (n > 1 ? ((rank - 1) / (n - 1)) * 100 : 50);

export function Stability({ data }: { data: Data }) {
  const { bundle } = data;
  const [jitter, setJitter] = useState(25);
  const [noise, setNoise] = useState(true);
  const res = useMemo(() => rankStability(bundle, { weightJitter: jitter / 100, dockingNoise: noise }), [bundle, jitter, noise]);
  const n = res.drugs.length;
  const at = lane(n);
  const name = (id: string) => bundle.drugs.find((d) => d.id === id)?.name ?? id;
  const two = (x: number) => x.toFixed(2);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="title-2">Stability</h1>
          <p className="callout muted">
            The access weights are judgment calls and one docking run is noisy. Here the ranking is rebuilt {res.opts.iterations.toLocaleString()} times
            with both nudged. A lead worth testing holds its place.
          </p>
        </div>
        <div className="page-tools">
          <label className="slider">
            Weights vary by
            <input type="range" min={0} max={50} step={5} value={jitter} onChange={(e) => setJitter(Number(e.target.value))} />
            <span className="num">±{jitter}%</span>
          </label>
          <label className="switch"><input type="checkbox" checked={noise} onChange={(e) => setNoise(e.target.checked)} />Docking noise</label>
        </div>
      </header>

      <div className="stack">
        <div className="tiles">
          <div className="card tile"><span className="footnote">Ranking agreement (Kendall τ)</span><b className="num"><Num value={res.kendallTau.median} format={two} /></b><span className="footnote">Median across reruns. 1 means the same order.</span></div>
          <div className="card tile"><span className="footnote">Roughest 5% of reruns</span><b className="num"><Num value={res.kendallTau.p5} format={two} /></b><span className="footnote">Agreement stays above this 95% of the time.</span></div>
          <div className="card tile"><span className="footnote">Reruns</span><b className="num">{res.opts.iterations.toLocaleString()}</b><span className="footnote">Seed {res.opts.seed}, so every number here can be reproduced.</span></div>
        </div>

        <section className="card chart" aria-label="Rank range of each drug across reruns">
          <div className="key">
            <span><i className="key-band" />90% of reruns</span>
            <span><i className="key-dot" />Median rank</span>
            <span><i className="key-tick" />Rank with the documented weights</span>
          </div>
          {res.drugs.map((d) => (
            <div
              key={d.drugId} className="chart-row"
              title={`${name(d.drugId)}: baseline rank ${d.baselineRank}, median ${d.medianRank}, 90% of reruns between ${d.rankP5} and ${d.rankP95}`}
            >
              <span>{name(d.drugId)}{d.noiseSd === null && " †"}</span>
              <span className="lane">
                <Band from={at(d.rankP5)} to={at(d.rankP95)} />
                <Mark className="tick" x={at(d.baselineRank)} />
                <Mark className="dot" x={at(d.medianRank)} />
              </span>
              <span><Num value={d.pTopN * 100} format={(x) => `${Math.round(x)}%`} /></span>
            </div>
          ))}
          <div className="axis"><span /><div><span>Rank 1</span><span>Rank {n}</span></div><span className="footnote">Top {res.opts.topN}</span></div>
          {res.drugs.some((d) => d.noiseSd === null) && <p className="footnote page-note">† Fewer than two poses, so docking noise could not be estimated for this drug.</p>}
        </section>
        <p className="footnote">Ranks are by score (docking × access). Positive controls are left out, as on the Leads list.</p>
      </div>
    </div>
  );
}

export function Validation({ data }: { data: Data }) {
  const { bundle } = data;
  const controls = useMemo(() => positiveControls(bundle), [bundle]);
  const enr = useMemo(() => enrichment(bundle), [bundle]);
  const docked = useMemo(() => leaderboard(bundle, { includeControls: true }).filter((r) => r.confidence !== null), [bundle]);
  const at = lane(docked.length);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="title-2">Validation</h1>
          <p className="callout muted">
            Positive controls are drugs already known to bind. If docking works, they should score near the top. Their places are reported as they are, good or bad.
          </p>
        </div>
      </header>

      {!controls.length ? (
        <p className="card empty">This run has no positive controls, so there is nothing to validate against.</p>
      ) : (
        <div className="stack">
          <section className="card chart" aria-label="Where the positive controls rank among all docked drugs">
            <div className="key">
              <span><i className="key-control" />Positive control</span>
              <span><i className="key-other" />Every other docked drug</span>
            </div>
            <div className="strip">
              <span className="lane">
                {docked.map((r, i) => r.drug.positiveControl || <Mark key={r.drug.id} className="tick tick-other" x={at(i + 1)} />)}
                {docked.map((r, i) => r.drug.positiveControl && (
                  <Mark key={r.drug.id} className="tick tick-control" x={at(i + 1)}>
                    {/* neighbouring labels alternate above and below so they cannot collide */}
                    <b className={`strip-label ${controls.findIndex((c) => c.drugId === r.drug.id) % 2 ? "strip-label-low" : ""}`}>{r.drug.name} · {i + 1}</b>
                  </Mark>
                ))}
              </span>
            </div>
            <div className="axis axis-wide"><div><span>Rank 1 (best docking confidence)</span><span>Rank {docked.length}</span></div></div>
          </section>

          {enr && (
            <>
              <div className="tiles">
                <div className="card tile">
                  <span className="footnote">ROC-AUC</span><b className="num">{enr.rocAuc.toFixed(2)}</b>
                  <span className="footnote">{enr.rocAucCi95 ? `95% interval ${enr.rocAucCi95[0].toFixed(2)}–${enr.rocAucCi95[1].toFixed(2)}. ` : ""}0.5 is chance.</span>
                </div>
                <div className="card tile"><span className="footnote">BEDROC (α = 20)</span><b className="num">{enr.bedroc.toFixed(2)}</b><span className="footnote">Rewards controls at the very top of the list.</span></div>
                <div className="card tile"><span className="footnote">Controls</span><b className="num">{enr.nActives}<small> of {enr.nTotal}</small></b><span className="footnote">Few controls means wide uncertainty.</span></div>
              </div>
              <section className="card card-pad">
                <table className="table">
                  <thead><tr><th>Top of the list</th><th className="num">Enrichment</th><th className="num">Best possible</th></tr></thead>
                  <tbody>
                    {enr.ef.map((e) => (
                      <tr key={e.fraction}><td>Top {pct(e.fraction)}</td><td className="num">{e.ef.toFixed(1)}×</td><td className="num">{e.maxEf.toFixed(1)}×</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          <section className="card card-pad">
            <table className="table">
              <thead><tr><th>Control</th><th className="num">Rank</th><th className="num">Percentile</th></tr></thead>
              <tbody>
                {controls.map((c) => (
                  <tr key={c.drugId}><td>{c.name}</td><td className="num">{c.rank === null ? "not docked" : `${c.rank} of ${c.of}`}</td><td className="num">{c.percentile === null ? "–" : c.percentile}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <p className="footnote">
            The comparison set is every other drug in the run, not drugs confirmed to be non-binders. That makes these numbers a conservative lower bound on how well docking separates real binders.
          </p>
        </div>
      )}
    </div>
  );
}
