import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { ACCESS_WEIGHTS } from "../../../lib/bundle/scoring";
import { Icon } from "../app/ui";
import { Fill, press, Reveal, useMedia, useMotion } from "../motion/react";

// Written by tools/capture.ts next to the loops it records.
const Manifest = z.object({ synthetic: z.boolean(), bundleId: z.string(), fps: z.number(), scenes: z.array(z.string()) });
type Manifest = z.infer<typeof Manifest>;
const LOOPS = `${import.meta.env.BASE_URL}loops/`;

const WEIGHTS: [keyof typeof ACCESS_WEIGHTS, string][] = [
  ["approved", "Already an approved medicine"], ["generic", "A generic version exists"],
  ["whoEml", "On the WHO essential medicines list"], ["trials", "Has pancreatic cancer trial records"],
];
const NEXT = [
  ["More cancers", "The bundle format is cancer-agnostic. A new target list and a new curation sheet give a new run."],
  ["Close the loop", "Wet-lab results logged by the Bench Companion flow back as measured labels, and the next model learns from them."],
  ["Open shortlists", "Each versioned bundle is published, so any student lab can reproduce it and extend it."],
  ["Access, country by country", "National essential-medicines lists beyond the WHO's show where a drug can actually be obtained."],
] as const;

// A link that answers the press like every button in the app.
function Cta({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  const m = useMotion();
  return <a href={href} className={className} ref={m.attach} {...press(m)}>{children}</a>;
}

// A claim, then the app showing it. The loop gets the full width so the interface in it stays readable.
function Feature({ eyebrow, title, media, children }: { eyebrow: string; title: string; media: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section">
      <Reveal inView className="section-head">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="title-1">{title}</h2>
        <p className="lede">{children}</p>
      </Reveal>
      <Reveal inView>{media}</Reveal>
    </section>
  );
}

// One recorded loop of the real app inside a drawn window. It plays only while on screen, and not at all
// for people who asked for less motion (they get the poster and the browser's own controls).
function Loop({ name, label, manifest }: { name: string; label: string; manifest: Manifest | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const calm = useMedia("(prefers-reduced-motion: reduce)");
  const has = manifest?.scenes.includes(name);
  useEffect(() => {
    const v = ref.current;
    if (!v || calm) return;
    const io = new IntersectionObserver(([e]) => (e?.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, [calm, has]);
  if (!has) return null;
  return (
    <figure className="window">
      <div className="window-bar" aria-hidden="true"><span className="lights"><i /><i /><i /></span><span>MediMol</span><span /></div>
      <video ref={ref} src={`${LOOPS}${name}.mp4`} poster={`${LOOPS}${name}.jpg`} muted loop playsInline preload="metadata" controls={calm} aria-label={label} />
      {manifest?.synthetic && <figcaption className="window-foot footnote">Recorded from the app running on synthetic demo data. Not real drugs or results.</figcaption>}
    </figure>
  );
}

export function Landing() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  useEffect(() => {
    fetch(`${LOOPS}manifest.json`).then((r) => (r.ok ? r.json() : null)).then((j) => setManifest(Manifest.safeParse(j).data ?? null), () => {});
    document.documentElement.dataset.ready = "";
  }, []);

  return (
    <>
      <header className="landing-nav">
        <a className="brand" href="#/"><Icon.mark />MediMol</a>
        <Cta href="#/app/leads" className="btn btn-primary">Open the app</Cta>
      </header>

      <main>
        <section className="hero">
          <Reveal><p className="eyebrow">Congressional App Challenge 2026 · Research preview</p></Reveal>
          <Reveal delay={60}><h1 className="display">Affordable medicines, ranked for the lab.</h1></Reveal>
          <Reveal delay={120}>
            <p className="lede">
              MediMol ranks drugs that are already approved and affordable as hypotheses for lab testing against pancreatic cancer, and shows how far to trust every signal.
            </p>
          </Reveal>
          <Reveal delay={180} className="cta">
            <Cta href="#/app/leads" className="btn btn-primary btn-large">Open the app</Cta>
            <Cta href="#/app/replay" className="btn btn-large">Watch a run replay</Cta>
          </Reveal>
          <Reveal delay={240}><p className="footnote hero-note">Research use only. Not medical advice.</p></Reveal>
          <Reveal delay={300}><Loop name="replay" label="The app replaying a recorded docking run, then sorting the results into rank order" manifest={manifest} /></Reveal>
        </section>

        <Feature eyebrow="Evidence" title="Two kinds of evidence, side by side." media={<Loop name="leads" label="The leads list switching to affordable drugs, opening a drug, and throwing its panel away" manifest={manifest} />}>
          Physics: a docking model scores how well each drug fits a cancer protein. Lab data: a second model, trained on measured results from ChEMBL,
          gives an independent signal. MediMol never blends them into one number. When they agree, the lead is stronger.
        </Feature>

        <Feature
          eyebrow="Access" title="Affordable comes first."
          media={
            <div className="card card-pad weights">
              {WEIGHTS.map(([k, label]) => (
                <div key={k} className="weight">
                  <span>{label}</span><span className="cell-num">{ACCESS_WEIGHTS[k].toFixed(1)}</span>
                  <span className="track"><Fill value={ACCESS_WEIGHTS[k] / 0.3} /></span>
                </div>
              ))}
            </div>
          }
        >
          A lead only helps if a lab can buy it. The Access Score is four documented weights. Anything that could not be confirmed counts as zero and is shown as unknown, never guessed.
        </Feature>

        <Feature eyebrow="Trust" title="It shows its own doubt." media={<Loop name="stability" label="Turning docking noise off and dragging the weight slider while each drug's rank range narrows and widens" manifest={manifest} />}>
          Docking scores are noisy and the weights are judgment calls. MediMol rebuilds the ranking 2,000 times with both nudged and shows how far each drug moves.
          It also reports where known binders land, good or bad.
        </Feature>

        <Feature eyebrow="Plain language" title="Readable by anyone. In two languages. Out loud." media={<Loop name="brief" label="A drug's plain-language brief switching between English and Spanish" manifest={manifest} />}>
          Every lead comes with a short brief in English and Spanish and a read-aloud button. Each sentence is built from the data, nothing is free-written,
          and every unknown gets a sentence of its own.
        </Feature>

        <section className="section">
          <Reveal inView className="section-head">
            <p className="eyebrow">Bench Companion</p>
            <h2 className="title-1">From the screen to the bench.</h2>
            <p className="lede">A small USB device shows the shortlist beside the fridge, watches storage temperature and logs what was tested. The log exports as a spreadsheet.</p>
          </Reveal>
          <Reveal inView className="section-head">
            <p className="eyebrow">What comes next</p>
            <h2 className="title-1">Honest, small steps.</h2>
          </Reveal>
          <Reveal inView className="grid-4">
            {NEXT.map(([title, text]) => <div key={title} className="card"><b>{title}</b><p className="callout muted">{text}</p></div>)}
          </Reveal>
          <Reveal inView><p className="card never body"><strong>What it will never do:</strong> treat patients, give medical advice, or claim that a drug works without lab and clinical evidence.</p></Reveal>
        </section>
      </main>

      <footer className="landing-foot">
        <Cta href="#/app/leads" className="btn btn-primary btn-large">Open the app</Cta>
        <p className="footnote">Computational hypotheses for lab testing. Research use only. Not medical advice.</p>
      </footer>
    </>
  );
}
