-- Minimal stand-in for Supabase's auth schema and roles, so the Supabase migration can be tested on a
-- plain local PostgreSQL 16 (scripts/db-check.sh). NOT used in production: Supabase provides these.
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
