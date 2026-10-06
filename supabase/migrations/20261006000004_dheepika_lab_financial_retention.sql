-- Optional retention of financial rows on erasure (clinic setting retainFinancialOnErasure, default
-- off). When on, the patient's payments and treatment courses are kept with the patient link,
-- course name and notes removed; everything else of the patient is deleted as before.
create or replace function public.delete_my_data() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; pids text[]; keep boolean;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if private.dl_role() = 'clinician' then raise exception 'physiotherapist accounts are removed by the clinic owner'; end if;
  select array_agg(id) into pids from private.dl_my_patient_ids() as id;
  select coalesce((data ->> 'retainFinancialOnErasure')::boolean, false) into keep
    from public.records where tbl = 'settings' and id = 'clinic' and not deleted and org_id = private.dl_org();
  alter table public.records disable trigger dl_records_guard;
  if coalesce(keep, false) then
    update public.records set patient_id = null, data = jsonb_strip_nulls(case tbl
      when 'treatmentCourses' then jsonb_build_object('id', id, 'patientId', 'erased', 'title', 'Treatment course', 'plannedSessions', data -> 'plannedSessions',
        'feePaise', data -> 'feePaise', 'startDate', data -> 'startDate', 'status', data -> 'status', 'createdBy', data -> 'createdBy', 'createdAt', data -> 'createdAt')
      else jsonb_build_object('id', id, 'patientId', 'erased', 'courseId', data -> 'courseId', 'amountPaise', data -> 'amountPaise', 'method', data -> 'method',
        'date', data -> 'date', 'reference', data -> 'reference', 'createdBy', data -> 'createdBy', 'createdAt', data -> 'createdAt') end)
    where tbl in ('payments', 'treatmentCourses') and patient_id = any(coalesce(pids, '{}'));
  end if;
  delete from public.records where patient_id = any(coalesce(pids, '{}')) or (tbl = 'users' and id = auth.uid()::text)
    or (tbl = 'patients' and data ->> 'userId' = auth.uid()::text);
  get diagnostics n = row_count;
  alter table public.records enable trigger dl_records_guard;
  delete from auth.users where id = auth.uid();
  return n;
end $$;
revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;
