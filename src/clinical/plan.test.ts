import { describe, expect, it } from 'vitest';
import { buildDemoDb } from '../data/demo';
import { emptyDb, getDb, insert, insertMany, migrate, remove, replaceDb, update, uuid, AuthorizationError } from '../data/store';
import { activeProgram } from '../data/queries';
import type { DB } from '../data/models';
import { defaultPrescription, getDefinition } from '../engine/exercises/definitions';
import type { ExercisePrescription } from '../engine/exercises/types';
import { diffPlans, openPauses, planHistory, planState, preparePublish, reassessmentDue, type PublishInput } from './plan';

const version = (rx: ExercisePrescription) => getDefinition(rx.definitionId).version;

function publish(input: PublishInput, actorId: string, now = new Date().toISOString()) {
  const plan = preparePublish(getDb(), input, now, uuid, version);
  if (plan.errors.length) return plan;
  if (plan.previous) update('programs', plan.previous.id, { status: 'archived' }, actorId, 'superseded');
  insert('programs', plan.program!, actorId);
  insertMany('programExercises', plan.programExercises!, actorId);
  return plan;
}

describe('Phase 9 — prescription and plan versioning', () => {
  replaceDb(buildDemoDb());
  const db0 = getDb();
  const clinUser = db0.users.find((u) => u.role === 'clinician')!;
  const clin = db0.clinicians.find((c) => c.userId === clinUser.id)!;
  const current = db0.programs.find((p) => p.status === 'active')!;
  const patient = db0.patients.find((p) => p.id === current.patientId)!;
  const patientUser = db0.users.find((u) => u.id === patient.userId)!;
  const currentRx = () => getDb().programExercises.filter((e) => e.programId === activeProgram(getDb(), patient.id)!.id).map((e) => e.prescription);
  const base = (exercises: ExercisePrescription[], extra: Partial<PublishInput> = {}): PublishInput => ({ patientId: patient.id, clinicianId: clin.id, title: 'Phase 2', startDate: '2026-01-01', endDate: '2026-03-01', exercises, isDemo: true, ...extra });

  it('diffs versions field by field and marks intensification (more volume or range, looser pain limit)', () => {
    const a = { ...defaultPrescription('knee_flexion', 'left'), reps: 6, painStopAt: 7 };
    const c = diffPlans([a], [{ ...a, reps: 8, painStopAt: undefined }]);
    expect(c.find((x) => x.field === 'reps')).toMatchObject({ from: '6', to: '8', direction: 'intensify' });
    expect(c.find((x) => x.field === 'pain stop at')).toMatchObject({ to: 'off', direction: 'intensify' });
    expect(diffPlans([a], [{ ...a, reps: 4, painStopAt: 5 }]).every((x) => x.direction === 'reduce')).toBe(true);
    expect(diffPlans([a], [])[0]).toMatchObject({ to: 'removed', direction: 'reduce' });
  });

  it('an intensifying version needs a reason; the new version supersedes and archives the old one, which stays readable', () => {
    const harder = currentRx().map((rx) => ({ ...rx, reps: rx.reps + 2 }));
    expect(preparePublish(getDb(), base(harder), new Date().toISOString(), uuid, version).errors).toContain('intensify_needs_reason');
    const plan = publish(base(harder, { changeReason: 'Demo: target met at review', reassessAfterDays: 14, reassessTriggers: ['pain_stop'] }), clinUser.id);
    expect(plan.errors).toEqual([]);
    const now = getDb();
    const active = activeProgram(now, patient.id)!;
    expect(active.version).toBe((current.version ?? 1) + 1);
    expect(active.supersedes).toBe(current.id);
    expect(now.programs.find((p) => p.id === current.id)!.status).toBe('archived');
    expect(planHistory(now, patient.id).map((p) => p.version)).toEqual([2, 1]);
    expect(now.programExercises.filter((e) => e.programId === current.id).length).toBeGreaterThan(0);
  });

  it('only a clinician can publish a version; the patient session cannot write a plan', () => {
    const plan = preparePublish(getDb(), base(currentRx()), new Date().toISOString(), uuid, version);
    expect(() => insert('programs', plan.program!, patientUser.id)).toThrow(AuthorizationError);
    expect(() => insertMany('programExercises', plan.programExercises!, patientUser.id)).toThrow(AuthorizationError);
    expect(() => update('programExercises', getDb().programExercises[0].id, { prescription: { ...getDb().programExercises[0].prescription, reps: 50 } }, patientUser.id)).toThrow(AuthorizationError);
  });

  it('an unapproved (draft) plan never reaches the patient', () => {
    const draft = { ...preparePublish(getDb(), base(currentRx()), '2099-01-01T00:00:00Z', uuid, version).program!, approvedAt: undefined, approvedBy: undefined, version: 99 };
    insert('programs', draft, clinUser.id);
    expect(activeProgram(getDb(), patient.id)!.id).not.toBe(draft.id);
  });

  it('the patient (or pain rule) can pause but not resume; only the clinician resumes; pauses are append-only', () => {
    const prog = activeProgram(getDb(), patient.id)!;
    const pause = { id: uuid(), programId: prog.id, patientId: patient.id, reason: 'pain_rule' as const, detail: '8/10', by: patientUser.id, at: new Date().toISOString(), isDemo: true };
    insert('planPauses', pause, patientUser.id);
    expect(planState(getDb(), patient.id).kind).toBe('paused');
    const resume = { id: uuid(), pauseId: pause.id, programId: prog.id, patientId: patient.id, note: 'ok', by: patientUser.id, at: new Date().toISOString() };
    expect(() => insert('planResumes', resume, patientUser.id)).toThrow(AuthorizationError);
    expect(() => remove('planPauses', pause.id, patientUser.id)).toThrow(AuthorizationError);
    expect(() => update('planPauses', pause.id, { reason: 'patient_report' }, patientUser.id)).toThrow(AuthorizationError);
    // The pain-stop trigger makes a reassessment due.
    expect(reassessmentDue(getDb(), prog, new Date().toISOString()).map((d) => d.reason).join()).toMatch(/pain rule/);
    insert('planResumes', { ...resume, by: clinUser.id, note: 'Reviewed by phone' }, clinUser.id);
    expect(openPauses(getDb(), prog.id)).toEqual([]);
    expect(planState(getDb(), patient.id).kind).toBe('active');
  });

  it('reassessment falls due after the clinician interval and is answered by a later reassessment', () => {
    const prog = activeProgram(getDb(), patient.id)!;
    const later = new Date(new Date(prog.approvedAt!).getTime() + 15 * 86_400_000).toISOString();
    expect(reassessmentDue(getDb(), { ...prog, reassessTriggers: [] }, later).map((d) => d.reason)).toEqual(['14 days since approval']);
    expect(reassessmentDue(getDb(), { ...prog, reassessTriggers: [], reassessAfterDays: undefined }, later)).toEqual([]);
  });

  it('an alternative must say when it applies and is validated like the main exercise', () => {
    const rx = { ...defaultPrescription('knee_flexion', 'left'), alternative: { ...defaultPrescription('straight_leg_raise', 'left'), when: '' } };
    expect(preparePublish(getDb(), base([rx], { changeReason: 'x' }), new Date().toISOString(), uuid, version).errors).toContain('alternative_when_required');
    const bad = { ...rx, alternative: { ...rx.alternative, when: 'If standing hurts', reps: 0 } };
    expect(preparePublish(getDb(), base([bad], { changeReason: 'x' }), new Date().toISOString(), uuid, version).errors).toContain('alternative_reps_range');
  });
});

describe('Phase 9 — migration to schema v4', () => {
  it('numbers existing programs per patient and links each to the one it replaced, without changing content', () => {
    const v3 = { ...emptyDb(), schemaVersion: 3 } as DB;
    delete (v3 as Partial<DB>).planPauses;
    const mk = (id: string, patientId: string, createdAt: string, status: 'active' | 'archived') => ({ id, patientId, clinicianId: 'c', title: id, status, startDate: '2026-01-01', endDate: '2026-02-01', approvedAt: createdAt, approvedBy: 'c', createdAt });
    v3.programs = [mk('b', 'p1', '2026-02-01', 'active'), mk('a', 'p1', '2026-01-01', 'archived'), mk('z', 'p2', '2026-01-05', 'active')];
    const m = migrate(v3);
    expect(m.planPauses).toEqual([]);
    expect(m.programs.find((p) => p.id === 'a')).toMatchObject({ version: 1, supersedes: undefined, title: 'a' });
    expect(m.programs.find((p) => p.id === 'b')).toMatchObject({ version: 2, supersedes: 'a' });
    expect(m.programs.find((p) => p.id === 'z')).toMatchObject({ version: 1 });
  });
});
