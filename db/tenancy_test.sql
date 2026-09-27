-- Behavioural tests for db/tenancy.sql (run after schema.sql, security.sql, tenancy.sql).
-- Every check raises on failure; ends with 'ALL TENANCY TESTS PASSED'. Fixtures are rolled back.
\set QUIET on
BEGIN;
CREATE FUNCTION pg_temp.expect(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT cond THEN RAISE EXCEPTION 'TENANCY TEST FAILED: %', msg; END IF; END $$;

INSERT INTO organizations (id, name) VALUES
 ('90000000-0000-0000-0000-000000000001', 'Clinic One'),
 ('90000000-0000-0000-0000-000000000002', 'Clinic Two');
INSERT INTO users (id, email, idp_subject, role, display_name) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'pa@example.test', 'sub-pa', 'patient', 'Patient 1'),
 ('00000000-0000-0000-0000-0000000000c1', 'c1@example.test', 'sub-c1', 'clinician', 'Clinician One'),
 ('00000000-0000-0000-0000-0000000000c2', 'c2@example.test', 'sub-c2', 'clinician', 'Clinician Two');
INSERT INTO patients (id, user_id, name, organization_id) VALUES
 ('10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'TEST-P1', '90000000-0000-0000-0000-000000000001');
INSERT INTO clinicians (id, user_id, name, title, clinic, organization_id) VALUES
 ('20000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'C1', 'Physiotherapist', 'Clinic One', '90000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'C2', 'Physiotherapist', 'Clinic Two', '90000000-0000-0000-0000-000000000002');
INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES
 ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000c1', 'active');
INSERT INTO assessments (id, patient_id, created_by) VALUES
 ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1');

-- 1. A care relationship across organisations is refused.
DO $$ BEGIN
  INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000c2', 'active');
  RAISE EXCEPTION 'TENANCY TEST FAILED: cross-organisation care relationship was accepted';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'TENANCY TEST FAILED%' THEN RAISE; END IF;
END $$;

-- 2. The clinician in the same organisation, with an active relationship, sees the patient.
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '00000000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect((SELECT count(*) FROM assessments) = 1, 'same-organisation clinician sees the assessment');
SELECT pg_temp.expect((SELECT count(*) FROM organizations) = 1, 'a clinician sees only their own organisation row');

-- 3. A clinician of another organisation sees nothing — even a relationship row forced in by the
--    owner (simulating a bug elsewhere) does not open access, because visibility also checks the
--    organisation.
RESET ROLE;
ALTER TABLE care_relationships DISABLE TRIGGER care_same_org;
INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES ('10000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000c2', 'active');
ALTER TABLE care_relationships ENABLE TRIGGER care_same_org;
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '00000000-0000-0000-0000-0000000000c2';
SELECT pg_temp.expect((SELECT count(*) FROM assessments) = 0, 'other-organisation clinician sees no assessment');
SELECT pg_temp.expect((SELECT count(*) FROM patients) = 0, 'other-organisation clinician sees no patient');
DO $$ BEGIN
  INSERT INTO measurements (patient_id, type, value, unit, confidence, category, source, created_by, provenance)
  VALUES ('10000000-0000-0000-0000-0000000000a1', 'knee_flexion', 1, 'deg', 0.9, 'clinician_measured', 'clinician_goniometer', '00000000-0000-0000-0000-0000000000c2', '{}');
  RAISE EXCEPTION 'TENANCY TEST FAILED: other-organisation clinician could write';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;

-- 4. The patient still sees their own record; an anonymous request sees nothing.
SET LOCAL app.user_id = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect((SELECT count(*) FROM assessments) = 1, 'patient sees own assessment');
SET LOCAL app.user_id = '';
SELECT pg_temp.expect((SELECT count(*) FROM patients) = 0, 'anonymous sees nothing');
SELECT pg_temp.expect((SELECT count(*) FROM organizations) = 0, 'anonymous sees no organisation');

-- 5. A patient cannot be moved between organisations while in active care.
RESET ROLE;
DO $$ BEGIN
  UPDATE patients SET organization_id = '90000000-0000-0000-0000-000000000002' WHERE id = '10000000-0000-0000-0000-0000000000a1';
  RAISE EXCEPTION 'TENANCY TEST FAILED: patient moved organisations during active care';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'TENANCY TEST FAILED%' THEN RAISE; END IF;
END $$;

SELECT pg_temp.expect((SELECT count(*) FROM schema_migrations WHERE version = '002_tenancy') = 1, 'migration recorded');
ROLLBACK;
\echo ALL TENANCY TESTS PASSED
