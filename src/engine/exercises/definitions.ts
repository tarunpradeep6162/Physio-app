import type { ExerciseDefinition, ExerciseId, ExercisePrescription } from './types';
import type { Side } from '../types';

/**
 * MVP exercise library. Default targets are PLACEHOLDERS for the clinician to overwrite in the
 * Program Builder — the patient app always executes the clinician-approved prescription.
 * Clinical defaults must be reviewed by the supervising physiotherapist before use.
 */

export const KNEE_FLEXION: ExerciseDefinition = {
  id: 'knee_flexion',
  version: '1.0.0',
  nameKey: 'ex.knee_flexion.name',
  summaryKey: 'ex.knee_flexion.summary',
  setupKeys: ['ex.knee_flexion.setup1', 'ex.knee_flexion.setup2', 'ex.knee_flexion.setup3'],
  position: 'standing',
  primary: 'knee_flexion',
  view: 'same_side_lateral',
  cues: { approachKey: 'cue.knee.bend_further', beginKey: 'cue.knee.begin' },
  defaults: {
    target: { min: 80, max: 100 },
    reps: 10,
    sets: 2,
    holdSeconds: 3,
    restSeconds: 45,
    tempo: { minRepMs: 2500, maxVelocityDegPerSec: 160 },
  },
  thresholds: {
    restThreshold: 20,
    startDelta: 10,
    approachMargin: 15,
    holdTolerance: 6,
    overTolerance: 10,
    pauseResetMs: 2500,
    readyStableMs: 600,
  },
  formRules: [
    {
      id: 'trunk_upright',
      measurement: 'trunk_sagittal_lean',
      on: 'same',
      op: 'gt',
      threshold: 20,
      cueKey: 'cue.form.stand_tall',
      activeIn: ['moving', 'target_approach', 'hold'],
      sustainMs: 600,
    },
  ],
  allowedTargetRange: { min: 10, max: 150 },
};

export const STRAIGHT_LEG_RAISE: ExerciseDefinition = {
  id: 'straight_leg_raise',
  version: '1.0.0',
  nameKey: 'ex.slr.name',
  summaryKey: 'ex.slr.summary',
  setupKeys: ['ex.slr.setup1', 'ex.slr.setup2', 'ex.slr.setup3'],
  position: 'supine',
  primary: 'hip_flexion_slr',
  view: 'same_side_lateral',
  cues: { approachKey: 'cue.slr.lift_higher', beginKey: 'cue.slr.begin' },
  defaults: {
    target: { min: 35, max: 50 },
    reps: 10,
    sets: 2,
    holdSeconds: 3,
    restSeconds: 45,
    tempo: { minRepMs: 2500, maxVelocityDegPerSec: 110 },
  },
  thresholds: {
    restThreshold: 10,
    startDelta: 6,
    approachMargin: 10,
    holdTolerance: 5,
    overTolerance: 12,
    pauseResetMs: 2500,
    readyStableMs: 600,
  },
  formRules: [
    {
      id: 'knee_straight',
      measurement: 'knee_extension_angle',
      on: 'same',
      op: 'lt',
      threshold: 160,
      cueKey: 'cue.form.keep_knee_straight',
      activeIn: ['moving', 'target_approach', 'hold'],
      sustainMs: 400,
    },
  ],
  allowedTargetRange: { min: 10, max: 90 },
};

export const SHOULDER_FLEXION: ExerciseDefinition = {
  id: 'shoulder_flexion',
  version: '1.0.0',
  nameKey: 'ex.shoulder_flexion.name',
  summaryKey: 'ex.shoulder_flexion.summary',
  setupKeys: ['ex.shoulder_flexion.setup1', 'ex.shoulder_flexion.setup2', 'ex.shoulder_flexion.setup3'],
  position: 'standing',
  primary: 'shoulder_flexion',
  view: 'same_side_lateral',
  cues: { approachKey: 'cue.shoulder.raise_higher', beginKey: 'cue.shoulder.begin' },
  defaults: {
    target: { min: 140, max: 170 },
    reps: 10,
    sets: 2,
    holdSeconds: 2,
    restSeconds: 45,
    tempo: { minRepMs: 2500, maxVelocityDegPerSec: 180 },
  },
  thresholds: {
    restThreshold: 30,
    startDelta: 12,
    approachMargin: 15,
    holdTolerance: 8,
    overTolerance: 12,
    pauseResetMs: 2500,
    readyStableMs: 600,
  },
  formRules: [
    {
      id: 'elbow_straight',
      measurement: 'elbow_extension_angle',
      on: 'same',
      op: 'lt',
      threshold: 145,
      cueKey: 'cue.form.keep_elbow_straight',
      activeIn: ['moving', 'target_approach', 'hold'],
      sustainMs: 500,
    },
    {
      id: 'no_back_arch',
      measurement: 'trunk_sagittal_lean',
      on: 'same',
      op: 'gt',
      threshold: 15,
      cueKey: 'cue.form.avoid_leaning_back',
      activeIn: ['target_approach', 'hold'],
      sustainMs: 500,
    },
  ],
  allowedTargetRange: { min: 30, max: 180 },
};

export const EXERCISES: Record<ExerciseId, ExerciseDefinition> = {
  knee_flexion: KNEE_FLEXION,
  straight_leg_raise: STRAIGHT_LEG_RAISE,
  shoulder_flexion: SHOULDER_FLEXION,
};

export const EXERCISE_LIST: ExerciseDefinition[] = Object.values(EXERCISES);

/**
 * Registry of historical versions so sessions recorded under older definitions can still be
 * rendered with the thresholds they were actually executed with.
 */
const VERSION_HISTORY: Record<string, ExerciseDefinition> = Object.fromEntries(
  EXERCISE_LIST.map((d) => [`${d.id}@${d.version}`, d]),
);

export function getDefinition(id: ExerciseId, version?: string): ExerciseDefinition {
  if (version) {
    const d = VERSION_HISTORY[`${id}@${version}`];
    if (d) return d;
  }
  return EXERCISES[id];
}

export function defaultPrescription(id: ExerciseId, side: Side): ExercisePrescription {
  const d = EXERCISES[id];
  return {
    definitionId: id,
    definitionVersion: d.version,
    side,
    sets: d.defaults.sets,
    reps: d.defaults.reps,
    target: { ...d.defaults.target },
    holdSeconds: d.defaults.holdSeconds,
    restSeconds: d.defaults.restSeconds,
    tempo: { ...d.defaults.tempo },
    frequencyPerWeek: 5,
  };
}

/** Validates a clinician-entered prescription against the definition's guard-rails. */
export function validatePrescription(p: ExercisePrescription): string[] {
  const d = getDefinition(p.definitionId, p.definitionVersion);
  const errs: string[] = [];
  if (p.target.min >= p.target.max) errs.push('target_min_lt_max');
  if (p.target.min < d.allowedTargetRange.min || p.target.max > d.allowedTargetRange.max) errs.push('target_out_of_range');
  if (p.target.min <= d.thresholds.restThreshold + d.thresholds.startDelta) errs.push('target_below_rest');
  if (p.reps < 1 || p.reps > 50) errs.push('reps_range');
  if (p.sets < 1 || p.sets > 10) errs.push('sets_range');
  if (p.holdSeconds < 0 || p.holdSeconds > 60) errs.push('hold_range');
  if (p.restSeconds < 0 || p.restSeconds > 600) errs.push('rest_range');
  return errs;
}
