import { z } from "zod";

// Every external claim in the bundle points at one of these by id.
export const Source = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url(),
  accessed: z.string().date(),
});

const Tri = z.enum(["yes", "no", "unknown"]);

export const Target = z.object({
  id: z.string().min(1),
  gene: z.string().min(1),
  name: z.string().min(1),
  pdbId: z.string().regex(/^[0-9][A-Za-z0-9]{3}$/, "PDB IDs are 4 chars starting with a digit"),
  role: z.string(), // why this protein matters in the cancer, plain language
  sourceIds: z.array(z.string()).min(1),
});

export const Access = z.object({
  generic: Tri, // FDA Orange Book
  whoEml: Tri, // WHO Essential Medicines List
  costTier: z.enum(["generic", "brand-only", "unknown"]),
  trials: z
    .object({ count: z.number().int().nonnegative(), query: z.string(), fetchedAt: z.string() })
    .nullable(), // ClinicalTrials.gov v2, cached at build time
  sourceIds: z.array(z.string()),
});

export const Drug = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  drugbankId: z.string().nullable(),
  smiles: z.string().nullable(),
  approval: z.enum(["approved", "investigational", "withdrawn", "unknown"]),
  approvedFor: z.string().nullable(),
  positiveControl: z.boolean(), // known literature binder, used for validation only
  safetyFlags: z.array(z.string()), // "research flags, not advice"
  storage: z.string().nullable(), // shown on the Bench Companion OLED
  access: Access,
});

export const Pose = z.object({
  drugId: z.string(),
  targetId: z.string(),
  rank: z.number().int().positive(), // DiffDock pose rank (1 = top)
  confidence: z.number(), // DiffDock confidence; higher is better, NOT a binding affinity
  sdf: z.string().nullable(), // path relative to the bundle, or null if not exported
});

// Per-target activity model trained on ChEMBL (tools/train_activity_model.py). A second, independent signal.
export const Prediction = z.object({
  p: z.number().min(0).max(1).nullable(), // P(active, pChEMBL >= cutoff); null = SMILES unparseable
  maxSim: z.number().min(0).max(1).nullable(), // nearest training molecule, Tanimoto
  inDomain: z.boolean(),
  inTraining: z.boolean(), // already measured: show measuredPchembl, the model only memorized it
  measuredPchembl: z.number().nullable(),
});
export const ActivityModel = z.object({
  targetId: z.string(),
  chemblId: z.string().regex(/^CHEMBL\d+$/),
  fetchedAt: z.string().date(),
  model: z.string(),
  activeCutoffPchembl: z.number(),
  nCompounds: z.number().int().nonnegative(),
  metrics: z
    .object({
      split: z.string(),
      nTrain: z.number().int(),
      nTest: z.number().int(),
      positiveRate: z.number(),
      rocAuc: z.number().nullable(),
      prAuc: z.number().nullable(),
    })
    .nullable(), // null = not enough data to train; predictions will be empty
  predictions: z.record(z.string(), Prediction),
});

export const RunBundle = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    title: z.string(),
    provenance: z.object({
      runDate: z.string().date(),
      model: z.string(),
      modelVersion: z.string(),
      compute: z.string(),
      builtAt: z.string(),
      builder: z.string(),
      notes: z.string(),
    }),
    sources: z.array(Source),
    targets: z.array(Target).min(1),
    drugs: z.array(Drug).min(1),
    poses: z.array(Pose),
    models: z.array(ActivityModel).default([]),
  })
  .superRefine((b, ctx) => {
    const src = new Set(b.sources.map((s) => s.id));
    const drugs = new Set(b.drugs.map((d) => d.id));
    const targets = new Set(b.targets.map((t) => t.id));
    const refs = [...b.targets.flatMap((t) => t.sourceIds), ...b.drugs.flatMap((d) => d.access.sourceIds)];
    for (const id of refs) if (!src.has(id)) ctx.addIssue({ code: "custom", message: `unknown source id: ${id}` });
    for (const m of b.models) {
      if (!targets.has(m.targetId)) ctx.addIssue({ code: "custom", message: `model for unknown target: ${m.targetId}` });
      for (const id of Object.keys(m.predictions))
        if (!drugs.has(id)) ctx.addIssue({ code: "custom", message: `prediction for unknown drug: ${id}` });
    }
    for (const p of b.poses) {
      if (!drugs.has(p.drugId)) ctx.addIssue({ code: "custom", message: `pose for unknown drug: ${p.drugId}` });
      if (!targets.has(p.targetId)) ctx.addIssue({ code: "custom", message: `pose for unknown target: ${p.targetId}` });
    }
  });

export type RunBundle = z.infer<typeof RunBundle>;
export type Drug = z.infer<typeof Drug>;
export type Target = z.infer<typeof Target>;
export type Pose = z.infer<typeof Pose>;
export type ActivityModel = z.infer<typeof ActivityModel>;

export async function loadBundle(url: string): Promise<RunBundle> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`bundle fetch failed: ${res.status}`);
  return RunBundle.parse(await res.json());
}
