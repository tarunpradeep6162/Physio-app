# Release gate and delivery report (Phase 20)

**Date:** 2026-09-27. **Branch:** `claude/physiovision-ai-platform-49ysp2`. **Live:** https://physiovision-ai-eta.vercel.app (Vercel production, READY at commit `70c3891`, which carries all of the Phase 4–19 code; this report and the results document follow in a docs-only commit).

## Readiness level

| Level | Verdict | Why |
|---|---|---|
| **Demo** | **Ready** | The demo data is labelled simulated. Every camera number in it comes from engine runs over synthetic landmarks. The app refuses to show values it cannot support. |
| **Validation study** | **Tooling ready. Not started.** | Reference-measure entry, a per-person tuning/evaluation split, release thresholds that must be locked before evaluation, agreement statistics and a draft protocol all exist. There is no participant data, the thresholds are not set, and the clinical lead has not confirmed the protocol. |
| **Real patients** | **Not ready** | Data is stored only in the browser. The server layer is tested but not deployed. There has been no real-device verification and no agreement study. Every clinical rule is still a draft. Sign-up now makes each new account acknowledge this. |

## What was and was not possible here

- **No phone and no consenting participant were available.** Every tracking figure below comes from the **tracking lab** (`/lab.html`), run in the cloud container:
  - The lab renders a synthetic skeleton as a shaded mannequin and adds real-world perturbations.
  - It then runs the **real BlazePose model** and the app's own pipeline on those frames.
  - These are **rendered test figures, not people**. The lab's ground truth is a drawing convention, so no figure here is an accuracy claim.
- **Environment:**
  - headless Chromium 141 on Linux x86-64, 4 vCPU, 8 GB;
  - **software WebGL (SwiftShader), no GPU**;
  - live-loop runs used Chromium's fake camera playing a rendered clip.
- **Kept apart throughout:**
  - synthetic unit tests (vitest);
  - rendered lab figures (the lab);
  - real-model landmarks recorded from those figures (`src/lab/fixtures/lab-landmarks-v1.json`, used by the filter study).
  - **No real captures of any person were made.**
- **Real-device verification is outstanding.** The procedure is below.

## Per-phase table

Status key:
- **Done (sim)**: implemented and verified on synthetic or rendered data; real-device verification is still outstanding.
- **Done**: fully verifiable here and verified.
- **Partial**: some of the phase remains; the limitation column says what.

