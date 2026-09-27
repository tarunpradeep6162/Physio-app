# Dheepika Lab — phase tracker (next 20 phases)

Source brief: *Dheepika Lab — Opus 5.5 High master implementation prompt* (27 Sep 2026). Status values:
- **not started**
- **in progress**
- **engineering done – gate pending** (code, tests and docs are done; a human or real-device gate remains)
- **done**
- **blocked**

A phase is never marked **done** on a clean build alone.

**Clinical approval:** Dheepika's approval is **on hold** by instruction. Every clinical rule and all patient-facing clinical copy are **drafts**. No approval has been recorded or simulated.

## Audit baseline (verified 27 Sep 2026)

| Area | Verified state |
|---|---|
| Branch / deploy | `claude/physiovision-ai-platform-49ysp2`, production alias `physiovision-ai-eta.vercel.app`. READY at `4519150` (= HEAD at audit). |
| Build / tests | `npm ci`, `tsc -b`, `vitest run`: 17 files and 123 tests pass. `vite build` succeeds. |
| Brand | Dheepika Lab identity is applied (`docs/BRAND.md`): Outfit, Work Sans and Noto Sans Tamil, self-hosted from `@fontsource`. Internal storage keys and schema kinds keep their historical `physiovision` ids so existing records keep working. |
| Knee | Complete pathway: intake, safety, 3 protocols @1.1.0 (`pv-knee-1.1.0`), replay, bilateral comparison, evidence, draft considerations (`knee-considerations@0.1.0`), 14-section report, reassessment. |
| Shoulder | **Exercises only** (flexion, draft abduction) in the program builder. No intake, safety screen, assessment protocols, workspace or report. The patient flow, persistence, report and evidence code are knee-bound: `KneeAssessment`, `createKneeAssessment`, `HISTORY_QUESTIONNAIRE`, `SAFETY_QUESTIONNAIRE` and `KNEE_DEFAULT_PLAN`. |
| Pose | On-device BlazePose Lite in a Web Worker, with main-thread fallback and a measured delegate probe. Identity guard, strict occlusion and a plausibility guard are in place. |
| Records | Browser localStorage only. The PostgreSQL schema, RLS, consent triggers and hash-chained audit are **tested on PG16 but not deployed**. No server auth. |
| AI | Deterministic, versioned rules only. There is no LLM call in the app. |
| Prescription | Program builder with guard-rails and a pain-pause rule. Earlier programs are archived when a new one is published. |
| Devices | **No real-phone evidence.** Lab harness and phone run sheet exist (`docs/tracking/PHONE_RUN.md`). |
| Wearables | None. |

## Phases

