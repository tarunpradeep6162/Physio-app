-- Phases 47–52 record types.
--   goals              patient or physiotherapist (the goal is in the patient's words)
--   goalRatings        the patient's own progress ratings; append-only
--   notes              now append-only: a correction is a new note that "amends" the old one
--   outcomeInstruments organisation-level questionnaire registry; physiotherapist only
--   letters            physiotherapist only; a signed letter can no longer be changed
--   challengeClips     organisation-level volunteer research clips (landmarks only); physiotherapist
--                      only; a clip locked into a challenge set can no longer be changed
create or replace function public.dl_clinician_only(t text, d jsonb) returns boolean language sql immutable
set search_path = public as $$
  select t in ('impressions','draftDecisions','examFindings','reasoningDecisions','amendments','programs','programExercises',
               'programLibraryItems','planResumes','appointments','notes','contentItems','contentReviews','deviceMeasurements',
               'clinicians','settings','treatmentCourses','payments','expenses','discharges',
               'outcomeInstruments','letters','challengeClips')
      or (t = 'reports' and d ->> 'status' = 'clinician_reviewed')
      or (t = 'testPlans' and d ->> 'source' = 'clinician')
      or (t = 'measurements' and d ->> 'category' = 'camera_estimate' and coalesce(d ->> 'reviewStatus', 'pending') <> 'pending')
$$;

create or replace function public.dl_append_only(t text) returns boolean language sql immutable
set search_path = public as $$
  select t in ('audit','planPauses','planResumes','draftDecisions','examFindings','impressions','reasoningDecisions','amendments',
               'contentReviews','discharges','goalRatings','notes')
$$;

create or replace function public.dl_records_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if public.dl_append_only(old.tbl) then
    raise exception '% is append-only history', old.tbl using errcode = 'insufficient_privilege';
  end if;
  if old.tbl = 'letters' and old.data ->> 'status' = 'signed' then
    raise exception 'a signed letter cannot be changed; write a new version' using errcode = 'insufficient_privilege';
  end if;
  if old.tbl = 'challengeClips' and old.data ->> 'lockedInSet' is not null then
    raise exception 'a clip in a locked challenge set cannot be changed' using errcode = 'insufficient_privilege';
  end if;
  return coalesce(new, old);
end $$;
