import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCurrentClinician, useCurrentUser } from '../../app/hooks';
import { IconChevron, IconPlus } from '../../components/icons';
import { CategoryBadge, ConfidenceBadge, DemoBadge, fmtDeg, initials, Notice, Segmented, Stat } from '../../components/ui';
import { diffPlans, openPauses, planHistory, reassessmentDue } from '../../clinical/plan';
import type { Alert, DB, Patient } from '../../data/models';
import { activeProgram, adherence, age, fmtDate, fmtDateTime, latestAssessment, openAlerts, programExercises, sessionsFor } from '../../data/queries';
import { insert, update, useDb, uuid } from '../../data/store';
import { getDefinition } from '../../engine/exercises/definitions';
import { MEASUREMENTS, type MeasurementType } from '../../engine/measurements';
import { useT } from '../../i18n';
import { BodyMap } from '../bodymap/BodyMap';
import { regionLabel } from '../bodymap/regions';
import { ProgressView } from '../progress/ProgressView';
import { SessionSummary } from '../session/SessionSummary';

/** Clinician experience: overview, patient list, patient record. */

const ALERT_ICON: Record<Alert['severity'], string> = { critical: '‼', warning: '!', info: 'i' };

function alertText(a: Alert, t: (k: string, p?: Record<string, string | number>) => string) {
  const map: Record<Alert['type'], string> = {
    red_flag_urgent: 'Red flag — urgent',
    red_flag_review: 'Red flag — needs review',
    pain_increase: 'Reported pain increase',
    low_adherence: 'Low adherence',
    assessment_submitted: t('assess.submitted'),
    tracking_quality: 'Low tracking quality',
    plan_paused: 'Plan paused — clinician review needed',
    reassess_due: 'Reassessment due',
  };
  return map[a.type] + (a.detail ? ` · ${a.detail}` : '');
}

