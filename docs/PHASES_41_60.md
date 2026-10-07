# Dheepika Lab: phases 41–60

**Baseline:** the 7 October 2026 build (user guide v3). Phases 21–40 are in [PHASES_21_40.md](PHASES_21_40.md). Their real-device, study and approval gates are still open, and **none of the phases below closes them**. The real-patient build flag stays off. Dheepika's clinical approval remains on hold. The live site stays a simulated demo with browser-local storage.

The same rules apply as before:

- Each phase has one reviewable exit.
- A phase is complete only when its evidence, reviewer, configuration and residual failures are recorded here.
- Engineering tests cannot stand in for phones, volunteers, translators or clinicians.
- No phase adds diagnoses, disease probabilities, population norms or severity categories.

**Kind** says who can move the phase forward:

- **Build**: engineering can finish it in this repository now.
- **Build + review**: engineering can build the mechanism, but its content or acceptance needs a named person.
- **Blocked**: it needs a decision, contract, account, ethics approval or people outside the repository first.

| Phase | Deliverable | Exit evidence | Kind / dependency | State |
|---|---|---|---|---|
| 41 | Phone-weight 3D atlas | A simplified model with the same mesh names. Region tagging test passes on every vertex of every model. Phones get the light model by default. The device check records which model ran. | Build. Phone acceptance still uses the Phase 24 worksheet | Planned |
| 42 | End-to-end browser tests in CI | Scripted patient and clinician demo journeys (intake → simulated scan → submit → review → report; desk check; walk-in registration). Run headless on every push, with the accessibility audit, using Playwright's official browser download. | Build | Planned |
| 43 | Performance budgets | Script and CI step that report JS, CSS and model sizes per build. They fail when a size grows past the budget the owner recorded. | Build. Budgets are engineering limits, not clinical values | Planned |
| 44 | Supply-chain checks | SBOM from `npm sbom`, a licence allow-list check over the installed tree, and `npm audit` (high/critical) in CI. Third-party assets are listed with their licences. | Build | Planned |
| 45 | Offline and poor-network behaviour | Visible offline state. Updates install only after a prompt, not mid-session. The 3D model is stored for offline use only when the user opts in, and its storage use is shown. | Build | Planned |
| 46 | Translation workflow | Translator sheet export and import (CSV) with a per-string review status. A coverage gate stops reviewed strings from silently going stale. A pseudo-locale exercises layout with long text. | Build + review: qualified Tamil translator and clinical reviewer | Planned |
| 47 | Patient goals | Goals the patient sets with the clinician, in the patient's own words. The patient rates progress; ratings are stored verbatim with dates. The clinician sees them alongside, never merged with, camera estimates. | Build. No goal is generated or suggested by the app | Planned |
| 48 | Structured clinical notes | SOAP-style note template. The clinician can insert measurements, each labelled with source, view, quality and version. Notes are append-only with amendments. | Build | Planned |
| 49 | Outcome-measure registry | Registry of questionnaires with version, licence status, licence holder and scoring source. An instrument can be enabled only when its licence and clinical approval are recorded. | Build + review: licences and clinical lead. No instrument content is added without a licence | Planned |
| 50 | Capture quality dashboard | Clinic-level counts of captures withheld or failed, by reason, view, device class and protocol version. Descriptive counts only; no accuracy claims. Feeds Phases 22–23. | Build | Planned |
| 51 | Occlusion challenge recorder | Guided recording of consented challenge sequences as landmark-only files with labels (occluder, joint, view, device). Raw video is kept only under its own purpose-specific consent. The output is in the locked-set format Phase 22 needs. | Build + review: the captures need consenting volunteers | Planned |
| 52 | Referral and letters | Clinician-written referral or update letter with selected, sourced measurements. It is marked preliminary until signed and printed from the existing report renderer. | Build. The clinician writes the letter content | Planned |
| 53 | Server import and sync go-live | Run the Phase 32 import planner on staging with real accounts. Conflict, rollback and erasure drills pass on the server. | Blocked on 31: hosting, IdP, live migrations 000003/000004 | Blocked |
| 54 | Multi-clinic tenancy | Clinic-scoped data, staff roles and an admin console. Cross-clinic negative-access tests pass on staging. | Blocked on 31 and 53 | Blocked |
| 55 | Caregiver access | A family member or carer sees what the patient chooses, under a consent that can be withdrawn. All access is audited. | Blocked on 31, 54 and a privacy review | Blocked |
| 56 | Reminders by SMS/WhatsApp/email | Appointment and exercise reminders through a contracted provider, with opt-in, opt-out and quiet hours. No clinical content in messages. | Blocked: provider contract, Indian DLT sender registration, consent text | Blocked |
| 57 | Tamil voice and questionnaires | Reviewed Tamil UI strings and voice cues. Separately versioned, back-translated questionnaires. | Blocked on 46 plus a translator and clinical reviewer | Blocked |
| 58 | Volunteer validation study | Ethics-approved study run under [STUDY_PROTOCOL](validation/STUDY_PROTOCOL.md) with thresholds locked first, on the target phones. Publishes agreement, repeatability and failure rates per metric and device. | Blocked: ethics approval, statistician, volunteers, phones | Blocked |
| 59 | Supervised clinic pilot | Pilot inside Dheepika's clinic, limited to protocols that passed 58. The clinician reviews every result, incidents follow [INCIDENT_PROCESS](INCIDENT_PROCESS.md), and patients can opt out. | Blocked on 40 and 58, and explicit approval | Blocked |
| 60 | Post-release monitoring | Incident review schedule, capture-failure and complaint trends, a timed rollback drill, and scheduled re-validation after any model or protocol change. | Blocked on 59. The rollback drill can be rehearsed on staging | Blocked |

