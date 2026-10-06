import { PATHWAY_ORDER, PATHWAYS, type PathwayRegion } from '../../clinical/pathways';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { IconChevron, IconPlay, IconScan } from '../../components/icons';
import { CategoryBadge, DemoBadge, Notice, Stat, fmtDeg } from '../../components/ui';
import { deleteMyAccount, serverMode, signOut } from '../../data/auth';
import type { ConsentType } from '../../data/models';
import { setPrefs, usePrefs } from '../../data/prefs';
import { openPauses } from '../../clinical/plan';
import { activeProgram, adherence, fmtDate, fmtDateTime, programExercises, sessionsFor } from '../../data/queries';
import { getDb, insert, replaceDb, useDb, uuid } from '../../data/store';
import { getDefinition } from '../../engine/exercises/definitions';
import { reportStatus } from '../../clinical/report';
import { LOCALES, speechLang, useT } from '../../i18n';
import { CONSENT_TEXT_VERSION } from '../onboarding/Onboarding';
import { ProgressView } from '../progress/ProgressView';
import { DailyCompanion } from './DailyCompanion';
import { erasePatient, exportPatientData } from '../../data/privacy';
import { allVersions } from '../../content/contentStore';
import { libDose } from '../../clinical/plan';
import { ActivityPanel } from '../activity/ActivityPanel';
import { SessionSummary } from '../session/SessionSummary';

export function PatientHome() {
  const { t } = useT();
  const patient = useCurrentPatient();
  const user = useCurrentUser();
  const db = useDb((d) => d);
  if (!patient || !user) return null;
  const program = activeProgram(db, patient.id);
  const paused = !!program && openPauses(db, program.id).length > 0;
  const exs = program ? programExercises(db, program.id) : [];
  const last = sessionsFor(db, patient.id)[0];
  const adh = adherence(db, patient.id, 7);
  const clinician = program ? db.clinicians.find((c) => c.id === program.approvedBy) : undefined;
  const alerts = db.alerts.filter((a) => a.patientId === patient.id && !a.resolvedAt && a.type.startsWith('red_flag'));

  return (
    <div className="content stack loose patient-home">
      <div className="row between wrap page-intro">
        <div>
          <p className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{t('home.greeting', { name: patient.name.split(' ')[0] })}</h1>
        </div>
        <DemoBadge show={!!patient.isDemo} />
      </div>
      {alerts.length > 0 && <Notice tone="warn">{t('safety.review_body')}</Notice>}
      {program && openPauses(db, program.id).length > 0 && <Notice tone="warn">{t('plan.paused_body')}</Notice>}

      <section className="panel dark stack session-hero">
        <div className="row between wrap">
          <span className="eyebrow" style={{ color: '#8fb0aa' }}>
            {t('home.today')}
          </span>
          {program && <span className="badge clinical">✓ {t('train.approved_by', { name: clinician?.name ?? '' })}</span>}
        </div>
        {program ? (
          <>
            <h2 style={{ color: '#ecfdfa' }}>{program.title}</h2>
            <div className="stack tight">
              {exs.map((e) => {
                const d = getDefinition(e.prescription.definitionId, e.prescription.definitionVersion);
                return (
                  <div key={e.id} className="row between small">
                    <span>
                      {t(d.nameKey)} · {e.prescription.side === 'left' ? t('mirror.side_left') : t('mirror.side_right')}
                    </span>
                    <span className="num muted">
                      {e.prescription.sets}×{e.prescription.reps} · {e.prescription.target.min}–{e.prescription.target.max}°
                    </span>
                  </div>
                );
              })}
            </div>
            {!paused && (
              <Link to="/p/session" className="btn primary lg">
                <IconPlay width={20} /> {t('session.start')}
              </Link>
            )}
          </>
        ) : (
          <>
            <p>{t('home.no_program')}</p>
            <p className="small muted">{t('home.no_program_hint')}</p>
          </>
        )}
      </section>

      <DailyCompanion patient={patient} userId={user.id} />

      <div className="grid cols-3 patient-overview" aria-label="Progress and assessments">
        <div className="panel metric-card">
          <Stat label={t('home.adherence')} value={adh.pct === null ? '–' : `${Math.round(adh.pct * 100)}%`} sub={t('home.sessions_done', { done: adh.done, planned: adh.planned })} />
        </div>
        <div className="panel metric-card">
          <Stat
            label={t('home.last_session')}
            value={last ? fmtDeg(Math.max(...last.results.map((r) => r.peakRom ?? 0))) : '–'}
            sub={last ? `${fmtDate(last.startedAt)} · ${t('session.peak_rom')}` : undefined}
          />
        </div>
        {PATHWAY_ORDER.filter((r) => r === 'knee' || r === 'shoulder' || db.assessments.some((a) => a.patientId === patient.id && a.region === r)).map((r) => (
          <PathwayCard key={r} patientId={patient.id} region={r} />
        ))}
      </div>
      <OtherAreas patientId={patient.id} />
      <DeskCheckCard />
      <Link to="/p/progress" className="btn secondary">
        {t('home.recent_progress')} <IconChevron width={18} />
      </Link>
    </div>
  );
}

