import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { CategoryBadge, Notice, Segmented, Stat } from '../../components/ui';
import { serverMode, signOut } from '../../data/auth';
import { getSyncStatus, onSyncStatus } from '../../data/remote/status';
import { ValidationStudyPanel } from './ValidationStudy';
import { useT } from '../../i18n';
import { ensureDemoData } from '../../data/demo';
import { OBSERVATION_RULES_VERSION } from '../../clinical/evidence';
import { HISTORY_QUESTIONNAIRE, SHOULDER_HISTORY_QUESTIONNAIRE } from '../../clinical/intake';
import { RULE_SET } from '../../clinical/reasoning';
import { SAFETY_QUESTIONNAIRE, SHOULDER_SAFETY_QUESTIONNAIRE } from '../../clinical/safety';
import { PROTOCOLS } from '../../engine/protocols/registry';
import type { ObservationThresholds } from '../../data/models';
import { setPrefs, usePrefs } from '../../data/prefs';
import { adherence, fmtDateTime, measurementSeries } from '../../data/queries';
import { getDb, purgeDemo, recordAudit, updateSettings, useDb } from '../../data/store';
import { ExceptionRulesEditor } from './Trends';
import { BarChart } from '../../components/BarChart';
import { monthlyVolume } from '../../clinical/directory';
import { clearIncidents, readIncidents } from '../../app/incidents';
import { INTENDED_USES, releaseGate } from '../../release/intendedUses';
import { activeCourseFollowUp, attendanceByMonth, localDay } from '../../clinic/backoffice';
import { patientCode } from '../../clinical/directory';

