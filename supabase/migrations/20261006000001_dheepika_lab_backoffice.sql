-- Clinic back office (Oct 2026): treatment courses, payments and expenses are written by a
-- physiotherapist only. Patients may still read their own courses and payments (they carry
-- patient_id); expenses have no patient and are visible to the clinic only.
create or replace function public.dl_clinician_only(t text, d jsonb) returns boolean language sql immutable
set search_path = public as $$
  select t in ('impressions','draftDecisions','examFindings','reasoningDecisions','amendments','programs','programExercises',
               'programLibraryItems','planResumes','appointments','notes','contentItems','contentReviews','deviceMeasurements',
               'clinicians','settings','treatmentCourses','payments','expenses')
      or (t = 'reports' and d ->> 'status' = 'clinician_reviewed')
      or (t = 'testPlans' and d ->> 'source' = 'clinician')
      or (t = 'measurements' and d ->> 'category' = 'camera_estimate' and coalesce(d ->> 'reviewStatus', 'pending') <> 'pending')
$$;