## What each buildable phase will and will not do

**41 Phone-weight atlas.** The current model is about 1.59 M triangles and 31 MB of buffers. A simplified copy is made once at build time and committed with its hash, keeping mesh names. Region mapping is per vertex, so the existing test can run on both models. Phones load the light model first, with a choice to switch to the detailed one. The phase does *not* decide that phones perform well enough; that is still the Phase 24 worksheet.

**42 End-to-end tests.** These tests only use the demo with the simulated camera, so they never need camera permission or patient data. They check that each journey completes and that the safety rules still route, for example that a red-flag answer stops the scan. They prove the software flows work. They do not show that any measurement is accurate.

**43 Budgets.** The owner records the budget numbers. The first build's sizes are shown as the starting point, not as a target.

**44 Supply chain.** The allow-list starts from licences already in the tree (MIT, ISC, Apache-2.0, BSD, MPL-2.0 for axe-core, OFL for fonts, and CC BY-SA for BodyParts3D, which needs attribution). Anything new fails until someone reviews it.

**45 Offline.** Patient data already stays on the device. This phase covers the app shell, the update prompt and the opt-in model cache. Nothing patient-related is cached by the service worker.

**46 Translation.** The engineering side is the export/import round trip, review status and gates. Draft Tamil strings stay marked as drafts. Machine translation is not used for clinical questionnaires.

**47 Goals.** Free-text goals in the patient's words, plus a 0–10 progress rating the patient gives. The app does not convert camera numbers into goal progress.

**48 Notes.** The S/O/A/P headings are a format, not content. Inserted measurements carry their source label (patient-reported, camera estimate, algorithmic observation or clinician finding) so the separation survives into the note.

**49 Outcome measures.** Only the registry and the enable gate are built. Questionnaires such as KOOS, ODI or DASH are not typed in from memory. Each needs its licence, the official text and the official scoring manual.

**50 Quality dashboard.** Counts and reasons that already exist on each measurement ("not in view", "unstable", "low confidence"). It shows where captures fail. It does not show whether successful captures are accurate.

**51 Challenge recorder.** It writes the labelled set; it does not lock it. Locking and judging pass or fail stay with Phase 22 reviewers.

**52 Letters.** The clinician writes them. Measurements are copied in with their labels, and the letter states the app's limitations.

## Order of work

1. Do 41–45 first: they protect phones, CI and security.
2. Then 50 and 51, because they give Phase 22 the data it is missing.
3. Then 46–49 and 52: clinic workflow.
4. 53–60 start only when the decisions listed against them are made. Engineering can prepare staging scripts, but no work in this repository moves those gates.

## Decisions the owner needs to make

- **Hosting, IdP and live migrations (Phase 31).** These unblock 53–55.
- **Budget numbers for 43** and **phone acceptance criteria for 24/41.**
- **A Tamil translator and a clinical reviewer** for 46 and 57.
- **Questionnaire licences** for 49.
- **Reminder provider and DLT registration** for 56.
- **Ethics committee, statistician and volunteers** for 58.
- **Explicit approval from Dheepika** before 59.
