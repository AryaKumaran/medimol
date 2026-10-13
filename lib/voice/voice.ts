import type { Lang } from "../brief/brief";

// Read-aloud uses the browser's built-in speechSynthesis: no keys, and the OS voices work offline.
// Voice commands use SpeechRecognition (Chrome/Edge/Safari). Chrome sends the audio to Google for
// transcription, so commands are opt-in, and the About page must say so.

export type Command =
  | { kind: "next" } | { kind: "previous" } | { kind: "read" } | { kind: "stop" }
  | { kind: "affordable" } | { kind: "all" } | { kind: "tested" } | { kind: "help" }
  | { kind: "open"; drugId: string }
  | { kind: "unknown"; heard: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Order matters: "mark tested" must win over a drug-name match; "stop" over "read".
const WORDS: [Command["kind"], string[]][] = [
  ["stop", ["stop", "quiet", "para", "detente", "silencio"]],
  ["tested", ["mark tested", "tested", "marcar probado", "probado"]],
  ["affordable", ["affordable", "cheap", "asequible", "asequibles", "baratos"]],
  ["all", ["show all", "all drugs", "todos"]],
  ["next", ["next", "siguiente"]],
  ["previous", ["previous", "back", "anterior", "atras"]],
  ["read", ["read", "leer", "lee"]],
  ["help", ["help", "ayuda"]],
];

const hasPhrase = (text: string, p: string) => ` ${text} `.includes(` ${p} `);

export function parseCommand(transcript: string, drugs: { id: string; name: string }[]): Command {
  const t = norm(transcript);
  // Drug names first only when the user says "open/show/abrir X"; longest name wins (e.g. "aspirin c" vs "aspirin").
  if (/^(open|show|abrir|abre|mostrar|muestra)\b/.test(t)) {
    const hit = drugs.filter((d) => hasPhrase(t, norm(d.name))).sort((a, b) => b.name.length - a.name.length)[0];
    if (hit) return { kind: "open", drugId: hit.id };
  }
  for (const [kind, ps] of WORDS) if (ps.some((p) => hasPhrase(t, p))) return { kind } as Command;
  return { kind: "unknown", heard: transcript };
}

const BCP47: Record<Lang, string> = { en: "en-US", es: "es-US" };

export const canSpeak = () => typeof speechSynthesis !== "undefined";

export function speak(text: string, lang: Lang, rate = 0.95): void {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  // Chrome cuts long utterances (~15s); speak paragraph by paragraph.
  for (const part of text.split(/\n\n+/)) {
    const u = new SpeechSynthesisUtterance(part);
    u.lang = BCP47[lang];
    u.rate = rate;
    const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith(lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
}
export const stopSpeaking = () => canSpeak() && speechSynthesis.cancel();

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
};
const Ctor = () => {
  const g = globalThis as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
};
export const canListen = () => !!Ctor();

// Returns a stop function. Every final phrase goes through parseCommand.
export function listen(
  lang: Lang,
  drugs: { id: string; name: string }[],
  onCommand: (c: Command) => void,
  onError: (e: string) => void = () => {},
): () => void {
  const C = Ctor();
  if (!C) { onError("Voice commands are not supported in this browser."); return () => {}; }
  const r = new C();
  r.lang = BCP47[lang];
  r.continuous = true;
  r.interimResults = false;
  let on = true;
  r.onresult = (e) => {
    const last = e.results[e.results.length - 1];
    if (last?.isFinal && last[0]) onCommand(parseCommand(last[0].transcript, drugs));
  };
  r.onerror = (e) => { if (e.error === "not-allowed") on = false; onError(e.error); };
  r.onend = () => { if (on) r.start(); }; // Chrome stops after silence; keep listening until told not to
  r.start();
  return () => { on = false; r.stop(); };
}
