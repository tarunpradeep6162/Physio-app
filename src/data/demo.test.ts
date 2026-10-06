import { describe, expect, it } from 'vitest';
import { buildDemoDb } from './demo';
import { migrate } from './store';

describe('demo data', () => {
  const db = buildDemoDb();
  it('uses pseudonymous patients only', () => {
    expect(db.patients.every((p) => /^Demo patient DP-\d\d$/.test(p.name) && p.isDemo)).toBe(true);
  });
  it('attributes simulated approvals to a demo clinician, including existing browser copies', () => {
    expect(db.clinicians[0].name).toBe('Demo clinician');
    const old = structuredClone(db);
    old.clinicians[0].name = 'Dheepika';
    old.users[0].displayName = 'Dheepika';
    const restored = migrate(old);
    expect(restored.clinicians[0].name).toBe('Demo clinician');
    expect(restored.users[0].displayName).toBe('Demo clinician');
    const real = structuredClone(old);
    real.clinicians[0].isDemo = false;
    expect(migrate(real).clinicians[0].name).toBe('Dheepika');
  });
  it('derives every camera number from engine runs over synthetic landmarks', () => {
    expect(db.captures.length).toBeGreaterThan(8);
    for (const c of db.captures) {
      expect(c.provenance.source).toBe('simulated_demo');
      expect(c.result.frames.data.length).toBeGreaterThan(100); // landmark stream exists
    }
    const cam = db.measurements.filter((m) => m.category === 'camera_estimate');
    expect(cam.every((m) => m.provenance.source === 'simulated_demo')).toBe(true);
    expect(db.measurements.some((m) => m.category === 'clinician_measured')).toBe(false);
  });
  it('includes an invalid capture that stays excluded', () => {
    expect(db.captures.some((c) => c.result.quality.verdict === 'invalid')).toBe(true);
  });
  it('sessions come from the exercise runner', () => {
    expect(db.sessions.length).toBe(8);
    expect(db.sessions.every((s) => s.results.every((r) => r.repsAttempted > 0))).toBe(true);
  });
  it('fits comfortably in local storage', () => {
    expect(JSON.stringify(db).length).toBeLessThan(1_500_000);
  });
});

describe('demo refresh for returning browsers (gap 11)', () => {
  it('removes old demo rows, including unflagged linked rows, and keeps real records', async () => {
    const { withoutDemo } = await import('./demo');
    const db = buildDemoDb();
    const demoPatient = db.patients[0].id;
    // An unflagged row linked to a demo patient (e.g. a capture written by older code).
    db.intakeAnswers.push({ id: 'unflagged', assessmentId: db.assessments.find((a) => a.patientId === demoPatient)!.id, questionId: 'q', value: 1, answeredAt: '2026-01-01T00:00:00Z' } as never);
    db.patients.push({ id: 'real-p', userId: 'real-u', name: 'Real Person', preferredLanguage: 'en', createdAt: '2026-01-01T00:00:00Z' });
    db.pros.push({ id: 'real-pro', patientId: 'real-p', type: 'nprs_now', value: 4, recordedAt: '2026-01-02T00:00:00Z' });
    const clean = withoutDemo(db);
    expect(clean.patients.map((p) => p.id)).toEqual(['real-p']);
    expect(clean.pros.map((p) => p.id)).toEqual(['real-pro']);
    expect(clean.intakeAnswers.some((r) => r.id === 'unflagged')).toBe(false);
    expect(clean.users.some((u) => u.isDemo)).toBe(false);
    expect(clean.treatmentCourses).toHaveLength(0);
    expect(clean.expenses).toHaveLength(0);
  });

  it('the demo now includes back-office samples', () => {
    const db = buildDemoDb();
    expect(db.treatmentCourses).toHaveLength(1);
    expect(db.appointments.filter((a) => a.courseId === db.treatmentCourses[0].id && a.status === 'done')).toHaveLength(3);
    expect(db.payments.every((p) => p.isDemo)).toBe(true);
    expect(db.expenses.every((e) => e.isDemo)).toBe(true);
  });
});
