# PhysioVision AI

A camera-first movement-intelligence platform for physiotherapy. The camera, the biomechanics engine, what the patient reports, and a clinician-controlled rehabilitation program all work together in one product. It is **not** a chatbot and **not** an exercise-video library.

> **Status: MVP / development build.** The motion system is working end to end. Camera measurements are **estimates** and have **not been clinically validated**. Do not use this build for patient care until you have validated it (see `docs/VALIDATION.md`) and moved storage and authentication to a server.

Built for Dheepika's physiotherapy practice. In the demo dataset she is the physiotherapist. You can change her name in Settings.

**Live:** https://physiovision-ai-eta.vercel.app (Vercel, deployed from this branch).

**Knee pathway (first release).** The pathway runs: profile → symptom map with radiation path → adaptive history → versioned safety screen → clinician-editable test plan → calibration → three knee protocols (supported heel-slide flexion/extension, five-times sit-to-stand, double-leg squat) with landmark-only replay → bilateral comparison → evidence map with "Why?" → clinician reasoning review and impression → prescription with progression and pain-pause rule → Motion Mirror → matched reassessment → baseline/current comparison → 14-section PDF report. See [`docs/IMPLEMENTATION_REPORT.md`](docs/IMPLEMENTATION_REPORT.md) for status, measured performance and gaps, [`docs/KNEE_PROTOCOL.md`](docs/KNEE_PROTOCOL.md) for protocols and data contract, and [`docs/AUDIT.md`](docs/AUDIT.md) for the pre-build audit.

---

## Quick start

```bash
npm install          # also copies the MediaPipe WASM runtime and downloads the Lite and Full pose models into public/pose/
npm run dev          # http://localhost:5173
npm test             # engine + assessment unit tests
npm run build        # type-check + production build (dist/)
npm run serve        # serve dist/ with the same headers and rewrites as vercel.json
```

The camera needs a **secure context**. `localhost` works. To test on a phone over your LAN, serve over HTTPS, for example with `vite --host` behind a TLS proxy or a tunnel.

On the welcome screen, **Explore demo — patient** or **Explore demo — physiotherapist** loads clearly labelled simulated data: three pseudonymous patients (DP-01 reviewed baseline, report and reassessment; DP-02 submitted assessment with one invalid capture; DP-03 safety hold). Every demo number is produced by running the real engine on synthetic landmarks. To try the full camera experience without a camera, choose **Settings → Motion engine → Simulated**. Every camera screen also offers "Use simulated demo instead" if the camera fails.

## What's in the MVP

| Area | Implemented |
|---|---|
| Patient auth & profile | Local accounts (PBKDF2-hashed; development only), profile, language |
| Onboarding & consent | Welcome → account → profile → **consent/privacy (up front, plain language)** → concern → assessment |
| Pain body map | Anatomical 2D map with Front / Right / Back / Left views, rotate (button or swipe), zoom, multi-select, patient-perspective side labels, keyboard and screen-reader support |
| Symptom assessment | NPRS now and worst in 24 h, pain quality, duration, onset, aggravating factors, pattern |
| Red-flag pathway | Urgent answers → "seek emergency care" and exercise blocked; review answers → safety hold and a clinician alert |
| Camera calibration | Person / single person / framing / distance / centring / orientation / camera roll (sensor) / lighting / landmark confidence, with spoken and on-screen instructions, stable-for-N-ms gate |
| Static posture scan | Anterior, lateral L/R and posterior views. 3 s hold-still capture; median ± SD and confidence per metric. Plumb line, level lines and live values drawn only after calibration passes |
| Dynamic movement tests | Knee flexion, straight-leg raise, shoulder flexion (L/R), 3 attempts, peak ROM, asymmetry observation |
| Pose engine | Provider abstraction. MediaPipe BlazePose Lite (on-device, self-hosted assets) running in a Web Worker with a main-thread fallback, CPU/GPU chosen by a measured probe, plus a labelled simulator. Identity guard, per-landmark in-frame/visibility checks and a plausibility guard withhold values rather than guess |
| Biomechanics | Pixel-space vector maths, 3D world-landmark variant, confidence gating, orientation detection |
| Filtering | Landmarks unsmoothed by default (smoothing coordinates added lag without reducing angle jitter; see `docs/tracking/RESULTS.md`). Live angles use a One Euro filter; stored capture signals use zero-phase smoothing. One Euro, EMA and Kalman remain comparable in Validation Mode and the tracking lab |
| Exercise engine | Versioned, data-driven definitions with safety guard-rails on clinician targets |
| State machine | Rest → moving → approach → hold → return → rep complete. Hysteresis, hold timer, tracking-loss pause, discard on long gaps, over-target and tempo flags |
| AI Motion Mirror | Full-screen camera, one short cue, current angle, target band, rep count, hold ring, voice (event-driven), captions, haptics, pause/resume, rest timer |
| Session results | Reps (counted vs attempted), best and mean peak ROM, holds, tempo, form reminders, tracking coverage, pain before/after, RPE, trajectory chart. **No composite "AI score"** |
| Progress | Baseline vs current. Camera estimates and clinician goniometer values are separate series with different markers. Weekly pain trend, adherence, table view |
| Clinician | Overview (active patients, review queue, alerts and symptom changes, adherence, recent sessions, upcoming reassessments), searchable/filterable patient list, patient record with 8 tabs |
| Clinician review | Landmark replay of each capture, value, confidence, source, model and algorithm version. **Accept / Reject / Repeat / Note**, with an audit trail |
| Program builder | Side, sets, reps, ROM target, hold, tempo, frequency, rest, dates, instructions. Validated against each definition's guard-rails. Publishing archives the previous program |
| Validation Mode | Raw vs filtered landmarks, per-landmark confidence, raw / filtered / 3D angle, FPS, inference latency, motion state, thresholds, anonymised CSV export. Clinician-enabled only; never visible to patients |
| Accessibility | Large text, high contrast, reduced motion, captions, ≥44–48 px targets, ARIA roles. Tracking state is never shown by colour alone (dashed/hollow = low confidence) |
| i18n | English plus Tamil (**draft**, pending clinical translation review), with fallback. Adding Hindi, Malayalam, Telugu or Kannada means adding a dictionary |
| PWA | Manifest, service worker (offline shell, cached pose runtime), safe-area insets, orientation-aware |
| Data model | `db/schema.sql` + `db/security.sql`: PostgreSQL schema with forced row-level security, consent triggers, a hash-chained append-only audit, retention purge and hashed report tokens, tested by `db/security_test.sql`. **Not deployed:** the live app still stores data in the browser, so it is not for real patients (see `docs/BACKEND_ARCHITECTURE.md`) |

