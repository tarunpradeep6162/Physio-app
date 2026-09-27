import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { ChipGroup, CategoryBadge, NprsInput, Notice, Steps } from '../../components/ui';
import type { Assessment } from '../../data/models';
import { getDb, insert, update, useDb, uuid } from '../../data/store';
import { defaultPrescription, getDefinition } from '../../engine/exercises/definitions';
import type { ExerciseId } from '../../engine/exercises/types';
import type { Side } from '../../engine/types';
import { useT } from '../../i18n';
import { BodyMap } from '../bodymap/BodyMap';
import { regionLabel, parseRegion } from '../bodymap/regions';
import { MotionMirror } from '../mirror/MotionMirror';
import { StaticScan } from '../scan/StaticScan';
import { replacePros, replaceRegions, saveMovementTests, saveScan, type MovementTestOutcome } from './persist';
import { RED_FLAGS, triage, type RedFlagId } from './redFlags';

/**
 * Patient assessment: body map → symptoms → safety screen → posture scan → movement tests →
 * submit for clinician review. Progress is saved after each step so an interrupted assessment
 * can be resumed.
 */

const STEP_KEYS = ['assess.steps.body', 'assess.steps.pain', 'assess.steps.safety', 'assess.steps.scan', 'assess.steps.movement', 'assess.steps.submit'];

const QUALITIES = ['sharp', 'dull', 'burning', 'throbbing', 'shooting', 'pins_needles', 'numbness', 'stiffness', 'other'] as const;
const DURATIONS = ['lt1w', '1_6w', '6_12w', 'gt3m'] as const;
const ONSETS = ['injury', 'gradual', 'surgery', 'unknown'] as const;
const AGGRAVATING = ['walking', 'stairs', 'sitting', 'bending', 'lifting', 'overhead', 'night'] as const;

/** Suggests movement tests relevant to the selected regions (patient may run any test). */
function suggestedTests(regions: string[]): { id: ExerciseId; side: Side }[] {
  const out: { id: ExerciseId; side: Side }[] = [];
  const add = (id: ExerciseId, side: Side) => !out.some((o) => o.id === id && o.side === side) && out.push({ id, side });
  const parts = regions.map(parseRegion);
  const lower = parts.some((p) => /knee|thigh|shin|calf|groin|hip|buttock|ankle/.test(p.part));
  const upper = parts.some((p) => /shoulder|upper_arm|upper_back|neck|chest/.test(p.part));
  if (lower || (!lower && !upper)) {
    for (const s of ['left', 'right'] as Side[]) add('knee_flexion', s);
    for (const s of ['left', 'right'] as Side[]) add('straight_leg_raise', s);
  }
  if (upper || (!lower && !upper)) for (const s of ['left', 'right'] as Side[]) add('shoulder_flexion', s);
  return out;
}

const measureKey = (id: ExerciseId) => getDefinition(id).primary;

