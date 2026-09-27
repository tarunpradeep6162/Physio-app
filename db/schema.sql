-- PhysioVision AI — PostgreSQL schema (server-side target for the MVP's local repository).
--
-- Principles
--  * UUID primary keys everywhere; sequential identifiers are never exposed.
--  * Four data categories are stored separately and never blurred:
--      patient_reported_outcomes  (patient-reported)
--      measurements               (camera-estimated OR clinician-measured, with provenance)
--      observations               (algorithmic, rule vs clinician threshold)
--      clinical_notes / programs  (clinical interpretation, clinician-authored/approved)
--  * Every camera-derived row carries provenance (model, algorithm, exercise version, confidence,
--    device context) so results remain interpretable after algorithms change.
--  * Raw video is NOT stored. camera_scans keep landmarks; still images only with consent.
--  * Encryption at rest is provided by the managed database/volume (e.g. AES-256) and TLS in
--    transit; column-level encryption (pgcrypto / KMS envelope) is recommended for free-text
--    clinical notes and contact details. Compliance must be independently verified per jurisdiction.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email

-- ---------------------------------------------------------------------------------------------
-- Identity & relationships
-- ---------------------------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('patient', 'clinician', 'admin', 'validation_engineer');

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext UNIQUE NOT NULL,
  -- Authentication is delegated to an identity provider (OIDC); no password hashes here.
  idp_subject     text UNIQUE NOT NULL,
  role            user_role NOT NULL,
  display_name    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE clinicians (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid UNIQUE NOT NULL REFERENCES users(id),
  name            text NOT NULL,
  title           text NOT NULL,
  registration_no text,
  clinic          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE patients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid UNIQUE REFERENCES users(id),
  name               text NOT NULL,
  dob                date,
  sex                text CHECK (sex IN ('female', 'male', 'other')),
  phone              text,
  height_cm          numeric(5,1),
  preferred_language text NOT NULL DEFAULT 'en',
  concern            text,
  goal               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE TABLE care_relationships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  clinician_id  uuid NOT NULL REFERENCES clinicians(id),
  status        text NOT NULL CHECK (status IN ('active', 'ended')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  UNIQUE (patient_id, clinician_id, created_at)
);
CREATE INDEX care_rel_clinician_active ON care_relationships (clinician_id) WHERE status = 'active';

CREATE TYPE consent_type AS ENUM ('camera_processing', 'data_storage', 'image_storage', 'research_export');

-- Append-only: the latest row per (patient, type) is the current state; history is preserved.
CREATE TABLE consents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type          consent_type NOT NULL,
  granted       boolean NOT NULL,
  text_version  text NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  recorded_by   uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX consents_current ON consents (patient_id, type, recorded_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Assessment
-- ---------------------------------------------------------------------------------------------
CREATE TYPE assessment_status AS ENUM ('in_progress', 'submitted', 'reviewed', 'safety_hold');

CREATE TABLE assessments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES users(id),
  status        assessment_status NOT NULL DEFAULT 'in_progress',
  step          smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  submitted_at  timestamptz,
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES clinicians(id)
);
CREATE INDEX assessments_patient ON assessments (patient_id, created_at DESC);
CREATE INDEX assessments_queue ON assessments (status, submitted_at) WHERE status IN ('submitted', 'safety_hold');

CREATE TABLE pain_regions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  region_id      text NOT NULL,          -- view-independent anatomical id, e.g. 'knee_left'
  UNIQUE (assessment_id, region_id)
);

CREATE TABLE patient_reported_outcomes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  assessment_id  uuid REFERENCES assessments(id) ON DELETE CASCADE,
  session_id     uuid,                   -- FK added after training_sessions
  type           text NOT NULL,          -- nprs_now, nprs_worst_24h, pain_quality, red_flags, …
  value          jsonb NOT NULL,         -- stored verbatim
  recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pro_patient_type ON patient_reported_outcomes (patient_id, type, recorded_at);

-- ---------------------------------------------------------------------------------------------
-- Camera data & measurements
-- ---------------------------------------------------------------------------------------------
CREATE TABLE camera_scans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  assessment_id   uuid REFERENCES assessments(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('static_posture', 'dynamic_movement')),
  view            text NOT NULL,
  frame_width     integer NOT NULL,
  frame_height    integer NOT NULL,
  landmarks       jsonb NOT NULL,        -- 33 × {x,y,z,visibility}
  image_object    text,                  -- object-store key; only with image_storage consent
  provenance      jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- High-rate landmark streams for validation studies (only with research_export consent).
CREATE TABLE landmark_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid REFERENCES patients(id) ON DELETE SET NULL,  -- NULL after anonymisation
  purpose         text NOT NULL CHECK (purpose IN ('validation', 'clinical_review')),
  exercise_definition_version_id uuid,
  frame_rate      numeric(5,2),
  frames          jsonb NOT NULL,        -- or object-store key for large captures
  provenance      jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE review_status AS ENUM ('pending', 'accepted', 'rejected', 'repeat_requested');
CREATE TYPE measurement_category AS ENUM ('camera_estimate', 'clinician_measured');
CREATE TYPE measurement_source AS ENUM ('camera_estimation', 'clinician_goniometer', 'clinician_entry', 'simulated_demo');

CREATE TABLE measurements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  assessment_id      uuid REFERENCES assessments(id) ON DELETE CASCADE,
  scan_id            uuid REFERENCES camera_scans(id) ON DELETE CASCADE,
  session_id         uuid,               -- FK added after training_sessions
  type               text NOT NULL,      -- knee_flexion, hip_flexion_slr, posture.shoulder_level, …
  value              numeric(7,2) NOT NULL,
  unit               text NOT NULL CHECK (unit IN ('deg', 'pct_height')),
  side               text CHECK (side IN ('left', 'right')),
  direction          text,
  sd                 numeric(6,2),
  confidence         numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  category           measurement_category NOT NULL,
  -- Provenance (denormalised columns for querying + full JSON for completeness)
  source             measurement_source NOT NULL,
  created_by         uuid NOT NULL REFERENCES users(id),
  pose_model         text,
  pose_model_version text,
  algorithm_version  text,
  engine_version     text,
  exercise_definition_version_id uuid,
  device_context     jsonb,
  provenance         jsonb NOT NULL,
  review_status      review_status NOT NULL DEFAULT 'pending',
  reviewed_by        uuid REFERENCES clinicians(id),
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (category <> 'camera_estimate' OR source IN ('camera_estimation', 'simulated_demo')),
  CHECK (category <> 'clinician_measured' OR source IN ('clinician_goniometer', 'clinician_entry'))
);
CREATE INDEX measurements_series ON measurements (patient_id, type, created_at);
CREATE INDEX measurements_review ON measurements (review_status) WHERE review_status = 'pending';

