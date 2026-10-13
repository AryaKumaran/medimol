#!/usr/bin/env python3
"""Ligand-based repurposing screen: every approved small-molecule drug in ChEMBL, scored by per-target
activity models trained on ChEMBL measurements for KRAS-pathway proteins. Independent of docking.

  .venv/bin/python tools/screen_approved.py            # writes data/curation/screen.json
  .venv/bin/python tools/screen_approved.py --selftest

Per target: train (scaffold split + 5-fold scaffold CV model comparison), then for each approved drug report
  measured   it already has a ChEMBL measurement on this target (strongest evidence; no prediction needed)
  predicted  model probability, only when the drug is inside the applicability domain (Tanimoto >= 0.3)
Out-of-domain drugs are counted, never ranked. Top hits get the same access lookups as the docked set
(Orange Book / openFDA NDC, WHO eEML, ClinicalTrials.gov), so the screen's leads are also ranked by access.
Research use only: a model score is a hypothesis for lab testing, not evidence a drug works.
"""
import argparse, json, sys

import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_public_data as fpd  # noqa: E402  (shared cached HTTP + access lookups)
import train_activity_model as tam  # noqa: E402

CUR = fpd.CUR
# UniProt accessions; roles are functional facts from UniProt, not efficacy claims.
TARGETS = [
    ("kras", "KRAS", "P01116", "Small GTPase mutated in most pancreatic cancers; the pathway's on-switch."),
    ("mapk1", "MAPK1 (ERK2)", "P28482", "Kinase at the end of the KRAS→RAF→MEK→ERK signaling chain."),
    ("map2k1", "MAP2K1 (MEK1)", "Q02750", "Kinase that activates ERK; target of approved MEK inhibitors."),
    ("sos1", "SOS1", "Q07889", "Exchange factor that switches KRAS on."),
    ("ptpn11", "PTPN11 (SHP2)", "Q06124", "Phosphatase that relays growth-factor signals to KRAS."),
]
TOP_N = 15


def approved_drugs() -> list:
    """All ChEMBL max_phase 4 small molecules with a structure, parents only (salts collapse to the parent)."""
    out, url = [], "https://www.ebi.ac.uk/chembl/api/data/molecule.json?max_phase=4&molecule_type=Small%20molecule&limit=1000"
    while url:
        d, _ = fpd.get(url)
        for m in d["molecules"]:
            st = m.get("molecule_structures") or {}
            parent = (m.get("molecule_hierarchy") or {}).get("parent_chembl_id")
            if st.get("canonical_smiles") and m.get("pref_name") and parent in (None, m["molecule_chembl_id"]):
                out.append({"chemblId": m["molecule_chembl_id"], "name": m["pref_name"], "smiles": st["canonical_smiles"],
                            "withdrawn": bool(m.get("withdrawn_flag"))})
        nxt = d["page_meta"]["next"]
        url = "https://www.ebi.ac.uk" + nxt if nxt else None
    return out


def target_activities(chembl_id: str) -> list:
    """ChEMBL activities with pChEMBL, cached through fpd.get (same data train_activity_model uses)."""
    acts, url = [], (f"https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id={chembl_id}"
                     "&standard_type__in=IC50,Ki,Kd,EC50&pchembl_value__isnull=false&limit=1000")
    while url:
        d, _ = fpd.get(url)
        acts += [{"smiles": a["canonical_smiles"], "pchembl": float(a["pchembl_value"]), "molecule": a["molecule_chembl_id"]}
                 for a in d["activities"] if a.get("canonical_smiles") and a.get("pchembl_value")]
        nxt = d["page_meta"]["next"]
        url = "https://www.ebi.ac.uk" + nxt if nxt else None
    return acts


def measured_by_molecule(acts: list) -> dict:
    """Best pChEMBL per ChEMBL molecule id."""
    best = {}
    for a in acts:
        best[a["molecule"]] = max(best.get(a["molecule"], -1.0), a["pchembl"])
    return best


def canonical(smiles: str):
    """Canonical SMILES without stereo: Morgan fingerprints ignore stereo, so a stereo-only difference
    (e.g. meso-succimer vs the undefined form ChEMBL measured) is the same compound for this model."""
    m = tam.Chem.MolFromSmiles(smiles)
    return tam.Chem.MolToSmiles(m, isomericSmiles=False) if m else None


def rank_hits(rows: list, top_n: int) -> list:
    """Measured actives first (by pChEMBL), then in-domain predictions by probability. Out-of-domain never ranked."""
    measured = sorted((r for r in rows if r["kind"] == "measured" and r["pchembl"] >= tam.ACTIVE_PCHEMBL), key=lambda r: -r["pchembl"])
    predicted = sorted((r for r in rows if r["kind"] == "predicted"), key=lambda r: -r["p"])
    return (measured + predicted)[:top_n]


def _try(fn, default):
    """A source that keeps failing (e.g. openFDA 500s on odd names) yields 'unknown', never a crash or a guess."""
    try:
        return fn()
    except (fpd.urllib.error.URLError, TimeoutError, KeyError, ValueError) as e:
        print(f"    lookup failed ({e}); recorded as unknown", file=sys.stderr)
        return default


