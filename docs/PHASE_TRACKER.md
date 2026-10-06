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
| 10 | Daily companion foundation | 9 | **engineering done – gate pending** | Offline recording and two-tab merge verified in the browser. **Cross-device sync not live:** it needs the Phase 6 server; the merge (`src/data/sync.ts`) is ready and tested. Copy review (Tamil, clinical) pending. |
| 11 | Wearable and phone activity integration | 6, 10 | **engineering done – gate pending** | Apple Health export and CSV import, granular consent, de-duplication, revoked/absent handling, migration 004 with consent-enforcing RLS (`docs/ACTIVITY_INTEGRATION.md`). **Live Health Connect / HealthKit reads need native apps**; step totals not yet checked on real phones. |
| 12 | Hip pathway | 1–4 | **engineering done – gate pending** | 2 protocols, history and safety drafts, report template, demo DP-05. Synthetic evidence only; **real-device and reference validation pending**; clinical review on hold. `docs/REGION_PROTOCOLS.md` |
| 13 | Ankle and foot pathway | 1–4 | **engineering done – gate pending** | Lunge (heel-down gate) and heel raise; occlusion, wrong-view and framing gates tested; browser capture verified with the simulated provider. Real-device validation pending. |
| 14 | Spine and neck pathway | 1–4 | **engineering done – gate pending** | Trunk forward/side bend and neck change-from-start; no posture or structural claims; red-flag screen. Real-device validation pending. |
| 15 | Balance, gait and functional performance | 1–4 | **engineering done – gate pending** | Single-leg stance timing and marching; the safety screen sends repeated falls to the clinician. Timing matches synthetic references; **stopwatch/real reference captures pending**. Walking gait is not implemented (needs a validated setup). |
| 16 | Exercise content system at scale | 9 | **engineering done – gate pending** | Schema, versioning, review workflow, import (always unreviewed), faceted index tested at 2,500 records, camera subset labelled by QA level, library prescriptions. 16 draft items, **0 published** (clinical review on hold); licensed media and bulk curated content pending. |
| 17 | Clinician intelligence and longitudinal trends | 8, 10 | **engineering done – gate pending** | Trends break on incomparable data with reasons; exception queue with configurable rules shown as unreviewed until reviewed. **Clinical review of thresholds pending.** |
| 18 | Reference measurements and interoperability | 6 | **engineering done – gate pending** | Device measurements (units, calibration, device, time, source) via entry and CSV; FHIR R4 export with round-trip test. **Real device files and care-system conformance testing pending.** |
| 19 | Accessibility, localization, privacy and mobile hardening | all | **engineering done – gate pending** | Linkage-based data export and erasure covering every table; redacted local incident log; source scan for telemetry and logging; axe clean on 16 new screens at 390 px; larger live numerals in large-text mode; Tamil review sheet (152 of 545 drafts, questionnaires English-only). **Tamil clinical translation, real-phone usability and screen-reader testing pending.** |
| 20 | Evidence, clinical validation and controlled release | all | **engineering done – gate pending** | Intended-use registry (14, all not validated), computed go/no-go gate in Settings, real-patient use hard-disabled, validation study plan, incident process, approval packet (`docs/DHEEPIKA_APPROVAL_PACKET.md`). **Studies not run; Dheepika's approval pending (on hold).** |

## Gap list (updated as work proceeds)