CREATE TABLE observations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  assessment_id   uuid REFERENCES assessments(id) ON DELETE CASCADE,
  measurement_id  uuid NOT NULL REFERENCES measurements(id) ON DELETE CASCADE,
  rule            text NOT NULL,
  threshold       numeric(7,2) NOT NULL,   -- clinician-configured value at time of evaluation
  value           numeric(7,2) NOT NULL,
  status          review_status NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------
-- Exercise definitions (versioned) & programs
-- ---------------------------------------------------------------------------------------------
CREATE TABLE exercise_definitions (
  id          text PRIMARY KEY,           -- 'knee_flexion'
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Immutable once published; sessions reference the exact version they were executed with.
CREATE TABLE exercise_definition_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id   text NOT NULL REFERENCES exercise_definitions(id),
  version         text NOT NULL,          -- semver
  spec            jsonb NOT NULL,         -- thresholds, form rules, allowed ranges, cues
  algorithm_version text NOT NULL,
  published_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version)
);
ALTER TABLE measurements ADD FOREIGN KEY (exercise_definition_version_id) REFERENCES exercise_definition_versions(id);
ALTER TABLE landmark_sessions ADD FOREIGN KEY (exercise_definition_version_id) REFERENCES exercise_definition_versions(id);

CREATE TABLE programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  clinician_id  uuid NOT NULL REFERENCES clinicians(id),
  title         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  start_date    date NOT NULL,
  end_date      date NOT NULL CHECK (end_date >= start_date),
  approved_at   timestamptz,
  approved_by   uuid REFERENCES clinicians(id),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'active' OR approved_by IS NOT NULL)   -- only approved programs reach patients
);
CREATE UNIQUE INDEX one_active_program ON programs (patient_id) WHERE status = 'active';

