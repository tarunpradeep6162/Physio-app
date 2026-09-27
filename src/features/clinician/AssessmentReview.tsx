import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { CategoryBadge, ConfidenceBadge, DemoBadge, initials, Notice } from '../../components/ui';
import type { Measurement, Observation, ReviewStatus } from '../../data/models';
import { fmtDate, fmtDateTime } from '../../data/queries';
import { insert, update, useDb, uuid } from '../../data/store';
import { useT } from '../../i18n';
import { BodyMap } from '../bodymap/BodyMap';
import { regionLabel } from '../bodymap/regions';
import { LandmarkReplay } from './LandmarkReplay';

/**
 * Clinician review of algorithmic output. Nothing a camera estimated becomes part of the
 * treatment workflow until a clinician accepts it; every decision is written to the audit log.
 */

export function AssessmentQueue() {
  const db = useDb((d) => d);
  const list = db.assessments.filter((a) => a.submittedAt).sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
  const pname = (id: string) => db.patients.find((p) => p.id === id)?.name ?? '—';
  return (
    <div className="content stack loose">
      <h1>Assessments</h1>
      <div className="panel list">
        {list.length === 0 && <p className="muted">No submitted assessments.</p>}
        {list.map((a) => {
          const pending = db.measurements.filter((m) => m.assessmentId === a.id && m.reviewStatus === 'pending').length;
          return (
            <Link key={a.id} to={`/c/assessments/${a.id}`} className="list-item">
              <div className="avatar">{initials(pname(a.patientId))}</div>
              <div className="grow">
                <div className="list-title">
                  {pname(a.patientId)} {a.isDemo && <DemoBadge />}
                </div>
                <div className="small muted">Submitted {fmtDateTime(a.submittedAt!)}</div>
              </div>
              {pending > 0 && <span className="badge review">{pending} pending</span>}
              <span className={`badge ${a.status === 'reviewed' ? 'clinical' : a.status === 'safety_hold' ? 'danger' : 'review'}`}>{a.status.replace('_', ' ')}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const RULE_TEXT: Record<string, string> = {
  shoulder_level: 'Shoulder level difference exceeded configured threshold',
  pelvic_level: 'Pelvic level difference exceeded configured threshold',
  head_tilt: 'Head tilt exceeded configured threshold',
  trunk_lateral_lean: 'Trunk side lean exceeded configured threshold',
  knee_frontal: 'Knee frontal-plane angle exceeded configured threshold',
  ear_shoulder_line: 'Ear–shoulder line angle exceeded configured threshold',
  trunk_sagittal: 'Trunk forward/back lean exceeded configured threshold',
  asymmetry: 'Left/right difference exceeded configured asymmetry threshold',
};

export function AssessmentReview() {
  const { id } = useParams();
  const { t } = useT();
  const user = useCurrentUser();
  const db = useDb((d) => d);
  const a = db.assessments.find((x) => x.id === id);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState('');
  if (!a || !user) return <div className="content">Assessment not found.</div>;
  const patient = db.patients.find((p) => p.id === a.patientId)!;
  const regions = db.painRegions.filter((r) => r.assessmentId === a.id).map((r) => r.regionId);
  const pros = db.pros.filter((p) => p.assessmentId === a.id);
  const pro = (type: string) => pros.find((p) => p.type === type)?.value;
  const scans = db.scans.filter((s) => s.assessmentId === a.id);
  const measurements = db.measurements.filter((m) => m.assessmentId === a.id);
  const observations = db.observations.filter((o) => o.assessmentId === a.id);
  const auditIds = new Set([a.id, ...measurements.map((m) => m.id), ...observations.map((o) => o.id)]);
  const audit = db.audit.filter((e) => auditIds.has(e.entityId)).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 30);
  const flags = pro('red_flags') as Record<string, boolean> | undefined;
  const flagged = flags ? Object.entries(flags).filter(([, v]) => v).map(([k]) => k) : [];
  const pending = measurements.filter((m) => m.reviewStatus === 'pending').length + observations.filter((o) => o.status === 'pending').length;

  const decide = (m: Measurement, status: ReviewStatus) => {
    update('measurements', m.id, { reviewStatus: status, reviewedBy: user.id, reviewedAt: new Date().toISOString(), reviewNote: notes[m.id] || m.reviewNote }, user.id, `review:${status}${notes[m.id] ? ' +note' : ''}`);
  };
  const decideObs = (o: Observation, status: ReviewStatus) => update('observations', o.id, { status }, user.id, `review:${status}`);
  const complete = () => {
    if (summary.trim()) insert('notes', { id: uuid(), patientId: patient.id, authorId: user.id, assessmentId: a.id, body: summary.trim(), createdAt: new Date().toISOString(), isDemo: a.isDemo }, user.id);
    update('assessments', a.id, { status: 'reviewed', reviewedAt: new Date().toISOString(), reviewedBy: user.id }, user.id, 'review_complete');
    db.alerts.filter((x) => x.patientId === patient.id && x.type === 'assessment_submitted' && !x.resolvedAt).forEach((x) => update('alerts', x.id, { resolvedAt: new Date().toISOString(), resolvedBy: user.id }, user.id, 'resolve'));
  };

  const mLabel = (m: Measurement) => (m.type.startsWith('posture.') ? t(m.type) : t(`measure.${m.type}`));

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Assessment review</p>
          <h1>
            <Link to={`/c/patients/${patient.id}`} style={{ color: 'inherit' }}>
              {patient.name}
            </Link>{' '}
            <DemoBadge show={!!a.isDemo} />
          </h1>
          <p className="muted small">
            Submitted {a.submittedAt ? fmtDateTime(a.submittedAt) : '—'} · status {a.status.replace('_', ' ')}
          </p>
        </div>
      </div>

      {flagged.length > 0 && (
        <Notice tone="danger">
          <strong>Red-flag answers: </strong>
          {flagged.join(', ')}. Camera tests and exercise were blocked for this patient pending your review.
        </Notice>
      )}

      <div className="grid cols-2">
        <section className="panel stack">
          <div className="row between">
            <h2>Pain location</h2>
            <CategoryBadge kind="pro" />
          </div>
          <BodyMap selected={regions} onToggle={() => undefined} readOnly compact initialView={regions.some((r) => /back|buttock|calf|heel|achilles/.test(r)) ? 'back' : 'front'} />
          <p className="small">{regions.map(regionLabel).join(', ')}</p>
        </section>
        <section className="panel stack">
          <div className="row between">
            <h2>Symptoms</h2>
            <CategoryBadge kind="pro" />
          </div>
          <dl className="kv">
            <dt>Pain now (NPRS)</dt>
            <dd className="num">{String(pro('nprs_now') ?? '–')}/10</dd>
            <dt>Worst 24 h</dt>
            <dd className="num">{String(pro('nprs_worst_24h') ?? '–')}/10</dd>
            <dt>Quality</dt>
            <dd>{((pro('pain_quality') as string[]) ?? []).map((q) => t(`pain.q.${q}`)).join(', ') || '–'}</dd>
            <dt>Duration</dt>
            <dd>{pro('duration') ? t(`pain.d.${pro('duration')}`) : '–'}</dd>
            <dt>Onset</dt>
            <dd>{pro('onset') ? t(`pain.o.${pro('onset')}`) : '–'}</dd>
            <dt>Aggravating</dt>
            <dd>{((pro('aggravating') as string[]) ?? []).map((q) => t(`pain.a.${q}`)).join(', ') || '–'}</dd>
            <dt>Pattern</dt>
            <dd>{pro('pattern') ? t(`pain.p.${pro('pattern')}`) : '–'}</dd>
            <dt>Concern</dt>
            <dd>{patient.concern ?? '–'}</dd>
          </dl>
        </section>
      </div>

      {observations.length > 0 && (
        <section className="panel stack">
          <div className="row between wrap">
            <h2>Movement observations</h2>
            <div className="row">
              <CategoryBadge kind="observation" />
              <CategoryBadge kind="review" />
            </div>
          </div>
          <p className="small muted">Rule-based flags against your configured thresholds (Settings). They are not diagnoses.</p>
          <div className="list">
            {observations.map((o) => (
              <div key={o.id} className="row between wrap" style={{ padding: '0.6rem 0' }}>
                <span className="grow">
                  △ {RULE_TEXT[o.rule] ?? o.rule}: <strong className="num">{o.value}°</strong> <span className="muted">(threshold {o.threshold}°)</span>
                </span>
                <span className={`badge ${o.status === 'accepted' ? 'clinical' : o.status === 'rejected' ? 'danger' : 'review'}`}>{o.status}</span>
                <button className="btn sm primary" onClick={() => decideObs(o, 'accepted')}>
                  Accept
                </button>
                <button className="btn sm danger" onClick={() => decideObs(o, 'rejected')}>
                  Reject
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {scans.map((s) => (
        <section key={s.id} className="panel grid cols-2">
          <div className="stack tight">
            <div className="row between">
              <h3>Posture capture · {t(`scan.view.${s.view}`)}</h3>
              {s.provenance.source === 'simulated_demo' && <DemoBadge simulated />}
            </div>
            <LandmarkReplay landmarks={s.landmarks} width={s.frameWidth} height={s.frameHeight} view={s.view} image={s.imageDataUrl} />
            <p className="xs muted">
              {s.imageDataUrl ? 'Still image stored with patient consent.' : 'No image stored — skeleton re-rendered from saved landmarks.'} Captured {fmtDate(s.createdAt)}.
            </p>
          </div>
          <div className="list">
            <div className="row between">
              <CategoryBadge kind="camera" />
            </div>
            {measurements
              .filter((m) => m.scanId === s.id)
              .map((m) => (
                <MeasurementRow key={m.id} m={m} label={mLabel(m)} note={notes[m.id] ?? m.reviewNote ?? ''} onNote={(v) => setNotes((n) => ({ ...n, [m.id]: v }))} onDecide={(st) => decide(m, st)} />
              ))}
          </div>
        </section>
      ))}

      {measurements.some((m) => !m.scanId) && (
        <section className="panel stack">
          <div className="row between">
            <h2>Movement tests</h2>
            <CategoryBadge kind="camera" />
          </div>
          <div className="list">
            {measurements
              .filter((m) => !m.scanId)
              .map((m) => (
                <MeasurementRow key={m.id} m={m} label={mLabel(m)} note={notes[m.id] ?? m.reviewNote ?? ''} onNote={(v) => setNotes((n) => ({ ...n, [m.id]: v }))} onDecide={(st) => decide(m, st)} />
              ))}
          </div>
        </section>
      )}

      <section className="panel stack">
        <div className="row between">
          <h2>Clinical interpretation</h2>
          <CategoryBadge kind="clinical" />
        </div>
        <textarea className="input" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Your clinical impression and plan (saved as a clinical note)…" />
        <div className="row wrap">
          <button className="btn primary" onClick={complete} disabled={a.status === 'reviewed'}>
            {a.status === 'reviewed' ? 'Review completed' : `Complete review${pending ? ` (${pending} undecided)` : ''}`}
          </button>
          <Link to={`/c/programs/new?patient=${patient.id}`} className="btn secondary">
            Build program
          </Link>
        </div>
      </section>

      <section className="panel stack tight">
        <h2>Audit trail</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id}>
                  <td className="xs">{fmtDateTime(e.at)}</td>
                  <td className="xs">{db.users.find((u) => u.id === e.actorId)?.displayName ?? e.actorId.slice(0, 8)}</td>
                  <td className="xs">{e.action}</td>
                  <td className="xs mono">{e.entity}</td>
                  <td className="xs">{e.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && <p className="xs muted">No events yet.</p>}
        </div>
      </section>
    </div>
  );
}

function MeasurementRow({ m, label, note, onNote, onDecide }: { m: Measurement; label: string; note: string; onNote: (v: string) => void; onDecide: (status: ReviewStatus) => void }) {
  const { t } = useT();
  return (
    <div className="stack tight" style={{ padding: '0.75rem 0' }}>
      <div className="row between wrap">
        <div className="grow">
          <div style={{ fontWeight: 650 }}>
            {label} {m.side && <span className="muted">({m.side})</span>}
          </div>
          <div className="xs muted mono">
            {m.provenance.source} · {m.provenance.poseModel ?? '–'} {m.provenance.poseModelVersion ?? ''} · {m.provenance.algorithmVersion}
            {m.provenance.exerciseDefinition ? ` · ${m.provenance.exerciseDefinition}@${m.provenance.exerciseDefinitionVersion}` : ''}
            {m.provenance.view ? ` · view ${m.provenance.view}` : ''}
            {m.provenance.device?.meanFps ? ` · ${m.provenance.device.meanFps} fps` : ''}
          </div>
        </div>
        <span className="num" style={{ fontSize: '1.5rem', fontWeight: 750 }}>
          {m.value}
          {m.unit === 'deg' ? '°' : '%'}
        </span>
        {m.sd !== undefined && <span className="xs muted">±{m.sd}</span>}
        <ConfidenceBadge value={m.confidence} />
      </div>
      {m.direction && <span className="small muted">{t(`posture.dir.${m.direction}`)}</span>}
      <div className="row wrap">
        <span className={`badge ${m.reviewStatus === 'accepted' ? 'clinical' : m.reviewStatus === 'rejected' ? 'danger' : 'review'}`}>{m.reviewStatus.replace('_', ' ')}</span>
        <button className="btn sm primary" onClick={() => onDecide('accepted')} aria-pressed={m.reviewStatus === 'accepted'}>
          Accept
        </button>
        <button className="btn sm danger" onClick={() => onDecide('rejected')} aria-pressed={m.reviewStatus === 'rejected'}>
          Reject
        </button>
        <button className="btn sm secondary" onClick={() => onDecide('repeat_requested')} aria-pressed={m.reviewStatus === 'repeat_requested'}>
          Repeat measurement
        </button>
        <input className="input grow" style={{ minHeight: 36, minWidth: 160 }} placeholder="Add note…" value={note} onChange={(e) => onNote(e.target.value)} aria-label={`Note for ${label}`} />
      </div>
    </div>
  );
}
