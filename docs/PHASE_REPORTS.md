# Dheepika Lab — phase reports

Evidence format per the brief: changed files and commit, before → after, migration impact, risks, tests, gates. Screenshots are taken from simulated demo data only and are kept out of the repository (they contain no real data, but are regenerated on demand by the Playwright journeys).

## Phases 3–4 — validity, person lock, arm-room calibration (commit `6fb66c2`)
- **Files:** `src/engine/appearance.ts` (+test), `pipeline.ts`, `identity.ts`, `calibration.ts`, `pose/mediapipe.ts`, `pose/pose.worker.ts`, `protocols/shoulder.ts`, `protocols/types.ts`, `scan/StageParts.tsx`, `i18n/en.ts`, tests.
- **Before → after:** the limb-swap guard now checks arms as well as legs. An overhead-reach protocol now requires arm room above and beside the body before capture. A motion–appearance coverage check marks joints whose image does not change while they move.
- **Migration:** none. **Risk:** the coverage check lowers availability with no measured benefit in the lab (see `docs/tracking/RESULTS.md`); owner decision pending. **Tests:** unit tests for arm swap, flip-flop, bystander, arm room and coverage; lab run `dl-phase3-coverage-lite.json`.

## Phases 5–8 — coaching cues, secure records, AI draft, clinician review (commit `1efdba9`)
- **Phase 5:** `engine/protocols/cues.ts`. Deterministic, versioned cues; tracking problems pre-empt coaching. Frame→paint cue latency is saved per capture and shown in the report appendix.
- **Phase 6:** `db/tenancy.sql` (migration 002), `db/tenancy_test.sql`, `scripts/db-check.sh` (PG16 throwaway cluster with RLS tests and a backup/restore drill), `src/data/scope.ts` (read scope applied to every `useDb` snapshot), store authorization boundary (`AuthorizationError`).
- **Phase 7:** `clinical/consultation.ts` (rule-based draft `dl-consult-draft-1.0.0`, validator), `clinical/modelDraft.ts` (inactive LLM contract; patient text delimited as data).
- **Phase 8:** `features/knee/DraftReview.tsx` (“AI draft” tab). Each statement can be accepted, edited, rejected or deferred, with the AI proposal kept verbatim. Also adds exam findings as clinician evidence and a stale sign-off notice.
- **Migration:** local schema v3 adds `draftDecisions` and `examFindings` (empty). **Risks:** no language model is active; the server is not deployed. **Tests:** consultation (8), authz, scope, DB checks, browser check of the AI draft tab (accept + exam finding).

## Phase 9 — prescription and plan versioning
- **Files:**
  - `src/clinical/plan.ts` (+ `plan.test.ts`: 8 tests)
  - `data/models.ts`, `data/store.ts` (schema v4, append-only history, guarded `remove`), `data/queries.ts`
  - `features/clinician/ProgramBuilder.tsx`, `features/clinician/ClinicianPages.tsx`
  - `features/session/TrainSession.tsx`, `features/patient/PatientPages.tsx`
  - `clinical/report.ts`, `data/demo.ts`, `i18n/en.ts`, `i18n/ta.ts` (draft)
  - `db/plans.sql` (migration 003), `db/plans_test.sql`, `scripts/db-check.sh`
- **Before:** publishing archived the old program without a version number, reason or diff. The pain rule stopped a single session, but the next session could start straight away. There was no substitution and no reassessment trigger.
- **After:**
  - Plans are numbered versions linked to the version they replace. Old versions stay readable in the clinician's Programs tab, with a field-by-field diff.
  - A version that intensifies the plan needs a recorded reason (enforced in `preparePublish` and in the UI).
  - Intensifying means more sets, reps, range, hold or frequency, less rest, faster tempo, or a pain limit raised or removed.
  - Clinician-approved alternatives say when they apply; the patient may choose one, and the session records `usedAlternative`.
  - A patient can pause the plan. A session stopped by the pain rule also pauses it, if the plan says so.
  - A paused plan cannot be started. Only a clinician resumes, with a note, or publishes a revised version.
  - Reassessment falls due after a clinician-set interval or on selected triggers (pain-rule stop, pain rise of 2 or more, patient pause).
  - The patient sees only the latest approved version.
- **Migration:**
  - Local v3 → v4: existing programs are numbered per patient in creation order and linked; their content is unchanged. `planPauses` and `planResumes` start empty.
  - Server migration 003 adds the columns, backfills versions, and adds `plan_pauses` / `plan_resumes`. Both tables are append-only: triggers block update and delete, and the audit trigger records inserts. RLS lets a patient pause, only a clinician resume, and patients see only approved programs.
- **Risks:**
  - The pause wording and triggers are clinical content awaiting review (on hold).
  - "Pain rise of 2 or more" reuses the existing pain-increase alert threshold; it is not a new clinical rule.
  - Tamil strings are drafts.
