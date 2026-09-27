import { HISTORY_QUESTIONNAIRE, SHOULDER_HISTORY_QUESTIONNAIRE, type AnswerValue, type Questionnaire } from '../clinical/intake';
import { evaluate, RULE_SET } from '../clinical/reasoning';
import { buildEvidence } from '../clinical/evidence';
import { REPORT_TEMPLATE_VERSION } from '../clinical/report';
import { evaluateSafety, SAFETY_QUESTIONNAIRE, SHOULDER_SAFETY_QUESTIONNAIRE, type SafetyQuestionnaire } from '../clinical/safety';
import { defaultPrescription, getDefinition } from '../engine/exercises/definitions';
import { simulateExercise } from '../engine/exercises/simulateSession';
import type { ExercisePrescription } from '../engine/exercises/types';
import { MotionPipeline } from '../engine/pipeline';
import { synthesize } from '../engine/pose/synthetic';
import { getProtocol } from '../engine/protocols/registry';
import { SHOULDER_DEFAULT_PLAN } from '../engine/protocols/shoulder';
import { captureConfig, compareConfig } from '../engine/protocols/recorder';
import { sceneAt, SIM_PROVIDER, simulateCapture, type SimParams } from '../engine/protocols/simulate';
import { cameraProvenance, type DeviceContext } from '../engine/provenance';
import type { Side } from '../engine/types';
import { buildCaptureRows } from '../features/knee/persist';
import type { Assessment, CaptureSession, DB, Measurement, Patient, TrainingSession } from './models';
import { emptyDb, getDb, replaceDb, uuid } from './store';

/**
 * DEMONSTRATION DATA — knee and shoulder pathways.
 *
 * - Patients are pseudonymous (DP-01 …); no real or realistic identifying details.
 * - Every camera number is produced by running the REAL pipeline, protocol recorder and exercise
 *   runner over synthetic landmark sequences (source = simulated_demo, shown as SIMULATED).
 * - Patient answers are fictional and flagged demo. No hand-typed clinical measurement values.
 */

const DAY = 86_400_000;
const SAFETY_Q_KNEE = SAFETY_QUESTIONNAIRE;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const SIM_DEVICE: DeviceContext = { userAgent: 'simulator', platform: 'simulator', videoWidth: 720, videoHeight: 1280, facingMode: 'user', cameraRollDeg: 0, meanFps: 30, meanInferenceMs: 4 };

function simConfig(protocolId: string, side: Side | null, p: SimParams) {
  const scene = sceneAt(protocolId, side, 0, p)!;
  const pipe = new MotionPipeline('none');
  let f = pipe.process({ timestamp: 0, width: 720, height: 1280, poses: [synthesize(scene)], inferenceMs: 4, provider: SIM_PROVIDER });
  for (let i = 1; i < 10; i++) f = pipe.process({ timestamp: i * 33, width: 720, height: 1280, poses: [synthesize(scene)], inferenceMs: 4, provider: SIM_PROVIDER });
  return captureConfig(f, 'user', 0);
}

