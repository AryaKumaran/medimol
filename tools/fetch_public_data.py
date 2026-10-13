#!/usr/bin/env python3
"""Turn the tree26 DiffDock run + public databases into MediMol's curation inputs. Stdlib only.

  python3 tools/fetch_public_data.py            # fetch (cached), write data/curation/*, data/raw/{diffdock,pdb}
  python3 tools/fetch_public_data.py --selftest

Every fact comes from a primary source and is logged with its URL and retrieval date in
data/curation/provenance.json. Nothing is typed in by hand. Unknown stays "unknown".

  Docking        tree26 DiffDock run (reference/, MIT)                    KRAS / PDB 9IAY, 10 poses per ligand
  Identity       PubChem PUG REST                                       name, InChIKey, SMILES
  Approval       ChEMBL (max_phase 4 = approved; withdrawn_flag)         + approved indications
  Generic        FDA Orange Book products file (ANDA = generic)          approved drugs only
  WHO EML        WHO eEML search, exact name/synonym match               approved drugs only
  Trials         ClinicalTrials.gov API v2, condition "pancreatic cancer"
  Safety/storage openFDA drug labels (boxed warning, storage temperature)
  Pos. controls  ChEMBL: measured pChEMBL >= 6 against KRAS (independent of docking)

HTTP responses are cached in data/raw/http/ so reruns are offline and reproducible.
"""
import argparse, base64, csv, datetime, hashlib, io, json, re, shutil, sys, time, urllib.parse, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "reference"  # full copy of github.com/ezou1/tree26 (MIT); see reference/MEDIMOL_IMPORT.md
CUR = ROOT / "data" / "curation"
RAW = ROOT / "data" / "raw"
CACHE = RAW / "http"
TODAY = datetime.date.today().isoformat()

TARGET = {"id": "kras", "gene": "KRAS", "name": "GTPase KRas (GDP-bound)", "pdb_id": "9IAY", "uniprot": "P01116"}
TRIALS_CONDITION = "pancreatic cancer"
ACTIVE_PCHEMBL = 6.0

UA = {"User-Agent": "MediMol research tool (student project; contact via GitHub)"}
_last = [0.0]


def get(url: str, kind: str = "json"):
    """GET with an on-disk cache. Returns (body, fetched_date). 404 -> (None, date)."""
    key = hashlib.sha1(url.encode()).hexdigest()
    path = CACHE / f"{key}.{kind if kind != 'bytes' else 'bin'}"
    meta = CACHE / f"{key}.meta"
    if path.exists():
        body = path.read_bytes()
        fetched = json.loads(meta.read_text())["fetched"] if meta.exists() else TODAY
    elif meta.exists():  # cached 404
        return None, json.loads(meta.read_text())["fetched"]
    else:
        wait = 0.25 - (time.time() - _last[0])  # stay well under PubChem's 5 req/s
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        CACHE.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                    body = r.read()
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    meta.write_text(json.dumps({"url": url, "fetched": TODAY, "status": 404}))
                    return None, TODAY
                if e.code not in (429, 500, 502, 503, 504) or attempt == 3:
                    raise
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3:
                    raise
            time.sleep(2 ** attempt)  # 1, 2, 4 s backoff
        path.write_bytes(body)
        meta.write_text(json.dumps({"url": url, "fetched": TODAY}))
        fetched = TODAY
    if kind == "json":
        return json.loads(body), fetched
    if kind == "text":
        return body.decode("utf-8", "replace"), fetched
    return body, fetched


# ---------- pure parsers (covered by --selftest) ----------

def approval_from_chembl(mol) -> str:
    if mol is None:
        return "unknown"
    if mol.get("withdrawn_flag"):
        return "withdrawn"
    phase = float(mol.get("max_phase") or 0)
    if phase >= 4:
        return "approved"
    if phase > 0:
        return "investigational"
    return "unknown"  # phase 0 / null: preclinical or no record. Not "no"


def orange_book_generic(rows: list, names: list) -> str:
    """rows: dicts from products.txt. 'yes' if an active ANDA exists for a single-ingredient product
    whose ingredient is the drug (any salt); 'no' if only NDAs; 'unknown' if not in the Orange Book
    (e.g. OTC monograph drugs like aspirin are mostly not listed, which is not evidence of no generic)."""
    found_nda = False
    for r in rows:
        ing = r["Ingredient"].upper()
        if ";" in ing or r["Type"] == "DISCN":
            continue
        if not any(ing == n or ing.startswith(n + " ") for n in names):
            continue
        if r["Appl_Type"] == "A":
            return "yes"
        found_nda = True
    return "no" if found_nda else "unknown"


