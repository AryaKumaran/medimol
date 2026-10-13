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

## Build a bundle
1. Fill in `data/curation/{run.json,sources.csv,targets.csv,drugs.csv}`. Check every row against its source, and write `unknown` when you can't confirm something.
2. `python3 tools/build_run_bundle.py --id pdac-v1 --diffdock data/raw/diffdock --fetch-trials`
3. `pnpm test` (validates every bundle in `public/bundles/`)
