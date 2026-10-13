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
