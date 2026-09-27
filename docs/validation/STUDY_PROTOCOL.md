# Validation study protocol (Phase 13) — DRAFT for the clinical lead

**Status:** tooling implemented; **no participant data collected; no results exist.** Nothing in the product may claim accuracy until this study has been run and its pre-specified release thresholds are met.

## What the app provides

| Need | Where |
|---|---|
| Standardised captures | Knee protocols `knee_supported_flexion`, `knee_sit_to_stand`, `knee_squat` @1.1.0 (algorithm `pv-knee-1.1.0`). Each capture stores protocol, algorithm, model, delegate, thread, device, view, quality and signal processing. |
| Reference measurement | Clinician workspace → Captures → **Reference measurement** under each capture: value, instrument (goniometer, inclinometer, stopwatch, frame-by-frame video annotation), whether the assessor was blinded, and a note. It is stored as a clinician measurement linked to the capture metric, never merged with the camera value. |
| Participant split | Same form: each participant is **tuning** or **final evaluation**. The split is per person, never per clip, so no person appears in both. |
| Release thresholds | Settings → **Validation study**. These start empty. The clinical lead enters them and locks them. A release check counts only if the thresholds were locked **before** the first evaluation-split reference. |
| Analysis | Same panel: bias, 95% limits of agreement, MAE and capture-failure rate per metric and split (`src/engine/validationStats.ts`, unit-tested including the Shrout & Fleiss ICC example). JSON export with pseudonymous ids. |
| Device and engine checks | `/lab.html` on each phone (tracking lab and live benchmark), plus the Validation Mode diagnostics export. |

## Design (to be confirmed by the clinical lead)

1. **Participants.** Adults with written consent for landmark-only recording. Any video recording needs its own separate, purpose-specific consent. Include a spread of:
   - body sizes;
   - ages;
   - sex;
   - skin tones (self-reported, and recorded only with consent);
   - clothing (shorts or leggings vs loose trousers).
2. **Devices.** At least one mid-range Android on Chrome and one iPhone on Safari, with the front and rear cameras, at the recommended placement for each test. Add deliberate deviations: low light, off-angle view, too close.
3. **Reference methods.**
   - Knee flexion peak and extension position: universal goniometer with standard bony landmarks, taken by a clinician blinded to the camera value at the same attempt. If available, a frame-by-frame video annotation by a second rater.
   - Five-times sit-to-stand time: stopwatch, and frame annotation of video where video consent was given.
   - Squat FPPA: frame annotation of the peak-depth frame using the published 2D method. This is only possible where video consent was given.
4. **Repeatability.** A second session on a different day, with the same set-up and the same protocol version.
5. **Tuning vs evaluation.** Any change to thresholds, filters or protocols may use the **tuning** participants only. Before analysing the **evaluation** participants, freeze the protocol and algorithm versions and lock the release thresholds. Then analyse the evaluation data once.
6. **Reporting.** For each metric and subgroup (device, camera, lighting, clothing, and skin-tone band where consented), report:
   - n;
   - bias with 95% limits of agreement;
   - MAE and the absolute-error distribution;
   - ICC(2,1), SEM and MDC95 from test–retest;
   - capture failure rate, with the reasons.

   Report subgroups with small n as such; do not pool them away.
7. **Release decision.** Pass only if every metric meets its locked thresholds in the evaluation split. The protocol and algorithm versions tested must be the ones deployed.

## Not yet in the app

- Consented subgroup fields: skin-tone band, clothing and lighting conditions per capture. Until then these must be kept in the study log.
- Linking a second-day capture to its first-day pair for in-app ICC. The export supports doing this offline.
- Video annotation tooling. Video is never recorded by the app.
