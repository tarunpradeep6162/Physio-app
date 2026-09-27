import { describe, expect, it } from 'vitest';
import { buildDemoDb } from './demo';
import type { User } from './models';
import { applyScope, scopeFor } from './scope';

describe('Phase 6 — read scope on the browser-local store', () => {
  const db = buildDemoDb();
  // A real person signs up on the same device and answers one intake question.
  const realUser: User = { id: 'u-real', email: 'real@example.test', passwordHash: 'x', passwordSalt: 'y', role: 'patient', displayName: 'Real person', createdAt: '2026-09-27T00:00:00Z' };
  db.users.push(realUser);
  db.patients.push({ id: 'p-real', userId: 'u-real', name: 'Real person', createdAt: '2026-09-27T00:00:00Z' } as never);
  db.assessments.push({ id: 'a-real', patientId: 'p-real', createdBy: 'u-real', status: 'in_progress', createdAt: '2026-09-27T00:00:00Z', step: 1, region: 'knee' });
  db.intakeAnswers.push({ id: 'ia-real', assessmentId: 'a-real', patientId: 'p-real', questionnaireId: 'knee-history', questionnaireVersion: '1.0.0', questionId: 'goal', questionText: 'Goal', answer: 'private text', answeredAt: '2026-09-27T00:00:00Z' });
  const demoClin = db.users.find((u) => u.role === 'clinician' && u.isDemo)!;
  const view = (u: User) => applyScope(db, scopeFor(u, db), u);

  it('a demo physiotherapist session never sees a real sign-up on the same device', () => {
    const v = view(demoClin);
    expect(v.patients.some((p) => p.id === 'p-real')).toBe(false);
    expect(v.assessments.some((a) => a.id === 'a-real')).toBe(false);
    expect(v.intakeAnswers.some((r) => r.id === 'ia-real')).toBe(false);
    expect(JSON.stringify(v)).not.toContain('private text');
    expect(v.patients.every((p) => p.isDemo)).toBe(true);
  });

  it('a real clinician account does not get demonstration patients mixed in', () => {
    const realClin: User = { ...realUser, id: 'u-clin', role: 'clinician', email: 'c@example.test' };
    db.users.push(realClin);
    const v = view(realClin);
    expect(v.patients.map((p) => p.id)).toEqual(['p-real']);
    expect(v.captures).toHaveLength(0);
  });

  it('a patient sees only their own record', () => {
    const v = view(realUser);
    expect(v.patients.map((p) => p.id)).toEqual(['p-real']);
    expect(v.assessments.map((a) => a.id)).toEqual(['a-real']);
    const demoPatientUser = db.users.find((u) => u.role === 'patient' && u.isDemo)!;
    const dv = view(demoPatientUser);
    expect(dv.patients).toHaveLength(1);
    expect(dv.patients[0].userId).toBe(demoPatientUser.id);
    expect(dv.intakeAnswers.every((r) => r.patientId === dv.patients[0].id)).toBe(true);
  });

  it('with nobody signed in, reads are unchanged (sign-in pages only)', () => {
    expect(applyScope(db, scopeFor(null, db), null)).toBe(db);
  });
});