export function buildDemoDb(): DB {
  const db = emptyDb();
  const now = new Date().toISOString();
  const clinUser = { id: uuid(), email: 'demo.clinician@physiovision.local', passwordHash: '', passwordSalt: '', role: 'clinician' as const, displayName: 'Dheepika', createdAt: now, isDemo: true };
  const clin = { id: uuid(), userId: clinUser.id, name: 'Dheepika', title: 'Physiotherapist', clinic: 'Dheepika Lab', createdAt: now, isDemo: true };
  db.users.push(clinUser);
  db.clinicians.push(clin);

  const mkPatient = (code: string, sex: Patient['sex'], age: number, withUser: boolean): Patient => {
    let userId: string | null = null;
    if (withUser) {
      const u = { id: uuid(), email: 'demo.patient@physiovision.local', passwordHash: '', passwordSalt: '', role: 'patient' as const, displayName: code, createdAt: now, isDemo: true };
      db.users.push(u);
      userId = u.id;
    }
    const p: Patient = { id: uuid(), userId, name: `Demo patient ${code}`, sex, dob: `${new Date().getFullYear() - age}-06-01`, preferredLanguage: 'en', createdAt: iso(40 * DAY), isDemo: true };
    db.patients.push(p);
    db.careRelationships.push({ id: uuid(), patientId: p.id, clinicianId: clin.id, status: 'active', createdAt: p.createdAt });
    for (const type of ['camera_processing', 'data_storage'] as const) db.consents.push({ id: uuid(), patientId: p.id, type, granted: true, textVersion: '2026-09', at: p.createdAt });
    return p;
  };

  const mkAssessment = (p: Patient, ago: number, extra: Partial<Assessment> = {}): Assessment => {
    const a: Assessment = { id: uuid(), patientId: p.id, createdBy: p.userId ?? clin.id, status: 'submitted', createdAt: iso(ago), submittedAt: iso(ago - 3600_000), step: 5, region: 'knee', type: 'initial', safetyLevel: 'clear', isDemo: true, ...extra };
    db.assessments.push(a);
    return a;
  };
  const answer = (a: Assessment, ago: number, answers: Record<string, AnswerValue>, qn: Questionnaire = HISTORY_QUESTIONNAIRE) => {
    for (const [qid, v] of Object.entries(answers))
      db.intakeAnswers.push({ id: uuid(), assessmentId: a.id, patientId: a.patientId, questionnaireId: qn.id, questionnaireVersion: qn.version, questionId: qid, questionText: qn.questions.find((q) => q.id === qid)?.text ?? qid, answer: v, answeredAt: iso(ago), isDemo: true });
  };
  const safety = (a: Assessment, ago: number, yes: string[] = [], SAFETY_QUESTIONNAIRE: SafetyQuestionnaire = SAFETY_Q_KNEE) => {
    const ans = Object.fromEntries(SAFETY_QUESTIONNAIRE.items.map((i) => [i.id, yes.includes(i.id)]));
    for (const it of SAFETY_QUESTIONNAIRE.items)
      db.safetyResponses.push({ id: uuid(), assessmentId: a.id, patientId: a.patientId, questionnaireId: SAFETY_QUESTIONNAIRE.id, questionnaireVersion: SAFETY_QUESTIONNAIRE.version, questionId: it.id, questionText: it.text, answer: ans[it.id], triggered: ans[it.id], action: ans[it.id] ? it.action : null, at: iso(ago), isDemo: true });
    return evaluateSafety(ans, SAFETY_QUESTIONNAIRE).level;
  };
  const plan = (a: Assessment, ago: number) => {
    const items = [
      { protocolId: 'knee_supported_flexion', side: 'left' as const },
      { protocolId: 'knee_supported_flexion', side: 'right' as const },
      { protocolId: 'knee_sit_to_stand', side: 'left' as const },
      { protocolId: 'knee_squat', side: null },
    ].map((i) => ({ ...i, protocolVersion: getProtocol(i.protocolId).version }));
    db.testPlans.push({ id: uuid(), assessmentId: a.id, items, source: a.type === 'reassessment' ? 'baseline_copy' : 'protocol_default', createdBy: clin.id, createdAt: iso(ago) });
  };
  const capture = (a: Assessment, ago: number, protocolId: string, side: Side | null, p: SimParams, baseline?: CaptureSession): CaptureSession => {
    const result = simulateCapture(protocolId, side, { seed: Math.floor(Math.random() * 1000), ...p });
    const config = simConfig(protocolId, side, p);
    const conditionMatch = baseline?.config && config ? compareConfig(baseline.config, config) : undefined;
    const { cap, ms } = buildCaptureRows(a, a.createdBy, protocolId, side, { result, config, conditionMatch, provider: SIM_PROVIDER, device: SIM_DEVICE, setupNotes: protocolId === 'knee_sit_to_stand' ? 'Chair 45 cm, trainers (demo)' : undefined }, baseline, iso(ago));
    db.captures.push(cap);
    db.measurements.push(...ms);
    return cap;
  };
  const kneeRegion = (a: Assessment, side: Side, sub: string[], symptoms: ('pain' | 'stiffness' | 'weakness' | 'numbness' | 'tingling')[]) =>
    db.painRegions.push({ id: uuid(), assessmentId: a.id, regionId: `knee_${side}`, anatomy: 'knee', side, symptomTypes: symptoms, subLocations: sub });

  // ---- DP-01: post-injury knee — reviewed baseline, program, sessions, matched reassessment ----
  const p1 = mkPatient('DP-01', 'male', 34, true);
  const base = mkAssessment(p1, 30 * DAY, { status: 'reviewed', reviewedAt: iso(29 * DAY), reviewedBy: clin.id });
  kneeRegion(base, 'left', ['medial'], ['pain', 'stiffness']);
  answer(base, 30 * DAY, { onset: 'sudden', mechanism: ['twisting'], duration: '1_6w', nprs_now: 5, nprs_worst: 7, nprs_best: 2, pattern: 'intermittent', time_of_day: ['during_activity'], night: 'position', aggravating: ['squatting', 'stairs_down', 'pivoting'], easing: ['rest', 'ice'], swelling: 'after_6h', locking: 'catching', giving_way: 'no', func_stairs: 2, func_squat: 3, func_walk: 1, func_chair: 2, prev_injury: 'no', conditions: ['none'], prior_care: ['none'], occupation: 'desk', activity: 'recreational', goal: 'Play badminton again (demo)' });
  safety(base, 30 * DAY);
  plan(base, 30 * DAY);
  const bFlexL = capture(base, 30 * DAY, 'knee_supported_flexion', 'left', { peak: 98 });
  const bFlexR = capture(base, 30 * DAY - 60_000, 'knee_supported_flexion', 'right', { peak: 131 });
  const bSts = capture(base, 30 * DAY - 120_000, 'knee_sit_to_stand', 'left', { tempo: 1.3 });
  const bSq = capture(base, 30 * DAY - 180_000, 'knee_squat', null, { valgusLeft: 11, valgusRight: 3, peak: 0.26 });
  // Clinician review of the baseline (actions preserved with the suggestion snapshot).
  const evB = evaluate(buildEvidence(db, base.id), 'clear');
  const decide = (id: string, action: 'accept' | 'reject' | 'defer', note: string) => {
    const r = evB.find((x) => x.rule.id === id)!;
    db.reasoningDecisions.push({ id: uuid(), assessmentId: base.id, ruleSetId: RULE_SET.id, ruleSetVersion: RULE_SET.version, considerationId: id, suggestion: { state: r.state, supporting: r.supporting.map((s) => s.label), conflicting: r.conflicting.map((s) => s.label), missing: r.missing }, action, note, by: clinUser.id, at: iso(29 * DAY), isDemo: true });
  };
  decide('meniscal', 'accept', 'Demo: medial joint-line tenderness on examination.');
  decide('ligamentous', 'reject', 'Demo: Lachman negative, no instability.');
  decide('patellofemoral', 'defer', 'Demo: reassess once swelling settles.');
  db.impressions.push({ id: uuid(), assessmentId: base.id, text: 'Demo impression: presentation consistent with a medial meniscal-related knee problem after a twisting injury; left knee flexion reduced compared with right. Graded range-of-motion and loading program; reassess in 4 weeks.', by: clinUser.id, at: iso(29 * DAY), isDemo: true });
  db.measurements.filter((m) => m.assessmentId === base.id && m.validity === 'valid').forEach((m) => {
    m.reviewStatus = 'accepted';
    m.reviewedBy = clinUser.id;
    m.reviewedAt = iso(29 * DAY);
  });
  db.reports.push({ id: uuid(), assessmentId: base.id, version: 1, status: 'clinician_reviewed', generatedAt: iso(29 * DAY - 60_000), generatedBy: clinUser.id, approvedBy: clin.id, approvedAt: iso(29 * DAY - 60_000), templateVersion: REPORT_TEMPLATE_VERSION, isDemo: true });

  // Program + engine-derived sessions.
  const program = { id: uuid(), patientId: p1.id, clinicianId: clin.id, title: 'Phase 1 — knee range and control', status: 'active' as const, startDate: iso(28 * DAY).slice(0, 10), endDate: iso(-14 * DAY).slice(0, 10), approvedAt: iso(28 * DAY), approvedBy: clin.id, notes: 'Demo program', createdAt: iso(28 * DAY), version: 1, reassessAfterDays: 28, reassessTriggers: ['pain_stop' as const, 'patient_pause' as const], pauseOnPainStop: true, isDemo: true };
  db.programs.push(program);
  const rxs: ExercisePrescription[] = [
    { ...defaultPrescription('knee_flexion', 'left'), target: { min: 90, max: 110 }, sets: 1, reps: 6, holdSeconds: 2, painStopAt: 7, painRiseStop: 3, progression: 'Raise target 10° when pain ≤ 3/10 and target met in 2 consecutive sessions (clinician decision at review).' },
    { ...defaultPrescription('straight_leg_raise', 'left'), sets: 1, reps: 6, holdSeconds: 2, painStopAt: 7 },
  ];
  const pes = rxs.map((rx, i) => ({ id: uuid(), programId: program.id, order: i, prescription: rx }));
  db.programExercises.push(...pes);
  const sessionDays = [26, 23, 20, 16, 12, 9, 6, 3];
  sessionDays.forEach((d, k) => {
    const frac = k / (sessionDays.length - 1);
    const sid = uuid();
    const results = pes.map((pe, j) => ({ ...simulateExercise(pe.prescription, pe.prescription.definitionId === 'knee_flexion' ? 92 + frac * 14 : 38 + frac * 8, 10, k * 10 + j), programExerciseId: pe.id }));
    const painBefore = Math.round(5 - frac * 3);
    const session: TrainingSession = { id: sid, patientId: p1.id, programId: program.id, startedAt: iso(d * DAY), endedAt: iso(d * DAY - 15 * 60_000), status: 'completed', painBefore, painAfter: Math.max(0, painBefore - (k % 2)), rpe: 4 + (k % 3), painEvents: [], results, provenance: cameraProvenance({ createdBy: p1.userId!, provider: SIM_PROVIDER, confidence: 0.9, filter: 'one_euro' }), isDemo: true };
    db.sessions.push(session);
    for (const r of results) {
      if (r.peakRom === null) continue;
      const m: Measurement = { id: uuid(), patientId: p1.id, sessionId: sid, type: getDefinition(r.prescription.definitionId).primary, value: Math.round(r.peakRom * 10) / 10, unit: 'deg', side: r.side, confidence: r.meanConfidence ?? 0, category: 'camera_estimate', provenance: session.provenance, reviewStatus: 'pending', createdAt: session.startedAt, isDemo: true };
      db.measurements.push(m);
    }
  });

  // Matched reassessment (submitted, awaiting review).
  const re = mkAssessment(p1, 2 * DAY, { type: 'reassessment', baselineAssessmentId: base.id });
  kneeRegion(re, 'left', ['medial'], ['pain']);
  answer(re, 2 * DAY, { nprs_now: 2, nprs_worst: 4, nprs_best: 0, pattern: 'intermittent', night: 'none', aggravating: ['squatting'], swelling: 'none', locking: 'no', giving_way: 'no', func_stairs: 1, func_squat: 2, func_walk: 0, func_chair: 1 });
  safety(re, 2 * DAY);
  plan(re, 2 * DAY);
  capture(re, 2 * DAY, 'knee_supported_flexion', 'left', { peak: 117 }, bFlexL);
  capture(re, 2 * DAY - 60_000, 'knee_supported_flexion', 'right', { peak: 132 }, bFlexR);
  capture(re, 2 * DAY - 120_000, 'knee_sit_to_stand', 'left', { tempo: 1.05 }, bSts);
  capture(re, 2 * DAY - 180_000, 'knee_squat', null, { valgusLeft: 7, valgusRight: 3, peak: 0.3 }, bSq);
  db.alerts.push({ id: uuid(), patientId: p1.id, type: 'assessment_submitted', severity: 'info', detail: 'Knee reassessment', createdAt: iso(2 * DAY), isDemo: true });

  // ---- DP-02: gradual-onset knee pain, initial assessment awaiting review ----------------------
  const p2 = mkPatient('DP-02', 'female', 58, false);
  const a2 = mkAssessment(p2, 1 * DAY);
  kneeRegion(a2, 'right', ['anterior', 'medial'], ['pain', 'stiffness']);
  answer(a2, 1 * DAY, { onset: 'gradual', duration: 'gt3m', nprs_now: 4, nprs_worst: 6, pattern: 'intermittent', time_of_day: ['morning', 'after_activity'], morning_stiffness: 'lt30', night: 'position', aggravating: ['stairs_down', 'walking', 'standing'], easing: ['rest', 'medication'], swelling: 'comes_goes', locking: 'no', giving_way: 'occasional', func_stairs: 2, func_squat: 3, func_walk: 2, func_chair: 2, prev_injury: 'no', conditions: ['none'], prior_care: ['medication'], occupation: 'home', activity: 'sedentary', goal: 'Walk to the market without stopping (demo)' });
  safety(a2, 1 * DAY);
  plan(a2, 1 * DAY);
  capture(a2, 1 * DAY, 'knee_supported_flexion', 'left', { peak: 124 });
  capture(a2, 1 * DAY - 60_000, 'knee_supported_flexion', 'right', { peak: 109 });
  capture(a2, 1 * DAY - 120_000, 'knee_sit_to_stand', 'right', { tempo: 1.5 });
  // An invalid capture (joint occluded) — kept for audit, excluded from results.
  capture(a2, 1 * DAY - 180_000, 'knee_squat', null, { valgusLeft: 4, valgusRight: 5, perturb: (l, t) => (t > 3 ? l.map((x, i) => (i === 26 ? { ...x, visibility: 0.2 } : x)) : l) });
  db.alerts.push({ id: uuid(), patientId: p2.id, type: 'assessment_submitted', severity: 'info', detail: 'Knee assessment', createdAt: iso(DAY), isDemo: true });

  // ---- DP-03: safety pathway triggered ---------------------------------------------------------
  const p3 = mkPatient('DP-03', 'female', 45, false);
  const a3 = mkAssessment(p3, 0.3 * DAY, { status: 'safety_hold' });
  kneeRegion(a3, 'left', ['whole'], ['pain']);
  answer(a3, 0.3 * DAY, { onset: 'after_surgery', surgery_type: 'replacement', duration: '1_6w', nprs_now: 6, nprs_worst: 8 });
  const lvl = safety(a3, 0.3 * DAY, ['calf']);
  a3.safetyLevel = lvl;
  db.alerts.push({ id: uuid(), patientId: p3.id, type: 'red_flag_urgent', severity: 'critical', detail: `${lvl}: calf (${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version})`, createdAt: iso(0.3 * DAY), isDemo: true });

  // ---- DP-04: shoulder pathway — initial assessment awaiting review ----------------------------
  // Right shoulder symptoms; one capture is deliberately invalid (elbow hidden) to show refusal.
  const p4 = mkPatient('DP-04', 'female', 51, false);
  const a4 = mkAssessment(p4, 0.6 * DAY, { region: 'shoulder' });
  db.painRegions.push({ id: uuid(), assessmentId: a4.id, regionId: 'shoulder_right', anatomy: 'shoulder', side: 'right', symptomTypes: ['pain', 'stiffness'], subLocations: ['front', 'outer_arm'] });
  answer(
    a4,
    0.6 * DAY,
    { onset: 'gradual', duration: '6_12w', dominant_arm: 'right', nprs_now: 3, nprs_worst: 6, nprs_best: 1, pattern: 'intermittent', time_of_day: ['during_activity', 'evening'], night: 'position', aggravating: ['reach_overhead', 'reach_behind', 'lying_on_side', 'dressing'], easing: ['rest', 'heat'], instability: 'no', arm_symptoms: ['none'], neck_link: 'no', func_overhead: 3, func_behind_back: 2, func_carry: 1, func_dressing: 2, prev_injury: 'no', conditions: ['none'], prior_care: ['none'], occupation: 'desk', activity: 'recreational', goal: 'Reach the top shelf and swim again (demo)' },
    SHOULDER_HISTORY_QUESTIONNAIRE,
  );
  safety(a4, 0.6 * DAY, [], SHOULDER_SAFETY_QUESTIONNAIRE);
  db.testPlans.push({ id: uuid(), assessmentId: a4.id, items: SHOULDER_DEFAULT_PLAN.map((i) => ({ ...i, protocolVersion: getProtocol(i.protocolId).version })), source: 'protocol_default', createdBy: clin.id, createdAt: iso(0.6 * DAY) });
  capture(a4, 0.6 * DAY, 'shoulder_flexion_active', 'left', { peak: 165 });
  capture(a4, 0.6 * DAY - 60_000, 'shoulder_flexion_active', 'right', { peak: 128, trunkLean: 10 });
  capture(a4, 0.6 * DAY - 120_000, 'shoulder_abduction_active', 'left', { peak: 160 });
  // Invalid: the right elbow is hidden from 2 s on — kept for audit, produces no reported number.
  capture(a4, 0.6 * DAY - 180_000, 'shoulder_abduction_active', 'right', { peak: 110, perturb: (l, t) => (t > 2 ? l.map((x, i) => (i === 14 ? { ...x, visibility: 0.15 } : x)) : l) });
  db.alerts.push({ id: uuid(), patientId: p4.id, type: 'assessment_submitted', severity: 'info', detail: 'Shoulder assessment', createdAt: iso(0.6 * DAY), isDemo: true });

  return db;
}

/** Seeds demo data (idempotent). */
export function ensureDemoData() {
  const cur = getDb();
  if (cur.users.some((u) => u.isDemo)) return;
  const demo = buildDemoDb();
  const merged: DB = { ...cur };
  for (const k of Object.keys(demo) as (keyof DB)[]) {
    const v = demo[k];
    if (Array.isArray(v)) (merged as unknown as Record<string, unknown[]>)[k] = [...((cur[k] as unknown[]) ?? []), ...v];
  }
  replaceDb(merged);
}
