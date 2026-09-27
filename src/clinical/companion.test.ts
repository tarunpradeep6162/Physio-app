import { describe, expect, it } from 'vitest';
import type { DB, Program } from '../data/models';
import { emptyDb } from '../data/store';
import { defaultPrescription } from '../engine/exercises/definitions';
import { en } from '../i18n/en';
import { dayKey, recoveryMessage, todayView } from './companion';

// Wednesday 7 Jan 2026, 10:00 local time.
const NOW = new Date(2026, 0, 7, 10, 0, 0);
const at = (daysAgo: number, h = 9) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, h).toISOString();

function world(extra: Partial<Program> = {}): DB {
  const db = emptyDb();
  db.patients.push({ id: 'p', userId: 'u', name: 'DP-T', dob: '1990-01-01', preferredLanguage: 'en', createdAt: at(30) });
  db.programs.push({ id: 'g', patientId: 'p', clinicianId: 'c', title: 'Plan', status: 'active', startDate: dayKey(at(20)), endDate: dayKey(at(-20)), approvedAt: at(20), approvedBy: 'c', createdAt: at(20), version: 1, ...extra });
  db.programExercises.push({ id: 'e', programId: 'g', order: 0, prescription: { ...defaultPrescription('knee_flexion', 'left'), frequencyPerWeek: 3 } });
  return db;
}
const session = (db: DB, daysAgo: number, status: 'completed' | 'interrupted' = 'completed') =>
  db.sessions.push({ id: `s${daysAgo}`, patientId: 'p', programId: 'g', startedAt: at(daysAgo), status, results: [], painBefore: 3, painAfter: 3, provenance: { source: 'camera_estimation', createdBy: 'u', createdAt: at(daysAgo), engineVersion: 'x', algorithmVersion: 'y' } });

describe('Phase 10 — daily companion', () => {
  it('flexible plans count sessions this week against the weekly frequency and never report missed days', () => {
    const db = world();
    session(db, 0);
    session(db, 1);
    const v = todayView(db, 'p', NOW.toISOString());
    expect(v.today).toBe('flexible');
    expect(v.doneToday).toBe(1);
    expect(v.weekDone).toBe(2); // Mon 5 Jan onward
    expect(v.weekTarget).toBe(3);
    expect(v.missedDays).toEqual([]);
  });

  it('scheduled plans list missed scheduled days (not rest days, not paused days) with a supportive message', () => {
    const db = world({ scheduleDays: [1, 3, 5] }); // Mon, Wed, Fri
    session(db, 2); // Mon 5 Jan done
    const v = todayView(db, 'p', NOW.toISOString());
    expect(v.today).toBe('scheduled');
    // Fri 2 Jan and Wed 31 Dec (7 days back) were scheduled with no session; Sun/Tue/Thu are rest days.
    expect(v.missedDays).toEqual([dayKey(at(5)), dayKey(at(7))]);
    expect(recoveryMessage(v)).toBe('missed_several');
    session(db, 7);
    expect(recoveryMessage(todayView(db, 'p', NOW.toISOString()))).toBe('missed_one');
    // Paused on Friday: that day is not "missed".
    db.planPauses.push({ id: 'x', programId: 'g', patientId: 'p', reason: 'patient_report', by: 'u', at: at(6) });
    const paused = todayView(db, 'p', NOW.toISOString());
    expect(paused.plan).toBe('paused');
    expect(recoveryMessage(paused)).toBe('none');
  });

  it('shows the latest check-in of today, the next scheduled appointment, and a reassessment reminder only when none is booked', () => {
    const db = world({ reassessAfterDays: 14 });
    db.pros.push({ id: 'c1', patientId: 'p', type: 'daily_checkin', value: { pain: 4 }, recordedAt: at(0, 8) }, { id: 'c2', patientId: 'p', type: 'daily_checkin', value: { pain: 2, note: 'better' }, recordedAt: at(0, 9) });
    let v = todayView(db, 'p', NOW.toISOString());
    expect(v.checkin.today?.id).toBe('c2');
    expect(v.nextAppointment).toBeNull();
    expect(v.reassessWithoutAppointment).toBe(true);
    db.appointments.push({ id: 'a1', patientId: 'p', clinicianId: 'c', at: at(-3), kind: 'reassessment', status: 'scheduled', createdBy: 'c', createdAt: at(1) }, { id: 'a0', patientId: 'p', clinicianId: 'c', at: at(-1), kind: 'call', status: 'cancelled', createdBy: 'c', createdAt: at(1) });
    v = todayView(db, 'p', NOW.toISOString());
    expect(v.nextAppointment?.id).toBe('a1');
    expect(v.reassessWithoutAppointment).toBe(false);
  });

  it('companion copy is supportive: no scores for pain, no streaks, no "catch up" by doing extra', () => {
    const copy = Object.entries(en)
      .filter(([k]) => k.startsWith('companion.') || k.startsWith('plan.'))
      .map(([, v]) => v)
      .join(' \n ');
    expect(copy).not.toMatch(/streak|points|badge|score|failed|failure|lazy|behind/i);
    expect(copy).not.toMatch(/great pain|good pain|well done on your pain/i);
    expect(en['companion.missed_one']).toMatch(/do not add extra sessions/i);
    expect(en['companion.missed_several']).toMatch(/without extra sessions/i);
  });
});