## Architecture

```
src/
  engine/            PhysioVision Motion Intelligence Engine (pure TS, no React, unit-tested)
    pose/            provider.ts (interface) · mediapipe.ts · simulated.ts · synthetic.ts
    pipeline.ts      confidence filtering → temporal smoothing → orientation
    vector.ts        joint-angle maths (pixel space) + 3D variant
    filters.ts       One Euro · EMA · Kalman
    measurements.ts  measurement registry (method, landmarks, valid views, version)
    calibration.ts   scene checks + stability gate
    posture.ts       static posture metrics + capture aggregation
    protocols/       knee test protocols, cycle detector, recorder + quality gates, replay codec, simulator
    exercises/       versioned exercise definitions, prescription validation, pain-pause rule
    stateMachine.ts  repetition state machine
    exerciseRunner.ts sets/rest/form rules/result recording
    feedback.ts      display cue + event-driven speech cues
    provenance.ts    who/when/how/model/algorithm/device
  camera/            getUserMedia, device roll, real-time loop hook, canvas overlay renderer
  voice/             Web Speech voice coach (priority, cooldowns, captions)
  clinical/          versioned intake, safety, evidence, reasoning and report rules (knee)
  data/              domain models, local repository (audited writes, schema v2 migration), auth, prefs, demo seed
  features/          onboarding · bodymap · assessment · scan · mirror · session · progress ·
                     patient · clinician · validation · knee · report
db/schema.sql        PostgreSQL target schema
docs/                AUDIT.md · KNEE_PROTOCOL.md · IMPLEMENTATION_REPORT.md · SAFETY.md · ARCHITECTURE.md · VALIDATION.md
```

Real-time path: `camera frame → pose provider (on-device) → MotionPipeline → measurement estimate → angle filter → RepStateMachine → FeedbackEngine → canvas + voice`. The loop runs outside React. The canvas is drawn every frame, and React state updates at about 4–15 Hz. Every screen is lazy-loaded. The pose runtime (≈46 kB gz + WASM/model) loads only when a camera screen opens.

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Safety model: [`docs/SAFETY.md`](docs/SAFETY.md). Validation plan: [`docs/VALIDATION.md`](docs/VALIDATION.md).

## Known limitations (read before any clinical use)

- **Storage and auth are local to the device.** This is fine for demos and single-device pilots, but it is not a clinical data store. Production needs the server implementation of `db/schema.sql` with OIDC auth, TLS, encryption at rest and server-enforced RBAC and audit. No regulatory compliance is claimed.
- **Camera angles are 2D projections.** Sagittal measures require the prescribed side facing the camera. The engine pauses measurement when orientation is wrong or uncertain. Accuracy against goniometry is **unvalidated**.
- **No C7 landmark in BlazePose.** Forward-head posture is reported as an *ear–shoulder line angle (proxy)*, never as a craniovertebral angle.
- **Camera level** comes from the device tilt sensor. Laptops have no sensor, so their level check shows as "unknown" rather than "pass".
- The **3D anatomy** body map is not yet built. The 2D map uses view-independent region ids, so a WebGL renderer can replace it without data migration.
- **Clinical content** is a draft awaiting review by the supervising physiotherapist: safety and history questionnaires, knee protocols, observation and consideration rules, the report template, default targets, observation thresholds and Tamil translations. Approvals are recorded per version in Settings.
- The knee pathway has only been exercised with the simulator and a fake camera in this environment. A real-person capture on a phone still needs to be tested, and so does real on-device inference latency.
- The single-clinic MVP shows clinicians every patient on the device. Care-relationship scoping is modelled in the schema/RLS.
