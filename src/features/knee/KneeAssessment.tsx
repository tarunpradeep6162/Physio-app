import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { currentAnswers, SCALE04, visibleQuestions, type AnswerValue, type Question } from '../../clinical/intake';
import { PATHWAYS, pathwayFor, type PathwayRegion } from '../../clinical/pathways';
import { routineAllowed, SAFETY_ACTION_TEXT } from '../../clinical/safety';
import { CategoryBadge, ChipGroup, NprsInput, Notice, Segmented, Steps } from '../../components/ui';
import type { Assessment, PainRegion, RadiationPath, SymptomType } from '../../data/models';
import { getDb, insert, update, useDb, uuid } from '../../data/store';
import { getProtocol } from '../../engine/protocols/registry';
import type { Side } from '../../engine/types';
import { BodyMap, type MapPath } from '../bodymap/BodyMap';
import { parseRegion, regionLabel, type BodyView } from '../bodymap/regions';
import { saveScan } from '../assessment/persist';
import { StaticScan } from '../scan/StaticScan';
import { ProtocolCapture } from './ProtocolCapture';
import { baselineCapture, createAssessment, ensurePlan, currentPlan, itemKey, latestCapture, saveAnswers, saveCapture, saveRadiationPaths, saveRegions, saveSafety } from './persist';
import { BilateralTable, CaptureCard, ComparisonTable } from './Results';

/**
 * Patient assessment pathway (knee or shoulder, from the pathway registry): symptom map → adaptive history → safety screen → test plan & camera
 * tests → results → submit for clinician review. Every step persists, so an unfinished
 * assessment resumes where it stopped. A reassessment copies the baseline plan and shows the
 * baseline alignment guide during capture.
 */

const STEPS = ['Symptom map', 'History', 'Safety check', 'Movement tests', 'Results', 'Submit'];
const SYMPTOMS: { id: SymptomType; label: string }[] = [
  { id: 'pain', label: 'Pain' },
  { id: 'stiffness', label: 'Stiffness' },
  { id: 'weakness', label: 'Weakness' },
  { id: 'numbness', label: 'Numbness' },
  { id: 'tingling', label: 'Tingling' },
];
const SYMPTOM_COLOR: Record<SymptomType, string> = { pain: '#e65a5a', stiffness: '#0d9488', weakness: '#8a5a00', numbness: '#7c5cd6', tingling: '#2563eb' };

type Draft = Omit<PainRegion, 'id' | 'assessmentId'>;

export const KneeAssessment = () => <PathwayAssessment region="knee" />;
export const ShoulderAssessment = () => <PathwayAssessment region="shoulder" />;

