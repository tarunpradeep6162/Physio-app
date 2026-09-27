# Incident process (Phase 20) — PROPOSAL for the owner and the clinical lead

Applies to any real-patient pilot. It is not yet agreed or staffed; that is a release-gate item.

## What counts as an incident
1. **Clinical safety:** a patient harmed or put at risk while using the app. Examples: a red-flag answer that was not routed, an exercise continued despite the pain rule, a wrong number shown and acted on.
2. **Measurement:** a value that should have been refused was shown, for example a hidden joint that still produced a number, or a trend compared incomparable captures.
3. **Privacy / security:** data seen by the wrong person, data not erased on request, data sent off the device or server unexpectedly.
4. **Availability:** the app unusable for a patient mid-programme.

## Steps
| Step | Who | When |
|---|---|---|
| Make safe: advise the patient (contact the clinic or urgent care), pause the plan (clinicians can resume later), and suspend the affected protocol or feature if needed | Clinician on duty | Immediately |
| Record: patient-safe summary, build hash (Settings → Incidents shows the build), protocol and algorithm versions, the redacted incident log export, and the capture replay if relevant. **No raw video** | Clinician | Same day |
| Notify: clinical lead (Dheepika) and the owner | Clinician | Same day; within 1 hour for a clinical-safety incident |
| Assess severity and whether regulators or data-protection authorities must be notified under the launch jurisdiction's rules | Clinical lead + owner (+ advisers) | Within the legal deadline |
| Fix: write a failing test first, then fix. A protocol or algorithm change gets a new version, and previous results stay interpretable | Engineering | Priority by severity |
| Close: document root cause and fix, update the risk list and approval packet, tell the patient where appropriate | Clinical lead | After the fix is verified |

## Tools that already exist
- Plan pause (patient or pain rule) and clinician-only resume.
- Safety holds from the questionnaires.
- Exception queue.
- Append-only audit trail and decision history.
- Redacted, device-local incident log with export.
- Versioned protocols and results.
- Report reverts to preliminary when its data changes.
- Linkage-based data export and erasure.