/** Attendance and follow-up, counted from appointment records only (back office). */
function AttendancePanel() {
  const db = useDb((d) => d);
  const now = new Date();
  const months = attendanceByMonth(db, now, 6);
  const follow = activeCourseFollowUp(db, now);
  const noNext = follow.filter((r) => !r.nextBooking);
  const totals = months.reduce((a, m) => ({ attended: a.attended + m.attended, missed: a.missed + m.missed, unrecorded: a.unrecorded + m.unrecorded }), { attended: 0, missed: 0, unrecorded: 0 });
  const rate = totals.attended + totals.missed ? totals.attended / (totals.attended + totals.missed) : null;
  const name = (id: string) => db.patients.find((p) => p.id === id)?.name ?? '—';
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  return (
    <section className="panel stack" aria-labelledby="attendance-h">
      <div className="row between wrap">
        <h2 id="attendance-h">Attendance and follow-up (last 6 months)</h2>
        <Link to="/c/schedule" className="small">
          Open schedule
        </Link>
      </div>
      <div className="grid cols-4">
        <Stat label="Attendance rate" value={rate === null ? '–' : `${Math.round(rate * 100)}%`} sub="attended ÷ (attended + missed)" />
        <Stat label="Missed visits" value={totals.missed} />
        <Stat label="Active treatment courses" value={follow.length} />
        <Stat label="Active, no next booking" value={noNext.length} />
      </div>
      <BarChart
        title="Visits per month by recorded outcome"
        categories={months.map((m) => monthLabel(m.month))}
        series={[
          { id: 'attended', label: 'Attended', color: '#0D9488' },
          { id: 'missed', label: 'Missed', color: '#DC2626', hatched: true },
          { id: 'cancelled', label: 'Cancelled', color: '#64748B' },
        ]}
        values={[months.map((m) => m.attended), months.map((m) => m.missed), months.map((m) => m.cancelled)]}
      />
      {totals.unrecorded > 0 && (
        <Notice tone="warn">
          {totals.unrecorded} past visit{totals.unrecorded === 1 ? ' is' : 's are'} still marked “scheduled”. Mark them attended or missed in the schedule; they are not counted either way.
        </Notice>
      )}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Active courses and next booking">
        <table className="data">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Course</th>
              <th className="num">Attended / planned</th>
              <th>Last visit</th>
              <th>Next booking</th>
            </tr>
          </thead>
          <tbody>
            {follow.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No active treatment courses.
                </td>
              </tr>
            )}
            {follow.map((r) => (
              <tr key={r.course.id}>
                <td>
                  <Link to={`/c/patients/${r.course.patientId}`}>{name(r.course.patientId)}</Link> <span className="mono xs muted">{patientCode(r.course.patientId)}</span>
                </td>
                <td>{r.course.title}</td>
                <td className="num">
                  {r.progress.attended} / {r.course.plannedSessions}
                </td>
                <td>{r.lastVisit ? localDay(r.lastVisit) : '—'}</td>
                <td>{r.nextBooking ? localDay(r.nextBooking) : <span className="badge warn">None booked</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="xs muted">Counted from appointment records only. A missing booking is an administrative prompt to contact the patient, not a clinical judgement.</p>
    </section>
  );
}

/** Go/no-go checklist for real-patient release (Phase 20). Read-only: approval is never recorded here. */
function ReleasePanel() {
  const gate = useDb((d) => releaseGate(d));
  const tone = (s: string) => (s === 'pass' ? 'clinical' : s === 'fail' ? 'danger' : 'warn');
  const counts = { fail: gate.filter((g) => g.status === 'fail').length, pending: gate.filter((g) => g.status === 'pending').length, pass: gate.filter((g) => g.status === 'pass').length };
  return (
    <section className="panel release-readiness" aria-labelledby="release-readiness-h">
      <div className="release-head">
        <div>
          <p className="eyebrow">Controlled release</p>
          <h2 id="release-readiness-h">Release readiness</h2>
          <p className="small">Real-patient use is disabled. This is a review record, not an approval control.</p>
        </div>
        <span className="badge danger">Real-patient use: disabled</span>
      </div>
      <div className="release-summary" aria-label="Release gate counts">
        <span><strong className="num">{counts.fail}</strong> failed</span>
        <span><strong className="num">{counts.pending}</strong> pending</span>
        <span><strong className="num">{counts.pass}</strong> passed</span>
      </div>
      <p className="small muted release-explain">All gates must pass before a reviewed build can enable real-patient use. The clinical lead's decision is recorded outside the app. Intended uses: {INTENDED_USES.length}; validated: {INTENDED_USES.filter((u) => u.status === 'validated').length}.</p>
      <ol className="release-gates">
        {gate.map((g) => (
          <li key={g.id} className={`release-gate release-gate-${g.status}`}>
            <div className="release-gate-copy">
              <strong>{g.label}</strong>
              <p className="small muted">{g.detail}</p>
              <span className="xs muted">Owner: {g.owner}</span>
            </div>
            <span className={`badge ${tone(g.status)}`}>{g.status}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Redacted error log kept on this device only (Phase 19). Nothing is sent anywhere. */
function IncidentsPanel() {
  const [list, setList] = useState(readIncidents());
  return (
    <section className="panel stack tight">
      <h2>Incidents on this device</h2>
      <p className="xs muted">Errors are recorded here after redaction (no names, identifiers, dates, numbers or free text) and are never sent anywhere. Export them for support if needed.</p>
      {list.length === 0 ? (
        <p className="small muted">None recorded.</p>
      ) : (
        list.slice(-10).reverse().map((i, n) => (
          <div key={n} className="xs">
            {i.at.slice(0, 16).replace('T', ' ')} · {i.kind} · {i.message}
            {i.where ? ` · ${i.where}` : ''}
            {i.build ? ` · ${i.build}` : ''}
          </div>
        ))
      )}
      <div className="row">
        <button
          className="btn secondary sm"
          disabled={!list.length}
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }));
            a.download = 'incidents.json';
            a.click();
          }}
        >
          Export
        </button>
        <button className="btn ghost sm" disabled={!list.length} onClick={() => { clearIncidents(); setList([]); }}>
          Clear
        </button>
      </div>
    </section>
  );
}
import { buildMigrationBundle } from '../../data/migration';
import type { FilterKind } from '../../engine/filters';
import type { PoseProviderId } from '../../engine/pose/provider';

/** Clinic-level analytics: interpretable aggregates and data-quality indicators. */
export function Analytics() {
  const db = useDb((d) => d);
  const withProgram = db.patients.filter((p) => db.programs.some((pr) => pr.patientId === p.id && pr.status === 'active'));
  const adh = withProgram.map((p) => adherence(db, p.id, 28).pct ?? 0);
  const meanAdh = adh.length ? adh.reduce((a, b) => a + b, 0) / adh.length : null;
  const gains = ['knee_flexion', 'hip_flexion_slr', 'shoulder_flexion'].map((type) => {
    const g = db.patients
      .map((p) => measurementSeries(db, p.id, type).camera)
      .filter((s) => s.length >= 2)
      .map((s) => s[s.length - 1].value - s[0].value);
    return { type, n: g.length, mean: g.length ? g.reduce((a, b) => a + b, 0) / g.length : null };
  });
  const results = db.sessions.flatMap((s) => s.results);
  const coverage = results.length ? results.reduce((a, r) => a + r.trackingCoverage, 0) / results.length : null;
  const cam = db.measurements.filter((m) => m.category === 'camera_estimate');
  const reviewed = cam.filter((m) => m.reviewStatus !== 'pending');
  const rejected = cam.filter((m) => m.reviewStatus === 'rejected').length;
  const confBuckets = [
    ['High (≥0.85)', cam.filter((m) => m.confidence >= 0.85).length],
    ['Moderate', cam.filter((m) => m.confidence >= 0.7 && m.confidence < 0.85).length],
    ['Low (<0.7)', cam.filter((m) => m.confidence < 0.7).length],
  ] as const;
  const maxBucket = Math.max(1, ...confBuckets.map(([, n]) => n));

  const user = useCurrentUser();
  const volume = monthlyVolume(db, 12);
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });

  return (
    <div className="content stack loose">
      <h1>Analytics</h1>
      <section className="panel stack">
        <div className="row between wrap">
          <h2>Patient volume (last 12 months)</h2>
          {user?.isDemo && <span className="badge demo">Simulated demonstration data</span>}
        </div>
        <BarChart
          title="New patient registrations and assessments started, per month"
          categories={volume.map((v) => monthLabel(v.month))}
          series={[
            { id: 'patients', label: 'New patients', color: '#0D9488' },
            { id: 'assessments', label: 'Assessments started', color: '#7C5CD6', hatched: true },
          ]}
          values={[volume.map((v) => v.newPatients), volume.map((v) => v.assessments)]}
        />
        <p className="xs muted">Counts of records in this clinic's system by the month they were created. Not a clinical measure.</p>
      </section>
      <AttendancePanel />
      <div className="grid cols-4">
        <div className="panel">
          <Stat label="Patients on a program" value={withProgram.length} />
        </div>
        <div className="panel">
          <Stat label="Mean adherence (28 d)" value={meanAdh === null ? '–' : `${Math.round(meanAdh * 100)}%`} />
        </div>
        <div className="panel">
          <Stat label="Sessions recorded" value={db.sessions.length} />
        </div>
        <div className="panel">
          <Stat label="Mean tracking coverage" value={coverage === null ? '–' : `${Math.round(coverage * 100)}%`} sub="share of exercise time with a valid measurement" />
        </div>
      </div>
      <section className="panel stack">
        <div className="row between wrap">
          <h2>Mean change in camera-estimated ROM (first → latest session)</h2>
          <CategoryBadge kind="camera" />
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="data">
            <thead>
              <tr>
                <th>Measure</th>
                <th>Patients</th>
                <th>Mean change</th>
              </tr>
            </thead>
            <tbody>
              {gains.map((g) => (
                <tr key={g.type}>
                  <td>{g.type.replace(/_/g, ' ')}</td>
                  <td className="num">{g.n}</td>
                  <td className="num">{g.mean === null ? '–' : `${g.mean >= 0 ? '+' : ''}${g.mean.toFixed(1)}°`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xs muted">Descriptive only. Camera estimates are not interchangeable with goniometer measurements until validated for this setting.</p>
      </section>
      <section className="panel stack">
        <h2>Measurement quality</h2>
        <div className="grid cols-2">
          <div className="stack tight">
            {confBuckets.map(([label, n]) => (
              <div key={label} className="row">
                <span className="small" style={{ width: 120 }}>
                  {label}
                </span>
                <div className="meter grow" aria-hidden="true">
                  <span style={{ width: `${(n / maxBucket) * 100}%` }} />
                </div>
                <span className="num small" style={{ width: 40, textAlign: 'right' }}>
                  {n}
                </span>
              </div>
            ))}
          </div>
          <dl className="kv">
            <dt>Camera estimates</dt>
            <dd className="num">{cam.length}</dd>
            <dt>Reviewed by clinician</dt>
            <dd className="num">{reviewed.length}</dd>
            <dt>Rejected at review</dt>
            <dd className="num">
              {rejected} {reviewed.length ? `(${Math.round((rejected / reviewed.length) * 100)}%)` : ''}
            </dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

const RULESETS = [
  { key: `${HISTORY_QUESTIONNAIRE.id}@${HISTORY_QUESTIONNAIRE.version}`, label: 'Adaptive history questionnaire' },
  { key: `${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version}`, label: 'Safety (red-flag) questionnaire' },
  { key: `${SHOULDER_HISTORY_QUESTIONNAIRE.id}@${SHOULDER_HISTORY_QUESTIONNAIRE.version}`, label: 'Shoulder history questionnaire' },
  { key: `${SHOULDER_SAFETY_QUESTIONNAIRE.id}@${SHOULDER_SAFETY_QUESTIONNAIRE.version}`, label: 'Shoulder safety (red-flag) questionnaire' },
  { key: `${RULE_SET.id}@${RULE_SET.version}`, label: 'Reasoning considerations' },
  { key: OBSERVATION_RULES_VERSION, label: 'Algorithmic observation rules' },
  ...Object.values(PROTOCOLS).map((p) => ({ key: `${p.id}@${p.version}`, label: p.title })),
];

const THRESHOLD_LABELS: Record<keyof ObservationThresholds, string> = {
  shoulder_level: 'Shoulder level difference (°)',
  pelvic_level: 'Pelvic level difference (°)',
  head_tilt: 'Head tilt (°)',
  trunk_lateral_lean: 'Trunk side lean (°)',
  knee_frontal: 'Knee frontal-plane angle (°)',
  ear_shoulder_line: 'Ear–shoulder line angle (°)',
  trunk_sagittal: 'Trunk forward/back lean (°)',
  asymmetry: 'Left/right ROM asymmetry (°)',
  knee_flexion_limited: 'Knee flexion below (°) — valid captures only',
};

/** Clinic server (Supabase) connection: where records live and whether this device is up to date. */
function ServerPanel() {
  const { t } = useT();
  const s = useSyncExternalStore(onSyncStatus, getSyncStatus);
  const server = serverMode();
  return (
    <section className="panel stack">
      <h2>{t('sync.title')}</h2>
      {server ? (
        <>
          <p className="small">{t('sync.server_body')}</p>
          <p className="small" role="status">
            <strong>{t(`sync.state_${s.state}`)}</strong>
            {s.pending > 0 && <> · {t('sync.pending', { n: s.pending })}</>}
            {s.lastSyncAt && <> · {t('sync.last', { at: fmtDateTime(s.lastSyncAt) })}</>}
          </p>
          <button className="btn secondary" disabled={s.state === 'off'} onClick={() => void import('../../data/remote/sync').then((m) => m.syncNow())}>
            {t('sync.now')}
          </button>
        </>
      ) : (
        <p className="small">{t('sync.local_body')}</p>
      )}
    </section>
  );
}

export function ClinicSettingsPage() {
  const { t } = useT();
  const user = useCurrentUser();
  const settings = useDb((d) => d.settings);
  const audit = useDb((d) => [...d.audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40));
  const users = useDb((d) => d.users);
  const hasDemo = useDb((d) => d.users.some((u) => u.isDemo));
  const prefs = usePrefs();
  const [thr, setThr] = useState(settings.thresholds);
  const clinicianName = useDb((d) => d.clinicians.find((c) => c.userId === user?.id)?.name ?? user?.displayName ?? '');
  if (!user) return null;

  return (
    <div className="content narrow stack loose">
      <h1>Settings</h1>
      <ServerPanel />
      <section className="panel stack">
        <h2>Clinic</h2>
        <label className="field">
          <span>Clinic name</span>
          <input className="input" defaultValue={settings.clinicName} onBlur={(e) => updateSettings({ clinicName: e.target.value }, user.id)} />
        </label>
        <label className="field">
          <span>Emergency number shown to patients</span>
          <input className="input" defaultValue={settings.emergencyNumber} onBlur={(e) => updateSettings({ emergencyNumber: e.target.value }, user.id)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.retainFinancialOnErasure === true} onChange={(e) => updateSettings({ retainFinancialOnErasure: e.target.checked }, user.id)} />
          <span>Keep payment records when a patient deletes their account</span>
        </label>
        <p className="xs muted" style={{ margin: 0 }}>
          Off (default): deleting an account removes the patient's courses and payments too. On: amounts, dates, payment method and receipt reference are kept for accounting, with the patient link, course name and notes removed. Decide with your accountant or legal adviser; the change is recorded in the audit log.
        </p>
      </section>

      <ExceptionRulesEditor rules={settings.exceptionRules} actorId={user.id} reviewerName={clinicianName} />
      <ReleasePanel />
      <IncidentsPanel />

      <section className="panel stack">
        <div className="row between wrap">
          <h2>Observation thresholds</h2>
          <CategoryBadge kind="observation" />
        </div>
        <p className="small muted">A camera estimate above a threshold creates a movement observation for your review. Defaults are placeholders — set them to your clinical protocol.</p>
        <div className="grid cols-2">
          {(Object.keys(THRESHOLD_LABELS) as (keyof ObservationThresholds)[]).map((k) => (
            <label key={k} className="field">
              <span>{THRESHOLD_LABELS[k]}</span>
              <input className="input num" type="number" step="0.5" value={thr[k]} onChange={(e) => setThr((x) => ({ ...x, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
        <button className="btn primary" onClick={() => updateSettings({ thresholds: thr }, user.id)}>
          Save thresholds
        </button>
      </section>

      <section className="panel stack">
        <h2>Clinical rule sets & protocols</h2>
        <p className="small muted">Safety criteria, reasoning rules, observation thresholds and test protocols are versioned. They show as DRAFT everywhere until a clinical lead records approval of that exact version here (audited).</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="data">
            <thead>
              <tr>
                <th>Rule set / protocol</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {RULESETS.map((r) => {
                const ap = settings.ruleApprovals[r.key];
                return (
                  <tr key={r.key}>
                    <td className="small">
                      {r.label} <span className="mono xs">{r.key}</span>
                    </td>
                    <td className="small">{ap ? `approved ${fmtDateTime(ap.approvedAt)}` : 'DRAFT'}</td>
                    <td>
                      {!ap && (
                        <button
                          className="btn sm secondary"
                          disabled={!!users.find((u) => u.id === user.id)?.isDemo}
                          onClick={() => {
                            if (confirm(`Record that you, as clinical lead, have reviewed and approve ${r.key}?`)) updateSettings({ ruleApprovals: { ...settings.ruleApprovals, [r.key]: { approvedBy: user.id, approvedAt: new Date().toISOString() } } }, user.id);
                          }}
                        >
                          Record approval
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <label className="field">
          <span>Landmark data retention (days, 0 = keep until deleted). Raw video is never stored.</span>
          <input className="input num" type="number" min={0} defaultValue={settings.retentionDays} onBlur={(e) => updateSettings({ retentionDays: Math.max(0, Number(e.target.value) || 0) }, user.id)} style={{ maxWidth: 160 }} />
        </label>
      </section>

      <section className="panel stack">
        <h2>Motion engine (this device)</h2>
        <div className="field">
          <span>Pose model</span>
          <Segmented<PoseProviderId>
            label="Pose model"
            value={prefs.poseProvider}
            onChange={(v) => setPrefs({ poseProvider: v })}
            options={[
              { id: 'mediapipe-lite', label: 'BlazePose Lite (fast)' },
              { id: 'mediapipe-full', label: 'BlazePose Full' },
              { id: 'mediapipe-heavy', label: 'BlazePose Heavy (most accurate, slow; 31 MB download)' },
              { id: 'simulated', label: 'Simulated (demo)' },
            ]}
          />
        </div>
        <div className="field">
          <span>Temporal filter</span>
          <Segmented<FilterKind>
            label="Filter"
            value={prefs.filter}
            onChange={(v) => setPrefs({ filter: v })}
            options={[
              { id: 'one_euro', label: 'One Euro' },
              { id: 'ema', label: 'EMA' },
              { id: 'kalman', label: 'Kalman' },
              { id: 'none', label: 'None' },
            ]}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.validationModeEnabled} onChange={(e) => updateSettings({ validationModeEnabled: e.target.checked }, user.id)} />
          <span>
            Enable Validation Mode for clinicians/engineers
            <br />
            <span className="xs muted">Never visible to patients.</span>
          </span>
        </label>
        {settings.validationModeEnabled && (
          <Link className="btn secondary" to="/validation">
            Open Validation Mode
          </Link>
        )}
      </section>

      <section className="panel stack">
        <h2>Demonstration data</h2>
        {hasDemo ? (
          <>
            <Notice>Demo patients and measurements are flagged and labelled throughout the app.</Notice>
            <button className="btn danger" onClick={() => purgeDemo(user.id)} disabled={!!users.find((u) => u.id === user.id)?.isDemo}>
              Remove all demo data
            </button>
            {users.find((u) => u.id === user.id)?.isDemo && <p className="xs muted">Sign in with a real account to remove demo data.</p>}
          </>
        ) : (
          <button className="btn secondary" onClick={() => ensureDemoData()}>
            Load demo data
          </button>
        )}
      </section>

      <ValidationStudyPanel actorId={user.id} isDemo={!!users.find((u) => u.id === user.id)?.isDemo} />
      <section className="panel stack tight">
        <h2>Data boundary</h2>
        <p className="small">
          All records in this build are stored <strong>only in this browser</strong>. Real patient use requires the server boundary (see docs/BACKEND_ARCHITECTURE.md: authenticated roles, care-relationship access, consent enforcement, hash-chained audit, retention and protected report links — database policies tested on PostgreSQL 16).
        </p>
        <p className="xs muted">The export below is the only migration path: explicit, one-way, checksummed. Demo data, local password hashes and stored images are excluded.</p>
        <div className="row">
          <button
            className="btn secondary sm"
            onClick={async () => {
              const b = await buildMigrationBundle(getDb());
              recordAudit(user.id, 'export_migration_bundle', 'db', b.sha256.slice(0, 16), `${Object.values(b.counts).reduce((a, n) => a + n, 0)} rows; excluded ${b.excluded.demoRows} demo rows`);
              const a = document.createElement('a');
              a.href = URL.createObjectURL(new Blob([JSON.stringify(b)], { type: 'application/json' }));
              a.download = `physiovision-migration-${b.sha256.slice(0, 12)}.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export for server migration
          </button>
        </div>
      </section>
      <section className="panel stack tight">
        <h2>Audit log (latest 40)</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id}>
                  <td className="xs">{fmtDateTime(e.at)}</td>
                  <td className="xs">{users.find((u) => u.id === e.actorId)?.displayName ?? e.actorId.slice(0, 8)}</td>
                  <td className="xs">
                    {e.action}
                    {e.detail ? ` · ${e.detail}` : ''}
                  </td>
                  <td className="xs mono">
                    {e.entity}/{e.entityId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <button className="btn ghost" onClick={() => signOut()}>
          {t('nav.sign_out')}
        </button>
      </section>
    </div>
  );
}
