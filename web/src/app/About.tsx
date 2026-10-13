import { Fragment } from "react";
import { ACCESS_WEIGHTS } from "../../../lib/bundle/scoring";
import type { Data } from "../data";

const WEIGHT_LABEL: Record<keyof typeof ACCESS_WEIGHTS, string> = {
  approved: "Approved medicine", generic: "Generic available", whoEml: "On the WHO essential medicines list", trials: "Has pancreatic cancer trial records",
};

export function About({ data }: { data: Data }) {
  const { bundle: b, synthetic } = data;
  const p = b.provenance;
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="title-2">About</h1>
          <p className="callout muted">What MediMol is, where every number comes from, and what it must never be used for.</p>
        </div>
      </header>

      <div className="stack">
        <section className="card card-pad prose">
          <h2 className="headline">What this is</h2>
          <p className="body">
            MediMol ranks drugs that are already approved and affordable as hypotheses for lab testing against pancreatic cancer. It uses two kinds of
            evidence, docking and measured lab data, and shows how far to trust each one.
          </p>
          <p className="body"><strong>It is a research tool.</strong> A high rank does not prove a drug works. It is not medical advice. Do not change any treatment based on it.</p>
          {synthetic && <p className="note callout"><strong>You are looking at synthetic demo data.</strong> The compounds, targets and scores are placeholders made by a seeded random generator. No real bundle has been added to this build.</p>}
        </section>

        <div className="cols">
          <section className="card card-pad stack">
            <h2 className="headline">This run</h2>
            <dl className="kv">
              <dt>Title</dt><dd>{b.title}</dd>
              <dt>Bundle</dt><dd>{b.id}</dd>
              <dt>Run date</dt><dd>{p.runDate}</dd>
              <dt>Model</dt><dd>{p.model} {p.modelVersion}</dd>
              <dt>Compute</dt><dd>{p.compute}</dd>
              <dt>Built</dt><dd>{p.builtAt} by {p.builder}</dd>
              <dt>Notes</dt><dd>{p.notes || "None"}</dd>
            </dl>
          </section>
          <section className="card card-pad stack">
            <h2 className="headline">Access Score</h2>
            <dl className="kv kv-wide">
              {(Object.keys(ACCESS_WEIGHTS) as (keyof typeof ACCESS_WEIGHTS)[]).map((k) => (
                <Fragment key={k}><dt>{WEIGHT_LABEL[k]}</dt><dd className="num">{ACCESS_WEIGHTS[k].toFixed(1)}</dd></Fragment>
              ))}
            </dl>
            <p className="footnote">The weights are a judgment call, which is why the Stability section varies them. A fact we could not confirm counts as 0 and is shown as unknown.</p>
          </section>
        </div>

        <section className="card card-pad stack">
          <h2 className="headline">Targets</h2>
          <table className="table">
            <thead><tr><th>Gene</th><th>Protein</th><th>PDB</th><th>Why it matters</th></tr></thead>
            <tbody>{b.targets.map((t) => <tr key={t.id}><td>{t.gene}</td><td>{t.name}</td><td>{t.pdbId}</td><td>{t.role || "–"}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="card card-pad stack">
          <h2 className="headline">Lab-data models</h2>
          {b.models.length ? (
            <table className="table">
              <thead><tr><th>Target</th><th>ChEMBL</th><th>Model</th><th className="num">Compounds</th><th className="num">ROC-AUC</th><th className="num">PR-AUC</th></tr></thead>
              <tbody>
                {b.models.map((m) => (
                  <tr key={m.targetId}>
                    <td>{b.targets.find((t) => t.id === m.targetId)?.gene ?? m.targetId}</td><td>{m.chemblId}</td><td>{m.model}, {m.metrics?.split ?? "not trained"} split</td>
                    <td className="num">{m.nCompounds.toLocaleString()}</td><td className="num">{m.metrics?.rocAuc?.toFixed(2) ?? "–"}</td><td className="num">{m.metrics?.prAuc?.toFixed(2) ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="callout muted">This run has no lab-data model.</p>
          )}
          <p className="footnote">
            Active means pChEMBL ≥ {b.models[0]?.activeCutoffPchembl ?? 6}. A drug too unlike the training molecules gets “too different” instead of a number, and a drug
            already measured shows the measurement instead of a prediction. Bioactivity data: ChEMBL (EMBL-EBI), CC BY-SA 3.0.
          </p>
        </section>

        <section className="card card-pad stack">
          <h2 className="headline">Sources</h2>
          <table className="table">
            <thead><tr><th>Source</th><th>Accessed</th></tr></thead>
            <tbody>{b.sources.map((s) => <tr key={s.id}><td><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></td><td className="num">{s.accessed}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="card card-pad prose">
          <h2 className="headline">Voice and privacy</h2>
          <p className="callout">Read-aloud uses the voices built into your device and works offline. Voice commands are off until you turn them on, because Chrome sends the audio to Google to turn it into text. The app itself uses no accounts, no keys and no tracking.</p>
        </section>
      </div>
    </div>
  );
}
