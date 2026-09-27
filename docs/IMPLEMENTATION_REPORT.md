# Implementation report: knee pathway (Dheepika edition)

**Live build:** https://physiovision-ai-eta.vercel.app. This is a Vercel production deployment, git-linked to branch `claude/physiovision-ai-platform-49ysp2`.
> Superseded for tracking and release status by [`RELEASE_GATE_REPORT.md`](RELEASE_GATE_REPORT.md) (Phases 1–20).

**Status:** first-release knee pathway implemented end to end, for **demonstration and validation only**. It is not ready for real patient care (see "Production readiness").

## 1. Code changes

| Commit | What |
|---|---|
| `55bbf2e` | Knee protocol engine (supported flexion, five-times sit-to-stand, squat), generic cycle detector, protocol recorder with quality gates and keyframes, landmark replay codec, data model v2 with a forward migration that keeps v1 records |
| `8dc41c8` | Patient pathway: symptom map with symptom types and a drawn radiation path, adaptive history, versioned safety screen, test plan, guided calibration + capture + replay, save and resume |
| `3a48a9b` | Clinician workspace: history summary with amendments and the original answers, safety log, test-plan revisions, capture review with synchronised replay, bilateral and baseline comparison, evidence map with "Why?", considerations with accept/reject/defer/annotate, impression, 14-section PDF / print view / patient summary, progression and pain-pause prescription |
| `0d341e8` | Sit-to-stand rise-onset fix, body-width in capture config for supine guides, patient report link fix, knee tables in `db/schema.sql` |
| this commit | Self-hosted Full pose model, slow-device and partial-body tests, docs (`AUDIT.md`, `KNEE_PROTOCOL.md`, this report) |

The audit findings and the fixes for misleading placeholders are in [`AUDIT.md`](AUDIT.md). The protocols and data contract are in [`KNEE_PROTOCOL.md`](KNEE_PROTOCOL.md).

## 2. Completion gate: journey status

| Stage | Status | Evidence |
|---|---|---|
| Profile → symptom map → adaptive history → safety screen | Done, persisted, resumable | Browser run (new patient, mobile viewport); unit tests |
| Clinician-editable test plan | Done (revisioned) | Browser run |
| Camera calibration → knee ROM + 2 further tests → replay | Done | Simulator browser run: true 120° / 3° measured 120.2° / 2.8°, 3/3 valid cycles. Real MediaPipe loads and runs under the production CSP. **A real-person camera capture has not been tested from this environment** (no camera). |
| Bilateral comparison, evidence map, reasoning review, impression | Done | Clinician browser run; unit tests |
| Prescription (progression, pain-pause) → Motion Mirror → saved outcome | Done | Browser run: pain ≥ 7 stopped the session and was saved |
| Matched reassessment → baseline/current comparison | Done | Browser run: baseline plan copied, setup-match shown per test |
| PDF report (preliminary vs clinician-reviewed; patient summary) | Done | PDFs rasterised and inspected: preliminary 7 pp with watermark and no sign-off; reviewed 6 pp with sign-off; patient 2 pp; every page has a footer with page x of y, timestamp, document version and state |

Unfinished items are listed in section 6.

## 3. Supported protocols

1. `knee_supported_flexion@1.0.0`: peak flexion and extension position, lateral view, per side.
2. `knee_sit_to_stand@1.0.0`: time for 5 stands, rise time, trunk lean, seated knee flexion.
3. `knee_squat@1.0.0`: depth (% leg length) and signed left/right FPPA, front view.

All three use algorithm `pv-knee-1.0.0`, and all are draft protocols awaiting clinical-lead approval.

## 4. Measured performance

All figures come from this build environment (4-core cloud container, headless Chromium, **no GPU**, so WebGL is software-rendered). **They are not phone figures.**

