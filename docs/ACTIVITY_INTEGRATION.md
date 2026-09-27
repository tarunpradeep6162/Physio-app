# Phone and wearable activity (Phase 11)

**Scope:** steps and walking time only, each shared under its own consent (`activity_steps`, `activity_walking`, text version `dl-activity-consent-1.0.0`). Heart rate, sleep, workouts other than walking, and every other health record type are skipped by the parsers. They are counted in the import report but never stored. Heart rate needs a concrete clinical use and approval first.

## Sources

| Source | Status | How |
|---|---|---|
| Apple Health (HealthKit) | **File import works now**; live read needs a native iOS app | Health app → profile → *Export All Health Data* → `export.xml`. Reads `HKQuantityTypeIdentifierStepCount` records and `HKWorkoutActivityTypeWalking` workouts. |
| Android Health Connect | **Not available in the browser** — needs a native Android app | The contract is `NativeActivityBatch` in `src/integrations/activity.ts` (Health Connect `StepsRecord` / walking `ExerciseSessionRecord` shape plus the OS permission state), parsed by `parseNativeBatch`. |
| Other apps | CSV import | Header `metric,start,end,value,source`; ISO 8601 times with offset. |
| Camera sessions | **Never a step source** | A camera session sees minutes of exercise, not a day of walking. |

## Data kept per sample
Metric, value, start and end (UTC), the source's local offset (for the patient's calendar day), platform, source app, device, platform record id, import id and import time. Each import also stores a record: status (`ok`, `permission_revoked`, `consent_missing`, `error`), counts added, counts of duplicates, and types skipped.

## Rules
- **Duplicates:** the same platform record id, or the same source + interval + value, is dropped. Re-importing a file adds nothing.
- **Overlapping sources:** phone and watch are **not added together**. For each hour, the one source reporting the most is used, and the per-source totals stay visible as "sources differ".
- **Absent data:** a day with no samples shows **no data**, never 0.
- **Revoked OS permission:** the import is recorded as `permission_revoked`, no samples of that type are read, and the patient and clinician are told that later days are a gap.
- **Consent withdrawal:** data stops being collected and is no longer displayed anywhere. The patient chooses whether it is also deleted (the default). On the server, RLS hides withdrawn data and a trigger refuses new samples without consent (`db/activity.sql`, tested in `db/activity_test.sql`).
- **Write access:** only the patient can write device data. A clinician account cannot insert or edit it.

## Remaining gates
- Native iOS and Android apps with HealthKit and Health Connect permissions. This is an owner decision plus app-store review.
- Validation of step totals against a reference: counted steps vs. the phone's own summary, on real devices.
- Clinical review of whether and how activity trends are used.
