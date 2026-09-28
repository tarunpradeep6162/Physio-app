-- Dheepika Lab — Supabase backend (shared records across devices).
--
-- Model: every app record (assessment, capture, plan, session, …) is stored as one row of
-- `public.records` (table name + id + JSON data), tagged with its organisation and — when it
-- belongs to a patient — the patient's record id. Row-level security decides who may read and
-- write each row:
--   • a PHYSIOTHERAPIST (role 'clinician') reads and writes every record of their organisation,
--     i.e. sees all patients' data, from any device;
--   • a PATIENT reads and writes only their own records, can never write clinician-only records
--     (plans, impressions, reports marked reviewed, …) and can never change append-only history;
--   • nobody can make themselves a physiotherapist: the role comes only from the owner-managed
--     `clinician_allowlist`, which no app user can read or write.
-- The richer normalised schema in db/*.sql remains the long-term target (docs/SUPABASE_SETUP.md).

-- ---------------------------------------------------------------------------------------------
-- Organisations, clinician allowlist, profiles
-- ---------------------------------------------------------------------------------------------
create table if not exists public.organisations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
insert into public.organisations (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Dheepika Lab')
on conflict (id) do nothing;

-- Owner-managed (Supabase dashboard / SQL editor only). Emails listed here become physiotherapists
-- when they sign up (or immediately, if they already have an account — see the trigger below).
create table if not exists public.clinician_allowlist (
  email    text primary key check (email = lower(email)),
  org_id   uuid not null references public.organisations(id) default '00000000-0000-4000-8000-000000000001',
  added_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('patient', 'clinician')),
  org_id       uuid not null references public.organisations(id),
  display_name text,
  created_at   timestamptz not null default now()
);

-- New auth user → profile. Clinician only when the (lower-cased) email is on the allowlist.
create or replace function public.dl_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.clinician_allowlist;
begin
  select * into a from public.clinician_allowlist where email = lower(new.email);
  insert into public.profiles (user_id, role, org_id, display_name)
  values (new.id,
          case when a.email is not null then 'clinician' else 'patient' end,
          coalesce(a.org_id, '00000000-0000-4000-8000-000000000001'),
          nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists dl_on_auth_user_created on auth.users;
create trigger dl_on_auth_user_created after insert on auth.users
  for each row execute function public.dl_handle_new_user();

-- Adding an email to the allowlist later promotes an existing account.
create or replace function public.dl_apply_allowlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p set role = 'clinician', org_id = new.org_id
  from auth.users u where u.id = p.user_id and lower(u.email) = new.email;
  return new;
end $$;
drop trigger if exists dl_on_allowlist_insert on public.clinician_allowlist;
create trigger dl_on_allowlist_insert after insert on public.clinician_allowlist
  for each row execute function public.dl_apply_allowlist();

-- ---------------------------------------------------------------------------------------------
-- Helpers (security definer: they read profiles/records regardless of the caller's RLS)
-- ---------------------------------------------------------------------------------------------
create or replace function public.dl_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where user_id = auth.uid()
$$;
create or replace function public.dl_org() returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------------------------
-- Records
-- ---------------------------------------------------------------------------------------------
create table if not exists public.records (
  tbl        text not null check (tbl ~ '^[a-zA-Z]+$'),
  id         text not null check (length(id) between 1 and 200),
  org_id     uuid not null default public.dl_org() references public.organisations(id),
  patient_id text,
  data       jsonb not null,
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (tbl, id)
);
create index if not exists records_org_updated on public.records (org_id, updated_at);
create index if not exists records_patient on public.records (patient_id);

-- The patient record ids that belong to the signed-in user.
create or replace function public.dl_my_patient_ids() returns setof text language sql stable security definer set search_path = public as $$
  select id from public.records
  where tbl = 'patients' and not deleted and data ->> 'userId' = auth.uid()::text
$$;

-- Tables only a physiotherapist may write (patients may still read their own rows).
create or replace function public.dl_clinician_only(t text, d jsonb) returns boolean language sql immutable as $$
  select t in ('impressions','draftDecisions','examFindings','reasoningDecisions','amendments','programs','programExercises',
               'programLibraryItems','planResumes','appointments','notes','contentItems','contentReviews','deviceMeasurements',
               'clinicians','settings')
      or (t = 'reports' and d ->> 'status' = 'clinician_reviewed')
      or (t = 'testPlans' and d ->> 'source' = 'clinician')
      or (t = 'measurements' and d ->> 'category' = 'camera_estimate' and coalesce(d ->> 'reviewStatus', 'pending') <> 'pending')
$$;

-- History that is never edited or deleted once written.
create or replace function public.dl_append_only(t text) returns boolean language sql immutable as $$
  select t in ('audit','planPauses','planResumes','draftDecisions','examFindings','impressions','reasoningDecisions','amendments','contentReviews')
$$;

-- Server-controlled columns: timestamp, author, organisation.
create or replace function public.dl_records_stamp() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then new.org_id := old.org_id; end if;
  return new;
end $$;
drop trigger if exists dl_records_stamp on public.records;
create trigger dl_records_stamp before insert or update on public.records for each row execute function public.dl_records_stamp();

-- Append-only history cannot be changed, even by a physiotherapist.
create or replace function public.dl_records_guard() returns trigger language plpgsql as $$
begin
  if public.dl_append_only(old.tbl) then
    raise exception '% is append-only history', old.tbl using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists dl_records_guard on public.records;
create trigger dl_records_guard before update or delete on public.records for each row execute function public.dl_records_guard();

alter table public.records enable row level security;
alter table public.profiles enable row level security;
alter table public.organisations enable row level security;
alter table public.clinician_allowlist enable row level security;   -- no policies: invisible to app users

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated using (
  org_id = public.dl_org() and (
    public.dl_role() = 'clinician'
    or patient_id in (select public.dl_my_patient_ids())
    or (tbl = 'patients' and data ->> 'userId' = auth.uid()::text)
    or (tbl = 'users' and id = auth.uid()::text)
    or tbl in ('clinicians', 'settings', 'contentItems')
  )
);

drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated with check (
  org_id = public.dl_org() and (
    public.dl_role() = 'clinician'
    or (
      not public.dl_clinician_only(tbl, data)
      and (
        (tbl = 'patients' and patient_id = id and data ->> 'userId' = auth.uid()::text)
        or (tbl = 'users' and id = auth.uid()::text and coalesce(data ->> 'role', 'patient') = 'patient')
        or (tbl not in ('patients', 'users') and patient_id in (select public.dl_my_patient_ids()))
      )
    )
  )
);

drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (
    org_id = public.dl_org() and (
      public.dl_role() = 'clinician'
      or (not public.dl_clinician_only(tbl, data) and (
        patient_id in (select public.dl_my_patient_ids())
        or (tbl = 'users' and id = auth.uid()::text)))
    )
  )
  with check (
    org_id = public.dl_org() and (
      public.dl_role() = 'clinician'
      or (not public.dl_clinician_only(tbl, data) and (
        (tbl = 'patients' and patient_id = id and data ->> 'userId' = auth.uid()::text)
        or (tbl = 'users' and id = auth.uid()::text and coalesce(data ->> 'role', 'patient') = 'patient')
        or (tbl not in ('patients', 'users') and patient_id in (select public.dl_my_patient_ids()))))
    )
  );
-- No DELETE policy: removal is a soft delete (deleted = true) so every device learns about it.

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (
  user_id = auth.uid() or (public.dl_role() = 'clinician' and org_id = public.dl_org())
);
-- Profiles are never written by app users (role and organisation are server-controlled).

drop policy if exists organisations_read on public.organisations;
create policy organisations_read on public.organisations for select to authenticated using (id = public.dl_org());

grant select, insert, update on public.records to authenticated;
grant select on public.profiles, public.organisations to authenticated;
revoke all on public.clinician_allowlist from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Erasure: a patient deletes their own account and every record linked to it.
-- ---------------------------------------------------------------------------------------------
create or replace function public.delete_my_data() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; pids text[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.dl_role() = 'clinician' then raise exception 'physiotherapist accounts are removed by the clinic owner'; end if;
  select array_agg(id) into pids from public.dl_my_patient_ids() as id;
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
