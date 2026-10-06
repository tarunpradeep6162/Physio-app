# iKinetec route study and Dheepika Lab implementation

Reviewed 6 October 2026 in the public browser at the seven URLs supplied by Tarun. The visible site states many counts and accuracy claims; those are claims by that site, not measurements or independent validation. No private clinic records, proprietary code, patient photographs, branding or assets were copied.

| iKinetec route | Visible workflow | Dheepika Lab at review | Action |
| --- | --- | --- | --- |
| Home | Clinic/demo gateway; product feature and vendor claims | Demo and server-backed sign-in, release gate, branded onboarding | Keep release gate. Do not import vendor logos, security certifications or performance claims. |
| Anatomy | Searchable 29-region atlas, 146 subzones, pathology/exercise/ROM tabs, visual model | WebGL muscle/skeleton reference, selectable symptom regions, precise knee and other regional sublocations, clinician exercise library and ROM guide | Keep anatomy as a reference atlas. Expand subzones only through original, reviewed content and actual model QA on phones. A body tap cannot identify tissue pathology. |
| Research | PubMed query and topic shortcuts; the initial request stayed in a loading state during review | NCBI E-utilities search, exact returned PMID/title/journal/year, manual attachment to a plan | Added a standalone clinician Research route using the existing search service and an anatomy explorer using the existing WebGL/2D map. Search counts are explicitly not clinical consensus; failures show no invented references. |
| Results | Four steps: findings, intelligence, protocol, session; voice report; camera prompt; symptom summary; clinical pattern | Assessment, evidence graph, draft consultation, clinician sign-off, assignment, session and PDF | Do not import “100% clinical match”, “88% likelihood”, camera-derived tissue label or rule-out language. The public route displayed a neck pattern while stating no posture captures were available. Missing measurement must stay missing. |
| Patients | Visit chart, demographics, region filter, export, directory | Patient directory, pseudonymous codes, assessment and program analytics | Keep counts based on records actually present. Do not export broad patient identifiers by default. |
| CRM | Revenue, dues, expenses, profit, directory, appointments and doctors | Billing ledger, expenses, treatments, attendance, schedule and analytics | Existing back-office data has real provenance. No speculative clinic-wide aggregate or automatic claim of warehouse sync. |
| Schedules | Month grid, day agenda, doctor filter, booking and staff management | Month calendar, appointments, clinician assignment, attendance and conflict check | Existing flow covers the core workflow. Validate timezone, mobile interaction and real clinic roles before use. |

## Implemented in this pass

- Added /c/research to the clinician navigation and mobile More menu.
- Search uses the existing PubMed E-utilities parser and shows only returned records.
- Added /c/anatomy with searchable mapped body locations, a 3D/2D selector, location selection and links to the library, ROM guide and research. The map is an anatomical reference, not a tissue diagnosis.
- Each result displays its original title, journal, year, PMID, optional DOI, retrieval date and source link.
- Search terms are entered manually; no patient details are sent by the route. Search results are not attached to records until a clinician uses the plan builder.

## Outstanding work

1. Test camera and 3D map on real target phones with consenting volunteers; publish performance and agreement only from a prespecified study.
2. Build a clinician-assisted capture mode with operator identity, timestamp, setup quality and per-view review.
3. Expand clinician-reviewed subzones and region protocols without copying iKinetec's proprietary descriptions.
4. Add verified literature appraisal fields (population, intervention, comparator, outcomes, relevance decision) to the plan evidence record, then require clinician review.
5. Verify production deployment and backend access rules after changes. The presence of a live server does not confer clinical approval.

## Source limitations

Only public, visible route content was inspected. The research page's default query remained “Querying PubMed...” during observation, so no individual study result was treated as verified. iKinetec's actual backend architecture, source code, model accuracy, certifications and clinical evidence were not available from these pages.
