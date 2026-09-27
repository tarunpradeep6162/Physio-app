-- Dheepika Lab migration 004 — phone / wearable activity (Phase 11).
-- Steps and walking time only, each behind its own consent. Run after plans.sql.
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'activity_steps';
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'activity_walking';
BEGIN;

CREATE TABLE activity_imports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('apple_health', 'health_connect', 'csv')),
  file_name   text,
  status      text NOT NULL CHECK (status IN ('ok', 'permission_revoked', 'consent_missing', 'error')),
  added       integer NOT NULL CHECK (added >= 0),
  duplicates  integer NOT NULL CHECK (duplicates >= 0),
  ignored     jsonb NOT NULL DEFAULT '{}',
  errors      jsonb NOT NULL DEFAULT '[]',
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activity_samples (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  metric        text NOT NULL CHECK (metric IN ('steps', 'walking_minutes')),
  value         numeric(10,1) NOT NULL CHECK (value >= 0),
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL CHECK (end_at >= start_at),
  tz_offset_min smallint NOT NULL CHECK (tz_offset_min BETWEEN -840 AND 840),
  platform      text NOT NULL CHECK (platform IN ('apple_health', 'health_connect', 'csv')),
  source_app    text NOT NULL,
  source_device text,
  record_id     text,
  import_id     uuid NOT NULL REFERENCES activity_imports(id) ON DELETE CASCADE,
  imported_at   timestamptz NOT NULL DEFAULT now()
);
-- Re-importing the same platform record is a no-op.
CREATE UNIQUE INDEX activity_record_unique ON activity_samples (patient_id, platform, record_id) WHERE record_id IS NOT NULL;
CREATE UNIQUE INDEX activity_sample_unique ON activity_samples (patient_id, metric, platform, source_app, coalesce(source_device, ''), start_at, end_at, value) WHERE record_id IS NULL;

-- A sample can only be stored while its consent is granted (checked at write time, like camera data).
CREATE OR REPLACE FUNCTION enforce_activity_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT has_consent(NEW.patient_id, CASE NEW.metric WHEN 'steps' THEN 'activity_steps'::consent_type ELSE 'activity_walking'::consent_type END) THEN
    RAISE EXCEPTION 'consent required for % activity data', NEW.metric USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER activity_samples_consent BEFORE INSERT ON activity_samples FOR EACH ROW EXECUTE FUNCTION enforce_activity_consent();

-- Reads: the patient and clinicians in care, and only while consent for that metric is granted.
ALTER TABLE activity_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_samples FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_samples_read ON activity_samples FOR SELECT TO pv_app USING (
  app_visible_patient(patient_id)
  AND has_consent(patient_id, CASE metric WHEN 'steps' THEN 'activity_steps'::consent_type ELSE 'activity_walking'::consent_type END));
-- Writes and deletion (on withdrawal) by the patient only: clinicians cannot fabricate device data.
CREATE POLICY activity_samples_patient_insert ON activity_samples FOR INSERT TO pv_app WITH CHECK (EXISTS (SELECT 1 FROM patients WHERE id = patient_id AND user_id = app_user_id()));
CREATE POLICY activity_samples_patient_delete ON activity_samples FOR DELETE TO pv_app USING (EXISTS (SELECT 1 FROM patients WHERE id = patient_id AND user_id = app_user_id()));
GRANT SELECT, INSERT, DELETE ON activity_samples TO pv_app;

ALTER TABLE activity_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_imports_read ON activity_imports FOR SELECT TO pv_app USING (app_visible_patient(patient_id));
CREATE POLICY activity_imports_patient_insert ON activity_imports FOR INSERT TO pv_app WITH CHECK (created_by = app_user_id() AND EXISTS (SELECT 1 FROM patients WHERE id = patient_id AND user_id = app_user_id()));
GRANT SELECT, INSERT ON activity_imports TO pv_app;

CREATE TRIGGER activity_imports_audit AFTER INSERT ON activity_imports FOR EACH ROW EXECUTE FUNCTION audit_row();

INSERT INTO schema_migrations (version) VALUES ('004_activity');
COMMIT;
