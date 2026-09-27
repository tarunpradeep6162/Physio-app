# Server data boundary for real patient use (Phase 18)

**Status:** the database layer is implemented and tested (`db/schema.sql` + `db/security.sql`, verified by `db/security_test.sql` on PostgreSQL 16). **No server is deployed.** The live app still stores everything in the browser, so it is not suitable for real patients. Sign-up now requires every new account to acknowledge that.

Provisioning a hosted database and an identity provider creates accounts, billing and data-processing obligations. The clinic owner must choose and authorise these. They were deliberately not created on your behalf.

## Target architecture

```
Phone / browser (this app)                     Server (to deploy)                         Storage
─────────────────────────                      ──────────────────                         ───────
camera → on-device pose (worker)               /api  (Vercel Functions or similar)        PostgreSQL 16 (managed,
landmarks, metrics, provenance    ──HTTPS──▶   • OIDC session → users.id                   encrypted at rest, PITR)
never video                                    • per request:                              • schema.sql
                                                 SET ROLE pv_app;                          • security.sql (RLS, consent,
                                                 SET LOCAL app.user_id = <id>                audit chain, retention,
                                               • no business logic bypasses RLS            report tokens)
                                               • scheduled: purge_expired_landmarks()     Object store (images only
                                               • report links: issue/redeem tokens          with image_storage consent)
```

| Requirement (brief) | Where it is enforced | Tested |
|---|---|---|
| Authenticated roles | OIDC at the API; `users.idp_subject` is the only identity; no password hashes stored. Every request runs as `pv_app` (no BYPASSRLS, not an owner). | — (needs a deployed API) |
| Care-relationship access | Row-level security, **forced**, on all patient-scoped tables (26). A patient sees only their own records. A clinician sees a patient only while an **active** care relationship exists. Anonymous requests see nothing. | ✓ patient isolation; clinician with vs without care; ended relationship; anonymous |
| Who may write | Clinicians in care write clinical rows. Patients may insert only their own intake, safety answers, outcomes and sessions. | ✓ a patient cannot insert a camera measurement. This test **found** that the original sketch policy (FOR ALL without WITH CHECK) allowed it; fixed. |
| Consent | Trigger: no capture or scan without current `camera_processing` + `data_storage` consent; no still image without `image_storage`. Consent history is append-only; "current" is the last row by sequence. | ✓ blocked without consent, allowed with it, blocked again after withdrawal. The test **found** that two consent changes in one transaction tied on `now()`; fixed. |
| Audit history | Trigger-written audit row for every change to patient data, with the acting user. Append-only (UPDATE/DELETE refused). SHA-256 hash chain with `audit_verify()`. | ✓ insert audited with the actor; update refused; tampering that bypasses triggers is **detected** |
| Retention / deletion | `retention_policies.landmark_days`; `purge_expired_landmarks()` removes landmark streams and keyframes but keeps metrics, quality and audit. Raw video is constrained to `never_stored`. | ✓ purge after 90 days, record kept, purge audited |
| Protected reports | `issue_report_token()`: only for **clinician-reviewed** reports the caller may see, random 256-bit token, **only its hash stored**, expiry ≤ 7 days, single use, audited. No public report URLs. | ✓ preliminary refused, hash-only storage, single use, unknown token rejected |
| Encryption | TLS in transit; managed-database encryption at rest with provider-managed keys; backups encrypted. Column-level encryption is not added: RLS plus minimal identifiers is the design. Phone and DOB are optional fields. | provider setting |
| Migration of browser data | Settings → Data boundary → **Export for server migration**. Explicit, one-way, SHA-256 checksummed bundle. Demo rows, local password hashes and stored images are excluded by default. | ✓ unit test (`src/data/migration.test.ts`) |

Schema fixes found while doing this:
- `measurements.unit` did not allow `s`, `pct_leg` or `count`, all of which the knee protocols store.
- `measurements.reference` and `patients.validation_split` were added for the validation study.

## Still to build before real patients (in order)

1. Choose and provision: a managed PostgreSQL in the chosen jurisdiction, and an OIDC provider with MFA for clinicians. Record the data-processing agreements.
2. API layer: session handling, `SET LOCAL` per request, endpoints mirroring `src/data/store.ts` operations, and rate limiting. Replace the local repository behind the same `insert/update/remove` seam.
3. Server-side import of migration bundles (verify the checksum; map ids; stamp provenance), run with the clinic's consent.
4. Scheduled jobs: retention purge, and a nightly `audit_verify()` alert.
5. Privacy, security and jurisdictional regulatory review (see `docs/SAFETY.md`). Then a pen-test of the deployed API.
