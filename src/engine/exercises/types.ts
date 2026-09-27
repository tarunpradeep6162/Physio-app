import type { MeasurementType } from '../measurements';
import type { Side, ViewOrientation } from '../types';

/**
 * Exercise definitions are DATA, not UI components. They are versioned: a stored session
 * records the definition id + version and algorithm version it was executed with, so
 * historical results remain interpretable after thresholds or algorithms change.
 */

export type ExerciseId = 'knee_flexion' | 'straight_leg_raise' | 'shoulder_flexion';

export interface Range {
  min: number;
  max: number;
}

export interface TempoConfig {
  /** Minimum duration of a full repetition (ms). Faster reps are flagged. */
  minRepMs: number;
  /** Maximum angular speed (°/s) before a "slow down" cue. */
  maxVelocityDegPerSec: number;
}

/** Secondary form rule evaluated alongside the primary measurement. */
export interface FormRule {
  id: string;
  measurement: MeasurementType;
  /** Which limb the secondary measurement is taken on, relative to the exercised side. */
  on: 'same' | 'opposite';
  op: 'lt' | 'gt';
  threshold: number;
  /** i18n key of the corrective cue. */
  cueKey: string;
  /** Motion states in which the rule is active. */
  activeIn: Array<'moving' | 'target_approach' | 'hold' | 'returning'>;
  /** Condition must persist this long before cueing (avoids chatter). */
  sustainMs: number;
}

export interface MotionThresholds {
  /** At or below this angle the limb is considered at rest. */
  restThreshold: number;
  /** Movement starts when the angle exceeds restThreshold + startDelta (hysteresis). */
  startDelta: number;
  /** "Approaching target" cue fires this many degrees below the target minimum. */
  approachMargin: number;
  /** During a hold the angle may dip this far below target before the hold is broken. */
  holdTolerance: number;
  /** Exceeding target max by more than this triggers an "don't go further" cue. */
  overTolerance: number;
  /** An unfinished rep is discarded if tracking is lost for longer than this. */
  pauseResetMs: number;
  /** Time the limb must rest before the first rep can start. */
  readyStableMs: number;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  version: string;
  nameKey: string;
  summaryKey: string;
  /** Short, numbered setup steps (i18n keys). */
  setupKeys: string[];
  position: 'standing' | 'supine' | 'seated';
  primary: MeasurementType;
  /** Camera view requirement relative to the exercised side. */
  view: 'same_side_lateral';
  /** Exercise-specific cue keys. */
  cues: {
    approachKey: string;
    beginKey: string;
  };
  defaults: {
    target: Range;
    reps: number;
    sets: number;
    holdSeconds: number;
    restSeconds: number;
    tempo: TempoConfig;
  };
  thresholds: MotionThresholds;
  formRules: FormRule[];
  /** Hard limits a clinician-configured target must stay within (safety guard-rail). */
  allowedTargetRange: Range;
}

/** A clinician-authored prescription of one exercise inside a program. */
export interface ExercisePrescription {
  definitionId: ExerciseId;
  definitionVersion: string;
  side: Side;
  sets: number;
  reps: number;
  target: Range;
  holdSeconds: number;
  restSeconds: number;
  tempo: TempoConfig;
  /** Sessions per week. */
  frequencyPerWeek: number;
  instructions?: string;
}

export function requiredView(def: ExerciseDefinition, side: Side): ViewOrientation[] {
  return def.view === 'same_side_lateral' ? [side === 'left' ? 'lateral_left' : 'lateral_right'] : [];
}
