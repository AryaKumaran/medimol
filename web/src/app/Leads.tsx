import { useLayoutEffect, useMemo, useRef } from "react";
import { activitySignal } from "../../../lib/analysis/activity";
import type { StabilityResult } from "../../../lib/analysis/stability";
import { brief, type Lang } from "../../../lib/brief/brief";
import type { Drug } from "../../../lib/bundle/schema";
import type { Row } from "../../../lib/bundle/scoring";
import { download, shortlistCsv } from "../../../lib/export/csv";
import { canSpeak, stopSpeaking } from "../../../lib/voice/voice";
import type { Data } from "../data";
import { Fill, Pressable, Segmented, useFlip, useGrow, useMotion, type Motion } from "../motion/react";
import { PoseViewer } from "./PoseViewer";
import { ApprovalChip, Icon, pct, signed, SignalChip } from "./ui";

export type Filter = "all" | "affordable";
const FILTERS = [{ value: "all", label: "All" }, { value: "affordable", label: "Affordable" }] as const;
const LANGS = [{ value: "en", label: "English" }, { value: "es", label: "Español" }] as const;

type Tri = "yes" | "no" | "unknown";
// The four facts behind the Access Score, in the order of its weights.
const accessFacts = (d: Drug): [string, Tri][] => [
  ["Approved", d.approval === "approved" ? "yes" : d.approval === "unknown" ? "unknown" : "no"],
  ["Generic", d.access.generic],
  ["WHO essential list", d.access.whoEml],
  ["Cancer trials", d.access.trials === null ? "unknown" : d.access.trials.count > 0 ? "yes" : "no"],
];

export function Leads({ data, rows, leads, filter, setFilter, selected, select }: {
  data: Data; rows: Row[]; leads: Row[]; filter: Filter; setFilter(f: Filter): void; selected: string | null; select(id: string | null): void;
}) {
  const { bundle } = data;
  const shown = filter === "affordable" ? leads : rows;
  const flip = useFlip(shown.map((r) => r.drug.id));
  const card = useGrow(); // after useFlip: rows that left must be out of the flow before the card is measured
  const byId = useMemo(() => new Map(rows.map((r) => [r.drug.id, r])), [rows]);
  const place = new Map(shown.map((r, i) => [r.drug.id, i + 1]));
  const gene = (id: string | null) => bundle.targets.find((t) => t.id === id)?.gene ?? "–";

  return (
    <div className="page">
      {/* Tools sit under the title, on the left, so the inspector on the right never covers them. */}
      <header className="page-head page-head-stack">
        <div>
          <h1 className="title-2">Leads</h1>
          <p className="callout muted">
            {filter === "all"
              ? `${rows.length} drugs docked against ${bundle.targets.length} targets, best docking confidence first.`
              : `${leads.length} approved drugs with a generic, best docking × access first.`}
          </p>
        </div>
        <div className="page-tools">
          <Segmented label="Which drugs" value={filter} options={FILTERS} onChange={setFilter} />
          <Pressable className="btn" onClick={() => download(`${bundle.id}-shortlist.csv`, shortlistCsv(shown, bundle.id))}>
            <Icon.down />Export CSV
          </Pressable>
        </div>
      </header>

      <div className="lift">
      <section className="card card-clip" aria-label="Ranked drugs" ref={card}>
        <div className="list-head" aria-hidden="true">
          <span>#</span><span>Drug</span><span>Target</span><span>Docking</span><span>Access</span><span>Score</span><span>Lab data</span><span />
        </div>
        <div className="list">
          {flip.order.map((id) => {
            const r = byId.get(id);
            return r && (
              <LeadRow
                key={id} r={r} place={place.get(id)} gene={gene(r.bestTargetId)} motion={flip.motion(id)}
                signal={<SignalChip s={activitySignal(bundle, id)} />} selected={selected === id} onSelect={() => select(selected === id ? null : id)}
              />
            );
          })}
        </div>
        {!shown.length && <p className="empty">No drug in this run is both approved and available as a generic.</p>}
      </section>
      </div>

      <p className="footnote page-note rides">
        Docking confidence ranks poses; it is not a binding affinity. Access adds approved 0.3, generic 0.3, WHO essential list 0.2 and
        cancer trials 0.2; anything unconfirmed counts as 0 and is marked “?”. Score is docking × access. Lab data sits beside the score and is never part of it.
      </p>
    </div>
  );
}

