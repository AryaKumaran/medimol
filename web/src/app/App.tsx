import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { rankStability } from "../../../lib/analysis/stability";
import { brief, briefToText, type Lang } from "../../../lib/brief/brief";
import { affordableLeads, leaderboard } from "../../../lib/bundle/scoring";
import { canListen, listen, speak, stopSpeaking, type Command } from "../../../lib/voice/voice";
import { loadData, type Data } from "../data";
import { Landing } from "../landing/Landing";
import { Pressable, Reveal, Segmented } from "../motion/react";
import { Sheet } from "../motion/sheet";
import { About } from "./About";
import { Bench, useBench } from "./Bench";
import { DrugPanel, Leads, type Filter } from "./Leads";
import { Replay } from "./Replay";
import { Stability, Validation } from "./Trust";
import { ApprovalChip, Icon, Popover } from "./ui";

// Sections are named for what is in them.
const TABS = [
  { value: "leads", label: "Leads" },
  { value: "replay", label: "Replay" },
  { value: "stability", label: "Stability" },
  { value: "validation", label: "Validation" },
  { value: "bench", label: "Bench" },
  { value: "about", label: "About" },
] as const;
export type Tab = (typeof TABS)[number]["value"];
export const go = (tab: Tab) => void (location.hash = `#/app/${tab}`);

const subscribeHash = (cb: () => void) => {
  addEventListener("hashchange", cb);
  return () => removeEventListener("hashchange", cb);
};

export function Root() {
  const [, section, tab] = useSyncExternalStore(subscribeHash, () => location.hash).split("/");
  useEffect(() => scrollTo(0, 0), [section]);
  if (section !== "app") return <Landing />;
  return <Shell tab={TABS.find((t) => t.value === tab)?.value ?? "leads"} />;
}

function Shell({ tab }: { tab: Tab }) {
  const [data, setData] = useState<Data | Error | null>(null);
  useEffect(() => {
    loadData().then(setData, (e: unknown) => setData(e instanceof Error ? e : new Error(String(e))));
  }, []);
  if (!data) return <p className="empty" role="status">Loading the run…</p>;
  if (data instanceof Error)
    return (
      <main className="page">
        <div className="card card-pad stack" role="alert">
          <h1 className="title-3">This run could not be loaded</h1>
          <p className="callout muted">The bundle did not pass validation, so nothing is shown rather than something wrong.</p>
          <pre className="footnote">{data.message}</pre>
        </div>
      </main>
    );
  return <Loaded data={data} tab={tab} />;
}