| # | Change | Evidence | Test result | Limitation | Status |
|---|---|---|---|---|---|
| 1 | Tracking lab, scenarios, metrics, live benchmark, baseline | `docs/tracking/PHASE1_BASELINE.md`, `phase1-baseline.json` | 13 scenarios measured on the real model | Rendered figures, not people | Done |
| 2 | Diagnostics console with stage attribution (camera → pose → filter → measurement), JSON export | `diagnostics.ts`, Validation Mode | 4 unit tests; reproduced the P1 findings in the browser | — | Done |
| 3 | Inference in a classic Web Worker: one frame in flight, newest frame first, capture timestamps, epoch guard, main-thread fallback | `pose.worker.ts`, `workerProvider.ts`, RESULTS §3 | Long tasks 937 → 0 ms/s; click→paint 1450 → 31 ms | A slow delegate is still slow | Done (sim) |
| 4 | Acquisition at 720p; per-test framing (region-based distance, orientation, roll) and an illustrated setup guide | `knee.ts` `framing` / `guide`, `SetupGuide.tsx` | Heel slide framed on the leg passes with the head out of frame (test) | Phone camera APIs are untested | Done (sim) |
| 5 | Resolution / model / delegate / threshold matrix; measured delegate probe; no engine switch mid-capture | RESULTS §4–5, `delegateChoice.ts` | 4 probe tests; switch blocked during capture; engine change invalidates a capture (test) | Hardware GPU not measured | Done (sim) |
| 6 | Identity guard (jump, scale, limb swap) and re-acquisition window | `identity.ts` | 2 tests; bystander unsafe frames 44 → see measured table | The model itself sometimes locks onto the bystander | Partial |
| 7 | Filter study. No coordinate smoothing; live angle uses One Euro; stored signal zero-phase; raw values and filter config kept | RESULTS §7, `filterStudy.test.ts` | Fast-peak error 8.2° → 0.0°, lag 70 → 0 ms (stored chain vs v1.0 on recorded model output) | Recorded model output from rendered figures only | Done (sim) |
| 8 | Strict occlusion: 4% edge band, per-landmark visibility, optional segmentation support, hands-in-front rule, plausibility guard, 250 ms recovery, interrupted reps not counted | `measurements.ts`, `posture.ts`, `signalGuard.ts`, `stateMachine.ts` | 8 tests. Phone-over-torso unsafe frames 120 → 0 | A free-standing object over the torso without hands is not detected | Partial |
| 9 | Anatomical orientation, 400 ms vote, sticky lateral lock; physically consistent mirroring in the simulator | `pipeline.ts`, `orientation.test.ts` | 9 tests | First heel-slide cycle on the mannequin can still read the wrong side | Done (sim) |
| 10 | Protocols 1.1.0 (`pv-knee-1.1.0`); 1.0.0 kept in HISTORY; records keep their version | `knee.ts`, `KNEE_PROTOCOL.md` | "keeps v1.0.0 definitions" test; v1.0 rep behaviour preserved | Clinical lead has not reviewed | Done |
| 11 | Geometry audit: source landmarks and calculation in the Why? panel; "not measurable in this view"; missing joints named | `ClinicianWorkspace.tsx` `CaptureCalculation`, `landmarks.ts` | Verified in the browser; calibration names covered joints (test) | — | Done |
| 12 | Attempted, completed and invalid reps stored with reasons; live counter equals saved result | `cycles.ts`, `reps.test.ts` | 5 tests, including 8 fps and wrong leg | Not compared with video annotation | Done (sim) |
| 13 | Validation tooling: reference measures, split, locked thresholds, Bland–Altman/MAE/ICC; draft study protocol | `validationStats.ts`, `validationData.ts`, `ValidationStudy.tsx`, `docs/validation/STUDY_PROTOCOL.md` | 5 tests (ICC matches Shrout & Fleiss 0.29) | **No data collected** | Partial |
| 14 | Calm live feedback: joint status bar, stable cues, unmistakable paused state that names the joints | `StageParts.tsx`, `ProtocolCapture.tsx`, `MotionMirror.tsx` | Verified in the browser on the simulator | Not tested on a phone | Done (sim) |
| 15 | Static scan review: level lines only when valid; torso measures withheld when hands are in front | `StaticScan.tsx`, `posture.ts` | Tests for occluded and out-of-frame landmarks and hands in front | — | Done (sim) |
| 16 | Evidence gating: rejected, obsolete or low-confidence readings excluded; a scan crossing alone cannot make a consideration supportive | `evidence.ts` | Phase 16 test and valid-capture-only test | Rules are drafts | Done |
| 17 | Report verification: review state re-checked; data or plan changes revert approval | `report.ts` | Rejected metric not reported; approval reverts (tests) | — | Done |
| 18 | Server boundary: forced RLS, consent triggers, hash-chained audit, retention, hashed report tokens; explicit migration export; pilot acknowledgement at sign-up | `db/security.sql`, `db/security_test.sql`, `migration.ts`, `docs/BACKEND_ARCHITECTURE.md` | All security tests pass on PostgreSQL 16; migration export test | **No server deployed** (clinic owner's decision) | Partial |
| 19 | Mobile, accessibility and language QA at 360/390/412 px | RESULTS §19 | axe-core: 0 violations across 33 screen checks (3 phone widths, clinician workspace, landscape); no overflow (2 px on one screen); no page errors | No real screen reader or phone; Tamil strings for new keys pending | Partial |
| 20 | This report, the device procedure, and the release gate | this file | — | — | Done |

## Measured improvements versus Phase 1

Same scenarios, same machine, real BlazePose Lite, CPU. **Phase 1** is the pipeline at `21db727`. **Now** is the shipped configuration: no coordinate smoothing, live angle One Euro, identity, occlusion and plausibility guards (lab run `coordFilter=none`). Values are for the **live display** chain. Stored capture values additionally go through zero-phase smoothing (Phase 7 table).

"Unsafe" means frames where a number was shown although the required joint was hidden, outside the frame, or on another person.

| Scenario | Measure | Phase 1 | Now | Direction |
|---|---|---|---|---|
| Phone held over torso (the screenshot case) | unsafe frames | 120 | **0** | fixed |
| Part of body out of frame | unsafe frames | 43 | **0** | fixed |
| Object over the knee | unsafe frames | 3 | **0** | fixed |
| Second person walks behind | unsafe frames | 44 | **7** | better, not solved |
| Free-standing object over the torso (new scenario) | unsafe frames | not in P1 | **35** | **unresolved** |
| Side view, right leg | peak error ° / lag ms | 127.3 / 100 | **0.5 / 20** | fixed (the wrong leg had been measured) |
| Heel slide | frames refused for wrong orientation | 125 | **62** | better |
| Heel slide | lag ms / peak error ° | 90 / 6.0 | **30** / 6.4 | less lag, similar peak |
| Fast heel slide | frames refused for wrong orientation | 75 | **20** | better |
| Fast heel slide | lag ms / peak error ° | 60 / 8.2 | **10 / 5.1** | better |
| Standing still, knee bent 30° | jitter SD ° | 8.24 | **3.11** | better |
| Standing still | invalid frame rate | 0.08 | 0.72 | **worse**: re-acquisition pauses; see below |
| Lying still, heel slide held | jitter SD ° | 3.42 | 5.2 | **worse** on the live display (no coordinate smoothing); the stored chain is 3.7 |
| Sit-to-stand (new) | invalid rate / lag ms / peak error ° | not in P1 | 0.08 / 60 / −5.4 | — |
| Squat, front (new) | invalid rate / lag ms / peak error ° | not in P1 | 0.04 / 20 / −1.9 | — |
| Low light, mirrored stream | invalid rate | 1.00 | 1.00 | refused, as intended |

Main-thread and latency improvements are in `docs/tracking/RESULTS.md` §3: long tasks 937 → 0 ms/s; tap to paint 1450 → 31 ms.

**Honest reading**
- Every "unsafe" failure from the Phase 1 brief is fixed, except the bystander (reduced from 44 to 7) and a new, harder free-standing-object case (35) that is still open.
- The price is **more refused frames**: standing still is refused 72% of the time in this rendered scene, because the model's landmarks on the mannequin jump enough to trigger re-acquisition. This must be re-checked on real people before judging it. If it holds, the identity thresholds need tuning on the tuning split.
- Lying-still jitter on the *live* display is higher than before, because coordinate smoothing was removed to cut lag. Stored values are smoothed zero-phase.
- **Full model, same configuration**, compared with Lite ([`phase20-full.json`](tracking/phase20-full.json)):
  - lower rest jitter (1.85° vs 5.2°);
  - better fast-slide and sit-to-stand peaks;
  - but it refused **every** standing-still frame;
  - 99% of the right side view refused;
  - a 48.9° peak error on the slow heel slide;
  - **105** unsafe frames with the free-standing object (Lite: 35);
  - 30% slower inference (67 vs 52 ms).

  Lite stays the default.
- An earlier lab run with One Euro coordinate smoothing kept on (not shipped) gave lower jitter (4.0°) and fewer object-occlusion unsafe frames (11), but three times the heel-slide lag (90 ms). The trade-off was decided for low lag. It is worth revisiting with real traces.

## Devices and browsers

| Device | Browser | Result |
|---|---|---|
| Cloud container, 4 vCPU, software WebGL | Headless Chromium 141 | All figures in this report |
| Chromium mobile emulation 360×780, 390×844, 412×915, landscape 844×390 | same | Layout and accessibility QA only; not performance |
| Any real Android phone | Chrome | **Outstanding** |
| Any real iPhone | Safari | **Outstanding** |

## Phone FPS and latency

**Not measured.** No phone was available. Container figures with the fake camera, CPU delegate and worker loop:
- inference 19.1 fps;
- inference time 45 / 63 ms (p50 / p95);
- capture-to-landmark age 74 / 100 ms (p50 / p95);
- UI frame gap p95 18 ms.

These are **not** phone figures.

## Valid / invalid rates

See the measured table above. These are frame-level rates on rendered scenarios. A high invalid rate in a scenario designed to be unmeasurable (low light, mirrored stream, occlusion) is the intended outcome. No real-capture validity rates exist yet.

## Agreement

**No agreement study has been run.** No accuracy, bias, limits-of-agreement or ICC figure exists for any metric. The product shows none.

## Versions

| Item | Version |
|---|---|
| Knee protocols | `knee_supported_flexion`, `knee_sit_to_stand`, `knee_squat` @ **1.1.0** (1.0.0 retained for older records) |
| Algorithm | `pv-knee-1.1.0` |
| Pose model | MediaPipe `tasks-vision@1.0.1`, BlazePose **Lite** (default); Full is selectable in Validation Mode |
| Delegate | CPU or GPU, chosen per device by a measured probe; recorded in capture provenance |
| Inference thread | Web Worker, with a main-thread fallback; recorded in provenance |
| Stored-signal processing | Plausibility guard, then zero-phase median ±100 ms and mean ±150 ms; recorded per capture |

## Clinician-reviewed versus draft rules

**Every clinical rule set is a draft.** No approval is recorded in *Settings → Clinical rule approvals*. The drafts are:
- the history and safety questionnaires;
- the observation rules;
- the differential considerations;
- the test protocols 1.1.0;
- the report template;
- the release thresholds (empty).

Tamil text for strings added in these phases falls back to English and needs a clinical translation review.

## Privacy and backend status

- **Browser only.** Data is stored in the browser (localStorage). This is unsuitable for real patients, and sign-up requires acknowledging it.
- **No video.** The app never records or uploads video. Camera frames are processed on the device. Only landmarks and derived numbers are stored.
- **Blocked telemetry.** During these runs the Content Security Policy blocked the MediaPipe runtime's own usage-logging request to `odml.pa.googleapis.com`. No landmark data is sent anywhere.
- **Server layer tested, not deployed.** `db/security.sql` passes its tests on PostgreSQL 16 and found and fixed two defects in the earlier sketch. No database, API or identity provider was provisioned: that is the clinic owner's decision (`docs/BACKEND_ARCHITECTURE.md`).
- **Migration.** Browser data can move to a server only through the explicit, checksummed export in *Settings → Data boundary*. Demo rows, password hashes and images are excluded by default.

## Unresolved bugs and limits

**Post-report engineering update (2026-09-27):** the camera screen now withholds a stale reading when frames stop, and a worker timeout triggers fallback (commit `314318c`). The migration export now follows demo record relationships so child rows without a patient ID are excluded; an import-boundary integrity verifier is implemented but not connected to a server. Narrow-screen NPRS choices use four columns for larger tap targets. These updates do not change the real-device, clinical-approval, agreement-study or server gates below. The deployment row at the end of this historical report refers to the earlier measured release; check current Vercel deployment metadata for the latest commit.

1. **Free-standing object over the torso** (no hands on it): the model reports the covered landmarks as visible and on the body, so a value can still be shown. The held-phone case is fixed by the hands-in-front rule. The segmentation mask did not separate the object in tests.
2. **Bystander:** when the model itself switches to the second person without a large jump, the identity guard cannot tell. A few unsafe frames remain in the lab scenario.
3. **Heel slide on the mannequin:** some frames in the first cycle read the wrong side before the lateral lock settles. Those frames are refused, not mis-measured, but they reduce coverage.
4. **Full model:** more precise on the figures, but it drops tracking more often and did worse on the free-standing object. It is not the default.
5. **Accessibility gaps:**
   - the body-map shapes themselves are small (an equivalent list control now exists);
   - 2 px of horizontal overflow on the 360 px history screen;
   - not tested with VoiceOver or TalkBack.
6. **Browser smoke test of production** could not run here: headless Chromium does not trust the environment's egress proxy CA, and TLS checks were not disabled. Production was verified instead by HTTP checks: routes, `/lab.html`, the worker and the models return 200, and the hashed bundles are identical to the locally tested build.

## Real-device test procedure (outstanding)

Use one mid-range Android on Chrome and one iPhone on Safari. For the participant capture in step 3, use one consenting adult with written consent for landmark-only recording. Record no video.

1. **Lab and benchmark.** Open `https://physiovision-ai-eta.vercel.app/lab.html` on the phone.
   - Tap **Run scenarios** (Lite, then Full).
   - Tap **Live camera benchmark** with the front camera, then the rear camera.
   - Tap **Download JSON** and keep the file with the device model, OS and browser version.
2. **Diagnostics.** In the app, as a clinician, open Validation Mode. Run 60 s of the heel slide at the recommended placement, then **Export diagnostics**. Record:
   - camera fps and inference fps;
   - inference p50 / p95;
   - result age;
   - the delegate the probe chose;
   - the thread.
3. **Deliberate failure checks.** With the participant:
   - hold a phone in front of the torso;
   - cover the knee with a cushion;
   - step partly out of frame;
   - let a second person walk behind;
   - turn to the wrong side;
   - dim the room.

   Each must pause measurement and name the reason. No number may be shown while a joint is covered.
4. **Rep counting.** Do 3 heel slides, 5 sit-to-stands and 3 squats. Include one rep that is interrupted by briefly covering the knee. For every rep, compare the live count with the saved result (attempted / completed / invalid with reasons).
5. **Accessibility.** Walk the patient journey with TalkBack or VoiceOver, and with large text and high contrast switched on.
6. **Record the results** in `docs/tracking/RESULTS.md` under a new "Real devices" section, with the device, browser, date, model and delegate. Do not describe any figure as accuracy.

## Release gate

| Gate | Required for | Status |
|---|---|---|
| Build, typecheck, unit tests (120) | Demo | ✅ pass |
| Deployment verified at the exact commit | Demo | ✅ `70c3891` READY and aliased to production |
| No invented values, norms, severity or probabilities; demo labelled simulated | Demo | ✅ |
| Accessibility automated QA | Demo | ✅ axe clean (manual screen-reader test outstanding) |
| Real-device FPS, latency and failure checks | Validation | ❌ outstanding |
| Clinical lead approves protocol 1.1.0, the study protocol and the release thresholds | Validation | ❌ outstanding |
| Agreement study meets locked thresholds on the evaluation split | Real patients | ❌ not started |
| Server deployed (database, API, OIDC with MFA), migration import, retention job, audit verification | Real patients | ❌ not deployed |
| Privacy, security and regulatory review; penetration test | Real patients | ❌ not started |
