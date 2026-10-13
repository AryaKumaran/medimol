import { useEffect, useRef, useState } from "react";
import { poseAssets } from "../../../lib/bundle/pose";
import type { RunBundle } from "../../../lib/bundle/schema";
import { signed } from "./ui";

// Minimal typing for the parts of 3Dmol.js we call. The library is vendored in public/vendor so the demo works offline.
type Sel = Record<string, unknown>;
type Atom = { x: number; y: number; z: number; chain: string; resi: number; hetflag: boolean };
type Model = { selectedAtoms(sel: Sel): Atom[] };
type Viewer = {
  addModel(data: string, format: "pdb" | "sdf"): Model;
  setStyle(sel: Sel, style: Sel): void;
  addStyle(sel: Sel, style: Sel): void;
  zoomTo(sel?: Sel): void;
  zoom(factor: number): void;
  render(): void;
  resize(): void;
  clear(): void;
};
type Lib = { createViewer(el: HTMLElement, opts: Sel): Viewer };

let lib: Promise<Lib> | null = null;
function load3Dmol(): Promise<Lib> {
  return (lib ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${import.meta.env.BASE_URL}vendor/3Dmol-min.js`;
    s.onload = () => {
      const g = (window as unknown as { $3Dmol?: Lib }).$3Dmol;
      g ? resolve(g) : reject(new Error("3Dmol did not load"));
    };
    s.onerror = () => { lib = null; reject(new Error("could not load the 3D viewer")); };
    document.head.append(s);
  }));
}

const fetchText = async (path: string) => {
  const r = await fetch(`${import.meta.env.BASE_URL}bundles/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.text();
};

// Residues with any atom within 5 Å of any ligand atom: the pocket the pose sits in. O(lig × rec), fine for one pose.
function pocket(lig: Atom[], rec: Atom[], cutoff = 5): [string, number[]][] {
  const c2 = cutoff * cutoff;
  const hit = new Map<string, Set<number>>();
  for (const a of rec)
    if (lig.some((l) => (a.x - l.x) ** 2 + (a.y - l.y) ** 2 + (a.z - l.z) ** 2 <= c2))
      (hit.get(a.chain) ?? hit.set(a.chain, new Set()).get(a.chain)!).add(a.resi);
  return [...hit].map(([chain, r]) => [chain, [...r]]);
}

type State = { kind: "loading" } | { kind: "ready"; withReceptor: boolean } | { kind: "missing" } | { kind: "error"; message: string };

export function PoseViewer({ bundle, drugId, targetId }: { bundle: RunBundle; drugId: string; targetId: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const assets = targetId ? poseAssets(bundle, drugId, targetId) : null;
  const [state, setState] = useState<State>({ kind: "loading" });
  const view = useRef<Viewer | null>(null);

  useEffect(() => {
    if (!assets?.sdf) {
      setState({ kind: "missing" });
      return;
    }
    let viewer: Viewer | null = null;
    let live = true;
    setState({ kind: "loading" });
    (async () => {
      const [$3Dmol, sdf, pdb] = await Promise.all([load3Dmol(), fetchText(assets.sdf!), assets.pdb ? fetchText(assets.pdb) : null]);
      if (!live || !host.current) return;
      viewer = view.current = $3Dmol.createViewer(host.current, { backgroundColor: "white", backgroundAlpha: 0 });
      const lig = viewer.addModel(sdf, "sdf");
      if (pdb) {
        const rec = viewer.addModel(pdb, "pdb");
        viewer.setStyle({ model: rec }, { cartoon: { color: "#c7c7cc", opacity: 0.8 } });
        viewer.setStyle({ model: rec, hetflag: true }, {}); // waters and crystal ligands left in the receptor file would clutter the pose
        for (const [chain, resi] of pocket(lig.selectedAtoms({}), rec.selectedAtoms({ hetflag: false })))
          viewer.addStyle({ model: rec, chain, resi }, { stick: { colorscheme: "whiteCarbon", radius: 0.12 } });
      }
      viewer.setStyle({ model: lig }, { stick: { colorscheme: "greenCarbon", radius: 0.22 } });
      viewer.zoomTo({ model: lig });
      viewer.zoom(0.6); // pull back so the surrounding pocket is visible
      viewer.render();
      setState({ kind: "ready", withReceptor: !!pdb });
    })().catch((e: unknown) => live && setState({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
      viewer?.clear();
      view.current = null;
      if (host.current) host.current.innerHTML = "";
    };
  }, [assets?.sdf, assets?.pdb]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => view.current?.resize()); // the inspector sheet animates its width
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <section className="pose" aria-label="Predicted binding pose">
      <div ref={host} className="pose-canvas" role="img" aria-label={assets ? `3D model of the predicted pose in PDB ${assets.pdbId}` : "No pose"} />
      {state.kind !== "ready" && (
        <p className="pose-empty callout muted">
          {state.kind === "loading" && "Loading 3D pose…"}
          {state.kind === "missing" && "No pose file in this bundle. Real runs ship one per drug from DiffDock."}
          {state.kind === "error" && `Could not show the pose (${state.message}).`}
        </p>
      )}
      {assets && (
        <p className="footnote">
          Predicted pose: DiffDock rank 1 in PDB {assets.pdbId}, confidence {signed(assets.confidence)}.
          {state.kind === "ready" && !state.withReceptor && " Receptor file not shipped, so the drug is shown alone."}
          {" "}A computer prediction, not an experimental structure. Drag to rotate, scroll to zoom.
        </p>
      )}
    </section>
  );
}
