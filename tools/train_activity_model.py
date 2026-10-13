#!/usr/bin/env python3
"""Train a per-target activity model on public ChEMBL bioactivity data and score the bundle's drugs.

An independent second signal next to docking: docking asks "does the pose fit?", this asks
"does it look like molecules measured active against this protein?". Research use only.

  python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
  .venv/bin/python tools/train_activity_model.py --target-map data/curation/chembl_targets.csv [--refresh]
  .venv/bin/python tools/train_activity_model.py --selftest

chembl_targets.csv: target_id,chembl_id   (target_id matches targets.csv; look up the ChEMBL ID by hand)
Reads SMILES from drugs.csv. Writes data/curation/ml.json, which build_run_bundle.py embeds.
ChEMBL downloads are cached in data/raw/chembl/ (gitignored), so retraining works offline.
"""
import argparse, csv, datetime, json, sys, urllib.request
from pathlib import Path

import numpy as np
from rdkit import Chem, DataStructs, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from rdkit.Chem.Scaffolds import MurckoScaffold
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

RDLogger.DisableLog("rdApp.*")
ROOT = Path(__file__).resolve().parent.parent
CUR = ROOT / "data" / "curation"
RAW = ROOT / "data" / "raw" / "chembl"
API = "https://www.ebi.ac.uk"
ACTIVE_PCHEMBL = 6.0  # 1 µM, a common activity cutoff
AD_MIN_SIM = 0.3  # below this Tanimoto to every training molecule, the prediction is out of domain
MIN_TRAIN, MIN_PER_CLASS = 50, 10
FPGEN = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)


def fetch_chembl(chembl_id: str, refresh: bool) -> list:
    path = RAW / f"{chembl_id}.json"
    if path.exists() and not refresh:
        return json.loads(path.read_text())["activities"]
    url = (f"{API}/chembl/api/data/activity.json?target_chembl_id={chembl_id}"
           "&standard_type__in=IC50,Ki,Kd,EC50&pchembl_value__isnull=false&limit=1000")
    acts = []
    while url:
        with urllib.request.urlopen(url, timeout=60) as r:
            page = json.load(r)
        acts += [{"smiles": a["canonical_smiles"], "pchembl": float(a["pchembl_value"]), "molecule": a["molecule_chembl_id"]}
                 for a in page["activities"] if a.get("canonical_smiles") and a.get("pchembl_value")]
        nxt = page["page_meta"]["next"]
        url = API + nxt if nxt else None
        print(f"  {chembl_id}: {len(acts)} activities", file=sys.stderr)
    RAW.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"fetchedAt": datetime.date.today().isoformat(), "activities": acts}))
    return acts


def dedupe(acts: list) -> dict:
    """One label per canonical structure: median pChEMBL across its measurements."""
    by = {}
    for a in acts:
        m = Chem.MolFromSmiles(a["smiles"])
        if m:
            by.setdefault(Chem.MolToSmiles(m), []).append(a["pchembl"])
    return {s: float(np.median(v)) for s, v in by.items()}


def fp(smiles: str):
    m = Chem.MolFromSmiles(smiles)
    return FPGEN.GetFingerprint(m) if m else None


def scaffold_split(smiles: list, test_frac=0.2):
    """Whole scaffolds go to one side, so the test set has chemotypes the model never saw.
    Harder and more honest than a random split. Largest scaffolds fill train first (deterministic)."""
    groups = {}
    for i, s in enumerate(smiles):
        groups.setdefault(MurckoScaffold.MurckoScaffoldSmiles(smiles=s), []).append(i)
    train, test = [], []
    for _, idx in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        (train if len(train) + len(idx) <= (1 - test_frac) * len(smiles) else test).extend(idx)
    return train, test


def train_eval(labels: dict, seed=0):
    smiles = list(labels)
    fps = [fp(s) for s in smiles]
    X = np.array([list(f) for f in fps], dtype=np.uint8)
    y = np.array([labels[s] >= ACTIVE_PCHEMBL for s in smiles], dtype=int)
    if len(y) < MIN_TRAIN or min(y.sum(), len(y) - y.sum()) < MIN_PER_CLASS:
        return None
    tr, te = scaffold_split(smiles)
    clf = RandomForestClassifier(n_estimators=500, class_weight="balanced", n_jobs=-1, random_state=seed)
    clf.fit(X[tr], y[tr])
    p = clf.predict_proba(X[te])[:, 1]
    metrics = {
        "split": "scaffold (~80/20, whole scaffolds kept together)", "nTrain": len(tr), "nTest": len(te), "positiveRate": round(float(y.mean()), 3),
        "rocAuc": round(float(roc_auc_score(y[te], p)), 3) if len(set(y[te])) == 2 else None,
        "prAuc": round(float(average_precision_score(y[te], p)), 3) if len(set(y[te])) == 2 else None,
    }
    clf.fit(X, y)  # final model on all data once evaluated
    return clf, fps, metrics


