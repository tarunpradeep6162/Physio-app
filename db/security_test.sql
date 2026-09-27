-- Behavioural tests for db/security.sql. Run as the owner after schema.sql + security.sql:
--   psql -v ON_ERROR_STOP=1 -f schema.sql -f security.sql -f security_test.sql
-- Every check raises an exception on failure; the script ends with 'ALL SECURITY TESTS PASSED'.
\set QUIET on
BEGIN;
-- Fixtures (as owner) --------------------------------------------------------------------------
INSERT INTO users (id, email, idp_subject, role, display_name) VALUES
 ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'sub-a', 'patient', 'Patient A'),
 ('00000000-0000-0000-0000-00000000000b', 'b@example.test', 'sub-b', 'patient', 'Patient B'),
 ('00000000-0000-0000-0000-00000000000c', 'c@example.test', 'sub-c', 'clinician', 'Clinician C'),
 ('00000000-0000-0000-0000-00000000000d', 'd@example.test', 'sub-d', 'clinician', 'Clinician D');
INSERT INTO patients (id, user_id, name) VALUES
 ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'TEST-A'),
 ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'TEST-B');
INSERT INTO clinicians (id, user_id, name, title, clinic) VALUES
 ('20000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'C', 'Physiotherapist', 'X'),
 ('20000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d', 'D', 'Physiotherapist', 'X');
INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES
 ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000c', 'active'),
 ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-00000000000d', 'ended');
INSERT INTO clinical_rule_versions (key, kind, content) VALUES ('knee_supported_flexion@1.1.0', 'protocol', '{}');
INSERT INTO assessments (id, patient_id, created_by) VALUES
 ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a'),
 ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b');
INSERT INTO measurements (patient_id, assessment_id, type, value, unit, confidence, category, source, created_by, provenance) VALUES
 ('10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', 'knee_flexion', 110, 'deg', 0.9, 'camera_estimate', 'camera_estimation', '00000000-0000-0000-0000-00000000000a', '{}'),
 ('10000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-00000000000b', 'sts_time_5', 11.2, 's', 0.9, 'camera_estimate', 'camera_estimation', '00000000-0000-0000-0000-00000000000b', '{}');

CREATE FUNCTION pg_temp.expect(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT cond THEN RAISE EXCEPTION 'SECURITY TEST FAILED: %', msg; END IF; END $$;

-- 1. Patient A sees only their own data ----------------------------------------------------------
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000a';
SELECT pg_temp.expect((SELECT count(*) FROM measurements) = 1, 'patient A sees exactly one measurement');
SELECT pg_temp.expect((SELECT count(*) FROM patients) = 1, 'patient A sees only their patient row');
SELECT pg_temp.expect((SELECT count(*) FROM assessments WHERE patient_id = '10000000-0000-0000-0000-00000000000b') = 0, 'patient A cannot see patient B');
-- A patient cannot write camera measurements (clinician-only write policy).
DO $$ BEGIN
  INSERT INTO measurements (patient_id, type, value, unit, confidence, category, source, created_by, provenance)
  VALUES ('10000000-0000-0000-0000-00000000000a', 'knee_flexion', 1, 'deg', 1, 'camera_estimate', 'camera_estimation', '00000000-0000-0000-0000-00000000000a', '{}');
  RAISE EXCEPTION 'SECURITY TEST FAILED: patient inserted a measurement';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- 2. Clinician C: active care of A only; D: ended relationship with B = no access ----------------
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000c';
SELECT pg_temp.expect((SELECT count(*) FROM measurements) = 1, 'clinician C sees A only');
SELECT pg_temp.expect((SELECT count(*) FROM measurements WHERE patient_id = '10000000-0000-0000-0000-00000000000b') = 0, 'clinician C cannot see B');
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000d';
SELECT pg_temp.expect((SELECT count(*) FROM measurements) = 0, 'ended care relationship gives no access');
SELECT pg_temp.expect((SELECT count(*) FROM patients) = 0, 'ended care relationship hides the patient');
-- No identity at all → nothing.
RESET app.user_id;
SET LOCAL app.user_id = '';
SELECT pg_temp.expect((SELECT count(*) FROM measurements) = 0, 'anonymous request sees nothing');

-- 3. Consent enforcement on camera data -----------------------------------------------------------
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000c';
DO $$ BEGIN
  INSERT INTO capture_sessions (assessment_id, patient_id, protocol_key, view, quality_verdict, quality, landmark_frames, keyframes, signal, provenance)
  VALUES ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'knee_supported_flexion@1.1.0', 'lateral_left', 'valid', '{}', '[]', '[]', '[]', '{}');
  RAISE EXCEPTION 'SECURITY TEST FAILED: capture stored without consent';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
INSERT INTO consents (patient_id, type, granted, text_version, recorded_by) VALUES
 ('10000000-0000-0000-0000-00000000000a', 'camera_processing', true, 'v1', '00000000-0000-0000-0000-00000000000a'),
 ('10000000-0000-0000-0000-00000000000a', 'data_storage', true, 'v1', '00000000-0000-0000-0000-00000000000a');
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000c';
INSERT INTO capture_sessions (id, assessment_id, patient_id, protocol_key, view, quality_verdict, quality, landmark_frames, keyframes, signal, provenance, created_at)
VALUES ('40000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'knee_supported_flexion@1.1.0', 'lateral_left', 'valid', '{}', '{"f":1}', '[1]', '[]', '{}', now() - interval '100 days');
SELECT pg_temp.expect((SELECT count(*) FROM capture_sessions) = 1, 'capture stored once consent is recorded');
-- Withdrawn consent blocks new captures again.
RESET ROLE;
INSERT INTO consents (patient_id, type, granted, text_version, recorded_by) VALUES ('10000000-0000-0000-0000-00000000000a', 'camera_processing', false, 'v1', '00000000-0000-0000-0000-00000000000a');
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000c';
DO $$ BEGIN
  INSERT INTO capture_sessions (assessment_id, patient_id, protocol_key, view, quality_verdict, quality, landmark_frames, keyframes, signal, provenance)
  VALUES ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'knee_supported_flexion@1.1.0', 'lateral_left', 'valid', '{}', '[]', '[]', '[]', '{}');
  RAISE EXCEPTION 'SECURITY TEST FAILED: capture stored after consent withdrawal';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

-- 4. Audit: every change logged, chain intact, rows immutable --------------------------------------
RESET ROLE;
SELECT pg_temp.expect((SELECT count(*) FROM audit_events WHERE entity = 'capture_sessions' AND action = 'insert') = 1, 'capture insert audited');
SELECT pg_temp.expect((SELECT actor_id FROM audit_events WHERE entity = 'capture_sessions' AND action = 'insert') = '00000000-0000-0000-0000-00000000000c', 'audit records the acting clinician');
SELECT pg_temp.expect(audit_verify() IS NULL, 'audit hash chain intact');
DO $$ BEGIN
  UPDATE audit_events SET action = 'tampered' WHERE seq = 1;
  RAISE EXCEPTION 'SECURITY TEST FAILED: audit row updated';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
-- Tampering that bypasses triggers is DETECTED by the chain.
ALTER TABLE audit_events DISABLE TRIGGER audit_no_update;
UPDATE audit_events SET detail = '{"x":1}' WHERE seq = 2;
ALTER TABLE audit_events ENABLE TRIGGER audit_no_update;
SELECT pg_temp.expect(audit_verify() = 2, 'hash chain detects a tampered row');
ROLLBACK;

-- Fresh transaction for retention + report tokens (the tamper test above was rolled back).
BEGIN;
INSERT INTO users (id, email, idp_subject, role, display_name) VALUES
 ('00000000-0000-0000-0000-00000000000a', 'a@example.test', 'sub-a', 'patient', 'Patient A'),
 ('00000000-0000-0000-0000-00000000000c', 'c@example.test', 'sub-c', 'clinician', 'Clinician C');
INSERT INTO patients (id, user_id, name) VALUES ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'TEST-A');
INSERT INTO clinicians (id, user_id, name, title, clinic) VALUES ('20000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'C', 'Physiotherapist', 'X');
INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-00000000000c', 'active');
INSERT INTO clinical_rule_versions (key, kind, content) VALUES ('knee_supported_flexion@1.1.0', 'protocol', '{}'), ('pv-knee-report-1.0.0', 'report_template', '{}');
INSERT INTO assessments (id, patient_id, created_by) VALUES ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a');
INSERT INTO consents (patient_id, type, granted, text_version, recorded_by) VALUES
 ('10000000-0000-0000-0000-00000000000a', 'camera_processing', true, 'v1', '00000000-0000-0000-0000-00000000000a'),
 ('10000000-0000-0000-0000-00000000000a', 'data_storage', true, 'v1', '00000000-0000-0000-0000-00000000000a');
INSERT INTO capture_sessions (assessment_id, patient_id, protocol_key, view, quality_verdict, quality, landmark_frames, keyframes, signal, provenance, created_at)
VALUES ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'knee_supported_flexion@1.1.0', 'lateral_left', 'valid', '{}', '{"f":1}', '[1]', '[]', '{}', now() - interval '100 days');
INSERT INTO retention_policies (clinic_id, landmark_days) VALUES ('50000000-0000-0000-0000-000000000001', 90);
CREATE FUNCTION pg_temp.expect(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT cond THEN RAISE EXCEPTION 'SECURITY TEST FAILED: %', msg; END IF; END $$;

-- 5. Retention purges landmark streams only ------------------------------------------------------
SELECT pg_temp.expect(purge_expired_landmarks('50000000-0000-0000-0000-000000000001') = 1, 'one capture past 90 days purged');
SELECT pg_temp.expect((SELECT landmark_frames FROM capture_sessions) = '"purged"'::jsonb, 'landmarks removed');
SELECT pg_temp.expect((SELECT quality_verdict FROM capture_sessions) = 'valid', 'capture record (metrics/quality) kept');
SELECT pg_temp.expect(EXISTS (SELECT 1 FROM audit_events WHERE action = 'retention_purge'), 'purge audited');
SELECT pg_temp.expect(NOT EXISTS (SELECT 1 FROM retention_policies WHERE raw_video <> 'never_stored'), 'raw video policy is never_stored');

-- 6. Report sharing: only approved reports, hashed single-use expiring tokens ----------------------
INSERT INTO reports (id, assessment_id, version, status, template_key, generated_by) VALUES
 ('60000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-00000000000a', 1, 'preliminary', 'pv-knee-report-1.0.0', '00000000-0000-0000-0000-00000000000c');
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000c';
DO $$ BEGIN
  PERFORM issue_report_token('60000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'SECURITY TEST FAILED: token issued for a preliminary report';
EXCEPTION WHEN check_violation THEN NULL; END $$;
RESET ROLE;
UPDATE reports SET status = 'clinician_reviewed', approved_by = '20000000-0000-0000-0000-00000000000c', approved_at = now();
SET LOCAL ROLE pv_app;
SET LOCAL app.user_id = '00000000-0000-0000-0000-00000000000c';
CREATE TEMP TABLE tok AS SELECT issue_report_token('60000000-0000-0000-0000-000000000001') AS t;
RESET ROLE;
SELECT pg_temp.expect((SELECT count(*) FROM report_access_tokens WHERE token_hash = digest((SELECT t FROM tok), 'sha256')) = 1, 'only the hash is stored');
SELECT pg_temp.expect(redeem_report_token((SELECT t FROM tok)) = '60000000-0000-0000-0000-000000000001', 'token redeems once');
SELECT pg_temp.expect(redeem_report_token((SELECT t FROM tok)) IS NULL, 'token cannot be reused');
SELECT pg_temp.expect(redeem_report_token('not-a-token') IS NULL, 'unknown token rejected');
ROLLBACK;
\echo ALL SECURITY TESTS PASSED
