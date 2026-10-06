import { describe, expect, it } from 'vitest';
import type { Appointment, Expense, Payment, TreatmentCourse } from '../data/models';
import { appointmentMessage, courseProgress, daySlots, formatINR, monthGrid, monthlyStatement, parseRupees, patientLedger, slotTaken, toCsv, whatsappLink } from './backoffice';

const course: TreatmentCourse = { id: 'c1', patientId: 'p1', title: 'Knee rehab', plannedSessions: 10, feePaise: 500000, startDate: '2026-10-01', status: 'active', createdBy: 'u', createdAt: '2026-10-01T00:00:00Z' };
const appt = (id: string, status: Appointment['status'], at = '2026-10-05T04:30:00Z', clinicianId = 's1'): Appointment => ({ id, patientId: 'p1', clinicianId, at, kind: 'session', status, courseId: 'c1', createdBy: 'u', createdAt: at });
const pay = (amountPaise: number, date: string, patientId = 'p1'): Payment => ({ id: `${date}-${amountPaise}`, patientId, amountPaise, method: 'upi', date, createdBy: 'u', createdAt: date });
const exp = (amountPaise: number, date: string): Expense => ({ id: `e-${date}`, category: 'rent', title: 'Rent', amountPaise, date, createdBy: 'u', createdAt: date });

describe('money', () => {
  it('formats paise as Indian rupees with lakh grouping', () => {
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
    expect(formatINR(0)).toBe('₹0.00');
  });
  it('parses rupee input exactly, rejecting negatives, letters and 3 decimals', () => {
    expect(parseRupees('1,250.5')).toBe(125050);
    expect(parseRupees('₹ 800')).toBe(80000);
    expect(parseRupees('0.07')).toBe(7);
    expect(parseRupees('-5')).toBeNull();
    expect(parseRupees('12.345')).toBeNull();
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
});

describe('treatment course progress is counted from attendance only', () => {
  it('counts attended, missed and booked visits; remaining never goes below zero', () => {
    const db = { appointments: [appt('a', 'done'), appt('b', 'done'), appt('c', 'missed'), appt('d', 'scheduled'), appt('e', 'cancelled')] };
    expect(courseProgress(db, course)).toEqual({ attended: 2, missed: 1, booked: 1, remaining: 8 });
    const many = { appointments: Array.from({ length: 12 }, (_, i) => appt(`x${i}`, 'done')) };
    expect(courseProgress(many, course).remaining).toBe(0);
  });
  it('a course with no visits shows zero attended, not a default', () => {
    expect(courseProgress({ appointments: [] }, course)).toEqual({ attended: 0, missed: 0, booked: 0, remaining: 10 });
  });
});

describe('ledger and statement', () => {
  it('balance = agreed fees − payments, per patient', () => {
    const db = { treatmentCourses: [course], payments: [pay(200000, '2026-10-02'), pay(50000, '2026-10-09'), pay(99900, '2026-10-09', 'p2')] };
    expect(patientLedger(db, 'p1')).toEqual({ billedPaise: 500000, paidPaise: 250000, balancePaise: 250000 });
    expect(patientLedger(db, 'p3')).toEqual({ billedPaise: 0, paidPaise: 0, balancePaise: 0 });
  });
  it('monthly statement sums payments and expenses by month, newest first, including empty months', () => {
    const db = { payments: [pay(200000, '2026-10-02'), pay(100000, '2026-09-30')], expenses: [exp(150000, '2026-10-01'), exp(50000, '2026-08-15')] };
    const rows = monthlyStatement(db, '2026-10', 3);
    expect(rows).toEqual([
      { month: '2026-10', incomePaise: 200000, expensePaise: 150000, netPaise: 50000 },
      { month: '2026-09', incomePaise: 100000, expensePaise: 0, netPaise: 100000 },
      { month: '2026-08', incomePaise: 0, expensePaise: 50000, netPaise: -50000 },
    ]);
    expect(monthlyStatement(db, '2026-01', 2).map((r) => r.month)).toEqual(['2026-01', '2025-12']);
  });
});

describe('scheduling', () => {
  it('builds half-hour slots and a Monday-first month grid', () => {
    expect(daySlots('08:00', '10:00')).toEqual(['08:00', '08:30', '09:00', '09:30']);
    const oct = monthGrid(2026, 10); // 1 Oct 2026 is a Thursday
    expect(oct[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(oct.flat().filter(Boolean)).toHaveLength(31);
    expect(oct.every((w) => w.length === 7)).toBe(true);
  });
  it('detects a double booking for the same staff member, ignoring cancelled visits', () => {
    const db = { appointments: [appt('a', 'scheduled'), appt('b', 'cancelled', '2026-10-05T05:00:00Z')] };
    expect(slotTaken(db, 's1', '2026-10-05T04:30:00Z')).toBe(true);
    expect(slotTaken(db, 's2', '2026-10-05T04:30:00Z')).toBe(false);
    expect(slotTaken(db, 's1', '2026-10-05T05:00:00Z')).toBe(false);
  });
});

describe('sharing carries no health information', () => {
  it('the reminder names date, time, clinic and staff only', () => {
    const msg = appointmentMessage({ at: '2026-10-05T04:30:00Z' }, 'Dheepika Lab', 'Demo clinician', 'Asha');
    expect(msg).toContain('Dheepika Lab');
    expect(msg).toContain('Demo clinician');
    expect(msg).not.toMatch(/knee|pain|diagnos|condition/i);
  });
  it('WhatsApp link: 10-digit number gets 91, short numbers give no link', () => {
    expect(whatsappLink('98765 43210', 'hi there')).toBe('https://wa.me/919876543210?text=hi%20there');
    expect(whatsappLink('+44 7700 900123', 'x')).toBe('https://wa.me/447700900123?text=x');
    expect(whatsappLink('12345', 'x')).toBeNull();
    expect(whatsappLink(undefined, 'x')).toBeNull();
  });
});

describe('CSV export', () => {
  it('quotes commas and quotes, and neutralises spreadsheet formulas', () => {
    const csv = toCsv(['Name', 'Note', 'Amount'], [['Asha, R', 'said "ok"', 12.5], ['=HYPERLINK("x")', '-cmd', null]]);
    expect(csv).toBe('Name,Note,Amount\r\n"Asha, R","said ""ok""",12.5\r\n"\'=HYPERLINK(""x"")",\'-cmd,\r\n');
  });
});