CREATE TABLE program_exercises (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id          uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  definition_version_id uuid NOT NULL REFERENCES exercise_definition_versions(id),
  position            smallint NOT NULL,
  side                text NOT NULL CHECK (side IN ('left', 'right')),
  sets                smallint NOT NULL CHECK (sets BETWEEN 1 AND 10),
  reps                smallint NOT NULL CHECK (reps BETWEEN 1 AND 50),
  target_min_deg      numeric(5,1) NOT NULL,
  target_max_deg      numeric(5,1) NOT NULL CHECK (target_max_deg > target_min_deg),
  hold_seconds        numeric(4,1) NOT NULL CHECK (hold_seconds BETWEEN 0 AND 60),
  rest_seconds        smallint NOT NULL CHECK (rest_seconds BETWEEN 0 AND 600),
  tempo               jsonb NOT NULL,
  frequency_per_week  smallint NOT NULL,
  instructions        text,
  UNIQUE (program_id, position)
);

CREATE TABLE training_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  program_id    uuid NOT NULL REFERENCES programs(id),
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  status        text NOT NULL CHECK (status IN ('in_progress', 'completed', 'interrupted')),
  pain_before   smallint CHECK (pain_before BETWEEN 0 AND 10),
  pain_after    smallint CHECK (pain_after BETWEEN 0 AND 10),
  rpe           smallint CHECK (rpe BETWEEN 0 AND 10),
  provenance    jsonb NOT NULL
);
CREATE INDEX sessions_patient ON training_sessions (patient_id, started_at DESC);
ALTER TABLE measurements ADD FOREIGN KEY (session_id) REFERENCES training_sessions(id) ON DELETE CASCADE;
ALTER TABLE patient_reported_outcomes ADD FOREIGN KEY (session_id) REFERENCES training_sessions(id) ON DELETE CASCADE;

CREATE TABLE exercise_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  program_exercise_id uuid NOT NULL REFERENCES program_exercises(id),
  definition_version_id uuid NOT NULL REFERENCES exercise_definition_versions(id),
  algorithm_version   text NOT NULL,
  sets_completed      smallint NOT NULL,
  reps_completed      smallint NOT NULL,
  reps_attempted      smallint NOT NULL,
  peak_rom_deg        numeric(5,1),
  mean_peak_rom_deg   numeric(5,1),
  holds_achieved      smallint NOT NULL,
  holds_required      smallint NOT NULL,
  mean_concentric_ms  integer,
  mean_eccentric_ms   integer,
  fast_reps           smallint NOT NULL,
  form_cues           jsonb NOT NULL DEFAULT '{}',
  tracking_coverage   numeric(4,3) NOT NULL,
  mean_confidence     numeric(4,3),
  reps                jsonb NOT NULL,     -- per-rep records
  trajectory          jsonb NOT NULL,     -- downsampled (10 Hz) angle trace
  ended_early         boolean NOT NULL DEFAULT false
);

-- ---------------------------------------------------------------------------------------------
-- Clinical notes, alerts, messaging, audit
-- ---------------------------------------------------------------------------------------------
CREATE TABLE clinical_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES clinicians(id),
  assessment_id  uuid REFERENCES assessments(id),
  body           text NOT NULL,           -- candidate for column-level encryption
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  type         text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id)
);
CREATE INDEX alerts_open ON alerts (patient_id) WHERE resolved_at IS NULL;

CREATE TABLE messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  from_user_id  uuid NOT NULL REFERENCES users(id),
  body          text NOT NULL,
  sent_at       timestamptz NOT NULL DEFAULT now()
);

-- Append-only audit log. Application role has INSERT only; no UPDATE/DELETE.
CREATE TABLE audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid,                        -- NULL for system actions
  action      text NOT NULL,               -- create, update, delete, view, review:accepted, export, …
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  detail      jsonb,
  ip          inet,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity ON audit_events (entity, entity_id, at DESC);
