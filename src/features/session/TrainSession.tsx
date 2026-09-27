import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { NprsInput, Notice } from '../../components/ui';
import { libDose, painRuleStopped, planState } from '../../clinical/plan';
import { allVersions } from '../../content/contentStore';
import type { Measurement, TrainingSession } from '../../data/models';
import { fmtDateTime, programExercises } from '../../data/queries';
import { insert, insertMany, useDb, uuid } from '../../data/store';
import { getDefinition } from '../../engine/exercises/definitions';
import { cameraProvenance } from '../../engine/provenance';
import { useT } from '../../i18n';
import { MotionMirror, type MirrorOutcome } from '../mirror/MotionMirror';
import { SessionSummary } from './SessionSummary';

/**
 * Guided training session: pre-session pain → each prescribed exercise in the Motion Mirror →
 * post-session pain and exertion → results. Partial sessions are saved as "interrupted".
 *
 * Phase 9: only the latest approved plan version runs. A paused plan cannot be started. The
 * patient may pause it, and a session stopped by the clinician's pain rule pauses it (when the
 * plan says so); only a clinician resumes. The patient may pick a clinician-approved alternative
 * for an exercise — never a harder variant of their own.
 */

type Step = { kind: 'pre' } | { kind: 'exercise'; index: number } | { kind: 'between'; index: number } | { kind: 'post' } | { kind: 'summary'; sessionId: string };