function Loaded({ data, tab }: { data: Data; tab: Tab }) {
  const { bundle, synthetic } = data;
  const rows = useMemo(() => leaderboard(bundle), [bundle]);
  const leads = useMemo(() => affordableLeads(rows), [rows]);
  const stability = useMemo(() => rankStability(bundle), [bundle]);
  const [lang, setLang] = useState<Lang>("en");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const bench = useBench(bundle, leads);
  const shown = filter === "affordable" ? leads : rows;

  useEffect(() => {
    document.documentElement.lang = lang;
    Object.assign(document.documentElement.dataset, { ready: "", bundle: bundle.id, synthetic: String(synthetic) });
  }, [lang]);

  // Voice commands: off until asked for, and the ask says where the audio goes.
  const [voice, setVoice] = useState<"off" | "ask" | "on">("off");
  const [help, setHelp] = useState(false);
  const [heard, setHeard] = useState("");
  const live = useRef({ shown, selected, lang });
  live.current = { shown, selected, lang };
  const read = (id: string, l: Lang) => speak(briefToText(brief(bundle, rows, id, l)), l);
  const run = (c: Command) => {
    const { shown, selected, lang } = live.current;
    const step = (by: number) => {
      const i = shown.findIndex((r) => r.drug.id === selected);
      const next = shown[i === -1 ? 0 : (i + by + shown.length) % shown.length];
      if (next) setSelected(next.drug.id);
      go("leads");
    };
    setHeard("");
    if (c.kind === "next") step(1);
    else if (c.kind === "previous") step(-1);
    else if (c.kind === "open") (setSelected(c.drugId), go("leads"));
    else if (c.kind === "affordable" || c.kind === "all") (setFilter(c.kind), go("leads"));
    else if (c.kind === "read") selected ? read(selected, lang) : setHeard("Open a drug first, then say “read”.");
    else if (c.kind === "stop") stopSpeaking();
    else if (c.kind === "tested") bench.press("tested") || setHeard("Connect the virtual Bench Companion first.");
    else if (c.kind === "help") setHelp(true);
    else setHeard(`Heard “${c.heard}”. Say “help” for the commands.`);
  };
  useEffect(() => {
    if (voice !== "on") return;
    return listen(lang, rows.map((r) => r.drug), run, (e) => {
      setHeard(`Voice stopped: ${e}`);
      if (e === "not-allowed") setVoice("off");
    });
  }, [voice, lang]);
  const popOpen = voice === "ask" || help;
  useEffect(() => {
    if (!popOpen) return;
    const away = (e: Event) => {
      if ((e.target as Element).closest?.(".pop-anchor")) return;
      setHelp(false);
      setVoice((v) => (v === "ask" ? "off" : v));
    };
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [popOpen]);

  // The panel keeps its last drug while it slides away.
  const last = useRef<string | null>(null);
  if (selected) last.current = selected;
  const lastDrug = rows.find((r) => r.drug.id === last.current)?.drug;

  return (
    <div className={synthetic ? "has-banner" : undefined}>
      <header className="toolbar">
        <a className="brand" href="#/"><Icon.mark />MediMol</a>
        <div className="toolbar-end">
          <span className="footnote heard" role="status">{heard}</span>
          <div className="pop-anchor">
            <Pressable
              className="btn btn-icon" aria-label="Voice commands" aria-pressed={voice === "on"}
              onClick={() => (voice === "on" ? (setVoice("off"), setHelp(false)) : setVoice(voice === "ask" ? "off" : "ask"))}
            >
              <Icon.mic />
            </Pressable>
            <Popover open={popOpen} label="Voice commands">
              {voice === "ask" ? (
                canListen() ? (
                  <>
                    <p className="callout">Voice commands use your browser’s speech service. In Chrome, your audio is sent to Google to be turned into text. Nothing is sent unless you turn this on.</p>
                    <div className="pop-actions">
                      <Pressable className="btn" onClick={() => setVoice("off")}>Not now</Pressable>
                      <Pressable className="btn btn-primary" onClick={() => (setVoice("on"), setHelp(true))}>Turn on</Pressable>
                    </div>
                  </>
                ) : (
                  <p className="callout">This browser has no speech recognition, so voice commands are unavailable. Read-aloud still works.</p>
                )
              ) : (
                <>
                  <p className="callout">Listening. Say one of:</p>
                  <p className="callout"><kbd>next</kbd> <kbd>previous</kbd> <kbd>open</kbd> + a drug name <kbd>read</kbd> <kbd>stop</kbd> <kbd>affordable</kbd> <kbd>show all</kbd> <kbd>mark tested</kbd> <kbd>help</kbd></p>
                  <div className="pop-actions"><Pressable className="btn" onClick={() => setHelp(false)}>Done</Pressable></div>
                </>
              )}
            </Popover>
          </div>
        </div>
      </header>
      {/* Outside the bar on purpose: a blurred bar would trap a fixed child, and on phones this sits at the bottom. */}
      <nav className="nav" aria-label="Sections">
        <Segmented className="seg-nav" label="Section" value={tab} options={TABS} onChange={go} />
      </nav>

      {synthetic && (
        <div className="banner" role="note">
          <strong>SYNTHETIC DEMO DATA</strong>
          <span>Not real drugs. Not real results.</span>
        </div>
      )}

      <main>
        <Reveal key={tab}>
          {tab === "leads" && <Leads data={data} rows={rows} leads={leads} filter={filter} setFilter={setFilter} selected={selected} select={setSelected} />}
          {tab === "replay" && <Replay data={data} />}
          {tab === "stability" && <Stability data={data} />}
          {tab === "validation" && <Validation data={data} />}
          {tab === "bench" && <Bench data={data} leads={leads} bench={bench} />}
          {tab === "about" && <About data={data} />}
        </Reveal>
      </main>
      <p className="foot footnote rides">Computational hypotheses for lab testing. Research use only. Not medical advice.</p>

      <Sheet
        open={tab === "leads" && selected !== null} onClose={() => setSelected(null)} label="Drug details"
        header={
          <>
            <div className="stack-tight">
              <h2 className="title-3">{lastDrug?.name}</h2>
              {lastDrug && <ApprovalChip approval={lastDrug.approval} />}
            </div>
            <Pressable className="btn btn-icon" aria-label="Close" onClick={() => setSelected(null)}><Icon.close /></Pressable>
          </>
        }
      >
        {last.current && <DrugPanel data={data} rows={rows} stability={stability} id={last.current} lang={lang} setLang={setLang} read={read} />}
      </Sheet>
    </div>
  );
}
