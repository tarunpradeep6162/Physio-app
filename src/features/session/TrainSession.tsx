import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { NprsInput, Notice } from '../../components/ui';
import type { Measurement, TrainingSession } from '../../data/models';
import { activeProgram, programExercises } from '../../data/queries';
import { insert, insertMany, useDb, uuid } from '../../data/store';
import { getDefinition } from '../../engine/exercises/definitions';
import { cameraProvenance } from '../../engine/provenance';
import { useT } from '../../i18n';
import { MotionMirror, type MirrorOutcome } from '../mirror/MotionMirror';
import { SessionSummary } from './SessionSummary';

/**
 * Guided training session: pre-session pain → each prescribed exercise in the Motion Mirror →
 * post-session pain and exertion → results. Partial sessions are saved as "interrupted".
 */

type Step = { kind: 'pre' } | { kind: 'exercise'; index: number } | { kind: 'between'; index: number } | { kind: 'post' } | { kind: 'summary'; sessionId: string };

export function TrainSession() {
  const { t } = useT();
  const nav = useNavigate();
  const user = useCurrentUser();
  const patient = useCurrentPatient();
  const program = useDb((d) => (patient ? activeProgram(d, patient.id) : undefined), [patient?.id]);
  const exercises = useDb((d) => (program ? programExercises(d, program.id) : []), [program?.id]);
  const [step, setStep] = useState<Step>({ kind: 'pre' });
  const [painBefore, setPainBefore] = useState<number | null>(null);
  const [painAfter, setPainAfter] = useState<number | null>(null);
  const [rpe, setRpe] = useState<number | null>(null);
  const outcomes = useRef<(MirrorOutcome & { programExerciseId: string })[]>([]);
  const startedAt = useMemo(() => new Date().toISOString(), []);
  const saved = useDb((d) => (step.kind === 'summary' ? d.sessions.find((s) => s.id === step.sessionId) : undefined), [step]);

  if (!patient || !user) return null;
  if (!program || exercises.length === 0) {
    return (
      <div className="content narrow stack">
        <p>{t('home.no_program')}</p>
        <Link className="btn secondary" to="/p/home">
          {t('session.back_home')}
        </Link>
      </div>
    );
  }

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
      results: outcomes.current.map((o) => ({ ...o.result, programExerciseId: o.programExerciseId })),
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
          outcomes.current.push({ ...o, programExerciseId: pe.id });
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
            {exercises.map((e, i) => (
              <div key={e.id} className="row between small">
                <span>
                  {i + 1}. {t(getDefinition(e.prescription.definitionId, e.prescription.definitionVersion).nameKey)} · {e.prescription.side === 'left' ? t('mirror.side_left') : t('mirror.side_right')}
                </span>
                <span className="muted num">
                  {e.prescription.sets}×{e.prescription.reps} · {e.prescription.target.min}–{e.prescription.target.max}°
                </span>
              </div>
            ))}
          </div>
          {painBefore !== null && painBefore >= 8 && <Notice tone="warn">{t('safety.review_body')}</Notice>}
          <button className="btn primary lg block" disabled={painBefore === null} onClick={() => setStep({ kind: 'exercise', index: 0 })}>
            {t('session.start')}
          </button>
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
          <div className="panel stack">
            <NprsInput label={t('session.rpe')} value={rpe} onChange={setRpe} />
            <p className="xs muted">{t('session.rpe_hint')}</p>
          </div>
          <button
            className="btn primary lg block"
            disabled={painAfter === null || rpe === null}
            onClick={() => {
              const complete = outcomes.current.length === exercises.length && outcomes.current.every((o) => !o.result.endedEarly);
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
          <SessionSummary session={saved} />
          <Link to="/p/home" className="btn primary lg block">
            {t('session.back_home')}
          </Link>
        </>
      )}
    </div>
  );
}