| # | Phase | Depends on | Status | Remaining gate |
|---|---|---|---|---|
| 1 | Shoulder assessment pathway | — | **engineering done – gate pending** | Clinical review of the draft shoulder content (on hold); real-device captures (Phase 2). Details: `docs/SHOULDER_PROTOCOL.md` |
| 2 | Real-phone tracking benchmark | 1 | **engineering done – gate pending** | Harness, device matrix, sustained/thermal telemetry and shoulder scenarios delivered (`docs/tracking/PHONE_RUN.md`). **Device results pending:** no real phone available. |
| 3 | Robust validity and person lock | 1 | **in progress – owner decision needed** | Arm limb-swap guard and adversarial tests done. The coverage check caught none of the lab's unsafe occlusion frames and raised refusals (`docs/tracking/RESULTS.md`). Elbow/object occlusion stay **release blockers** for affected metrics. |
| 4 | Movement-specific setup and calibration | 1 | **engineering done – gate pending** | Arm-room check for overhead / side-reach protocols. Real-phone framing checks pending. |
| 5 | Low-latency coaching engine | 3, 4 | **engineering done – gate pending** | Deterministic `pcue.*` cue engine; frame→paint latency stored per capture. Latency on real phones not measured. |
| 6 | Secure clinical records foundation | — | **engineering done – gate pending** | Migration 002 (tenancy) and backup/restore drill pass on local PG16; client read scope; store authorization boundary. **Not deployed:** hosting, IdP and DPA are owner decisions. |
| 7 | Structured AI consultation draft | 6 | **engineering done – gate pending** | Rule-based draft + validator live; language-model contract inactive (needs a server, provider and DPA). Clinical content approval on hold. |
| 8 | Clinician review and sign-off workflow | 7 | **engineering done – gate pending** | Accept/edit/reject/defer, exam findings, stale sign-off notice; clinician-only writes enforced. Usability with a real clinician pending. |
| 9 | Prescription and plan versioning | 8 | **engineering done – gate pending** | Versions, change diff, reason for intensification, alternatives, pauses (patient/pain rule) with clinician-only resume, reassessment triggers, migration 003 with RLS. Clinical review of pause wording and triggers (on hold). |
| 10 | Daily companion foundation | 9 | not started | Cross-device sync needs the Phase 6 server |
| 11 | Wearable and phone activity integration | 6, 10 | not started | Native app capability (Health Connect / HealthKit) |
| 12 | Hip pathway | 1–4 | not started | Validation evidence |
| 13 | Ankle and foot pathway | 1–4 | not started | Validation evidence |
| 14 | Spine and neck pathway | 1–4 | not started | Validation evidence |
| 15 | Balance, gait and functional performance | 1–4 | not started | Reference captures |
| 16 | Exercise content system at scale | 9 | not started | Licensed media and clinical content review |
| 17 | Clinician intelligence and longitudinal trends | 8, 10 | not started | Threshold review |
| 18 | Reference measurements and interoperability | 6 | not started | Device imports need real devices |
| 19 | Accessibility, localization, privacy and mobile hardening | all | not started | Tamil clinical review; real-device usability |
| 20 | Evidence, clinical validation and controlled release | all | not started | Studies and Dheepika's approval (on hold) |

## Gap list (updated as work proceeds)

1. ~~The pathway is hard-wired to the knee.~~ **Fixed in Phase 1** by `src/clinical/pathways.ts`: history, safety, default plan, sub-locations, report rows, trend and scope limits all come from the pathway.
2. ~~Protocol ids are knee-only.~~ **Fixed in Phase 1** by `src/engine/protocols/registry.ts` and per-protocol `algorithmVersion`.
3. ~~No shoulder red-flag screen.~~ **Fixed in Phase 1** with `shoulder-safety@1.0.0` (draft).
4. ~~The report and PDF say "Knee".~~ **Fixed in Phase 1:** the title and template version come from the pathway.
7. **Found in Phase 1 and fixed:** `levelFromResponses` re-evaluated every stored safety response against the knee screen. It now uses each response's own questionnaire.
8. **Found in Phase 1 and fixed:** the safety evidence item was always labelled `knee-safety`.
9. **Found in Phase 1 and fixed:** the report's Progress chart appeared after a single assessment (it counted left and right points rather than assessments).
10. ~~Calibration ignored headroom for an overhead arm.~~ **Fixed in Phase 4** by the arm-room check.
11. **Open:** demo data is seeded once per browser. Browsers that already hold the earlier demo will not see demo patient DP-04 until site data is cleared.
5. There is no server, so real-patient use is impossible. → Phase 6.
6. There is no real-device data. → Phase 2 (hardware needed).
12. **Open (Phase 3):** self-occlusion of the elbow and object occlusion still yield unsafe values in the lab; the coverage check did not catch them. Owner decision recorded in `docs/tracking/RESULTS.md`.
13. **Found in Phase 9 and fixed:** a patient session could call `remove()` on clinician-only tables, and history tables (impressions, decisions) could be edited. Store `remove` now applies the clinician guard, and history tables are append-only.
14. **Found in Phase 9 and fixed:** on the server, a patient could read an unapproved draft program. `programs_read` now shows patients approved versions only.

Per-phase reports (changes, migration impact, risks, test evidence): `docs/PHASE_REPORTS.md`.
