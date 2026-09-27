import type { Appointment, DailyCheckin, DB, ID, PatientReportedOutcome, TrainingSession } from '../data/models';
import { programExercises } from '../data/queries';
import { planState, reassessmentDue } from './plan';

/**
 * Daily companion (Phase 10). Pure read model for the patient's home screen:
 * today's plan, this week's sessions against the clinician's schedule, missed-day recovery,
 * the latest daily check-in, the session log and the next appointment.
 *
 * Language rules (enforced by the i18n copy, checked in tests): supportive, never scoring pain,
 * never implying failure, never suggesting extra sessions to "catch up" (that would intensify the
 * plan, which only the clinician may do).
 */

export const COMPANION_VERSION = 'dl-companion-1.0.0';

/** Local calendar day key (YYYY-MM-DD) in the device's time zone. */
export function dayKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
}

export interface TodayView {
  plan: 'none' | 'paused' | 'active';
  /** 'scheduled' = today is a scheduled day; 'rest' = not scheduled; 'flexible' = N per week, any day. */
  today: 'scheduled' | 'rest' | 'flexible';
  doneToday: number;
  weekDone: number;
  weekTarget: number;
  /** Scheduled days in the past 7 days (before today, after the plan started) without a session. */
  missedDays: string[];
  exerciseCount: number;
  sessionLog: TrainingSession[];
  checkin: { today: (PatientReportedOutcome & { value: DailyCheckin }) | null; last: (PatientReportedOutcome & { value: DailyCheckin }) | null };
  nextAppointment: Appointment | null;
  /** The clinician's reassessment reminder is due and no appointment is booked. */
  reassessWithoutAppointment: boolean;
}

export function todayView(db: DB, patientId: ID, nowIso: string): TodayView {
  const now = new Date(nowIso);
  const state = planState(db, patientId);
  const program = state.kind === 'none' ? undefined : state.program;
  const sessions = db.sessions.filter((s) => s.patientId === patientId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  const todayKey = dayKey(now);
  const weekStart = startOfWeek(now).getTime();
  const freq = program ? Math.max(1, ...programExercises(db, program.id).map((e) => e.prescription.frequencyPerWeek)) : 0;
  const schedule = program?.scheduleDays?.length ? new Set(program.scheduleDays) : null;
  const planStart = program ? new Date(`${program.startDate}T00:00:00`).getTime() : Infinity;
  const missedDays: string[] = [];
  if (schedule && state.kind === 'active') {
    for (let k = 1; k <= 7; k++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k);
      if (d.getTime() < planStart || !schedule.has(d.getDay())) continue;
      // Days while the plan was paused are not "missed".
      const key = dayKey(d);
      const pausedThen = (db.planPauses ?? []).some((p) => p.programId === program!.id && dayKey(p.at) <= key && !(db.planResumes ?? []).some((r) => r.pauseId === p.id && dayKey(r.at) <= key));
      if (!days.has(key) && !pausedThen) missedDays.push(key);
    }
  }
  const checkins = db.pros
    .filter((p): p is PatientReportedOutcome & { value: DailyCheckin } => p.patientId === patientId && p.type === 'daily_checkin')
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const appts = (db.appointments ?? []).filter((a) => a.patientId === patientId && a.status === 'scheduled' && a.at >= nowIso).sort((a, b) => a.at.localeCompare(b.at));
  const due = program && state.kind !== 'none' ? reassessmentDue(db, program, nowIso) : [];
  return {
    plan: state.kind,
    today: !program ? 'rest' : schedule ? (schedule.has(now.getDay()) ? 'scheduled' : 'rest') : 'flexible',
    doneToday: sessions.filter((s) => dayKey(s.startedAt) === todayKey).length,
    weekDone: program ? sessions.filter((s) => s.programId === program.id && new Date(s.startedAt).getTime() >= weekStart).length : 0,
    weekTarget: schedule ? schedule.size : freq,
    missedDays,
    exerciseCount: program ? programExercises(db, program.id).length : 0,
    sessionLog: sessions.slice(0, 5),
    checkin: { today: checkins.find((c) => dayKey(c.recordedAt) === todayKey) ?? null, last: checkins[0] ?? null },
    nextAppointment: appts[0] ?? null,
    reassessWithoutAppointment: due.length > 0 && !appts.some((a) => a.kind === 'reassessment'),
  };
}

/** The message key for the missed-day card: supportive, and never "do extra to catch up". */
export function recoveryMessage(v: TodayView): 'none' | 'missed_one' | 'missed_several' {
  if (v.plan !== 'active' || v.missedDays.length === 0) return 'none';
  return v.missedDays.length === 1 ? 'missed_one' : 'missed_several';
}

