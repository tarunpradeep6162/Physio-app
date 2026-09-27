#!/usr/bin/env bash
# Dheepika Lab — database checks on a throwaway local PostgreSQL 16 cluster (Phase 6).
#   1. schema.sql + security.sql, then security_test.sql
#   2. tenancy.sql (migration 002), then tenancy_test.sql; plans.sql (003), then plans_test.sql
#   3. backup/restore drill: seed fixture rows, pg_dump -Fc, restore into a fresh database,
#      compare row counts table by table and verify the audit hash chain on the restored copy.
# Nothing here touches a real database. Requires the postgresql-16 binaries and a 'postgres' user.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PORT=${PORT:-55432}
WORK=$(mktemp -d /tmp/dl-pg.XXXXXX)
chown postgres "$WORK"
cp "$ROOT"/db/*.sql "$WORK"/ && chown postgres "$WORK"/*.sql
as_pg() { runuser -u postgres -- "$@"; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
as_pg "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
psql_() { as_pg psql -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q "$@"; }

psql_ -d postgres -c 'CREATE DATABASE dl'
cd "$WORK"
psql_ -d dl -f schema.sql -f security.sql >/dev/null
psql_ -d dl -f security_test.sql
psql_ -d dl -f tenancy.sql >/dev/null
psql_ -d dl -f tenancy_test.sql
psql_ -d dl -f plans.sql >/dev/null
psql_ -d dl -f plans_test.sql

echo '--- backup / restore drill'
psql_ -d dl <<'SQL'
INSERT INTO organizations (id, name) VALUES ('91000000-0000-0000-0000-000000000001', 'Drill clinic');
INSERT INTO users (id, email, idp_subject, role, display_name) VALUES
 ('01000000-0000-0000-0000-000000000001', 'drill-p@example.test', 'drill-p', 'patient', 'Drill patient'),
 ('01000000-0000-0000-0000-000000000002', 'drill-c@example.test', 'drill-c', 'clinician', 'Drill clinician');
INSERT INTO patients (id, user_id, name, organization_id) VALUES ('11000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000001', 'DRILL-1', '91000000-0000-0000-0000-000000000001');
INSERT INTO clinicians (id, user_id, name, title, clinic, organization_id) VALUES ('21000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000002', 'Drill', 'Physiotherapist', 'Drill clinic', '91000000-0000-0000-0000-000000000001');
INSERT INTO care_relationships (patient_id, clinician_id, status) VALUES ('11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'active');
INSERT INTO assessments (id, patient_id, created_by) VALUES ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000001');
INSERT INTO measurements (patient_id, assessment_id, type, value, unit, confidence, category, source, created_by, provenance)
VALUES ('11000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'shoulder_flexion', 150, 'deg', 0.9, 'camera_estimate', 'camera_estimation', '01000000-0000-0000-0000-000000000001', '{}');
SQL
as_pg "$PGBIN/pg_dump" -h "$WORK" -p "$PORT" -U postgres -Fc -f "$WORK/dl.dump" dl
psql_ -d postgres -c 'CREATE DATABASE dl_restore'
as_pg "$PGBIN/pg_restore" -h "$WORK" -p "$PORT" -U postgres -d dl_restore --exit-on-error "$WORK/dl.dump"
count_rows() {
  psql_ -d "$1" -At <<'SQL'
SELECT string_agg(t || '=' || n, ',' ORDER BY t) FROM (
  SELECT c.relname AS t, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I', c.relname), false, true, '')))[1]::text::int AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r') x;
SQL
}
A=$(count_rows dl); B=$(count_rows dl_restore)
if [ "$A" != "$B" ]; then echo "RESTORE DRILL FAILED: row counts differ"; echo "$A"; echo "$B"; exit 1; fi
AUD=$(psql_ -d dl_restore -At -c 'SELECT audit_verify()')
NAUD=$(psql_ -d dl_restore -At -c 'SELECT count(*) FROM audit_events')
MIG=$(psql_ -d dl_restore -At -c "SELECT string_agg(version, ',' ORDER BY version) FROM schema_migrations")
# audit_verify() returns NULL when the whole hash chain is intact, else the first broken sequence number.
if [ -n "$AUD" ] || [ "$NAUD" -lt 1 ]; then echo "RESTORE DRILL FAILED: audit chain broken at seq $AUD (rows $NAUD)"; exit 1; fi
echo "restored: identical row counts in $(echo "$A" | tr ',' '\n' | wc -l) tables; audit chain intact over $NAUD rows; migrations = $MIG"
echo 'ALL DATABASE CHECKS PASSED'
