import type { ExerciseResult } from '../engine/exerciseRunner';
import { defaultPrescription } from '../engine/exercises/definitions';
import type { ExerciseId, ExercisePrescription } from '../engine/exercises/types';
import { MEASUREMENT_ALGORITHM_VERSION } from '../engine/measurements';
import { synthesize } from '../engine/pose/synthetic';
import { ENGINE_VERSION, type Provenance } from '../engine/provenance';
import type { Side } from '../engine/types';
import type { DB, Measurement, Patient, TrainingSession } from './models';
import { emptyDb, getDb, replaceDb, uuid } from './store';

/**
 * DEMONSTRATION DATA. Every row is flagged `isDemo: true` and every measurement carries
 * provenance source "simulated_demo". The UI shows a DEMO badge/banner wherever it appears.
 * Names are fictional.
 */

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const dateOnly = (msAgo: number) => iso(msAgo).slice(0, 10);

function demoProv(createdBy: string, confidence: number, exercise?: { id: string; version: string }): Provenance {
  return {
    source: 'simulated_demo',
    createdBy,
    createdAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    algorithmVersion: MEASUREMENT_ALGORITHM_VERSION,
    poseModel: 'synthetic-skeleton',
    poseModelVersion: '1.0.0',
    poseProvider: 'simulated',
    exerciseDefinition: exercise?.id,
    exerciseDefinitionVersion: exercise?.version,
    filter: 'one_euro',
    confidence,
  };
}

function trajectory(peak: number, reps: number, hold: number): { t: number; angle: number | null }[] {
  const out: { t: number; angle: number | null }[] = [];
  const cycle = 1.2 + 1.6 + hold + 1.8;
  for (let i = 0; i < reps * cycle * 10; i++) {
    const t = i / 10;
    const k = t % cycle;
    const e = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
    let a = 4;
    if (k >= 1.2 && k < 2.8) a = 4 + e((k - 1.2) / 1.6) * (peak - 4);
    else if (k >= 2.8 && k < 2.8 + hold) a = peak + Math.sin(t * 7) * 1.2;
    else if (k >= 2.8 + hold) a = peak - e((k - 2.8 - hold) / 1.8) * (peak - 4);
    out.push({ t: Math.round(t * 10) / 10, angle: Math.round(a * 10) / 10 });
  }
  return out;
}

function result(rx: ExercisePrescription, peak: number, completedReps: number, withTrajectory: boolean, seed: number): ExerciseResult {
  const attempts = completedReps + (seed % 3);
  const reps = Array.from({ length: attempts }, (_, i) => {
    const counted = i < completedReps;
    const p = counted ? peak - (i % 4) * 1.5 : rx.target.min - 6;
    return {
      index: i + 1,
      set: Math.min(rx.sets, Math.floor(i / rx.reps) + 1),
      startT: i * 6000,
      endT: i * 6000 + 5200,
      peak: p,
      reachedTarget: counted,
      heldSeconds: counted ? rx.holdSeconds : 0,
      holdRequired: rx.holdSeconds,
      holdAchieved: counted,
      concentricMs: counted ? 1500 + (i % 3) * 120 : null,
      eccentricMs: counted ? 1800 - (i % 2) * 200 : null,
      maxVelocity: 90 + (i % 5) * 8,
      tooFast: i % 7 === 3,
      counted,
      reason: counted ? undefined : ('target_not_reached' as const),
    };
  });
  const peaks = reps.map((r) => r.peak);
  return {
    definitionId: rx.definitionId,
    definitionVersion: rx.definitionVersion,
    algorithmVersion: MEASUREMENT_ALGORITHM_VERSION,
    side: rx.side,
    prescription: rx,
    setsCompleted: rx.sets,
    repsCompleted: completedReps,
    repsAttempted: attempts,
    reps,
    peakRom: Math.max(...peaks),
    meanPeakRom: peaks.reduce((a, b) => a + b, 0) / peaks.length,
    holdsAchieved: completedReps,
    holdsRequired: completedReps,
    meanConcentricMs: 1620,
    meanEccentricMs: 1700,
    fastReps: reps.filter((r) => r.tooFast).length,
    formCues: seed % 2 ? { trunk_upright: 1 } : {},
    trackingCoverage: 0.93 + (seed % 5) / 100,
    meanConfidence: 0.88,
    trajectory: withTrajectory ? trajectory(peak, Math.min(4, completedReps), rx.holdSeconds) : [],
    durationSec: attempts * 6,
    endedEarly: false,
  };
}

interface Course {
  exercises: { id: ExerciseId; side: Side; target: [number, number]; start: number; end: number }[];
  weeks: number;
  sessionsPerWeek: number[];
  pain: number[];
}

