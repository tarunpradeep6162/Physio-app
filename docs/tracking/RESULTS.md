# Tracking work: measured results by phase

## Follow-up after the brand release

The capture screen now clears its displayed angle and skeleton if no processed frame arrives for 750 ms. It feeds invalid samples to the recorder so a repetition cannot bridge the gap. A worker frame that has not returned in 1.5 s fails over to the main-thread provider; the capture's existing engine-change guard invalidates an attempt that changes providers. This is a code and unit-test result, **not a measured phone improvement**. Use the [phone run sheet](PHONE_RUN.md) to check it on real devices, especially on a slow phone and when the camera stream stops.

The environment is the same as the [Phase 1 baseline](PHASE1_BASELINE.md) unless a row says otherwise: headless Chromium 141, 4 vCPU, **software WebGL (SwiftShader, no GPU)**, and a fake camera playing the rendered heel-slide clip at 360×640, 30 fps. **Real-phone results are outstanding.** The device procedure is at the end of the baseline document.

## Dheepika Lab Phase 2: shoulder scenarios and sustained telemetry (container, rendered figures)

Real BlazePose Lite, CPU, same container. Values are for the live display chain. These are rendered figures, **not people and not accuracy**.

| Scenario | Invalid rate | Unsafe frames | Peak error / lag | Main refusal reasons |
|---|---|---|---|---|
| Shoulder flexion, side view, 5→150° | **0.70** | 0 | 1.2° / 40 ms | orientation uncertain (175), re-acquiring (111) |
| Shoulder abduction, front view, 5→140° | 0.04 | 0 | −1.2° / 40 ms | re-acquiring (15) |
| Abduction, elbow hidden behind an object from 5 s | 0.10 | **179** | — | the model reported the hidden elbow visible in 208 of 209 frames |
| Flexion measured for the left arm with the right side facing the camera | 1.00 | 0 | — | occluded, orientation uncertain |

Findings for Phase 3:
- **Side-view flexion loses orientation** as the arm goes overhead: most frames are refused. This costs coverage, not safety.
- **A hidden elbow is invented by the model.** Segmentation support was also tested (`seg=1`): the mask marked the hidden elbow as on the body in 181 of 209 frames, and 172 unsafe frames remained. **Segmentation does not solve this case.**

**Sustained telemetry.** A 60 s worker run on the fake camera gave two 30 s windows at 11.8 and 11.4 fps, inference p50 77.4 ms in both. Slowdown ratio 1.00, fps ratio 0.97. Inference was slower than in the Phase 3 table (45 ms) because this container was under concurrent load at the time. **Container timings vary with load and are not phone figures.**

## Phase 2: diagnostics console

Validation Mode now separates four stages: **camera frame → pose output → filter → measurement**. It highlights the first stage that is not OK.

Verified in the browser with the real model, and the export was checked. On the heel-slide clip the console reported:
- camera ok (29.9 fps);
- pose: *required landmark visibility down to 0.54*;
- measurement: *value in 13% of frames, mostly wrong orientation*.

That reproduces the Phase 1 findings without the lab. In the first version, stale frames caused by slow inference were blamed on the camera. Attribution was fixed and covered by a test: slow inference is a pose-stage finding, and time spent *waiting* before analysis is a camera/scheduling finding.

The diagnostics export (`physiovision-tracking-diagnostics` v1, JSON) contains:
- timing per frame (capture age, presented-frame counter, inference ms);
- persons, status and view;
- required-landmark visibility and the jump rate;
- raw, smoothed and reported angle, plus the reason for any refusal;
- the lighting luma;
- provider, delegate, thresholds and camera settings.

It contains **no video, images or identifiers**. Landmark coordinates are included only when the checkbox is ticked.

## Phase 3: inference off the UI thread

The implementation:
- A classic Web Worker (`src/engine/pose/pose.worker.ts`) owns BlazePose. It has to be classic because the MediaPipe WASM loader needs `importScripts`; in a module worker it fails with "ModuleFactory not set".
- Each camera frame is sent as a transferred `ImageBitmap`, stamped with its **camera capture time**.
- At most **one frame is in flight**. When a result arrives and a newer frame already exists, that newest frame is sent immediately, so frames never queue.
- An epoch counter drops results that belong to a reset or paused session. Bitmaps are closed in the worker. The worker is closed, then terminated after 500 ms.
- **Fallback**: without `Worker`, `OffscreenCanvas` or `createImageBitmap`, or if the worker fails to start, inference runs on the main thread as before. If the worker dies mid-session, the runtime switches to the main thread and records the reason.
- The thread and the reason are shown in Validation Mode and stored in the provider `config.thread` in capture provenance.

### Before and after, same clip and same measurements (lab live benchmark)