export function AssessmentFlow() {
  const { t } = useT();
  const nav = useNavigate();
  const user = useCurrentUser();
  const patient = useCurrentPatient();
  const settings = useDb((d) => d.settings);
  const consents = useDb((d) => d.consents.filter((c) => c.patientId === patient?.id), [patient?.id]);
  const cameraConsent = consents.filter((c) => c.type === 'camera_processing').sort((a, b) => b.at.localeCompare(a.at))[0]?.granted ?? false;
  const imageConsent = consents.filter((c) => c.type === 'image_storage').sort((a, b) => b.at.localeCompare(a.at))[0]?.granted ?? false;

  const existing = useDb((d) => d.assessments.find((a) => a.patientId === patient?.id && (a.status === 'in_progress' || a.status === 'safety_hold') && !a.submittedAt), [patient?.id]);
  const [assessmentId, setAssessmentId] = useState<string | null>(existing?.id ?? null);
  const assessment = useDb((d) => d.assessments.find((a) => a.id === assessmentId), [assessmentId]);
  const [step, setStep] = useState(existing?.step ?? 0);

  // Local form state (hydrated from any saved answers).
  const [regions, setRegions] = useState<string[]>([]);
  const [now, setNow] = useState<number | null>(null);
  const [worst, setWorst] = useState<number | null>(null);
  const [quality, setQuality] = useState<string[]>([]);
  const [duration, setDuration] = useState<string[]>([]);
  const [onset, setOnset] = useState<string[]>([]);
  const [aggr, setAggr] = useState<string[]>([]);
  const [pattern, setPattern] = useState<string[]>([]);
  const [flags, setFlags] = useState<Partial<Record<RedFlagId, boolean>>>({});
  const [overlay, setOverlay] = useState<null | { kind: 'scan' } | { kind: 'test'; id: ExerciseId; side: Side }>(null);
  const [testsDone, setTestsDone] = useState<string[]>([]);

  useEffect(() => {
    if (!assessmentId) return;
    const d = getDb();
    setRegions(d.painRegions.filter((r) => r.assessmentId === assessmentId).map((r) => r.regionId));
    const pro = (type: string) => d.pros.find((p) => p.assessmentId === assessmentId && p.type === type)?.value;
    const num = (v: unknown) => (typeof v === 'number' ? v : null);
    const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []);
    setNow(num(pro('nprs_now')));
    setWorst(num(pro('nprs_worst_24h')));
    setQuality(arr(pro('pain_quality')));
    setDuration(arr(pro('duration')));
    setOnset(arr(pro('onset')));
    setAggr(arr(pro('aggravating')));
    setPattern(arr(pro('pattern')));
    setFlags((pro('red_flags') as Partial<Record<RedFlagId, boolean>>) ?? {});
    setTestsDone(d.measurements.filter((m) => m.assessmentId === assessmentId && !m.type.startsWith('posture.')).map((m) => `${m.type}:${m.side}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);

  const tests = useMemo(() => suggestedTests(regions), [regions]);
  const tri = triage(flags);
  const scanCount = useDb((d) => d.scans.filter((s) => s.assessmentId === assessmentId).length, [assessmentId]);

  if (!patient || !user) return null;

  const ensureAssessment = (): string => {
    if (assessmentId) return assessmentId;
    const a: Assessment = { id: uuid(), patientId: patient.id, createdBy: user.id, status: 'in_progress', createdAt: new Date().toISOString(), step: 0, isDemo: patient.isDemo };
    insert('assessments', a, user.id);
    setAssessmentId(a.id);
    return a.id;
  };

  const go = (next: number) => {
    const id = ensureAssessment();
    if (step === 0) replaceRegions(id, user.id, regions);
    if (step === 1) replacePros(patient.id, id, user.id, { nprs_now: now ?? undefined, nprs_worst_24h: worst ?? undefined, pain_quality: quality, duration: duration[0], onset: onset[0], aggravating: aggr, pattern: pattern[0] }, patient.isDemo);
    if (step === 2) {
      replacePros(patient.id, id, user.id, { red_flags: flags as Record<string, boolean> }, patient.isDemo);
      if (tri !== 'clear' && getDb().assessments.find((a) => a.id === id)?.status !== 'safety_hold') {
        update('assessments', id, { status: 'safety_hold' }, user.id, `red_flag_${tri}`);
        insert(
          'alerts',
          {
            id: uuid(),
            patientId: patient.id,
            type: tri === 'urgent' ? 'red_flag_urgent' : 'red_flag_review',
            severity: tri === 'urgent' ? 'critical' : 'warning',
            detail: RED_FLAGS.filter((f) => flags[f.id]).map((f) => f.id).join(', '),
            createdAt: new Date().toISOString(),
            isDemo: patient.isDemo,
          },
          user.id,
        );
      }
    }
    update('assessments', id, { step: next }, user.id, 'step');
    setStep(next);
    window.scrollTo(0, 0);
  };

  const submit = () => {
    const id = ensureAssessment();
    update('assessments', id, { status: tri === 'clear' ? 'submitted' : 'safety_hold', submittedAt: new Date().toISOString(), step: 5 }, user.id, 'submit');
    insert('alerts', { id: uuid(), patientId: patient.id, type: 'assessment_submitted', severity: 'info', createdAt: new Date().toISOString(), isDemo: patient.isDemo }, user.id);
    nav('/p/home');
  };

  const cameraBlocked = tri !== 'clear' || !cameraConsent;

  if (overlay?.kind === 'scan') {
    return (
      <StaticScan
        storeImages={imageConsent}
        onCancel={() => setOverlay(null)}
        onComplete={(res) => {
          if (res.length) saveScan(patient.id, ensureAssessment(), user.id, res, patient.isDemo);
          setOverlay(null);
        }}
      />
    );
  }
  if (overlay?.kind === 'test') {
    const rx = { ...defaultPrescription(overlay.id, overlay.side), reps: 3, sets: 1, holdSeconds: 1 };
    return (
      <MotionMirror
        rx={rx}
        mode="test"
        onCancel={() => setOverlay(null)}
        onDone={(o) => {
          const out: MovementTestOutcome = o;
          if (o.result.repsAttempted > 0) {
            saveMovementTests(patient.id, ensureAssessment(), user.id, [out], patient.isDemo);
            setTestsDone((d) => [...d, `${measureKey(overlay.id)}:${overlay.side}`]);
          }
          setOverlay(null);
        }}
      />
    );
  }

  return (
    <div className="content narrow stack loose">
      <div className="stack tight">
        <div className="row between">
          <span className="eyebrow">
            {t('assess.title')} · {t(STEP_KEYS[step])}
          </span>
          <span className="small muted">
            {step + 1}/{STEP_KEYS.length}
          </span>
        </div>
        <Steps total={STEP_KEYS.length} current={step} />
      </div>

      {step === 0 && (
        <section className="stack">
          <div>
            <h1>{t('body.title')}</h1>
            <p className="muted">{t('body.subtitle')}</p>
          </div>
          <BodyMap selected={regions} onToggle={(id) => setRegions((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))} />
          <div className="panel stack tight" aria-live="polite">
            <div className="row between">
              <strong>{regions.length ? t('body.selected', { n: regions.length }) : t('body.none_selected')}</strong>
              {regions.length > 0 && (
                <button className="btn ghost sm" onClick={() => setRegions([])}>
                  {t('body.clear')}
                </button>
              )}
            </div>
            <div className="chips">
              {regions.map((r) => (
                <button key={r} className="chip" aria-pressed="true" onClick={() => setRegions((x) => x.filter((y) => y !== r))} aria-label={`${t('common.remove')} ${regionLabel(r)}`}>
                  {regionLabel(r)} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          </div>
          <button className="btn primary lg block" disabled={regions.length === 0} onClick={() => go(1)}>
            {t('common.continue')}
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="stack loose">
          <div className="stack tight">
            <h1>{t('pain.title')}</h1>
            <div className="row">
              <CategoryBadge kind="pro" />
              <span className="small muted">{t('pain.subtitle')}</span>
            </div>
          </div>
          <div className="panel">
            <NprsInput label={t('pain.now')} value={now} onChange={setNow} />
          </div>
          <div className="panel">
            <NprsInput label={t('pain.worst')} value={worst} onChange={setWorst} />
          </div>
          <div className="stack tight">
            <h3>{t('pain.quality')}</h3>
            <p className="small muted">{t('pain.quality_hint')}</p>
            <ChipGroup multi label={t('pain.quality')} options={QUALITIES.map((q) => ({ id: q, label: t(`pain.q.${q}`) }))} value={quality} onChange={setQuality} />
          </div>
          <div className="stack tight">
            <h3>{t('pain.duration')}</h3>
            <ChipGroup label={t('pain.duration')} options={DURATIONS.map((q) => ({ id: q, label: t(`pain.d.${q}`) }))} value={duration} onChange={setDuration} />
          </div>
          <div className="stack tight">
            <h3>{t('pain.onset')}</h3>
            <ChipGroup label={t('pain.onset')} options={ONSETS.map((q) => ({ id: q, label: t(`pain.o.${q}`) }))} value={onset} onChange={setOnset} />
          </div>
          <div className="stack tight">
            <h3>{t('pain.aggravating')}</h3>
            <ChipGroup multi label={t('pain.aggravating')} options={AGGRAVATING.map((q) => ({ id: q, label: t(`pain.a.${q}`) }))} value={aggr} onChange={setAggr} />
          </div>
          <div className="stack tight">
            <h3>{t('pain.pattern')}</h3>
            <ChipGroup label={t('pain.pattern')} options={(['constant', 'intermittent'] as const).map((q) => ({ id: q, label: t(`pain.p.${q}`) }))} value={pattern} onChange={setPattern} />
          </div>
          <div className="row">
            <button className="btn secondary" onClick={() => go(0)}>
              {t('common.back')}
            </button>
            <button className="btn primary lg grow" disabled={now === null || worst === null || duration.length === 0} onClick={() => go(2)}>
              {t('common.continue')}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          <div>
            <h1>{t('safety.title')}</h1>
            <p className="muted">{t('safety.subtitle')}</p>
          </div>
          <div className="panel list">
            {RED_FLAGS.map((f) => (
              <div key={f.id} className="row between" style={{ padding: '0.75rem 0', gap: '1rem' }}>
                <span className="grow">{t(`safety.q.${f.id}`)}</span>
                <div className="segmented" role="radiogroup" aria-label={t(`safety.q.${f.id}`)}>
                  <button type="button" role="radio" aria-checked={flags[f.id] === false} aria-pressed={flags[f.id] === false} onClick={() => setFlags((x) => ({ ...x, [f.id]: false }))}>
                    {t('common.no')}
                  </button>
                  <button type="button" role="radio" aria-checked={flags[f.id] === true} aria-pressed={flags[f.id] === true} onClick={() => setFlags((x) => ({ ...x, [f.id]: true }))}>
                    {t('common.yes')}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {tri === 'urgent' && (
            <Notice tone="danger">
              <strong>{t('safety.urgent_title')}</strong>
              <p>{t('safety.urgent_body', { emergency: settings.emergencyNumber })}</p>
            </Notice>
          )}
          {tri === 'review' && (
            <Notice tone="warn">
              <strong>{t('safety.review_title')}</strong>
              <p>{t('safety.review_body')}</p>
            </Notice>
          )}
          <p className="xs muted">{t('safety.content_notice')}</p>
          <div className="row">
            <button className="btn secondary" onClick={() => go(1)}>
              {t('common.back')}
            </button>
            <button className="btn primary lg grow" disabled={RED_FLAGS.some((f) => flags[f.id] === undefined)} onClick={() => go(tri === 'clear' ? 3 : 5)}>
              {t('common.continue')}
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="stack">
          <div>
            <h1>{t('scan.title')}</h1>
            <p className="muted">{t('calib.subtitle')}</p>
          </div>
          {!cameraConsent && (
            <Notice tone="warn">
              {t('onb.consent.required')} <Link to="/p/profile">{t('nav.profile')}</Link>
            </Notice>
          )}
          <div className="panel dark stack">
            <div className="row">
              <span className="pulse-dot" aria-hidden="true" />
              <strong>{t('onb.consent.camera_title')}</strong>
            </div>
            <p className="small muted">{t('onb.consent.video_body')}</p>
            <button className="btn primary lg" disabled={cameraBlocked} onClick={() => setOverlay({ kind: 'scan' })}>
              {scanCount ? t('scan.retake') : t('calib.start_scan')}
            </button>
            {scanCount > 0 && <span className="badge ok">✓ {t('scan.captured')} ({scanCount})</span>}
          </div>
          <div className="row">
            <button className="btn secondary" onClick={() => go(2)}>
              {t('common.back')}
            </button>
            <button className="btn primary lg grow" onClick={() => go(4)}>
              {scanCount ? t('common.continue') : t('common.skip')}
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="stack">
          <div>
            <h1>{t('assess.steps.movement')}</h1>
            <p className="muted">{t('assess.submit_note')}</p>
          </div>
          <div className="panel list">
            {tests.map((x) => {
              const done = testsDone.includes(`${measureKey(x.id)}:${x.side}`);
              return (
                <div key={`${x.id}-${x.side}`} className="list-item">
                  <div className="grow">
                    <div className="list-title">{t(getDefinition(x.id).nameKey)}</div>
                    <div className="small muted">{x.side === 'left' ? t('mirror.side_left') : t('mirror.side_right')} · 3 reps</div>
                  </div>
                  {done && <span className="badge ok">✓</span>}
                  <button className="btn secondary sm" disabled={cameraBlocked} onClick={() => setOverlay({ kind: 'test', id: x.id, side: x.side })}>
                    {done ? t('scan.retake') : t('common.start')}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="row">
            <button className="btn secondary" onClick={() => go(3)}>
              {t('common.back')}
            </button>
            <button className="btn primary lg grow" onClick={() => go(5)}>
              {testsDone.length ? t('common.continue') : t('common.skip')}
            </button>
          </div>
        </section>
      )}

      {step === 5 && (
        <section className="stack">
          <h1>{t('assess.steps.submit')}</h1>
          {tri !== 'clear' && (
            <Notice tone={tri === 'urgent' ? 'danger' : 'warn'}>
              <strong>{t(tri === 'urgent' ? 'safety.urgent_title' : 'safety.review_title')}</strong>
              <p>{tri === 'urgent' ? t('safety.urgent_body', { emergency: settings.emergencyNumber }) : t('safety.review_body')}</p>
            </Notice>
          )}
          <div className="panel stack tight">
            <div className="row between">
              <strong>{t('assess.steps.body')}</strong>
              <CategoryBadge kind="pro" />
            </div>
            <p className="small">{regions.map(regionLabel).join(', ') || '–'}</p>
            <div className="divider" />
            <div className="row between">
              <strong>{t('assess.steps.pain')}</strong>
              <CategoryBadge kind="pro" />
            </div>
            <p className="small">
              {t('pain.now')}: <strong>{now ?? '–'}/10</strong> · {t('pain.worst')}: <strong>{worst ?? '–'}/10</strong>
              <br />
              {quality.map((q) => t(`pain.q.${q}`)).join(', ')} {duration[0] ? `· ${t(`pain.d.${duration[0]}`)}` : ''}
            </p>
            <div className="divider" />
            <div className="row between">
              <strong>{t('assess.steps.scan')} / {t('assess.steps.movement')}</strong>
              <CategoryBadge kind="review" />
            </div>
            <p className="small">
              {scanCount} {t('scan.title').toLowerCase()} · {testsDone.length} {t('assess.steps.movement').toLowerCase()}
            </p>
          </div>
          <p className="small muted">{t('assess.submit_note')}</p>
          <div className="row">
            <button className="btn secondary" onClick={() => go(tri === 'clear' ? 4 : 2)}>
              {t('common.back')}
            </button>
            <button className="btn primary lg grow" onClick={submit}>
              {t('assess.submit')}
            </button>
          </div>
        </section>
      )}
      {assessment?.status === 'safety_hold' && step < 5 && step > 2 && <Notice tone="warn">{t('safety.review_body')}</Notice>}
    </div>
  );
}
