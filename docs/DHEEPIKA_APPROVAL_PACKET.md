# Dheepika Lab — clinical approval packet

**For:** Dheepika, clinical lead
**Status:** **NOT APPROVED — approval pending.** Your approval is on hold by instruction. Nothing in this packet or the app records, implies or simulates it. Real-patient use is disabled in the build (`REAL_PATIENT_USE_ENABLED = false`), and the app has no button that could approve it.
**Build:** branch `claude/physiovision-ai-platform-49ysp2`, deployed at https://physiovision-ai-eta.vercel.app (demo and simulation only).

---

## 1. What you are asked to decide
You are **not** asked to approve use with real patients now. You are asked to review, item by item:
1. the **claims and non-claims** of each camera test (§2);
2. the **clinical rules**: safety screens, the knee consideration rules, observation and exception thresholds, the pain and plan rules (§5);
3. the **exercise content** drafts (§6);
4. the **validation plan** and who sets its acceptance thresholds (`docs/VALIDATION_STUDY_PLAN.md`);
5. the **incident process** (`docs/INCIDENT_PROCESS.md`).

Each can be approved, changed or rejected separately. Real-patient release needs every go/no-go item in §8 to pass.

## 2. Claims and non-claims (intended-use registry: `src/release/intendedUses.ts`)
| Area | Tests (protocol @ version) | The camera may report | It must NOT be used for |
|---|---|---|---|
| Knee | supported flexion, sit-to-stand, squat @1.1.0 | 2D knee flexion/extension, sit-to-stand timing, squat frontal-plane knee angle (FPPA) and depth | Diagnosis, ligament/meniscus status, strength, effusion, passive range |
| Shoulder | flexion (side view), abduction (front view) @1.0.0 | Arm elevation in one plane; trunk compensation as a separate value | Rotation, hand-behind-back, scapular motion, painful arc, strength |
| Hip | standing flexion, standing abduction @1.0.0 | Thigh angle; trunk angle / side-lean separately | Rotation, extension, passive range, strength |
| Ankle and foot | knee-to-wall lunge, heel raise @1.0.0 | Shin angle with the heel down (dorsiflexion proxy); heel-raise count and lift angle | Joint angle itself, stability, calf strength or endurance |
| Back and neck | forward bend, side bend, neck movement @1.0.0 | Trunk inclination (hip plus spine combined); head-on-trunk change from the start position | Lumbar or cervical range, posture, curvature, structure, neurology |
| Balance | single-leg stance, marching @1.0.0 | Stance time (30 s cap); steps, cadence, left/right lift | Fall risk (no score), gait, vestibular function |

Every value is a **camera estimate** with its quality verdict, protocol and algorithm version, view and setup. If capture quality fails, the number is withheld with the reason and a recapture is requested. The camera never measures strength or force. Device-measured strength (dynamometers) is a separate category (Phase 18).

## 3. Evidence to date — honest summary
| Evidence | Status |
|---|---|
| Unit tests (231) through the real pipeline, on **synthetic** skeletons with known ground truth | Pass |
| Lab runs of the real pose model on **emulated** scenes in one desktop browser (knee, shoulder) | See `docs/tracking/RESULTS.md` |
| Automated browser journeys (patient and clinician) and accessibility checks (axe, 390 px) | Pass; no page errors |
| **Real phones** | **None** |
| **Human participants, repeatability, reference agreement** | **None** |

Nothing is validated. Every intended use is `not_validated`.

## 4. Known limits and open risks
1. **Occlusion (release blocker).** In the lab, a self-occluded elbow (shoulder tests) and an object in front of the leg still produced unsafe values. The Phase 3 coverage check caught none of them and increased refusals; whether to keep it gating is a decision for you and the owner.
2. **No server.** Records are browser-local; the authentication is not suitable for patients. The PostgreSQL schema with row-level security and audit is tested locally (migrations 001–004) but not deployed.
3. **2D projection.** Values depend on camera view and level. Setup is checked and stored, and trends break when the setup differs, but real-phone behaviour is unmeasured.
4. **Tamil.** 152 of 545 interface strings are drafts; none has been reviewed. All clinical questionnaires are English-only.
5. **Synthetic-only regions.** Hip, ankle, spine and balance have no real-device captures at all.
6. **Thresholds are drafts.** Capture-quality parameters (for example the lunge heel-rise 5°, heel-raise 12°, stance lift 3%/6%, marching 8%) and all clinical and exception thresholds need your review.

## 5. Clinical rules for review (all DRAFT)
**Safety (red-flag) screens.** An answer routes to emergency, urgent, or clinician review, and a patient on a safety hold gets no camera tests or exercises.

| Screen | Items | Emergency | Urgent | Review |
|---|---|---|---|---|
| knee-safety@1.0.0 | 11 | 4 | 4 | 3 |
| shoulder-safety@1.0.0 | 10 | 3 | 5 | 2 |
| hip-safety@1.0.0 | 10 | 5 | 3 | 2 |
| ankle-safety@1.0.0 | 10 | 4 | 5 | 1 |
| spine-safety@1.0.0 | 10 | 3 | 5 | 2 |
| balance-safety@1.0.0 | 7 | 2 | 3 | 2 |