| Delegate | Loop | Inference fps | Inference ms p50 / p95 | Result age p50 / p95 | UI frame gap p95 / max | Main-thread long tasks |
|---|---|---|---|---|---|---|
| CPU | main thread (before) | 17.1 | 55 / 73 | 73 / 95 ms | 74 / 341 ms | 937 ms per s |
| CPU | **worker** | 19.1 | 45 / 63 | 74 / 100 ms | **18 / 38 ms** | **0** |
| GPU* | main thread (before) | 1.2 | 616 / 650 | 625 / 659 ms | 664 / 3688 ms | 980 ms per s |
| GPU* | **worker** | 1.1 | 672 / 786 | 702 / 799 ms | **18 / 29 ms** | **0** |

\*GPU here is the software renderer.

### In the app (Validation Mode, real model, app default delegate)

| Thread | UI frame gap p95 / max | Long tasks | Click → paint median / max |
|---|---|---|---|
| Worker (auto) | 25 / 847 ms | 0 ms per s | **31 / 857 ms** |
| Main (fallback) | 768 / 792 ms | 1159 ms per s | 1450 / 1499 ms |

### What this does and does not show

- The worker **removes UI blocking**: taps respond in about 30 ms instead of about 1.5 s. It gives a small inference-rate gain on CPU (17 → 19 fps) because capture and inference overlap.
- It does **not** fix a slow delegate. At ~650 ms per frame the rate stays ~1 fps and results stay ~0.7 s old, so the tracking rate is a Phase 5 problem. The isolated 0.85 s hitch in worker mode happens only with the software-GPU delegate: software WebGL runs in the shared GPU process and stalls page compositing too. It did not occur on the CPU delegate.
- Real-phone numbers are still required. Hardware GPUs behave differently.

## Phase 4–5: camera acquisition and pose configuration

The matrix below was run in the tracking lab **on the Phase 1 pipeline**, so only the camera/model setting changes between rows. Real model, CPU delegate unless noted; "unsafe" counts frames that showed a number while the required joint was hidden or not the tracked person. Raw files: `mx-*.json` (kept in the working scratchpad; the numbers are reproduced here).

| Setting | Inference p50 / p95 ms | Heel slide: peak error ° / lag ms | Knee occlusion: unsafe frames | Second person: unsafe frames | Stationary supine jitter ° |
|---|---|---|---|---|---|
| Lite, 720×1280 (kept) | 51 / 67 | 6.0 / 90 | 3 | 44 | 3.42 |
| Lite, 360×640 | 51 / 71 | 6.1 / 80 | 4 | **104** | 3.11 |
| Lite, 540×960 | 50 / 74 | **10.3** / 90 | 3 | **90** | 3.02 |
| Lite, 1080×1920 | **64 / 82** | 7.2 / 90 | 4 | 42 | 4.45 |
| Lite, thresholds 0.7 | 52 / 68 | 6.5 / 80 | 4 | 40 | 2.62 |
| Lite, GPU (software WebGL) | **615 / 719** | 9.9 / 80 | – | – | 3.37 |
| Full, 720×1280 | 67 / 84 | 1.3 / 80 | 1 | 40 | 0.66 |
| Full, thresholds 0.7 | 69 / 102 | 1.7 / 80 | 1 | 39 | 0.63 |

Decisions:
- **720p is kept.** Lower resolutions let a bystander take over more often; 1080p costs about 25% more inference time for no gain.
- **The delegate is measured, not assumed.** `delegateChoice.ts` times both delegates on the first frames and keeps the faster one (cached per device in localStorage). On this machine the GPU delegate gives the same landmarks about 12× more slowly, so CPU wins. On a phone with a hardware GPU the probe may choose GPU. **The engine is never switched during a capture**: the capture screen blocks a switch while probing or recording.
- **Detection thresholds of 0.7** reduced the effect of phantom detections in low light for the Full model (low-light lag 800 → 50 ms, peak error 59.5° → 3.9°). For Lite they made no material difference, so the default stays at 0.5. The thresholds in use are recorded in provenance.
- **Lite stays the default** (see Phase 6–8 below for why Full was not adopted).

Per-test setup (P4): each 1.1.0 protocol carries a `framing` rule (which landmarks must span how much of which axis, the recommended orientation and the maximum roll) and an illustrated `guide` (camera, distance, view, region, lighting, clothing). Calibration judges distance on the tested region, not the whole body.

## Phases 6, 8 and 9: identity, strict occlusion, orientation

