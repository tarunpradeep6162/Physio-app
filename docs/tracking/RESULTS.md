# Tracking work: measured results by phase

The environment is the same as the [Phase 1 baseline](PHASE1_BASELINE.md) unless a row says otherwise: headless Chromium 141, 4 vCPU, **software WebGL (SwiftShader, no GPU)**, and a fake camera playing the rendered heel-slide clip at 360×640, 30 fps. **Real-phone results are outstanding.** The device procedure is at the end of the baseline document.

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