def eml_titles(html: str) -> list:
    return [t.strip() for t in re.findall(r'<h5 class="medicine-name" title="([^"]+)"', html)]


def storage_range(text: str):
    """First Celsius range in a label, e.g. '20° to 25°C (68° to 77°F)' -> (20, 25), '2°C to 8°C' -> (2, 8)."""
    t = text.replace("º", "°").replace("&deg;", "°")
    m = re.search(r"(-?\d{1,2})\s*°?\s*C?\s*(?:to|-|–|and)\s*(-?\d{1,2})\s*°\s*C", t)
    if not m:
        m = re.search(r"(?:below|not exceeding|up to)\s*(\d{1,2})\s*°\s*C", t, re.I)
        return (None, float(m.group(1))) if m else None
    lo, hi = float(m.group(1)), float(m.group(2))
    return (lo, hi) if lo < hi and -30 <= lo and hi <= 40 else None


def boxed_topic(text: str) -> str:
    """Heading of a boxed warning, lower-cased:
    'BOXED WARNING WARNING: LACTIC ACIDOSIS Postmarketing…' -> 'lactic acidosis'
    'BOXED WARNING Congestive Heart Failure, Cardiac Effects and Drug Interactions Congestive…' -> that heading."""
    t = re.sub(r"^\s*(BOXED WARNING\s*)?(WARNINGS?\s*:?\s*)?", "", text.strip())
    caps = re.match(r"((?:[A-Z][A-Z\-/&]+[ ,]*){1,10})(?=\s+[A-Z][a-z]|\s*$|\s*\()", t)
    if caps and len(caps.group(1).split()) >= 1 and caps.group(1).strip().isupper():
        return caps.group(1).strip(" ,-").lower()
    words, out = t.split(), []
    for w in words:  # Title Case heading: stop at the first ordinary word or when the heading repeats
        if out and w == out[0]:
            break
        if not (w[0].isupper() or w.lower().strip(",") in ("and", "or", "of", "with", "in", "the", "to", "&")):
            break
        out.append(w)
    return " ".join(out).strip(" ,:").lower() if 1 <= len(out) <= 12 else "see label"


def short(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------- fetchers ----------

def pubchem(cid: int):
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/property/Title,InChIKey,IsomericSMILES,CanonicalSMILES/JSON"
    d, f = get(url)
    p = d["PropertyTable"]["Properties"][0]
    smiles = next((p[k] for k in ("IsomericSMILES", "SMILES", "CanonicalSMILES", "ConnectivitySMILES") if p.get(k)), None)
    return {"title": p.get("Title"), "inchikey": p["InChIKey"], "smiles": smiles}, url, f


def chembl_molecule(inchikey: str):
    url = f"https://www.ebi.ac.uk/chembl/api/data/molecule.json?molecule_structures__standard_inchi_key={inchikey}"
    d, f = get(url)
    mols = d["molecules"]
    if not mols:
        # PubChem's record may be a different stereo/salt form than ChEMBL's: match on the connectivity
        # block (first 14 chars of the InChIKey) and take the most advanced record.
        url = f"https://www.ebi.ac.uk/chembl/api/data/molecule.json?molecule_structures__standard_inchi_key__startswith={inchikey[:14]}&limit=50"
        d, f = get(url)
        mols = sorted(d["molecules"], key=lambda m: -float(m.get("max_phase") or 0))
    return (mols[0] if mols else None), url, f


def chembl_by_name(name: str, cid: int):
    """Last resort for tautomers (e.g. doxycycline drawn as the imidic acid): ChEMBL by preferred name,
    accepted only if PubChem independently maps that name to this exact CID."""
    q = urllib.parse.quote(name)
    d, _ = get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{q}/cids/JSON")
    if not d or cid not in d.get("IdentifierList", {}).get("CID", []):
        return None, None, None
    url = f"https://www.ebi.ac.uk/chembl/api/data/molecule.json?pref_name__iexact={q}"
    d, f = get(url)
    return (d["molecules"][0] if d["molecules"] else None), url, f


def chembl_indications(chembl_id: str):
    url = f"https://www.ebi.ac.uk/chembl/api/data/drug_indication.json?molecule_chembl_id={chembl_id}&max_phase_for_ind=4&limit=100"
    d, f = get(url)
    seen = []
    for i in d["drug_indications"]:
        h = (i.get("mesh_heading") or "").strip()
        if h and h.lower() not in [s.lower() for s in seen]:
            seen.append(h)
    return seen, url, f


def chembl_target_id(uniprot: str):
    url = f"https://www.ebi.ac.uk/chembl/api/data/target.json?target_components__accession={uniprot}&target_type=SINGLE%20PROTEIN&organism=Homo%20sapiens"
    d, f = get(url)
    return d["targets"][0]["target_chembl_id"], url, f


def chembl_best_pchembl(target: str, mol: str):
    url = (f"https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id={target}&molecule_chembl_id={mol}"
           "&pchembl_value__isnull=false&limit=1000")
    d, f = get(url)
    vals = [float(a["pchembl_value"]) for a in d["activities"] if a.get("pchembl_value")]
    return (max(vals) if vals else None), url, f


def trials(name: str):
    q = {"query.cond": TRIALS_CONDITION, "query.intr": name, "countTotal": "true", "pageSize": "1"}
    url = "https://clinicaltrials.gov/api/v2/studies?" + urllib.parse.urlencode(q)
    d, f = get(url)
    return d.get("totalCount", 0), url, f


def orange_book():
    url = "https://www.fda.gov/media/76860/download"
    body, f = get(url, "bytes")
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith("products.txt"))
        text = z.read(name).decode("latin-1")
    return list(csv.DictReader(io.StringIO(text), delimiter="~")), url, f


