# Dheepika Lab — phone tracking run

**Status:** No real-phone result has been recorded. This is a collection sheet, not evidence of accuracy. Obtain written participant consent for landmark-only processing and do not record video in the app. Any external video for a reference rater needs separate consent.

## Device record (one sheet per phone and camera)

| Field | Record |
|---|---|
| Date, tester, pseudonymous participant | |
| Device model, OS, browser version | |
| Front or rear camera; phone mount and distance | |
| Room lighting, clothing, chair height/footwear where applicable | |
| App commit, protocol/algorithm/model version | |
| Chosen delegate, worker or main-thread fallback | |
| Lab JSON filename; Validation Mode diagnostics JSON filename | |
| After 5 minutes: phone temperature (cool/warm/hot), battery change | |

Open `/lab.html` on the phone. Run the synthetic scenarios with Lite and Full, then the **live camera benchmark** with each camera. Download JSON. In clinician Validation Mode, run 60 seconds of the supported heel slide and export diagnostics. Record camera FPS, inference FPS, inference p50/p95, capture-to-landmark age p50/p95, UI responsiveness and each fallback reason. Do not label the synthetic mannequin error as clinical accuracy.

## Device matrix (Phase 2) — repeat per device

Run every cell that the device supports. Record the lab JSON filename in the cell. Leave a cell empty rather than estimating it.

| Condition | Knee: heel slide (landscape, floor) | Knee: sit-to-stand (portrait) | Shoulder: flexion side view (portrait) | Shoulder: abduction front view (portrait) |
|---|---|---|---|---|
| Rear camera, recommended distance, good light | | | | |
| Front camera, recommended distance, good light | | | | |
| Too close (region fills > 90%) | | | | |
| Too far (region < recommended minimum) | | | | |
| Dim room (one lamp, no window) | | | | |
| Backlit (window behind the participant) | | | | |
| Loose clothing over the tested joint | | | | |
| Fitted clothing / shorts / vest | | | | |
| Participant with a larger body size (with consent) | | | | |
| Wrong phone orientation (portrait for heel slide / landscape for shoulder) | | | | |

For each cell, record:
- valid / attempted repetitions;
- the refusal reasons shown;
- inference p50 / p95 from Validation Mode diagnostics;
- whether any number appeared while invalid.

## Sustained run (thermal)

On `/lab.html`, tap **Sustained run (5 min, worker)** with the phone on its mount. The result JSON contains `sustained.windows` (fps and inference p50/p95 per 30 s) and `slowdownRatio` (last ÷ first window). Record the phone's temperature by touch (cool / warm / hot) and the battery change. **Only timings are kept; no frames or video.**

## Supported-device limits (to fill from real runs only)

| Device class | Minimum observed inference fps for a valid capture | Notes |
|---|---|---|
| — | pending | No real phone has been run. |

## Failure and recovery checklist

For each row, write **pass/fail, the on-screen reason, whether any number appeared while invalid, recovery time, and the diagnostics timestamp**. A number appearing while the tested joint is hidden is a failure.

| Test | Front | Rear |
|---|---|---|
| Cover the tested knee with a cushion | | |
| Hold a phone across the torso and hips | | |
| Place an unheld object over the torso | | |
| Step partly out of frame and return | | |
| Let a second person enter and cross behind | | |
| Turn to the wrong side | | |
| Dim the room and restore light | | |
| Stop the camera stream/lock the phone; confirm the number clears | | |
| Interrupt a repetition with a covered knee; confirm it does not count | | |
| Shoulder: hold a folder in front of the tested elbow during abduction | | |
| Shoulder: turn the wrong side toward the camera for flexion | | |
| Shoulder: lean the trunk away while raising the arm (check the compensation value) | | |

Capture three heel slides, five sit-to-stands and three squats. Compare attempted, valid and rejected repetitions with the saved result and replay. Test TalkBack or VoiceOver, large text and high contrast. Note every unclear cue and every horizontal overflow.

## Next decisions

1. Attach the exported JSON files and this completed sheet to the tracking issue; share no identifying camera footage.
2. Enter blinded clinician reference measurements through the clinician capture view. The study protocol is in `docs/validation/STUDY_PROTOCOL.md`; Dheepika must approve it and lock thresholds before evaluation data are collected.
3. Triage every unsafe number as a release blocker. Use tuning participants to change the algorithm, then rerun the frozen evaluation split. Do not present agreement or diagnostic claims until that work is complete.

## 3D anatomy on real phones (required separately from pose tracking)

Open the patient symptom map and clinician Anatomy explorer on the **same phone/browser** used for the camera run. Record the exact commit and whether WebGL2 starts. The atlas is a reference image; its region selection is not a clinical measurement.

| Check | Front camera phone | Rear camera phone / second browser |
| --- | --- | --- |
| Anatomy reaches first render (seconds, cold cache / warm cache) | | |
| Muscle and optional skeleton visually present | | |
| Rotate front/back/side; left and right labels remain anatomically correct | | |
| Tap knee, shoulder, neck, ankle and back: selected region matches the on-screen label and saved symptom | | |
| 2D toggle keeps selections; retry 3D; browser with WebGL disabled gives a clear 2D fallback | | |
| Five-minute interaction: memory/thermal impression, responsiveness, crash or context loss | | |
| Offline after one load: record what still works and whether a clear explanation appears | | |
| Screen reader and large text: region list remains selectable without WebGL | | |

Use browser network tools when available to confirm that `/anatomy/anatomy.glb` and `/anatomy/skeleton.glb` come from Dheepika Lab's origin, return GLB bytes (not the SPA HTML), and show no request to `raw.githubusercontent.com`. Record whether 27 MB is acceptable on the target mobile connection. No result is pre-filled here.
