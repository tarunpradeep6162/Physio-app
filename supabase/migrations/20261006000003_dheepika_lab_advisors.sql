-- Security and performance advisor fixes (Oct 2026).
-- 1. The row-level-security helpers move to a private schema that the REST API does not expose,
--    so they can no longer be called as /rest/v1/rpc/... endpoints. Policies still use them.
-- 2. auth.uid() and the helpers are wrapped in (select ...) so Postgres evaluates them once per
--    query instead of once per row.
-- 3. Covering indexes for the org_id foreign keys; an explicit no-access policy on the allowlist
--    (it was already invisible to app users; this states it).

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.dl_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = (select auth.uid())
$$;
create or replace function private.dl_org() returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where user_id = (select auth.uid())
$$;
create or replace function private.dl_my_patient_ids() returns setof text language sql stable security definer set search_path = public as $$
  select id from public.records
  where tbl = 'patients' and not deleted and data ->> 'userId' = (select auth.uid())::text
$$;
revoke all on function private.dl_role(), private.dl_org(), private.dl_my_patient_ids() from public, anon;
grant execute on function private.dl_role(), private.dl_org(), private.dl_my_patient_ids() to authenticated;

alter table public.records alter column org_id set default private.dl_org();

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated using (
  org_id = (select private.dl_org()) and (
    (select private.dl_role()) = 'clinician'
    or patient_id in (select private.dl_my_patient_ids())
    or (tbl = 'patients' and data ->> 'userId' = (select auth.uid())::text)
    or (tbl = 'users' and id = (select auth.uid())::text)
    or tbl in ('clinicians', 'settings', 'contentItems')
  )
);

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated with check (
  org_id = (select private.dl_org()) and (
    (select private.dl_role()) = 'clinician'
    or (
      not public.dl_clinician_only(tbl, data)
      and (
        (tbl = 'patients' and patient_id = id and data ->> 'userId' = (select auth.uid())::text)
        or (tbl = 'users' and id = (select auth.uid())::text and coalesce(data ->> 'role', 'patient') = 'patient')
        or (tbl not in ('patients', 'users') and patient_id in (select private.dl_my_patient_ids()))
      )
    )
  )
);

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    org_id = (select private.dl_org()) and (
      (select private.dl_role()) = 'clinician'
      or (not public.dl_clinician_only(tbl, data) and (
        patient_id in (select private.dl_my_patient_ids())
        or (tbl = 'users' and id = (select auth.uid())::text)))
    )
  )
  with check (
    org_id = (select private.dl_org()) and (
      (select private.dl_role()) = 'clinician'
      or (not public.dl_clinician_only(tbl, data) and (
        (tbl = 'patients' and patient_id = id and data ->> 'userId' = (select auth.uid())::text)
        or (tbl = 'users' and id = (select auth.uid())::text and coalesce(data ->> 'role', 'patient') = 'patient')
        or (tbl not in ('patients', 'users') and patient_id in (select private.dl_my_patient_ids()))))
    )
  );

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  user_id = (select auth.uid()) or ((select private.dl_role()) = 'clinician' and org_id = (select private.dl_org()))
);

drop policy if exists organisations_read on public.organisations;
create policy organisations_read on public.organisations for select to authenticated using (id = (select private.dl_org()));

drop policy if exists allowlist_no_app_access on public.clinician_allowlist;
create policy allowlist_no_app_access on public.clinician_allowlist for all to anon, authenticated using (false) with check (false);

create index if not exists clinician_allowlist_org_id_idx on public.clinician_allowlist (org_id);
create index if not exists profiles_org_id_idx on public.profiles (org_id);

-- Erasure keeps its behaviour; it now uses the private helpers.
create or replace function public.delete_my_data() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; pids text[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if private.dl_role() = 'clinician' then raise exception 'physiotherapist accounts are removed by the clinic owner'; end if;
  select array_agg(id) into pids from private.dl_my_patient_ids() as id;
  -- Bypass the append-only guard for erasure only (this function is the single exception).
  alter table public.records disable trigger dl_records_guard;
  delete from public.records where patient_id = any(coalesce(pids, '{}')) or (tbl = 'users' and id = auth.uid()::text)
    or (tbl = 'patients' and data ->> 'userId' = auth.uid()::text);
  get diagnostics n = row_count;
  alter table public.records enable trigger dl_records_guard;
  delete from auth.users where id = auth.uid();
  return n;
end $$;
revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

-- The public copies are no longer referenced by any policy or function: nobody may call them.
revoke all on function public.dl_role(), public.dl_org(), public.dl_my_patient_ids() from public, anon, authenticated;
