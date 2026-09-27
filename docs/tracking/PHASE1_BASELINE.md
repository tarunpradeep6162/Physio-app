# Phase 1: tracking baseline (before any pipeline tuning)

Recorded on 2026-09-27 at commit `21db727` plus the measurement tooling only. The pipeline behaviour measured here is the code as it stood at `21db727`. The tooling added no behaviour changes: provider accepts a canvas, camera takes constraints, and the simulator's physically impossible scenes were fixed. Raw data: [`phase1-baseline.json`](phase1-baseline.json).

## How it was measured

No phone and no consenting participant are available in this environment. Two things were used instead, both reproducible:

1. **Tracking lab** (`/lab.html`, source `src/lab/`).
   - It renders a synthetic ground-truth skeleton as a shaded **mannequin**.
   - It applies real-world perturbations: sensor noise, 22% brightness, motion blur, a phone over the torso, an object over the knee, a crop, a mirrored stream, a second person, and 3 fps processing.
   - It runs the **real MediaPipe BlazePose model** and **the app's own pipeline** (coordinate filter → gated measurement → angle filter) on those frames.
   - Ground truth is the rendered skeleton. It is *test imagery, not a person*. Offsets between the model and the cartoon joints reflect drawing conventions, so **no number below is an accuracy figure**.
2. **Live loop benchmark** (same page, "Live camera benchmark").
   - This is the app's real loop: `getUserMedia` → `requestVideoFrameCallback` → synchronous `detectForVideo`.
   - Here it was fed by Chromium's fake camera playing a rendered heel-slide clip (`?make=y4m`).

Device for all rows: cloud container, headless Chromium 141, Linux x86-64, 4 vCPU, 8 GB. **No GPU**: WebGL is SwiftShader, a software renderer. Pose model MediaPipe `tasks-vision@1.0.1`, BlazePose **Lite**.

**Real-device rows are outstanding.** The procedure is at the end of this document.

## Live loop (the app's synchronous main-thread loop)

| Device / browser | Camera | Camera fps delivered | Delegate | Inference fps | Inference ms p50 / p95 / max | Result age capture→landmarks p50 / p95 | Camera frames skipped | UI: longest frame gap | Main-thread long tasks | Observed symptom |
|---|---|---|---|---|---|---|---|---|---|---|
| Container, headless Chromium 141, SwiftShader | 360×640 fake | 28.4 | **GPU (app default)** | **1.1** | 662 / 736 / 3789 | 684 / 763 ms | 344 of ~350 | **3.8 s** (p95 0.74 s) | **944 ms per s** | Interface frozen; skeleton ~0.7 s behind the body; 1 of 30 frames analysed |
| same | same | 29.8 | CPU | 17.3 | 54 / 70 / 281 | 71 / 98 ms | 151 | 0.3 s (p95 76 ms) | 849 ms per s | Usable rate, but main thread still ~85% busy, so the UI stutters |

The app always requests the GPU delegate. It falls back to CPU only if creating the GPU delegate *throws*. On software WebGL the GPU path succeeds but is about **10× slower**:

| Model | GPU | CPU |
|---|---|---|
| Lite | ~650 ms per frame | ~62 ms per frame |
| Full | ~830 ms per frame | ~74 ms per frame |

The same can happen on phones whose WebGL is blocklisted or slow.

## Scenario baseline (real model, app pipeline, CPU delegate, 30 fps camera)

- *Jitter*: SD of the angle while ground truth is still.
- *Lag*: time shift that best aligns the output with ground truth.
- *Invalid*: share of frames where a value was possible but none was given.
- **UNSAFE**: frames where a number was produced although a required joint was hidden or another person was in view.