def predict(clf, train_fps: list, labels: dict, smiles: str) -> dict:
    f = fp(smiles)
    if f is None:
        return {"p": None, "maxSim": None, "inDomain": False, "inTraining": False, "measuredPchembl": None}
    can = Chem.MolToSmiles(Chem.MolFromSmiles(smiles))
    sim = max(DataStructs.BulkTanimotoSimilarity(f, train_fps))
    return {
        "p": round(float(clf.predict_proba(np.array([list(f)], dtype=np.uint8))[0, 1]), 3),
        "maxSim": round(float(sim), 3),
        "inDomain": sim >= AD_MIN_SIM,
        # A drug already in ChEMBL for this target: the model memorized it. Show the measurement instead.
        "inTraining": can in labels,
        "measuredPchembl": labels.get(can),
    }


def run(target_map: Path, refresh: bool) -> None:
    with open(target_map, newline="") as f:
        tmap = [r for r in csv.DictReader(f) if r["target_id"] and not r["target_id"].startswith("#")]
    with open(CUR / "drugs.csv", newline="") as f:
        drugs = [d for d in csv.DictReader(f) if d.get("smiles")]
    out = {}
    for t in tmap:
        acts = fetch_chembl(t["chembl_id"], refresh)
        labels = dedupe(acts)
        res = train_eval(labels)
        fetched = json.loads((RAW / f"{t['chembl_id']}.json").read_text())["fetchedAt"]
        entry = {"targetId": t["target_id"], "chemblId": t["chembl_id"], "fetchedAt": fetched,
                 "model": "RandomForest(500), Morgan r2 2048-bit", "activeCutoffPchembl": ACTIVE_PCHEMBL,
                 "nCompounds": len(labels), "metrics": None, "predictions": {}}
        if res is None:
            print(f"{t['target_id']}: not enough data ({len(labels)} compounds), skipped", file=sys.stderr)
        else:
            clf, fps, entry["metrics"] = res
            entry["predictions"] = {d["id"]: predict(clf, fps, labels, d["smiles"]) for d in drugs}
            print(f"{t['target_id']}: {entry['metrics']}", file=sys.stderr)
        out[t["target_id"]] = entry
    (CUR / "ml.json").write_text(json.dumps(list(out.values()), indent=1) + "\n")
    print("wrote data/curation/ml.json; now rerun build_run_bundle.py")


def selftest() -> None:
    # SYNTHETIC: actives carry a sulfonamide, inactives don't. Checks the pipeline, not chemistry.
    rng = np.random.default_rng(0)
    tails = ["C", "CC", "CCC", "OC", "NC", "ClC", "FC", "COC", "CC(C)", "OCC"]
    rings = ["c1ccccc1", "c1ccncc1", "C1CCCCC1", "c1ccc2ccccc2c1", "c1ccoc1", "C1CCNCC1"]
    labels = {}
    for r in rings:
        for t in tails:
            for t2 in tails[:5]:
                labels[Chem.MolToSmiles(Chem.MolFromSmiles(f"{t}{r}S(=O)(=O)N{t2}"))] = 7.0 + rng.random()
                labels[Chem.MolToSmiles(Chem.MolFromSmiles(f"{t}{r}C(=O){t2}"))] = 4.0 + rng.random()
    tr, te = scaffold_split(list(labels))
    scaf = lambda i: MurckoScaffold.MurckoScaffoldSmiles(smiles=list(labels)[i])
    assert not {scaf(i) for i in tr} & {scaf(i) for i in te}, "scaffold leak"
    clf, fps, m = train_eval(labels)
    assert m["rocAuc"] is not None and m["rocAuc"] > 0.9, m
    known = next(iter(labels))
    assert predict(clf, fps, labels, known)["inTraining"] is True
    far = predict(clf, fps, labels, "[Pt](Cl)(Cl)(N)N")  # cisplatin-like, nothing like training set
    assert far["inDomain"] is False and far["inTraining"] is False
    assert predict(clf, fps, labels, "not a smiles")["p"] is None
    assert train_eval(dict(list(labels.items())[:10])) is None  # too small
    print("selftest ok", m)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--target-map", type=Path)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
    elif a.target_map:
        run(a.target_map, a.refresh)
    else:
        ap.error("need --target-map or --selftest")
