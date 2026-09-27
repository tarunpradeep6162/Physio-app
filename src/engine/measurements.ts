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
  | 'shoulder_abduction'
  | 'knee_extension_angle'
  | 'elbow_extension_angle'
  | 'trunk_sagittal_lean'
  // Phases 12–14 (dl-regions-1.0.0). 2D image-plane angles; see each method text.
  | 'hip_flexion_standing'
  | 'hip_abduction_standing'
  | 'tibial_inclination'
  | 'heel_lift_angle'
  | 'trunk_forward_inclination'
  | 'trunk_lateral_flexion'
  | 'head_neck_angle';

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
const deg = (r: number) => (r * 180) / Math.PI;
/** +1 when the foot (heel → toes) points toward image +x, else −1. The body's forward direction in a side view. */
function footForward(p: (i: number) => Vec2, s: Side): 1 | -1 | null {
  const dx = p(idx('foot', s)).x - p(idx('heel', s)).x;
  return Math.abs(dx) < 2 ? null : dx > 0 ? 1 : -1;
}
/** Forward direction from the face (ear → nose), for upper-body tests where the feet may be out of frame. */
function faceForward(p: (i: number) => Vec2, s: Side): 1 | -1 | null {
  const dx = p(0).x - p(idx('ear', s)).x;
  return Math.abs(dx) < 2 ? null : dx > 0 ? 1 : -1;
}

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
  shoulder_abduction: {
    type: 'shoulder_abduction',
    labelKey: 'measure.shoulder_abduction',
    unit: 'deg',
    landmarks: (s) => [idx('hip', s), idx('shoulder', s), idx('elbow', s)],
    validViews: () => ['anterior'],
    method: 'Arm elevation away from image vertical = angle of shoulder→elbow in the frontal plane; requires a level camera. Trunk lean and scapular motion are not separated.',
    compute: (p, s) => {
      const sh = p(idx('shoulder', s));
      const el = p(idx('elbow', s));
      const outward = (s === 'left' ? 1 : -1) * (el.x - sh.x);
      const down = el.y - sh.y;
      if (Math.hypot(outward, down) < 1) return null;
      const angle = Math.atan2(outward, down) * 180 / Math.PI;
      return angle < 0 ? null : angle;
    },
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
    validViews: () => ['lateral_left', 'lateral_right', 'anterior'],
    method: 'Interior elbow angle ∠(shoulder, elbow, wrist); 180° = fully straight.',
    compute: (p, s) => jointAngle(p(idx('shoulder', s)), p(idx('elbow', s)), p(idx('wrist', s))),
  },
  hip_flexion_standing: {
    type: 'hip_flexion_standing',
    labelKey: 'measure.hip_flexion_standing',
    unit: 'deg',
    landmarks: (s) => [idx('shoulder', s), idx('hip', s), idx('knee', s)],
    validViews: sameSideLateral,
    method: 'Hip flexion = 180° − ∠(shoulder, hip, knee): thigh relative to the trunk line, 2D side view, standing. Pelvic tilt is not separated.',
    compute: (p, s) => {
      const a = jointAngle(p(idx('shoulder', s)), p(idx('hip', s)), p(idx('knee', s)));
      return a === null ? null : 180 - a;
    },
  },
  hip_abduction_standing: {
    type: 'hip_abduction_standing',
    labelKey: 'measure.hip_abduction_standing',
    unit: 'deg',
    landmarks: (s) => [idx('hip', s), idx('knee', s), idx('ankle', s)],
    validViews: () => ['anterior'],
    method: 'Leg angle away from image vertical = angle of hip→ankle outward in the front view (level camera). Includes any pelvic hitch or trunk lean, recorded separately.',
    compute: (p, s) => {
      const h = p(idx('hip', s));
      const a = p(idx('ankle', s));
      const outward = (s === 'left' ? 1 : -1) * (a.x - h.x);
      const down = a.y - h.y;
      if (Math.hypot(outward, down) < 1) return null;
      return deg(Math.atan2(outward, down));
    },
  },
  tibial_inclination: {
    type: 'tibial_inclination',
    labelKey: 'measure.tibial_inclination',
    unit: 'deg',
    landmarks: (s) => [idx('knee', s), idx('ankle', s), idx('heel', s), idx('foot', s)],
    validViews: sameSideLateral,
    method: 'Shin angle from image vertical, + = knee forward over the toes (ankle→knee line; forward from heel→toes), 2D side view, heel down. Level camera assumed.',
    compute: (p, s) => {
      const f = footForward(p, s);
      if (f === null) return null;
      const k = p(idx('knee', s));
      const a = p(idx('ankle', s));
      if (a.y - k.y < 1) return null;
      return deg(Math.atan2(f * (k.x - a.x), a.y - k.y));
    },
  },
  heel_lift_angle: {
    type: 'heel_lift_angle',
    labelKey: 'measure.heel_lift_angle',
    unit: 'deg',
    landmarks: (s) => [idx('ankle', s), idx('heel', s), idx('foot', s)],
    validViews: sameSideLateral,
    method: 'Foot angle from image horizontal: heel→toes line, + = heel above toes. 2D side view, level camera. Rest value depends on footwear and landmark placement: compare with the same capture’s start.',
    compute: (p, s) => {
      const h = p(idx('heel', s));
      const t = p(idx('foot', s));
      const dx = Math.abs(t.x - h.x);
      if (Math.hypot(dx, t.y - h.y) < 4) return null;
      return deg(Math.atan2(t.y - h.y, dx));
    },
  },
  trunk_forward_inclination: {
    type: 'trunk_forward_inclination',
    labelKey: 'measure.trunk_forward_inclination',
    unit: 'deg',
    landmarks: (s) => [idx('shoulder', s), idx('hip', s), idx('heel', s), idx('foot', s)],
    validViews: sameSideLateral,
    method: 'Trunk (hip→shoulder line) angle from image vertical, + = forward (toward the toes). Combines hip and spinal movement: it is NOT lumbar range of motion.',
    compute: (p, s) => {
      const f = footForward(p, s);
      if (f === null) return null;
      const h = p(idx('hip', s));
      const sh = p(idx('shoulder', s));
      if (Math.hypot(sh.x - h.x, sh.y - h.y) < 1) return null;
      return deg(Math.atan2(f * (sh.x - h.x), h.y - sh.y));
    },
  },
  trunk_lateral_flexion: {
    type: 'trunk_lateral_flexion',
    labelKey: 'measure.trunk_lateral_flexion',
    unit: 'deg',
    landmarks: () => [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('hip', 'left'), idx('hip', 'right')],
    validViews: () => ['anterior'],
    method: 'Mid-hip→mid-shoulder line angle from image vertical in the front view, + = toward the tested side. Level camera assumed; pelvic shift is included.',
    compute: (p, s) => {
      const sx = (p(idx('shoulder', 'left')).x + p(idx('shoulder', 'right')).x) / 2;
      const sy = (p(idx('shoulder', 'left')).y + p(idx('shoulder', 'right')).y) / 2;
      const hx = (p(idx('hip', 'left')).x + p(idx('hip', 'right')).x) / 2;
      const hy = (p(idx('hip', 'left')).y + p(idx('hip', 'right')).y) / 2;
      if (hy - sy < 1) return null;
      // Facing the camera, the patient's left is image +x.
      const towardLeft = deg(Math.atan2(sx - hx, hy - sy));
      return s === 'left' ? towardLeft : -towardLeft;
    },
  },
  head_neck_angle: {
    type: 'head_neck_angle',
    labelKey: 'measure.head_neck_angle',
    unit: 'deg',
    landmarks: (s) => [idx('shoulder', s), idx('ear', s), 0],
    validViews: sameSideLateral,
    method: 'Shoulder→ear line angle from image vertical, + = ear forward (direction from ear→nose). A head-and-neck position proxy, not cervical range; protocols report change from the start position only.',
    compute: (p, s) => {
      const f = faceForward(p, s);
      if (f === null) return null;
      const sh = p(idx('shoulder', s));
      const e = p(idx('ear', s));
      if (sh.y - e.y < 1) return null;
      return deg(Math.atan2(f * (e.x - sh.x), sh.y - e.y));
    },
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
  /** Per-landmark body support from segmentation; each required landmark must reach `minSupport`. */
  support?: number[] | null;
  minSupport?: number;
  /** Skip the camera-view check (Validation Mode only). */
  ignoreView?: boolean;
  view?: ViewOrientation;
}

