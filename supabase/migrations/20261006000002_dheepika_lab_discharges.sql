-- Signed discharge summaries: written by a physiotherapist only and never edited (re-signing adds a version).
create or replace function public.dl_clinician_only(t text, d jsonb) returns boolean language sql immutable
set search_path = public as $$
  select t in ('impressions','draftDecisions','examFindings','reasoningDecisions','amendments','programs','programExercises',
               'programLibraryItems','planResumes','appointments','notes','contentItems','contentReviews','deviceMeasurements',
               'clinicians','settings','treatmentCourses','payments','expenses','discharges')
      or (t = 'reports' and d ->> 'status' = 'clinician_reviewed')
      or (t = 'testPlans' and d ->> 'source' = 'clinician')
      or (t = 'measurements' and d ->> 'category' = 'camera_estimate' and coalesce(d ->> 'reviewStatus', 'pending') <> 'pending')
$$;

create or replace function public.dl_append_only(t text) returns boolean language sql immutable
set search_path = public as $$
  select t in ('audit','planPauses','planResumes','draftDecisions','examFindings','impressions','reasoningDecisions','amendments','contentReviews','discharges')
$$;
