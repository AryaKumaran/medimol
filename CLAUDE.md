# MediMol

Congressional App Challenge entry, submitted by Oct 23, 2026. Ranks approved, affordable drugs as hypotheses for lab testing against pancreatic cancer (PDAC). **Research use only. Never write medical advice.**

## Commands
- Tests: `npx pnpm@9.12.1 test` (local `pnpm` shim is broken) · Types: `npx tsc --noEmit`
- Python tools: `.venv/bin/python` (setup: `python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt`)
- Build bundle: `python3 tools/build_run_bundle.py --id pdac-v1 --diffdock data/raw/diffdock [--fetch-trials]`
- Train ML: `.venv/bin/python tools/train_activity_model.py --target-map data/curation/chembl_targets.csv`

## Layout
- `lib/bundle/`: zod RunBundle schema (the one data contract), Access Score + leaderboard, positive controls, replay
- `lib/analysis/`: rank stability (Monte Carlo), ML activity signal
- `lib/brief/`, `lib/voice/`: EN/ES plain-language brief, read-aloud + voice command grammar
- `lib/device/`: Bench Companion NDJSON contract, Web Serial, virtual device. Firmware is team-written; don't write it.
- `lib/export/`: CSV · `tools/`: offline Python build tools · `data/curation/`: hand-curated inputs · `data/raw/`: gitignored downloads

## Rules
- Never invent data: drugs, costs, docking scores, trial counts, PDB IDs. Unknown → `unknown`. Synthetic data only in `tests/fixture.ts`, labelled.
- Zero keys, offline demo: network only in `tools/`, with results cached into the bundle with dates.
- Strict TS, no `any`, zod at every boundary, deterministic (seeded RNG, no `Date.now` in logic).
- Every module: tests (edge cases + property-style), a section in `docs/DESIGN_NOTES.md`, and a `docs/DEV_LOG.md` entry marked "(AI-assisted)". New deps go in `THIRD_PARTY.md` with license.
- 2FMA is APP, not ERK2. FDA status uses exact-token matching (`"not approved"` ≠ approved).
- Keep the ML out of the combined score; show it side by side. Out-of-domain predictions never show a number.
