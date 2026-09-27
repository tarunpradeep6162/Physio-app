import type { DB, ID, Measurement, Patient, Program, TrainingSession } from './models';

/** Read-side helpers shared by the patient and clinician experiences. */

export function patientForUser(db: DB, userId: ID | null): Patient | undefined {
  return userId ? db.patients.find((p) => p.userId === userId) : undefined;
}

export function clinicianForUser(db: DB, userId: ID | null) {
  return userId ? db.clinicians.find((c) => c.userId === userId) : undefined;
}

export function activeProgram(db: DB, patientId: ID): Program | undefined {
  return db.programs
    .filter((p) => p.patientId === patientId && p.status === 'active')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function programExercises(db: DB, programId: ID) {
  return db.programExercises.filter((e) => e.programId === programId).sort((a, b) => a.order - b.order);
}

export function sessionsFor(db: DB, patientId: ID): TrainingSession[] {
  return db.sessions.filter((s) => s.patientId === patientId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function latestAssessment(db: DB, patientId: ID) {
  return db.assessments.filter((a) => a.patientId === patientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Adherence = completed sessions ÷ planned sessions over a window, where planned comes from the
 * clinician's prescribed frequency (max across the program's exercises).
 */
export function adherence(db: DB, patientId: ID, days = 7): { done: number; planned: number; pct: number | null } {
  const program = activeProgram(db, patientId);
  if (!program) return { done: 0, planned: 0, pct: null };
  const freq = Math.max(1, ...programExercises(db, program.id).map((e) => e.prescription.frequencyPerWeek));
  const since = Date.now() - days * 86_400_000;
  const start = Math.max(since, new Date(program.startDate).getTime());
  const spanDays = Math.max(1, (Date.now() - start) / 86_400_000);
  const planned = Math.max(1, Math.round((freq * Math.min(days, spanDays)) / 7));
  const done = db.sessions.filter((s) => s.patientId === patientId && s.status === 'completed' && new Date(s.startedAt).getTime() >= start).length;
  return { done, planned, pct: Math.min(1, done / planned) };
}

export interface SeriesPoint {
  at: string;
  value: number;
  source: 'camera' | 'clinician';
  confidence?: number;
}

/** Longitudinal series for one measurement type — camera estimates and clinician measures kept apart. */
export function measurementSeries(db: DB, patientId: ID, type: string): { camera: SeriesPoint[]; clinician: SeriesPoint[] } {
  const rows = db.measurements.filter((m) => m.patientId === patientId && m.type === type && m.reviewStatus !== 'rejected');
  const pt = (m: Measurement): SeriesPoint => ({ at: m.createdAt, value: m.value, source: m.category === 'clinician_measured' ? 'clinician' : 'camera', confidence: m.confidence });
  const sort = (a: SeriesPoint, b: SeriesPoint) => a.at.localeCompare(b.at);
  return {
    camera: rows.filter((m) => m.category === 'camera_estimate' && m.sessionId).map(pt).sort(sort),
    clinician: rows.filter((m) => m.category === 'clinician_measured').map(pt).sort(sort),
  };
}

export function painSeries(db: DB, patientId: ID): SeriesPoint[] {
  return db.sessions
    .filter((s) => s.patientId === patientId && s.painBefore !== undefined)
    .map((s) => ({ at: s.startedAt, value: s.painBefore!, source: 'camera' as const }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function openAlerts(db: DB, patientId?: ID) {
  return db.alerts.filter((a) => !a.resolvedAt && (!patientId || a.patientId === patientId));
}

export function age(dob?: string): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
}

export function fmtDate(isoStr: string, locale = 'en-IN'): string {
  return new Date(isoStr).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export function fmtDateTime(isoStr: string, locale = 'en-IN'): string {
  return new Date(isoStr).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
