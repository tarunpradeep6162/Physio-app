import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentClinician, useCurrentUser } from '../../app/hooks';
import { IconPlus } from '../../components/icons';
import { CategoryBadge, DemoBadge, Notice, Segmented } from '../../components/ui';
import type { Program } from '../../data/models';
import { activeProgram, fmtDate, programExercises } from '../../data/queries';
import { insert, insertMany, update, useDb, uuid } from '../../data/store';
import { defaultPrescription, EXERCISE_LIST, getDefinition, validatePrescription } from '../../engine/exercises/definitions';
import type { ExerciseId, ExercisePrescription } from '../../engine/exercises/types';
import { useT } from '../../i18n';

/**
 * Rehabilitation Program Builder. Every parameter the patient app executes is set here by the
 * clinician. Publishing archives the previous active program (it stays in history) and pins
 * each exercise to its definition version.
 */

const ERR_TEXT: Record<string, string> = {
  target_min_lt_max: 'Target minimum must be below maximum.',
  target_out_of_range: 'Target is outside the range this exercise definition supports.',
  target_below_rest: 'Target minimum is too close to the resting position to detect a repetition.',
  reps_range: 'Repetitions must be 1–50.',
  sets_range: 'Sets must be 1–10.',
  hold_range: 'Hold must be 0–60 s.',
  rest_range: 'Rest must be 0–600 s.',
};

interface Row {
  key: string;
  rx: ExercisePrescription;
}

