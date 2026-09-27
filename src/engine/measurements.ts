import { idx } from './landmarks';
import type { Estimate, Landmark, Side, ViewOrientation } from './types';
import { confidenceLevel } from './types';
import { deviationFromVertical, jointAngle, jointAngle3, toPixels, type Vec2 } from './vector';

/**
 * Measurement registry. Every camera-estimated number shown anywhere in the product is produced
 * by one of these definitions so that its method, required landmarks and valid camera views are
 * explicit and versioned.
 */

export const MEASUREMENT_ALGORITHM_VERSION = 'pv-biomech-1.0.0';

export type MeasurementType =
  | 'knee_flexion'
  | 'hip_flexion_slr'
  | 'shoulder_flexion'
  | 'knee_extension_angle'
  | 'elbow_extension_angle'
  | 'trunk_sagittal_lean';

export interface MeasurementDef {
  type: MeasurementType;
  /** i18n key for the display label. */
  labelKey: string;
  unit: 'deg';
  /** Landmark indices that must be confidently visible. */
  landmarks(side: Side): number[];
  /** Camera views in which the 2D projection is a reasonable estimate of the clinical angle. */
  validViews(side: Side): ViewOrientation[];
  /** Plain-language description of the method, surfaced in clinician review. */
  method: string;
  compute(p: (i: number) => Vec2, side: Side): number | null;
  compute3d?(w: Landmark[], side: Side): number | null;
}

/** Sagittal-plane measures are only meaningful when the measured side faces the camera. */
const sameSideLateral = (side: Side): ViewOrientation[] => [side === 'left' ? 'lateral_left' : 'lateral_right'];
const anyLateral = (): ViewOrientation[] => ['lateral_left', 'lateral_right'];

export const MEASUREMENTS: Record<MeasurementType, MeasurementDef> = {
  knee_flexion: {
    type: 'knee_flexion',
    labelKey: 'measure.knee_flexion',
    unit: 'deg',
    landmarks: (s) => [idx('hip', s), idx('knee', s), idx('ankle', s)],
    validViews: sameSideLateral,
    method: 'Knee flexion = 180° − ∠(hip, knee, ankle), 2D image-plane projection from a lateral view.',
    compute: (p, s) => {
      const a = jointAngle(p(idx('hip', s)), p(idx('knee', s)), p(idx('ankle', s)));
      return a === null ? null : 180 - a;
    },
    compute3d: (w, s) => {
      const a = jointAngle3(w[idx('hip', s)], w[idx('knee', s)], w[idx('ankle', s)]);
      return a === null ? null : 180 - a;
    },
  },
  hip_flexion_slr: {
    type: 'hip_flexion_slr',
    labelKey: 'measure.hip_flexion_slr',
    unit: 'deg',
    landmarks: (s) => [idx('shoulder', s), idx('hip', s), idx('ankle', s), idx('knee', s)],
    validViews: sameSideLateral,
    method: 'Leg elevation = 180° − ∠(shoulder, hip, ankle): angle of the leg relative to the trunk line, lateral view, supine.',
    compute: (p, s) => {
      const a = jointAngle(p(idx('shoulder', s)), p(idx('hip', s)), p(idx('ankle', s)));
      return a === null ? null : 180 - a;
    },
    compute3d: (w, s) => {
      const a = jointAngle3(w[idx('shoulder', s)], w[idx('hip', s)], w[idx('ankle', s)]);
      return a === null ? null : 180 - a;
    },
  },
  shoulder_flexion: {
    type: 'shoulder_flexion',
    labelKey: 'measure.shoulder_flexion',
    unit: 'deg',
    landmarks: (s) => [idx('hip', s), idx('shoulder', s), idx('elbow', s)],
    validViews: sameSideLateral,
    method: 'Shoulder flexion = ∠(hip, shoulder, elbow): humerus relative to the trunk line, lateral view.',
    compute: (p, s) => jointAngle(p(idx('hip', s)), p(idx('shoulder', s)), p(idx('elbow', s))),
    compute3d: (w, s) => jointAngle3(w[idx('hip', s)], w[idx('shoulder', s)], w[idx('elbow', s)]),
  },
  knee_extension_angle: {
    type: 'knee_extension_angle',
    labelKey: 'measure.knee_extension_angle',
    unit: 'deg',
    landmarks: (s) => [idx('hip', s), idx('knee', s), idx('ankle', s)],
    validViews: anyLateral,
    method: 'Interior knee angle ∠(hip, knee, ankle); 180° = fully straight.',
    compute: (p, s) => jointAngle(p(idx('hip', s)), p(idx('knee', s)), p(idx('ankle', s))),
  },
  elbow_extension_angle: {
    type: 'elbow_extension_angle',
    labelKey: 'measure.elbow_extension_angle',
    unit: 'deg',
    landmarks: (s) => [idx('shoulder', s), idx('elbow', s), idx('wrist', s)],
    validViews: anyLateral,
    method: 'Interior elbow angle ∠(shoulder, elbow, wrist); 180° = fully straight.',
    compute: (p, s) => jointAngle(p(idx('shoulder', s)), p(idx('elbow', s)), p(idx('wrist', s))),
  },
  trunk_sagittal_lean: {
    type: 'trunk_sagittal_lean',
    labelKey: 'measure.trunk_sagittal_lean',
    unit: 'deg',
    landmarks: (s) => [idx('shoulder', s), idx('hip', s)],
    validViews: anyLateral,
    method: 'Absolute angle of the hip→shoulder line from image vertical (assumes a level camera).',
    compute: (p, s) => {
      const d = deviationFromVertical(p(idx('hip', s)), p(idx('shoulder', s)));
      return d === null ? null : Math.abs(d);
    },
  },
};

