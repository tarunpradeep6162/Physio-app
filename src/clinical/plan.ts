import type { DB, ID, PlanPause, Program, ProgramExercise, ProgramLibraryItem, ReassessTrigger } from '../data/models';
import { validatePrescription } from '../engine/exercises/definitions';
import type { ExercisePrescription } from '../engine/exercises/types';

/**
 * Prescription and plan versioning (Phase 9).
 *
 * - Every published plan is a numbered version for the patient, linked to the version it replaced.
 *   Earlier versions stay readable; only the latest APPROVED active version reaches the patient.
 * - Publishing is a clinician action (the store refuses programs / programExercises / planResumes
 *   writes from any other role). A version that intensifies the previous one must say why.
 * - The patient, or the clinician's pain rule acting for them, can PAUSE a plan. Nothing on the
 *   patient side can change or intensify it; only a clinician can resume it or publish a new version.
 * - Reassessment becomes due after the clinician's interval or on the triggers they selected.
 *   These are operational reminders chosen by the clinician, not clinical thresholds.
 */

export const PLAN_POLICY_VERSION = 'dl-plan-1.0.0';

export const TRIGGER_LABELS: Record<ReassessTrigger, string> = {
  pain_stop: 'A session was stopped by the pain rule',
  pain_increase: 'Reported pain rose by 2 or more points over a session',
  patient_pause: 'The patient paused the plan',
};

export interface PlanChange {
  exercise: string;
  field: string;
  from: string;
  to: string;
  /** 'intensify' = more load, range, volume or frequency, or a looser pain limit. */
  direction: 'intensify' | 'reduce' | 'neutral';
}

const key = (rx: ExercisePrescription) => `${rx.definitionId}:${rx.side}`;

/** Field-by-field comparison of two plan versions, keyed by exercise and side. */
export function diffPlans(prev: ExercisePrescription[], next: ExercisePrescription[]): PlanChange[] {
  const out: PlanChange[] = [];
  const before = new Map(prev.map((r) => [key(r), r]));
  const after = new Map(next.map((r) => [key(r), r]));
  for (const [k, n] of after) {
    const p = before.get(k);
    if (!p) {
      out.push({ exercise: k, field: 'exercise', from: '—', to: 'added', direction: 'intensify' });
      continue;
    }
    const num = (field: string, a: number, b: number, higherIsMore = true) => {
      if (a === b) return;
      out.push({ exercise: k, field, from: String(a), to: String(b), direction: (b > a) === higherIsMore ? 'intensify' : 'reduce' });
    };
    num('sets', p.sets, n.sets);
    num('reps', p.reps, n.reps);
    num('target min (°)', p.target.min, n.target.min);
    num('target max (°)', p.target.max, n.target.max);
    num('hold (s)', p.holdSeconds, n.holdSeconds);
    num('rest (s)', p.restSeconds, n.restSeconds, false);
    num('min rep duration (s)', p.tempo.minRepMs / 1000, n.tempo.minRepMs / 1000, false);
    num('per week', p.frequencyPerWeek, n.frequencyPerWeek);
    // A pain limit that is removed or raised lets the patient continue into more pain: intensify.
    const limit = (field: string, a: number | undefined, b: number | undefined) => {
      if (a === b) return;
      const dir = b === undefined ? 'intensify' : a === undefined ? 'reduce' : b > a ? 'intensify' : 'reduce';
      out.push({ exercise: k, field, from: a === undefined ? 'off' : String(a), to: b === undefined ? 'off' : String(b), direction: dir });
    };
    limit('pain stop at', p.painStopAt, n.painStopAt);
    limit('pain rise stop', p.painRiseStop, n.painRiseStop);
    if ((p.instructions ?? '') !== (n.instructions ?? '')) out.push({ exercise: k, field: 'instructions', from: p.instructions ?? '—', to: n.instructions ?? '—', direction: 'neutral' });
    if (!!p.alternative !== !!n.alternative || (p.alternative && n.alternative && key(p.alternative) !== key(n.alternative)))
      out.push({ exercise: k, field: 'approved alternative', from: p.alternative ? key(p.alternative) : 'none', to: n.alternative ? key(n.alternative) : 'none', direction: 'neutral' });
  }
  for (const k of before.keys()) if (!after.has(k)) out.push({ exercise: k, field: 'exercise', from: 'present', to: 'removed', direction: 'reduce' });
  return out;
}

export type LibraryRx = Omit<ProgramLibraryItem, 'id' | 'programId' | 'order'>;

