-- =============================================================================================
-- PhysioVision AI — server data boundary (apply AFTER schema.sql). PostgreSQL 16.
--
-- Implements, and tests (db/security_test.sql), what real patient use requires at the database:
--   * row-level security on EVERY patient-scoped table: a patient sees only their own records;
--     a clinician sees a patient only while an ACTIVE care relationship exists; nobody else;
--   * consent enforcement: no camera-derived data without current camera_processing +
--     data_storage consent; no still image without image_storage consent;
--   * an append-only, hash-chained audit log (tamper-evident), written by triggers;
--   * retention: landmark streams purged after the clinic's window; metrics and audit kept;
--   * protected report access: short-lived, hashed, single-report tokens — never a public URL.
-- The API authenticates the user via OIDC and runs each request as role `pv_app` with
--   SET LOCAL app.user_id = '<users.id>';
-- Raw video is never stored (retention_policies.raw_video is constrained to 'never_stored').
-- =============================================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Application role: no ownership, no BYPASSRLS. Tables stay owned by the migration role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pv_app') THEN CREATE ROLE pv_app NOLOGIN; END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Request identity helpers
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Patient row ids the current user may see (own record, or active care relationship).
CREATE OR REPLACE FUNCTION app_visible_patient(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM patients WHERE id = p AND user_id = app_user_id() AND deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM care_relationships cr JOIN clinicians c ON c.id = cr.clinician_id
                 WHERE cr.patient_id = p AND cr.status = 'active' AND c.user_id = app_user_id())
$$;

CREATE OR REPLACE FUNCTION app_is_clinician_of(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM care_relationships cr JOIN clinicians c ON c.id = cr.clinician_id
                 WHERE cr.patient_id = p AND cr.status = 'active' AND c.user_id = app_user_id())
$$;

CREATE OR REPLACE FUNCTION app_assessment_patient(a uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT patient_id FROM assessments WHERE id = a
$$;

-- ---------------------------------------------------------------------------------------------
-- Row-level security on every patient-scoped table
-- ---------------------------------------------------------------------------------------------
-- Remove the schema.sql sketch policies: FOR ALL with no WITH CHECK, they let a patient WRITE rows
-- they can read (found by db/security_test.sql). Permissive policies are OR-ed, so they must go.
DROP POLICY IF EXISTS measurements_patient ON measurements;
DROP POLICY IF EXISTS measurements_clinician ON measurements;

DO $$
DECLARE t text;
BEGIN
  -- Tables with a patient_id column: patients may read their own; clinicians in care may read + write.
  FOREACH t IN ARRAY ARRAY['consents','assessments','patient_reported_outcomes','camera_scans','landmark_sessions',
    'measurements','observations','programs','training_sessions','clinical_notes','alerts','messages','capture_sessions',
    'intake_answers','safety_responses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_clinician_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pv_app USING (app_visible_patient(patient_id))', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO pv_app USING (app_is_clinician_of(patient_id)) WITH CHECK (app_is_clinician_of(patient_id))', t || '_clinician_write', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pv_app', t);
  END LOOP;

  -- Tables reached through assessment_id.
  FOREACH t IN ARRAY ARRAY['pain_regions','radiation_paths','summary_amendments','test_plans','reasoning_decisions','clinical_impressions','reports'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_clinician_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pv_app USING (app_visible_patient(app_assessment_patient(assessment_id)))', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO pv_app USING (app_is_clinician_of(app_assessment_patient(assessment_id))) WITH CHECK (app_is_clinician_of(app_assessment_patient(assessment_id)))', t || '_clinician_write', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO pv_app', t);
  END LOOP;
END $$;

-- Patients can record their own intake, pain map, safety answers, outcomes and sessions.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['intake_answers','safety_responses','patient_reported_outcomes','training_sessions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_patient_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO pv_app WITH CHECK (EXISTS (SELECT 1 FROM patients WHERE id = patient_id AND user_id = app_user_id()))', t || '_patient_insert', t);
  END LOOP;
END $$;

-- The patients table itself.
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS patients_read ON patients;
CREATE POLICY patients_read ON patients FOR SELECT TO pv_app USING (app_visible_patient(id));
DROP POLICY IF EXISTS patients_self_update ON patients;
CREATE POLICY patients_self_update ON patients FOR UPDATE TO pv_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
GRANT SELECT, UPDATE ON patients TO pv_app;

-- Care relationships: visible to the two parties only; created by clinic administration (owner role).
ALTER TABLE care_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE care_relationships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS care_read ON care_relationships;
CREATE POLICY care_read ON care_relationships FOR SELECT TO pv_app USING (app_visible_patient(patient_id));
GRANT SELECT ON care_relationships TO pv_app;
GRANT SELECT ON users, clinicians, clinical_rule_versions, exercise_definitions, exercise_definition_versions TO pv_app;

-- movement_events are reached through their capture.
ALTER TABLE movement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE movement_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS movement_events_read ON movement_events;
CREATE POLICY movement_events_read ON movement_events FOR SELECT TO pv_app
  USING (EXISTS (SELECT 1 FROM capture_sessions c WHERE c.id = capture_id AND app_visible_patient(c.patient_id)));
GRANT SELECT ON movement_events TO pv_app;

-- ---------------------------------------------------------------------------------------------
-- Consent enforcement
-- ---------------------------------------------------------------------------------------------
-- Consent history is append-only; "current" = the LAST recorded row (monotonic sequence, because two
-- changes in one transaction share the same now() timestamp — found by security_test.sql).
ALTER TABLE consents ADD COLUMN IF NOT EXISTS seq bigserial;
CREATE OR REPLACE FUNCTION consents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consents are append-only: record a new row to change consent' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS consents_no_update ON consents;
CREATE TRIGGER consents_no_update BEFORE UPDATE OR DELETE ON consents FOR EACH ROW EXECUTE FUNCTION consents_immutable();

CREATE OR REPLACE FUNCTION has_consent(p uuid, t consent_type) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT granted FROM consents WHERE patient_id = p AND type = t ORDER BY seq DESC LIMIT 1), false)
$$;