export interface EstimateOptions {
  /** Minimum per-landmark visibility for a value to be produced at all. */
  minConfidence?: number;
  /** Skip the camera-view check (Validation Mode only). */
  ignoreView?: boolean;
  view?: ViewOrientation;
}

export const DEFAULT_MIN_CONFIDENCE = 0.6;

function inFrame(lm: Landmark): boolean {
  return lm.x >= -0.02 && lm.x <= 1.02 && lm.y >= -0.02 && lm.y <= 1.02;
}

/**
 * Computes a camera-estimated measurement. Returns `value: null` — never a guessed number —
 * when any required landmark is occluded, out of frame, or the body is in the wrong orientation.
 */
export function estimate(
  type: MeasurementType,
  lms: Landmark[] | null,
  width: number,
  height: number,
  side: Side,
  opts: EstimateOptions = {},
): Estimate {
  if (!lms) return { value: null, confidence: 0, level: 'insufficient', reason: 'no_person' };
  const def = MEASUREMENTS[type];
  const minC = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const req = def.landmarks(side).map((i) => lms[i]);
  if (req.some((l) => !inFrame(l))) {
    return { value: null, confidence: 0, level: 'insufficient', reason: 'out_of_frame' };
  }
  const confidence = Math.min(...req.map((l) => l.visibility));
  if (confidence < minC) {
    return { value: null, confidence, level: confidenceLevel(confidence), reason: 'occluded' };
  }
  if (!opts.ignoreView && opts.view && !def.validViews(side).includes(opts.view)) {
    return { value: null, confidence, level: confidenceLevel(confidence), reason: 'wrong_orientation' };
  }
  const value = def.compute((i) => toPixels(lms[i], width, height), side);
  if (value === null || !Number.isFinite(value)) {
    return { value: null, confidence, level: 'insufficient', reason: 'degenerate' };
  }
  return { value, confidence, level: confidenceLevel(confidence) };
}

export function estimate3d(type: MeasurementType, world: Landmark[] | null, side: Side): number | null {
  const def = MEASUREMENTS[type];
  if (!world || !def.compute3d) return null;
  return def.compute3d(world, side);
}
