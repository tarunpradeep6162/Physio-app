# Clinic server (Supabase): shared records across devices

**Why:** without a server, every browser keeps its own records, so the physiotherapist cannot see what a patient did on their phone. With a Supabase project connected, every account's records go to the clinic's database:

| Account | Sees | Can write |
|---|---|---|
| **Physiotherapist** (email on the owner's allowlist) | **every patient of the clinic** (all devices) | everything in the clinic, except that append-only history can never be edited |
| **Patient** (everyone else) | only their own records | only their own records. Never plans, impressions, reviewed reports, clinic settings or other clinician-only records |
| Demo sessions | demonstration data only (never sent to the server) | local only |

**Status (30 Sep 2026):** project `dheepika-lab` (free plan, region ap-south-1 Mumbai) is created. Both migrations are applied: the sync schema and the security-advisor hardening. The access rules were verified on the live database with throwaway users in a rolled-back transaction:
- allowlist → physiotherapist;
- patients isolated from each other;
- no self-promotion, no plan writes by patients, no history edits and no hard deletes;
- anonymous access blocked;
- the physiotherapist sees every patient and writes plans that the patient can read.

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (the publishable key) are set in Vercel. **Still to do by the owner:**
- ~~add the physiotherapist email(s) to the allowlist (step 3)~~ — done 30 Sep 2026: the owner's own account is the physiotherapist account; add further physiotherapists the same way;
- **set the Site URL and redirect URLs (step 4)** — still the default `http://localhost:3000`, so confirmation and password-reset links open localhost. The account is confirmed before that redirect, so signing in at the site works, but the setting must be fixed. It cannot be set through the connector.

Without the environment variables the app stays in **local mode** (browser-only).

> **Not approved for real patients yet.** A server makes cross-device care possible. It does not replace clinical approval (on hold), patient consent, a data-processing agreement with Supabase, or the validation studies. Use test accounts only until those are in place.

## How it works

- `supabase/migrations/20260928000001_dheepika_lab_sync.sql` creates:
  - `records`: one row per app record (`tbl`, `id`, JSON `data`, `patient_id`, `org_id`, soft-delete flag and a server-stamped `updated_at`/`updated_by`);
  - `profiles`: role and organisation for each sign-in;
  - `clinician_allowlist`: owner-only;
  - row-level security for everything above;
  - `delete_my_data()`, the patient's own account erasure.
- **The role is never chosen in the app.** Sign-up always creates a patient account unless the email is on `clinician_allowlist`. No app user can read or write the allowlist. Adding an email later promotes an existing account.
- **App side** (`src/data/remote/`):
  - every local write goes into a persisted outbox;
  - identity rows (the user, then the patient record) are sent first, one per request;
  - other rows are sent in chunks, with append-only history sent insert-once;
  - changes from other devices are pulled every 20 s, on reconnect and when the app returns to the foreground (incremental by `updated_at`);
  - offline changes are kept and sent later;
  - rows the server refuses are dropped and logged as an incident.
- **Never sent to the server:**
  - demonstration data;
  - local password hashes;
  - video, which is never stored anyway.
- **Signing out** removes this account's records from the device, so a shared phone does not leave patient data behind. Unsent changes stay queued for that account's next sign-in.
- **Tests:**
  - `db/supabase_test.sql` runs through `scripts/db-check.sh` on PostgreSQL with an auth stub. It covers allowlist promotion, patient isolation, no self-promotion, the physiotherapist seeing every patient, append-only history, soft delete, erasure and cross-organisation isolation.
  - `src/data/remote/*.test.ts` covers mapping, ordering, outbox, offline retry and a two-device pull.

## One-time setup (clinic owner)

1. **Create the project** at supabase.com → New project. Choose a region close to the patients, for example *South Asia (Mumbai)*, and a strong database password.
   - Creating it needs your Supabase account.
   - The paid plan and the data-processing agreement are your decision.
2. **Create the tables:** open *SQL Editor* → New query, paste each file in `supabase/migrations/` in order (`…_sync.sql`, then `…_hardening.sql`), and *Run* each.
3. **Add the physiotherapist(s)** in the SQL editor, using the email each will sign in with, in lower case:
   ```sql
   insert into public.clinician_allowlist (email) values ('physio@example.com');
   ```
   To remove access: `delete from public.clinician_allowlist where email = '…';` then `update public.profiles set role = 'patient' where user_id = (select id from auth.users where email = '…');`.
4. **Configure authentication** under *Authentication → URL Configuration*:
   - *Site URL*: `https://physiovision-ai-eta.vercel.app`
   - *Redirect URLs*: `https://physiovision-ai-eta.vercel.app/auth*`

   Keep *Confirm email* on (Authentication → Providers → Email). The default Supabase mailer is rate-limited, so set up custom SMTP before inviting many people.
5. **Connect the app.** Under *Project Settings → API*, copy the *Project URL* and the **anon / publishable** key. In Vercel → project → *Settings → Environment Variables* (Production and Preview), add:
   - `VITE_SUPABASE_URL` = the project URL (`https://<ref>.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY` = the anon key

   Then redeploy. **Never** use the `service_role` key in the app or in any `VITE_` variable: it bypasses every security rule.
6. **Check it:**
   - sign up as a patient on one phone and complete a check-in;
   - sign in as the allowlisted physiotherapist on another device: the patient appears under *Patients*;
   - *Settings → Clinic server* shows "Up to date".

## Limits and known gaps

- Accounts created earlier in local mode live only in that browser and are **not migrated**. Recreate them on the server; the Data boundary export remains available.
- **One organisation.** Every physiotherapist on the allowlist sees every patient of the clinic. There are no per-physiotherapist caseloads yet.
- **Conflicts:** last write wins per record. Append-only history cannot conflict.
- **Deletion:**
  - A patient's *Delete my account* removes their records and sign-in from the server.
  - Physiotherapist accounts are removed by the owner.
  - Backups follow the Supabase plan's retention.
- **Long-term target:** the normalised schema in `db/schema.sql` + `db/security.sql` + `db/tenancy.sql` (care-relationship access, consent triggers, audit hash chain). The generic `records` table is the pragmatic first server. It does not yet enforce consent before capture on the server side; that is still checked in the app.