/** Library exercises in the approved plan: instructions and precautions of the exact approved version. */
function PlanLibrary({ programId }: { programId: string }) {
  const { t } = useT();
  const items = useDb((d) => (d.programLibraryItems ?? []).filter((l) => l.programId === programId).sort((a, b) => a.order - b.order), [programId]);
  const content = useDb((d) => allVersions(d), []);
  if (!items.length) return null;
  return (
    <div className="stack tight">
      <h3>{t('train.library_title')}</h3>
      <div className="grid cols-2">
        {items.map((l) => {
          const it = content.find((c) => c.id === l.itemId && c.version === l.itemVersion);
          return (
            <article key={l.id} className="panel stack tight">
              <div className="row between">
                <h3>{it?.title ?? l.itemId}</h3>
                <span className="badge">{libDose(l)}</span>
              </div>
              {it && (
                <ol className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                  {it.instructions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ol>
              )}
              {it?.cues?.length ? (
                <p className="xs" style={{ margin: 0 }}>
                  <strong>{t('train.cues')}:</strong> {it.cues.join(' · ')}
                </p>
              ) : null}
              {it?.commonMistakes?.length ? (
                <p className="xs" style={{ margin: 0 }}>
                  <strong>{t('train.mistakes')}:</strong> {it.commonMistakes.join(' · ')}
                </p>
              ) : null}
              {it?.precautions.map((x) => (
                <p key={x} className="xs muted">
                  ⚠ {x}
                </p>
              ))}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/** Reads the clinician-approved plan aloud with the device's speech engine (nothing is sent anywhere). */
function ReadPlanAloud({ text }: { text: string }) {
  const { t, locale } = useT();
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const toggle = () => {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = speechLang(locale);
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  };
  return (
    <button className="btn secondary" aria-pressed={speaking} onClick={toggle}>
      {speaking ? t('train.stop_reading') : t('train.read_aloud')}
    </button>
  );
}

/** Seated desk posture check (side view, camera estimates for review). */
function DeskCheckCard() {
  const { t } = useT();
  return (
    <Link to="/p/desk" className="panel list-item" style={{ textDecoration: 'none' }}>
      <span className="grow">
        <span className="list-title">{t('desk.entry')}</span>
        <span className="small muted" style={{ display: 'block' }}>
          {t('desk.entry_body')}
        </span>
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}

/** Pathways the patient has not started yet (other than the knee and shoulder cards). */
function OtherAreas({ patientId }: { patientId: string }) {
  const { t } = useT();
  const db = useDb((d) => d);
  const rest = PATHWAY_ORDER.filter((r) => r !== 'knee' && r !== 'shoulder' && !db.assessments.some((a) => a.patientId === patientId && a.region === r));
  if (!rest.length) return null;
  return (
    <section className="panel stack tight">
      <span className="stat-label">{t('home.other_areas')}</span>
      <div className="row wrap" style={{ gap: '0.5rem' }}>
        {rest.map((r) => (
          <Link key={r} to={`/p/assess/${r}`} className="btn secondary sm">
            {t(`onb.area_${r}`)}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Assessment status per pathway: resume, matched reassessment and the approved report. */
function PathwayCard({ patientId, region }: { patientId: string; region: PathwayRegion }) {
  const db = useDb((d) => d);
  const label = PATHWAYS[region].label;
  const to = region === 'knee' ? '/p/assess' : `/p/assess/${region}`;
  const knee = db.assessments.filter((a) => a.patientId === patientId && a.region === region).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = knee.find((a) => !a.submittedAt);
  const lastDone = knee.find((a) => a.submittedAt);
  const reviewed = knee.find((a) => a.status === 'reviewed');
  // The most recent assessment whose report a clinician has approved (may be older than lastDone).
  const approvedReport = knee.find((a) => reportStatus(db, a.id).state === 'clinician_reviewed');
  return (
    <div className="panel stack tight metric-card knee-card">
      <span className="stat-label">{label} assessment</span>
      {open ? (
        <>
          <strong>In progress</strong>
          <Link to={to} className="btn primary sm">
            <IconScan width={16} /> Resume
          </Link>
        </>
      ) : lastDone ? (
        <>
          <strong>{lastDone.status === 'reviewed' ? 'Reviewed by your physiotherapist' : lastDone.status === 'safety_hold' ? 'Waiting for physiotherapist (safety review)' : 'Submitted — awaiting review'}</strong>
          <span className="xs muted">{fmtDate(lastDone.submittedAt!)}</span>
          {approvedReport && (
            <Link to={`/report/${approvedReport.id}?audience=patient`} className="btn secondary sm">
              View report ({fmtDate(approvedReport.createdAt)})
            </Link>
          )}
          {reviewed && (
            <Link to={`${to}?reassess=${reviewed.id}`} className="btn secondary sm">
              Start matched reassessment
            </Link>
          )}
        </>
      ) : (
        <Link to={to} className="btn primary sm">
          <IconScan width={16} /> Start {label.toLowerCase()} assessment
        </Link>
      )}
    </div>
  );
}

export function PatientTrain() {
  const { t } = useT();
  const patient = useCurrentPatient();
  const db = useDb((d) => d);
  const [open, setOpen] = useState<string | null>(null);
  if (!patient) return null;
  const program = activeProgram(db, patient.id);
  const exs = program ? programExercises(db, program.id) : [];
  const sessions = sessionsFor(db, patient.id);
  const clinician = program ? db.clinicians.find((c) => c.id === program.approvedBy) : undefined;
  const openSession = sessions.find((s) => s.id === open);

  return (
    <div className="content stack loose">
      <h1>{t('train.title')}</h1>
      {program && openPauses(db, program.id).length > 0 && <Notice tone="warn">{t('plan.paused_body')}</Notice>}
      {program ? (
        <section className="stack">
          <div className="row between wrap">
            <div>
              <h2>{program.title}</h2>
              <p className="small muted">
                {t('train.program_period', { start: fmtDate(program.startDate), end: fmtDate(program.endDate) })} · {t('plan.version', { v: program.version ?? 1 })}
              </p>
            </div>
            <span className="badge clinical">✓ {t('train.approved_by', { name: clinician?.name ?? '' })}</span>
          </div>
          <div className="grid cols-2">
            {exs.map((e) => {
              const d = getDefinition(e.prescription.definitionId, e.prescription.definitionVersion);
              const rx = e.prescription;
              return (
                <article key={e.id} className="panel stack tight">
                  <div className="row between">
                    <h3>{t(d.nameKey)}</h3>
                    <span className="badge">{t('train.per_side', { side: rx.side === 'left' ? t('mirror.side_left') : t('mirror.side_right') })}</span>
                  </div>
                  <p className="small muted">{t(d.summaryKey)}</p>
                  <div className="row wrap small">
                    <span className="badge">{t('train.sets_reps', { sets: rx.sets, reps: rx.reps })}</span>
                    <span className="badge">{t('train.target_range', { min: rx.target.min, max: rx.target.max })}</span>
                    {rx.holdSeconds > 0 && <span className="badge">{t('train.hold_s', { s: rx.holdSeconds })}</span>}
                    <span className="badge">{t('train.frequency', { n: rx.frequencyPerWeek })}</span>
                  </div>
                  {rx.instructions && <p className="small">“{rx.instructions}”</p>}
                </article>
              );
            })}
          </div>
          {(program.patientAdvice || program.patientPrecautions) && (
            <div className="grid cols-2">
              {program.patientAdvice && (
                <article className="panel stack tight">
                  <h3>{t('train.advice')}</h3>
                  <p className="small" style={{ whiteSpace: 'pre-line', margin: 0 }}>{program.patientAdvice}</p>
                </article>
              )}
              {program.patientPrecautions && (
                <article className="panel stack tight" style={{ borderColor: 'var(--amber, #d97706)' }}>
                  <h3>{t('train.precautions')}</h3>
                  <p className="small" style={{ whiteSpace: 'pre-line', margin: 0 }}>{program.patientPrecautions}</p>
                </article>
              )}
            </div>
          )}
          <PlanLibrary programId={program.id} />
          <div className="row wrap no-print">
            <ReadPlanAloud
              text={[
                program.title,
                ...exs.map((e) => {
                  const d = getDefinition(e.prescription.definitionId, e.prescription.definitionVersion);
                  const rx = e.prescription;
                  return `${t(d.nameKey)}. ${t('train.sets_reps', { sets: rx.sets, reps: rx.reps })}. ${rx.holdSeconds > 0 ? `${t('train.hold_s', { s: rx.holdSeconds })}. ` : ''}${t('train.frequency', { n: rx.frequencyPerWeek })}.${rx.instructions ? ` ${rx.instructions}` : ''}`;
                }),
                program.patientAdvice ? `${t('train.advice')}. ${program.patientAdvice}` : '',
                program.patientPrecautions ? `${t('train.precautions')}. ${program.patientPrecautions}` : '',
              ]
                .filter(Boolean)
                .join('\n')}
            />
            <button className="btn secondary" onClick={() => window.print()}>
              {t('train.print_plan')}
            </button>
          </div>
          <Link to="/p/session" className="btn primary lg no-print">
            <IconPlay width={20} /> {t('session.start')}
          </Link>
        </section>
      ) : (
        <Notice>{t('home.no_program')}</Notice>
      )}

      <section className="stack no-print">
        <h2>{t('train.history')}</h2>
        {sessions.length === 0 && <p className="muted">{t('train.no_history')}</p>}
        <div className="panel list">
          {sessions.slice(0, 20).map((s) => (
            <button key={s.id} className="list-item" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
              <div className="grow">
                <div className="list-title">{fmtDateTime(s.startedAt)}</div>
                <div className="small muted">
                  {s.results.map((r) => `${t(getDefinition(r.prescription.definitionId).nameKey)} ${fmtDeg(r.peakRom)}`).join(' · ')}
                </div>
              </div>
              {s.status === 'interrupted' && <span className="badge warn">{t('session.ended_early')}</span>}
              <span className="num small">
                {s.painBefore ?? '–'}→{s.painAfter ?? '–'}
              </span>
              <IconChevron width={18} />
            </button>
          ))}
        </div>
        {openSession && <SessionSummary session={openSession} />}
      </section>
    </div>
  );
}

export function PatientProgress() {
  const { t } = useT();
  const patient = useCurrentPatient();
  if (!patient) return null;
  return (
    <div className="content stack loose">
      <h1>{t('progress.title')}</h1>
      <ProgressView patientId={patient.id} />
    </div>
  );
}

export function PatientProfile() {
  const { t, locale } = useT();
  const nav = useNavigate();
  const prefs = usePrefs();
  const user = useCurrentUser();
  const patient = useCurrentPatient();
  const consents = useDb((d) => d.consents.filter((c) => c.patientId === patient?.id), [patient?.id]);
  const messages = useDb((d) => d.messages.filter((m) => m.patientId === patient?.id).sort((a, b) => a.at.localeCompare(b.at)), [patient?.id]);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState('');
  if (!patient || !user) return null;

  const latest = (type: ConsentType) => consents.filter((c) => c.type === type).sort((a, b) => b.at.localeCompare(a.at))[0];
  const toggleConsent = (type: ConsentType) => {
    const cur = latest(type);
    insert('consents', { id: uuid(), patientId: patient.id, type, granted: !cur?.granted, textVersion: CONSENT_TEXT_VERSION, at: new Date().toISOString() }, user.id, 'consent_change');
  };

  const exportData = () => {
    // Everything linked to this patient, found by linkage (covers every table, including newer ones).
    const data = { patient, ...exportPatientData(getDb(), patient.id) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dheepika-lab-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const deleteAccount = async () => {
    setDeleteErr(null);
    try {
      // Server mode: the server erases every linked record and the sign-in; local mode: this device only.
      await deleteMyAccount(() => replaceDb(erasePatient(getDb(), patient.id, new Date().toISOString())));
      nav('/');
    } catch {
      setDeleteErr(t('profile.delete_failed'));
    }
  };

  return (
    <div className="content narrow stack loose">
      <div className="row between">
        <h1>{t('profile.title')}</h1>
        <DemoBadge show={!!patient.isDemo} />
      </div>
      <div className="panel row">
        <div className="avatar">{patient.name[0]}</div>
        <div className="grow">
          <strong>{patient.name}</strong>
          <div className="small muted">{user.email}</div>
        </div>
      </div>

      <section className="panel stack">
        <h2>{t('profile.messages')}</h2>
        <div className="stack tight" style={{ maxHeight: 260, overflowY: 'auto' }}>
          {messages.map((m) => (
            <div key={m.id} className="notice" style={{ alignSelf: m.fromUserId === user.id ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div>
                <div className="xs muted">
                  {m.fromName} · {fmtDateTime(m.at)}
                </div>
                {m.body}
              </div>
            </div>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!msg.trim()) return;
            insert('messages', { id: uuid(), patientId: patient.id, fromUserId: user.id, fromName: patient.name, body: msg.trim(), at: new Date().toISOString(), isDemo: patient.isDemo }, user.id);
            setMsg('');
          }}
        >
          <input className="input grow" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t('profile.message_placeholder')} aria-label={t('profile.message_placeholder')} />
          <button className="btn primary">{t('profile.send')}</button>
        </form>
      </section>

      <section className="panel stack">
        <h2>{t('profile.language')}</h2>
        <div className="segmented">
          {LOCALES.map((l) => (
            <button key={l.id} aria-pressed={locale === l.id} onClick={() => setPrefs({ locale: l.id })}>
              {l.label}
            </button>
          ))}
        </div>
        {locale === 'ta' && <p className="xs muted">{t('profile.ta_notice')}</p>}
      </section>

      <section className="panel stack tight">
        <h2>{t('profile.accessibility')}</h2>
        {(
          [
            ['largeText', 'profile.large_text'],
            ['highContrast', 'profile.high_contrast'],
            ['reducedMotion', 'profile.reduced_motion'],
            ['voice', 'profile.voice'],
            ['captions', 'profile.captions'],
            ['haptics', 'profile.haptics'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ [k]: e.target.checked })} />
            <span>{t(label)}</span>
          </label>
        ))}
      </section>

      <ActivityPanel patient={patient} userId={user.id} />

      <section className="panel stack tight">
        <h2>{t('profile.consents')}</h2>
        {(['camera_processing', 'data_storage', 'image_storage', 'research_export'] as ConsentType[]).map((c) => {
          const cur = latest(c);
          return (
            <label key={c} className="check">
              <input type="checkbox" checked={!!cur?.granted} onChange={() => toggleConsent(c)} />
              <span>
                {t(`onb.consent.c_${c === 'camera_processing' ? 'camera' : c === 'data_storage' ? 'storage' : c === 'image_storage' ? 'images' : 'research'}`)}
                <br />
                <span className="xs muted">{cur?.granted ? t('profile.consent_granted', { date: fmtDate(cur.at) }) : t('profile.consent_revoked')}</span>
              </span>
            </label>
          );
        })}
        <div className="row wrap">
          <CategoryBadge kind="pro" />
          <span className="xs muted">v{CONSENT_TEXT_VERSION}</span>
        </div>
      </section>

      <section className="panel stack">
        <button className="btn secondary" onClick={exportData}>
          {t('profile.export')}
        </button>
        <div className="row wrap small" style={{ gap: '1rem' }}>
          <Link to="/about">{t('about.how')}</Link>
          <Link to="/privacy">{t('about.privacy')}</Link>
        </div>
        {!patient.isDemo && (
          <details>
            <summary className="btn danger" style={{ listStyle: 'none' }}>
              {t('profile.delete')}
            </summary>
            <div className="stack tight" style={{ marginTop: '0.75rem' }}>
              <p className="small">{serverMode() ? t('profile.delete_confirm_server') : t('profile.delete_confirm')}</p>
              <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="DELETE" />
              <button className="btn danger" disabled={confirm !== 'DELETE'} onClick={() => void deleteAccount()}>
                {t('profile.delete')}
              </button>
              {deleteErr && (
                <p role="alert" className="small" style={{ color: 'var(--red-ink)' }}>
                  {deleteErr}
                </p>
              )}
            </div>
          </details>
        )}
        <button
          className="btn ghost"
          onClick={() => {
            signOut();
            nav('/');
          }}
        >
          {t('nav.sign_out')}
        </button>
      </section>
    </div>
  );
}
