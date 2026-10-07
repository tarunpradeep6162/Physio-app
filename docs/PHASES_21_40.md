# Dheepika Lab: phases 21–40

**Baseline:** phases 1–20 in [PHASE_TRACKER.md](PHASE_TRACKER.md) have engineering work, but their clinical and device gates remain open. This plan starts from the 6 October 2026 build; it is not a claim of validation or readiness for patient care. The real-patient build flag stays off. Dheepika's clinical approval remains on hold.

Each phase has one independently reviewable exit. A phase is complete only when its evidence link, reviewer, device/configuration and any residual failure are recorded here. Synthetic tests cannot substitute for real-device or reference measurements. Do not expand clinical claims as a shortcut to filling the catalogue.

| Phase | Deliverable | Exit evidence / dependency | State |
|---|---|---|---|
| 21 | Release threshold integrity | Every current metric has a valid, locked threshold before evaluation references exist; test partial and malformed tables. | Engineering implemented; no clinical thresholds set |
| 22 | Occlusion failure research | Reproduce elbow and object failures on real devices; fail closed for unobservable joints; keep unsafe frame count at zero across the locked challenge set. | Blocked on capture set and device |
| 23 | Phone benchmark kit | Consent-safe capture worksheet, timestamps, device/model/browser/lighting, dropped frames, thermal state and reproducible export. | Worksheet plus JSON run context (time, device, browser, battery, page visibility; `0146145`); real phone runs pending |
| 24 | Anatomy mobile performance | Inspect atlas on target phones for WebGL loss, frame time, memory, tap regions and accessible 2D fallback. | On-device measurement + JSON record, WebGL-loss → 2D fallback, [phone QA worksheet](ANATOMY_PHONE_QA.md) (`a9b6f9f`); acceptance criteria and real-phone runs pending |
| 25 | Reference pairing | Blinded clinician measurement entered independently with instrument and timestamp; split participants before capture. | Dataset guard extended (demo, mismatch, duplicate, unblinded and pre-capture references excluded); capture conditions (lighting, clothing, consented skin-tone band) recorded with the reference (`d658d9b`); study enrolment pending |
| 26 | Agreement analysis | Per metric/device/subgroup failure, bias, LoA and repeatability against prespecified thresholds; show missing data. | Engineering implemented (`d658d9b`): subgroup tables, second-day test–retest ICC/SEM/MDC95 feeding the release check, failure reasons, missing data; study evidence pending |
| 27 | Shoulder release candidate | Real-person shoulder ROM and occlusion tests, instructions, clinician review and report checks. | Depends on 22–26 and clinical review |
| 28 | Knee release candidate | Repeat the full knee pathway with target phone setups and reference exam; investigate lateral/supine failure modes. | Depends on 22–26 |
| 29 | Hip and ankle release candidates | Separate protocol validation and usability findings for each metric; no borrowed accuracy claim. | Depends on 22–26 |
| 30 | Spine and balance release candidates | Define limitations for 2D projection, neck landmark proxy and balance timing; test independently. | Depends on 22–26 |
| 31 | Secure server environment | Deploy database migrations, OIDC, row security, backups and audit to controlled staging; negative access tests. | All migrations, negative-access tests and backup/restore drill pass locally (`scripts/db-check.sh`, 7 Oct); migrations 000003/000004 not yet applied live; hosting, IdP and privacy decisions required |
| 32 | Data migration and sync | Account-bound transfer from browser storage with consent, provenance, conflicts, rollback and deletion test. | Import planner tested (`27dd307`): account-bound, consent-checked, conflicts block, exact rollback, erasure test; server execution depends on 31 |
| 33 | Consultation draft review | Trace every AI statement to a source and show uncertainty; clinician accept/edit/reject/defer and sign-off audit. | Engineering present (cited statements, completeness/uncertainty, per-statement accept/edit/reject/defer); clinical rules review remains on hold |
| 34 | Plan safety and exceptions | Assignment versioning, pause/escalation, overdue review and clinician-visible deviations across devices. | Exception queue adds overdue review, overdue reassessment and unresolved pause (`27dd307`); cross-device depends on 31–33 |
| 35 | Daily companion | Low-friction check-in, reminders and accessible progress without presenting activity as diagnosis. | Depends on consent and secure records |
| 36 | Activity integration | Native HealthKit/Health Connect adapters, revocation, duplicate handling, source/timezone fidelity and opt-out. | Depends on 31, 35 and actual device bridge |
| 37 | Exercise catalogue pipeline | Licensed media, anatomy, instructions, contraindications, language review, versioned approval and search. Seed in reviewed batches; do not promise 2,000 approved items. | Clinician-authored cues and common mistakes per item (draft → review); content owner and licensing required |
| 38 | Clinic operations | Scheduling, course/payments, care relationships, role scopes, exports and audit tested in multi-clinic staging. | Single-clinic features built (walk-in registration, attendance, audited exports); multi-clinic staging depends on 31–32 |
| 39 | Accessibility and localization | Screen-reader and reduced-motion sessions on real phones; qualified Tamil clinical review and corrections. | Automated audit `npm run a11y`: 0 axe violations across 44 screen/width runs after fixes (`08893ea`); real screen-reader sessions, participants and translator required |
| 40 | Release decision | Regulatory/privacy review, clinical validation packet, incidents and recovery drill, signed approval, deployment rollback and monitored rollout. | All prior gates, then explicit Dheepika approval |

