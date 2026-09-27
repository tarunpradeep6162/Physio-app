# Knee pathway: protocols, clinical ownership, validity gates and data contract

Step 2 of the build sequence. Everything below is implemented in code. The source of truth is `src/engine/protocols/knee.ts`, `src/clinical/*.ts` and `db/schema.sql`. This document only describes them.

> **Clinical status:** every clinical rule set below is a **DRAFT** until Dheepika (clinical lead) approves that version in *Settings → Clinical rule approvals*. Approval is recorded with who approved it, when, and which version. No accuracy figures are claimed for any measurement (see `VALIDATION.md`).

## Clinical ownership

| Artefact | Id@version | Owner | Status |
|---|---|---|---|
| History questionnaire | `knee-history@1.0.0` | Clinical lead | Draft |
| Safety (red-flag) questionnaire | `knee-safety@1.0.0` | Clinical lead | Draft |
| Observation rules | `knee-observations-1.0.0` | Clinical lead | Draft. Thresholds are editable in Settings. |
| Differential consideration rules | `knee-considerations@0.1.0` | Clinical lead | Draft |
| Test protocols | `knee_supported_flexion@1.1.0`, `knee_sit_to_stand@1.1.0`, `knee_squat@1.1.0` (1.0.0 retained for older records) | Clinical lead (protocol), engineering (algorithm `pv-knee-1.1.0`) | Draft |
| Report template | `pv-knee-report-1.0.0` | Clinical lead | Draft |

Code may organise language and evidence. It cannot add emergency criteria, change a safety action, or change a prescription. Those change only through a new clinician-authored version.

## Safety rules (`src/clinical/safety.ts`)

There are 11 items. Each stored response keeps the questionnaire version, question text, answer, whether it triggered, the action and the timestamp.

- **Emergency:** knee hot, red and swollen with fever; deformity after injury; chest pain or breathlessness; saddle numbness or bladder/bowel change.
- **Urgent:** hot, swollen calf; unable to weight-bear after injury; post-surgical wound problem; rapidly progressive weakness.
- **Clinician review:** locked knee; severe unrelieved night pain; cancer history or unexplained weight loss.

The most severe triggered action wins. Anything other than `clear` does three things:
- blocks camera tests and exercise;
- raises a clinician alert;
- puts every differential consideration into `safety_hold`, so no automated conclusion is shown.

## Capture protocols

### Version 1.1.0 (current) and 1.0.0 (history)

New captures use **1.1.0** with algorithm `pv-knee-1.1.0`. Each saved capture keeps the protocol and algorithm version it was recorded with, and is always read back with that version's definition (`getProtocol(id, version)` looks in `HISTORY`). Changes in 1.1.0, as listed in each protocol's `changes` field:

1. Distance is judged on the body region the test needs (the tested leg for the heel slide; shoulder to foot for sit-to-stand; hips to feet for the squat), not on whole-body standing rules.
2. The capture screen shows the recommended phone orientation, placement, distance, view, lighting and clothing with an illustration.
3. A repetition with a tracking gap longer than 250 ms is **not counted** (`tracking_gap`), and needs a minimum number of valid frames (`too_few_frames`: 10 heel slide, 6 sit-to-stand, 8 squat).
4. Each required landmark must be inside the frame (not within 4% of the edge, where the model extrapolates), visible and, where segmentation is enabled, on the body. A bystander, a sudden identity change or a left/right leg swap pauses measurement for at least 500 ms / 3 frames until tracking is stable again.
5. Stored values use zero-phase smoothing (median ±100 ms, then mean ±150 ms), so peaks are not delayed or flattened by a causal filter. The live display uses a One Euro angle filter. Physically implausible jumps (> 900°/s for angles, > 400 %/s for squat depth) are rejected, with a 250 ms recovery window. The raw, guarded and stored values are all kept, together with the filter settings (`processing` in the capture).

The thresholds in 1.1.0 are engineering choices tested on rendered figures (see `docs/tracking/RESULTS.md`). They are drafts for the clinical lead like everything else in this document.

### Rules for all protocols

- Angles are computed in 2D pixel space from unsmoothed landmarks. The live display smooths the angle; the stored signal is smoothed zero-phase after capture.
- A frame yields `null`, never a number, when there is no person, more than one person, the wrong or uncertain view, a required landmark below 0.6 visibility, a landmark out of frame or in the edge band, hands in front of the torso (for torso and pelvis measures), re-acquisition after a tracking gap or identity change, or a degenerate segment.
- Calibration must pass and stay stable before recording. It checks that **every** required landmark is at or above the confidence threshold.
- Replay stores landmarks only, never images: 19 joints at 10 Hz, encoded as uint16.

