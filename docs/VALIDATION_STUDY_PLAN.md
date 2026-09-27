# Validation study plan (Phase 20) — DRAFT for the clinical lead and a statistician

**Status:** plan only. No human, real-phone or reference-instrument data has been collected. Every intended use in `src/release/intendedUses.ts` is `not_validated`. The acceptance thresholds below are **not set by engineering**: the clinical lead and a statistician set and **lock** them in the app (Validation study screen) *before* the final evaluation set is analysed.

## 1. Locked versions under test
Protocols (algorithm): `knee_*@1.1.0` (pv-knee-1.1.0), `shoulder_*@1.0.0` (dl-shoulder-1.0.0), and hip, ankle, spine, balance `@1.0.0` (dl-regions-1.0.0). The pose model is BlazePose GHUM Lite via MediaPipe tasks-vision, with the version pinned in the build. Any change to a protocol, algorithm or model version during a study ends that study arm: results from different versions are never pooled, and the trend and export logic already treats them as incomparable.

## 2. Questions, per test and per intended-use population
| Study | Design | Primary statistics |
|---|---|---|
| **Repeatability** (within session) | Same participant, same phone and setup, 3 captures | ICC(3,1) with 95% CI, SEM, MDC95 |
| **Test–retest** (between days) | Two sessions 2–7 days apart with no expected change, setup re-created from the stored capture config | ICC(2,1), SEM, MDC95; share of captures refused (failure rate) |
| **Inter-device** | Same session captured on each target phone class (low, mid, high tier; Android and iOS) | Bland–Altman between devices; failure rate per device |
| **Reference agreement** | Camera vs the reference measure (table below), examiner blinded to the camera value | Bland–Altman bias and 95% limits of agreement, proportional bias check, failure rate |
| **Usability** | Home-use set-up without help, then with guidance | Task completion, time to a valid capture, SUS; qualitative issues |

| Protocol | Reference measure |
|---|---|
| knee_supported_flexion | Universal goniometer (blinded examiner) |
| knee_sit_to_stand | Stopwatch / frame-annotated video |
| knee_squat | Frame-annotated video (FPPA) |
| shoulder_flexion_active / abduction | Goniometer or digital inclinometer |
| hip_flexion_standing / abduction | Goniometer |
| ankle_knee_to_wall | Digital inclinometer on the tibia, weight-bearing lunge |
| heel_raise_double | Frame-annotated video (count) |
| trunk_forward_bend / side_bend | Inclinometer / frame-annotated video (as combined trunk measures) |
| neck_flexion_extension | CROM device or inclinometer (change from neutral) |
| single_leg_stance | Stopwatch by a trained examiner |
| march_in_place | Frame-annotated video (count and timing) |

## 3. Populations and sample size (to be confirmed)
- **Intended-use populations:** adults attending physiotherapy for the relevant region, able to do the test safely at home. Balance tests are supervised for anyone with repeated falls (safety screen).
- **Sample size:** set with the statistician from the precision required for the limits of agreement and the ICC confidence interval. Commonly cited planning figures are **≥ 50 participants for method comparison** and **≥ 30 for reliability**, per population; this plan does not choose the number.
- **Recruitment** must cover age, sex, body size, skin tone (e.g. Fitzpatrick I–VI), mobility aids, clothing and home lighting, so that the subgroup analysis in §4 is possible.

## 4. Bias and failure analysis
- Report agreement **and refusal rate** by subgroup: skin tone, body size, age, sex, clothing, lighting, phone tier.
- A test whose refusal rate or limits of agreement differ materially between subgroups is not released for those subgroups.
- Every refused capture is logged with its reason; refusal is the safe failure mode and must not be hidden.

## 5. Pre-registration and analysis rules
- Lock the acceptance thresholds (limits of agreement, maximum failure rate, minimum ICC, minimum n per test) in the app before analysis. The app records who locked them and when.
- Split development and final evaluation sets. Thresholds and algorithms are frozen before the final set is touched.
- Analyse only valid captures for agreement, and report the refusal rate separately.

## 6. Ethics, consent and data
- Ethics committee approval and written informed consent, including separate, purpose-specific consent for any retained video. The product stores landmarks only; raw video only under a study protocol.
- Study data are kept on the approved server (Phase 6), never in browser storage, with the audit trail on.

## 7. Outcome
For each intended use: **validated**, **validated for a narrower population or claim**, or **not released**. The intended-use registry is updated by a reviewed code change and the evidence is referenced in the approval packet.
