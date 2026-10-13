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

## Web app (`web/`)
- **React + Vite, nothing else at runtime.** The backend stays plain TypeScript in `lib/`; the app only imports it. No router (the hash is enough for six sections), no state library, no component kit, no animation library.
- **Sections are named for what is in them:** Leads, Replay, Stability, Validation, Bench, About. A reader should be able to guess what each one holds before opening it.
- **A real bundle wins; without one the app says it is a demo.** `web/src/data.ts` loads the newest `public/bundles/*.json` through the same zod schema as everything else. If there is none it falls back to `demoFixture()` in `tests/fixture.ts` and sets `synthetic`, which drives a banner the UI cannot hide. Adding a real bundle and rebuilding is the whole switch; no code changes.
- **Unknown is drawn, not dropped.** An unconfirmed access fact is a "?" pip and a line in the drug panel, and it still counts as 0 in the score.
- **The lab-data signal sits beside the score.** It has its own column and is never multiplied in. A prediction outside the model's domain shows "Too different", never a number.
- **Design reference:** Apple's interface principles as collected in the `apple-design` notes (response, direct manipulation, interruptibility, materials, size-specific type). Where those notes allow a CSS transition for small things, this project is stricter (next section).

## Motion (`web/src/motion/`)
- **Everything that moves is a spring. CSS transitions, keyframes, easing curves and the Web Animations API are banned** and `tests/no-css-motion.test.ts` fails the build if one appears. Two reasons: a spring can be grabbed and reversed mid-flight without a jump, because it always starts from the current value and velocity; and a spring driven by our own clock can be stepped one frame at a time, which the loop recorder needs.
- **Exact solution, not numerical integration** (`spring.ts`). A damped spring has a closed-form answer, so one 16 ms step and sixteen 1 ms steps give the same position. Frame rate cannot change the path, and a slow frame cannot make it explode.
- **Two parameters, the ones Apple uses:** damping ratio and response. 1.0 damping (no overshoot) is the default everywhere. 0.8 (a little bounce) is used only after a gesture that carried momentum, the thrown drug panel.
- **Gestures (`sheet.tsx`):** the panel follows the pointer 1:1 from where it was grabbed, resists past its open edge (rubber-band), decides open or closed from where the release velocity would carry it (Apple's projection formula) instead of where the finger let go, and hands that velocity to the spring so there is no seam.
- **Only transform, opacity, filter and clip-path are written,** straight to the element and never through React state, so a frame costs no layout and no re-render. List reorder is FLIP: the row keeps its on-screen place and springs to the new one. A card that changes height holds its layout and moves a clip instead.
- **Feedback is on pointer-down.** Buttons answer the press, not the release. Keyboard actions do not animate.
- **Reduced motion** swaps slides for short opacity fades. Reduced transparency and increased contrast replace the translucent materials with solid ones.

## Loop recorder (`tools/capture.ts`)
- **Why:** the landing page shows the real app in motion. A screen recording drops frames and is different every time; these loops are rebuilt from the code with one command.
- **How:** Playwright opens the built app with `?capture`. In that mode the motion clock never runs by itself. The recorder steps it by exactly 1/60 s, takes one PNG, and repeats; ffmpeg stitches the PNGs into H.264. The pointer is real mouse input, moved along the same spring maths.
- **Seamless by check, not by eye:** each scene must end in the state it began in. The recorder compares the frame after the last one with the first and refuses to write a loop that would jump.
- **A guard against cheating:** every frame it asks the browser whether any CSS or Web Animations animation is running and fails if so.
- **Colour:** frames are converted to BT.709 and tagged, so the video matches what the app drew.
- **The loops carry the banner.** They are recorded from whatever data the app has. With no real bundle that is the synthetic demo, the banner is in every frame, and `public/loops/manifest.json` records it so the landing page captions them.

## Synthetic demo bundle (`tests/fixture.ts`, `demoFixture`)
- **Why it exists:** the UI and its recorded loops need something to show before the real run is curated and docked.
- **Why it cannot be mistaken for a finding:** names are "Compound A" to "Compound N" and "Control X/Y", targets are "SYN1" to "SYN3" with PDB IDs starting with 0 (the PDB never assigns those), and every number comes from a seeded generator. Real drug names with made-up scores were ruled out: that would read as a result.
- **It lives with the test fixture** because that is the one place synthetic data is allowed.

## 3D pose viewer (`web/src/app/PoseViewer.tsx`, `lib/bundle/pose.ts`)
- **3Dmol.js, saved in `public/vendor/`:** an open-source (BSD-3) WebGL molecule viewer that is standard in research tools. Keeping a copy in the repo, instead of loading it from a CDN, keeps the demo working offline. It's only downloaded when someone opens a drug.
- **Receptor files ship with the bundle:** `build_run_bundle.py` copies `data/raw/pdb/<PDB>.pdb` (the same file given to DiffDock) into the bundle. Fetching from RCSB at demo time would break the offline promise.
- **Pocket computed in our code, not 3Dmol's `within`:** any residue with an atom within 5 Å of the ligand is drawn as sticks. The rule is easy to explain, and 3Dmol's cross-model selection didn't filter correctly in testing.
- **Hetero atoms in the receptor are hidden:** receptor files often keep crystal waters and the original ligand, which would be confused with the predicted pose.
- **Labelled on screen as a prediction, not an experimental structure**, with the PDB ID and DiffDock confidence. When the receptor file is missing, the drug is shown alone and the app says so.
- Checked visually with PDB 1HSG (HIV-1 protease and indinavir) from RCSB as a known-good structure, which was then removed from the repo.

## Real data pipeline (`tools/fetch_public_data.py`, `reference/`)
- **Docking data** comes from the tree26 DiffDock run (TreeHacks 2026, MIT), copied in full to `reference/`. The originals are left untouched, and our corrections are applied on import, so anyone can diff them.
- **Corrections, each with its evidence:**
  - The 2FMA results are dropped: 2FMA is APP's copper-binding domain, not ERK2.
  - The 9IAY target is not a G12D mutant: residue 12 is glycine.
  - The tree26 `fda_status` strings are thrown away and every fact is re-fetched.
- **Each access fact has exactly one authoritative source, and its URL and retrieval date are logged** (`data/curation/provenance.json`):
  - approval: ChEMBL max_phase
  - generic: FDA Orange Book ANDA, falling back to the openFDA NDC directory for OTC monograph drugs like aspirin, which the Orange Book mostly omits
  - WHO list: an exact name or official-synonym match in the WHO eEML
  - trials: ClinicalTrials.gov v2
  - safety and storage: the openFDA label (boxed warning; storage temperature)
- **"Unknown" is never turned into "no"**, except where it's true by definition: a compound with no approval can't have a generic or be on the WHO list.
- **Identity matching:** first by exact InChIKey, then by the InChIKey connectivity block (salts, stereo forms), then by name. The name match is only accepted when PubChem independently maps that name to the same CID; that last step is what catches doxycycline, which was drawn as a tautomer.
- **Positive controls** are compounds with a *measured* ChEMBL pChEMBL ≥ 6 against KRAS. That makes them independent of docking, which is what a validation set needs.
- **HTTP responses are cached** in `data/raw/http/`, so reruns are reproducible and offline.

## What the real data says (keep this honest in the video)
- **Docking:** DiffDock confidence did not separate the 38 measured KRAS binders from the other 31 compounds. ROC-AUC is 0.39 (95% CI 0.25–0.52), which is no better than chance. One DiffDock run on one structure is weak evidence, and the Validation screen should say so plainly.
- **ML:** the KRAS model scores ROC-AUC 0.865 on a scaffold split (5,082 measurements, 2,738 compounds). But all seven affordable leads are outside its applicability domain (nearest-neighbour Tanimoto similarity 0.08–0.22), so the model can't vouch for them, and the app shows "too different" instead of a score.
- **Takeaway:** the docking leaderboard is a list of hypotheses that need lab tests, and the approved-drug screen (`tools/screen_approved.py`) adds evidence that doesn't depend on docking at all.

## Model comparison (`train_activity_model.py --cv`)
- Every target compares a random forest, a logistic regression and a Tanimoto nearest-neighbour baseline, using 5-fold GroupKFold where each Murcko scaffold stays in one fold. That way the chosen model is backed by a number, and "is ML better than nearest-neighbour lookup?" has an answer.

## Approved-drug screen (`tools/screen_approved.py`)
- Every ChEMBL max_phase-4 small-molecule parent (about 3,500) is scored against KRAS, ERK2, MEK1, SOS1 and SHP2.
- **A measured value always beats a prediction.** Predictions are only reported inside the applicability domain, and out-of-domain drugs are counted but never ranked.
- Top hits get the same access lookups as the docked set, so the screen answers "what is promising *and* obtainable?" too.

## Storage band for the Bench Companion (`lib/device/storage.ts`)
- The device's alert range is the overlap of the shortlisted drugs' FDA label storage temperatures (today's shortlist gives 20–25 °C). It is no longer a hard-coded fridge range. If the labels disagree, the UI says so and falls back to 2–8 °C. The virtual device simulates temperatures around the real band, so a room-temperature shortlist doesn't trigger false "too cold" alarms.