1. ~~The pathway is hard-wired to the knee.~~ **Fixed in Phase 1** by `src/clinical/pathways.ts`: history, safety, default plan, sub-locations, report rows, trend and scope limits all come from the pathway.
2. ~~Protocol ids are knee-only.~~ **Fixed in Phase 1** by `src/engine/protocols/registry.ts` and per-protocol `algorithmVersion`.
3. ~~No shoulder red-flag screen.~~ **Fixed in Phase 1** with `shoulder-safety@1.0.0` (draft).
4. ~~The report and PDF say "Knee".~~ **Fixed in Phase 1:** the title and template version come from the pathway.
7. **Found in Phase 1 and fixed:** `levelFromResponses` re-evaluated every stored safety response against the knee screen. It now uses each response's own questionnaire.
8. **Found in Phase 1 and fixed:** the safety evidence item was always labelled `knee-safety`.
9. **Found in Phase 1 and fixed:** the report's Progress chart appeared after a single assessment (it counted left and right points rather than assessments).
10. ~~Calibration ignored headroom for an overhead arm.~~ **Fixed in Phase 4** by the arm-room check.
11. ~~Demo data is seeded once per browser.~~ **Fixed 6 Oct 2026:** the demo fixture is versioned (`DEMO_FIXTURE_VERSION`); a returning browser's old demo rows (including unflagged rows linked to demo patients) are replaced, real accounts untouched. The demo now includes back-office samples.
5. There is no server, so real-patient use is impossible. → Phase 6.
6. There is no real-device data. → Phase 2 (hardware needed).
12. **Open (Phase 3):** self-occlusion of the elbow and object occlusion still yield unsafe values in the lab; the coverage check did not catch them. Owner decision recorded in `docs/tracking/RESULTS.md`.
13. **Found in Phase 9 and fixed:** a patient session could call `remove()` on clinician-only tables, and history tables (impressions, decisions) could be edited. Store `remove` now applies the clinician guard, and history tables are append-only.
14. **Found in Phase 9 and fixed:** on the server, a patient could read an unapproved draft program. `programs_read` now shows patients approved versions only.
15. **Found in Phase 10 and fixed:** two open tabs each saved their whole in-memory copy, so the later save silently erased the other tab's new records. Saves now detect a newer stored revision and merge (audit-based), and conflicts are recorded in the audit and shown to the patient.
16. ~~Demo sign-offs were attributed to “Dheepika”.~~ **Fixed** (commit `4e69c37`): the demo account is now “Demo clinician”, and older browser copies are migrated.
17. **Found in Phase 11:** re-selecting the same file did not re-import. Fixed by resetting the file input.
18. ~~Account deletion and export missed the tables added in phases 3–11.~~ **Fixed in Phase 19** by linkage-based export and erasure (`src/data/privacy.ts`), tested across every table and in the browser.
19. **Found in Phases 12–15 and fixed:** the left/right table and the report printed every difference in degrees; they now use the metric's own unit (seconds, %, counts).
20. **Found in Phase 15 and fixed:** marching with one foot below the detection level halved the cadence while reporting it as valid. It is now withheld with a reason.
21. **Found in Phase 17 and fixed:** clinic settings could be written by any account through `updateSettings`; it is now clinician-only.
22. ~~A pressed chip's check mark was part of its accessible name.~~ **Fixed in Phase 19** with CSS alt text (`content: '✓' / ''`).

Per-phase reports (changes, migration impact, risks, test evidence): `docs/PHASE_REPORTS.md`.

## Demonstration path (simulated data only)
1. Open https://physiovision-ai-eta.vercel.app → **Explore demo — patient**. The home screen shows the companion: today's plan, check-in, recent sessions, next appointment. **Assess another area** offers hip, ankle, back and balance.
2. **Assess** → knee (or `/p/assess/ankle`): symptom map → history → red-flag screen → camera tests with the simulated provider (setup guide, calibration, live capture, refusal when a joint is hidden) → results → submit.
3. **Train** → the approved plan version (camera exercises plus any approved library items) → session with pain check-ins. **I need to pause my plan** pauses it.
4. **Profile** → *Steps and walking*: consent per metric, import an Apple Health `export.xml`, 14-day table. Also data export and (for non-demo accounts) deletion.
5. Sign out → **Explore demo — physiotherapist** → overview with the **exception queue** and alerts → assessment queue → DP-01 (knee) or DP-05 (hip):
   - Captures & replay, Left / right, Evidence & reasoning ("Why?");
   - **AI draft** (accept / edit / reject / defer, examination findings);
   - Report (preliminary until signed).
6. Patient record:
   - **Programs**: version history, pauses, resume;
   - **Trends**: absolute values with break reasons;
   - **Devices & export**: dynamometer entry, CSV import, FHIR bundle download.
7. **Program builder**: a new version with a diff, a reason required when it intensifies, approved alternatives and library items, reassessment triggers.
8. **Library**: filter, the camera-guided subset with its QA label, submit → approve an item (demo).
9. **Settings**: exception-rule review, **Release readiness** (no-go), redacted incident log, rule approvals, validation thresholds.