def access_for(name: str, ob_rows: list) -> dict:
    """Same access facts as the docked set, for one approved drug name."""
    names = [name.upper()]
    generic = fpd.orange_book_generic(ob_rows, names)
    if generic != "yes":
        ndc = _try(lambda: fpd.ndc_products(names[0])[0], None)
        if ndc is None:
            generic = "unknown" if generic == "no" else generic  # NDC check impossible: do not claim brand-only
        elif fpd.ndc_open_market(ndc, names):
            generic = "yes"
    eml = _try(lambda: fpd.who_eml([name.title()])[0], "unknown")
    tr = _try(lambda: fpd.trials(name), None)
    lab = _try(lambda: fpd.openfda_label(names)[0], None)
    flag = f"FDA boxed warning: {fpd.boxed_topic(' '.join(lab['boxed_warning']))}" if lab and lab.get("boxed_warning") else None
    return {"generic": generic, "whoEml": eml,
            "trials": {"count": tr[0], "query": tr[1], "fetchedAt": tr[2]} if tr else None, "boxedWarning": flag}


def run() -> None:
    drugs = approved_drugs()
    print(f"{len(drugs)} approved small-molecule parents with structures", file=sys.stderr)
    fps = [tam.fp(d["smiles"]) for d in drugs]
    keep = [i for i, f in enumerate(fps) if f is not None]
    ob_rows, _, ob_f = fpd.orange_book()
    out = {"generatedAt": fpd.TODAY, "approvedDrugs": len(keep), "activeCutoffPchembl": tam.ACTIVE_PCHEMBL,
           "adMinSim": tam.AD_MIN_SIM, "targets": []}
    access_cache = {}
    for tid, gene, uniprot, role in TARGETS:
        chembl_id, _, _ = fpd.chembl_target_id(uniprot)
        acts = target_activities(chembl_id)
        labels = tam.dedupe(acts)
        res = tam.train_eval(labels, cv=True)
        entry = {"targetId": tid, "gene": gene, "uniprot": uniprot, "chemblId": chembl_id, "role": role,
                 "nCompounds": len(labels), "metrics": None, "hits": [], "counts": {}}
        if res is None:
            print(f"{gene}: not enough data ({len(labels)})", file=sys.stderr)
            out["targets"].append(entry)
            continue
        clf, train_fps, entry["metrics"] = res
        measured = measured_by_molecule(acts)
        flat = {}
        for smi, v in labels.items():  # stereo-free index of measured structures, best value per structure
            c = canonical(smi)
            flat[c] = max(flat.get(c, -1.0), v)
        X = np.array([list(fps[i]) for i in keep], dtype=np.uint8)
        probs = clf.predict_proba(X)[:, 1]
        rows = []
        for k, i in enumerate(keep):
            d = drugs[i]
            if d["chemblId"] in measured:
                rows.append({**d, "kind": "measured", "pchembl": measured[d["chemblId"]]})
                continue
            can = canonical(d["smiles"])
            if can in flat:  # same structure measured under another ChEMBL id (salt/duplicate record): a measurement, not a prediction
                rows.append({**d, "kind": "measured", "pchembl": flat[can]})
                continue
            sim = max(tam.DataStructs.BulkTanimotoSimilarity(fps[i], train_fps))
            if sim >= tam.AD_MIN_SIM:
                rows.append({**d, "kind": "predicted", "p": round(float(probs[k]), 3), "maxSim": round(float(sim), 3)})
            else:
                rows.append({**d, "kind": "out-of-domain"})
        entry["counts"] = {k: sum(r["kind"] == k for r in rows) for k in ("measured", "predicted", "out-of-domain")}
        entry["counts"]["measuredActive"] = sum(r["kind"] == "measured" and r["pchembl"] >= tam.ACTIVE_PCHEMBL for r in rows)
        for h in rank_hits(rows, TOP_N):
            if h["name"] not in access_cache:
                access_cache[h["name"]] = access_for(h["name"], ob_rows)
            entry["hits"].append({k: v for k, v in h.items() if k != "smiles"} | {"access": access_cache[h["name"]]})
        print(f"{gene}: {entry['metrics']['rocAuc']} AUC, {entry['counts']}", file=sys.stderr)
        out["targets"].append(entry)
    out["orangeBookFetched"] = ob_f
    (CUR / "screen.json").write_text(json.dumps(out, indent=1) + "\n")
    print("wrote data/curation/screen.json; rerun build_run_bundle.py", file=sys.stderr)


def selftest() -> None:
    rows = [
        {"name": "A", "kind": "measured", "pchembl": 7.5}, {"name": "B", "kind": "measured", "pchembl": 5.0},
        {"name": "C", "kind": "predicted", "p": 0.9}, {"name": "D", "kind": "predicted", "p": 0.4},
        {"name": "E", "kind": "out-of-domain"},
    ]
    assert [r["name"] for r in rank_hits(rows, 10)] == ["A", "C", "D"]  # inactive measurement and OOD never ranked
    assert [r["name"] for r in rank_hits(rows, 2)] == ["A", "C"]
    assert canonical("OC(=O)C") == canonical("CC(O)=O") and canonical("nope") is None
    assert canonical("O=C(O)[C@@H](S)[C@@H](S)C(=O)O") == canonical("O=C(O)C(S)C(S)C(=O)O")
    assert measured_by_molecule([{"molecule": "M", "pchembl": 5.0}, {"molecule": "M", "pchembl": 6.5}]) == {"M": 6.5}
    print("selftest ok")




if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    selftest() if a.selftest else run()