export function TrainSession() {
  const { t } = useT();
  const nav = useNavigate();
  const user = useCurrentUser();
  const patient = useCurrentPatient();
  const state = useDb((d) => (patient ? planState(d, patient.id) : ({ kind: 'none' } as const)), [patient?.id]);
  const program = state.kind === 'none' ? undefined : state.program;
  const planExercises = useDb((d) => (program ? programExercises(d, program.id) : []), [program?.id]);
  const [useAlt, setUseAlt] = useState<Record<string, boolean>>({});
  const exercises = planExercises.map((e) => (useAlt[e.id] && e.prescription.alternative ? { ...e, prescription: e.prescription.alternative, usedAlternative: true } : { ...e, usedAlternative: false }));
  const libItems = useDb((d) => (program ? (d.programLibraryItems ?? []).filter((l) => l.programId === program.id).sort((a, b) => a.order - b.order) : []), [program?.id]);
  const content = useDb((d) => allVersions(d), []);
  const [libDone, setLibDone] = useState<Record<string, boolean>>({});
  const [pausing, setPausing] = useState(false);
  const [pauseNote, setPauseNote] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'pre' });
  const [painBefore, setPainBefore] = useState<number | null>(null);
  const [painAfter, setPainAfter] = useState<number | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const outcomes = useRef<(MirrorOutcome & { programExerciseId: string; usedAlternative: boolean })[]>([]);
  const startedAt = useMemo(() => new Date().toISOString(), []);
  const saved = useDb((d) => (step.kind === 'summary' ? d.sessions.find((s) => s.id === step.sessionId) : undefined), [step]);

  if (!patient || !user) return null;
  if (!program || (exercises.length === 0 && libItems.length === 0)) {
    return (
      <div className="content narrow stack">
        <p>{t('home.no_program')}</p>
        <Link className="btn secondary" to="/p/home">
          {t('session.back_home')}
        </Link>
      </div>
    );
  }
  // A paused plan cannot be started (the summary of a session that just caused the pause still shows).
  if (state.kind === 'paused' && step.kind !== 'summary') {
    return (
      <div className="content narrow stack">
        <h1>{t('plan.paused_title')}</h1>
        <Notice tone="warn">{t('plan.paused_body')}</Notice>
        <p className="small muted">
          {t('plan.paused_since', { at: fmtDateTime(state.pauses[0].at) })} · {t(`plan.pause_reason.${state.pauses[0].reason}`)}
        </p>
        <Link className="btn secondary" to="/p/home">
          {t('session.back_home')}
        </Link>
      </div>
    );
  }

  const pausePlan = (reason: 'pain_rule' | 'patient_report', detail: string, sessionId?: string) => {
    insert('planPauses', { id: uuid(), programId: program.id, patientId: patient.id, reason, detail: detail || undefined, sessionId, by: user.id, at: new Date().toISOString(), isDemo: patient.isDemo }, user.id, `plan_pause:${reason}`);
    insert('alerts', { id: uuid(), patientId: patient.id, type: 'plan_paused', severity: 'warning', detail: `${program.title} v${program.version ?? 1} — ${reason === 'pain_rule' ? 'session stopped by the pain rule' : 'paused by the patient'}${detail ? `: ${detail}` : ''}`, createdAt: new Date().toISOString(), isDemo: patient.isDemo }, user.id);
  };

  const save = (status: TrainingSession['status']) => {
    const first = outcomes.current[0];
    const sessionId = uuid();
    const provenance = first
      ? cameraProvenance({ createdBy: user.id, provider: first.provider, confidence: first.result.meanConfidence ?? 0, filter: first.filter, device: first.device })
      : cameraProvenance({ createdBy: user.id, provider: { id: 'none', model: 'none', version: '0', simulated: false }, confidence: 0, filter: 'none' });
    const session: TrainingSession = {
      id: sessionId,
      patientId: patient.id,
      programId: program.id,
      startedAt,
      endedAt: new Date().toISOString(),
      status,
      painBefore: painBefore ?? undefined,
      painAfter: painAfter ?? undefined,
      rpe: rpe ?? undefined,
      painEvents: outcomes.current.flatMap((o) => o.painEvents),
      libraryDone: libItems.length ? libItems.map((l) => ({ programLibraryItemId: l.id, itemId: l.itemId, itemVersion: l.itemVersion, done: !!libDone[l.id] })) : undefined,
      results: outcomes.current.map((o) => ({ ...o.result, programExerciseId: o.programExerciseId, usedAlternative: o.usedAlternative || undefined })),
      provenance,
      isDemo: patient.isDemo,
    };
    insert('sessions', session, user.id, status);
    // Each exercise's best camera-estimated ROM becomes a measurement with full provenance.
    const ms: Measurement[] = outcomes.current
      .filter((o) => o.result.peakRom !== null && o.result.repsAttempted > 0)
      .map((o) => {
        const def = getDefinition(o.result.prescription.definitionId, o.result.definitionVersion);
        return {
          id: uuid(),
          patientId: patient.id,
          sessionId,
          type: def.primary,
          value: Math.round(o.result.peakRom! * 10) / 10,
          unit: 'deg' as const,
          side: o.result.side,
          confidence: o.result.meanConfidence ?? 0,
          category: 'camera_estimate' as const,
          provenance: cameraProvenance({ createdBy: user.id, provider: o.provider, confidence: o.result.meanConfidence ?? 0, filter: o.filter, device: o.device, exercise: { id: def.id, version: def.version } }),
          reviewStatus: 'pending' as const,
          createdAt: session.startedAt,
          isDemo: patient.isDemo,
        };
      });
    insertMany('measurements', ms, user.id);
    if (painBefore !== null && painAfter !== null && painAfter - painBefore >= 2) {
      insert('alerts', { id: uuid(), patientId: patient.id, type: 'pain_increase', severity: 'warning', detail: `Session pain ${painBefore} → ${painAfter}`, createdAt: new Date().toISOString(), isDemo: patient.isDemo }, user.id);
    }
    if (painRuleStopped(session.painEvents) && program.pauseOnPainStop !== false) {
      const ev = session.painEvents!.find((e) => e.paused)!;
      pausePlan('pain_rule', `${ev.nprs}/10 (${ev.rule})`, sessionId);
    }
    const lowTracking = outcomes.current.some((o) => o.result.repsAttempted > 0 && o.result.trackingCoverage < 0.6);
    if (lowTracking) {
      insert('alerts', { id: uuid(), patientId: patient.id, type: 'tracking_quality', severity: 'info', detail: 'Tracking coverage below 60% in a session', createdAt: new Date().toISOString(), isDemo: patient.isDemo }, user.id);
    }
    return sessionId;
  };

  const exitEarly = () => {
    if (outcomes.current.length > 0) {
      const id = save('interrupted');
      setStep({ kind: 'summary', sessionId: id });
    } else nav('/p/train');
  };

  if (step.kind === 'exercise') {
    const pe = exercises[step.index];
    return (
      <MotionMirror
        key={pe.id}
        rx={pe.prescription}
        painBefore={painBefore}
        onCancel={exitEarly}
        onDone={(o) => {
          outcomes.current.push({ ...o, programExerciseId: pe.id, usedAlternative: pe.usedAlternative });
          if (o.result.endedEarly) {
            setStep({ kind: 'between', index: step.index });
            return;
          }
          if (step.index + 1 < exercises.length) setStep({ kind: 'between', index: step.index });
          else setStep({ kind: 'post' });
        }}
      />
    );
  }

  return (
    <div className="content narrow stack loose">
      {step.kind === 'pre' && (
        <>
          <h1>{t('session.pre_title')}</h1>
          <div className="panel stack">
            <NprsInput label={t('session.pre_pain')} value={painBefore} onChange={setPainBefore} />
          </div>
          <div className="panel stack tight">
            {exercises.map((e, i) => {
              const alt = planExercises[i].prescription.alternative;
              return (
                <div key={e.id} className="stack tight">
                  <div className="row between small">
                    <span>
                      {i + 1}. {t(getDefinition(e.prescription.definitionId, e.prescription.definitionVersion).nameKey)} · {e.prescription.side === 'left' ? t('mirror.side_left') : t('mirror.side_right')}
                      {e.usedAlternative && <span className="badge"> {t('plan.alternative')}</span>}
                    </span>
                    <span className="muted num">
                      {e.prescription.sets}×{e.prescription.reps} · {e.prescription.target.min}–{e.prescription.target.max}°
                    </span>
                  </div>
                  {alt && (
                    <label className="row xs" style={{ gap: '0.4rem' }}>
                      <input type="checkbox" checked={!!useAlt[e.id]} onChange={(ev) => setUseAlt((u) => ({ ...u, [e.id]: ev.target.checked }))} />
                      <span>
                        {t('plan.use_alternative', { name: t(getDefinition(alt.definitionId, alt.definitionVersion).nameKey) })} — {alt.when}
                      </span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {painBefore !== null && painBefore >= 8 && <Notice tone="warn">{t('safety.review_body')}</Notice>}
          {libItems.length > 0 && (
            <div className="panel stack tight">
              <strong className="small">{t('train.library_title')}</strong>
              {libItems.map((l) => {
                const it = content.find((c) => c.id === l.itemId && c.version === l.itemVersion);
                return (
                  <div key={l.id} className="row between small">
                    <span>{it?.title ?? l.itemId}</span>
                    <span className="muted num">{libDose(l)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <button className="btn primary lg block" disabled={painBefore === null} onClick={() => setStep(exercises.length ? { kind: 'exercise', index: 0 } : { kind: 'post' })}>
            {t('session.start')}
          </button>
          {pausing ? (
            <div className="panel stack tight">
              <label className="field">
                <span>{t('plan.pause_note')}</span>
                <input className="input" value={pauseNote} onChange={(e) => setPauseNote(e.target.value)} />
              </label>
              <p className="xs muted">{t('plan.pause_explain')}</p>
              <div className="row">
                <button className="btn primary" onClick={() => pausePlan('patient_report', pauseNote.trim())}>
                  {t('plan.pause_confirm')}
                </button>
                <button className="btn secondary" onClick={() => setPausing(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn ghost block" onClick={() => setPausing(true)}>
              {t('plan.pause_button')}
            </button>
          )}
        </>
      )}

      {step.kind === 'between' && (
        <>
          <h2>{t('cue.exercise_complete')}</h2>
          <p className="muted">
            {outcomes.current.at(-1)?.result.repsCompleted ?? 0} {t('session.reps').toLowerCase()}
          </p>
          {step.index + 1 < exercises.length && (
            <button className="btn primary lg block" onClick={() => setStep({ kind: 'exercise', index: step.index + 1 })}>
              {t('session.next_exercise')}: {t(getDefinition(exercises[step.index + 1].prescription.definitionId).nameKey)}
            </button>
          )}
          <button className="btn secondary lg block" onClick={() => setStep({ kind: 'post' })}>
            {t('session.finish')}
          </button>
        </>
      )}

      {step.kind === 'post' && (
        <>
          <h1>{t('session.post_title')}</h1>
          <div className="panel stack">
            <NprsInput label={t('session.post_pain')} value={painAfter} onChange={setPainAfter} />
          </div>
          {libItems.length > 0 && (
            <fieldset className="panel stack tight" style={{ border: 0 }}>
              <legend className="small">{t('train.library_done')}</legend>
              {libItems.map((l) => {
                const it = content.find((c) => c.id === l.itemId && c.version === l.itemVersion);
                return (
                  <label key={l.id} className="check">
                    <input type="checkbox" checked={!!libDone[l.id]} onChange={(e) => setLibDone((d) => ({ ...d, [l.id]: e.target.checked }))} />
                    <span>
                      {it?.title ?? l.itemId} <span className="xs muted">({libDose(l)})</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <div className="panel stack">
            <NprsInput label={t('session.rpe')} value={rpe} onChange={setRpe} />
            <p className="xs muted">{t('session.rpe_hint')}</p>
          </div>
          <button
            className="btn primary lg block"
            disabled={painAfter === null || rpe === null}
            onClick={() => {
              const complete = outcomes.current.length === exercises.length && outcomes.current.every((o) => !o.result.endedEarly) && libItems.every((l) => libDone[l.id]);
              const id = save(complete ? 'completed' : 'interrupted');
              setStep({ kind: 'summary', sessionId: id });
            }}
          >
            {t('common.save')}
          </button>
        </>
      )}

      {step.kind === 'summary' && saved && (
        <>
          <h1>{t('session.complete')}</h1>
          {saved.status === 'interrupted' && <Notice tone="warn">{t('session.interrupted')}</Notice>}
          {state.kind === 'paused' && <Notice tone="warn">{t('plan.paused_body')}</Notice>}
          <SessionSummary session={saved} />
          <Link to="/p/home" className="btn primary lg block">
            {t('session.back_home')}
          </Link>
        </>
      )}
    </div>
  );
}

