-- Dheepika Lab — hardening after the Supabase security advisor (29 Sep 2026).
--  • pin search_path on every function (no search_path hijacking);
--  • trigger functions cannot be called through the API (triggers still fire);
--  • the RLS helper functions are callable only by signed-in users (policies need them);
--  • the anonymous role gets no table privileges at all.
-- Intentional and left as is: delete_my_data() is callable by signed-in users (a patient erases
-- their own account), and clinician_allowlist has RLS with no policies (invisible to app users).

alter function public.dl_append_only(text) set search_path = public;
alter function public.dl_clinician_only(text, jsonb) set search_path = public;
alter function public.dl_records_stamp() set search_path = public;
alter function public.dl_records_guard() set search_path = public;

revoke execute on function public.dl_handle_new_user() from public, anon, authenticated;
revoke execute on function public.dl_apply_allowlist() from public, anon, authenticated;
revoke execute on function public.dl_records_stamp() from public, anon, authenticated;
revoke execute on function public.dl_records_guard() from public, anon, authenticated;

revoke execute on function public.dl_role() from public, anon;
revoke execute on function public.dl_org() from public, anon;
revoke execute on function public.dl_my_patient_ids() from public, anon;
grant execute on function public.dl_role(), public.dl_org(), public.dl_my_patient_ids() to authenticated;

revoke all on public.records, public.profiles, public.organisations, public.clinician_allowlist from anon;