export function PathwayAssessment({ region }: { region: PathwayRegion }) {
  const pathway = PATHWAYS[region];
  const nav = useNavigate();
  const user = useCurrentUser();
  const patient = useCurrentPatient();
  const db = useDb((d) => d);
  const reassessOf = new URLSearchParams(location.search).get('reassess');
  const open = useMemo(
    () => db.assessments.filter((a) => a.patientId === patient?.id && a.region === region && !a.submittedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [db, patient?.id, region],
  );
  const [assessmentId, setAssessmentId] = useState<string | null>(open?.id ?? null);
  const a = db.assessments.find((x) => x.id === assessmentId);
  const [step, setStep] = useState(open?.step ?? 0);
  const consent = (type: string) => db.consents.filter((c) => c.patientId === patient?.id && c.type === type).sort((x, y) => y.at.localeCompare(x.at))[0]?.granted ?? false;

  // Start (or resume) the assessment once — the ref guards against StrictMode's double effect.
  const creating = useRef(false);
  useEffect(() => {
    if (!patient || !user || assessmentId || creating.current) return;
    creating.current = true;
    const baseline = reassessOf ? getDb().assessments.find((x) => x.id === reassessOf) : undefined;
    const created = createAssessment(patient, user.id, region, baseline);
    setAssessmentId(created.id);
    setStep(0);
  }, [patient, user, assessmentId, reassessOf, region]);

  if (!patient || !user || !a) return null;

  const go = (n: number) => {
    update('assessments', a.id, { step: n }, user.id, 'step');
    setStep(n);
    window.scrollTo(0, 0);
  };

  return (
    <div className="content narrow stack loose">
      <div className="stack tight">
        <div className="row between">
          <span className="eyebrow">
            {pathway.label} {a.type === 'reassessment' ? 'reassessment' : 'assessment'} · {STEPS[step]}
          </span>
          <span className="small muted">
            {step + 1}/{STEPS.length}
          </span>
        </div>
        <Steps total={STEPS.length} current={step} />
      </div>
      {step === 0 && <MapStep a={a} actorId={user.id} onNext={() => go(1)} />}
      {step === 1 && <HistoryStep a={a} actorId={user.id} onBack={() => go(0)} onNext={() => go(2)} />}
      {step === 2 && <SafetyStep a={a} actorId={user.id} onBack={() => go(1)} onNext={(clear) => go(clear ? 3 : 5)} />}
      {step === 3 && <TestsStep a={a} actorId={user.id} cameraConsent={consent('camera_processing')} onBack={() => go(2)} onNext={() => go(4)} />}
      {step === 4 && (
        <section className="stack">
          <h1>Your results</h1>
          <Notice>These are camera estimates for your physiotherapist to review. They are not a diagnosis.</Notice>
          <BilateralTable db={db} assessmentId={a.id} />
          {a.type === 'reassessment' && <ComparisonTable db={db} current={a} />}
          <div className="row">
            <button className="btn secondary" onClick={() => go(3)}>
              Back
            </button>
            <button className="btn primary lg grow" onClick={() => go(5)}>
              Continue
            </button>
          </div>
        </section>
      )}
      {step === 5 && (
        <section className="stack">
          <h1>Send to your physiotherapist</h1>
          {!routineAllowed(a.safetyLevel) && (
            <Notice tone={a.safetyLevel === 'clinician_review' ? 'warn' : 'danger'}>
              <strong>{SAFETY_ACTION_TEXT[a.safetyLevel!].title}</strong>
              <p>{SAFETY_ACTION_TEXT[a.safetyLevel!].body.replace('{emergency}', db.settings.emergencyNumber)}</p>
            </Notice>
          )}
          <p className="muted">Your physiotherapist will review your answers and every camera estimate before anything is used in your plan.</p>
          <div className="row">
            <button className="btn secondary" onClick={() => go(routineAllowed(a.safetyLevel) ? 4 : 2)}>
              Back
            </button>
            <button
              className="btn primary lg grow"
              onClick={() => {
                update('assessments', a.id, { status: routineAllowed(a.safetyLevel) ? 'submitted' : 'safety_hold', submittedAt: new Date().toISOString(), step: 5 }, user.id, 'submit');
                insert('alerts', { id: uuid(), patientId: a.patientId, type: 'assessment_submitted', severity: 'info', detail: `${pathway.label} ${a.type === 'reassessment' ? 'reassessment' : 'assessment'}`, createdAt: new Date().toISOString(), isDemo: a.isDemo }, user.id);
                nav('/p/home');
              }}
            >
              Submit
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function MapStep({ a, actorId, onNext }: { a: Assessment; actorId: string; onNext: () => void }) {
  const saved = useDb((d) => d.painRegions.filter((r) => r.assessmentId === a.id), [a.id]);
  const savedPaths = useDb((d) => d.radiationPaths.filter((p) => p.assessmentId === a.id), [a.id]);
  const [regions, setRegions] = useState<Draft[]>(() => saved.map(({ id: _i, assessmentId: _a, ...r }) => r));
  const [paths, setPaths] = useState<Omit<RadiationPath, 'id' | 'assessmentId' | 'createdAt'>[]>(() => savedPaths.map(({ view, symptomType, points }) => ({ view, symptomType, points })));
  const [drawType, setDrawType] = useState<SymptomType | null>(null);
  const pathway = pathwayFor(a);

  const toggle = (id: string) =>
    setRegions((rs) => {
      if (rs.some((r) => r.regionId === id)) return rs.filter((r) => r.regionId !== id);
      const { part, side } = parseRegion(id);
      return [...rs, { regionId: id, anatomy: part, side, symptomTypes: ['pain'], subLocations: pathway.isRegion(id) ? [] : undefined }];
    });
  const patch = (id: string, p: Partial<Draft>) => setRegions((rs) => rs.map((r) => (r.regionId === id ? { ...r, ...p } : r)));
  const mapPaths: MapPath[] = paths.map((p, i) => ({ id: String(i), view: p.view, points: p.points, color: SYMPTOM_COLOR[p.symptomType], label: `${p.symptomType} path` }));

  return (
    <section className="stack">
      <div>
        <h1>Where are your symptoms?</h1>
        <p className="muted">Tap each area. Then choose what you feel there. You can also draw how a symptom spreads.</p>
      </div>
      <BodyMap
        selected={regions.map((r) => r.regionId)}
        onToggle={toggle}
        paths={mapPaths}
        drawing={drawType ? { color: SYMPTOM_COLOR[drawType], onStroke: (points, view: BodyView) => setPaths((ps) => [...ps, { view, symptomType: drawType, points }]) } : null}
      />
      <div className="panel stack tight">
        <div className="row between wrap">
          <strong>Draw how a symptom spreads (optional)</strong>
          {paths.length > 0 && (
            <button className="btn ghost sm" onClick={() => setPaths([])}>
              Clear drawings ({paths.length})
            </button>
          )}
        </div>
        <div className="row wrap">
          <Segmented<SymptomType | 'off'>
            label="Drawing mode"
            value={drawType ?? 'off'}
            onChange={(v) => setDrawType(v === 'off' ? null : v)}
            options={[{ id: 'off', label: 'Off — select areas' }, ...SYMPTOMS.map((s) => ({ id: s.id, label: `Draw ${s.label.toLowerCase()}` }))]}
          />
        </div>
        <p className="xs muted">Drawn lines are dashed and end with a dot; each type has its own colour and is named in the list below.</p>
        {paths.length > 0 && <p className="xs">{paths.map((p, i) => `${i + 1}. ${p.symptomType} (${p.view} view)`).join(' · ')}</p>}
      </div>
      {regions.map((r) => (
        <div key={r.regionId} className="panel stack tight">
          <div className="row between">
            <strong>{regionLabel(r.regionId)}</strong>
            <button className="btn ghost sm" onClick={() => toggle(r.regionId)} aria-label={`Remove ${regionLabel(r.regionId)}`}>
              Remove
            </button>
          </div>
          <ChipGroup multi label={`Symptoms at ${regionLabel(r.regionId)}`} options={SYMPTOMS} value={r.symptomTypes ?? []} onChange={(v) => patch(r.regionId, { symptomTypes: v as SymptomType[] })} />
          {pathway.isRegion(r.regionId) && (
            <>
              <span className="small muted">Which part of the {pathway.label.toLowerCase()}?</span>
              <ChipGroup multi label={`Part of ${pathway.label.toLowerCase()}`} options={pathway.subLocations} value={r.subLocations ?? []} onChange={(v) => patch(r.regionId, { subLocations: v })} />
            </>
          )}
        </div>
      ))}
      {regions.length > 0 && !regions.some((r) => pathway.isRegion(r.regionId)) && (
        <Notice>
          This pathway is built for {pathway.label.toLowerCase()} problems. Other areas are recorded for your physiotherapist; {pathway.label.toLowerCase()} tests will still be offered.
        </Notice>
      )}
      <button
        className="btn primary lg block"
        disabled={regions.length === 0 || regions.some((r) => !r.symptomTypes?.length)}
        onClick={() => {
          saveRegions(a.id, actorId, regions);
          saveRadiationPaths(a.id, actorId, paths);
          onNext();
        }}
      >
        Continue
      </button>
    </section>
  );
}

function QuestionInput({ q, value, onChange }: { q: Question; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void }) {
  if (q.kind === 'nprs') return <NprsInput label={q.text} value={typeof value === 'number' ? value : null} onChange={onChange} />;
  if (q.kind === 'scale04')
    return (
      <fieldset className="stack tight" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 650, marginBottom: '0.4rem' }}>{q.text}</legend>
        <div className="chips" role="radiogroup" aria-label={q.text}>
          {SCALE04.map((lab, i) => (
            <button key={i} type="button" className="chip" role="radio" aria-checked={value === i} onClick={() => onChange(i)}>
              {i} · {lab}
            </button>
          ))}
        </div>
      </fieldset>
    );
  if (q.kind === 'text' || q.kind === 'date')
    return (
      <label className="field">
        <span>{q.text}</span>
        {q.kind === 'date' ? (
          <input className="input" type="date" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <textarea className="input" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        )}
      </label>
    );
  const cur = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return (
    <div className="stack tight">
      <h3>{q.text}</h3>
      <ChipGroup multi={q.kind === 'multi'} label={q.text} options={q.options ?? []} value={cur} onChange={(v) => onChange(q.kind === 'multi' ? v : v[0] ?? null)} />
    </div>
  );
}

function HistoryStep({ a, actorId, onBack, onNext }: { a: Assessment; actorId: string; onBack: () => void; onNext: () => void }) {
  const regions = useDb((d) => d.painRegions.filter((r) => r.assessmentId === a.id), [a.id]);
  const saved = useDb((d) => currentAnswers(d.intakeAnswers.filter((r) => r.assessmentId === a.id)), [a.id]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>(saved);
  const pathway = pathwayFor(a);
  const qs = visibleQuestions({ answers, regions }, pathway.history).filter((q) => a.type !== 'reassessment' || pathway.reassessQuestions.has(q.id));
  const missing = qs.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === null || answers[q.id] === ''));
  let lastSection = '';
  return (
    <section className="stack loose">
      <div className="stack tight">
        <h1>{a.type === 'reassessment' ? 'How are things now?' : 'Tell us about it'}</h1>
        <div className="row wrap">
          <CategoryBadge kind="pro" />
          <span className="small muted">Your answers are saved exactly as you give them. Questions adapt to your answers.</span>
        </div>
        {!regions.some((r) => pathway.isRegion(r.regionId)) && <p className="xs muted">{pathway.label}-specific questions appear when a {pathway.label.toLowerCase()} area is selected.</p>}
        <p className="xs muted">
          {pathway.history.id}@{pathway.history.version} · {pathway.history.status}
        </p>
      </div>
      {qs.map((q) => {
        const header = q.section !== lastSection ? q.section : null;
        lastSection = q.section;
        return (
          <div key={q.id} className="stack tight">
            {header && <span className="eyebrow">{header}</span>}
            <div className="panel">
              <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((x) => ({ ...x, [q.id]: v }))} />
            </div>
          </div>
        );
      })}
      <div className="row">
        <button className="btn secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="btn primary lg grow"
          disabled={missing.length > 0}
          onClick={() => {
            // Only answers to currently-visible questions are stored.
            const visible = Object.fromEntries(qs.map((q) => [q.id, answers[q.id]]).filter(([, v]) => v !== undefined));
            saveAnswers(a, actorId, visible);
            onNext();
          }}
        >
          {missing.length ? `Answer required: ${missing.map((m) => m.text).join('; ').slice(0, 60)}…` : 'Continue'}
        </button>
      </div>
    </section>
  );
}

function SafetyStep({ a, actorId, onBack, onNext }: { a: Assessment; actorId: string; onBack: () => void; onNext: (clear: boolean) => void }) {
  const settings = useDb((d) => d.settings);
  const SAFETY_QUESTIONNAIRE = pathwayFor(a).safety;
  const approved = settings.ruleApprovals[`${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version}`];
  const [ans, setAns] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<ReturnType<typeof saveSafety> | null>(null);
  if (result && result !== 'clear') {
    const txt = SAFETY_ACTION_TEXT[result];
    return (
      <section className="stack">
        <Notice tone={result === 'clinician_review' ? 'warn' : 'danger'}>
          <strong style={{ fontSize: '1.2rem' }}>{txt.title}</strong>
          <p>{txt.body.replace('{emergency}', settings.emergencyNumber)}</p>
        </Notice>
        {result === 'emergency' && (
          <a className="btn danger lg" href={`tel:${settings.emergencyNumber}`}>
            Call {settings.emergencyNumber}
          </a>
        )}
        <p className="small muted">Camera tests and exercise are paused. You can still send what you have told us to your physiotherapist.</p>
        <button className="btn primary lg" onClick={() => onNext(false)}>
          Continue to send to physiotherapist
        </button>
      </section>
    );
  }
  return (
    <section className="stack">
      <div>
        <h1>Safety check</h1>
        <p className="muted">These questions make sure exercise and testing are appropriate today.</p>
        <p className="xs muted">
          {SAFETY_QUESTIONNAIRE.id}@{SAFETY_QUESTIONNAIRE.version} · {approved ? 'approved by clinical lead' : SAFETY_QUESTIONNAIRE.status}
        </p>
      </div>
      <div className="panel list">
        {SAFETY_QUESTIONNAIRE.items.map((it) => (
          <div key={it.id} className="row between" style={{ padding: '0.75rem 0', gap: '1rem' }}>
            <span className="grow">{it.text}</span>
            <div className="segmented" role="radiogroup" aria-label={it.text}>
              <button type="button" role="radio" aria-checked={ans[it.id] === false} onClick={() => setAns((x) => ({ ...x, [it.id]: false }))}>
                No
              </button>
              <button type="button" role="radio" aria-checked={ans[it.id] === true} onClick={() => setAns((x) => ({ ...x, [it.id]: true }))}>
                Yes
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="btn primary lg grow"
          disabled={SAFETY_QUESTIONNAIRE.items.some((i) => ans[i.id] === undefined)}
          onClick={() => {
            const level = saveSafety(a, actorId, ans, settings.emergencyNumber);
            if (level === 'clear') onNext(true);
            else setResult(level);
          }}
        >
          Continue
        </button>
      </div>
    </section>
  );
}

function TestsStep({ a, actorId, cameraConsent, onBack, onNext }: { a: Assessment; actorId: string; cameraConsent: boolean; onBack: () => void; onNext: () => void }) {
  const db = useDb((d) => d);
  const plan = currentPlan(db, a.id);
  const [active, setActive] = useState<{ protocolId: string; side: Side | null } | null>(null);
  const [posture, setPosture] = useState(false);
  const imageConsent = db.consents.filter((c) => c.patientId === a.patientId && c.type === 'image_storage').sort((x, y) => y.at.localeCompare(x.at))[0]?.granted ?? false;
  const scans = db.scans.filter((s) => s.assessmentId === a.id).length;
  useEffect(() => {
    if (!currentPlan(getDb(), a.id)) ensurePlan(a, actorId);
  }, [a, actorId]);
  if (!plan) return null;
  const blocked = !routineAllowed(a.safetyLevel) || !cameraConsent;
  if (posture)
    return (
      <StaticScan
        storeImages={imageConsent}
        onCancel={() => setPosture(false)}
        onComplete={(res) => {
          if (res.length) saveScan(a.patientId, a.id, actorId, res, a.isDemo);
          setPosture(false);
        }}
      />
    );
  if (active) {
    const base = baselineCapture(db, a, active.protocolId, active.side);
    return (
      <ProtocolCapture
        protocolId={active.protocolId}
        side={active.side}
        baseline={base}
        onCancel={() => setActive(null)}
        onSave={(o) => {
          saveCapture(a, actorId, active.protocolId, active.side, o, base);
          setActive(null);
        }}
      />
    );
  }
  const done = plan.items.filter((i) => latestCapture(db, a.id, i.protocolId, i.side)?.result.quality.verdict === 'valid').length;
  return (
    <section className="stack">
      <div>
        <h1>Movement tests</h1>
        <p className="muted">
          Your test plan ({plan.source === 'clinician' ? 'set by your physiotherapist' : plan.source === 'baseline_copy' ? 'same as your first assessment' : `standard ${pathwayFor(a).label.toLowerCase()} plan — your physiotherapist may change it`}). Each test explains its own camera setup.
        </p>
      </div>
      {!cameraConsent && (
        <Notice tone="warn">
          Camera tests need your consent to on-device camera processing. <Link to="/p/profile">Change in Profile</Link>
        </Notice>
      )}
      {!routineAllowed(a.safetyLevel) && <Notice tone="warn">Tests are paused until your physiotherapist reviews your safety answers.</Notice>}
      <div className="panel list">
        {plan.items.map((i) => {
          const def = getProtocol(i.protocolId, i.protocolVersion);
          const cap = latestCapture(db, a.id, i.protocolId, i.side);
          return (
            <div key={itemKey(i)} className="list-item">
              <div className="grow">
                <div className="list-title">
                  {def.title}
                  {i.side && def.sided ? ` — ${i.side}` : ''}
                </div>
                <div className="small muted">{def.purpose}</div>
              </div>
              {cap && <span className={`badge ${cap.result.quality.verdict === 'valid' ? 'ok' : 'danger'}`}>{cap.result.quality.verdict === 'valid' ? '✓ done' : '✗ redo'}</span>}
              <button className="btn secondary sm" disabled={blocked} onClick={() => setActive({ protocolId: i.protocolId, side: i.side })}>
                {cap ? 'Recapture' : 'Start'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="panel list">
        <div className="list-item">
          <div className="grow">
            <div className="list-title">Optional: static standing posture</div>
            <div className="small muted">Front, side and back views; alignment estimates for your physiotherapist.</div>
          </div>
          {scans > 0 && <span className="badge ok">✓ {scans} view(s)</span>}
          <button className="btn secondary sm" disabled={blocked} onClick={() => setPosture(true)}>
            {scans ? 'Redo' : 'Start'}
          </button>
        </div>
      </div>
      {plan.items.map((i) => {
        const cap = latestCapture(db, a.id, i.protocolId, i.side);
        return cap ? <CaptureCard key={cap.id} cap={cap} /> : null;
      })}
      <div className="row">
        <button className="btn secondary" onClick={onBack}>
          Back
        </button>
        <button className="btn primary lg grow" onClick={onNext}>
          {done === plan.items.length ? 'See results' : `Continue with ${done}/${plan.items.length} valid`}
        </button>
      </div>
    </section>
  );
}
