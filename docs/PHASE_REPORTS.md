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