CREATE OR REPLACE FUNCTION enforce_camera_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (has_consent(NEW.patient_id, 'camera_processing') AND has_consent(NEW.patient_id, 'data_storage')) THEN
    RAISE EXCEPTION 'consent required: camera_processing and data_storage for patient %', NEW.patient_id USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- (nested: PL/pgSQL resolves NEW.image_object even when the table test is false)
  IF TG_TABLE_NAME = 'camera_scans' THEN
    IF NEW.image_object IS NOT NULL AND NOT has_consent(NEW.patient_id, 'image_storage') THEN
      RAISE EXCEPTION 'consent required: image_storage for patient %', NEW.patient_id USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS capture_consent ON capture_sessions;
CREATE TRIGGER capture_consent BEFORE INSERT ON capture_sessions FOR EACH ROW EXECUTE FUNCTION enforce_camera_consent();
DROP TRIGGER IF EXISTS scan_consent ON camera_scans;
CREATE TRIGGER scan_consent BEFORE INSERT OR UPDATE OF image_object ON camera_scans FOR EACH ROW EXECUTE FUNCTION enforce_camera_consent();

-- ---------------------------------------------------------------------------------------------
-- Append-only, hash-chained audit log
-- ---------------------------------------------------------------------------------------------
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS seq bigserial;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash bytea;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS hash bytea;

CREATE OR REPLACE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(4242);
  SELECT hash INTO prev FROM audit_events ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := digest(COALESCE(prev, '\x'::bytea) || convert_to(
      COALESCE(NEW.actor_id::text, '') || '|' || NEW.action || '|' || NEW.entity || '|' || NEW.entity_id::text || '|' ||
      COALESCE(NEW.detail::text, '') || '|' || NEW.at::text, 'UTF8'), 'sha256');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_chain ON audit_events;
CREATE TRIGGER audit_chain BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_chain();

CREATE OR REPLACE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS audit_no_update ON audit_events;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;