function LeadRow({ r, place, gene, signal, selected, onSelect, motion }: {
  r: Row; place?: number; gene: string; signal: React.ReactNode; selected: boolean; onSelect(): void; motion: Motion;
}) {
  const d = r.drug;
  const facts = accessFacts(d);
  return (
    <Pressable motion={motion} depth={0.985} className="row" aria-pressed={selected} onClick={onSelect}>
      <span className="rank">{place}</span>
      <span className="name"><span>{d.name}</span><ApprovalChip approval={d.approval} /></span>
      <span className="callout muted">{gene}</span>
      <span className="meter">
        <span className="cell-num">{r.confidence === null ? "–" : signed(r.confidence)}</span>
        <span className="track"><Fill value={r.docking} /></span>
      </span>
      <span className="pips" title={facts.map(([k, v]) => `${k}: ${v}`).join(" · ")}>
        <span className="pip-set">{facts.map(([k, v]) => <span key={k} className={`pip pip-${v}`}>{v === "unknown" && "?"}</span>)}</span>
        <span className="cell-num">{r.access.toFixed(2)}</span>
      </span>
      <span className="cell-num">{r.combined.toFixed(2)}</span>
      <span>{signal}</span>
      <Icon.chevron />
    </Pressable>
  );
}

// The inspector's content: the plain-language brief, how steady the rank is, and where each fact came from.
export function DrugPanel({ data, rows, stability, id, lang, setLang, read }: {
  data: Data; rows: Row[]; stability: StabilityResult; id: string; lang: Lang; setLang(l: Lang): void; read(id: string, lang: Lang): void;
}) {
  const { bundle } = data;
  const i = rows.findIndex((r) => r.drug.id === id);
  const row = rows[i]!;
  const d = row.drug;
  const b = brief(bundle, rows, id, lang);
  const st = stability.drugs.find((x) => x.drugId === id);
  const target = bundle.targets.find((t) => t.id === row.bestTargetId);
  const sources = bundle.sources.filter((s) => d.access.sourceIds.includes(s.id) || target?.sourceIds.includes(s.id));

  // New drug or new language: the text swaps under a short blur, so it reads as one thing changing.
  const text = useMotion();
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) return void (first.current = false);
    text.jump({ opacity: 0, blur: 5 });
    text.to({ opacity: 1, blur: 0 });
  }, [id, lang]);
  useLayoutEffect(() => () => void stopSpeaking(), [id]);

  return (
    <>
      <div className="facts">
        <div className="fact"><b className="num">{i + 1}<small> of {rows.length}</small></b><span>Docking rank</span></div>
        <div className="fact"><b className="num">{st ? `${st.rankP5}–${st.rankP95}` : "–"}</b><span>Score rank, 90% of reruns</span></div>
        <div className="fact"><b className="num">{st ? pct(st.pTopN) : "–"}</b><span>Reruns in the top {stability.opts.topN}</span></div>
      </div>
      <PoseViewer bundle={bundle} drugId={id} targetId={row.bestTargetId} />
      <div className="sheet-actions">
        <Segmented label="Brief language" value={lang} options={LANGS} onChange={setLang} />
        <Pressable className="btn" disabled={!canSpeak()} onClick={() => read(id, lang)}><Icon.speaker />Read aloud</Pressable>
        <Pressable className="btn" disabled={!canSpeak()} onClick={() => stopSpeaking()}>Stop</Pressable>
      </div>
      <div ref={text.attach} className="brief" lang={lang}>
        {b.sections.map((s) => (
          <section key={s.heading}><h3>{s.heading}</h3><p>{s.text}</p></section>
        ))}
        <section lang="en">
          <h3>Details</h3>
          <p className="callout">
            {target ? `Best target: ${target.gene} (${target.name}), PDB ${target.pdbId}. ` : "No docking target. "}
            {row.unknowns.length ? `Not confirmed: ${row.unknowns.join(", ")}.` : "Every access fact was confirmed."}
          </p>
          <ul className="callout sources">
            {sources.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> <span className="footnote">accessed {s.accessed}</span></li>)}
          </ul>
        </section>
      </div>
    </>
  );
}
