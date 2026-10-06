import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentClinician, useCurrentUser } from '../../app/hooks';
import { IconPlus } from '../../components/icons';
import { CategoryBadge, DemoBadge, Notice, Segmented } from '../../components/ui';
import { diffLibrary, diffPlans, preparePublish, TRIGGER_LABELS, type LibraryRx } from '../../clinical/plan';
import { publishedItems } from '../../content/contentStore';
import type { ContentItem } from '../../content/library';
import type { EvidenceRef, ReassessTrigger } from '../../data/models';
import { pathwayFor } from '../../clinical/pathways';
import { EvidencePanel } from './EvidencePanel';
import { activeProgram, fmtDate, latestAssessment, programExercises } from '../../data/queries';
import { getDb, insert, insertMany, update, useDb, uuid } from '../../data/store';
import { defaultPrescription, EXERCISE_LIST, getDefinition, validatePrescription } from '../../engine/exercises/definitions';
import type { ExerciseId, ExercisePrescription } from '../../engine/exercises/types';
import { useT } from '../../i18n';

/**
 * Rehabilitation Program Builder. Every parameter the patient app executes is set here by the
 * clinician. Publishing creates the next numbered plan version (Phase 9): the previous version is
 * archived (still readable), changes are listed field by field, an intensification needs a
 * reason, and each exercise — and its approved alternative — is pinned to its definition version.
 */

