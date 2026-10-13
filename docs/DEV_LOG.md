# Dev log

- 2026-10-12: Backend scaffold: bundle schema, scoring, replay, device contract, build script. (AI-assisted)
- 2026-10-12: Rank-stability analysis (`lib/analysis/stability.ts`): Monte Carlo perturbation of weights and docking scores; median rank, 5th–95th percentile interval, P(top-N), Kendall tau. `accessScore` now takes optional weights; `bestPoses` extracted from `leaderboard`. (AI-assisted)
- 2026-10-12: ChEMBL activity model pipeline (RF + Morgan, scaffold split, applicability domain, leakage flag), optional `models` in the bundle schema, `activitySignal`. (AI-assisted)
- 2026-10-12: Plain-language brief (EN/ES) and voice (read-aloud + command grammar). (AI-assisted)
- 2026-10-13: Enrichment validation (ROC-AUC + bootstrap CI, EF, BEDROC). (AI-assisted)
- 2026-10-12: Web app (`web/`): landing page and six sections (Leads, Replay, Stability, Validation, Bench, About) on React + Vite, reading bundles through the existing schema; labelled synthetic fallback `demoFixture()`. (AI-assisted)
- 2026-10-12: Spring motion engine (`web/src/motion/`): exact damped-spring solver, velocity handoff, momentum projection, rubber-banding, FLIP reorder; CSS-driven motion banned by `tests/no-css-motion.test.ts`. (AI-assisted)
- 2026-10-12: Loop recorder (`tools/capture.ts`): frame-exact Playwright capture stitched by ffmpeg into seamless MP4 loops in `public/loops/`. (AI-assisted)
- 2026-10-13: 3D pose viewer (3Dmol, saved in repo), receptor files in bundle (`Target.pdbFile`), `poseAssets`. (AI-assisted)
- 2026-10-13: Imported tree26 DiffDock run into `reference/` (MIT); `tools/fetch_public_data.py` re-curates every fact from PubChem, ChEMBL, Orange Book, openFDA, WHO eEML and ClinicalTrials.gov with provenance; first real bundle `pdac-kras-v1`. (AI-assisted)
- 2026-10-13: KRAS activity model trained on 5,082 real ChEMBL measurements; 5-fold scaffold CV model comparison; approved-drug screen across 5 KRAS-pathway targets; storage band from FDA labels drives the device alert range. (AI-assisted)
