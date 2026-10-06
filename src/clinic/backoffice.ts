import type { Appointment, DB, ID, TreatmentCourse } from '../data/models';

/**
 * Clinic back office (Oct 2026): scheduling, treatment courses, payments and expenses.
 * Every figure here is counted from recorded rows. Nothing is estimated or defaulted: a course's
 * attended sessions are the appointments marked 'done', a balance is fees agreed minus payments.
 */

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatINR(paise: number): string {
  return INR.format(paise / 100);
}

/** "1,250.50" or "1250" → 125050 paise; null when not a non-negative amount with at most 2 decimals. */
export function parseRupees(input: string): number | null {
  const s = input.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

export interface CourseProgress {
  attended: number;
  missed: number;
  booked: number;
  remaining: number;
}

export function courseProgress(db: Pick<DB, 'appointments'>, course: TreatmentCourse): CourseProgress {
  const visits = (db.appointments ?? []).filter((a) => a.courseId === course.id);
  const attended = visits.filter((a) => a.status === 'done').length;
  return {
    attended,
    missed: visits.filter((a) => a.status === 'missed').length,
    booked: visits.filter((a) => a.status === 'scheduled').length,
    remaining: Math.max(0, course.plannedSessions - attended),
  };
}

export interface PatientLedger {
  billedPaise: number;
  paidPaise: number;
  balancePaise: number;
}

/** Fees agreed on the patient's courses (stopped courses included) minus payments received. */
export function patientLedger(db: Pick<DB, 'treatmentCourses' | 'payments'>, patientId: ID): PatientLedger {
  const billed = (db.treatmentCourses ?? []).filter((c) => c.patientId === patientId).reduce((s, c) => s + c.feePaise, 0);
  const paid = (db.payments ?? []).filter((p) => p.patientId === patientId).reduce((s, p) => s + p.amountPaise, 0);
  return { billedPaise: billed, paidPaise: paid, balancePaise: billed - paid };
}

export interface MonthRow {
  month: string; // YYYY-MM
  incomePaise: number;
  expensePaise: number;
  netPaise: number;
}

/** Income (payments received) and expenses per calendar month, newest first, for `months` months ending at `nowMonth`. */
export function monthlyStatement(db: Pick<DB, 'payments' | 'expenses'>, nowMonth: string, months = 12): MonthRow[] {
  const [y, m] = nowMonth.split('-').map(Number);
  const rows: MonthRow[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const income = (db.payments ?? []).filter((p) => p.date.startsWith(key)).reduce((s, p) => s + p.amountPaise, 0);
    const expense = (db.expenses ?? []).filter((e) => e.date.startsWith(key)).reduce((s, e) => s + e.amountPaise, 0);
    rows.push({ month: key, incomePaise: income, expensePaise: expense, netPaise: income - expense });
  }
  return rows;
}

/** Bookable start times "HH:MM" from `start` up to (not including) `end`. */
export function daySlots(start = '08:00', end = '20:00', stepMin = 30): string[] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: string[] = [];
  for (let t = toMin(start); t < toMin(end); t += stepMin) out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  return out;
}

/** Local calendar date "YYYY-MM-DD" of an ISO timestamp. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local time "HH:MM" of an ISO timestamp. */
export function localTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Weeks (Monday first) covering the month; days outside the month are null. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Appointments on one local day, earliest first. */
export function appointmentsOn(db: Pick<DB, 'appointments'>, day: string): Appointment[] {
  return (db.appointments ?? []).filter((a) => localDay(a.at) === day).sort((a, b) => a.at.localeCompare(b.at));
}

/** True when the staff member already has a non-cancelled booking starting at the same minute. */
export function slotTaken(db: Pick<DB, 'appointments'>, clinicianId: ID, atIso: string): boolean {
  const t = Date.parse(atIso);
  return (db.appointments ?? []).some((a) => a.clinicianId === clinicianId && a.status !== 'cancelled' && Date.parse(a.at) === t);
}

/**
 * Appointment reminder text for WhatsApp. Date, time, clinic and staff name only: no condition,
 * pain area, measurement or other health information leaves the app this way.
 */
export function appointmentMessage(a: Pick<Appointment, 'at'>, clinic: string, staffName: string, patientFirstName: string): string {
  const d = new Date(a.at);
  const date = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `Hello ${patientFirstName}, this is a reminder of your appointment at ${clinic || 'the clinic'} with ${staffName} on ${date} at ${localTime(a.at)}. Reply to this message if you need to change it.`;
}

/** wa.me link; digits only, a 10-digit Indian mobile gets the 91 prefix. Null without a usable number. */
export function whatsappLink(phone: string | undefined, text: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const n = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/**
 * CSV with RFC 4180 quoting. Cells starting with = + - @ (or tab / carriage return) are prefixed with
 * an apostrophe so a spreadsheet does not run them as formulas.
 */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Rupees with two decimals for CSV (no currency symbol, no grouping). */
export const csvRupees = (paise: number) => (paise / 100).toFixed(2);

export interface AttendanceMonth {
  month: string; // YYYY-MM
  attended: number;
  missed: number;
  cancelled: number;
  /** Past bookings still marked 'scheduled' — attendance not recorded. */
  unrecorded: number;
  /** attended / (attended + missed); null when neither was recorded. */
  attendanceRate: number | null;
}

/**
 * Attendance per calendar month (local time), oldest first, for `months` months ending at `now`.
 * Only past appointments count. Unrecorded visits are reported, never assumed attended or missed.
 */
export function attendanceByMonth(db: Pick<DB, 'appointments'>, now: Date, months = 6): AttendanceMonth[] {
  const nowIso = now.toISOString();
  const past = (db.appointments ?? []).filter((a) => a.at <= nowIso);
  const out: AttendanceMonth[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const inMonth = past.filter((a) => localDay(a.at).startsWith(key));
    const n = (s: Appointment['status']) => inMonth.filter((a) => a.status === s).length;
    const attended = n('done');
    const missed = n('missed');
    out.push({ month: key, attended, missed, cancelled: n('cancelled'), unrecorded: n('scheduled'), attendanceRate: attended + missed ? attended / (attended + missed) : null });
  }
  return out;
}

export interface RetentionRow {
  course: TreatmentCourse;
  progress: CourseProgress;
  /** Most recent attended visit for this patient, if any. */
  lastVisit: string | null;
  /** Next future booking for this patient (status 'scheduled'), if any. */
  nextBooking: string | null;
}

/** Active treatment courses with their next booking; the clinic sees which have none booked. */
export function activeCourseFollowUp(db: Pick<DB, 'appointments' | 'treatmentCourses'>, now: Date): RetentionRow[] {
  const nowIso = now.toISOString();
  const appts = db.appointments ?? [];
  return (db.treatmentCourses ?? [])
    .filter((c) => c.status === 'active')
    .map((course) => {
      const mine = appts.filter((a) => a.patientId === course.patientId);
      const last = mine.filter((a) => a.status === 'done' && a.at <= nowIso).sort((a, b) => b.at.localeCompare(a.at))[0];
      const next = mine.filter((a) => a.status === 'scheduled' && a.at > nowIso).sort((a, b) => a.at.localeCompare(b.at))[0];
      return { course, progress: courseProgress(db, course), lastVisit: last?.at ?? null, nextBooking: next?.at ?? null };
    })
    .sort((a, b) => Number(!!a.nextBooking) - Number(!!b.nextBooking) || (a.lastVisit ?? '').localeCompare(b.lastVisit ?? ''));
}
