-- Dheepika Lab migration 003 — prescription and plan versioning (Phase 9).
-- Run after schema.sql, security.sql and tenancy.sql. Forward-only; existing programs keep their
-- content and are numbered per patient in creation order.
BEGIN;

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS version             integer,
  ADD COLUMN IF NOT EXISTS supersedes          uuid REFERENCES programs(id),
  ADD COLUMN IF NOT EXISTS change_reason       text,
  ADD COLUMN IF NOT EXISTS reassess_after_days integer CHECK (reassess_after_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS reassess_triggers   text[] NOT NULL DEFAULT '{}'
    CHECK (reassess_triggers <@ ARRAY['pain_stop','pain_increase','patient_pause']::text[]),
  ADD COLUMN IF NOT EXISTS pause_on_pain_stop  boolean NOT NULL DEFAULT true;
UPDATE programs p SET version = x.n
  FROM (SELECT id, row_number() OVER (PARTITION BY patient_id ORDER BY created_at, id) AS n FROM programs) x
  WHERE p.id = x.id AND p.version IS NULL;
ALTER TABLE programs ALTER COLUMN version SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS program_version_unique ON programs (patient_id, version);

-- The clinician-approved alternative travels with the exercise, inside the same approved version.
ALTER TABLE program_exercises ADD COLUMN IF NOT EXISTS alternative jsonb;

-- Patients see only APPROVED plans; clinicians in care see drafts too.
DROP POLICY IF EXISTS programs_read ON programs;
CREATE POLICY programs_read ON programs FOR SELECT TO pv_app
  USING (app_is_clinician_of(patient_id) OR (app_visible_patient(patient_id) AND approved_by IS NOT NULL));
ALTER TABLE program_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_exercises FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS program_exercises_read ON program_exercises;
DROP POLICY IF EXISTS program_exercises_clinician_write ON program_exercises;
CREATE POLICY program_exercises_read ON program_exercises FOR SELECT TO pv_app
  USING (EXISTS (SELECT 1 FROM programs p WHERE p.id = program_id));   -- inherits programs_read
CREATE POLICY program_exercises_clinician_write ON program_exercises FOR ALL TO pv_app
  USING (EXISTS (SELECT 1 FROM programs p WHERE p.id = program_id AND app_is_clinician_of(p.patient_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM programs p WHERE p.id = program_id AND app_is_clinician_of(p.patient_id)));
GRANT SELECT, INSERT, UPDATE, DELETE ON program_exercises TO pv_app;

-- Pauses: the patient (or the pain rule in their session) or a clinician in care may add one.
CREATE TABLE IF NOT EXISTS plan_pauses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  uuid NOT NULL REFERENCES programs(id),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('pain_rule', 'patient_report', 'safety')),
  detail      text,
  session_id  uuid REFERENCES training_sessions(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Resumes: clinician only. A pause is lifted by adding a resume, never by editing the pause.
CREATE TABLE IF NOT EXISTS plan_resumes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pause_id    uuid NOT NULL UNIQUE REFERENCES plan_pauses(id),
  program_id  uuid NOT NULL REFERENCES programs(id),
  patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  note        text NOT NULL CHECK (length(trim(note)) > 0),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION plan_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only history', TG_TABLE_NAME; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plan_pauses','plan_resumes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO pv_app USING (app_visible_patient(patient_id))', t || '_read', t);
    EXECUTE format('GRANT SELECT, INSERT ON %I TO pv_app', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION plan_history_immutable()', t || '_immutable', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION audit_row()', t || '_audit', t);
  END LOOP;
END $$;
CREATE POLICY plan_pauses_insert ON plan_pauses FOR INSERT TO pv_app WITH CHECK (
  created_by = app_user_id()
  AND (app_is_clinician_of(patient_id) OR EXISTS (SELECT 1 FROM patients WHERE id = patient_id AND user_id = app_user_id()))
  AND EXISTS (SELECT 1 FROM programs p WHERE p.id = program_id AND p.patient_id = plan_pauses.patient_id));
CREATE POLICY plan_resumes_clinician_insert ON plan_resumes FOR INSERT TO pv_app WITH CHECK (
  created_by = app_user_id() AND app_is_clinician_of(patient_id)
  AND EXISTS (SELECT 1 FROM plan_pauses x WHERE x.id = pause_id AND x.program_id = plan_resumes.program_id AND x.patient_id = plan_resumes.patient_id));

INSERT INTO schema_migrations (version) VALUES ('003_plan_versions');
COMMIT;
