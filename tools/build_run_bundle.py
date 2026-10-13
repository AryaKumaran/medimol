#!/usr/bin/env python3
"""Build a versioned MediMol RunBundle from DiffDock outputs + hand-curated CSVs.

Stdlib only. Usage:
  python3 tools/build_run_bundle.py --id pdac-v1 --diffdock data/raw/diffdock [--fetch-trials]
  python3 tools/build_run_bundle.py --selftest

Inputs (data/curation/):
  run.json      provenance: title, runDate, model, modelVersion, compute, notes
  sources.csv   id,label,url,accessed            every citation lives here
  targets.csv   id,gene,name,pdb_id,role,source_ids
  drugs.csv     id,name,drugbank_id,smiles,fda_status,approved_for,positive_control,
                safety_flags,storage,generic,who_eml,cost_tier,source_ids
  trials.json   ClinicalTrials.gov cache {drug_id: {count, query, fetchedAt}} (written by --fetch-trials)
DiffDock dir: one folder per pair named <drug_id>__<target_id>, containing DiffDock's
  rank<N>_confidence<X>.sdf files.
Output: public/bundles/<id>.json and public/bundles/<id>/poses/*.sdf
Multi-valued CSV cells use ';'. Unknown access facts must be written as 'unknown', never guessed.
"""
import argparse, csv, datetime, json, re, shutil, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CUR = ROOT / "data" / "curation"
OUT = ROOT / "public" / "bundles"
TRIALS_CONDITION = "pancreatic cancer"

# PDB IDs that have been mislabeled before. 2FMA is the APP copper-binding domain, not ERK2.
KNOWN_PDB = {"2FMA": "APP"}


def parse_fda_status(raw: str) -> str:
    """DrugBank-style groups ('approved; investigational'). Exact token match:
    the old substring check read 'not approved' / 'unapproved' as approved."""
    toks = {t.strip().lower() for t in re.split(r"[;,|/]", raw or "") if t.strip()}
    if "withdrawn" in toks:
        return "withdrawn"
    if "approved" in toks:
        return "approved"
    if toks & {"investigational", "experimental"}:
        return "investigational"
    return "unknown"


def tri(v: str, field: str) -> str:
    v = (v or "unknown").strip().lower()
    if v not in ("yes", "no", "unknown"):
        sys.exit(f"{field}: expected yes/no/unknown, got {v!r}")
    return v


def split(v: str) -> list:
    return [x.strip() for x in (v or "").split(";") if x.strip()]


def read_csv(name: str) -> list:
    with open(CUR / name, newline="", encoding="utf-8") as f:
        return [r for r in csv.DictReader(f) if not (r.get("id") or "").startswith("#")]


def check_target(t: dict) -> None:
    pdb = t["pdb_id"].strip().upper()
    want = KNOWN_PDB.get(pdb)
    if want and t["gene"].strip().upper() != want:
        sys.exit(f"target {t['id']}: PDB {pdb} is {want}, not {t['gene']}. Pick a structure of the right protein.")


def parse_pose_name(name: str):
    m = re.fullmatch(r"rank(\d+)_confidence(-?\d+(?:\.\d+)?)\.sdf", name)
    return (int(m.group(1)), float(m.group(2))) if m else None


def fetch_trials(drugs: list) -> dict:
    """Count pancreatic-cancer studies mentioning each drug as an intervention (API v2, no key)."""
    out = {}
    for d in drugs:
        q = {"query.cond": TRIALS_CONDITION, "query.intr": d["name"], "countTotal": "true", "pageSize": "1"}
        url = "https://clinicaltrials.gov/api/v2/studies?" + urllib.parse.urlencode(q)
        with urllib.request.urlopen(url, timeout=30) as r:
            n = json.load(r).get("totalCount", 0)
        out[d["id"]] = {"count": n, "query": url, "fetchedAt": datetime.date.today().isoformat()}
        print(f"  trials {d['name']}: {n}")
    return out