### 1. Supported knee flexion (supine heel slide)

| | |
|---|---|
| View | Lateral, with the tested side toward the camera. The camera is low and level. Distance is judged on horizontal extent. |
| Landmarks | Hip, knee and ankle on the tested side |
| Signal | Knee flexion = 180° − ∠(hip, knee, ankle) |
| Cycle | Rises past 25° (rest), reaches ≥ 45° (engaged), returns below 25°. Minimum 1.5 s. A gap over 2 s discards the cycle (1.1.0: over 250 ms, and at least 10 valid frames). It needs 0.5 s of steady rest before counting. |
| Target | 3 cycles, 75 s max |
| Metrics | `knee_flexion_peak`: max over valid cycles. `knee_extension_position`: 5th percentile of the signal, floored at 0. |
| Quality gate | Coverage ≥ 75%, mean confidence ≥ 0.7, ≥ 2 valid cycles |
| Limitations | 2D projection. Hyperextension is not measurable. Active range only. Not interchangeable with goniometry until validated. |

### 2. Five-times sit-to-stand

| | |
|---|---|
| View | Lateral, with the chosen side toward the camera |
| Landmarks | Shoulder, hip, knee and ankle on that side |
| Signal | Knee flexion. Trunk lean is recorded as an extra channel. |
| Cycle | Seated (≥ 65°) → standing (≤ 25°) → seated. Minimum 0.6 s. The 5th stand counts as soon as the patient is standing. |
| Metrics | `sts_time_5`: onset of the first rise to standing on the 5th stand. `sts_rise_time`: mean rise time. `sts_trunk_lean_peak`: median. `sts_seated_knee_flexion`: median. Rise onset is the last sample within 5° of the seated plateau. |
| Quality gate | Coverage ≥ 80%, mean confidence ≥ 0.7, 5 valid stands. An incomplete stand is reported as a protocol deviation. |
| Limitations | Chair height, footwear and arm use change the result, and arm use is not detected. Timing resolution is one frame. No population norms are shown. References: Csuka & McCarty 1985; Bohannon 2006. |

### 3. Double-leg squat (front view)

| | |
|---|---|
| View | Anterior. The camera is at knee height. |
| Landmarks | Both hips, both knees, both ankles |
| Signal | Hip descent below the highest standing hip, as % of hip-to-ankle length |
| Cycle | Rises past 5%, reaches ≥ 15%, returns. Minimum 1 s. |
| Metrics | `squat_depth`: median. `squat_fppa_left` / `squat_fppa_right`: signed frontal-plane projection angle within ±250 ms of peak depth. + means medial. |
| Quality gate | Coverage ≥ 80%, mean confidence ≥ 0.7, ≥ 3 valid squats |
| Limitations | 2D proxy, sensitive to camera height and foot position. The double-leg adaptation is unvalidated. Reference: Munro 2012. A left/right difference is descriptive and never classified as pathology. |

If a capture fails its quality gate, **every** metric from it is marked `invalid` with a reason. Invalid metrics are shown as "Not reported" and are never used as evidence facts.

## Exercise state machine (Motion Mirror)

`ready → moving → target_approach → hold → returning → (rep counted)`. Any state can go to `paused` on tracking loss. A rep counts only after the target was reached, the hold was satisfied, and the joint returned to rest.

The pain-pause rule (`painRule.ts`) stops the session only under the clinician-configured limits: pain at or above `painStopAt`, or a rise of at least `painRiseStop` from the pre-session score. Pain events are saved with the session. The prescription is never changed automatically.

## Reassessment matching

A reassessment copies the baseline test plan and shows the baseline framing as a guide. For each test it records how closely the setup matched:

- view;
- aspect ratio;
- distance proxy (max of body height and width fraction, ±0.08);
- position (±0.1);
- camera roll (±3°). Roll counts as "unknown" when the device has no sensor, and unknown is never counted as a pass.

These are relative framing proxies, not metres.

## Data contract

These objects are stored in the local repository and mirrored in `db/schema.sql`:

- `intake_answers`: append-only; a change supersedes the old answer.
- `safety_responses`
- `summary_amendments`
- `test_plans`: revisioned.
- `capture_sessions`, `movement_events` and `measurements`, each with protocol, algorithm and model versions, device, view, quality, validity and provenance.
- `radiation_paths`
- `reasoning_decisions`: stores the AI suggestion alongside the clinician action.
- `clinical_impressions`
- `reports`: document version, audience, state, approver.
- `clinical_rule_versions`
- `retention_policies`
- `audit_events`