## Active decisions

- Keep the current site as a demo. It stores records locally and is not a clinical deployment.
- The existing motion–appearance challenge set reports unsafe elbow and object occlusion values. Do not release or soften the blocker until the locked set and real-phone captures pass.
- Clinical acceptance thresholds belong to the clinical lead and study statistician. The UI may check completeness and range, but it must not invent numbers.
- Every release candidate is per protocol and per device context. Passing one joint or model is no evidence for another.
- Record progress in this file and link raw measurements or test outputs. A green build means the software compiled, not that the intervention is safe or effective.

## Engineering checkpoint, 7 October 2026

The study dataset excludes demo flags on the patient, assessment, capture and reference; unblinded or contradictory references; duplicate capture/metric reference pairs; and malformed timestamps. Threshold pre-specification now precedes both capture and reference data; a blinded reference may legitimately be measured before the camera capture. The capture-failure denominator uses eligible camera attempts, including attempts with no reference. The threshold table declares all reported protocol metrics, including secondary compensation measures. Tests cover these cases and a protocol-output inventory check. These changes improve the integrity of future analysis; they do not provide reference agreement or clinical validation.

## Engineering checkpoint, 7 October 2026 (second pass)

Reviewer: engineering only (Claude Code session). **No clinician, statistician, device tester or Dheepika has reviewed these changes.** Configuration: the 6 October build, then the commits below. Checks were run in the sandbox: `npm run typecheck`, `npm test` (52 files, 322 tests), `npm run build` and `scripts/db-check.sh` all pass. `npm run a11y` reports 0 violations. Browser checks used headless Chromium with the SwiftShader software renderer, which is not a phone.

| Phase | Change | Evidence | Residual |
|---|---|---|---|
| 23 | Benchmark JSON gains run context (times, UA, platform, DPR, cores, memory, battery start/end, visibility) | `0146145`, `src/lab/liveBench.ts`, [PHONE_RUN.md](tracking/PHONE_RUN.md) | No real phone run recorded |
| 24 | Device check panel and JSON export; WebGL context loss falls back to the 2D map with selections kept; QA worksheet | `a9b6f9f`, `src/features/bodymap/atlasProbe.ts` (+ tests), [ANATOMY_PHONE_QA.md](ANATOMY_PHONE_QA.md) | Software-renderer timings only. The model is about 1.59 M triangles and about 31 MB of buffers, which may be heavy for phones. Acceptance criteria are unset |
| 25–26 | Study conditions on references (skin tone only with consent); subgroup agreement; second-day test–retest per STUDY_PROTOCOL step 4; failure reasons; missing data | `d658d9b`, `src/clinical/validationData.ts` (+ tests) | No study data, so no agreement or repeatability result exists. Thresholds have not been locked by the clinical lead |
| 31 | Local verification only | `scripts/db-check.sh`: all Supabase migrations, negative access and backup/restore pass | Live database still lacks migrations 000003/000004. Hosting, IdP and backups are undecided |
| 32 | Import planner with consent, ownership, conflicts, rollback, provenance | `27dd307`, `src/data/migrationImport.ts` (+ tests) | No server importer yet (depends on 31) |
| 34 | Overdue review, reassessment and pause exceptions; old settings inherit new rules unreviewed | `27dd307`, `src/clinical/trends.ts` (+ tests) | Thresholds are operational defaults awaiting clinician review |
| 39 | Contrast (#5b677a, ≥ 4.5:1), calendar accessible names, focusable scroll regions; repeatable audit script | `08893ea`, `scripts/a11y-audit.mjs` | Automated rules only. No TalkBack/VoiceOver users or Tamil review yet |

Unchanged and still blocked: 22 (locked occlusion capture set and devices; elbow and object occlusion remain release blockers), 27–30 (depend on 22–26 and clinical review), 35–36 (consent, secure records, native bridge), 40 (all gates, then explicit Dheepika approval). The real-patient flag stays off.


Next: [phases 41–60](PHASES_41_60.md).