# NDC marketing categories that mean a non-brand-exclusive product is sold (generic or OTC monograph).
OPEN_MARKET = ("ANDA", "NDA AUTHORIZED GENERIC", "OTC MONOGRAPH DRUG", "OTC MONOGRAPH FINAL", "OTC MONOGRAPH NOT FINAL")


def ndc_open_market(ndc_rows: list, names: list) -> bool:
    return any(r.get("marketing_category") in OPEN_MARKET and (r.get("generic_name") or "").upper().strip() in names for r in ndc_rows)


def ndc_products(name: str):
    q = urllib.parse.quote(f'generic_name:"{name}"')
    url = f"https://api.fda.gov/drug/ndc.json?search={q}&limit=100"
    d, f = get(url)
    return (d or {}).get("results", []), url, f


def who_eml(candidates: list):
    """Search the WHO eEML by each name/synonym; exact title match only."""
    for n in candidates:
        url = "https://list.essentialmeds.org/?query=" + urllib.parse.quote(n)
        html, f = get(url, "text")
        if html and any(t.lower() == n.lower() for t in eml_titles(html)):
            return "yes", url, f, n
    url = "https://list.essentialmeds.org/?query=" + urllib.parse.quote(candidates[0]) if candidates else "https://list.essentialmeds.org/"
    return "no", url, TODAY, None


def label_storage(lab):
    return storage_range(" ".join(lab.get("storage_and_handling", []) + lab.get("how_supplied", [])))


def openfda_label(names: list):
    """A single-ingredient label for the drug, preferring one that states a storage temperature
    (repackager labels often omit it)."""
    first = None
    for n in names:
        q = urllib.parse.quote(f'openfda.generic_name:"{n}"')
        url = f"https://api.fda.gov/drug/label.json?search={q}&limit=20"
        d, f = get(url)
        if not d:
            continue
        for lab in d.get("results", []):
            gn = [g.upper() for g in lab.get("openfda", {}).get("generic_name", [])]
            if any(g == n or (g.startswith(n + " ") and " AND " not in g and "," not in g) for g in gn):
                if label_storage(lab):
                    return lab, url, f
                first = first or (lab, url, f)
    return first or (None, None, None)


# ---------- main ----------