Before-and-after on every lab scenario is in the [release gate report](../RELEASE_GATE_REPORT.md#measured-improvements-versus-phase-1). Raw data for the shipped configuration: [`phase20-lite.json`](phase20-lite.json) and [`phase20-full.json`](phase20-full.json).

What each part does:
- **Identity (P6)** — `identity.ts` flags these events, then withholds values for at least 500 ms / 3 frames:
  - the body centre moving faster than 5 torso-lengths per second;
  - a scale change over 35% within 400 ms;
  - a left/right limb swap, detected by crossed assignment;
  - a gap over 500 ms.

  It never re-labels landmarks: a swap is refused, not "corrected".
- **Strict occlusion (P8)** — a required landmark counts only if all of these hold:
  - it is inside the frame and outside a 4% edge band, where the model extrapolates off-image joints with high confidence;
  - its visibility is at least the threshold;
  - where segmentation is enabled, it is on the person mask.

  The **phone screenshot case** is caught by a separate rule: hand points inside the torso outline withhold shoulder level, pelvic level and trunk lean, and ask the person to lower their hands. Visibility and segmentation both **failed** to detect that phone in testing. Measured: in all 120 hidden frames, the model reported the covered landmarks as visible **and** the segmentation mask placed them on the body. That is why the rule is geometric.
- **Orientation (P9)** — the near side comes from the anatomical cross product of the shoulder line and the facing direction, rather than from which landmarks look more visible. Other safeguards:
  - it is voted over 400 ms;
  - a confirmed lateral side is locked per identity, so weak depth cues cannot flip it;
  - the simulator now produces only physically possible mirrored scenes.

## Phase 7: filters versus lag

Filter chains were compared offline on **real-model landmarks from the rendered figures** (`src/lab/fixtures/lab-landmarks-v1.json`, reproducible with `filterStudy.test.ts`). Values: stationary jitter SD (°) / heel-slide lag (ms) / fast heel-slide peak error (°).

| Chain | Supine jitter | Standing jitter | Heel-slide lag | Heel-slide peak err | Fast peak err |
|---|---|---|---|---|---|
| v1.0 default: coordinate 1€ + angle 1€ | 2.60 | 10.36 | 90 | 2.7 | 8.2 |
| Raw, no filter | 10.20 | 5.77 | 10 | 17.2 | 16.6 |
| Coordinate 1€ only | 4.03 | 10.03 | 50 | 7.7 | 13.1 |
| Angle 1€(1.2, 0.015) only — **live display** | 4.26 | 3.00 | 50 | 7.2 | 10.6 |
| Angle EMA 110 ms | 3.35 | 2.70 | 100 | 4.8 | −4.4 |
| Angle Kalman | 3.11 | 2.74 | 50 | 11.4 | 14.0 |
| Guard + zero-phase median ±100 ms | 6.06 | 2.51 | 30 | 3.1 | 2.1 |
| **Guard + zero-phase median ±100 + mean ±150 ms — stored** | 3.72 | **2.11** | **30** | 3.2 | **0.0** |
| Guard + zero-phase median ±150 + mean ±200 ms | 2.96 | 2.07 | 20 | 3.1 | −7.4 (flattens peaks) |

Findings:
- Smoothing **coordinates** made standing jitter worse (10.4° vs 3.0° with the angle filter alone) and added lag, because noise in each landmark is not independent. Coordinates are no longer smoothed (`pipeline.ts` default `'none'`).
- For the **stored** value, a zero-phase (non-causal) chain removes the delay entirely and keeps the fast peak. The wider ±150/±200 chain starts to flatten peaks, so it was not chosen.
- Raw, guarded and stored values are all saved, with the chain and its parameters in the capture's `processing` record.

## Phase 19: mobile, accessibility and language QA

Automated journey at 360×780, 390×844 and 412×915 (patient: welcome → sign-up → consent → symptom map → history → safety → test plan → capture set-up → capture review), plus the clinician workspace at 390×844 and the training screen in landscape. Each screen was checked for horizontal overflow, targets under 24 px and axe-core (WCAG 2.0/2.1/2.2 A and AA rules). Chromium mobile emulation, not a real phone.

| Finding (first run) | Fix | Re-run |
|---|---|---|
| White on teal `#0d9488` = 3.74:1 on primary buttons | Teal darkened to `#0b7a70` (5.2:1) | axe clean |
| Table scroll regions not keyboard-reachable | `tabIndex=0`, `role=region`, label | axe clean |
| Welcome page 432 px wide at 360 (unbreakable button label) | Buttons wrap; demo row wraps | 0 px overflow |
| Clinician Test plan tab 99 px too wide at 390 | Protocol select capped at 100% | 0 px overflow |
| `aria-pressed` on `role=radio` safety answers | Removed | axe clean |
| Replay timeline 16 px tall; checkbox 20 px; "View all" 20 px | 32 px range, 24 px checkbox, 32 px link | ≥ 24 px |
| Skip link invisible when focused | Shown on focus | 48 px when focused |
| Body-map wrists/ankles 13×10 px | Added an equivalent **"Choose areas from a list"** control (WCAG 2.5.8 equivalent-control exception); zoom remains | list chips 44 px |

Result: **no axe violations on any audited screen**, no horizontal overflow except 2 px on the 360 px history screen, sign-up disabled until the pilot acknowledgement is ticked, and no page errors. Remaining: body-map shapes are still small by themselves; not tested with a real screen reader (VoiceOver/TalkBack) or on a real phone. **Language:** the new strings from these phases are English only; Tamil falls back to English for them and needs a clinical translation review before use.