- **Tests:**
  - `plan.test.ts` (diff, reason, supersede/archive, clinician-only publish, drafts hidden, pause/resume authority, append-only, reassessment, alternatives, migration).
  - `db-check.sh`: all plan RLS tests and the restore drill pass (39 tables, migrations 001–003).
  - Playwright journey on the demo: patient pause → paused screen and home notice → clinician alert → resume with note → v2 with intensification diff, publish disabled until a reason is given → history shows v2 and v1. No page errors.
- **Gates:** clinical review (on hold); server deployment (Phase 6 gate).

## Phase 10 — daily companion foundation
- **Files:**
  - `src/clinical/companion.ts` (+ `companion.test.ts`)
  - `src/data/sync.ts` (+ `sync.test.ts`)
  - `data/store.ts`: revision-checked save with merge, reset tokens, `syncConflicts()`, schema v5
  - `data/models.ts`: `Appointment`, `DailyCheckin`, `Program.scheduleDays`, alert `checkin_note`
  - `features/patient/DailyCompanion.tsx`, `features/patient/PatientPages.tsx`
  - `features/clinician/ClinicianPages.tsx` (check-ins, appointment booking)
  - `ProgramBuilder.tsx` (session days), `clinical/plan.ts`, `data/demo.ts`, `data/migration.ts` (exports the new tables), `i18n/en.ts`
- **Before:** the home screen showed the plan, adherence and last peak ROM only. There was no check-in, appointment, session log or missed-day handling. Two open tabs could overwrite each other's records.
- **After:** the patient home shows:
  - today's status: session day, rest day or flexible; sessions this week against the clinician's target;
  - a daily pain check-in with an optional note. It is shown verbatim to the clinician; a note raises an informational alert. The app does not interpret it;
  - missed-day recovery copy that reassures and explicitly says **not** to add sessions to catch up. Paused days are not counted as missed;
  - the last five sessions (completed / ended early, pain before → after — no scores);
  - the next appointment, or a reassessment-due note when none is booked;
  - an offline notice.

  Clinicians book, complete or cancel appointments and set session days.
- **Sync and conflict model:** every write is audited, so replicas merge by row id:
  - rows written on either side are kept;
  - deletes are honoured;
  - a row edited on both sides keeps the later write, and the conflict (with the discarded version) goes to the audit and to a patient-visible notice;
  - a deliberate reset (account deletion, demo purge) is adopted, not merged back.
- **Migration:** local v4 → v5 adds `appointments` (empty). Existing plans stay flexible (no `scheduleDays`).
- **Risks:**
  - Cross-device sync is **not** live. Two devices do not see each other's records until a server exists (Phase 6 gate).
  - Changes to session days are not yet in the plan diff; the weekly frequency is.
  - The companion copy is draft clinical/patient content; Tamil strings for it fall back to English.
- **Tests:**
  - `companion.test.ts` (4: flexible/scheduled weeks, missed-day logic with paused days, check-in/appointment selection, copy-language guard);
  - `sync.test.ts` (4: union, one-sided edit, two-sided conflict, delete, idempotence);
  - Playwright on the demo:
    - home shows the week line, next appointment and log;
    - an offline check-in is saved;
    - two tabs writing at once keep all 5 check-ins;
    - the clinician sees the note alert and check-ins and books an appointment;
    - no page errors.
- **Gates:** server sync (Phase 6); patient-copy review in English and Tamil; usability with real patients.

## Phase 11 — wearable and phone activity
- **Files:**
  - `src/integrations/activity.ts` (+ `activity.test.ts`: 6 tests)
  - `src/integrations/activityStore.ts`
  - `src/features/activity/ActivityPanel.tsx` (patient panel on Profile, clinician panel on the patient overview)
  - `data/models.ts` (consents `activity_steps` / `activity_walking`, `activitySamples`, `activityImports`), `data/store.ts` (schema v6), `data/migration.ts`
  - `features/onboarding/Onboarding.tsx` (onboarding does not ask for activity consent)
  - `i18n/en.ts`
  - `db/activity.sql` (migration 004), `db/activity_test.sql`, `scripts/db-check.sh`
  - `docs/ACTIVITY_INTEGRATION.md`
- **Before:** there was no activity data.
- **After:**
  - The patient shares steps and/or walking time separately, then imports an Apple Health export or a CSV.
  - The import report states what was added, what was a duplicate, and which record types were skipped (heart rate, sleep and so on).
  - A 14-day table shows de-duplicated daily totals, "no data" days and "sources differ" flags, with the source and method stated.
  - The clinician sees the same table read-only, the consent state and the last import.
  - Withdrawal hides the data, and deletes it by default.
- **Migration:** local v5 → v6, with empty tables. Server migration 004 adds two consent enum values, both tables, a consent trigger and RLS (the patient writes; a clinician in care reads only while consent is granted).
- **Risks:**
  - Apple exports can be very large; the reader is capped at 300 MB in the browser.
  - The hourly max-per-source rule is a de-duplication method, not a clinical rule. A sample is bucketed by its start hour.
  - There is no Health Connect path until a native app exists.