def run() -> None:
    a3 = json.loads((SRC / "agent3_output.json").read_text())
    a2 = json.loads((SRC / "agent2_output.json").read_text())
    kras = next(t for t in a3["targets"] if t["pdb_id"] == "9IAY")
    smiles_a2 = {l["source"]: l["smiles"] for t in a2["targets"] for l in t["ligands"]}
    names_a2 = {l["source"]: l["name"] for t in a2["targets"] for l in t["ligands"]}

    # One run per compound: keep the earliest round (later rounds re-docked the same molecule).
    results = {}
    for r in sorted(kras["results"], key=lambda r: r["round"]):
        results.setdefault(r["source"], r)
    print(f"{len(results)} unique compounds docked against KRAS 9IAY", file=sys.stderr)

    # Receptor + DiffDock layout for build_run_bundle.py
    (RAW / "pdb").mkdir(parents=True, exist_ok=True)
    shutil.copy(SRC / "structures" / "9IAY.pdb", RAW / "pdb" / "9IAY.pdb")
    dd = RAW / "diffdock"
    if dd.exists():
        shutil.rmtree(dd)

    ob_rows, ob_url, ob_f = orange_book()
    kras_chembl, kras_url, kras_f = chembl_target_id(TARGET["uniprot"])
    prov, drugs, trial_cache = {}, [], {}

    for src_id, r in results.items():
        cid = int(src_id.removeprefix("pubchem_cid_"))
        did = f"cid{cid}"
        P = prov[did] = {}
        pc, u, f = pubchem(cid)
        P["identity"] = {"url": u, "fetched": f}
        mol, u, f = chembl_molecule(pc["inchikey"])
        a2name = names_a2.get(src_id, "")
        if mol is None and a2name and len(a2name) <= 30:
            m2, u2, f2 = chembl_by_name(a2name.split(" (")[0], cid)
            if m2:
                mol, u, f = m2, u2, f2
        P["chembl"] = {"url": u, "fetched": f, "chemblId": mol and mol["molecule_chembl_id"]}
        approval = approval_from_chembl(mol)

        pref = (mol or {}).get("pref_name")
        syns = sorted({s["molecule_synonym"].upper() for s in (mol or {}).get("molecule_synonyms", [])
                       if s.get("syn_type") in ("INN", "USAN", "BAN", "FDA", "USP", "JAN", "OTHER") and len(s["molecule_synonym"]) < 40})
        names = [n for n in [pref and pref.upper()] if n] + [s for s in syns if s != (pref or "").upper()]
        display = (pref.title() if pref else
                   pc["title"] if pc["title"] and len(pc["title"]) <= 30 else
                   a2name.split(" (")[0] if a2name and len(a2name) <= 30 else f"CID {cid}")

        approved_for = None
        if approval == "approved":
            ind, u, f = chembl_indications(mol["molecule_chembl_id"])
            P["indications"] = {"url": u, "fetched": f}
            approved_for = ", ".join(i.lower() for i in ind[:3]) or None

        pchembl, u, f = (chembl_best_pchembl(kras_chembl, mol["molecule_chembl_id"]) if mol else (None, None, None))
        P["krasActivity"] = {"url": u, "fetched": f, "bestPchembl": pchembl}
        control = pchembl is not None and pchembl >= ACTIVE_PCHEMBL

        generic, eml, cost, flags, storage = "unknown", "unknown", "unknown", [], None
        if approval == "approved" and names:
            generic = orange_book_generic(ob_rows, names)
            P["generic"] = {"url": ob_url, "fetched": ob_f, "value": generic}
            if generic != "yes":  # OTC monograph drugs (e.g. aspirin) are sold generically but mostly absent from the Orange Book
                rows, u, f = ndc_products(names[0])
                if ndc_open_market(rows, names):
                    generic = "yes"
                    P["generic"] = {"url": u, "fetched": f, "value": "yes", "via": "openFDA NDC: ANDA or OTC monograph product"}
            eml, u, f, matched = who_eml([pref] + [s.title() for s in syns] if pref else [])
            P["whoEml"] = {"url": u, "fetched": f, "value": eml, "matched": matched}
            cost = "generic" if generic == "yes" else "brand-only" if generic == "no" else "unknown"
            lab, u, f = openfda_label(names)
            if lab:
                P["label"] = {"url": u, "fetched": f, "setId": lab.get("set_id")}
                if lab.get("boxed_warning"):
                    flags.append(f"FDA boxed warning: {boxed_topic(' '.join(lab['boxed_warning']))}")
                rng = label_storage(lab)
                if rng:
                    storage = f"{'' if rng[0] is None else f'{rng[0]:g}-'}{rng[1]:g}C"
        elif approval != "approved":
            generic, eml = "no", "no"  # not an approved medicine: cannot have a generic or be on the EML
            P["generic"] = P["whoEml"] = {"rule": f"approval={approval}: not a marketed medicine"}
            flags.append("Investigational: not approved" if approval == "investigational" else "No approval record in ChEMBL")
        if approval == "withdrawn":
            flags.append("Withdrawn from market")

        trial_name = pref or (display if not display.startswith("CID ") and not display[0].isdigit() else None)
        if trial_name:
            n, u, f = trials(trial_name)
            trial_cache[did] = {"count": n, "query": u, "fetchedAt": f}

        # DiffDock layout: rank1 SDF + all 10 confidences (raw DiffDock score, higher = better)
        pair = dd / f"{did}__{TARGET['id']}"
        pair.mkdir(parents=True)
        poses = sorted(r["all_poses"], key=lambda p: p["rank"])
        (pair / f"rank1_confidence{poses[0]['confidence_raw']:.4f}.sdf").write_bytes(base64.b64decode(r["top_pose_sdf_b64"]))
        (pair / "confidences.json").write_text(json.dumps([{"rank": p["rank"], "confidence": round(p["confidence_raw"], 4)} for p in poses]))

        drugs.append({
            "id": did, "name": short(display, 40), "drugbank_id": "", "smiles": pc["smiles"] or smiles_a2.get(src_id, ""),
            "fda_status": approval, "approved_for": approved_for or "", "positive_control": "yes" if control else "no",
            "safety_flags": ";".join(flags), "storage": storage or "",
            "generic": generic, "who_eml": eml, "cost_tier": cost,
            "source_ids": ";".join(s for s in ["tree26", "pubchem", "chembl"] + (["orangebook", "who_eml", "openfda"] if approval == "approved" else []) + (["ctgov"] if did in trial_cache else [])),
        })
        print(f"  {display:32} {approval:15} generic={generic:7} eml={eml:7} ctrl={control} trials={trial_cache.get(did, {}).get('count')}", file=sys.stderr)

    CUR.mkdir(parents=True, exist_ok=True)
    with open(CUR / "drugs.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(drugs[0]))
        w.writeheader()
        w.writerows(sorted(drugs, key=lambda d: d["id"]))
    with open(CUR / "targets.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "gene", "name", "pdb_id", "role", "source_ids"])
        w.writerow([TARGET["id"], TARGET["gene"], TARGET["name"], TARGET["pdb_id"],
                    "KRAS is mutated in over 90% of pancreatic cancers and drives tumor growth.", "rcsb_9iay;tcga_pdac"])
    with open(CUR / "chembl_targets.csv", "w", newline="") as fh:
        fh.write(f"target_id,chembl_id\n{TARGET['id']},{kras_chembl}\n")
    sources = [
        ("tree26", "tree26 DiffDock run on RunPod (TreeHacks 2026, MIT)", "https://github.com/ezou1/tree26"),
        ("rcsb_9iay", "RCSB PDB 9IAY: KRAS-GDP with pan-KRAS inhibitor", "https://www.rcsb.org/structure/9IAY"),
        ("tcga_pdac", "TCGA Research Network, Integrated Genomic Characterization of PDAC, Cancer Cell 2017", "https://pubmed.ncbi.nlm.nih.gov/28810144/"),
        ("pubchem", "PubChem (NCBI)", "https://pubchem.ncbi.nlm.nih.gov/"),
        ("chembl", "ChEMBL (EMBL-EBI)", "https://www.ebi.ac.uk/chembl/"),
        ("orangebook", "FDA Orange Book data files", "https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files"),
        ("who_eml", "WHO Electronic Essential Medicines List", "https://list.essentialmeds.org/"),
        ("ctgov", "ClinicalTrials.gov API v2", "https://clinicaltrials.gov/data-api/api"),
        ("openfda", "openFDA drug labels", "https://open.fda.gov/apis/drug/label/"),
    ]
    with open(CUR / "sources.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "label", "url", "accessed"])
        w.writerows([[i, l, u, TODAY] for i, l, u in sources])
    (CUR / "trials.json").write_text(json.dumps(trial_cache, indent=1) + "\n")
    (CUR / "run.json").write_text(json.dumps({
        "title": "PDAC drug repurposing: KRAS docking (tree26 run, re-curated)",
        "runDate": "2026-02-14",
        "model": "DiffDock",
        "modelVersion": "RunPod serverless DiffDock worker, 10 samples per complex (version not recorded by tree26)",
        "compute": "RunPod serverless GPU",
        "notes": ("Imported from github.com/ezou1/tree26 (MIT). KRAS/9IAY results only; the 2FMA results were docked against APP, "
                  "not ERK2, and are excluded. Confidence is DiffDock's raw score: a pose-ranking score, not a binding affinity. "
                  f"Access facts re-fetched from primary sources on {TODAY}; see data/curation/provenance.json."),
    }, indent=1) + "\n")
    (CUR / "provenance.json").write_text(json.dumps({"kras": {"chemblTarget": kras_chembl, "url": kras_url, "fetched": kras_f}, "drugs": prov}, indent=1) + "\n")
    print(f"wrote data/curation/* for {len(drugs)} drugs; next: python3 tools/build_run_bundle.py --id pdac-kras-v1 --diffdock data/raw/diffdock", file=sys.stderr)


def selftest() -> None:
    assert approval_from_chembl(None) == "unknown"
    assert approval_from_chembl({"max_phase": "4.0"}) == "approved"
    assert approval_from_chembl({"max_phase": 2}) == "investigational"
    assert approval_from_chembl({"max_phase": None}) == "unknown"
    assert approval_from_chembl({"max_phase": "4.0", "withdrawn_flag": True}) == "withdrawn"
    rows = [
        {"Ingredient": "METFORMIN HYDROCHLORIDE", "Appl_Type": "A", "Type": "RX"},
        {"Ingredient": "SOTORASIB", "Appl_Type": "N", "Type": "RX"},
        {"Ingredient": "GLIPIZIDE; METFORMIN HYDROCHLORIDE", "Appl_Type": "A", "Type": "RX"},
        {"Ingredient": "OLDDRUG", "Appl_Type": "A", "Type": "DISCN"},
        {"Ingredient": "OLDDRUG", "Appl_Type": "N", "Type": "RX"},
    ]
    assert orange_book_generic(rows, ["METFORMIN"]) == "yes"
    assert orange_book_generic(rows, ["SOTORASIB"]) == "no"
    assert orange_book_generic(rows, ["GLIPIZIDE"]) == "unknown"  # only in a combination product
    assert orange_book_generic(rows, ["OLDDRUG"]) == "no"  # discontinued ANDA does not count
    assert orange_book_generic(rows, ["ASPIRIN"]) == "unknown"
    assert orange_book_generic(rows, ["METFORM"]) == "unknown"  # no partial-word matches
    assert eml_titles('<h5 class="medicine-name" title="Metformin">x</h5>') == ["Metformin"]
    assert storage_range("Store at 20° to 25°C (68° to 77°F)") == (20, 25)
    assert storage_range("Store at 20ºC to 25ºC") == (20, 25)
    assert storage_range("Refrigerate at 2°C to 8°C") == (2, 8)
    assert storage_range("Store below 30°C") == (None, 30)
    assert storage_range("Keep tightly closed") is None
    assert boxed_topic("WARNING: LACTIC ACIDOSIS Postmarketing cases of metformin") == "lactic acidosis"
    assert boxed_topic("nothing here") == "see label"
    assert boxed_topic("BOXED WARNING WARNING: LACTIC ACIDOSIS Postmarketing cases") == "lactic acidosis"
    assert boxed_topic("BOXED WARNING Congestive Heart Failure, Cardiac Effects and Drug Interactions Congestive Heart Failure and Cardiac Effects: x") == "congestive heart failure, cardiac effects and drug interactions"
    assert boxed_topic("WARNING: SUICIDAL THOUGHTS AND BEHAVIORS Antidepressants increased") == "suicidal thoughts and behaviors"
    assert short("abcdef", 4) == "abc…"
    ndc = [{"generic_name": "Aspirin", "marketing_category": "OTC MONOGRAPH DRUG"}, {"generic_name": "Sotorasib", "marketing_category": "NDA"},
           {"generic_name": "Aspirin and Caffeine", "marketing_category": "OTC MONOGRAPH DRUG"}]
    assert ndc_open_market(ndc, ["ASPIRIN"]) and not ndc_open_market(ndc, ["SOTORASIB"]) and not ndc_open_market(ndc, ["CAFFEINE"])
    print("selftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    selftest() if a.selftest else run()