| Scenario (failure mode) | Inference ms p50 | Landmark dropout | Jitter at rest: raw / app output | Lag: raw / app output | Peak error (app output) | Invalid-frame rate | **Unsafe values** | Observed symptom |
|---|---|---|---|---|---|---|---|---|
| `rest_supine`: stationary jitter, lying | 55 | 0% | 10.3° / 3.4° | — | — | 0% | 0 | Noticeable jitter while still; the output is steadier but not steady |
| `rest_standing`: stationary jitter, side view | 53 | 8% | **35.3° / 8.2°** | — | — | 8% | 0 | The bent near knee and the straight far knee overlap. The model intermittently swaps or merges legs, giving spikes such as 20° → 124° |
| `heel_slide`: normal speed | 53 | 7% | 3.9° / 0.7° | 20 / 90 ms | +6° | **43%** | 0 | View flips to the wrong side as the knee bends, from noisy model depth, so the measurement is refused for 43% of frames |
| `heel_slide_fast`: 0.56 s up, motion blur | 50 | 6% | — | 0 / 60 ms | +8° | **48%** | 0 | As above; blur adds little |
| `low_light`: 22% brightness, noise | 57 | **98%** | 26° / — | — | — | **100%** | 0 | The model reports phantom **second people** in 264 of 360 frames, and the view is unknown. Nothing is measured, which is safe, but the calibration's lighting check should stop this before capture |
| `slow_inference`: 3 fps | 52 | 14% | — | 20 / 20 ms | +0.5° | **58%** | 0 | The 9-frame orientation vote spans 3 s at this rate, and view errors persist |
| `side_view_right`: right side to camera | 51 | 10% | — | unreliable | **+127°** | 23% | 0 | The model under-reads the bending leg (the overlap again). One frame read 176° (knee folded backwards), and that impossible jump reached the output |
| `mirrored_stream`: front camera image mirrored | 51 | **98%** | — | — | — | 100% | 0 | A mirrored left side is anatomically a right side, and the model labels it so. Nothing was measured *for the left test*; a right-side test would have measured the wrong leg. Frames must never be mirrored before inference |
| `phone_occlusion`: phone over torso and hips, front view | 54 | — | — | — | — | — | **120 of 120** | **The pelvic-level estimate was produced in every frame with both hips hidden.** The model reported hip visibility ≥ 0.6 in 120 of 120 hidden frames. *Visibility cannot detect an object in front of the body* |
| `knee_occlusion`: object over the tested knee | 51 | 11% | 3.6° / — | 140 / 90 ms | +9° | 59% | **3** | The model reported the hidden knee as visible (≥ 0.6) in 42 of 179 hidden frames, and 3 values got through |
| `partial_body`: ankles below the frame | 51 | — | — | — | — | — | **43** | Posture metrics have **no in-frame check**. The model extrapolated off-frame ankles with visibility ≥ 0.6, so knee alignment was produced from invisible ankles |
| `leave_frame`: walks out and back | 50 | 12% | 36° / 2.3° | — | — | 14% | 0 | Correctly withheld while out. Re-acquired in 0.3 s with no stability window. Raw spikes from leg overlap |
| `second_person`: bystander walks in | 52 | 0% | 1.8° / 0.5° | — | — | 0% | **44** | The model detected only one person while the bystander was partly in view. Values kept flowing and **nothing detects an identity change** |

## What the baseline says (ranked)

1. **Safety: hidden joints still produce numbers** (phone, partial body, knee occlusion). Model visibility is not a sufficient occlusion test, and the posture metrics skip the in-frame check. → Phase 8.
2. **Performance: the delegate choice and the main-thread loop.** The GPU delegate on software WebGL gives about 1 fps and a frozen UI. Even at 17 fps the synchronous loop monopolises the main thread. → Phases 3 and 5.
3. **Wrong-side views in lying tests**, from model depth (z) noise. **Leg overlap/swap in side views**, with physically impossible jumps passed through. → Phases 6, 8 and 9.
4. **No identity continuity.** A bystander or a re-entering person is not detected as a change. → Phase 6.
5. **Low light produces phantom people.** The lighting gate must block capture. → Phase 4.
6. **Mirroring.** The pipeline must only ever see un-mirrored camera frames, and provenance must record this. → Phases 4 and 9.
7. **Frame-count-based smoothing and voting.** Their behaviour changes with frame rate: the 9-frame vote spans 0.3 s at 30 fps but 3 s at 3 fps, and the filter reset window is 350 ms. → Phase 7.
8. **Double smoothing:** landmarks are One-Euro filtered and then the angle is filtered again. That is extra lag (up to 90 ms here). → Phase 7.

Also found: `tasks-vision` tries to POST usage logs to `odml.pa.googleapis.com`. Our CSP blocks it. That is the desired behaviour; no pose data leaves the device.

## Fixture bug found and fixed while establishing the baseline

`synthesize()` produced physically impossible scenes: a "left" supine heel slide with the head at image-left shows the *right* side, and so did a "right" standing view facing image-left. Pure-landmark unit tests could not notice. The real model immediately labelled them as the other side. Those scenes are now mirrored so each one is a real view. Angles are unchanged, and all existing tests still pass.

## Real-device procedure (outstanding)

On each target phone (at minimum one mid-range Android on Chrome, and one iPhone on Safari):

1. Open `https://physiovision-ai-eta.vercel.app/lab.html`.
2. Press **Run scenarios** with Model = Lite and Delegate = App default. Then repeat with Delegate = GPU and with Delegate = CPU.
3. Press **Live camera benchmark** with the phone on a stand, the camera facing a consenting volunteer who holds still for 5 s and then does slow heel slides.
4. Press **Download JSON** after each run and attach the files with the device model, OS and browser version.
5. Record the phone's temperature (warm / hot) after 5 minutes of the live benchmark.

The lab stores and uploads nothing. The live benchmark keeps no video.
