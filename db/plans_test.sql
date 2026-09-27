-- Behavioural tests for db/plans.sql (run after schema, security, tenancy and plans).
-- Every check raises on failure; ends with 'ALL PLAN TESTS PASSED'. Fixtures are rolled back.
\set QUIET on
BEGIN;
CREATE FUNCTION pg_temp.expect(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT cond THEN RAISE EXCEPTION 'PLAN TEST FAILED: %', msg; END IF; END $$;

INSERT INTO organizations (id, name) VALUES ('92000000-0000-0000-0000-000000000001', 'Plan clinic');
INSERT INTO users (id, email, idp_subject, role, display_name) VALUES
 ('02000000-0000-0000-0000-0000000000a1', 'plan-p@example.test', 'plan-p', 'patient', 'Plan patient'),
 ('02000000-0000-0000-0000-0000000000c1', 'plan-c@example.test', 'plan-c', 'clinician', 'Plan clinician');
INSERT INTO patients (id, user_id, name, organization_id) VALUES ('12000000-0000-0000-0000-0000000000a1', '02000000-0000-0000-0000-0000000000a1', 'PLAN-P1', '92000000-0000-0000-0000-000000000001');
INSERT INTO clinicians (id, user_id, name, title, clinic, organization_id) VALUES ('22000000-0000-0000-0000-0000000000c1', '02000000-0000-0000-0000-0000000000c1', 'PC', 'Physiotherapist', 'Plan clinic', '92000000-0000-0000-0000-000000000001');
INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES ('12000000-0000-0000-0000-0000000000a1', '22000000-0000-0000-0000-0000000000c1', 'active');
INSERT INTO programs (id, patient_id, clinician_id, title, status, start_date, end_date, approved_at, approved_by, version) VALUES
 ('42000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-0000000000a1', '22000000-0000-0000-0000-0000000000c1', 'v1', 'active', '2026-01-01', '2026-02-01', now(), '22000000-0000-0000-0000-0000000000c1', 1),
 ('42000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-0000000000a1', '22000000-0000-0000-0000-0000000000c1', 'draft v2', 'draft', '2026-01-01', '2026-02-01', NULL, NULL, 2);

-- 1. The patient sees the approved plan but not the unapproved draft.
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '02000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect((SELECT count(*) FROM programs) = 1, 'patient sees only the approved version');
-- 2. The patient can pause their plan …
INSERT INTO plan_pauses (id, program_id, patient_id, reason, created_by) VALUES
 ('52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-0000000000a1', 'pain_rule', '02000000-0000-0000-0000-0000000000a1');
-- … but cannot resume it, edit a plan, or erase the pause.
DO $$ BEGIN
  INSERT INTO plan_resumes (pause_id, program_id, patient_id, note, created_by) VALUES ('52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-0000000000a1', 'fine', '02000000-0000-0000-0000-0000000000a1');
  RAISE EXCEPTION 'PLAN TEST FAILED: patient resumed a plan';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
UPDATE programs SET title = 'harder' WHERE id = '42000000-0000-0000-0000-000000000001';
SELECT pg_temp.expect((SELECT title FROM programs WHERE id = '42000000-0000-0000-0000-000000000001') = 'v1', 'patient cannot edit a plan');
DO $$ BEGIN
  DELETE FROM plan_pauses WHERE id = '52000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'PLAN TEST FAILED: pause deleted';
EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
  IF SQLERRM LIKE 'PLAN TEST FAILED%' THEN RAISE; END IF;
END $$;
-- 3. The clinician in care resumes it with a note; the pause row is unchanged.
SET LOCAL app.user_id = '02000000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect((SELECT count(*) FROM programs) = 2, 'clinician sees drafts too');
INSERT INTO plan_resumes (pause_id, program_id, patient_id, note, created_by) VALUES ('52000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-0000000000a1', 'Reviewed by phone', '02000000-0000-0000-0000-0000000000c1');
DO $$ BEGIN
  UPDATE plan_pauses SET reason = 'safety';
  RAISE EXCEPTION 'PLAN TEST FAILED: pause edited';
EXCEPTION WHEN raise_exception OR insufficient_privilege THEN
  IF SQLERRM LIKE 'PLAN TEST FAILED%' THEN RAISE; END IF;
END $$;
RESET ROLE;
-- 4. Version numbers are unique per patient.
DO $$ BEGIN
  INSERT INTO programs (patient_id, clinician_id, title, status, start_date, end_date, version) VALUES ('12000000-0000-0000-0000-0000000000a1', '22000000-0000-0000-0000-0000000000c1', 'dup', 'draft', '2026-01-01', '2026-02-01', 1);
  RAISE EXCEPTION 'PLAN TEST FAILED: duplicate version accepted';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
SELECT pg_temp.expect((SELECT count(*) FROM schema_migrations WHERE version = '003_plan_versions') = 1, 'migration recorded');
ROLLBACK;
\echo ALL PLAN TESTS PASSED
