# Third-party software

| Package | Use | License |
|---|---|---|
| zod | runtime validation | MIT |
| typescript | type checking | Apache-2.0 |
| vitest | tests | MIT |
| @types/node | Node type definitions | MIT |
| react, react-dom | web app UI | MIT |
| vite | web app dev server and build | MIT |
| @types/react, @types/react-dom | React type definitions | MIT |
| playwright-core | drives Chromium for the loop recorder (build tool only) | Apache-2.0 |
| Chromium | renders the frames the loop recorder captures (build tool only, not shipped) | BSD-3-Clause |
| FFmpeg with libx264 | stitches captured frames into MP4 (build tool only, not shipped) | LGPL/GPL |
| RDKit | fingerprints, scaffolds (build tool only) | BSD-3-Clause |
| scikit-learn | random forest, metrics (build tool only) | BSD-3-Clause |
| 3Dmol.js 2.4.2 | 3D pose viewer (vendored in public/vendor) | BSD-3-Clause |
| NumPy | arrays (build tool only) | BSD-3-Clause |

## Data
| Source | Use | License |
|---|---|---|
| ChEMBL (EMBL-EBI) | bioactivity training data | CC BY-SA 3.0 (attribute in the app) |
| ClinicalTrials.gov API v2 | trial counts | public domain (US government) |
| tree26 (github.com/ezou1/tree26) | DiffDock results, receptor 9IAY, ligand list (`reference/`) | MIT, © 2026 Eric Zou |
| RCSB PDB | protein structure 9IAY | CC0 |
| PubChem (NCBI) | compound identity, SMILES | public domain (US government) |
| FDA Orange Book data files | generic (ANDA) status | public domain (US government) |
| openFDA (drug label, NDC) | boxed warnings, storage, OTC/generic products | public domain (CC0) |
| WHO eEML | essential-medicines status | CC BY-NC-SA 3.0 IGO (attribute WHO) |

## Design reference
| Source | Use | License |
|---|---|---|
| emilkowalski/skills (`apple-design` and related notes) | interface and motion principles; the momentum-projection and rubber-band formulas in `web/src/motion/spring.ts` come from Apple's "Designing Fluid Interfaces" as quoted there | MIT |

The app ships no fonts. It asks for the system font and, in the recorded loops, was drawn with Inter (SIL OFL 1.1) as installed on the recording machine.