export function buildDemoDb(): DB {
  const db = emptyDb();
  const now = new Date().toISOString();

  const clinUser = { id: uuid(), email: 'demo.clinician@physiovision.local', passwordHash: '', passwordSalt: '', role: 'clinician' as const, displayName: 'Dheepika', createdAt: now, isDemo: true };
  const clin = { id: uuid(), userId: clinUser.id, name: 'Dheepika', title: 'Physiotherapist', clinic: 'PhysioVision Clinic', createdAt: now, isDemo: true };
  db.users.push(clinUser);
  db.clinicians.push(clin);
  db.settings = { ...db.settings, clinicName: 'PhysioVision Clinic' };

  const mkPatient = (name: string, sex: Patient['sex'], age: number, concern: string, goal: string, withUser = false): Patient => {
    let userId: string | null = null;
    if (withUser) {
      const u = { id: uuid(), email: 'demo.patient@physiovision.local', passwordHash: '', passwordSalt: '', role: 'patient' as const, displayName: name, createdAt: now, isDemo: true };
      db.users.push(u);
      userId = u.id;
    }
    const p: Patient = {
      id: uuid(),
      userId,
      name,
      sex,
      dob: `${new Date().getFullYear() - age}-04-12`,
      preferredLanguage: 'en',
      concern,
      goal,
      createdAt: iso(40 * DAY),
      isDemo: true,
    };
    db.patients.push(p);
    db.careRelationships.push({ id: uuid(), patientId: p.id, clinicianId: clin.id, status: 'active', createdAt: p.createdAt });
    for (const type of ['camera_processing', 'data_storage'] as const) {
      db.consents.push({ id: uuid(), patientId: p.id, type, granted: true, textVersion: '2026-09', at: p.createdAt });
    }
    return p;
  };

  const course = (p: Patient, c: Course, clinicianBaseline: Record<string, [number, number]>) => {
    const startAgo = c.weeks * 7 * DAY;
    const program = {
      id: uuid(),
      patientId: p.id,
      clinicianId: clin.id,
      title: 'Phase 1 — range of motion',
      status: 'active' as const,
      startDate: dateOnly(startAgo),
      endDate: dateOnly(-3 * 7 * DAY),
      approvedAt: iso(startAgo),
      approvedBy: clin.id,
      notes: 'Progress targets at reassessment.',
      createdAt: iso(startAgo),
      isDemo: true,
    };
    db.programs.push(program);
    const pes = c.exercises.map((e, i) => {
      const rx = { ...defaultPrescription(e.id, e.side), target: { min: e.target[0], max: e.target[1] }, sets: 2, reps: 10 };
      const pe = { id: uuid(), programId: program.id, order: i, prescription: rx };
      db.programExercises.push(pe);
      return { pe, e };
    });
    // Baseline assessment (reviewed)
    const assessment = { id: uuid(), patientId: p.id, createdBy: p.userId ?? clin.id, status: 'reviewed' as const, createdAt: iso(startAgo + DAY), submittedAt: iso(startAgo + DAY), reviewedAt: iso(startAgo), reviewedBy: clin.id, step: 5, isDemo: true };
    db.assessments.push(assessment);
    db.pros.push({ id: uuid(), patientId: p.id, assessmentId: assessment.id, type: 'nprs_now', value: c.pain[0], recordedAt: assessment.createdAt, isDemo: true });

    let sessionIdx = 0;
    const totalSessions = c.sessionsPerWeek.reduce((a, b) => a + b, 0);
    c.sessionsPerWeek.forEach((n, week) => {
      for (let s = 0; s < n; s++) {
        const ago = startAgo - week * 7 * DAY - s * Math.floor(7 / Math.max(1, n)) * DAY - DAY;
        if (ago < DAY / 2) continue;
        const frac = sessionIdx / Math.max(1, totalSessions - 1);
        const painIdx = Math.min(c.pain.length - 1, Math.round(frac * (c.pain.length - 1)));
        const sid = uuid();
        const results = pes.map(({ pe, e }, k) => {
          const peak = e.start + (e.end - e.start) * frac + ((sessionIdx * 7 + k * 3) % 5) - 2;
          const done = Math.min(pe.prescription.reps * pe.prescription.sets, 14 + Math.round(frac * 6));
          return { ...result(pe.prescription, Math.round(peak * 10) / 10, done, sessionIdx >= totalSessions - 3, sessionIdx + k), programExerciseId: pe.id };
        });
        const session: TrainingSession = {
          id: sid,
          patientId: p.id,
          programId: program.id,
          startedAt: iso(ago),
          endedAt: iso(ago - 18 * 60_000),
          status: 'completed',
          painBefore: c.pain[painIdx],
          painAfter: Math.max(0, c.pain[painIdx] - (sessionIdx % 3 === 0 ? 1 : 0)),
          rpe: 4 + (sessionIdx % 3),
          results,
          provenance: demoProv(p.userId ?? p.id, 0.88),
          isDemo: true,
        };
        db.sessions.push(session);
        for (const r of results) {
          db.measurements.push({
            id: uuid(),
            patientId: p.id,
            sessionId: sid,
            type: getMeasureType(r.definitionId as ExerciseId),
            value: r.peakRom!,
            unit: 'deg',
            side: r.side,
            confidence: 0.88,
            category: 'camera_estimate',
            provenance: demoProv(p.userId ?? p.id, 0.88, { id: r.definitionId, version: r.definitionVersion }),
            reviewStatus: 'accepted',
            reviewedBy: clin.id,
            reviewedAt: session.endedAt,
            createdAt: session.startedAt,
            isDemo: true,
          });
        }
        sessionIdx++;
      }
    });

    // Clinician goniometer measurements at baseline and at the latest reassessment.
    for (const [type, [baseline, latest]] of Object.entries(clinicianBaseline)) {
      const side = c.exercises[0].side;
      const mk = (value: number, ago: number): Measurement => ({
        id: uuid(),
        patientId: p.id,
        type,
        value,
        unit: 'deg',
        side,
        confidence: 1,
        category: 'clinician_measured',
        provenance: { ...demoProv(clin.id, 1), source: 'clinician_goniometer' },
        reviewStatus: 'accepted',
        createdAt: iso(ago),
        isDemo: true,
      });
      db.measurements.push(mk(baseline, startAgo), mk(latest, 3 * DAY));
    }
    return program;
  };

  // 1) Demo patient user (post-operative knee) — primary patient-experience demo.
  const arun = mkPatient('Arun Kumar', 'male', 34, 'Left knee stiffness after ACL reconstruction 6 weeks ago.', 'Climb stairs and return to badminton.', true);
  course(
    arun,
    {
      exercises: [
        { id: 'knee_flexion', side: 'left', target: [85, 105], start: 72, end: 91 },
        { id: 'straight_leg_raise', side: 'left', target: [35, 50], start: 28, end: 44 },
      ],
      weeks: 4,
      sessionsPerWeek: [4, 5, 4, 3],
      pain: [6, 5, 5, 4, 3],
    },
    { knee_flexion: [75, 94] },
  );

  // 2) Shoulder
  const meena = mkPatient('Meena Rajan', 'female', 52, 'Right shoulder stiffness; cannot reach the top shelf.', 'Comb hair and hang washing without pain.');
  course(
    meena,
    {
      exercises: [{ id: 'shoulder_flexion', side: 'right', target: [140, 170], start: 108, end: 141 }],
      weeks: 5,
      sessionsPerWeek: [3, 4, 4, 5, 3],
      pain: [7, 6, 5, 4, 4],
    },
    { shoulder_flexion: [112, 145] },
  );

  // 3) Low adherence + pain increase (older adult knee)
  const lakshmi = mkPatient('Lakshmi Devi', 'female', 68, 'Right knee pain when walking and on stairs, several months.', 'Walk to the temple without stopping.');
  course(
    lakshmi,
    {
      exercises: [{ id: 'knee_flexion', side: 'right', target: [80, 100], start: 78, end: 84 }],
      weeks: 3,
      sessionsPerWeek: [3, 1, 1],
      pain: [5, 5, 6, 7],
    },
    {},
  );
  db.alerts.push(
    { id: uuid(), patientId: lakshmi.id, type: 'pain_increase', severity: 'warning', detail: 'Session pain 5 → 7 over the last week', createdAt: iso(2 * DAY), isDemo: true },
    { id: uuid(), patientId: lakshmi.id, type: 'low_adherence', severity: 'info', detail: '2 of 10 planned sessions in 14 days', createdAt: iso(DAY), isDemo: true },
  );

  // 4) New patient with a submitted assessment awaiting review.
  const karthik = mkPatient('Karthik S', 'male', 27, 'Lower back and right shoulder ache after long hours at a desk.', 'Work a full day without pain.');
  const a = { id: uuid(), patientId: karthik.id, createdBy: karthik.id, status: 'submitted' as const, createdAt: iso(DAY), submittedAt: iso(DAY - 3600_000), step: 5, isDemo: true };
  db.assessments.push(a);
  for (const r of ['lower_back_center', 'shoulder_right_back', 'neck_back']) db.painRegions.push({ id: uuid(), assessmentId: a.id, regionId: r });
  const pro = (type: import('./models').ProType, value: import('./models').PatientReportedOutcome['value']) =>
    db.pros.push({ id: uuid(), patientId: karthik.id, assessmentId: a.id, type, value, recordedAt: a.createdAt, isDemo: true });
  pro('nprs_now', 4);
  pro('nprs_worst_24h', 6);
  pro('pain_quality', ['dull', 'stiffness']);
  pro('duration', '6_12w');
  pro('onset', 'gradual');
  pro('aggravating', ['sitting', 'bending']);
  pro('pattern', 'intermittent');
  pro('red_flags', {});
  db.alerts.push({ id: uuid(), patientId: karthik.id, type: 'assessment_submitted', severity: 'info', createdAt: a.submittedAt, isDemo: true });

  const scanLm = synthesize({ kind: 'standing_anterior', shoulderTiltDeg: 3.4, pelvicTiltDeg: 1.1 }, { noisePx: 0.5 });
  const scan = { id: uuid(), patientId: karthik.id, assessmentId: a.id, kind: 'static_posture' as const, view: 'anterior', frameWidth: 720, frameHeight: 1280, landmarks: scanLm, provenance: demoProv(karthik.id, 0.91), createdAt: a.createdAt, isDemo: true };
  const scanLat = { id: uuid(), patientId: karthik.id, assessmentId: a.id, kind: 'static_posture' as const, view: 'lateral_right', frameWidth: 720, frameHeight: 1280, landmarks: synthesize({ kind: 'standing_lateral', side: 'right', trunkLean: 6 }, { noisePx: 0.5 }), provenance: demoProv(karthik.id, 0.86), createdAt: a.createdAt, isDemo: true };
  db.scans.push(scan, scanLat);
  const pm = (scanId: string, type: string, value: number, confidence: number, direction?: string, sd = 0.6): Measurement => ({
    id: uuid(),
    patientId: karthik.id,
    assessmentId: a.id,
    scanId,
    type: `posture.${type}`,
    value,
    unit: 'deg',
    direction,
    sd,
    confidence,
    category: 'camera_estimate',
    provenance: demoProv(karthik.id, confidence),
    reviewStatus: 'pending',
    createdAt: a.createdAt,
    isDemo: true,
  });
  const m1 = pm(scan.id, 'shoulder_level', 3.4, 0.91, 'left_higher');
  const m2 = pm(scan.id, 'pelvic_level', 1.1, 0.89, 'left_higher');
  const m3 = pm(scan.id, 'trunk_lateral_lean', 0.8, 0.9, 'neutral');
  const m4 = pm(scanLat.id, 'trunk_sagittal', 6.2, 0.84, undefined, 1.1);
  const m5 = pm(scanLat.id, 'ear_shoulder_line', 17.5, 0.78, undefined, 1.8);
  const m6: Measurement = { ...pm(scanLat.id, 'x', 158, 0.83), type: 'shoulder_flexion', side: 'right', scanId: undefined, provenance: demoProv(karthik.id, 0.83, { id: 'shoulder_flexion', version: '1.0.0' }) };
  db.measurements.push(m1, m2, m3, m4, m5, m6);
  const thr = db.settings.thresholds;
  db.observations.push(
    { id: uuid(), patientId: karthik.id, assessmentId: a.id, measurementId: m1.id, rule: 'shoulder_level', threshold: thr.shoulder_level, value: 3.4, status: 'pending', createdAt: a.createdAt, isDemo: true },
    { id: uuid(), patientId: karthik.id, assessmentId: a.id, measurementId: m5.id, rule: 'ear_shoulder_line', threshold: thr.ear_shoulder_line, value: 17.5, status: 'pending', createdAt: a.createdAt, isDemo: true },
  );

  db.notes.push({ id: uuid(), patientId: arun.id, authorId: clin.id, body: 'Wound healed. Good quadriceps activation. Progress flexion target to 95–110° next week if pain ≤ 3/10.', createdAt: iso(3 * DAY), isDemo: true });
  db.messages.push(
    { id: uuid(), patientId: arun.id, fromUserId: clinUser.id, fromName: 'Dheepika', body: 'Hi Arun, your knee flexion is improving well. Keep the holds slow and controlled.', at: iso(2 * DAY), isDemo: true },
  );
  return db;
}

function getMeasureType(id: ExerciseId): string {
  return id === 'knee_flexion' ? 'knee_flexion' : id === 'straight_leg_raise' ? 'hip_flexion_slr' : 'shoulder_flexion';
}

/** Seeds demo data on first run (or when the store has no demo rows and the user asks). */
export function ensureDemoData() {
  const cur = getDb();
  if (cur.users.some((u) => u.isDemo)) return;
  const demo = buildDemoDb();
  const merged: DB = { ...cur };
  for (const k of Object.keys(demo) as (keyof DB)[]) {
    const v = demo[k];
    if (Array.isArray(v)) (merged as unknown as Record<string, unknown[]>)[k] = [...((cur[k] as unknown[]) ?? []), ...v];
  }
  replaceDb(merged);
}