/** Dosage changes for library (non-camera) exercises, keyed by item id. */
export function diffLibrary(prev: LibraryRx[], next: LibraryRx[]): PlanChange[] {
  const out: PlanChange[] = [];
  const before = new Map(prev.map((r) => [r.itemId, r]));
  const after = new Map(next.map((r) => [r.itemId, r]));
  for (const [k, n] of after) {
    const p = before.get(k);
    const ex = `library:${k}`;
    if (!p) {
      out.push({ exercise: ex, field: 'exercise', from: '—', to: 'added', direction: 'intensify' });
      continue;
    }
    if (p.itemVersion !== n.itemVersion) out.push({ exercise: ex, field: 'content version', from: p.itemVersion, to: n.itemVersion, direction: 'neutral' });
    for (const f of ['sets', 'reps', 'holdSeconds', 'durationSeconds', 'frequencyPerWeek'] as const) {
      const a = p[f] ?? 0;
      const b = n[f] ?? 0;
      if (a !== b) out.push({ exercise: ex, field: f, from: String(p[f] ?? '—'), to: String(n[f] ?? '—'), direction: b > a ? 'intensify' : 'reduce' });
    }
  }
  for (const k of before.keys()) if (!after.has(k)) out.push({ exercise: `library:${k}`, field: 'exercise', from: 'present', to: 'removed', direction: 'reduce' });
  return out;
}

export interface PublishInput {
  patientId: ID;
  clinicianId: ID;
  title: string;
  startDate: string;
  endDate: string;
  notes?: string;
  changeReason?: string;
  reassessAfterDays?: number;
  reassessTriggers?: ReassessTrigger[];
  pauseOnPainStop?: boolean;
  scheduleDays?: number[];
  exercises: ExercisePrescription[];
  /** Approved library items (validated by the caller against publishedItems). */
  library?: LibraryRx[];
  isDemo?: boolean;
}

export interface PublishPlan {
  errors: string[];
  changes: PlanChange[];
  previous?: Program;
  program?: Program;
  programExercises?: ProgramExercise[];
  programLibraryItems?: ProgramLibraryItem[];
  /** Open pauses on the previous version; publishing a reviewed version closes them. */
  closesPauses: PlanPause[];
}

/**
 * Validates and prepares a new plan version. Pure: the caller writes the rows (through the store,
 * which enforces that the actor is a clinician). The previous active version is archived, never edited.
 */
export function preparePublish(db: DB, input: PublishInput, now: string, newId: () => string, definitionVersion: (rx: ExercisePrescription) => string): PublishPlan {
  const errors: string[] = [];
  const previous = latestApprovedPlan(db, input.patientId);
  const prevRx = previous ? db.programExercises.filter((e) => e.programId === previous.id).sort((a, b) => a.order - b.order).map((e) => e.prescription) : [];
  const prevLib = previous ? (db.programLibraryItems ?? []).filter((e) => e.programId === previous.id).sort((a, b) => a.order - b.order) : [];
  const changes = previous ? [...diffPlans(prevRx, input.exercises), ...diffLibrary(prevLib, input.library ?? [])] : [];
  if (!input.title.trim()) errors.push('title_required');
  if (input.exercises.length === 0 && !(input.library ?? []).length) errors.push('no_exercises');
  for (const l of input.library ?? []) {
    if (!(l.sets >= 1 && l.sets <= 10) || !(l.frequencyPerWeek >= 1 && l.frequencyPerWeek <= 14)) errors.push('library_dosage');
    if (!l.reps && !l.holdSeconds && !l.durationSeconds) errors.push('library_dosage');
  }
  if (input.startDate > input.endDate) errors.push('dates');
  input.exercises.forEach((rx) => {
    errors.push(...validatePrescription(rx));
    if (rx.alternative) {
      errors.push(...validatePrescription({ ...rx.alternative }).map((e) => `alternative_${e}`));
      if (!rx.alternative.when.trim()) errors.push('alternative_when_required');
    }
  });
  if (input.scheduleDays?.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.push('schedule_days');
  if (input.reassessAfterDays !== undefined && !(input.reassessAfterDays >= 1 && input.reassessAfterDays <= 365)) errors.push('reassess_days_range');
  if (changes.some((c) => c.direction === 'intensify') && !input.changeReason?.trim()) errors.push('intensify_needs_reason');
  const closesPauses = previous ? openPauses(db, previous.id) : [];
  if (errors.length) return { errors: [...new Set(errors)], changes, previous, closesPauses };
  const program: Program = {
    id: newId(),
    patientId: input.patientId,
    clinicianId: input.clinicianId,
    title: input.title.trim(),
    status: 'active',
    startDate: input.startDate,
    endDate: input.endDate,
    approvedAt: now,
    approvedBy: input.clinicianId,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    version: (previous?.version ?? versionCount(db, input.patientId)) + 1,
    supersedes: previous?.id,
    changeReason: input.changeReason?.trim() || undefined,
    reassessAfterDays: input.reassessAfterDays,
    reassessTriggers: input.reassessTriggers?.length ? input.reassessTriggers : undefined,
    pauseOnPainStop: input.pauseOnPainStop ?? true,
    scheduleDays: input.scheduleDays?.length ? [...new Set(input.scheduleDays)].sort() : undefined,
    isDemo: input.isDemo,
  };
  const programExercises = input.exercises.map((rx, i) => ({
    id: newId(),
    programId: program.id,
    order: i,
    prescription: { ...rx, definitionVersion: definitionVersion(rx), alternative: rx.alternative ? { ...rx.alternative, definitionVersion: definitionVersion(rx.alternative) } : undefined },
  }));
  const programLibraryItems = (input.library ?? []).map((l, i) => ({ ...l, id: newId(), programId: program.id, order: i }));
  return { errors: [], changes, previous, program, programExercises, programLibraryItems, closesPauses };
}

function versionCount(db: DB, patientId: ID) {
  return db.programs.filter((p) => p.patientId === patientId).length;
}

/** The latest approved, active plan version — the only one a patient may see or train with. */
export function latestApprovedPlan(db: DB, patientId: ID): Program | undefined {
  return db.programs
    .filter((p) => p.patientId === patientId && p.status === 'active' && !!p.approvedAt && !!p.approvedBy)
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || b.createdAt.localeCompare(a.createdAt))[0];
}