const ERR_TEXT: Record<string, string> = {
  target_min_lt_max: 'Target minimum must be below maximum.',
  target_out_of_range: 'Target is outside the range this exercise definition supports.',
  target_below_rest: 'Target minimum is too close to the resting position to detect a repetition.',
  reps_range: 'Repetitions must be 1–50.',
  sets_range: 'Sets must be 1–10.',
  hold_range: 'Hold must be 0–60 s.',
  rest_range: 'Rest must be 0–600 s.',
  alternative_when_required: 'Say when the patient may use the alternative.',
  intensify_needs_reason: 'This version increases load, range, volume, frequency or loosens a pain limit — record the reason.',
  reassess_days_range: 'Reassessment interval must be 1–365 days.',
};
const errText = (e: string) => ERR_TEXT[e] ?? (e.startsWith('alternative_') ? `Alternative: ${ERR_TEXT[e.slice(12)] ?? e}` : e);

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
  const [title, setTitle] = useState(existing?.title ?? 'Phase 1 — range of motion');
  const today = new Date().toISOString().slice(0, 10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(new Date(Date.now() + 42 * 86_400_000).toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [advice, setAdvice] = useState(existing?.patientAdvice ?? '');
  const [precautions, setPrecautions] = useState(existing?.patientPrecautions ?? '');
  const [changeReason, setChangeReason] = useState('');
  const [reassessDays, setReassessDays] = useState<string>(existing?.reassessAfterDays ? String(existing.reassessAfterDays) : '28');
  const [triggers, setTriggers] = useState<ReassessTrigger[]>(existing?.reassessTriggers ?? ['pain_stop', 'patient_pause']);
  const [pauseOnPainStop, setPauseOnPainStop] = useState(existing?.pauseOnPainStop ?? true);
  const [scheduleDays, setScheduleDays] = useState<number[]>(existing?.scheduleDays ?? []);
  const [publishError, setPublishError] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRef[]>(existing?.evidence ?? []);
  const [rows, setRows] = useState<Row[]>(() =>
    existing
      ? programExercises(db, existing.id).map((e) => ({
          key: uuid(),
          rx: { ...e.prescription },
        }))
      : [{ key: uuid(), rx: defaultPrescription('knee_flexion', 'left') }],
  );
  const [published, setPublished] = useState(false);
  const [lib, setLib] = useState<LibraryRx[]>(() => (existing ? (db.programLibraryItems ?? []).filter((l) => l.programId === existing.id).sort((a, b) => a.order - b.order).map(({ id: _i, programId: _p, order: _o, ...r }) => r) : []));
  const library = publishedItems(db);

  if (!user || !clinician) return null;
  const patient = db.patients.find((p) => p.id === patientId);
  const errors = rows.map((r) => [
    ...validatePrescription(r.rx),
    ...(r.rx.alternative ? [...validatePrescription(r.rx.alternative).map((e) => `alternative_${e}`), ...(r.rx.alternative.when.trim() ? [] : ['alternative_when_required'])] : []),
  ]);
  const changes = existing
    ? [
        ...diffPlans(
          programExercises(db, existing.id).map((e) => e.prescription),
          rows.map((r) => r.rx),
        ),
        ...diffLibrary((db.programLibraryItems ?? []).filter((l) => l.programId === existing.id), lib),
      ]
    : [];
  const intensifies = changes.some((c) => c.direction === 'intensify');
  const libOk = lib.every((l) => l.sets >= 1 && l.frequencyPerWeek >= 1 && (l.reps || l.holdSeconds || l.durationSeconds));
  const valid = patient && rows.length + lib.length > 0 && libOk && errors.every((e) => e.length === 0) && start <= end && title.trim() && (!intensifies || changeReason.trim());

  const setRx = (key: string, patch: Partial<ExercisePrescription>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, rx: { ...r.rx, ...patch } } : r)));

  const publish = () => {
    if (!valid || !patient) return;
    const plan = preparePublish(
      getDb(),
      {
        patientId: patient.id,
        clinicianId: clinician.id,
        title,
        startDate: start,
        endDate: end,
        notes,
        patientAdvice: advice,
        patientPrecautions: precautions,
        changeReason,
        reassessAfterDays: reassessDays === '' ? undefined : Number(reassessDays),
        reassessTriggers: triggers,
        pauseOnPainStop,
        scheduleDays,
        exercises: rows.map((r) => r.rx),
        library: lib,
        evidence,
        isDemo: patient.isDemo,
      },
      new Date().toISOString(),
      uuid,
      (rx) => getDefinition(rx.definitionId).version,
    );
    if (plan.errors.length || !plan.program) {
      setPublishError(plan.errors);
      return;
    }
    if (plan.previous) update('programs', plan.previous.id, { status: 'archived' }, user.id, `superseded by v${plan.program.version}`);
    insert('programs', plan.program, user.id, `approve_publish v${plan.program.version}`);
    insertMany('programExercises', plan.programExercises!, user.id);
    insertMany('programLibraryItems', plan.programLibraryItems ?? [], user.id);
    // A reviewed new version answers any pause on the one it replaces.
    for (const pause of plan.closesPauses)
      insert(
        'planResumes',
        {
          id: uuid(),
          pauseId: pause.id,
          programId: pause.programId,
          patientId: patient.id,
          note: `Reviewed and replaced by plan v${plan.program.version}`,
          by: user.id,
          at: plan.program.approvedAt!,
          isDemo: patient.isDemo,
        },
        user.id,
        'plan_resume',
      );
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
      {existing && (
        <Notice tone="warn">
          Publishing creates plan version {(existing.version ?? 1) + 1} and replaces v{existing.version ?? 1} “{existing.title}” (approved {existing.approvedAt ? fmtDate(existing.approvedAt) : '—'}).
          Earlier versions stay readable in the patient record.
        </Notice>
      )}

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
                  onChange={(e) =>
                    setRows((rs) =>
                      rs.map((x) =>
                        x.key === r.key
                          ? {
                              ...x,
                              rx: defaultPrescription(e.target.value as ExerciseId, x.rx.side),
                            }
                          : x,
                      ),
                    )
                  }
                  aria-label="Exercise"
                >
                  {EXERCISE_LIST.map((d) => (
                    <option key={d.id} value={d.id}>
                      {t(d.nameKey)} (v{d.version})
                    </option>
                  ))}
                </select>
                <Segmented
                  label="Side"
                  value={r.rx.side}
                  onChange={(side) => setRx(r.key, { side })}
                  options={[
                    { id: 'left', label: 'Left' },
                    { id: 'right', label: 'Right' },
                  ]}
                />
              </div>
              <button className="btn ghost sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                {t('common.remove')}
              </button>
            </div>
            <p className="small muted">
              {t(def.summaryKey)} Measures {t(`measure.${def.primary}`).toLowerCase()} (camera-estimated, lateral view). Supported target range {def.allowedTargetRange.min}–
              {def.allowedTargetRange.max}°.
            </p>
            <div className="grid cols-4">
              <NumField label="Sets" value={r.rx.sets} onChange={(v) => setRx(r.key, { sets: num(v) })} />
              <NumField label="Repetitions" value={r.rx.reps} onChange={(v) => setRx(r.key, { reps: num(v) })} />
              <NumField label="ROM target min (°)" value={r.rx.target.min} onChange={(v) => setRx(r.key, { target: { ...r.rx.target, min: num(v) } })} />
              <NumField label="ROM target max (°)" value={r.rx.target.max} onChange={(v) => setRx(r.key, { target: { ...r.rx.target, max: num(v) } })} />
              <NumField label="Hold (s)" value={r.rx.holdSeconds} onChange={(v) => setRx(r.key, { holdSeconds: num(v) })} />
              <NumField label="Rest between sets (s)" value={r.rx.restSeconds} onChange={(v) => setRx(r.key, { restSeconds: num(v) })} />
              <NumField
                label="Min. rep duration (s) — tempo"
                value={r.rx.tempo.minRepMs / 1000}
                step={0.5}
                onChange={(v) =>
                  setRx(r.key, {
                    tempo: { ...r.rx.tempo, minRepMs: num(v) * 1000 },
                  })
                }
              />
              <NumField label="Frequency (per week)" value={r.rx.frequencyPerWeek} onChange={(v) => setRx(r.key, { frequencyPerWeek: num(v) })} />
            </div>
            <label className="field">
              <span>Special instructions (shown to patient)</span>
              <input className="input" value={r.rx.instructions ?? ''} onChange={(e) => setRx(r.key, { instructions: e.target.value || undefined })} />
            </label>
            <label className="field">
              <span>Progression plan / criteria (clinician-applied — never automatic)</span>
              <input
                className="input"
                value={r.rx.progression ?? ''}
                placeholder="e.g. If pain ≤ 3/10 and target met 2 sessions running, raise target by 10° at review"
                onChange={(e) => setRx(r.key, { progression: e.target.value || undefined })}
              />
            </label>
            <div className="grid cols-2">
              <NumField
                label="Pause session if patient-reported pain ≥ (0–10, blank = off)"
                value={r.rx.painStopAt ?? NaN}
                onChange={(v) =>
                  setRx(r.key, {
                    painStopAt: v === '' ? undefined : Math.max(0, Math.min(10, Number(v))),
                  })
                }
              />
              <NumField
                label="…or if pain rises by ≥ (points above pre-session)"
                value={r.rx.painRiseStop ?? NaN}
                onChange={(v) =>
                  setRx(r.key, {
                    painRiseStop: v === '' ? undefined : Math.max(1, Math.min(10, Number(v))),
                  })
                }
              />
            </div>
            <AlternativeEditor rx={r.rx} onChange={(alternative) => setRx(r.key, { alternative })} />
            {errs.length > 0 && (
              <Notice tone="danger">
                {errs.map((e) => (
                  <div key={e}>{errText(e)}</div>
                ))}
              </Notice>
            )}
          </section>
        );
      })}
      <button
        className="btn secondary"
        onClick={() =>
          setRows((rs) => [
            ...rs,
            {
              key: uuid(),
              rx: defaultPrescription('shoulder_flexion', 'right'),
            },
          ])
        }
      >
        <IconPlus width={18} /> Add exercise
      </button>
      <LibraryPicker library={library} value={lib} onChange={setLib} patientEquipment={patient?.equipment} minutesPerDay={patient?.minutesPerDay} />
      <label className="field">
        <span>Home advice for the patient (shown in their app, e.g. ice or heat, pacing)</span>
        <textarea className="input" value={advice} onChange={(e) => setAdvice(e.target.value)} />
      </label>
      <label className="field">
        <span>Precautions for the patient (when to stop, what to avoid)</span>
        <textarea className="input" value={precautions} onChange={(e) => setPrecautions(e.target.value)} />
      </label>
      <label className="field">
        <span>Program notes (clinician only)</span>
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <EvidencePanel
        key={patientId}
        value={evidence}
        onChange={setEvidence}
        actorId={user.id}
        suggestedQuery={(() => {
          const a = patient ? latestAssessment(db, patient.id) : undefined;
          return a ? `${pathwayFor(a).label.toLowerCase()} exercise therapy` : '';
        })()}
      />

      <section className="panel stack">
        <h2>Reassessment and pauses</h2>
        <div className="grid cols-2">
          <label className="field">
            <span>Reassess after (days, blank = no interval)</span>
            <input className="input num" type="number" min={1} max={365} value={reassessDays} onChange={(e) => setReassessDays(e.target.value)} />
          </label>
          <label className="row" style={{ gap: '0.5rem', alignSelf: 'end' }}>
            <input type="checkbox" checked={pauseOnPainStop} onChange={(e) => setPauseOnPainStop(e.target.checked)} />
            <span>Pause the whole plan when a session is stopped by the pain rule (you resume it)</span>
          </label>
        </div>
        <fieldset className="stack tight" style={{ border: 0, padding: 0 }}>
          <legend className="small">Also mark reassessment due when:</legend>
          {(Object.keys(TRIGGER_LABELS) as ReassessTrigger[]).map((tr) => (
            <label key={tr} className="row small" style={{ gap: '0.5rem' }}>
              <input type="checkbox" checked={triggers.includes(tr)} onChange={(e) => setTriggers((ts) => (e.target.checked ? [...ts, tr] : ts.filter((x) => x !== tr)))} />
              {TRIGGER_LABELS[tr]}
            </label>
          ))}
        </fieldset>
        <fieldset className="stack tight" style={{ border: 0, padding: 0 }}>
          <legend className="small">Session days (none ticked = any days, up to the weekly frequency)</legend>
          <div className="row wrap" style={{ gap: '0.75rem' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
              <label key={d} className="row small" style={{ gap: '0.3rem' }}>
                <input type="checkbox" checked={scheduleDays.includes(i)} onChange={(e) => setScheduleDays((ds) => (e.target.checked ? [...ds, i] : ds.filter((x) => x !== i)))} />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="xs muted">These are reminders you choose. The patient app can pause a plan; it can never change or intensify it.</p>
      </section>
      {existing && (
        <section className="panel stack tight">
          <h2>Changes from v{existing.version ?? 1}</h2>
          {changes.length === 0 ? (
            <p className="small muted">No exercise parameters changed.</p>
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Plan changes (scrolls sideways on small screens)">
              <table className="data">
                <thead>
                  <tr>
                    <th>Exercise</th>
                    <th>Field</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c, i) => (
                    <tr key={i}>
                      <td>{c.exercise.replace(':', ' · ')}</td>
                      <td>{c.field}</td>
                      <td className="num">{c.from}</td>
                      <td className="num">{c.to}</td>
                      <td>{c.direction === 'intensify' ? <span className="badge warn">intensifies</span> : c.direction === 'reduce' ? 'reduces' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="field">
            <span>
              Reason for this version
              {intensifies ? ' (required — this version intensifies the plan)' : ''}
            </span>
            <input
              className="input"
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="e.g. Reviewed at reassessment: target met with pain ≤ 3/10"
              aria-invalid={intensifies && !changeReason.trim()}
            />
          </label>
        </section>
      )}
      <Notice>The patient app executes these parameters exactly. The engine never changes targets on its own; progressions require a new approved plan version.</Notice>
      {publishError.length > 0 && <Notice tone="danger">{publishError.map(errText).join(' ')}</Notice>}
      <button className="btn primary lg" disabled={!valid} onClick={publish}>
        Approve & send to patient
      </button>
    </div>
  );
}

/** Approved (published) library items only; each carries its own dosage in this plan version. */
function LibraryPicker({ library, value, onChange, patientEquipment, minutesPerDay }: { library: ContentItem[]; value: LibraryRx[]; onChange: (v: LibraryRx[]) => void; patientEquipment?: string[]; minutesPerDay?: number }) {
  // Equipment the item needs that the patient did not list (only when the patient answered the question).
  const missing = (it: ContentItem) => (patientEquipment ? it.equipment.filter((q) => q !== 'none' && !patientEquipment.includes(q)) : []);
  const [pick, setPick] = useState('');
  const set = (i: number, patch: Partial<LibraryRx>) => onChange(value.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const avail = library.filter((it) => !value.some((v) => v.itemId === it.id));
  return (
    <section className="panel stack">
      <div className="row between wrap">
        <h2>Library exercises (not camera-tracked)</h2>
        <span className="xs muted">Approved library items only · the patient reports completion</span>
      </div>
      <p className="xs muted">
        Patient-reported:{' '}
        {patientEquipment ? `equipment at home — ${patientEquipment.length ? patientEquipment.join(', ').replace(/_/g, ' ') : 'none listed'}` : 'equipment not answered'}
        {' · '}
        {minutesPerDay ? `about ${minutesPerDay} min a day for exercise` : 'daily time not answered'}. In-clinic-only items cannot be added to a home plan.
      </p>
      {value.map((l, i) => {
        const it = library.find((x) => x.id === l.itemId);
        return (
          <div key={l.itemId} className="stack tight" style={{ borderTop: i ? '1px solid var(--line)' : undefined, paddingTop: i ? '0.5rem' : undefined }}>
            <div className="row between wrap">
              <strong>
                {it?.title ?? l.itemId} <span className="xs muted">v{l.itemVersion}</span>
              </strong>
              <button className="btn ghost sm" onClick={() => onChange(value.filter((_, k) => k !== i))}>
                Remove
              </button>
            </div>
            <div className="grid cols-4">
              <NumField label="Sets" value={l.sets} onChange={(v) => set(i, { sets: num(v) ?? 0 })} />
              <NumField label="Repetitions" value={l.reps ?? NaN} onChange={(v) => set(i, { reps: num(v) })} />
              <NumField label="Hold (s)" value={l.holdSeconds ?? NaN} onChange={(v) => set(i, { holdSeconds: num(v) })} />
              <NumField label="Duration (s)" value={l.durationSeconds ?? NaN} onChange={(v) => set(i, { durationSeconds: num(v) })} />
              <NumField label="Frequency (per week)" value={l.frequencyPerWeek} onChange={(v) => set(i, { frequencyPerWeek: num(v) ?? 0 })} />
            </div>
          </div>
        );
      })}
      {library.length === 0 ? (
        <p className="small muted">No library item is approved yet. Items become available here after review in the Library.</p>
      ) : (
        <div className="row wrap">
          <select className="input" style={{ width: 'auto' }} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Library item">
            <option value="">Choose an approved item…</option>
            {avail.map((it) => (
              <option key={it.id} value={it.id} disabled={it.supervision === 'in_clinic'}>
                {it.title} (v{it.version}){it.supervision === 'in_clinic' ? ' — in clinic only' : ''}
                {missing(it).length ? ` — needs ${missing(it).join(', ')}, not listed by patient` : ''}
              </option>
            ))}
          </select>
          <button
            className="btn secondary sm"
            disabled={!pick}
            onClick={() => {
              const it = library.find((x) => x.id === pick)!;
              if (it.supervision === 'in_clinic') return;
              onChange([...value, { itemId: it.id, itemVersion: it.version, ...it.defaultDosage }]);
              setPick('');
            }}
          >
            Add
          </button>
        </div>
      )}
    </section>
  );
}

function AlternativeEditor({ rx, onChange }: { rx: ExercisePrescription; onChange: (alt: ExercisePrescription['alternative']) => void }) {
  const { t } = useT();
  const alt = rx.alternative;
  if (!alt)
    return (
      <button
        className="btn ghost sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() =>
          onChange({
            ...defaultPrescription(rx.definitionId === 'knee_flexion' ? 'straight_leg_raise' : 'knee_flexion', rx.side),
            painStopAt: rx.painStopAt,
            painRiseStop: rx.painRiseStop,
            when: '',
          })
        }
      >
        + Approved alternative
      </button>
    );
  const set = (patch: Partial<NonNullable<ExercisePrescription['alternative']>>) => onChange({ ...alt, ...patch });
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <div className="stack tight" style={{ borderLeft: '3px solid var(--line)', paddingLeft: '0.75rem' }}>
      <div className="row between wrap">
        <strong className="small">Approved alternative</strong>
        <button className="btn ghost sm" onClick={() => onChange(undefined)}>
          {t('common.remove')}
        </button>
      </div>
      <div className="grid cols-4">
        <label className="field">
          <span>Exercise</span>
          <select
            className="input"
            value={alt.definitionId}
            onChange={(e) =>
              onChange({
                ...defaultPrescription(e.target.value as ExerciseId, alt.side),
                painStopAt: alt.painStopAt,
                painRiseStop: alt.painRiseStop,
                when: alt.when,
              })
            }
          >
            {EXERCISE_LIST.map((d) => (
              <option key={d.id} value={d.id}>
                {t(d.nameKey)}
              </option>
            ))}
          </select>
        </label>
        <NumField label="Sets" value={alt.sets} onChange={(v) => set({ sets: num(v) })} />
        <NumField label="Repetitions" value={alt.reps} onChange={(v) => set({ reps: num(v) })} />
        <NumField label="Target min (°)" value={alt.target.min} onChange={(v) => set({ target: { ...alt.target, min: num(v) } })} />
        <NumField label="Target max (°)" value={alt.target.max} onChange={(v) => set({ target: { ...alt.target, max: num(v) } })} />
      </div>
      <label className="field">
        <span>When the patient may choose it (shown to patient)</span>
        <input className="input" value={alt.when} onChange={(e) => set({ when: e.target.value })} placeholder="e.g. If standing is not comfortable today" />
      </label>
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
