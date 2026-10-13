# medimol

MediMol: computational hypotheses for lab testing. **Not medical advice.**

## Backend layout
- `lib/bundle/schema.ts`: RunBundle zod schema (provenance, sources, targets, drugs, access, poses) plus `loadBundle(url)`
- `lib/bundle/scoring.ts`: Access Score (approved 0.3, generic 0.3, WHO EML 0.2, cancer trials 0.2; unknown counts as 0 and is listed), leaderboard, Affordable leads
- `lib/bundle/validation.ts`: where the positive controls rank
- `lib/bundle/replay.ts`: replays a recorded run on a timeline (default 60s)
- `lib/device/`: NDJSON device contract (zod), Web Serial client, virtual device
- `lib/export/csv.ts`: shortlist and test-log CSV
- `tools/build_run_bundle.py`: DiffDock outputs + `data/curation/*.csv` → `public/bundles/<id>.json`

## Data pipeline (real data, no API keys)
All network access happens in these offline tools. Responses are cached in `data/raw/http/`, and the app itself never goes online.

```sh
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
python3 tools/fetch_public_data.py                     # tree26 DiffDock run + PubChem/ChEMBL/FDA/WHO/CT.gov → data/curation/
.venv/bin/python tools/train_activity_model.py --target-map data/curation/chembl_targets.csv   # KRAS model on ChEMBL
.venv/bin/python tools/screen_approved.py              # every approved drug vs 5 KRAS-pathway targets
python3 tools/build_run_bundle.py --id pdac-kras-v1 --diffdock data/raw/diffdock
pnpm test                                              # validates public/bundles/*.json
```

- `reference/`: full copy of [tree26](https://github.com/ezou1/tree26) (MIT), the TreeHacks project whose DiffDock run we build on. See `reference/MEDIMOL_IMPORT.md` for the corrections we apply.
- `data/curation/provenance.json`: the source URL and retrieval date for every fact.
