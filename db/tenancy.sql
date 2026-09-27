-- Dheepika Lab — migration 002: organisation (tenant) separation. Phase 6.
-- Apply after schema.sql and security.sql:
--   psql -v ON_ERROR_STOP=1 -f schema.sql -f security.sql -f tenancy.sql
--
-- Every clinician and patient belongs to exactly one organisation (clinic). A clinician can see or
-- write a patient's records only when BOTH an active care relationship exists AND both belong to
-- the same organisation; a care relationship across organisations is refused outright. This is in
-- addition to (not instead of) the care-relationship rules in security.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES ('001_schema_security') ON CONFLICT DO NOTHING;

CREATE TABLE organizations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  jurisdiction text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clinicians ADD COLUMN organization_id uuid REFERENCES organizations(id);
ALTER TABLE patients   ADD COLUMN organization_id uuid REFERENCES organizations(id);

-- Backfill: one organisation per existing clinic name; patients take the organisation of their
-- earliest care relationship. Rows that cannot be placed are left NULL and are visible to nobody
-- but themselves until an administrator assigns them.
INSERT INTO organizations (name) SELECT DISTINCT clinic FROM clinicians;
UPDATE clinicians c SET organization_id = o.id FROM organizations o WHERE o.name = c.clinic;
UPDATE patients p SET organization_id = sub.org
  FROM (SELECT DISTINCT ON (cr.patient_id) cr.patient_id, c.organization_id AS org
          FROM care_relationships cr JOIN clinicians c ON c.id = cr.clinician_id
         ORDER BY cr.patient_id, cr.created_at) sub
 WHERE p.id = sub.patient_id;
ALTER TABLE clinicians ALTER COLUMN organization_id SET NOT NULL;
CREATE INDEX patients_org ON patients (organization_id);
CREATE INDEX clinicians_org ON clinicians (organization_id);

-- A care relationship must stay inside one organisation.
CREATE OR REPLACE FUNCTION care_same_organization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE po uuid; co uuid;
BEGIN
  SELECT organization_id INTO po FROM patients WHERE id = NEW.patient_id;
  SELECT organization_id INTO co FROM clinicians WHERE id = NEW.clinician_id;
  IF po IS NULL OR co IS NULL OR po <> co THEN
    RAISE EXCEPTION 'care relationship across organisations is not allowed (patient org %, clinician org %)', po, co;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER care_same_org BEFORE INSERT OR UPDATE ON care_relationships
  FOR EACH ROW EXECUTE FUNCTION care_same_organization();

-- A patient's organisation cannot be changed while an active care relationship exists.
CREATE OR REPLACE FUNCTION patient_org_locked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     AND EXISTS (SELECT 1 FROM care_relationships WHERE patient_id = NEW.id AND status = 'active') THEN
    RAISE EXCEPTION 'end the active care relationship before moving a patient between organisations';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patient_org_lock BEFORE UPDATE OF organization_id ON patients
  FOR EACH ROW EXECUTE FUNCTION patient_org_locked();

-- Visibility and write rules now also require the same organisation.
CREATE OR REPLACE FUNCTION app_visible_patient(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM patients WHERE id = p AND user_id = app_user_id() AND deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM care_relationships cr
                   JOIN clinicians c ON c.id = cr.clinician_id
                   JOIN patients pt ON pt.id = cr.patient_id
                 WHERE cr.patient_id = p AND cr.status = 'active' AND c.user_id = app_user_id()
                   AND pt.organization_id = c.organization_id AND pt.deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION app_is_clinician_of(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM care_relationships cr
                   JOIN clinicians c ON c.id = cr.clinician_id
                   JOIN patients pt ON pt.id = cr.patient_id
                 WHERE cr.patient_id = p AND cr.status = 'active' AND c.user_id = app_user_id()
                   AND pt.organization_id = c.organization_id)
$$;

CREATE OR REPLACE FUNCTION app_user_organization() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM clinicians WHERE user_id = app_user_id()
  UNION ALL
  SELECT organization_id FROM patients WHERE user_id = app_user_id()
  LIMIT 1
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_member_read ON organizations FOR SELECT TO pv_app USING (id = app_user_organization());
GRANT SELECT ON organizations TO pv_app;
GRANT SELECT ON schema_migrations TO pv_app;

INSERT INTO schema_migrations (version) VALUES ('002_tenancy');
COMMIT;
