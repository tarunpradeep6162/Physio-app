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

Capture three heel slides, five sit-to-stands and three squats. Compare attempted, valid and rejected repetitions with the saved result and replay. Test TalkBack or VoiceOver, large text and high contrast. Note every unclear cue and every horizontal overflow.

## Next decisions

1. Attach the exported JSON files and this completed sheet to the tracking issue; share no identifying camera footage.
2. Enter blinded clinician reference measurements through the clinician capture view. The study protocol is in `docs/validation/STUDY_PROTOCOL.md`; Dheepika must approve it and lock thresholds before evaluation data are collected.
3. Triage every unsafe number as a release blocker. Use tuning participants to change the algorithm, then rerun the frozen evaluation split. Do not present agreement or diagnostic claims until that work is complete.