/** All versions for a patient, newest first. */
export function planHistory(db: DB, patientId: ID): Program[] {
  return db.programs.filter((p) => p.patientId === patientId).sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || b.createdAt.localeCompare(a.createdAt));
}

export function openPauses(db: DB, programId: ID): PlanPause[] {
  const resumed = new Set((db.planResumes ?? []).filter((r) => r.programId === programId).map((r) => r.pauseId));
  return (db.planPauses ?? []).filter((p) => p.programId === programId && !resumed.has(p.id)).sort((a, b) => a.at.localeCompare(b.at));
}

export interface ReassessDue {
  reason: string;
  since: string;
}

/** Why a reassessment is due for this plan version (empty = not due). Computed, never stored. */
export function reassessmentDue(db: DB, program: Program, now: string): ReassessDue[] {
  const out: ReassessDue[] = [];
  const approved = program.approvedAt ?? program.createdAt;
  // A reassessment submitted after this version was approved answers every trigger up to then.
  const lastReassess = db.assessments
    .filter((a) => a.patientId === program.patientId && a.createdAt > approved && a.status !== 'in_progress')
    .map((a) => a.createdAt)
    .sort()
    .at(-1);
  const since = lastReassess ?? approved;
  if (program.reassessAfterDays) {
    const due = new Date(new Date(since).getTime() + program.reassessAfterDays * 86_400_000).toISOString();
    if (due <= now) out.push({ reason: `${program.reassessAfterDays} days since ${lastReassess ? 'the last reassessment' : 'approval'}`, since: due });
  }
  const triggers = new Set(program.reassessTriggers ?? []);
  const pauses = (db.planPauses ?? []).filter((p) => p.programId === program.id && p.at > since);
  const painStop = pauses.find((p) => p.reason === 'pain_rule');
  if (triggers.has('pain_stop') && painStop) out.push({ reason: TRIGGER_LABELS.pain_stop, since: painStop.at });
  const patientPause = pauses.find((p) => p.reason === 'patient_report');
  if (triggers.has('patient_pause') && patientPause) out.push({ reason: TRIGGER_LABELS.patient_pause, since: patientPause.at });
  if (triggers.has('pain_increase')) {
    const rise = db.sessions.find((s) => s.programId === program.id && s.startedAt > since && s.painBefore !== undefined && s.painAfter !== undefined && s.painAfter - s.painBefore >= 2);
    if (rise) out.push({ reason: TRIGGER_LABELS.pain_increase, since: rise.startedAt });
  }
  return out;
}

export type PlanState = { kind: 'none' } | { kind: 'paused'; program: Program; pauses: PlanPause[] } | { kind: 'active'; program: Program };

/** What the patient app may do with the plan right now. */
export function planState(db: DB, patientId: ID): PlanState {
  const program = latestApprovedPlan(db, patientId);
  if (!program) return { kind: 'none' };
  const pauses = openPauses(db, program.id);
  return pauses.length ? { kind: 'paused', program, pauses } : { kind: 'active', program };
}

/** Did any in-session pain report stop a session under the clinician's pain rule? */
export function painRuleStopped(painEvents: { paused: boolean }[] | undefined): boolean {
  return !!painEvents?.some((e) => e.paused);
}

/** Dosage text for a library prescription. */
export function libDose(l: Pick<ProgramLibraryItem, 'sets' | 'reps' | 'holdSeconds' | 'durationSeconds' | 'frequencyPerWeek'>): string {
  const per = l.reps ? `${l.sets}×${l.reps}` : l.durationSeconds ? `${l.sets}×${l.durationSeconds} s` : `${l.sets}×${l.holdSeconds} s hold`;
  return `${per}${l.reps && l.holdSeconds ? ` · hold ${l.holdSeconds} s` : ''} · ${l.frequencyPerWeek}/wk`;
}