## Clinic server (Supabase) — added 28 Sep 2026
Cross-device records: a physiotherapist on the owner's allowlist sees every patient of the clinic, and patients see only their own records. Code, migration and tests are done (`supabase/migrations/`, `src/data/remote/`, `db/supabase_test.sql`). Setup is in `docs/SUPABASE_SETUP.md`. **Inactive until the owner creates the Supabase project and sets `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in Vercel.** Local-mode accounts are not migrated.

## Clinical posture grid — added 30 Sep 2026
The static posture scan now uses a clinical grid layout:
- reference grid;
- relative height ruler (ankle = 0, nose = 100; never centimetres);
- plumb line;
- named level lines (head, shoulders, pelvis) in front and back views;
- plumb-offset ticks in side views;
- a measurement panel listing every metric of the view, either with its value or with the reason it was withheld.

**Modes:**
- *Self-scan* captures automatically and uses voice coaching.
- *Therapist-guided* uses the rear camera. The therapist taps Capture, which stays locked until the same setup checks pass.

Views (front, left and right side, back) can be selected directly. Results show zoomed panels for full body, head and neck, trunk and lower limb, and the same board appears in the clinician's *Captures* tab.

**Deliberately not included** (compared with the reference screenshots):
- no "X-ray" or radiograph styling, and no vertebral-level or injury-target markers;
- no centimetre values from an uncalibrated camera;
- no pelvis, trunk or full-body values when those landmarks are hidden, out of frame, or covered by hands or an object;
- no numbers before the setup checks pass.

The zoomed panels are crops of one camera, labelled as such. Tests: `src/engine/postureGrid.test.ts`, which covers the phone-in-front and head-and-shoulders webcam framing cases.

## "Physio AI" brief (7 rules, modules A–E) — mapped onto Dheepika Lab, 30 Sep 2026
The brief was applied to this app rather than rebuilt in Next.js. Where each requirement lives:

| Brief | Where |
|---|---|
| Rule 1 — surface landmarks only; no X-ray or vertebral markers | Posture grid (`camera/postureGrid.ts`) draws landmarks, lines and a plumb line only |
| Rule 2 — no centimetres | Degrees and % of ankle-to-nose height (`engine/posture.ts`, `postureGeometry.ts`) |
| Rule 3 — quality gate | `postureMetricStatus` / `gateStatuses` (withheld with a reason); calibration gate before capture |
| Rule 4 — no diagnosis or percentages; separate categories; clinician confirms | Algorithmic observations with rule and version; `reasoning.ts`; clinician review in the workspace |
| Rule 5 — red flags stop the flow | Safety step skips the camera tests; "unticked" never rules anything out |
| Rule 6 — real PubMed or labelled sample | `evidence/pubmed.ts` (E-utilities, records verbatim, errors show no citations); `EvidencePanel` in the planner |
| Rule 7 — opaque IDs, roles, consent, demo labelled | UUID routes plus `PT-XXXXXX` display code; Supabase RLS; camera consent (recorded in clinic if needed); demo banner |
| A — directory, volume chart, start assessment | Patients page (ID, age/sex, complaint, registered, Start assessment); Analytics patient-volume chart; `/c/patients/:id/assess` |
| B — 3D pain map with 2D keyboard fallback | `bodymap/BodyMap3D.tsx`, `BodyMap.tsx`, pathway sub-locations |
| C — posture scan modes, tabs, grid, HUD | `scan/StaticScan.tsx`, `PostureGrid.tsx` |
| D — intake, red flags, side-by-side summary | Assessment steps; clinician workspace summary by category |
| E — planner with evidence and rule explanations | `ProgramBuilder.tsx` + `EvidencePanel.tsx`; "Why?" and reasoning tabs |

## Clinic back office and competitor-informed features — added 6 Oct 2026

Features were chosen after reviewing a competitor's public pages. They are built in our own design and wording; none of the competitor's text, code or images was copied.

- **Theme:** system typeface; slate neutrals; teal accent. Text and buttons use teal-700 for 5.5:1 contrast. The custom Latin web fonts were removed; Tamil keeps Noto Sans Tamil.
- **Schedule** (`/c/schedule`):
  - month calendar and day agenda;
  - booking with a double-booking check;
  - attended, missed or cancelled status;
  - staff list;
  - WhatsApp reminder carrying only the date, time, clinic and staff name.