- **Tests:**
  - Unit tests: zoned times, parser scope, phone+watch not double-counted, CSV validation, native revoked permission, consent/duplicate/withdrawal.
  - `db-check.sh`: all activity RLS tests pass; restore drill over 41 tables, migrations 001–004.
  - Playwright:
    - no import offered before consent;
    - import of a fixture export: 10 added, heart rate skipped;
    - the same file again: 0 added, 10 duplicates;
    - "no data" and "sources differ" shown;
    - the clinician sees it;
    - no non-step samples stored.
- **Gates:** native apps; real-device step validation; clinical use review.

## Phases 12–15 — hip, ankle and foot, spine and neck, balance and gait
- **Files:**
  - `src/engine/protocols/regions.ts` (9 protocols) + `regions.test.ts` (14 tests)
  - `engine/measurements.ts` (7 new 2D measurements)
  - `engine/pose/synthetic.ts` (hip flexion, heel lift, neck, lunge, leg abduction, side bend, foot lift)
  - `engine/protocols/simulate.ts`, `engine/pose/simulated.ts`, `engine/protocols/types.ts`, `registry.ts`
  - `src/clinical/regionQuestionnaires.ts` (4 history + 4 safety drafts)
  - `clinical/pathways.ts` (4 pathways, `PATHWAY_ORDER`, optional symptom map), `clinical/intake.ts` (region section in the organised history), `clinical/safety.ts` (questionnaire registry)
  - `clinical/report.ts` (units, "Timed tests"), `features/knee/Results.tsx` (labels, units)
  - `features/knee/KneeAssessment.tsx` (`/p/assess/:region`), `AssessmentRoute.tsx`, `Onboarding.tsx` (6 areas), `PatientPages.tsx` ("Assess another area")
  - `ValidationStudy.tsx`, `data/models.ts`, `data/demo.ts` (DP-05 hip), `i18n/en.ts`
  - `docs/REGION_PROTOCOLS.md`
- **Before:** only knee and shoulder.
- **After:** four more pathways run through the same intake → safety → capture → results → clinician workspace → AI draft → report flow. The balance pathway works without a pain area.
- **Migration:** none; the `region` field accepts the new values and older records are unchanged.
- **Risks:**
  - all four regions rest on synthetic evidence only;
  - the lunge heel-rise and heel-raise thresholds (5° and 12°) and the stance lift levels (3% and 6%) are capture-quality parameters awaiting review, not clinical thresholds;
  - walking gait is intentionally not implemented;
  - the new questionnaires are clinical drafts.
- **Tests:**
  - unit tests: ground truth, the named gates, no invented metrics;
  - consultation draft validated on DP-05;
  - Playwright:
    - 6 areas on onboarding at 390 px (no overflow);
    - ankle history/safety tags shown, lunge captured L/R (38°), results table, submit;
    - balance without a pain area; repeated falls → clinician review, no camera tests;
    - clinician DP-05 hip: refused capture shown, L/R table, AI draft lists the missing capture, "Hip assessment report" with scope limits;
    - no page errors.
- **Gates:** real-device captures and reference instruments; clinical review of all protocol text and questionnaires (on hold).

## Phases 16–18 — content system, clinician trends, reference measurements and interoperability
Details: `docs/CONTENT_TRENDS_INTEROP.md`.
- **Files:**
  - `src/content/{library,seed,contentStore}.ts` (+ `library.test.ts`: 7 tests), `features/library/LibraryPage.tsx`
  - `clinical/plan.ts` (library items in versions, `libDose`), `ProgramBuilder.tsx` (library picker), `TrainSession.tsx`, `PatientPages.tsx`
  - `src/clinical/trends.ts` (+ `trends.test.ts`: 6 tests), `features/clinician/Trends.tsx`, `ClinicianPages.tsx` (Trends and Devices & export tabs, exception queue), `AnalyticsSettings.tsx` (rules)
  - `src/interop/{deviceMeasurements,fhir}.ts` (+ `interop.test.ts`: 6 tests), `features/clinician/DeviceTab.tsx`, `clinical/report.ts` (device findings, data-change)
  - `data/models.ts`, `data/store.ts` (schema v7 → v8; clinician-only settings), `data/migration.ts`, `app/App.tsx` (Library route), `i18n/en.ts`
- **Migration:** local v6 → v8 adds empty tables (`contentItems`, `contentReviews`, `programLibraryItems`, `deviceMeasurements`) and optional `settings.exceptionRules`. Nothing existing changes.
- **Risks:**
  - all content is unpublished drafts;
  - exception thresholds are unreviewed defaults;
  - the FHIR output is not yet tested against a receiving system;
  - the ±14-day window for showing device values in an assessment report is a presentation rule for review.
- **Tests:**
  - 19 new unit tests (223 total);
  - Playwright (clinician demo):
    - exception queue with the unreviewed badge;
    - library: 16 items, 0 published, 4 camera-guided with the synthetic-QA label; submit → approve publishes v0.1.0;
    - approved item prescribed in a new plan version with a reason;
    - trends show protocol versions and a baseline;
    - device grip entry (max of 3 trials, calibration badge, strength badge);
    - FHIR download (collection, 30 entries, grip value kept, camera observations preliminary);
    - the patient Train page shows the library item with its precaution;
    - no page errors.