export function ProgramBuilder() {
  const { t } = useT();
  const nav = useNavigate();
  const user = useCurrentUser();
  const clinician = useCurrentClinician();
  const db = useDb((d) => d);
  const qp = new URLSearchParams(location.search).get('patient');
  const [patientId, setPatientId] = useState(qp ?? '');
  const existing = patientId ? activeProgram(db, patientId) : undefined;
  const [title, setTitle] = useState('Phase 1 — range of motion');
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(new Date(Date.now() + 42 * 86_400_000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>(() =>
    existing ? programExercises(db, existing.id).map((e) => ({ key: uuid(), rx: { ...e.prescription } })) : [{ key: uuid(), rx: defaultPrescription('knee_flexion', 'left') }],
  );
  const [published, setPublished] = useState(false);

  if (!user || !clinician) return null;
  const patient = db.patients.find((p) => p.id === patientId);
  const errors = rows.map((r) => validatePrescription(r.rx));
  const valid = patient && rows.length > 0 && errors.every((e) => e.length === 0) && start <= end && title.trim();

  const setRx = (key: string, patch: Partial<ExercisePrescription>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, rx: { ...r.rx, ...patch } } : r)));

  const publish = () => {
    if (!valid || !patient) return;
    if (existing) update('programs', existing.id, { status: 'archived' }, user.id, 'superseded');
    const program: Program = {
      id: uuid(),
      patientId: patient.id,
      clinicianId: clinician.id,
      title: title.trim(),
      status: 'active',
      startDate: start,
      endDate: end,
      approvedAt: new Date().toISOString(),
      approvedBy: clinician.id,
      notes: notes || undefined,
      createdAt: new Date().toISOString(),
      isDemo: patient.isDemo,
    };
    insert('programs', program, user.id, 'approve_publish');
    insertMany('programExercises', rows.map((r, i) => ({ id: uuid(), programId: program.id, order: i, prescription: { ...r.rx, definitionVersion: getDefinition(r.rx.definitionId).version } })), user.id);
    setPublished(true);
  };

  if (published && patient) {
    return (
      <div className="content narrow stack">
        <Notice tone="ok">Program approved and sent to {patient.name}. The patient app will execute exactly these parameters.</Notice>
        <div className="row">
          <Link className="btn primary" to={`/c/patients/${patient.id}?tab=programs`}>
            Open patient
          </Link>
          <button className="btn secondary" onClick={() => nav('/c/overview')}>
            {t('nav.overview')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <h1>Program builder</h1>
        <CategoryBadge kind="clinical" />
      </div>

      <section className="panel grid cols-2">
        <label className="field">
          <span>Patient</span>
          <select className="input" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">Select…</option>
            {db.patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDemo ? ' (demo)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Program title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Start date</span>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>End date</span>
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </section>
      {patient?.isDemo && <DemoBadge />}
      {existing && <Notice tone="warn">Publishing will replace the active program “{existing.title}” (approved {existing.approvedAt ? fmtDate(existing.approvedAt) : '—'}). The old program stays in history.</Notice>}

      {rows.map((r, i) => {
        const def = getDefinition(r.rx.definitionId);
        const errs = errors[i];
        const num = (v: string) => (v === '' ? 0 : Number(v));
        return (
          <section key={r.key} className="panel stack">
            <div className="row between wrap">
              <div className="row wrap">
                <span className="eyebrow">#{i + 1}</span>
                <select
                  className="input"
                  style={{ width: 'auto' }}
                  value={r.rx.definitionId}
                  onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, rx: defaultPrescription(e.target.value as ExerciseId, x.rx.side) } : x)))}
                  aria-label="Exercise"
                >
                  {EXERCISE_LIST.map((d) => (
                    <option key={d.id} value={d.id}>
                      {t(d.nameKey)} (v{d.version})
                    </option>
                  ))}
                </select>
                <Segmented label="Side" value={r.rx.side} onChange={(side) => setRx(r.key, { side })} options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />
              </div>
              <button className="btn ghost sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                {t('common.remove')}
              </button>
            </div>
            <p className="small muted">
              {t(def.summaryKey)} Measures {t(`measure.${def.primary}`).toLowerCase()} (camera-estimated, lateral view). Supported target range {def.allowedTargetRange.min}–{def.allowedTargetRange.max}°.
            </p>
            <div className="grid cols-4">
              <NumField label="Sets" value={r.rx.sets} onChange={(v) => setRx(r.key, { sets: num(v) })} />
              <NumField label="Repetitions" value={r.rx.reps} onChange={(v) => setRx(r.key, { reps: num(v) })} />
              <NumField label="ROM target min (°)" value={r.rx.target.min} onChange={(v) => setRx(r.key, { target: { ...r.rx.target, min: num(v) } })} />
              <NumField label="ROM target max (°)" value={r.rx.target.max} onChange={(v) => setRx(r.key, { target: { ...r.rx.target, max: num(v) } })} />
              <NumField label="Hold (s)" value={r.rx.holdSeconds} onChange={(v) => setRx(r.key, { holdSeconds: num(v) })} />
              <NumField label="Rest between sets (s)" value={r.rx.restSeconds} onChange={(v) => setRx(r.key, { restSeconds: num(v) })} />
              <NumField label="Min. rep duration (s) — tempo" value={r.rx.tempo.minRepMs / 1000} step={0.5} onChange={(v) => setRx(r.key, { tempo: { ...r.rx.tempo, minRepMs: num(v) * 1000 } })} />
              <NumField label="Frequency (per week)" value={r.rx.frequencyPerWeek} onChange={(v) => setRx(r.key, { frequencyPerWeek: num(v) })} />
            </div>
            <label className="field">
              <span>Special instructions (shown to patient)</span>
              <input className="input" value={r.rx.instructions ?? ''} onChange={(e) => setRx(r.key, { instructions: e.target.value || undefined })} />
            </label>
            {errs.length > 0 && (
              <Notice tone="danger">
                {errs.map((e) => (
                  <div key={e}>{ERR_TEXT[e] ?? e}</div>
                ))}
              </Notice>
            )}
          </section>
        );
      })}
      <button className="btn secondary" onClick={() => setRows((rs) => [...rs, { key: uuid(), rx: defaultPrescription('shoulder_flexion', 'right') }])}>
        <IconPlus width={18} /> Add exercise
      </button>
      <label className="field">
        <span>Program notes (clinician only)</span>
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <Notice>The patient app executes these parameters exactly. The engine never changes targets on its own; progressions require a new approved program.</Notice>
      <button className="btn primary lg" disabled={!valid} onClick={publish}>
        Approve & send to patient
      </button>
    </div>
  );
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: string) => void; step?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input num" type="number" step={step} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
