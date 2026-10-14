import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { StabilityOpts } from "../../../lib/analysis/stability";
import { ACCESS_WEIGHTS } from "../../../lib/bundle/scoring";
import { Icon } from "../app/ui";
import { Fill, press, Reveal, useMedia, useMotion } from "../motion/react";

// Written by tools/capture.ts next to the loops it records.
const Manifest = z.object({ synthetic: z.boolean(), bundleId: z.string(), fps: z.number(), scenes: z.array(z.string()) });
type Manifest = z.infer<typeof Manifest>;
const LOOPS = `${import.meta.env.BASE_URL}loops/`;
const RERUNS = StabilityOpts.parse({});

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
// Redaction's cuts, cleanest to most eroded. The trust section sets one word in all of them.
const CUTS = [["", "Redaction"], ["r10", "10"], ["r20", "20"], ["r35", "35"], ["r50", "50"], ["r70", "70"], ["r100", "100"]] as const;
const two = (n: number) => String(n).padStart(2, "0");

// A link that answers the press like every button in the app.
function Cta({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  const m = useMotion();
  return <a href={href} className={className} ref={m.attach} {...press(m)}>{children}</a>;
}

// A plate: a hard rule with its number, then the claim set large, then the app showing it.
function Feature({ n, eyebrow, title, media, children }: { n: number; eyebrow: string; title: React.ReactNode; media: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section">
      <p className="rule eyebrow"><span>§{two(n)}</span><span>{eyebrow}</span><span aria-hidden="true">+</span></p>
      <Reveal inView className="feature-head">
        <h2 className="title-1">{title}</h2>
        <span className="index" aria-hidden="true">{two(n)}</span>
        <p className="lede">{children}</p>
      </Reveal>
      <Reveal inView>{media}</Reveal>
    </section>
  );
}

// One recorded loop of the real app inside a drawn window. It plays only while on screen, and not at all
// for people who asked for less motion (they get the poster and the browser's own controls).
function Loop({ name, fig, label, manifest }: { name: string; fig: number; label: string; manifest: Manifest | null }) {
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
  if (!has || !manifest) return null;
  return (
    <figure className="shot crop">
      <div className="window">
        <div className="window-bar" aria-hidden="true"><span className="lights"><i /><i /><i /></span><span>MediMol / {name}</span><span /></div>
        <video ref={ref} src={`${LOOPS}${name}.mp4`} poster={`${LOOPS}${name}.jpg`} muted loop playsInline preload="metadata" controls={calm} aria-label={label} />
        {manifest.synthetic && <p className="window-foot footnote">Recorded from the app running on synthetic demo data. Not real drugs or results.</p>}
      </div>
      <figcaption className="micro">
        <span>Fig. {two(fig)} / {name}</span>
        <span>Recorded frame by frame from the app</span>
        <span>{manifest.fps} fps · bundle {manifest.bundleId || "none"}</span>
      </figcaption>
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
        <span className="micro" aria-hidden="true">Research use only + not medical advice</span>
        <Cta href="#/app/leads" className="btn btn-primary">Open the app</Cta>
      </header>

      <main>
        <section className="hero">
          <Reveal className="hero-meta micro">
            <span>Congressional App Challenge 2026</span><span>Research preview</span><span>Pancreatic cancer</span><span>EN / ES</span>
          </Reveal>
          <Reveal delay={60}>
            <h1 className="hero-title">
              <span className="ht-a">Affordable</span>{" "}
              <span className="ht-b">medicines,</span>{" "}
              <span className="ht-row"><span className="ht-c">ranked</span>{" "}<span className="ht-d">for the lab.</span></span>
            </h1>
          </Reveal>
          <Reveal delay={140} className="hero-body">
            <div>
              <p className="lede">
                MediMol ranks drugs that are already approved and affordable as hypotheses for lab testing against pancreatic cancer, and shows how far to trust every signal.
              </p>
              <div className="cta">
                <Cta href="#/app/leads" className="btn btn-primary btn-large">Open the app</Cta>
                <Cta href="#/app/replay" className="btn btn-large">Watch a run replay</Cta>
              </div>
              <p className="footnote hero-note">Research use only. Not medical advice.</p>
            </div>
            <dl className="spec micro">
              <dt>Access weights</dt><dd>{Object.values(ACCESS_WEIGHTS).map((w) => w.toFixed(1)).join(" / ")}</dd>
              <dt>Stability reruns</dt><dd>{RERUNS.iterations.toLocaleString("en-US")}</dd>
              <dt>Seed</dt><dd>{RERUNS.seed}</dd>
              <dt>Evidence lines</dt><dd>Docking / ChEMBL</dd>
              <dt>Keys, accounts, tracking</dt><dd>None</dd>
            </dl>
          </Reveal>
          <span className="ruler" aria-hidden="true" />
          <Reveal delay={220}><Loop name="replay" fig={1} label="The app replaying a recorded docking run, then sorting the results into rank order" manifest={manifest} /></Reveal>
        </section>

        <Feature
          n={1} eyebrow="Evidence" title={<>Two kinds of <em className="f-serif">evidence,</em> side by side.</>}
          media={<Loop name="leads" fig={2} label="The leads list switching to affordable drugs, opening a drug, and throwing its panel away" manifest={manifest} />}
        >
          Physics: a docking model scores how well each drug fits a cancer protein. Lab data: a second model, trained on measured results from ChEMBL,
          gives an independent signal. MediMol never blends them into one number. When they agree, the lead is stronger.
        </Feature>

        <Feature
          n={2} eyebrow="Access" title={<><span className="f-redact">Affordable</span> comes first.</>}
          media={
            <div className="card card-pad weights">
              <p className="micro"><span>Access Score = sum of the facts that hold</span><span>Unconfirmed = 0</span></p>
              {WEIGHTS.map(([k, label], i) => (
                <div key={k} className="weight">
                  <span className="micro">W{i + 1}</span><span>{label}</span><b>{ACCESS_WEIGHTS[k].toFixed(1)}</b>
                  <span className="track"><Fill value={ACCESS_WEIGHTS[k] / 0.3} /></span>
                </div>
              ))}
            </div>
          }
        >
          A lead only helps if a lab can buy it. The Access Score is four documented weights. Anything that could not be confirmed counts as zero and is shown as unknown, never guessed.
        </Feature>

        <Feature
          n={3} eyebrow="Trust" title={<>It shows its own <span className="f-redact r100">doubt.</span></>}
          media={
            <>
              <div className="cascade" aria-hidden="true">
                {CUTS.map(([cls, cut]) => <span key={cut}><b className={cls}>doubt</b><small className="micro">{cut}</small></span>)}
              </div>
              <Loop name="stability" fig={3} label="Turning docking noise off and dragging the weight slider while each drug's rank range narrows and widens" manifest={manifest} />
            </>
          }
        >
          Docking scores are noisy and the weights are judgment calls. MediMol rebuilds the ranking {RERUNS.iterations.toLocaleString("en-US")} times with both nudged and shows how far each drug moves.
          It also reports where known binders land, good or bad.
        </Feature>

        <Feature
          n={4} eyebrow="Plain language" title={<>Readable by anyone. In two languages. <em className="f-serif">Out loud.</em></>}
          media={<Loop name="brief" fig={4} label="A drug's plain-language brief switching between English and Spanish" manifest={manifest} />}
        >
          Every lead comes with a short brief in English and Spanish and a read-aloud button. Each sentence is built from the data, nothing is free-written,
          and every unknown gets a sentence of its own.
        </Feature>

        <section className="section">
          <p className="rule eyebrow"><span>§05</span><span>Bench Companion</span><span aria-hidden="true">+</span></p>
          <Reveal inView className="feature-head">
            <h2 className="title-1">From the screen to the <span className="f-tall">bench.</span></h2>
            <span className="index" aria-hidden="true">05</span>
            <p className="lede">A small USB device shows the shortlist beside the fridge, watches storage temperature and logs what was tested. The log exports as a spreadsheet.</p>
          </Reveal>
          <p className="rule eyebrow"><span>§06</span><span>What comes next</span><span aria-hidden="true">+</span></p>
          <Reveal inView className="feature-head">
            <h2 className="title-1">Honest, <em className="f-serif">small</em> steps.</h2>
          </Reveal>
          <Reveal inView className="grid-4">
            {NEXT.map(([title, text], i) => (
              <div key={title} className="card"><span className="micro">N° {two(i + 1)}</span><b>{title}</b><p className="callout muted">{text}</p></div>
            ))}
          </Reveal>
          <Reveal inView><p className="never body"><strong>What it will never do:</strong> treat patients, give medical advice, or claim that a drug works without lab and clinical evidence.</p></Reveal>
        </section>
      </main>

      <footer className="landing-foot">
        <Cta href="#/app/leads" className="btn btn-primary btn-large">Open the app</Cta>
        <p className="footnote">Computational hypotheses for lab testing. Research use only. Not medical advice.</p>
        <div className="foot-mark" aria-hidden="true">MediMol</div>
        <p className="rule micro" aria-hidden="true"><span>Congressional App Challenge 2026</span><span /><span>Pancreatic cancer · PDAC</span></p>
      </footer>
    </>
  );
}
