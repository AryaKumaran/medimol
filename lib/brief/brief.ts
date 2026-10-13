import type { RunBundle } from "../bundle/schema";
import type { Row } from "../bundle/scoring";
import { activitySignal } from "../analysis/activity";

export type Lang = "en" | "es";
export type Brief = { title: string; sections: { heading: string; text: string }[] };

// Short sentences, ~8th-grade wording. Built only from bundle fields; nothing here is generated free text.
// Spanish strings need review by a fluent speaker before the demo.
const T = {
  en: {
    what: "What it is", why: "Why it is a candidate", access: "Can people get it?", evidence: "Other evidence",
    safety: "Safety notes", limits: "Limits",
    approvedFor: (x: string) => `It is already approved for ${x}.`,
    status: { approved: "It is an approved medicine.", investigational: "It is still being studied. It is not approved.", withdrawn: "It was withdrawn from the market.", unknown: "We could not confirm its approval status." },
    docked: (t: string, r: number, n: number) => `In our computer simulation it fit the protein ${t} well. It ranked ${r} of ${n}.`,
    noDock: "We do not have a docking result for it.",
    generic: { yes: "A cheaper generic version exists.", no: "No generic version was found.", unknown: "We do not know if a generic exists." },
    eml: { yes: "The World Health Organization lists it as an essential medicine.", no: "It is not on the WHO essential medicines list.", unknown: "We do not know if it is on the WHO essential medicines list." },
    trials: (n: number) => (n === 0 ? "We found no pancreatic cancer trials testing it." : `We found ${n} pancreatic cancer clinical trial records that mention it.`),
    noTrials: "We did not check clinical trials for it.",
    measured: (t: string, v: number) => `Lab tests in the ChEMBL database already measured it against ${t} (pChEMBL ${v}).`,
    predicted: (t: string, p: number) => `A machine learning model trained on lab data gives it a ${Math.round(p * 100)}% chance of being active against ${t}.`,
    ood: "It is too different from the lab data our model learned from, so we do not trust a model score for it.",
    none: "No machine learning result.",
    noFlags: "No safety notes are recorded here. That does not mean it is safe.",
    flags: "Research flags, not advice: ",
    limitsText: "This is a computer prediction to help researchers choose what to test in a lab. It does not prove the drug works. It is not medical advice. Do not change any treatment based on it.",
  },
  es: {
    what: "Qué es", why: "Por qué es candidato", access: "¿Se puede conseguir?", evidence: "Otra evidencia",
    safety: "Notas de seguridad", limits: "Límites",
    approvedFor: (x: string) => `Ya está aprobado para ${x}.`,
    status: { approved: "Es un medicamento aprobado.", investigational: "Todavía se está estudiando. No está aprobado.", withdrawn: "Fue retirado del mercado.", unknown: "No pudimos confirmar si está aprobado." },
    docked: (t: string, r: number, n: number) => `En nuestra simulación por computadora encajó bien en la proteína ${t}. Quedó en el puesto ${r} de ${n}.`,
    noDock: "No tenemos un resultado de acoplamiento para este medicamento.",
    generic: { yes: "Existe una versión genérica más barata.", no: "No se encontró una versión genérica.", unknown: "No sabemos si existe una versión genérica." },
    eml: { yes: "La Organización Mundial de la Salud lo incluye como medicamento esencial.", no: "No está en la lista de medicamentos esenciales de la OMS.", unknown: "No sabemos si está en la lista de medicamentos esenciales de la OMS." },
    trials: (n: number) => (n === 0 ? "No encontramos ensayos de cáncer de páncreas que lo prueben." : `Encontramos ${n} registros de ensayos clínicos de cáncer de páncreas que lo mencionan.`),
    noTrials: "No revisamos ensayos clínicos para este medicamento.",
    measured: (t: string, v: number) => `Pruebas de laboratorio en la base de datos ChEMBL ya lo midieron contra ${t} (pChEMBL ${v}).`,
    predicted: (t: string, p: number) => `Un modelo de aprendizaje automático entrenado con datos de laboratorio le da un ${Math.round(p * 100)}% de probabilidad de ser activo contra ${t}.`,
    ood: "Es muy diferente de los datos con los que aprendió el modelo, así que no confiamos en su puntuación.",
    none: "No hay resultado de aprendizaje automático.",
    noFlags: "No hay notas de seguridad registradas aquí. Eso no significa que sea seguro.",
    flags: "Alertas de investigación, no consejos: ",
    limitsText: "Esto es una predicción por computadora para ayudar a los investigadores a decidir qué probar en el laboratorio. No demuestra que el medicamento funcione. No es un consejo médico. No cambie ningún tratamiento por esto.",
  },
} as const;

export function brief(b: RunBundle, rows: Row[], drugId: string, lang: Lang = "en"): Brief {
  const t = T[lang];
  const i = rows.findIndex((r) => r.drug.id === drugId);
  const row = rows[i];
  if (!row) throw new Error(`drug not on leaderboard: ${drugId}`);
  const d = row.drug;
  const gene = (id: string | null) => b.targets.find((x) => x.id === id)?.gene ?? "?";
  const act = activitySignal(b, d.id);
  return {
    title: d.name,
    sections: [
      { heading: t.what, text: [t.status[d.approval], d.approvedFor ? t.approvedFor(d.approvedFor) : ""].filter(Boolean).join(" ") },
      { heading: t.why, text: row.bestTargetId ? t.docked(gene(row.bestTargetId), i + 1, rows.length) : t.noDock },
      {
        heading: t.access,
        text: [t.generic[d.access.generic], t.eml[d.access.whoEml], d.access.trials ? t.trials(d.access.trials.count) : t.noTrials].join(" "),
      },
      {
        heading: t.evidence,
        text:
          act.kind === "measured" ? t.measured(gene(act.targetId), act.pchembl)
          : act.kind === "predicted" ? t.predicted(gene(act.targetId), act.p)
          : act.kind === "out-of-domain" ? t.ood
          : t.none,
      },
      { heading: t.safety, text: d.safetyFlags.length ? t.flags + d.safetyFlags.join("; ") + "." : t.noFlags },
      { heading: t.limits, text: t.limitsText },
    ],
  };
}

export const briefToText = (x: Brief) => [x.title, ...x.sections.map((s) => `${s.heading}. ${s.text}`)].join("\n\n");
