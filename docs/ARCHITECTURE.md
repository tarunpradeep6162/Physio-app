# Architecture

## Motion Intelligence Engine (`src/engine`)

```
CAMERA FRAME            camera/useMotionRuntime.ts  (requestVideoFrameCallback loop, outside React; capture timestamps)
  ↓
PERSON / POSE DETECTION engine/pose/*               (PoseProvider interface; MediaPipe in pose.worker.ts,
                                                     one frame in flight, newest first; main-thread fallback)
  ↓
IDENTITY                identity.ts                 (jump / scale / limb-swap → re-acquire for ≥ 500 ms)
  ↓
LANDMARK EXTRACTION     33-point BlazePose topology (other models map onto it in their adapter)
  ↓
CONFIDENCE FILTERING    pipeline.ts                 (low-visibility points bypass the smoother)
  ↓
TEMPORAL SMOOTHING      filters.ts                  (coordinates: none by default; live angle: One Euro;
                        zeroPhase.ts                 stored signal: zero-phase median ±100 ms + mean ±150 ms)
  ↓
PLAUSIBILITY            signalGuard.ts              (on measured angles: rejects impossible jumps; 250 ms recovery)
  ↓
ORIENTATION             pipeline.detectOrientation  (anatomical cross product, 400 ms vote, sticky lateral lock)
  ↓
BIOMECHANICAL CALC      measurements.ts / posture.ts (pixel-space angles; null when invalid)
  ↓
MOVEMENT STATE ENGINE   stateMachine.ts + exerciseRunner.ts
  ↓
FEEDBACK ENGINE         feedback.ts → voice/voiceCoach.ts, camera/overlay.ts
  ↓
UI                      features/mirror, features/scan, features/validation
```

### Why pixel space

Normalised landmark coordinates are scaled by the frame width and height before any angle is computed. If they weren't, a 16:9 or 9:16 frame would distort every angle. `engine.test.ts` covers this.

### Provider abstraction

`PoseProvider { init(); detect(video, t): PoseFrame; close() }`. The rest of the engine only sees `PoseFrame`. To add MoveNet, or a native or validated clinical model, write an adapter that maps its keypoints to the 33-landmark indices and sets `visibility`. `numPoses = 2` so that "multiple people" is detected rather than guessed.

### Privacy-first path

Inference runs in the browser (WASM plus WebGL where available). Raw video frames are never stored or transmitted. The model and WASM are served from the app's own origin (`public/pose/`), with the official CDN only as a fallback. What gets stored: landmarks (for clinician replay), derived measurements, and an optional small JPEG still, only with `image_storage` consent.

### Performance

- Route-level code splitting. The pose runtime is its own chunk and loads only on camera screens.
- The camera loop draws to canvas every frame and pushes React state at a throttled rate.
- Lite model by default. Full model is optional. There is a "device too slow" warning below 12 fps for 3 s.
- The page-visibility handler pauses inference, and the Mirror shows a Resume overlay (interrupted session).

### State machine

```
not_ready ──(rest ≥ readyStableMs)──▶ ready ──(> rest+startDelta)──▶ moving
moving ──(≥ target−approach)──▶ target_approach ──(≥ target.min)──▶ hold
hold ──(held ≥ holdSeconds)──▶ returning ──(≤ rest)──▶ REP COMPLETE ▶ ready
hold ──(< target.min − tolerance)──▶ moving            (hold broken, resets)
moving/approach ──(≤ rest, target not reached)──▶ rep_incomplete ▶ ready
any ──(invalid measurement)──▶ paused ──(regain)──▶ previous state (no hold credit for the gap)
paused > pauseResetMs during an attempt ──▶ attempt discarded
```

A rep is counted **only** on the return to rest, after the target was reached and the hold was satisfied. Start and completion thresholds are different (hysteresis), so jitter can't produce a double count. There is a test for this with ±5° noise at 30 fps.

## Data layer (`src/data`)

`models.ts` mirrors `db/schema.sql`. `store.ts` is the local repository. Every `insert/update/remove` also appends an `AuditEvent`. To move to a server, implement the same operations against an API backed by the schema, and keep audit and RLS on the server.

## Adding an exercise

1. Add a definition to `engine/exercises/definitions.ts`: primary measurement, thresholds, form rules, allowed target range, cue keys and **a new version**.
2. Add a measurement to `engine/measurements.ts` if one is needed, with its valid views and method text.
3. Add i18n strings.
4. Add a synthetic scene to `pose/synthetic.ts` and a state-machine test.

Do not edit a published version in place. Bump the version, so historical sessions keep resolving to the thresholds they were actually executed with (`getDefinition(id, version)`).