CREATE INDEX audit_actor ON audit_events (actor_id, at DESC);


-- ---------------------------------------------------------------------------------------------
-- Knee pathway (schema v2) — intake, safety, test plans, captures, reasoning, reports
-- ---------------------------------------------------------------------------------------------
ALTER TABLE assessments
  ADD COLUMN region text NOT NULL DEFAULT 'general' CHECK (region IN ('knee', 'shoulder', 'low_back', 'general')),
  ADD COLUMN type text NOT NULL DEFAULT 'initial' CHECK (type IN ('initial', 'reassessment')),
  ADD COLUMN baseline_assessment_id uuid REFERENCES assessments(id),
  ADD COLUMN safety_level text CHECK (safety_level IN ('clear', 'clinician_review', 'urgent', 'emergency'));

ALTER TABLE pain_regions
  ADD COLUMN anatomy text,
  ADD COLUMN side text CHECK (side IN ('left', 'right')),
  ADD COLUMN symptom_types text[] NOT NULL DEFAULT '{pain}',
  ADD COLUMN sub_locations text[];

CREATE TABLE radiation_paths (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  view           text NOT NULL,
  symptom_type   text NOT NULL CHECK (symptom_type IN ('pain', 'stiffness', 'weakness', 'numbness', 'tingling')),
  points         jsonb NOT NULL,           -- [[x, y], …] in map-view coordinates
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Versioned clinical content (questionnaires, safety rules, reasoning rules, protocols, report
-- templates) with clinical-lead approval.
CREATE TABLE clinical_rule_versions (
  key            text PRIMARY KEY,         -- e.g. 'knee-safety@1.0.0'
  kind           text NOT NULL CHECK (kind IN ('questionnaire', 'safety', 'reasoning', 'observation', 'protocol', 'report_template')),
  content        jsonb NOT NULL,
  approved_by    uuid REFERENCES clinicians(id),
  approved_at    timestamptz
);

-- Immutable original answers; corrections supersede.
CREATE TABLE intake_answers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id          uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  patient_id             uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  questionnaire_key      text NOT NULL REFERENCES clinical_rule_versions(key),
  question_id            text NOT NULL,
  question_text          text NOT NULL,     -- text exactly as shown
  answer                 jsonb,
  answered_at            timestamptz NOT NULL DEFAULT now(),
  superseded_by          uuid REFERENCES intake_answers(id)
);
CREATE INDEX intake_current ON intake_answers (assessment_id, question_id) WHERE superseded_by IS NULL;

CREATE TABLE safety_responses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id      uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  patient_id         uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  questionnaire_key  text NOT NULL REFERENCES clinical_rule_versions(key),
  question_id        text NOT NULL,
  question_text      text NOT NULL,
  answer             boolean NOT NULL,
  triggered          boolean NOT NULL,
  action             text CHECK (action IN ('emergency', 'urgent', 'clinician_review')),
  answered_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE summary_amendments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  target         text NOT NULL,             -- summary line key
  original_text  text NOT NULL,
  amended_text   text NOT NULL,
  amended_by     uuid NOT NULL REFERENCES users(id),
  amended_at     timestamptz NOT NULL DEFAULT now()
);

-- Test-plan revisions (latest is current; history kept).
CREATE TABLE test_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  items          jsonb NOT NULL,            -- [{protocol_key, side}]
  source         text NOT NULL CHECK (source IN ('protocol_default', 'clinician', 'baseline_copy')),
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  note           text
);

-- One recorded protocol attempt (valid or not); raw video is never stored.
CREATE TABLE capture_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id        uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  patient_id           uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  protocol_key         text NOT NULL REFERENCES clinical_rule_versions(key),
  side                 text CHECK (side IN ('left', 'right')),
  view                 text NOT NULL,
  quality_verdict      text NOT NULL CHECK (quality_verdict IN ('valid', 'invalid')),
  quality              jsonb NOT NULL,      -- coverage, confidence, reasons, issues, fps
  capture_config       jsonb,               -- view, frame, roll, body extent/centre (no metric distance)
  baseline_capture_id  uuid REFERENCES capture_sessions(id),
  condition_match      jsonb,
  setup_notes          text,
  landmark_frames      jsonb NOT NULL,      -- compact codec, filtered, 10 Hz
  keyframes            jsonb NOT NULL,      -- start/mid/peak/return raw + filtered landmarks
  signal               jsonb NOT NULL,
  provenance           jsonb NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX captures_assessment ON capture_sessions (assessment_id, protocol_key, side, created_at DESC);
