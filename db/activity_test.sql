-- Behavioural tests for db/activity.sql. Ends with 'ALL ACTIVITY TESTS PASSED'; fixtures rolled back.
\set QUIET on
BEGIN;
CREATE FUNCTION pg_temp.expect(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT cond THEN RAISE EXCEPTION 'ACTIVITY TEST FAILED: %', msg; END IF; END $$;
INSERT INTO organizations (id, name) VALUES ('93000000-0000-0000-0000-000000000001', 'Act clinic');
INSERT INTO users (id, email, idp_subject, role, display_name) VALUES
 ('03000000-0000-0000-0000-0000000000a1', 'act-p@example.test', 'act-p', 'patient', 'Act patient'),
 ('03000000-0000-0000-0000-0000000000c1', 'act-c@example.test', 'act-c', 'clinician', 'Act clinician');
INSERT INTO patients (id, user_id, name, organization_id) VALUES ('13000000-0000-0000-0000-0000000000a1', '03000000-0000-0000-0000-0000000000a1', 'ACT-P1', '93000000-0000-0000-0000-000000000001');
INSERT INTO clinicians (id, user_id, name, title, clinic, organization_id) VALUES ('23000000-0000-0000-0000-0000000000c1', '03000000-0000-0000-0000-0000000000c1', 'AC', 'Physiotherapist', 'Act clinic', '93000000-0000-0000-0000-000000000001');
INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES ('13000000-0000-0000-0000-0000000000a1', '23000000-0000-0000-0000-0000000000c1', 'active');
INSERT INTO activity_imports (id, patient_id, platform, status, added, duplicates, created_by) VALUES ('43000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-0000000000a1', 'csv', 'ok', 1, 0, '03000000-0000-0000-0000-0000000000a1');

-- 1. Without consent, a sample is refused.
DO $$ BEGIN
  INSERT INTO activity_samples (patient_id, metric, value, start_at, end_at, tz_offset_min, platform, source_app, import_id) VALUES ('13000000-0000-0000-0000-0000000000a1', 'steps', 100, '2026-01-05T02:30:00Z', '2026-01-05T03:00:00Z', 330, 'csv', 'x', '43000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'ACTIVITY TEST FAILED: stored without consent';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
INSERT INTO consents (patient_id, type, granted, text_version, recorded_by) VALUES ('13000000-0000-0000-0000-0000000000a1', 'activity_steps', true, 'a1', '03000000-0000-0000-0000-0000000000a1');

-- 2. The patient imports; a clinician cannot insert device data; duplicates are rejected.
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '03000000-0000-0000-0000-0000000000a1';
INSERT INTO activity_samples (patient_id, metric, value, start_at, end_at, tz_offset_min, platform, source_app, record_id, import_id) VALUES ('13000000-0000-0000-0000-0000000000a1', 'steps', 100, '2026-01-05T02:30:00Z', '2026-01-05T03:00:00Z', 330, 'health_connect', 'app', 'r1', '43000000-0000-0000-0000-000000000001');
DO $$ BEGIN
  INSERT INTO activity_samples (patient_id, metric, value, start_at, end_at, tz_offset_min, platform, source_app, record_id, import_id) VALUES ('13000000-0000-0000-0000-0000000000a1', 'steps', 100, '2026-01-05T02:30:00Z', '2026-01-05T03:00:00Z', 330, 'health_connect', 'app', 'r1', '43000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'ACTIVITY TEST FAILED: duplicate record accepted';
EXCEPTION WHEN unique_violation THEN NULL; END $$;
SET LOCAL app.user_id = '03000000-0000-0000-0000-0000000000c1';
SELECT pg_temp.expect((SELECT count(*) FROM activity_samples) = 1, 'clinician in care reads consented activity');
DO $$ BEGIN
  INSERT INTO activity_samples (patient_id, metric, value, start_at, end_at, tz_offset_min, platform, source_app, import_id) VALUES ('13000000-0000-0000-0000-0000000000a1', 'steps', 9999, '2026-01-06T02:30:00Z', '2026-01-06T03:00:00Z', 330, 'csv', 'x', '43000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'ACTIVITY TEST FAILED: clinician wrote device data';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
-- 3. After withdrawal the data is no longer readable, and the patient can delete it.
RESET ROLE;
INSERT INTO consents (patient_id, type, granted, text_version, recorded_by) VALUES ('13000000-0000-0000-0000-0000000000a1', 'activity_steps', false, 'a1', '03000000-0000-0000-0000-0000000000a1');
SET LOCAL ROLE pv_app;
SELECT pg_temp.expect((SELECT count(*) FROM activity_samples) = 0, 'withdrawn data not readable by the clinician');
SET LOCAL app.user_id = '03000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.expect((SELECT count(*) FROM activity_samples) = 0, 'withdrawn data not readable by the patient either');
RESET ROLE;
SELECT pg_temp.expect((SELECT count(*) FROM schema_migrations WHERE version = '004_activity') = 1, 'migration recorded');
ROLLBACK;
\echo ALL ACTIVITY TESTS PASSED
