# reference/: tree26 (TreeHacks 2026), the project MediMol builds on

Full copy of https://github.com/ezou1/tree26 at commit `3a3d57b9eaf983a9621dec7d38c79e05b4c43ba0` (MIT License, © 2026 Eric Zou; see LICENSE).

- `agent3_output.json`: DiffDock results run on RunPod serverless, 10 poses per ligand. MediMol uses the KRAS (9IAY) results only.
- `agent2_output.json`: ligand SMILES and PubChem sources.
- `9IAY.pdb`: the receptor file given to DiffDock.

Corrections MediMol applies on import (`tools/fetch_public_data.py`):
1. The 13 "ERK2" results are dropped. PDB 2FMA is the copper-binding domain of amyloid precursor protein (APP), not ERK2.
2. 9IAY has glycine at residue 12, so it is not a G12D mutant structure. It is GDP-bound KRAS with the pan-KRAS inhibitor from the BI-2493 paper (J Med Chem 2025, 68:15649).
3. `fda_status` and `mechanism` strings are ignored. Approval, generic, WHO and trial facts are re-fetched from primary sources.
4. Two compounds were docked twice (rounds 2–3). The first run is kept.