ALTER TABLE measurements ADD COLUMN capture_id uuid REFERENCES capture_sessions(id) ON DELETE CASCADE,
                         ADD COLUMN metric_id text,
                         ADD COLUMN validity text CHECK (validity IN ('valid', 'invalid')),
                         ADD COLUMN validity_reason text;

CREATE TABLE movement_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_id   uuid NOT NULL REFERENCES capture_sessions(id) ON DELETE CASCADE,
  t_ms         integer NOT NULL,
  type         text NOT NULL,               -- ready/start/engaged/peak/returning/end/incomplete/discarded/paused/resumed
  cycle        integer
);

-- Clinician actions on rule-generated considerations (suggestion snapshot preserved).
CREATE TABLE reasoning_decisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id      uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  rule_set_key       text NOT NULL REFERENCES clinical_rule_versions(key),
  consideration_id   text NOT NULL,
  suggestion         jsonb NOT NULL,
  action             text NOT NULL CHECK (action IN ('accept', 'reject', 'defer', 'annotate')),
  note               text,
  decided_by         uuid NOT NULL REFERENCES users(id),
  decided_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinical_impressions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id  uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  text           text NOT NULL,
  recorded_by    uuid NOT NULL REFERENCES users(id),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id     uuid NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  version           integer NOT NULL,
  status            text NOT NULL CHECK (status IN ('preliminary', 'clinician_reviewed')),
  template_key      text NOT NULL,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  generated_by      uuid NOT NULL REFERENCES users(id),
  approved_by       uuid REFERENCES clinicians(id),
  approved_at       timestamptz,
  UNIQUE (assessment_id, version),
  CHECK (status <> 'clinician_reviewed' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

ALTER TABLE training_sessions ADD COLUMN pain_events jsonb NOT NULL DEFAULT '[]';
ALTER TABLE program_exercises ADD COLUMN progression text,
                              ADD COLUMN pain_stop_at smallint CHECK (pain_stop_at BETWEEN 0 AND 10),
                              ADD COLUMN pain_rise_stop smallint CHECK (pain_rise_stop BETWEEN 1 AND 10);

-- Units used by knee protocols (seconds, % leg length, counts) — the original check only allowed deg/pct_height.
ALTER TABLE measurements DROP CONSTRAINT measurements_unit_check,
  ADD CONSTRAINT measurements_unit_check CHECK (unit IN ('deg', 'pct_height', 's', 'pct_leg', 'count'));
-- Validation study (Phase 13): reference measurements and a per-participant split.
ALTER TABLE measurements ADD COLUMN reference jsonb;   -- {instrument, blinded, note} when this is a reference for capture_id/metric_id
ALTER TABLE patients ADD COLUMN validation_split text CHECK (validation_split IN ('tuning', 'evaluation'));

-- Retention: landmark data older than the configured window can be purged by a scheduled job.
CREATE TABLE retention_policies (
  clinic_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landmark_days  integer NOT NULL DEFAULT 0 CHECK (landmark_days >= 0),
  raw_video      text NOT NULL DEFAULT 'never_stored' CHECK (raw_video = 'never_stored')
);

-- ---------------------------------------------------------------------------------------------
-- Row-level security (sketch): patients see only their own rows; clinicians see patients with
-- an active care relationship. The API sets `app.user_id` per request.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY measurements_patient ON measurements
  USING (patient_id IN (SELECT id FROM patients WHERE user_id = current_setting('app.user_id')::uuid));
CREATE POLICY measurements_clinician ON measurements
  USING (patient_id IN (
    SELECT cr.patient_id FROM care_relationships cr
    JOIN clinicians c ON c.id = cr.clinician_id
    WHERE cr.status = 'active' AND c.user_id = current_setting('app.user_id')::uuid));
-- Apply equivalent policies to every patient-scoped table.
