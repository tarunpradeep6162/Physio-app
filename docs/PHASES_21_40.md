# Dheepika Lab: phases 21–40

**Baseline:** phases 1–20 in [PHASE_TRACKER.md](PHASE_TRACKER.md) have engineering work, but their clinical and device gates remain open. This plan starts from the 6 October 2026 build; it is not a claim of validation or readiness for patient care. The real-patient build flag stays off. Dheepika's clinical approval remains on hold.

Each phase has one independently reviewable exit. A phase is complete only when its evidence link, reviewer, device/configuration and any residual failure are recorded here. Synthetic tests cannot substitute for real-device or reference measurements. Do not expand clinical claims as a shortcut to filling the catalogue.

| Phase | Deliverable | Exit evidence / dependency | State |
|---|---|---|---|
| 21 | Release threshold integrity | Every current metric has a valid, locked threshold before evaluation references exist; test partial and malformed tables. | Engineering implemented; no clinical thresholds set |
| 22 | Occlusion failure research | Reproduce elbow and object failures on real devices; fail closed for unobservable joints; keep unsafe frame count at zero across the locked challenge set. | Blocked on capture set and device |
| 23 | Phone benchmark kit | Consent-safe capture worksheet, timestamps, device/model/browser/lighting, dropped frames, thermal state and reproducible export. | Existing worksheet; real phone runs pending |
| 24 | Anatomy mobile performance | Inspect atlas on target phones for WebGL loss, frame time, memory, tap regions and accessible 2D fallback. | Real-phone testing pending |
| 25 | Reference pairing | Blinded clinician measurement entered independently with instrument and timestamp; split participants before capture. | Dataset guard extended (demo, mismatch, duplicate, unblinded and pre-capture references excluded); study enrolment pending |
| 26 | Agreement analysis | Per metric/device/subgroup failure, bias, LoA and repeatability against prespecified thresholds; show missing data. | Capture failure denominator now includes unpaired attempts; device/subgroup and repeatability study evidence still pending |
| 27 | Shoulder release candidate | Real-person shoulder ROM and occlusion tests, instructions, clinician review and report checks. | Depends on 22–26 and clinical review |
| 28 | Knee release candidate | Repeat the full knee pathway with target phone setups and reference exam; investigate lateral/supine failure modes. | Depends on 22–26 |
| 29 | Hip and ankle release candidates | Separate protocol validation and usability findings for each metric; no borrowed accuracy claim. | Depends on 22–26 |
| 30 | Spine and balance release candidates | Define limitations for 2D projection, neck landmark proxy and balance timing; test independently. | Depends on 22–26 |
| 31 | Secure server environment | Deploy database migrations, OIDC, row security, backups and audit to controlled staging; negative access tests. | Hosting, IdP and privacy decisions required |
| 32 | Data migration and sync | Account-bound transfer from browser storage with consent, provenance, conflicts, rollback and deletion test. | Depends on 31 |
| 33 | Consultation draft review | Trace every AI statement to a source and show uncertainty; clinician accept/edit/reject/defer and sign-off audit. | Clinical rules review remains on hold |
| 34 | Plan safety and exceptions | Assignment versioning, pause/escalation, overdue review and clinician-visible deviations across devices. | Depends on 31–33 |
| 35 | Daily companion | Low-friction check-in, reminders and accessible progress without presenting activity as diagnosis. | Depends on consent and secure records |
| 36 | Activity integration | Native HealthKit/Health Connect adapters, revocation, duplicate handling, source/timezone fidelity and opt-out. | Depends on 31, 35 and actual device bridge |
| 37 | Exercise catalogue pipeline | Licensed media, anatomy, instructions, contraindications, language review, versioned approval and search. Seed in reviewed batches; do not promise 2,000 approved items. | Content owner and licensing required |
| 38 | Clinic operations | Scheduling, course/payments, care relationships, role scopes, exports and audit tested in multi-clinic staging. | Depends on 31–32 |
| 39 | Accessibility and localization | Screen-reader and reduced-motion sessions on real phones; qualified Tamil clinical review and corrections. | Participants and translator required |
| 40 | Release decision | Regulatory/privacy review, clinical validation packet, incidents and recovery drill, signed approval, deployment rollback and monitored rollout. | All prior gates, then explicit Dheepika approval |

## Active decisions

- Keep the current site as a demo. It stores records locally and is not a clinical deployment.
- The existing motion–appearance challenge set reports unsafe elbow and object occlusion values. Do not release or soften the blocker until the locked set and real-phone captures pass.
- Clinical acceptance thresholds belong to the clinical lead and study statistician. The UI may check completeness and range, but it must not invent numbers.
- Every release candidate is per protocol and per device context. Passing one joint or model is no evidence for another.
- Record progress in this file and link raw measurements or test outputs. A green build means the software compiled, not that the intervention is safe or effective.

## Engineering checkpoint, 7 October 2026

The study dataset excludes demo flags on the patient, assessment, capture and reference; unblinded or contradictory references; duplicate capture/metric reference pairs; and malformed timestamps. Threshold pre-specification now precedes both capture and reference data; a blinded reference may legitimately be measured before the camera capture. The capture-failure denominator uses eligible camera attempts, including attempts with no reference. The threshold table declares all reported protocol metrics, including secondary compensation measures. Tests cover these cases and a protocol-output inventory check. These changes improve the integrity of future analysis; they do not provide reference agreement or clinical validation.
