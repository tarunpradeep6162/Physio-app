# Dheepika Lab — movement pathway expansion

**Status (2026-09-27, updated):** knee and **shoulder** (Phase 1, draft content — see `docs/SHOULDER_PROTOCOL.md`) have assessment pathways; real-device and clinical-review gates remain for both. This is an engineering backlog, not an approved clinical protocol or a claim that the camera identifies the cause of symptoms. The clinician makes the diagnosis and prescribes the plan.

## Already working

- Whole-body symptom map and static posture scan (screening estimates, not diagnosis).
- Knee history, safety, three movement tests, synchronized landmark replay, clinician evidence review, report and reassessment.
- Clinician-prescribed camera exercises: standing knee flexion, straight-leg raise, shoulder flexion and **draft front-view shoulder abduction**. The last is an exercise definition in the program builder, **not a shoulder assessment pathway**. The usual confidence, orientation, occlusion, rep and pain-pause rules apply. Its numerical target is a placeholder for a clinician to edit and approve.

## Next complete pathway: shoulder

1. **History and safety:** side, onset, trauma/surgery, pain and function, aggravating actions, neurological and urgent symptoms. Clinical lead approves wording and escalation.
2. **Camera tests:** active flexion side-on, active abduction front-on, bilateral comparison. Specify setup, view, required landmarks, compensation checks, valid-rep rules, what a camera cannot see and a reference method. Start with simple descriptive angles; do not infer rotator cuff pathology or a diagnosis.
3. **Patient journey:** one clear cue, camera alignment, explicit invalid joint, replay and recapture; resume interrupted assessments.
4. **Clinician journey:** review capture quality, history, reference measurements and within-person change; version the test plan and report. No automated probabilities.
5. **Validation:** real phone matrix, occlusion/bystander/lighting failures and blinded agreement against clinician measurements with thresholds locked before evaluation.

## Following pathways (each gets its own protocol and validation gate)

| Candidate | Camera-friendly first test | Specific limitation |
|---|---|---|
| Hip | Side-view active flexion / sit-to-stand | Pelvic compensation and depth cannot be inferred reliably from one 2D view. |
| Ankle | Side-view knee-to-wall or seated plantarflexion | Foot landmarks and camera position require new quality gates. |
| Low back | Side-view trunk bend, front-view lateral bend | Camera angle and hip motion confound spinal range; no inference about tissue cause. |
| Balance | Timed single-leg stance | A phone camera cannot measure force-plate sway or detect every support touch. |
| Gait | Timed short walkway with full-body view | Turns, occlusions, distance calibration and cadence need a separate protocol. |

Shared infrastructure should grow alongside these pathways: clinician-authored exercise library and progression criteria; symptom and function questionnaires; outcome trends; patient reminders; accessible Tamil copy after human review; secure server storage, role access and audit; reference-measurement tooling. Every measure must state whether it is patient-reported, clinician-entered or camera-estimated.

**Release order:** first make the knee pipeline pass real-device and agreement gates. Build shoulder as the next complete module, then add other regions one at a time with their own reference studies. A large untested exercise count is not a release metric.
