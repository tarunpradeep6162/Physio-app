import { useState } from 'react';
import { CategoryBadge } from '../../components/ui';
import type { CaptureSession, DB, Measurement, Patient, StudyConditions } from '../../data/models';
import { insert, update, uuid } from '../../data/store';

/**
 * Clinician REFERENCE measurement for one capture metric (validation study, Phase 13): a
 * goniometer angle or stopwatch time taken with a documented instrument, paired with the camera
 * value so agreement can be analysed later. It is stored as a clinician-measured value, never
 * merged with the camera estimate.
 */
const INSTRUMENTS: { id: NonNullable<Measurement['reference']>['instrument']; label: string }[] = [
  { id: 'goniometer', label: 'Universal goniometer' },
  { id: 'inclinometer', label: 'Inclinometer' },
  { id: 'stopwatch', label: 'Stopwatch' },
  { id: 'video_annotation', label: 'Frame-by-frame video annotation' },
  { id: 'other', label: 'Other (describe in note)' },
];

export function ReferenceMeasure({ cap, patient, db, actorId }: { cap: CaptureSession; patient: Patient; db: DB; actorId: string }) {
  const metrics = cap.result.metrics.filter((m) => m.unit === 'deg' || m.unit === 's');
  const existing = db.measurements.filter((m) => m.captureId === cap.id && m.category === 'clinician_measured' && m.reference);
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? '');
  const [value, setValue] = useState('');
  const [instrument, setInstrument] = useState<NonNullable<Measurement['reference']>['instrument']>(metrics[0]?.unit === 's' ? 'stopwatch' : 'goniometer');
  const [blinded, setBlinded] = useState(true);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [cond, setCond] = useState<StudyConditions>({});
  if (!metrics.length) return null;
  const metric = metrics.find((m) => m.id === metricId) ?? metrics[0];
  const v = Number(value);
  const ok = value !== '' && Number.isFinite(v) && v >= 0 && v <= (metric.unit === 's' ? 120 : 200);

  const save = () => {
    if (!ok) return;
    const now = new Date().toISOString();
    insert(
      'measurements',
      {
        id: uuid(),
        patientId: cap.patientId,
        assessmentId: cap.assessmentId,
        type: `reference.${metric.id}`,
        value: v,
        unit: metric.unit === 's' ? 's' : 'deg',
        side: metric.side ?? cap.side ?? undefined,
        confidence: 1,
        category: 'clinician_measured',
        captureId: cap.id,
        metricId: metric.id,
        reference: {
          instrument,
          blinded,
          note: note.trim() || undefined,
          // Skin-tone band is kept only with the participant's separate consent for it.
          conditions: Object.keys(cond).length ? { ...cond, skinToneBand: cond.skinToneConsent ? cond.skinToneBand : undefined } : undefined,
        },
        provenance: { source: instrument === 'goniometer' || instrument === 'inclinometer' ? 'clinician_goniometer' : 'clinician_entry', createdBy: actorId, createdAt: now, engineVersion: 'n/a', algorithmVersion: 'n/a' },
        reviewStatus: 'accepted',
        createdAt: now,
        isDemo: patient.isDemo,
      },
      actorId,
      `reference:${instrument}`,
    );
    setValue('');
    setNote('');
  };

  return (
    <details className="panel" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="row between" style={{ cursor: 'pointer', minHeight: 44 }}>
        <span>
          <strong>Reference measurement</strong> <span className="xs muted">for validation ({existing.length} recorded)</span>
        </span>
        <CategoryBadge kind="clinician" />
      </summary>
      <div className="stack tight" style={{ marginTop: '0.5rem' }}>
        <p className="xs muted">
          Take the reference with a documented instrument at the same attempt. Record whether you were blinded to the camera value. Stored separately from the camera estimate; used only for agreement analysis.
        </p>
        <div className="row wrap">
          <label className="field">
            <span>Split (per participant)</span>
            <select
              className="input"
              value={patient.validationSplit ?? ''}
              onChange={(e) => update('patients', patient.id, { validationSplit: (e.target.value || undefined) as Patient['validationSplit'] }, actorId, 'validation_split')}
            >
              <option value="">Not in study</option>
              <option value="tuning">Tuning / development</option>
              <option value="evaluation">Final evaluation (locked)</option>
            </select>
          </label>
          <label className="field">
            <span>Metric</span>
            <select className="input" value={metric.id} onChange={(e) => setMetricId(e.target.value)}>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — camera {m.validity === 'valid' && m.value !== null ? `${m.value}${m.unit === 'deg' ? '°' : ' s'}` : 'not reported'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Reference value ({metric.unit === 's' ? 's' : '°'})</span>
            <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ width: '8rem' }} />
          </label>
          <label className="field">
            <span>Instrument</span>
            <select className="input" value={instrument} onChange={(e) => setInstrument(e.target.value as typeof instrument)}>
              {INSTRUMENTS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: '0.4rem', alignSelf: 'flex-end', minHeight: 44 }}>
            <input type="checkbox" checked={blinded} onChange={(e) => setBlinded(e.target.checked)} /> Assessor blinded to camera value
          </label>
        </div>
        <fieldset className="row wrap" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="xs muted">Capture conditions for subgroup reporting (optional)</legend>
          <label className="field">
            <span>Lighting</span>
            <select className="input" value={cond.lighting ?? ''} onChange={(e) => setCond((c) => ({ ...c, lighting: (e.target.value || undefined) as StudyConditions['lighting'] }))}>
              <option value="">Not recorded</option>
              <option value="even_indoor">Even indoor light</option>
              <option value="dim">Dim</option>
              <option value="backlit">Backlit (window behind)</option>
              <option value="daylight">Daylight</option>
            </select>
          </label>
          <label className="field">
            <span>Clothing</span>
            <select className="input" value={cond.clothing ?? ''} onChange={(e) => setCond((c) => ({ ...c, clothing: (e.target.value || undefined) as StudyConditions['clothing'] }))}>
              <option value="">Not recorded</option>
              <option value="fitted">Fitted</option>
              <option value="loose">Loose</option>
              <option value="limb_exposed">Limb exposed (shorts / sleeveless)</option>
            </select>
          </label>
          <label className="row" style={{ gap: '0.4rem', alignSelf: 'flex-end', minHeight: 44 }}>
            <input type="checkbox" checked={!!cond.skinToneConsent} onChange={(e) => setCond((c) => ({ ...c, skinToneConsent: e.target.checked }))} /> Participant consented to recording skin-tone band
          </label>
          {cond.skinToneConsent && (
            <label className="field">
              <span>Skin-tone band</span>
              <select className="input" value={cond.skinToneBand ?? ''} onChange={(e) => setCond((c) => ({ ...c, skinToneBand: (e.target.value || undefined) as StudyConditions['skinToneBand'] }))}>
                <option value="">Not recorded</option>
                <option value="I-II">I–II</option>
                <option value="III-IV">III–IV</option>
                <option value="V-VI">V–VI</option>
              </select>
            </label>
          )}
        </fieldset>
        <input className="input" placeholder="Note (optional, e.g. landmarking method)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row">
          <button className="btn primary sm" disabled={!ok} onClick={save}>
            Save reference
          </button>
        </div>
        {existing.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {existing.map((m) => (
              <li key={m.id}>
                {m.metricId?.replace(/_/g, ' ')}: {m.value}
                {m.unit === 's' ? ' s' : '°'} · {m.reference!.instrument}
                {m.reference!.blinded ? ' · blinded' : ' · not blinded'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