def build(bundle_id: str, diffdock: Path, refresh_trials: bool) -> Path:
    run = json.loads((CUR / "run.json").read_text())
    sources = read_csv("sources.csv")
    targets = read_csv("targets.csv")
    drugs = read_csv("drugs.csv")
    for t in targets:
        check_target(t)

    trials_path = CUR / "trials.json"
    if refresh_trials:
        trials_path.write_text(json.dumps(fetch_trials(drugs), indent=2) + "\n")
    trials = json.loads(trials_path.read_text()) if trials_path.exists() else {}

    pose_dir = OUT / bundle_id / "poses"
    if pose_dir.exists():
        shutil.rmtree(pose_dir)
    pose_dir.mkdir(parents=True)
    drug_ids, target_ids = {d["id"] for d in drugs}, {t["id"] for t in targets}
    poses = []
    for pair in sorted(p for p in diffdock.iterdir() if p.is_dir()):
        if "__" not in pair.name:
            continue
        drug_id, target_id = pair.name.split("__", 1)
        if drug_id not in drug_ids or target_id not in target_ids:
            sys.exit(f"{pair.name}: drug or target not in curation CSVs")
        for f in sorted(pair.glob("rank*_confidence*.sdf")):
            parsed = parse_pose_name(f.name)
            if not parsed:
                continue
            rank, conf = parsed
            rel = None
            if rank == 1:  # ponytail: ship only top poses; bundle size stays small
                rel = f"{bundle_id}/poses/{pair.name}.sdf"
                shutil.copy(f, OUT / rel)
            poses.append({"drugId": drug_id, "targetId": target_id, "rank": rank, "confidence": conf, "sdf": rel})
    if not poses:
        sys.exit(f"no DiffDock poses found under {diffdock}")

    bundle = {
        "schemaVersion": 1,
        "id": bundle_id,
        "title": run["title"],
        "provenance": {
            "runDate": run["runDate"], "model": run["model"], "modelVersion": run["modelVersion"],
            "compute": run["compute"], "notes": run.get("notes", ""),
            "builtAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "builder": "tools/build_run_bundle.py",
        },
        "sources": [{"id": s["id"], "label": s["label"], "url": s["url"], "accessed": s["accessed"]} for s in sources],
        "targets": [
            {"id": t["id"], "gene": t["gene"], "name": t["name"], "pdbId": t["pdb_id"].strip().upper(),
             "role": t["role"], "sourceIds": split(t["source_ids"])}
            for t in targets
        ],
        "drugs": [
            {
                "id": d["id"], "name": d["name"],
                "drugbankId": d.get("drugbank_id") or None, "smiles": d.get("smiles") or None,
                "approval": parse_fda_status(d["fda_status"]),
                "approvedFor": d.get("approved_for") or None,
                "positiveControl": d.get("positive_control", "").strip().lower() in ("yes", "true", "1"),
                "safetyFlags": split(d.get("safety_flags", "")),
                "storage": d.get("storage") or None,
                "access": {
                    "generic": tri(d.get("generic"), f"{d['id']}.generic"),
                    "whoEml": tri(d.get("who_eml"), f"{d['id']}.who_eml"),
                    "costTier": (d.get("cost_tier") or "unknown").strip().lower(),
                    "trials": trials.get(d["id"]),
                    "sourceIds": split(d.get("source_ids", "")),
                },
            }
            for d in drugs
        ],
        "poses": poses,
    }
    out = OUT / f"{bundle_id}.json"
    out.write_text(json.dumps(bundle, indent=1) + "\n")
    print(f"wrote {out.relative_to(ROOT)}: {len(targets)} targets, {len(drugs)} drugs, {len(poses)} poses")
    print("validate with: pnpm test")
    return out


def selftest() -> None:
    assert parse_fda_status("approved") == "approved"
    assert parse_fda_status("Approved; Investigational") == "approved"
    assert parse_fda_status("not approved") == "unknown"  # the old substring bug
    assert parse_fda_status("unapproved") == "unknown"
    assert parse_fda_status("approved; withdrawn") == "withdrawn"
    assert parse_fda_status("experimental") == "investigational"
    assert parse_fda_status("") == "unknown"
    assert parse_pose_name("rank1_confidence-0.52.sdf") == (1, -0.52)
    assert parse_pose_name("rank10_confidence1.20.sdf") == (10, 1.2)
    assert parse_pose_name("rank1.sdf") is None
    check_target({"id": "app", "gene": "APP", "pdb_id": "2fma"})
    try:
        check_target({"id": "erk2", "gene": "MAPK1", "pdb_id": "2FMA"})
        raise AssertionError("2FMA as ERK2 must be rejected")
    except SystemExit:
        pass
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id")
    ap.add_argument("--diffdock", type=Path)
    ap.add_argument("--fetch-trials", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
    elif a.id and a.diffdock:
        build(a.id, a.diffdock, a.fetch_trials)
    else:
        ap.error("need --id and --diffdock, or --selftest")
