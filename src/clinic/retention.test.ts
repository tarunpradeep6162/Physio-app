import { describe, expect, it } from 'vitest';
import type { Appointment, TreatmentCourse } from '../data/models';
import { activeCourseFollowUp, attendanceByMonth } from './backoffice';

const now = new Date(2026, 9, 6, 12, 0); // 6 Oct 2026, local
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();
const appt = (id: string, patientId: string, when: string, status: Appointment['status'], courseId?: string): Appointment => ({ id, patientId, clinicianId: 's', at: when, kind: 'session', status, courseId, createdBy: 'u', createdAt: when });
const course = (id: string, patientId: string, status: TreatmentCourse['status'] = 'active'): TreatmentCourse => ({ id, patientId, title: 'Rehab', plannedSessions: 6, feePaise: 0, startDate: '2026-09-01', status, createdBy: 'u', createdAt: '2026-09-01' });

describe('attendance analytics', () => {
  it('counts recorded attendance per month and reports unrecorded bookings separately', () => {
    const db = {
      appointments: [
        appt('1', 'p', at(2026, 9, 10), 'done'),
        appt('2', 'p', at(2026, 9, 17), 'missed'),
        appt('3', 'p', at(2026, 9, 24), 'done'),
        appt('4', 'p', at(2026, 9, 28), 'cancelled'),
        appt('5', 'p', at(2026, 10, 2), 'scheduled'), // past, not marked
        appt('6', 'p', at(2026, 10, 20), 'scheduled'), // future: not counted
      ],
    };
    const rows = attendanceByMonth(db, now, 3);
    expect(rows.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(rows[0].attendanceRate).toBeNull();
    expect(rows[1]).toMatchObject({ attended: 2, missed: 1, cancelled: 1, unrecorded: 0 });
    expect(rows[1].attendanceRate).toBeCloseTo(2 / 3);
    expect(rows[2]).toMatchObject({ attended: 0, missed: 0, unrecorded: 1, attendanceRate: null });
  });

  it('lists active courses, those without a future booking first', () => {
    const db = {
      treatmentCourses: [course('c1', 'p1'), course('c2', 'p2'), course('c3', 'p3', 'completed')],
      appointments: [appt('a', 'p1', at(2026, 10, 1), 'done', 'c1'), appt('b', 'p1', at(2026, 10, 9), 'scheduled', 'c1'), appt('c', 'p2', at(2026, 9, 20), 'done', 'c2')],
    };
    const rows = activeCourseFollowUp(db, now);
    expect(rows.map((r) => r.course.id)).toEqual(['c2', 'c1']);
    expect(rows[0].nextBooking).toBeNull();
    expect(rows[0].lastVisit).toBe(at(2026, 9, 20));
    expect(rows[1].progress.attended).toBe(1);
    expect(rows[1].nextBooking).toBe(at(2026, 10, 9));
  });
});
