import type { AnswerValue } from '../../clinical/intake';
import { pathwayFor, type PathwayRegion } from '../../clinical/pathways';
import { evaluateSafety } from '../../clinical/safety';
import type { Assessment, CaptureSession, DB, ID, Measurement, PainRegion, Patient, RadiationPath, TestPlan, TestPlanItem } from '../../data/models';
import { getDb, insert, insertMany, remove, update, uuid } from '../../data/store';
import { getProtocol } from '../../engine/protocols/registry';
import { cameraProvenance } from '../../engine/provenance';
import type { Side } from '../../engine/types';
import type { CaptureOutcome } from './ProtocolCapture';

/** Persistence for the assessment pathways (knee, shoulder). Every write goes through the audited store. */

export function createAssessment(patient: Patient, actorId: ID, region: PathwayRegion, baseline?: Assessment): Assessment {
  const a: Assessment = {
    id: uuid(),
    patientId: patient.id,
    createdBy: actorId,
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    step: 0,
    region,
    type: baseline ? 'reassessment' : 'initial',
    baselineAssessmentId: baseline?.id,
    isDemo: patient.isDemo,
  };
  insert('assessments', a, actorId, a.type);
  if (baseline) {
    // Matched reassessment: same test plan, same symptom map as the starting point.
    const plan = currentPlan(getDb(), baseline.id);
    if (plan) insert('testPlans', { id: uuid(), assessmentId: a.id, items: plan.items, source: 'baseline_copy', createdBy: actorId, createdAt: a.createdAt }, actorId);
    const regions = getDb().painRegions.filter((r) => r.assessmentId === baseline.id);
    insertMany('painRegions', regions.map((r) => ({ ...r, id: uuid(), assessmentId: a.id })), actorId, 'copied_from_baseline');
  }
  return a;
}

export const createKneeAssessment = (patient: Patient, actorId: ID, baseline?: Assessment) => createAssessment(patient, actorId, 'knee', baseline);

export function saveRegions(assessmentId: ID, actorId: ID, rows: Omit<PainRegion, 'id' | 'assessmentId'>[]) {
  getDb().painRegions.filter((r) => r.assessmentId === assessmentId).forEach((r) => remove('painRegions', r.id, actorId, 'replaced'));
  insertMany('painRegions', rows.map((r) => ({ ...r, id: uuid(), assessmentId })), actorId);
}

export function saveRadiationPaths(assessmentId: ID, actorId: ID, paths: Omit<RadiationPath, 'id' | 'assessmentId' | 'createdAt'>[]) {
  getDb().radiationPaths.filter((p) => p.assessmentId === assessmentId).forEach((p) => remove('radiationPaths', p.id, actorId, 'replaced'));
  const now = new Date().toISOString();
  insertMany('radiationPaths', paths.map((p) => ({ ...p, id: uuid(), assessmentId, createdAt: now })), actorId);
}

/**
 * Stores only changed answers. A changed answer supersedes (never overwrites) the previous row,
 * so the original answer is always recoverable.
 */
export function saveAnswers(a: Assessment, actorId: ID, answers: Record<string, AnswerValue>) {
  const db = getDb();
  const now = new Date().toISOString();
  const qn = pathwayFor(a).history;
  for (const [qid, value] of Object.entries(answers)) {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    const prev = db.intakeAnswers.find((r) => r.assessmentId === a.id && r.questionId === qid && !r.supersededBy);
    if (prev && JSON.stringify(prev.answer) === JSON.stringify(value)) continue;
    const q = qn.questions.find((x) => x.id === qid);
    const row = { id: uuid(), assessmentId: a.id, patientId: a.patientId, questionnaireId: qn.id, questionnaireVersion: qn.version, questionId: qid, questionText: q?.text ?? qid, answer: value, answeredAt: now, isDemo: a.isDemo };
    insert('intakeAnswers', row, actorId);
    if (prev) update('intakeAnswers', prev.id, { supersededBy: row.id }, actorId, 'superseded');
  }
}

export function saveSafety(a: Assessment, actorId: ID, answers: Record<string, boolean>, emergencyNumber: string) {
  const now = new Date().toISOString();
  const SAFETY_QUESTIONNAIRE = pathwayFor(a).safety;
  const { level, triggered } = evaluateSafety(answers, SAFETY_QUESTIONNAIRE);
  insertMany(
    'safetyResponses',
    SAFETY_QUESTIONNAIRE.items.map((it) => ({
      id: uuid(),
      assessmentId: a.id,
      patientId: a.patientId,
      questionnaireId: SAFETY_QUESTIONNAIRE.id,
      questionnaireVersion: SAFETY_QUESTIONNAIRE.version,
      questionId: it.id,
      questionText: it.text,
      answer: !!answers[it.id],
      triggered: !!answers[it.id],
      action: answers[it.id] ? it.action : null,
      at: now,
      isDemo: a.isDemo,
    })),
    actorId,
  );
  update('assessments', a.id, { safetyLevel: level, status: level === 'clear' ? a.status : 'safety_hold' }, actorId, `safety:${level}`);
  if (level !== 'clear') {
    insert(
      'alerts',
      {
        id: uuid(),
        patientId: a.patientId,
        type: level === 'clinician_review' ? 'red_flag_review' : 'red_flag_urgent',
        severity: level === 'clinician_review' ? 'warning' : 'critical',
        detail: `${level}: ${triggered.map((t) => t.id).join(', ')} (${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version}; patient shown ${level === 'emergency' ? `emergency advice, ${emergencyNumber}` : 'escalation advice'})`,
        createdAt: now,
        isDemo: a.isDemo,
      },
      actorId,
    );
  }
  return level;
}