History questionnaires: knee (28 questions), shoulder (29), hip (29), ankle (29), spine (30), balance (14), all @1.0.0. Item texts are in `src/clinical/safety.ts`, `intake.ts` and `regionQuestionnaires.ts`.

**Knee consideration rules** `knee-considerations@0.1.0`:
- rules: patellofemoral, meniscal, ligamentous, osteoarthritis, post_operative, referred, inflammatory;
- each shows supportive / conflicting / missing evidence;
- no probabilities or diagnoses;
- all suppressed during a safety hold.

No other region has consideration rules.

**Observation thresholds** (static posture scan, clinic-configurable):

| Threshold | Value |
|---|---|
| shoulder level | 2° |
| pelvic level | 2° |
| head tilt | 3° |
| trunk lateral lean | 2° |
| knee frontal | 8° |
| ear–shoulder line | 15° |
| trunk sagittal | 8° |
| left/right asymmetry | 10° |
| knee flexion limited | < 120° |

**Exception queue** (operational defaults, all unreviewed):

| Rule | Default |
|---|---|
| Pain rise over the 7-day median | ≥ 2 points |
| Adherence (14 days) | < 50% |
| No contact | ≥ 7 days |
| Comparable camera decrease | ≥ 10 |
| Invalid captures in one assessment | ≥ 2 |
| Weekly steps drop | ≥ 30% |

**Plan rules:**
- The pain rule stops a session at the clinician-set level; by default a stop also pauses the plan, and only a clinician resumes it.
- A new plan version that intensifies the plan needs a recorded reason.
- The patient can pause but never intensify.
- Reassessment reminders are clinician-chosen.

**AI consultation draft** `dl-consult-draft-1.0.0`:
- rule-based; no language model is active;
- every statement cites evidence;
- diagnostic, probability, severity, strength and norm claims and prompt injection are rejected by a validator;
- you accept, edit, reject or defer each statement;
- drafts are never shown to patients or exported.

## 6. Exercise content (16 drafts, 0 published)
- **Camera-guided subset** (labelled "synthetic tests only; not yet tested on devices"): standing knee bend, straight leg raise, arm raise forwards, arm raise to the side.
- **Instruction-only:** seated knee bend, quad set, sit to stand, heel raises, seated heel raises, bridge, clamshell, arm pendulum, chin tuck, pelvic tilt, supported single-leg stand, seated marching.
- Each has instructions, precautions, default dosage and a review owner. There are no media (licensed media needed).
- Nothing reaches a patient until you approve the exact version in the Library.

## 7. Privacy and regulatory — for qualified advisers (no conclusions drawn here)
- **Data processed:** health data (symptoms, pain, answers), pose landmarks (no video stored), optional step counts, device measurements.
- **Consent:** camera processing and storage at onboarding; steps and walking time separately; image and research consent separately.
- **Controls:** export and erasure (tested across every table), no analytics or telemetry (tested), redacted local incident log.
- **To review for the launch jurisdiction(s):**
  - data-protection law (for India, the Digital Personal Data Protection Act 2023);
  - whether this software is a regulated medical device (for India, the CDSCO Medical Devices Rules; elsewhere, the local equivalent) and its classification;
  - hosting location and data-processing agreements;
  - professional-practice rules for remote physiotherapy.

## 8. Go / no-go checklist (live in the app: Settings → Release readiness)
| # | Item | Status |
|---|---|---|
| 1 | Your approval of the release | **Pending (on hold)** |
| 2 | Intended uses validated (0 of 14) | Pending |
| 3 | Acceptance thresholds locked before analysis | Pending |
| 4 | Clinical rule sets reviewed | Pending |
| 5 | Exception thresholds reviewed | Pending |
| 6 | Exercise content reviewed and published; licensed media | Pending |
| 7 | Real-phone benchmark on target devices | Pending |
| 8 | Occlusion release blockers resolved | **Fail** |
| 9 | Secure server deployment | Pending |
| 10 | Privacy impact assessment and agreements | Pending |
| 11 | Regulatory classification reviewed | Pending |
| 12 | Tamil clinical translation reviewed | Pending |
| 13 | Usability and screen-reader testing with real users | Pending |
| 14 | Incident process agreed and staffed | Pending |
| 15 | Real-patient build flag enabled by a reviewed release | Pending |

## 9. Approval record
| Item | Decision (approve / change / reject) | Notes | Signature | Date |
|---|---|---|---|---|
| Claims and non-claims (§2) | | | | |
| Safety screens (§5) | | | | |
| Knee consideration rules | | | | |
| Observation / exception thresholds | | | | |
| Plan and pain rules | | | | |
| Exercise content (per item, in the Library) | | | | |
| Validation plan | | | | |
| Incident process | | | | |
| **Release to real patients** | | | | |

*Left blank intentionally. To be completed only by Dheepika.*