| What | Result |
|---|---|
| Initial page load (JS + CSS, gzip) | ≈ 152 kB (React 81 kB, pose-runtime JS 45 kB, store 12 kB, app shell 8 kB, CSS 5.5 kB) |
| Report / PDF chunk (lazy) | 135 kB gzip, loaded only when a report is opened |
| Pose assets (lazy, cached by the service worker) | WASM 11.8 MB (SIMD) or 11.0 MB (non-SIMD), only one is loaded; model Lite 5.8 MB, Full 9.4 MB |
| MediaPipe inference, Lite and Full, headless CPU/software GL | ≈ 510–560 ms per frame (≈ 2 fps). This reflects the missing GPU, not a device. **Measurement on target phones is outstanding** and can be done with Validation Mode, which shows live FPS and inference latency. |
| Engine cost per frame (pipeline + filter + protocol recorder, excluding inference) | 0.02–0.03 ms |
| Stored capture (metrics, 10 Hz signal, events, keyframes, replay landmarks) | 38–45 kB per test |
| Low frame rate | At 10 fps the simulated heel-slide peak (truth 118°) stays in the same 112–122° acceptance band as at 30 fps (unit test) |

## 5. Test results

- `npm test`: **67 / 67 passing** in 6 files (engine, protocols, clinical, report, demo, assessment).
- `tsc -b`: clean. `vite build`: clean.
- `db/schema.sql` applied to a throwaway PostgreSQL 16 instance: 34 tables, no errors.

Failure cases covered by automated tests:

| Case | Behaviour |
|---|---|
| Obstruction: one required joint occluded | Calibration fails and names the joint; the capture fails its quality gate; all metrics are `invalid` / "Not reported" |
| Partial body (ankles leave the frame) | `out_of_frame`; the capture is invalid |
| Nobody in view / multiple people | `no_person` / `multiple_people`; no number is produced |
| Wrong view (facing away) | `wrong_orientation`; no measurement |
| Poor lighting, camera tilt, too close / too far, supine distance | Calibration check fails with a spoken and on-screen instruction |
| Tracking loss mid-rep | Pause, hold time not accumulated, rep discarded after a long gap |
| Slow device (10 fps) | Still valid, within the same tolerance as 30 fps |
| Safety answer triggered | All considerations go to `safety_hold`; routine steps blocked |
| Invalid recapture after a valid one | Newer invalid result replaces it; no evidence facts drawn from it |
| Unreviewed report | Stays "AI preliminary — requires clinician review"; approval goes stale when data changes afterwards |

Failure cases verified in the browser:
- camera permission denied (clear message and simulator fallback);
- network loss on the production build (offline banner, navigation keeps working, banner clears when back online);
- MediaPipe loading under the production CSP.

**Not tested:** real low light or real occlusion with a real camera and person; real slow phones; iOS Safari.

## 6. Clinical validation

**Completed: none.** No agreement, reliability or accuracy study has been run, and no accuracy figure is claimed anywhere in the product.

**Outstanding** (protocol in [`VALIDATION.md`](VALIDATION.md)):
- concurrent validity against goniometry and stopwatch timing;
- test-retest reliability;
- device, camera and lighting variability, including skin tone;
- a double-leg FPPA validity study;
- rep-count precision and recall.

Also outstanding: clinical-lead approval of every draft rule set (safety, history, observations, considerations, protocols, report template), and review of the draft Tamil translation.

## 7. Security and privacy limitations

- **Storage and authentication are local to the browser** (localStorage, PBKDF2-hashed local accounts). There is no server, no cross-device sync, and no server-enforced access control. Anyone with access to the device profile can read the data.
- Report "URLs" are in-app routes checked against the local user. No unauthenticated private-report URL is printed. No secure verification service exists yet.
- The retention setting is recorded, but automatic deletion is not enforced by a server.
- The audit log is append-only in code, not tamper-evident.
- No images or video are stored or transmitted. Pose inference runs on-device. Replay stores landmarks only.
- Hosting: security headers are set (CSP, HSTS, `X-Frame-Options DENY`, camera limited to self, `no-referrer`).
- No regulatory clearance is claimed. None has been sought.

## 8. Production readiness

**Not production-ready for patient care.** It is suitable for:
- demonstrations;
- the clinical lead reviewing the draft rules;
- validation data collection with consenting volunteers.

Before real patient deployment, all of the following are needed:
1. the server implementation of `db/schema.sql` with OIDC auth, RBAC and care-relationship scoping, encryption at rest, and a server audit log;
2. clinical approval of every draft rule set;
3. the validation studies above;
4. privacy, security and jurisdictional regulatory review;
5. on-device performance measurement on target phones.
