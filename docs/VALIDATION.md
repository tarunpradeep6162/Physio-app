# Validation plan (required before clinical use)

The camera numbers are **estimates** until they have been validated against a reference in your setting.

## Tooling in the app

**Validation Mode** is in Settings → enable Validation Mode, and is available to clinicians only. It shows:

- raw (orange) and filtered (cyan) landmarks, with per-landmark visibility
- the raw angle, the filtered angle, and the model's metric 3D (world-landmark) angle
- FPS and inference latency
- orientation vote, calibration checks and their measured values
- motion state, reps, hold time, and every threshold in force

**Record → Export CSV** exports an anonymised trace: no patient identifiers and no images. Raw landmark coordinates are included only if you tick the checkbox.

## Status

**No validation study has been run yet.** The product claims no accuracy figures. The only accuracy-type checks so far are software checks: engine output on synthetic landmarks with known ground truth (for example, simulated 120° / 3° heel slide measured as 120.2° / 2.8°). These check the code, not agreement with a clinical reference.

## Knee protocols to validate

| Protocol | Reference method | Primary outcome |
|---|---|---|
| Supported knee flexion | Universal goniometer, blinded assessor | Bias and 95% LoA for peak flexion and extension position; test–retest ICC, SEM, MDC95 |
| Five-times sit-to-stand | Stopwatch (trained assessor) and frame-annotated video | Agreement for total time; rise-time agreement with video annotation |
| Double-leg squat FPPA | Frame-annotated 2D video (Munro 2012 method) and/or 3D motion capture | Agreement and reliability for left/right FPPA; depth proxy reliability |

Also record the reassessment setup-match score for each repeat capture, so you can check how framing differences affect repeatability.

## Suggested protocol

1. **Concurrent validity.** Record camera estimates and universal-goniometer measurements (from a blinded assessor) at the same instant, on at least 30 participants per movement and side. Report the mean difference (bias), 95% Bland–Altman limits of agreement, and ICC(2,1).
2. **Reliability.** Repeat on 2 separate days (test–retest ICC, SEM, MDC95).
3. **Conditions matrix.** Test phone vs laptop, front vs rear camera, distance, lighting, clothing, and skin tones (Fitzpatrick I–VI). Tracking coverage and bias must hold across all of them.
4. **Filter selection.** Compare One Euro, EMA and Kalman on the recorded traces: jitter SD while holding still, and peak attenuation and lag during movement. Choose the default from the data.
5. **Rep counting.** Compare with manual video annotation and report precision and recall for counted reps and false counts.
6. **Clinical content review.** Review the red-flag questions, default targets, observation thresholds and translations.

Only after this should acceptance criteria (for example LoA within ±5°) be written into the product and into the patient-facing wording.
