# Dev log

- 2026-10-12: Backend scaffold: bundle schema, scoring, replay, device contract, build script. (AI-assisted)
- 2026-10-12: Rank-stability analysis (`lib/analysis/stability.ts`): Monte Carlo perturbation of weights and docking scores; median rank, 5th–95th percentile interval, P(top-N), Kendall tau. `accessScore` now takes optional weights; `bestPoses` extracted from `leaderboard`. (AI-assisted)
- 2026-10-12: ChEMBL activity model pipeline (RF + Morgan, scaffold split, applicability domain, leakage flag), optional `models` in the bundle schema, `activitySignal`. (AI-assisted)
- 2026-10-12: Plain-language brief (EN/ES) and voice (read-aloud + command grammar). (AI-assisted)
