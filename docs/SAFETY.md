# Clinical safety model

PhysioVision AI is **decision support for a physiotherapist**. It is not an autonomous clinician. It does not diagnose, it does not prescribe, and it never changes a prescribed target on its own.

## Four data categories, never blurred

| Category | Examples | Where stored | UI marker |
|---|---|---|---|
| Patient-reported | NPRS 5/10, "dull/aching", 1–6 weeks, red-flag answers, session pain/RPE | `patient_reported_outcomes`, session pain fields | ✎ *Patient-reported* |
| Camera-estimated | Estimated knee flexion 82°, shoulder level difference 3.4° | `measurements` with `category = camera_estimate` + provenance | ◎ *Camera-estimated* |
| Algorithmic observation | "Shoulder level difference exceeded configured threshold (2°)" | `observations` (rule, threshold at time of evaluation, value) | △ *Movement observation* |
| Clinical interpretation | Accepted measurements, clinical notes, approved programs | `measurements.review_status`, `clinical_notes`, `programs.approved_by` | ✓ *Clinician-approved* |

Clinician goniometer values are stored as `category = clinician_measured`. They are drawn as a separate series (square markers, dashed line) and are never averaged with camera estimates.

## Language rules

The product uses "camera-estimated ROM", "movement observation", "requires clinician review" and "clinician-approved program". It never uses "diagnosis", "exact measurement", "abnormal", or injury predictions.

## Never manufacture a measurement

The engine returns `value: null` with a reason, instead of a number, when:

- no person is detected, or more than one person is detected
- a required landmark is out of frame or below the visibility threshold
- the body orientation is wrong or uncertain for the measurement
- a segment is degenerate (too short to define an angle)

When that happens the UI shows "Measurement paused — reposition your body". Hold time does not accumulate while paused. An attempt with a tracking gap longer than `pauseResetMs` is discarded. Posture metrics are only computed after calibration has passed and stayed stable, and a capture window is thrown away if calibration is lost part-way through.

## Clinician control

- Exercise targets, sets, reps, hold, tempo, rest and frequency come only from the clinician's approved program. `validatePrescription` enforces per-definition guard-rails, for example so that a target can't sit too close to rest to detect a rep.
- Over-target movement triggers a "that is far enough" cue. The engine never raises or lowers targets.
- Posture and asymmetry observations use thresholds that the clinician configures.
- Every camera estimate starts as `pending`. The clinician can accept, reject, request a repeat, or add a note. Every decision is audited.

## Red-flag pathway (draft — requires clinician sign-off)

- **Urgent** (bladder/bowel change, saddle numbness, chest symptoms, hot swollen calf): the app advises emergency care, shows the configured emergency number, blocks exercise and camera tests, and raises a critical alert.
- **Review** (progressive weakness, unassessed trauma, fever, weight loss, night pain, cancer history): the assessment goes on safety hold, camera tests are blocked, and a warning alert is raised.
- A pain increase of 2 or more points across a session raises a clinician alert, and the patient is told to stop if the pain is sharp or worsening.

## Demo data

Every simulated row is flagged `isDemo` and/or has provenance source `simulated_demo`. It is shown with a DEMO/SIMULATED badge and a banner. It can be removed in Settings.