-- Verifies the whole chain; returns the first broken sequence number, or NULL if intact.
CREATE OR REPLACE FUNCTION audit_verify() RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE r record; prev bytea := NULL; expect bytea;
BEGIN
  FOR r IN SELECT * FROM audit_events ORDER BY seq LOOP
    expect := digest(COALESCE(prev, '\x'::bytea) || convert_to(
        COALESCE(r.actor_id::text, '') || '|' || r.action || '|' || r.entity || '|' || r.entity_id::text || '|' ||
        COALESCE(r.detail::text, '') || '|' || r.at::text, 'UTF8'), 'sha256');
    IF r.hash IS DISTINCT FROM expect OR r.prev_hash IS DISTINCT FROM prev THEN RETURN r.seq; END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- Writes an audit row for every change to patient data (actor = request user).
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  rid := COALESCE((to_jsonb(NEW) ->> 'id')::uuid, (to_jsonb(OLD) ->> 'id')::uuid);
  INSERT INTO audit_events (actor_id, action, entity, entity_id, detail)
  VALUES (app_user_id(), lower(TG_OP), TG_TABLE_NAME, rid, NULL);
  RETURN COALESCE(NEW, OLD);
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients','consents','care_relationships','assessments','measurements','capture_sessions','camera_scans',
    'intake_answers','safety_responses','reasoning_decisions','clinical_impressions','reports','programs','training_sessions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
  END LOOP;
END $$;
GRANT INSERT ON audit_events TO pv_app;
GRANT USAGE ON SEQUENCE audit_events_seq_seq TO pv_app;

-- ---------------------------------------------------------------------------------------------
-- Retention: purge landmark streams after the clinic window (metrics, reports and audit remain)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_expired_landmarks(clinic uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE days integer; n integer;
BEGIN
  SELECT landmark_days INTO days FROM retention_policies WHERE clinic_id = clinic;
  IF days IS NULL OR days = 0 THEN RETURN 0; END IF;  -- 0 = keep until deleted
  UPDATE capture_sessions SET landmark_frames = '"purged"'::jsonb, keyframes = '[]'::jsonb
   WHERE created_at < now() - make_interval(days => days) AND landmark_frames <> '"purged"'::jsonb;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO audit_events (actor_id, action, entity, entity_id, detail)
  VALUES (NULL, 'retention_purge', 'capture_sessions', clinic, jsonb_build_object('rows', n, 'days', days));
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Protected report access: short-lived, hashed, single-report tokens (no public URLs)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_access_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id    uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,             -- sha256 of the random token; the token itself is never stored
  created_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  CHECK (expires_at <= now() + interval '7 days')
);
ALTER TABLE report_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_access_tokens FORCE ROW LEVEL SECURITY;

-- Issues a token for an APPROVED report the caller may see. Returns the plain token once.
CREATE OR REPLACE FUNCTION issue_report_token(r uuid, ttl interval DEFAULT interval '24 hours') RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tok text; pid uuid; st text;
BEGIN
  SELECT a.patient_id, rp.status INTO pid, st FROM reports rp JOIN assessments a ON a.id = rp.assessment_id WHERE rp.id = r;
  IF pid IS NULL OR NOT app_visible_patient(pid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF st <> 'clinician_reviewed' THEN RAISE EXCEPTION 'only clinician-reviewed reports can be shared' USING ERRCODE = 'check_violation'; END IF;
  tok := encode(gen_random_bytes(32), 'hex');
  INSERT INTO report_access_tokens (report_id, token_hash, created_by, expires_at) VALUES (r, digest(tok, 'sha256'), app_user_id(), now() + ttl);
  INSERT INTO audit_events (actor_id, action, entity, entity_id, detail) VALUES (app_user_id(), 'share_report', 'reports', r, jsonb_build_object('expires', now() + ttl));
  RETURN tok;
END $$;

-- Resolves a token (single use) to its report id, or NULL when unknown, expired or already used.
CREATE OR REPLACE FUNCTION redeem_report_token(tok text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  UPDATE report_access_tokens SET used_at = now()
   WHERE token_hash = digest(tok, 'sha256') AND used_at IS NULL AND expires_at > now()
   RETURNING report_id INTO rid;
  IF rid IS NOT NULL THEN
    INSERT INTO audit_events (actor_id, action, entity, entity_id, detail) VALUES (NULL, 'report_token_used', 'reports', rid, NULL);
  END IF;
  RETURN rid;
END $$;
GRANT EXECUTE ON FUNCTION issue_report_token(uuid, interval), redeem_report_token(text) TO pv_app;
