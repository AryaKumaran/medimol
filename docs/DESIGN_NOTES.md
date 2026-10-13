# Design notes

Drafted with AI assistance. The team should rewrite these in their own words.

## Rank stability (`lib/analysis/stability.ts`)
- **Why:** the Access Score weights are a judgment call, and a single DiffDock run is noisy. A shortlist is only worth testing if its ranking holds up when those inputs change a little.
- **Weight jitter, not Dirichlet:** each weight is multiplied by U(1−X, 1+X) and then rescaled so the total stays the same. This keeps the documented weights at the center and makes X easy to explain ("±25%"). Dirichlet sampling would hide the baseline inside a concentration parameter.
- **Docking noise from the drug's own pose spread:** this uses the standard deviation of DiffDock confidence across that drug's poses on its best target. It's data from the same run rather than a guessed global noise level. Drugs with fewer than 2 poses get no noise, and `noiseSd: null` says so.
- **Seeded mulberry32 RNG:** the same seed always gives the same result, so a number shown in the app can be reproduced exactly. It isn't for cryptography.
- **Kendall tau-a against the baseline ranking:** gives one number for how much the whole ranking moved. The calculation is O(n²), which is fine for a bundle of a few hundred drugs at most.
- **Nearest-rank percentiles:** always an actual observed rank, never a fractional one.
- **Positive controls excluded**, the same as the default leaderboard.

## Activity model (`tools/train_activity_model.py`, `lib/analysis/activity.ts`)
- **Why:** docking only tells you whether a pose fits. This model is trained on *measured* lab data (ChEMBL), so it's a separate line of evidence. When the two agree, the lead is stronger.
- **Random forest on Morgan fingerprints:** a standard, well-understood baseline that trains in seconds on a laptop and can be explained in a 3-minute video. A deep model would be hard to defend with a few thousand compounds per target.
- **Scaffold split, not a random split:** random splits put near-identical molecules in both train and test, which inflates the scores. The scaffold split tests on chemotypes the model hasn't seen, which is the honest setting for repurposing.
- **Active means pChEMBL ≥ 6 (1 µM):** a common cutoff, kept as a constant so it can be changed and reported.
- **Applicability domain (Tanimoto similarity ≥ 0.3 to the nearest training molecule):** below that, the model's output is extrapolation, so the app shows "too different" instead of a number.
- **Leakage flag:** approved drugs are often already in ChEMBL. When one is, the "prediction" is memorized, so the app shows the real measurement instead.
- **Trained offline and cached in the bundle:** the demo needs no keys and no network, and the model never runs in the browser.
- **Kept out of the combined score:** this is deliberate. Folding it in would add another weighting choice to defend. The app shows it side by side.

## Plain-language brief (`lib/brief/brief.ts`)
- Built from templates and bundle fields only, so every sentence can be traced to data. Nothing is free-generated.
- An unknown fact gets its own sentence ("we do not know…"), so a missing value never quietly drops out.
- The Spanish version exists because language is an access barrier. A fluent speaker must review it.

## Voice (`lib/voice/voice.ts`)
- **Read-aloud** uses the browser's `speechSynthesis`, which needs no key and runs on offline OS voices. It's an accessibility feature for low-vision users and readers with lower literacy.
- **Voice commands** are a small fixed grammar, not an LLM: they're predictable, testable and free. Chrome sends the audio to Google for transcription, so commands are opt-in and that has to be disclosed.
- Commands are matched as whole phrases, so "nextdoor" doesn't trigger "next". Opening a drug needs a verb ("open X"), so a stray drug name doesn't navigate anywhere.

## Enrichment validation (`lib/analysis/enrichment.ts`)
- **Why:** "the control ranked #3" is one anecdote. Virtual-screening papers report enrichment: how much better than random the method puts known binders at the top. That's the number a reviewer looks for.
- **Metrics:**
  - ROC-AUC (Mann–Whitney: the chance a known binder outscores a random other drug).
  - EF at 1/5/10%, shown next to the best EF possible for that list size, so small lists aren't over-read.
  - BEDROC with α=20 (Truchon & Bayly, J Chem Inf Model 2007), which focuses on the very top of the list, where researchers actually look.
- **Bootstrap 95% CI on AUC (seeded):** with only a few controls the uncertainty is large, and the app should show that rather than a single falsely precise number.
- **Ties go against the actives:** a tied score never makes the method look better than it is.
- **Background is not decoys:** the other drugs aren't confirmed non-binders, so these numbers are a conservative lower bound. Say so on screen. Adding property-matched decoys (DUD-E style) would be the upgrade.
