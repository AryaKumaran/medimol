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
| @fontsource/special-gothic-expanded-one, @fontsource/special-gothic-condensed-one | display type (Special Gothic, Google Fonts) | OFL-1.1 (fonts), MIT (packaging) |
| @fontsource/redaction, -10, -20, -35, -50, -70, -100 | accent type; the eroded cuts mark doubt (Redaction by Jeremy Mickel, © 2019 MCKL Inc.) | OFL-1.1 (fonts), MIT (packaging) |
| @fontsource/instrument-serif | italic accent words | OFL-1.1 (fonts), MIT (packaging) |
| @fontsource/dm-mono | labels, table heads and micrographics | OFL-1.1 (fonts), MIT (packaging) |
| playwright-core | drives Chromium for the loop recorder (build tool only) | Apache-2.0 |
| Chromium | renders the frames the loop recorder captures (build tool only, not shipped) | BSD-3-Clause |
| FFmpeg with libx264 | stitches captured frames into MP4 (build tool only, not shipped) | LGPL/GPL |
| RDKit | fingerprints, scaffolds (build tool only) | BSD-3-Clause |
| scikit-learn | random forest, metrics (build tool only) | BSD-3-Clause |
| NumPy | arrays (build tool only) | BSD-3-Clause |

## Data
| Source | Use | License |
|---|---|---|
| ChEMBL (EMBL-EBI) | bioactivity training data | CC BY-SA 3.0 (attribute in the app) |
| ClinicalTrials.gov API v2 | trial counts | public domain (US government) |

## Design reference
| Source | Use | License |
|---|---|---|
| emilkowalski/skills (`apple-design` and related notes) | interface and motion principles; the momentum-projection and rubber-band formulas in `web/src/motion/spring.ts` come from Apple's "Designing Fluid Interfaces" as quoted there | MIT |

The display fonts above ship inside the build, so the offline demo looks the same everywhere. Reading text still asks for the system font and, in the recorded loops, was drawn with Inter (SIL OFL 1.1) as installed on the recording machine.