export function currentPlan(db: DB, assessmentId: ID): TestPlan | undefined {
  return db.testPlans.filter((p) => p.assessmentId === assessmentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function ensurePlan(a: Assessment, actorId: ID): TestPlan {
  const existing = currentPlan(getDb(), a.id);
  if (existing) return existing;
  const plan: TestPlan = {
    id: uuid(),
    assessmentId: a.id,
    items: pathwayFor(a).defaultPlan.map((i) => ({ protocolId: i.protocolId, protocolVersion: getProtocol(i.protocolId).version, side: i.side })),
    source: 'protocol_default',
    createdBy: actorId,
    createdAt: new Date().toISOString(),
    note: `Default ${pathwayFor(a).label.toLowerCase()} plan (protocol rules v1). Clinician may edit.`,
  };
  insert('testPlans', plan, actorId);
  return plan;
}

export function savePlan(assessmentId: ID, actorId: ID, items: TestPlanItem[], note?: string) {
  insert('testPlans', { id: uuid(), assessmentId, items, source: 'clinician', createdBy: actorId, createdAt: new Date().toISOString(), note }, actorId, 'plan_edit');
}

export const itemKey = (i: { protocolId: string; side: Side | null }) => `${i.protocolId}:${i.side ?? 'both'}`;

export function latestCapture(db: DB, assessmentId: ID, protocolId: string, side: Side | null): CaptureSession | undefined {
  return db.captures
    .filter((c) => c.assessmentId === assessmentId && c.protocolId === protocolId && (c.side ?? null) === side)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Baseline capture to reproduce at reassessment (valid captures preferred). */
export function baselineCapture(db: DB, a: Assessment, protocolId: string, side: Side | null): CaptureSession | undefined {
  if (!a.baselineAssessmentId) return undefined;
  return latestCapture(db, a.baselineAssessmentId, protocolId, side);
}

/** Pure construction of a capture row and its measurement rows (used by the app and demo seeding). */
export function buildCaptureRows(a: Pick<Assessment, 'id' | 'patientId' | 'isDemo'>, actorId: ID, protocolId: string, side: Side | null, o: CaptureOutcome, baseline?: CaptureSession, at = new Date().toISOString()): { cap: CaptureSession; ms: Measurement[] } {
  const def = getProtocol(protocolId);
  const prov = cameraProvenance({
    createdBy: actorId,
    provider: o.provider,
    confidence: o.result.quality.meanConfidence ?? 0,
    filter: 'one_euro',
    view: o.result.view,
    device: o.device,
    exercise: { id: def.id, version: def.version },
  });
  const cap: CaptureSession = {
    id: uuid(),
    assessmentId: a.id,
    patientId: a.patientId,
    protocolId,
    protocolVersion: def.version,
    side,
    result: o.result,
    config: o.config,
    baselineCaptureId: baseline?.id,
    conditionMatch: o.conditionMatch,
    setupNotes: o.setupNotes,
    provenance: { ...prov, createdAt: at, algorithmVersion: o.result.algorithmVersion },
    createdAt: at,
    isDemo: a.isDemo,
  };
  const ms: Measurement[] = o.result.metrics
    .filter((m) => m.value !== null)
    .map((m) => ({
      id: uuid(),
      patientId: a.patientId,
      assessmentId: a.id,
      captureId: cap.id,
      metricId: m.id,
      type: `${protocolId}.${m.id}`,
      value: m.value!,
      unit: m.unit,
      side: (m.side ?? side) || undefined,
      confidence: o.result.quality.meanConfidence ?? 0,
      category: 'camera_estimate' as const,
      validity: m.validity,
      validityReason: m.reason,
      provenance: cap.provenance,
      reviewStatus: 'pending' as const,
      createdAt: cap.createdAt,
      isDemo: a.isDemo,
    }));
  return { cap, ms };
}

export function saveCapture(a: Assessment, actorId: ID, protocolId: string, side: Side | null, o: CaptureOutcome, baseline?: CaptureSession): CaptureSession {
  const { cap, ms } = buildCaptureRows(a, actorId, protocolId, side, o, baseline);
  insert('captures', cap, actorId, `${protocolId}:${o.result.quality.verdict}`);
  insertMany('measurements', ms, actorId);
  return cap;
}
