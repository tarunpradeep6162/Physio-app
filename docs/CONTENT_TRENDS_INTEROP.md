# Content system, clinician trends, reference measurements and interoperability (Phases 16–18)

## Phase 16 — exercise content system (`src/content/`)
- **Schema** `dl-content-1.0.0`, designed for 2,000+ records. Each record has:
  - id + semantic version, title, summary, instruction steps;
  - goals, regions, position, equipment, difficulty 1–5, accessibility tags and alternatives (by id, with a reason);
  - patient precautions and clinician-only notes;
  - default dosage;
  - media, each with rights owner, licence, expiry and alt text;
  - review owner, status, reviewer and date;
  - camera status;
  - source (authored / imported / template) and locale.
- **Two separate statuses:**
  - *Content review:* imported_unreviewed → draft → in_review → approved (published) → retired. Every transition goes into the append-only `contentReviews` trail.
  - *Camera:* not camera-guided, or camera-guided. Camera-guided requires an existing per-exercise camera definition at the current version plus QA evidence. The label states the QA level: "synthetic tests only", "tested on devices" or "validated".
- **Publication:** patients see and clinicians prescribe only the latest *approved* version, and approval needs a complete item.
  - Editing an approved item creates a new draft version; the approved one stays live until the new one is approved.
  - Imports are forced to unreviewed and not camera-guided, whatever the file claims.
- **Starter content:** 16 items, **all drafts awaiting clinical review** (approval on hold), with no media.
  - 4 are the camera-guided subset (knee bend, straight-leg raise, arm raise forward and sideways), labelled "synthetic tests only".
  - No bulk content was generated. The 2,000+ design is shown by a test that indexes and filters 2,500 generated records (kept in the test only): under 500 ms to index and under 50 ms to filter.
- **Prescribing:** approved library items can be added to a plan version with their own dosage. They are part of the version diff, and a dosage increase counts as intensification. The patient sees instructions and precautions of that exact version and reports completion in the session (patient-reported).

## Phase 17 — clinician intelligence (`src/clinical/trends.ts`)
- **Trends:** per metric and side, the absolute value at each assessment, with protocol@version, algorithm, view and source (simulated flagged).
  - A change is shown only between comparable neighbours.
  - The trend **breaks**, with the reason, on an invalid or missing capture, a protocol or algorithm change, a view change, a setup mismatch (below 80% of setup checks matching) or an unrecorded setup.
- **Other trends:** patient-reported pain (by source), weekly adherence, and weekly median steps (only with consent, and only with at least 4 days of data).
- **Exception queue** on the clinician overview: pain rise, low adherence, no contact, a comparable camera decrease, repeated invalid captures, activity drop.
  - Each item lists the evidence with its source.
  - Thresholds are **operational defaults** that show as "unreviewed" until a clinician reviews them in Settings (name and date recorded). Changing a threshold clears the review.
  - Clinic settings can only be changed by a clinician (store guard).

## Phase 18 — reference measurements and interoperability (`src/interop/`)
- **Device measurements:** grip and hand-held dynamometers, isokinetic, force plate, balance platform, goniometer, inclinometer, stopwatch.
  - Each keeps value + unit (validated per device type, never converted), trials and summary, measurement time with its original offset, manufacturer, model, serial, calibration state (in date / expired / unknown, from the last calibration date) and source (clinician entry, or file + row + import time).
  - Clinician-only writes.
  - Shown as "device strength/force", separately from camera kinematics, in the patient record, the report (Findings → "Device-measured … not camera estimates") and the export. Adding one sends the related report back to preliminary.
- **CSV import:** rows with a wrong unit for the device, no time-zone offset, missing device identity or an implausible value are listed and not imported.
- **FHIR R4 export** (`dl-fhir-export-1.0.0`): a collection Bundle of Patient, Observations, Device and ClinicalImpression.
  - Camera values are `preliminary`, with protocol, algorithm, view and quality extensions and the method text "kinematics only; not strength or force"; invalid captures use `dataAbsentReason` instead of a number.
  - Device values are `final`, referencing a Device, with calibration and import extensions and trials as components.
  - Pain uses LOINC 72514-3 and steps LOINC 55423-8; other measures use this product's own code system. No other external codes are claimed.
  - AI drafts are never exported; simulated data is tagged.
  - `checkBundle` blocks a structurally broken export.
  - **Not yet validated against a FHIR server or a receiving care system.**

## Remaining gates
- Clinical review of all content (on hold).
- Licensed media.
- Tamil content.
- Real device QA for the camera-guided subset.
- Review of the exception thresholds.
- Vendor-specific dynamometer formats: none claimed, only the documented CSV.
- Conformance testing of the FHIR export with the target care system.
