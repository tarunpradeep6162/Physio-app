# PhysioAi screenshot review for Dheepika Lab

Reviewed 30 September 2026 from the ten user-supplied photos. The pictured site appears to be `kinetecai.netlify.app`. These are visual references, not source code or evidence that the displayed clinical claims are valid. The site's full live flow and its GitHub repository were not available to inspect; no unrelated public repository with a similar name is assumed to be its source.

| Image | Visible workflow | Dheepika Lab now | Follow-up |
| --- | --- | --- | --- |
| 01 | Findings page: named neck pattern, camera measurements, supporting and contradicting statements | Versioned capture findings, quality status, evidence links, clinician review and reports exist; neck is within the spine pathway | Add neck-specific, clinician-authored protocols only after real-device/reference validation. Never display a diagnostic likelihood or a camera-only tissue label. |
| 02 | Four-stage findings → intelligence → protocol → session, with three source cards | Assessment → draft → clinician sign-off → assigned program → session exists, with separate evidence categories | Improve the visual handoff summary, showing source, freshness, limitations and clinician action in one compact view. A clinic cohort card needs an actual permissioned dataset. |
| 03 | PubMed citations and a narrative evidence synthesis | Draft consultation and evidence trail exist; external literature retrieval is not live | Build a reviewed literature registry with PMID/DOI, publication date, population, intervention, outcome, applicability and retrieval time. Do not synthesize consensus from search counts. |
| 04 | Symptom and self-selected diagnosis chips; optional scan | Regional symptom map, pain character, adaptive intake, safety questions and optional camera tests exist | Preserve symptom input; avoid patient-selected diagnoses. Expand region-specific questions through clinician-approved content. |
| 05 | Therapist manual and automated scan modes; frontal grid, plumb line and angles | Static posture scan and guided camera protocols exist with landmark visibility and setup checks | Add a distinct clinician-assisted capture workflow with authenticated operator attribution, consent, camera placement and quality trace; a phone obscuring landmarks must fail the relevant measurement. |
| 06 | Four camera tiles | Individual front/side/back captures and replay exist | A multi-view review grid can compare separately acquired, timestamped valid captures. Do not imply simultaneous calibrated cameras from one feed. |
| 07 | Zoomable anatomical overlay cards | Skeleton replay, source and capture metrics exist | Add annotated review zoom only on recorded landmarks or consented video; anatomical illustration must be labeled as reference and never presented as an X-ray. |
| 08 | Clinic login and vendor/research logos | Demo-only local sign-in; real-patient access is gated off | Server-side identity, tenancy, RBAC, audit and retention are prerequisites. Do not copy third-party logos or claim integrations without contracts and a working implementation. |
| 09 | Patient directory, visit chart and demographic breakdown | Patient directory, filters, program/adherence/alert data and aggregate analytics exist | Improve responsive search and trend drill-down; avoid displaying phone numbers broadly. Population breakdowns need meaningful denominators and privacy review. |
| 10 | Muscular 3D body with selectable regions and hip sublocations | WebGL anatomical model, tappable mapped regions, 2D fallback and region-specific sublocations exist | Test touch selection/zoom/rotation on target phones; verify model asset availability and accessible fallback. |

## Clinical representation rules

- A camera angle is a camera estimate with capture view, confidence, algorithm version, quality verdict and limitations. It does not identify a cause of pain.
- Negative answers do not *rule out* serious conditions. A safety concern triggers escalation or further examination; unknown remains unknown.
- Do not show `100% Clinical Match`, `88% likelihood`, `140 similar cases`, `high consensus` or `RCT/CPG` badges without a validated model, documented denominator, lawful cohort access and verified literature. No such substantiation was supplied with these photos.
- Clinician approval stays a distinct signed step. Patient assignments must trace to the approved plan/version. Simulated data stays conspicuously simulated.
- The photographed patient name, contact details and face are not copied into this repository or its demo seed.

## Implementation order

1. Verify the existing live Dheepika Lab deployment against the local repo commit and document any drift.
2. Test camera and WebGL interaction on actual target phones, including occlusion, lighting, side view, orientation, performance and accessibility. Fix observed failures before making accuracy claims.
3. Build clinician-assisted capture and a compact multi-view quality review. Retain per-view source and timing; withhold failed measures.
4. Add a curated literature registry and citations in the clinician draft. A human reviewer decides applicability; absent sources render as missing, not consensus.
5. Add secure clinic tenancy and records before any real patient information is entered. Keep the current real-patient release gate closed until authorization and validation.

## Access and provenance

The Dheepika Lab checkout is this repository (`tarunpradeep6162/Physio-app`). The screenshot site appears separate. A browser attempt to open the pictured Netlify site was automatically blocked when it tried to reach the Netlify management origin, which could expose account/project content. Search did not identify a verified public repository for that site. Its internals, full route inventory and backend therefore remain unverified; the table records only what the supplied photos show and what was inspected in this codebase.