export const DEFAULT_MIN_CONFIDENCE = 0.6;
/** A required landmark whose segmentation support is below this lies on something that is not the body. */
export const MIN_SUPPORT = 0.5;

/**
 * Required landmarks must lie at least this far inside the frame. Pose models extrapolate a limb
 * that leaves the frame and place its end point JUST INSIDE the edge with high visibility
 * (measured: off-frame ankles reported at y 0.96–1.02), so an edge band is treated as out of frame.
 */
export const FRAME_MARGIN = 0.04;

export function inFrame(lm: Landmark, margin = FRAME_MARGIN): boolean {
  return lm.x >= margin && lm.x <= 1 - margin && lm.y >= margin && lm.y <= 1 - margin;
}

export type LandmarkIssue = 'out_of_frame' | 'not_on_body' | 'occluded';

/**
 * Validates EACH required landmark on its own — a strong average must never hide one obstructed
 * joint. Issues in priority order: outside the frame, on something that is not the body
 * (segmentation), low model visibility.
 */
export function checkRequired(lms: Landmark[], indices: number[], minConfidence: number, support?: number[] | null, minSupport = MIN_SUPPORT): { issue: LandmarkIssue | null; missing: number[]; confidence: number } {
  const byIssue: Record<LandmarkIssue, number[]> = { out_of_frame: [], not_on_body: [], occluded: [] };
  for (const i of indices) {
    const l = lms[i];
    if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y) || !inFrame(l)) byIssue.out_of_frame.push(i);
    else if (support && support[i] !== undefined && support[i] < minSupport) byIssue.not_on_body.push(i);
    else if (l.visibility < minConfidence) byIssue.occluded.push(i);
  }
  const confidence = Math.min(...indices.map((i) => lms[i]?.visibility ?? 0));
  for (const k of ['out_of_frame', 'not_on_body', 'occluded'] as const) if (byIssue[k].length) return { issue: k, missing: byIssue[k], confidence };
  return { issue: null, missing: [], confidence };
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
  const chk = checkRequired(lms, def.landmarks(side), minC, opts.support, opts.minSupport);
  const confidence = chk.confidence;
  if (chk.issue) {
    return { value: null, confidence: chk.issue === 'out_of_frame' ? 0 : confidence, level: chk.issue === 'out_of_frame' ? 'insufficient' : confidenceLevel(confidence), reason: chk.issue, missing: chk.missing };
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

export type JointState = 'ok' | 'out_of_frame' | 'not_on_body' | 'occluded' | 'no_person';

/** Per-joint status for the live "required joints" indicator — same rules as `checkRequired`. */
export function jointStates(lms: Landmark[] | null, indices: number[], minConfidence = DEFAULT_MIN_CONFIDENCE, support?: number[] | null, minSupport = MIN_SUPPORT): { index: number; state: JointState }[] {
  return indices.map((i) => {
    const l = lms?.[i];
    if (!l) return { index: i, state: 'no_person' as const };
    if (!Number.isFinite(l.x) || !Number.isFinite(l.y) || !inFrame(l)) return { index: i, state: 'out_of_frame' as const };
    if (support && support[i] !== undefined && support[i] < minSupport) return { index: i, state: 'not_on_body' as const };
    if (l.visibility < minConfidence) return { index: i, state: 'occluded' as const };
    return { index: i, state: 'ok' as const };
  });
}