- **Billing** (`/c/billing`):
  - treatment courses, with sessions counted from attendance only;
  - payments in paise and outstanding dues;
  - expenses;
  - 12-month statement and chart;
  - CSV exports that are formula-safe and recorded in the audit log.
- **Discharge summary** (`/c/patients/:id/discharge`):
  - built from recorded data plus the physiotherapist's own text;
  - signed versions are append-only;
  - shows as preliminary again when the patient's data changes (fingerprint check).
- **Reports:** list the plan's attached PubMed evidence with PMID and DOI. The DOI is copied from PubMed and never constructed.
- **Onboarding:** asks for equipment at home and minutes per day (patient-reported). The program builder flags library items that need equipment the patient did not list.
- **Library supervision level** (home / in clinic only):
  - changed only through a new reviewed version;
  - in-clinic-only items cannot be added to a home plan.
- **Posture scan:**
  - spoken prompt for each view;
  - optional 15-second self-correction with a before/after table, coaching only (the habitual capture is the one saved).
- **Range-of-motion measurement guide** (`/c/library/rom-guide`): instrument placement only, no normal ranges; a draft awaiting clinical review.
- **Patient directory:** body-region filter, and an "App QR" button that encodes only the public sign-in address.
- **Server:**
  - `treatmentCourses`, `payments`, `expenses` and `discharges` are physiotherapist-only;
  - `discharges` is append-only;
  - migrations `20261006000001` and `20261006000002`, applied to the live project and covered by `db/supabase_test.sql`.
- **Deliberately not built:**
  - disease likelihood percentages;
  - spine curvature or Q-angle from a single camera;
  - centimetre measurements;
  - pre-filled sign-off names;
  - "AI recovery %";
  - public report links;
  - revenue split by patient gender.
- **Financial records on erasure:** clinic setting *Keep payment records when a patient deletes their account* (default off). When it is on, payments and course fees are kept with the patient link, course name and notes removed, both in the app and on the server (migration `20261006000004`). Whether to turn it on is the owner's decision after legal or accounting advice.
- **Supabase advisor fixes** (migration `20261006000003`):
  - the RLS helpers move to a private schema that the REST API does not expose;
  - `auth.uid()` and the helpers are evaluated once per query;
  - indexes on the `org_id` foreign keys;
  - an explicit no-access policy on the allowlist.

  Migrations `000003` and `000004` are tested locally (`db/supabase_test.sql`) and still have to be applied to the live project. Leaked-password protection is a dashboard setting (Authentication → Policies), so the owner must enable it there.
- **Phone layout:** the clinician bottom bar shows four sections plus **More**; library badges wrap.
- **Open questions:**
  - kinesiophobia questionnaire licensing;
  - more Indian languages (each needs clinical translation review).

## Pending human approval or real-device / clinical validation
- **Dheepika's approval** of the claims, rules, content, validation plan, incident process and release: **pending (on hold)**. Nothing was recorded or simulated.
- **Owner decisions:**
  - the Phase 3 coverage check (keep gating, diagnostic only, or retune);
  - Supabase project, region, plan and data-processing agreement; the physiotherapist allowlist (`docs/SUPABASE_SETUP.md`);
  - LLM provider for the model draft (inactive);
  - native iOS and Android apps for HealthKit / Health Connect.
- **Real-device work:**
  - phone benchmark across target devices (`docs/tracking/PHONE_RUN.md`);
  - cue latency on phones;
  - real-device QA of the camera-guided exercises;
  - step-count validation.
- **Clinical studies:** repeatability, inter-device, reference agreement and usability for all 14 protocols (`docs/VALIDATION_STUDY_PLAN.md`); stopwatch and walkway references for balance timing.
- **Release blockers:** occlusion (elbow self-occlusion, object occlusion).
- **Content and language:**
  - licensed exercise media and bulk curated content;
  - review of all 16 drafts;
  - Tamil clinical translation of the UI and all questionnaires.
- **External conformance:** FHIR export conformance with the receiving care system; vendor dynamometer formats.
- **Advice and people:**
  - privacy impact assessment and regulatory classification (qualified advisers);
  - usability with real patients;
  - VoiceOver / TalkBack testing;
  - incident process agreed and staffed.