export function ClinicianOverview() {
  const { t } = useT();
  const clinician = useCurrentClinician();
  const db = useDb((d) => d);
  const patients = db.patients;
  const awaiting = db.assessments.filter((a) => a.status === 'submitted' || (a.status === 'safety_hold' && a.submittedAt));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recent = [...db.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 6);
  const alerts = openAlerts(db).sort((a, b) => (a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : b.createdAt.localeCompare(a.createdAt)));
  const upcoming = db.programs
    .filter((p) => p.status === 'active')
    .map((p) => ({ p, due: new Date(p.startDate).getTime() + 28 * 86_400_000 }))
    .filter((x) => x.due - Date.now() < 14 * 86_400_000)
    .sort((a, b) => a.due - b.due);
  const pname = (id: string) => db.patients.find((p) => p.id === id)?.name ?? '—';

  return (
    <div className="content stack loose clinician-overview">
      <div className="row between wrap page-intro clinician-intro">
        <div>
          <p className="eyebrow">Dheepika Lab</p>
          <h1>{t('nav.overview')}</h1>
          {clinician && <p className="muted">{clinician.name} · {clinician.title}</p>}
        </div>
        <Link to="/c/programs/new" className="btn primary">
          <IconPlus width={18} /> {t('nav.programs')}
        </Link>
      </div>

      <div className="grid cols-4 overview-stats">
        <div className="panel">
          <Stat label="Active patients" value={patients.filter((p) => activeProgram(db, p.id)).length} sub={`${patients.length} total`} />
        </div>
        <Link to="/c/assessments" className="panel" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Stat label="Assessments awaiting review" value={awaiting.length} sub={<span className="row">{t('cat.requires_review')} <IconChevron width={14} /></span>} />
        </Link>
        <div className="panel">
          <Stat label="Sessions (7 days)" value={db.sessions.filter((s) => new Date(s.startedAt).getTime() > weekAgo).length} />
        </div>
        <div className="panel">
          <Stat label="Open alerts" value={alerts.length} sub={`${alerts.filter((a) => a.severity === 'critical').length} critical`} />
        </div>
      </div>

      <div className="grid cols-2">
        <section className="panel stack">
          <div className="section-title">
            <h2>Reported symptom changes & alerts</h2>
          </div>
          {alerts.length === 0 && <p className="muted">No open alerts.</p>}
          <div className="list">
            {alerts.slice(0, 8).map((a) => (
              <Link key={a.id} to={`/c/patients/${a.patientId}`} className="list-item">
                <span className={`badge ${a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : ''}`} aria-label={a.severity}>
                  {ALERT_ICON[a.severity]}
                </span>
                <div className="grow">
                  <div className="list-title">{pname(a.patientId)}</div>
                  <div className="small muted">{alertText(a, t)}</div>
                </div>
                <span className="xs muted">{fmtDate(a.createdAt)}</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="panel stack">
          <div className="section-title">
            <h2>Awaiting review</h2>
            <Link to="/c/assessments" className="small">
              View all
            </Link>
          </div>
          {awaiting.length === 0 && <p className="muted">Nothing awaiting review.</p>}
          <div className="list">
            {awaiting.map((a) => (
              <Link key={a.id} to={`/c/assessments/${a.id}`} className="list-item">
                <div className="avatar">{initials(pname(a.patientId))}</div>
                <div className="grow">
                  <div className="list-title">{pname(a.patientId)}</div>
                  <div className="small muted">
                    {fmtDateTime(a.submittedAt ?? a.createdAt)} · {db.measurements.filter((m) => m.assessmentId === a.id && m.reviewStatus === 'pending').length} pending estimates
                  </div>
                </div>
                {a.status === 'safety_hold' && <span className="badge danger">Safety hold</span>}
                <IconChevron width={18} />
              </Link>
            ))}
          </div>
        </section>
        <section className="panel stack">
          <h2>Program adherence (28 days)</h2>
          <div className="list">
            {patients
              .filter((p) => activeProgram(db, p.id))
              .map((p) => {
                const a = adherence(db, p.id, 28);
                return (
                  <Link key={p.id} to={`/c/patients/${p.id}`} className="list-item">
                    <span className="grow list-title">{p.name}</span>
                    <div className="meter" style={{ width: 120 }} aria-hidden="true">
                      <span style={{ width: `${(a.pct ?? 0) * 100}%`, background: (a.pct ?? 0) < 0.5 ? 'var(--amber)' : 'var(--teal)' }} />
                    </div>
                    <span className="num small" style={{ width: 44, textAlign: 'right' }}>
                      {a.pct === null ? '–' : `${Math.round(a.pct * 100)}%`}
                    </span>
                    {(a.pct ?? 1) < 0.5 && <span className="badge warn">low</span>}
                  </Link>
                );
              })}
          </div>
        </section>
        <section className="panel stack">
          <h2>Recent sessions</h2>
          <div className="list">
            {recent.map((s) => (
              <Link key={s.id} to={`/c/patients/${s.patientId}?tab=sessions`} className="list-item">
                <div className="grow">
                  <div className="list-title">{pname(s.patientId)}</div>
                  <div className="small muted">
                    {fmtDateTime(s.startedAt)} · {s.results.map((r) => `${t(`measure.${getDefinition(r.prescription.definitionId).primary}`)} ${fmtDeg(r.peakRom)}`).join(' · ')}
                  </div>
                </div>
                <span className="num small">
                  pain {s.painBefore ?? '–'}→{s.painAfter ?? '–'}
                </span>
              </Link>
            ))}
          </div>
        </section>
        <section className="panel stack">
          <h2>Upcoming reassessments</h2>
          {upcoming.length === 0 && <p className="muted">None in the next 14 days.</p>}
          <div className="list">
            {upcoming.map(({ p, due }) => (
              <Link key={p.id} to={`/c/patients/${p.patientId}`} className="list-item">
                <span className="grow list-title">{pname(p.patientId)}</span>
                <span className={`badge ${due < Date.now() ? 'warn' : ''}`}>{due < Date.now() ? 'Overdue' : fmtDate(new Date(due).toISOString())}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

type Filter = 'all' | 'review' | 'alerts' | 'low_adherence';

export function PatientList() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const db = useDb((d) => d);
  const rows = db.patients
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) || (p.concern ?? '').toLowerCase().includes(q.toLowerCase()))
    .filter((p) => {
      if (filter === 'review') return db.assessments.some((a) => a.patientId === p.id && (a.status === 'submitted' || a.status === 'safety_hold'));
      if (filter === 'alerts') return openAlerts(db, p.id).length > 0;
      if (filter === 'low_adherence') return (adherence(db, p.id, 28).pct ?? 1) < 0.5;
      return true;
    });
  return (
    <div className="content stack loose">
      <h1>Patients</h1>
      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 220 }} placeholder="Search by name or concern…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
        <Segmented<Filter>
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All' },
            { id: 'review', label: 'Needs review' },
            { id: 'alerts', label: 'Alerts' },
            { id: 'low_adherence', label: 'Low adherence' },
          ]}
        />
      </div>
      <div className="panel table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="data">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Concern (patient-reported)</th>
              <th>Program</th>
              <th>Adherence</th>
              <th>Last session</th>
              <th>Alerts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const prog = activeProgram(db, p.id);
              const a = adherence(db, p.id, 28);
              const last = sessionsFor(db, p.id)[0];
              const al = openAlerts(db, p.id);
              return (
                <tr key={p.id}>
                  <td>
                    <Link to={`/c/patients/${p.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="avatar">{initials(p.name)}</div>
                      <div>
                        <div style={{ fontWeight: 650 }}>
                          {p.name} {p.isDemo && <DemoBadge />}
                        </div>
                        <div className="xs muted">
                          {age(p.dob) ?? '–'} y · {p.sex ?? '–'}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="small" style={{ maxWidth: 280 }}>
                    {p.concern ?? '–'}
                  </td>
                  <td className="small">{prog ? prog.title : <span className="muted">None</span>}</td>
                  <td className="num">{a.pct === null ? '–' : `${Math.round(a.pct * 100)}%`}</td>
                  <td className="small">{last ? fmtDate(last.startedAt) : '–'}</td>
                  <td>{al.length > 0 ? <span className={`badge ${al.some((x) => x.severity === 'critical') ? 'danger' : 'warn'}`}>! {al.length}</span> : <span className="muted">–</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="muted" style={{ padding: '1rem' }}>No patients match.</p>}
      </div>
    </div>
  );
}

type Tab = 'overview' | 'assessment' | 'measurements' | 'pros' | 'programs' | 'sessions' | 'progress' | 'notes';

export function PatientDetail() {
  const { id } = useParams();
  const { t } = useT();
  const nav = useNavigate();
  const user = useCurrentUser();
  const db = useDb((d) => d);
  const patient = db.patients.find((p) => p.id === id);
  const initialTab = (new URLSearchParams(location.search).get('tab') as Tab) ?? 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [openSession, setOpenSession] = useState<string | null>(null);
  if (!patient || !user) return <div className="content">Patient not found.</div>;
  const alerts = openAlerts(db, patient.id);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'assessment', label: 'Assessment' },
    { id: 'measurements', label: 'Movement measurements' },
    { id: 'pros', label: 'Patient-reported outcomes' },
    { id: 'programs', label: 'Programs' },
    { id: 'sessions', label: 'Session history' },
    { id: 'progress', label: 'Progress' },
    { id: 'notes', label: 'Clinical notes' },
  ];

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div className="row">
          <div className="avatar" style={{ width: 52, height: 52, fontSize: '1.2rem' }}>
            {initials(patient.name)}
          </div>
          <div>
            <h1>
              {patient.name} <DemoBadge show={!!patient.isDemo} />
            </h1>
            <p className="muted small">
              {age(patient.dob) ?? '–'} y · {patient.sex ?? '–'} · {patient.phone ?? 'no phone'}
            </p>
          </div>
        </div>
        <div className="row wrap">
          <Link to={`/c/programs/new?patient=${patient.id}`} className="btn primary">
            Build program
          </Link>
          <button className="btn secondary" onClick={() => nav(-1)}>
            {t('common.back')}
          </button>
        </div>
      </div>
      {alerts.map((a) => (
        <Notice key={a.id} tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : 'info'}>
          <div className="row between wrap">
            <span>{alertText(a, t)}</span>
            <button className="btn sm secondary" onClick={() => update('alerts', a.id, { resolvedAt: new Date().toISOString(), resolvedBy: user.id }, user.id, 'resolve')}>
              Mark resolved
            </button>
          </div>
        </Notice>
      ))}
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab db={db} patient={patient} />}
      {tab === 'assessment' && <AssessmentTab db={db} patient={patient} />}
      {tab === 'measurements' && <MeasurementsTab db={db} patient={patient} actorId={user.id} />}
      {tab === 'pros' && <ProsTab db={db} patient={patient} />}
      {tab === 'programs' && <ProgramsTab db={db} patient={patient} actorId={user.id} />}
      {tab === 'sessions' && (
        <div className="stack">
          <div className="panel list">
            {sessionsFor(db, patient.id).map((s) => (
              <button key={s.id} className="list-item" onClick={() => setOpenSession(openSession === s.id ? null : s.id)} aria-expanded={openSession === s.id}>
                <div className="grow">
                  <div className="list-title">{fmtDateTime(s.startedAt)}</div>
                  <div className="small muted">
                    {s.results.map((r) => `${t(getDefinition(r.prescription.definitionId).nameKey)} ${fmtDeg(r.peakRom)} · ${r.repsCompleted} reps`).join(' | ')}
                  </div>
                </div>
                <span className="num small">
                  pain {s.painBefore ?? '–'}→{s.painAfter ?? '–'} · RPE {s.rpe ?? '–'}
                </span>
                {s.status !== 'completed' && <span className="badge warn">{s.status}</span>}
              </button>
            ))}
          </div>
          {openSession && <SessionSummary session={db.sessions.find((s) => s.id === openSession)!} />}
        </div>
      )}
      {tab === 'progress' && <ProgressView patientId={patient.id} />}
      {tab === 'notes' && <NotesTab db={db} patient={patient} actorId={user.id} />}
    </div>
  );
}

function OverviewTab({ db, patient }: { db: DB; patient: Patient }) {
  const prog = activeProgram(db, patient.id);
  const a = adherence(db, patient.id, 28);
  const last = sessionsFor(db, patient.id)[0];
  const la = latestAssessment(db, patient.id);
  return (
    <div className="grid cols-2">
      <section className="panel stack">
        <div className="row between">
          <h2>Concern & goal</h2>
          <CategoryBadge kind="pro" />
        </div>
        <p>{patient.concern ?? '–'}</p>
        <p className="muted small">Goal: {patient.goal ?? '–'}</p>
      </section>
      <section className="panel stack">
        <h2>Status</h2>
        <dl className="kv">
          <dt>Program</dt>
          <dd>{prog ? prog.title : 'None'}</dd>
          <dt>Adherence (28 d)</dt>
          <dd>{a.pct === null ? '–' : `${Math.round(a.pct * 100)}% (${a.done}/${a.planned})`}</dd>
          <dt>Last session</dt>
          <dd>{last ? fmtDateTime(last.startedAt) : '–'}</dd>
          <dt>Latest assessment</dt>
          <dd>{la ? `${la.status.replace('_', ' ')} · ${fmtDate(la.createdAt)}` : '–'}</dd>
        </dl>
      </section>
    </div>
  );
}

function AssessmentTab({ db, patient }: { db: DB; patient: Patient }) {
  const list = db.assessments.filter((a) => a.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (list.length === 0) return <p className="muted">No assessments yet.</p>;
  return (
    <div className="stack">
      {list.map((a) => {
        const regions = db.painRegions.filter((r) => r.assessmentId === a.id).map((r) => r.regionId);
        return (
          <div key={a.id} className="panel grid cols-2">
            <div className="stack tight">
              <div className="row between">
                <strong>{fmtDateTime(a.createdAt)}</strong>
                <span className={`badge ${a.status === 'reviewed' ? 'clinical' : a.status === 'safety_hold' ? 'danger' : 'review'}`}>{a.status.replace('_', ' ')}</span>
              </div>
              <p className="small">{regions.map(regionLabel).join(', ') || 'No regions recorded'}</p>
              <Link className="btn secondary sm" to={`/c/assessments/${a.id}`}>
                Open review
              </Link>
            </div>
            {regions.length > 0 && <BodyMap selected={regions} onToggle={() => undefined} readOnly compact initialView={regions.some((r) => /back|buttock|calf|heel|achilles/.test(r)) ? 'back' : 'front'} />}
          </div>
        );
      })}
    </div>
  );
}

function MeasurementsTab({ db, patient, actorId }: { db: DB; patient: Patient; actorId: string }) {
  const { t } = useT();
  const rows = db.measurements.filter((m) => m.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [type, setType] = useState<MeasurementType>('knee_flexion');
  const [side, setSide] = useState<'left' | 'right'>('left');
  const [value, setValue] = useState('');
  const types: MeasurementType[] = ['knee_flexion', 'hip_flexion_slr', 'shoulder_flexion'];
  const addClinician = () => {
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0 || v > 200) return;
    insert(
      'measurements',
      {
        id: uuid(),
        patientId: patient.id,
        type,
        value: v,
        unit: 'deg',
        side,
        confidence: 1,
        category: 'clinician_measured',
        provenance: { source: 'clinician_goniometer', createdBy: actorId, createdAt: new Date().toISOString(), engineVersion: 'n/a', algorithmVersion: 'n/a' },
        reviewStatus: 'accepted',
        createdAt: new Date().toISOString(),
      },
      actorId,
      'goniometer',
    );
    setValue('');
  };
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row between wrap">
          <h2>Record goniometer measurement</h2>
          <CategoryBadge kind="clinician" />
        </div>
        <div className="row wrap">
          <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as MeasurementType)} aria-label="Measurement">
            {types.map((x) => (
              <option key={x} value={x}>
                {t(MEASUREMENTS[x].labelKey)}
              </option>
            ))}
          </select>
          <Segmented label="Side" value={side} onChange={setSide} options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />
          <input className="input" style={{ width: 110 }} inputMode="decimal" placeholder="deg" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Value in degrees" />
          <button className="btn primary" onClick={addClinician} disabled={!value}>
            {t('common.save')}
          </button>
        </div>
      </section>
      <div className="panel table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Measurement</th>
              <th>Value</th>
              <th>Category</th>
              <th>Confidence</th>
              <th>Source / model</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map((m) => (
              <tr key={m.id}>
                <td className="small">{fmtDate(m.createdAt)}</td>
                <td className="small">
                  {m.type.startsWith('posture.') ? t(m.type) : t(`measure.${m.type}`)} {m.side && `(${m.side})`}
                </td>
                <td className="num" style={{ fontWeight: 650 }}>
                  {m.value}
                  {m.unit === 'deg' ? '°' : '%'}
                </td>
                <td>{m.category === 'clinician_measured' ? <CategoryBadge kind="clinician" /> : <CategoryBadge kind="camera" />}</td>
                <td>{m.category === 'camera_estimate' ? <ConfidenceBadge value={m.confidence} /> : '–'}</td>
                <td className="xs mono">
                  {m.provenance.source}
                  {m.provenance.poseModel ? ` · ${m.provenance.poseModel}` : ''}
                  {m.provenance.algorithmVersion !== 'n/a' ? ` · ${m.provenance.algorithmVersion}` : ''}
                </td>
                <td>
                  <span className={`badge ${m.reviewStatus === 'accepted' ? 'clinical' : m.reviewStatus === 'rejected' ? 'danger' : 'review'}`}>{m.reviewStatus.replace('_', ' ')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProsTab({ db, patient }: { db: DB; patient: Patient }) {
  const rows = db.pros.filter((p) => p.patientId === patient.id).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const sessionPros = db.sessions.filter((s) => s.patientId === patient.id);
  return (
    <div className="stack">
      <div className="row">
        <CategoryBadge kind="pro" />
        <span className="small muted">Stored verbatim; never interpreted by the engine.</span>
      </div>
      <div className="panel table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Item</th>
              <th>Answer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="small">{fmtDate(p.recordedAt)}</td>
                <td className="small">{p.type.replace(/_/g, ' ')}</td>
                <td className="small">{formatPro(p.value)}</td>
              </tr>
            ))}
            {sessionPros.slice(0, 30).map((s) => (
              <tr key={s.id}>
                <td className="small">{fmtDate(s.startedAt)}</td>
                <td className="small">session pain before / after · RPE</td>
                <td className="small num">
                  {s.painBefore ?? '–'} / {s.painAfter ?? '–'} · {s.rpe ?? '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatPro(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ') || '–';
  if (v && typeof v === 'object') {
    const yes = Object.entries(v as Record<string, boolean>).filter(([, b]) => b).map(([k]) => k);
    return yes.length ? `YES: ${yes.join(', ')}` : 'All no';
  }
  return String(v);
}

function ProgramsTab({ db, patient, actorId }: { db: DB; patient: Patient; actorId: string }) {
  const { t } = useT();
  const programs = planHistory(db, patient.id);
  const [note, setNote] = useState('');
  if (programs.length === 0) return <p className="muted">No programs.</p>;
  const now = new Date().toISOString();
  const rxOf = (id: string) => programExercises(db, id).map((e) => e.prescription);
  return (
    <div className="stack">
      {programs.map((p) => {
        const pauses = (db.planPauses ?? []).filter((x) => x.programId === p.id).sort((a, b) => a.at.localeCompare(b.at));
        const open = openPauses(db, p.id);
        const resumes = (db.planResumes ?? []).filter((r) => r.programId === p.id);
        const due = p.status === 'active' ? reassessmentDue(db, p, now) : [];
        const prev = p.supersedes ? db.programs.find((x) => x.id === p.supersedes) : undefined;
        const changes = prev ? diffPlans(rxOf(prev.id), rxOf(p.id)) : [];
        return (
          <div key={p.id} className="panel stack tight">
            <div className="row between wrap">
              <strong>
                v{p.version ?? '?'} · {p.title}
              </strong>
              <span className="row" style={{ gap: '0.3rem' }}>
                {open.length > 0 && <span className="badge danger">paused</span>}
                <span className={`badge ${p.status === 'active' ? 'clinical' : ''}`}>{p.status}</span>
              </span>
            </div>
            <p className="small muted">
              {fmtDate(p.startDate)} – {fmtDate(p.endDate)} · approved {p.approvedAt ? fmtDateTime(p.approvedAt) : '–'}
              {prev ? ` · replaces v${prev.version ?? '?'}` : ''}
              {p.reassessAfterDays ? ` · reassess every ${p.reassessAfterDays} d` : ''}
              {p.pauseOnPainStop === false ? ' · pain-rule stop does not pause the plan' : ''}
            </p>
            {p.changeReason && <p className="small">Reason for this version: {p.changeReason}</p>}
            {changes.length > 0 && (
              <details className="small">
                <summary>
                  {changes.length} change(s) from v{prev?.version ?? '?'}
                  {changes.some((c) => c.direction === 'intensify') ? ' — includes intensification' : ''}
                </summary>
                <ul>
                  {changes.map((c, i) => (
                    <li key={i}>
                      {c.exercise.replace(':', ' · ')} — {c.field}: {c.from} → {c.to}
                      {c.direction === 'intensify' ? ' (intensifies)' : c.direction === 'reduce' ? ' (reduces)' : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {programExercises(db, p.id).map((e) => (
              <div key={e.id} className="stack tight">
                <div className="row between small">
                  <span>
                    {t(getDefinition(e.prescription.definitionId).nameKey)} ({e.prescription.side}) · v{e.prescription.definitionVersion}
                  </span>
                  <span className="num muted">
                    {e.prescription.sets}×{e.prescription.reps} · {e.prescription.target.min}–{e.prescription.target.max}° · hold {e.prescription.holdSeconds}s · {e.prescription.frequencyPerWeek}/wk
                  </span>
                </div>
                {e.prescription.alternative && (
                  <span className="xs muted">
                    Approved alternative: {t(getDefinition(e.prescription.alternative.definitionId).nameKey)} {e.prescription.alternative.sets}×{e.prescription.alternative.reps} · {e.prescription.alternative.target.min}–{e.prescription.alternative.target.max}° — when: {e.prescription.alternative.when}
                  </span>
                )}
              </div>
            ))}
            {due.length > 0 && <Notice tone="warn">Reassessment due: {due.map((d) => `${d.reason} (${fmtDate(d.since)})`).join('; ')}.</Notice>}
            {pauses.map((x) => {
              const r = resumes.find((y) => y.pauseId === x.id);
              return (
                <div key={x.id} className="small">
                  <span className={`badge ${r ? '' : 'danger'}`}>{r ? 'resolved pause' : 'open pause'}</span> {fmtDateTime(x.at)} ·{' '}
                  {x.reason === 'pain_rule' ? 'session stopped by the pain rule' : x.reason === 'patient_report' ? 'paused by the patient' : 'safety'}
                  {x.detail ? ` — “${x.detail}”` : ''}
                  {r && (
                    <span className="muted">
                      {' '}
                      · resumed {fmtDateTime(r.at)}: {r.note}
                    </span>
                  )}
                </div>
              );
            })}
            {open.length > 0 && p.status === 'active' && (
              <div className="stack tight">
                <label className="field">
                  <span>Review note (required to resume the same plan)</span>
                  <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Phoned patient; pain settled within 2 h; continue unchanged" />
                </label>
                <div className="row wrap">
                  <button
                    className="btn primary sm"
                    disabled={!note.trim()}
                    onClick={() => {
                      const at = new Date().toISOString();
                      for (const x of open) insert('planResumes', { id: uuid(), pauseId: x.id, programId: p.id, patientId: patient.id, note: note.trim(), by: actorId, at, isDemo: patient.isDemo }, actorId, 'plan_resume');
                      setNote('');
                    }}
                  >
                    Resume unchanged
                  </button>
                  <Link className="btn secondary sm" to={`/c/programs/new?patient=${patient.id}`}>
                    Publish a revised version
                  </Link>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NotesTab({ db, patient, actorId }: { db: DB; patient: Patient; actorId: string }) {
  const [body, setBody] = useState('');
  const notes = useMemo(() => db.notes.filter((n) => n.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db, patient.id]);
  const author = (id: string) => db.clinicians.find((c) => c.id === id || c.userId === id)?.name ?? '—';
  return (
    <div className="stack">
      <div className="panel stack tight">
        <div className="row between">
          <strong>New clinical note</strong>
          <CategoryBadge kind="clinical" />
        </div>
        <textarea className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Clinical interpretation, plan, reassessment findings…" />
        <button
          className="btn primary"
          disabled={!body.trim()}
          onClick={() => {
            insert('notes', { id: uuid(), patientId: patient.id, authorId: actorId, body: body.trim(), createdAt: new Date().toISOString() }, actorId);
            setBody('');
          }}
        >
          Save note
        </button>
      </div>
      {notes.map((n) => (
        <div key={n.id} className="panel stack tight">
          <div className="row between small muted">
            <span>{author(n.authorId)}</span>
            <span>{fmtDateTime(n.createdAt)}</span>
          </div>
          <p>{n.body}</p>
        </div>
      ))}
    </div>
  );
}
