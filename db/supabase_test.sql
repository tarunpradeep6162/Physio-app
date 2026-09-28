-- Behavioural tests for supabase/migrations/*_dheepika_lab_sync.sql (run on the local stub).
\set QUIET on
\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'SUPABASE TEST FAILED: %', msg; end if; end $$;
create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, true); end $$;

insert into public.clinician_allowlist (email) values ('physio@example.test');
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000c', 'Physio@Example.test', '{"display_name":"Physio"}'),
 ('00000000-0000-0000-0000-00000000000a', 'pat.a@example.test', '{"display_name":"A"}'),
 ('00000000-0000-0000-0000-00000000000b', 'pat.b@example.test', '{"display_name":"B"}');
select pg_temp.expect((select role from public.profiles where user_id = '00000000-0000-0000-0000-00000000000c') = 'clinician', 'allowlisted email becomes a physiotherapist (case-insensitive)');
select pg_temp.expect((select role from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a') = 'patient', 'other sign-ups are patients');

set local role authenticated;
-- Patient A creates their own records.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
-- The patient's own record must exist before rows that point at it (separate statement / request).
insert into public.records (tbl, id, patient_id, data) values
 ('users', '00000000-0000-0000-0000-00000000000a', 'pa', '{"role":"patient"}'),
 ('patients', 'pa', 'pa', '{"userId":"00000000-0000-0000-0000-00000000000a","name":"A"}');
insert into public.records (tbl, id, patient_id, data) values
 ('assessments', 'as1', 'pa', '{"patientId":"pa"}'),
 ('painRegions', 'pr1', 'pa', '{"assessmentId":"as1"}'),
 ('audit', 'ev1', 'pa', '{"action":"create"}');
select pg_temp.expect((select count(*) from public.records) = 5, 'patient A reads own rows');
-- A cannot make itself a physiotherapist, write clinician-only records, or read the allowlist / others' profiles.
do $$ begin
  insert into public.records (tbl, id, patient_id, data) values ('programs', 'pg-x', 'pa', '{"status":"active"}');
  raise exception 'SUPABASE TEST FAILED: patient wrote a plan';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.records set data = '{"role":"clinician"}' where tbl = 'users';
  if (select data ->> 'role' from public.records where tbl = 'users') = 'clinician' then raise exception 'SUPABASE TEST FAILED: patient became clinician'; end if;
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform * from public.clinician_allowlist;
  raise exception 'SUPABASE TEST FAILED: allowlist readable';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.profiles set role = 'clinician';
  raise exception 'SUPABASE TEST FAILED: profile writable';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.records (tbl, id, patient_id, data) values ('patients', 'pb-fake', 'pb-fake', '{"userId":"00000000-0000-0000-0000-00000000000b"}');
  raise exception 'SUPABASE TEST FAILED: patient created a record for another account';
exception when insufficient_privilege then null; end $$;

-- Patient B sees none of A's data.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.records (tbl, id, patient_id, data) values ('patients', 'pb', 'pb', '{"userId":"00000000-0000-0000-0000-00000000000b","name":"B"}');
select pg_temp.expect((select count(*) from public.records) = 1, 'patient B sees only its own record');
do $$ begin
  insert into public.records (tbl, id, patient_id, data) values ('assessments', 'as-hijack', 'pa', '{"patientId":"pa"}');
  raise exception 'SUPABASE TEST FAILED: B wrote into A''s record';
exception when insufficient_privilege then null; end $$;

-- The physiotherapist sees every patient's data and writes a plan for A.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select count(*) from public.records where tbl = 'patients') = 2, 'physiotherapist sees all patients');
select pg_temp.expect((select count(*) from public.records where patient_id = 'pa') = 5, 'physiotherapist sees all of A''s records');
insert into public.records (tbl, id, patient_id, data) values ('programs', 'pg1', 'pa', '{"patientId":"pa","status":"active"}');
select pg_temp.expect((select count(*) from public.profiles) = 3, 'physiotherapist reads the organisation''s profiles');
-- Append-only history cannot be edited, even by the physiotherapist.
do $$ begin
  update public.records set data = '{"action":"edited"}' where tbl = 'audit' and id = 'ev1';
  raise exception 'SUPABASE TEST FAILED: audit edited';
exception when insufficient_privilege then null; end $$;

-- A reads the plan but cannot change it; A can soft-delete its own pain region.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect((select count(*) from public.records where tbl = 'programs') = 1, 'patient reads the plan written for them');
update public.records set data = '{"status":"archived"}' where tbl = 'programs' and id = 'pg1';
select pg_temp.expect((select data ->> 'status' from public.records where tbl = 'programs' and id = 'pg1') = 'active', 'patient cannot change a plan');
update public.records set deleted = true where tbl = 'painRegions' and id = 'pr1';
select pg_temp.expect((select deleted from public.records where tbl = 'painRegions' and id = 'pr1'), 'patient soft-deletes own row');
select pg_temp.expect((select updated_by from public.records where tbl = 'painRegions' and id = 'pr1') = '00000000-0000-0000-0000-00000000000a', 'server records who changed a row');

-- Erasure: A deletes its account; B's data is untouched.
select pg_temp.expect(public.delete_my_data() >= 5, 'erasure removes A''s rows');
reset role;
select pg_temp.expect((select count(*) from public.records where patient_id = 'pa' or id = '00000000-0000-0000-0000-00000000000a') = 0, 'nothing of A remains');
select pg_temp.expect((select count(*) from auth.users where id = '00000000-0000-0000-0000-00000000000a') = 0, 'A''s sign-in removed');
select pg_temp.expect((select count(*) from public.records where patient_id = 'pb') = 1, 'B intact');

-- Adding an existing account to the allowlist promotes it; another organisation sees nothing.
insert into public.clinician_allowlist (email) values ('pat.b@example.test');
select pg_temp.expect((select role from public.profiles where user_id = '00000000-0000-0000-0000-00000000000b') = 'clinician', 'allowlist promotes an existing account');
insert into public.organisations (id, name) values ('00000000-0000-4000-8000-000000000002', 'Other clinic');
insert into public.clinician_allowlist (email, org_id) values ('other@example.test', '00000000-0000-4000-8000-000000000002');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d0', 'other@example.test');
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d0');
select pg_temp.expect((select count(*) from public.records) = 0, 'another clinic''s physiotherapist sees nothing');
select pg_temp.as_user('');
select pg_temp.expect((select count(*) from public.records) = 0, 'signed-out requests see nothing');
rollback;
\echo ALL SUPABASE TESTS PASSED
