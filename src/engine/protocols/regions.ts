import { idx } from '../landmarks';
import { checkRequired, DEFAULT_MIN_CONFIDENCE, estimate, type MeasurementType } from '../measurements';
import type { ProcessedFrame } from '../pipeline';
import type { Side, ViewOrientation } from '../types';
import type { Cycle } from './cycles';
import { extraNearPeak, median, metric } from './common';
import type { MetricSpec, ProtocolDef, ProtocolMetric, Recording, SignalFn, SignalSample } from './types';

/**
 * Hip (Phase 12), ankle and foot (Phase 13), spine and neck (Phase 14), and balance and gait
 * (Phase 15) protocols — v1.0.0, algorithm dl-regions-1.0.0. DRAFT for clinical-lead review
 * (approval on hold). Each test measures only what a single RGB camera can resolve from 2D pose
 * landmarks; everything else is listed as a limitation and left to the clinical examination.
 * No population norms, severity grades or threshold observations are produced.
 */

export const REGIONS_ALGORITHM_VERSION = 'dl-regions-1.0.0';

const LIGHTING = 'Light falling on you from the front or side — not a bright window behind you.';
const ACTIVE_ONLY = 'Active movement only. Pain, strength, passive range and the cause of symptoms are not measured: record them from the patient and the clinical examination.';
const NOT_INTERCHANGEABLE = 'Not interchangeable with goniometry or inclinometry until validated against them.';

const sameSideLateral = (side: Side | null): ViewOrientation[] => (side === 'right' ? ['lateral_right'] : ['lateral_left']);
const anyLateral = (): ViewOrientation[] => ['lateral_left', 'lateral_right'];
const sideFromView = (v: ViewOrientation): Side | null => (v === 'lateral_left' ? 'left' : v === 'lateral_right' ? 'right' : null);
const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** Angle signal from a registered measurement, with optional extras computed on the same frame. */
function angleSignal(type: MeasurementType, sideOf: (f: ProcessedFrame) => Side | null, extras?: (f: ProcessedFrame, side: Side) => Record<string, number | null>): SignalFn {
  return (f) => {
    if (f.status !== 'tracking') return { value: null, confidence: 0, reason: f.status };
    if (f.orientation === 'unknown') return { value: null, confidence: 0, reason: 'orientation_uncertain' };
    const side = sideOf(f);
    if (!side) return { value: null, confidence: 0, reason: 'wrong_orientation' };
    const e = estimate(type, f.smoothed, f.width, f.height, side, { view: f.orientation, support: f.support });
    return { value: e.value, confidence: e.confidence, reason: e.reason, missing: e.missing, extras: e.value === null || !extras ? undefined : extras(f, side) };
  };
}

/**
 * Change from the start position: the first `n` valid values (patient standing still, as the
 * set-up instructs) define the zero. Used where the absolute angle depends on footwear, landmark
 * placement or habitual posture — only the movement is reported, never the posture.
 */
function relativeToStart(inner: SignalFn, n = 10): SignalFn {
  const base: number[] = [];
  let zero: number | null = null;
  return (f) => {
    const s = inner(f);
    if (s.value === null) return s;
    if (zero === null) {
      base.push(s.value);
      if (base.length < n) return { ...s, value: 0, extras: { ...s.extras, absolute: s.value } };
      zero = median(base);
    }
    return { ...s, value: s.value - zero!, extras: { ...s.extras, absolute: s.value, start_position: zero } };
  };
}

const extraAt = (key: string, type: MeasurementType, side: (s: Side) => Side = (s) => s) => (f: ProcessedFrame, s: Side) => ({
  [key]: estimate(type, f.smoothed, f.width, f.height, side(s), { view: f.orientation, support: f.support }).value,
});

const peaksOf = (rec: Recording) => rec.detector.cycles.filter((c) => c.valid);
const maxPeak = (spec: MetricSpec, cycles: Cycle[]) => metric(spec, cycles.length ? Math.max(...cycles.map((c) => c.peak)) : null, cycles.map((c) => c.peak));
const medianExtra = (spec: MetricSpec, rec: Recording, cycles: Cycle[], key: string) => {
  const vs = cycles.map((c) => extraNearPeak(rec, c, key)).filter((v): v is number => v !== null);
  return metric(spec, median(vs), vs);
};

const upCycle = (rest: number, engaged: number, minCycleMs = 1000) => ({ direction: 'up' as const, rest, engaged, minCycleMs, pauseResetMs: 2000, readyMs: 500, maxGapInCycleMs: 250, minSamples: 8 });

// =============================================================================================
// Phase 12 — Hip
// =============================================================================================
const HIP_FLEX: MetricSpec = { id: 'hip_flexion_peak', label: 'Hip flexion, standing (peak)', unit: 'deg', method: 'Max over valid repetitions of 180° − ∠(shoulder, hip, knee), tested side, 2D side view. Zero-phase smoothed.', interpretation: '0° = thigh in line with the trunk. Includes any pelvic tilt or trunk movement.' };
const HIP_FLEX_TRUNK: MetricSpec = { id: 'hip_flexion_trunk_lean', label: 'Trunk angle at peak (compensation check)', unit: 'deg', method: 'Median across valid repetitions of the hip→shoulder angle from image vertical within ±250 ms of each peak.', interpretation: 'Descriptive only; leaning back inflates the thigh-to-trunk angle.' };

export const HIP_FLEXION_STANDING: ProtocolDef = {
  id: 'hip_flexion_standing',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'hip',
  title: 'Active hip flexion, standing (side view)',
  shortTitle: 'Hip flexion',
  purpose: 'Camera-estimated active thigh lift toward the chest while standing, one side at a time, with a trunk compensation check.',
  position: 'standing',
  sided: true,
  views: sameSideLateral,
  requiredLandmarks: (s) => [idx('shoulder', s ?? 'left'), idx('hip', s ?? 'left'), idx('knee', s ?? 'left')],
  setup: [
    'Stand side-on to the camera, the tested leg nearest it. Hold a stable chair or worktop with the far hand.',
    'Stand tall. Lift the knee up toward your chest as far as is comfortable, keeping your back upright, then lower it. Repeat 3 times.',
    'Stop if it hurts more than usual or you feel unsteady.',
  ],
  cueStart: 'Lift your knee toward your chest, then lower it',
  targetCycles: 3,
  maxDurationSec: 60,
  cycle: upCycle(15, 45),
  signalLabel: 'Hip flexion',
  signalUnit: 'deg',
  createSignal: (side) => angleSignal('hip_flexion_standing', () => side ?? 'left', extraAt('trunk_lean', 'trunk_sagittal_lean')),
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const c = peaksOf(rec);
    return [maxPeak(HIP_FLEX, c), medianExtra(HIP_FLEX_TRUNK, rec, c, 'trunk_lean')];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    '2D side view: accurate only when the thigh moves straight forward, parallel to a level camera.',
    'Pelvic tilt and lower-back movement are included in the value; the trunk angle is recorded separately, not subtracted.',
    'Hip rotation (internal/external), extension and passive range cannot be measured with one camera.',
    ACTIVE_ONLY,
    NOT_INTERCHANGEABLE,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: (s) => [idx('shoulder', s ?? 'left'), idx('ankle', s ?? 'left')], range: [0.45, 0.85], orientation: 'portrait', maxRollDeg: 4, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at hip height, level, about 2.5–3 m to your side.',
    distance: 'Your whole body from shoulders to feet is in view with space around it.',
    view: 'Stand side-on, the tested leg nearest the camera; the support on the far side.',
    region: 'Shoulder, hip and knee of the tested side stay visible — the support must not hide them.',
    lighting: LIGHTING,
    clothing: 'Shorts or fitted trousers so the hip and knee outline is visible.',
    example: (s) => ({ kind: 'standing_lateral', side: s ?? 'left', scale: 0.9 }),
  },
};

const HIP_ABD: MetricSpec = { id: 'hip_abduction_peak', label: 'Hip abduction, standing (peak leg angle)', unit: 'deg', method: 'Max over valid repetitions of the hip→ankle angle outward from image vertical, front view. Zero-phase smoothed.', interpretation: '0° = leg vertical. Includes pelvic hitch and trunk side-lean (recorded separately).' };
const HIP_ABD_LEAN: MetricSpec = { id: 'hip_abduction_trunk_lean', label: 'Trunk side-lean toward the standing leg at peak', unit: 'deg', method: 'Median across valid repetitions of the mid-hip→mid-shoulder angle from image vertical within ±250 ms of each peak; + = toward the standing leg.', interpretation: 'Descriptive compensation check only.' };

export const HIP_ABDUCTION_STANDING: ProtocolDef = {
  id: 'hip_abduction_standing',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'hip',
  title: 'Active hip abduction, standing (front view)',
  shortTitle: 'Hip abduction',
  purpose: 'Camera-estimated active sideways leg lift while standing, one side at a time, with a trunk side-lean check.',
  position: 'standing',
  sided: true,
  views: () => ['anterior'],
  requiredLandmarks: (s) => [idx('hip', s ?? 'left'), idx('knee', s ?? 'left'), idx('ankle', s ?? 'left'), idx('hip', other(s ?? 'left'))],
  setup: [
    'Face the camera, feet together. Hold a stable chair or worktop beside the standing leg.',
    'Keeping the knee straight and toes pointing forward, lift the tested leg out to the side as far as is comfortable, then lower it. Keep your body upright. Repeat 3 times.',
    'Stop if it hurts more than usual or you feel unsteady.',
  ],
  cueStart: 'Lift your leg out to the side, then lower it',
  targetCycles: 3,
  maxDurationSec: 60,
  cycle: upCycle(8, 18),
  signalLabel: 'Hip abduction',
  signalUnit: 'deg',
  createSignal: (side) => angleSignal('hip_abduction_standing', () => side ?? 'left', extraAt('trunk_lean_to_stance', 'trunk_lateral_flexion', other)),
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const c = peaksOf(rec);
    return [maxPeak(HIP_ABD, c), medianExtra(HIP_ABD_LEAN, rec, c, 'trunk_lean_to_stance')];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    'Measured from the image vertical: a tilted camera, pelvic hitch or trunk side-lean changes the value. Keep the phone level; the side-lean is recorded separately.',
    'A leg that swings forward is foreshortened in the front view and under-reads.',
    'Hip rotation and strength (e.g. of the abductors) cannot be measured with one camera.',
    ACTIVE_ONLY,
    NOT_INTERCHANGEABLE,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: () => [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('ankle', 'left'), idx('ankle', 'right')], range: [0.45, 0.85], orientation: 'portrait', maxRollDeg: 3, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at hip height, level, about 3 m in front of you.',
    distance: 'Shoulders to feet fill most of the screen height with room at both sides for the leg.',
    view: 'Face the camera squarely.',
    region: 'Both hips, the tested knee and ankle stay visible; the support must not hide the tested leg.',
    lighting: LIGHTING,
    clothing: 'Shorts or fitted trousers.',
    example: (s) => ({ kind: 'standing_anterior', legSide: s ?? 'left', hipAbduction: 0, scale: 0.9 }),
  },
};

// =============================================================================================
// Phase 13 — Ankle and foot
// =============================================================================================
/** A repetition whose heel rose more than this during the lunge is not a heel-down measurement. */
export const LUNGE_MAX_HEEL_RISE_DEG = 5;
const LUNGE: MetricSpec = { id: 'knee_to_wall_shin_angle', label: 'Knee-to-wall lunge — shin angle (peak, heel down)', unit: 'deg', method: `Max over valid repetitions with the heel down of the ankle→knee angle from image vertical (+ = forward over the toes). Repetitions where the heel angle rose > ${LUNGE_MAX_HEEL_RISE_DEG}° from the start are excluded.`, interpretation: 'A weight-bearing dorsiflexion proxy: shin inclination, not the ankle joint angle itself.' };
const LUNGE_HEEL: MetricSpec = { id: 'knee_to_wall_heel_rise', label: 'Heel rise at peak (quality check)', unit: 'deg', method: 'Median change in the heel→toes angle at each peak relative to the start position.', interpretation: 'Should be near 0; larger values mean the heel lifted.' };

export const ANKLE_KNEE_TO_WALL: ProtocolDef = {
  id: 'ankle_knee_to_wall',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'ankle',
  title: 'Knee-to-wall lunge (side view)',
  shortTitle: 'Knee-to-wall lunge',
  purpose: 'Camera-estimated forward shin angle in a weight-bearing lunge with the heel down — a proxy for ankle dorsiflexion range.',
  position: 'standing',
  sided: true,
  views: sameSideLateral,
  requiredLandmarks: (s) => [idx('knee', s ?? 'left'), idx('ankle', s ?? 'left'), idx('heel', s ?? 'left'), idx('foot', s ?? 'left')],
  setup: [
    'Stand side-on to the camera facing a wall, the tested foot in front, a hand on the wall for balance. Barefoot or in thin socks — shoes hide the heel and toes.',
    'Keep the heel on the floor. Bend the front knee forward toward the wall as far as you can without the heel lifting, hold 2 seconds, then straighten. Repeat 3 times.',
    'Stop if it hurts more than usual.',
  ],
  cueStart: 'Bend your front knee toward the wall, heel down',
  targetCycles: 3,
  maxDurationSec: 60,
  cycle: upCycle(12, 22),
  signalLabel: 'Shin angle',
  signalUnit: 'deg',
  createSignal: (side) => {
    const heel = relativeToStart(angleSignal('heel_lift_angle', () => side ?? 'left'));
    const shin = angleSignal('tibial_inclination', () => side ?? 'left');
    return (f) => {
      const s = shin(f);
      const h = heel(f);
      return s.value === null ? s : { ...s, extras: { heel_rise: h.value } };
    };
  },
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const c = peaksOf(rec);
    const rise = c.map((x) => extraNearPeak(rec, x, 'heel_rise'));
    const heelDown = c.filter((_, i) => rise[i] !== null && rise[i]! <= LUNGE_MAX_HEEL_RISE_DEG);
    const heelRiseVals = rise.filter((v): v is number => v !== null);
    const main = heelDown.length ? maxPeak(LUNGE, heelDown) : metric(LUNGE, null, [], c.length ? 'The heel lifted (or was not visible) in every repetition' : undefined);
    return [main, metric(LUNGE_HEEL, median(heelRiseVals), heelRiseVals)];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    'Shin inclination from the image vertical: a tilted camera shifts the value. The distance from the toes to the wall, which clinicians also use, is not measured.',
    'Needs the heel and toes visible: shoes, socks with patterns, floor clutter or the other foot in front invalidate the capture.',
    'Subtalar and midfoot movement, ankle stability and calf strength cannot be measured with one camera.',
    ACTIVE_ONLY,
    NOT_INTERCHANGEABLE,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: (s) => [idx('hip', s ?? 'left'), idx('foot', s ?? 'left')], range: [0.3, 0.7], orientation: 'portrait', maxRollDeg: 3, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at knee height, level, about 1.5–2 m to your side, pointing at the tested foot.',
    distance: 'Hips to toes fill about half the screen height; the whole front foot is in view.',
    view: 'Side-on, tested foot in front and nearest the camera.',
    region: 'Knee, ankle, heel and toes of the tested foot stay visible, not hidden by the back foot.',
    lighting: LIGHTING,
    clothing: 'Barefoot (or thin plain socks), shorts or rolled-up trousers.',
    example: (s) => ({ kind: 'lunge_lateral', side: s ?? 'left', shankTilt: 5 }),
  },
};

const HEEL_COUNT: MetricSpec = { id: 'heel_raise_count', label: 'Heel raises counted', unit: 'count', method: 'Valid repetitions in which the foot rotated ≥ 12° from the start position and returned (maximum 10 per capture).', interpretation: 'A count of repetitions in this capture — not a strength or endurance measure.' };
const HEEL_PEAK: MetricSpec = { id: 'heel_raise_height_angle', label: 'Heel raise (median peak foot angle change)', unit: 'deg', method: 'Median across valid repetitions of the peak change in the heel→toes angle from the start position, measured foot (nearest the camera).' };

export const HEEL_RAISE: ProtocolDef = {
  id: 'heel_raise_double',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'ankle',
  title: 'Double-leg heel raise (side view)',
  shortTitle: 'Heel raise',
  purpose: 'Counts heel raises and describes how far the heel rises, measured on the foot nearest the camera.',
  position: 'standing',
  sided: false,
  views: anyLateral,
  requiredLandmarks: () => [idx('ankle', 'left'), idx('heel', 'left'), idx('foot', 'left')],
  setup: [
    'Stand side-on to the camera, barefoot, feet hip-width apart, fingertips on a wall or worktop for balance.',
    'Rise up onto your toes as high as is comfortable, then lower slowly. Repeat up to 10 times at a steady pace.',
    'Stop if it hurts more than usual or you feel unsteady.',
  ],
  cueStart: 'Rise up onto your toes, then lower slowly',
  targetCycles: 10,
  maxDurationSec: 60,
  cycle: upCycle(5, 12, 800),
  signalLabel: 'Heel rise',
  signalUnit: 'deg',
  createSignal: () => relativeToStart(angleSignal('heel_lift_angle', (f) => sideFromView(f.orientation))),
  isComplete: (d) => d.validCount >= 10,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const c = peaksOf(rec);
    return [metric(HEEL_COUNT, c.length, c.map(() => 1)), metric(HEEL_PEAK, median(c.map((x) => x.peak)), c.map((x) => x.peak))];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 3 },
  limitations: [
    'Only the foot nearest the camera is measured; the far foot is hidden.',
    'Needs heel and toes visible: shoes, clutter or the far foot overlapping invalidate the capture.',
    'Heel height is described as a foot angle change, not in centimetres (distance is not calibrated).',
    'Calf strength, endurance and fatigue are not measured — the count is descriptive only.',
    NOT_INTERCHANGEABLE,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: () => [idx('hip', 'left'), idx('foot', 'left')], range: [0.3, 0.7], orientation: 'portrait', maxRollDeg: 3, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at knee height, level, about 1.5–2 m to your side.',
    distance: 'Hips to toes fill about half the screen height.',
    view: 'Side-on to the camera.',
    region: 'Ankle, heel and toes of the near foot stay visible.',
    lighting: LIGHTING,
    clothing: 'Barefoot, shorts or rolled-up trousers.',
    example: (s) => ({ kind: 'standing_lateral', side: s ?? 'left', scale: 0.9 }),
  },
};

// =============================================================================================
// Phase 14 — Spine and neck
// =============================================================================================
const TRUNK_FWD: MetricSpec = { id: 'trunk_forward_bend_peak', label: 'Trunk forward bend (peak inclination)', unit: 'deg', method: 'Max over valid repetitions of the hip→shoulder angle from image vertical, + = forward, side view.', interpretation: 'Combined hip and spine movement — not lumbar range of motion. Posture is not interpreted.' };
const TRUNK_KNEE: MetricSpec = { id: 'trunk_forward_bend_knee_angle', label: 'Knee angle at peak (compensation check)', unit: 'deg', method: 'Median interior knee angle ∠(hip, knee, ankle) within ±250 ms of each peak; 180° = straight.', interpretation: 'Bending the knees changes what the trunk angle represents.' };

export const TRUNK_FORWARD_BEND: ProtocolDef = {
  id: 'trunk_forward_bend',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'spine',
  title: 'Standing forward bend (side view)',
  shortTitle: 'Forward bend',
  purpose: 'Camera-estimated forward trunk inclination while bending forward from standing, with a knee-bend check.',
  position: 'standing',
  sided: false,
  views: anyLateral,
  requiredLandmarks: () => [idx('shoulder', 'left'), idx('hip', 'left'), idx('heel', 'left'), idx('foot', 'left')],
  setup: [
    'Stand side-on to the camera, feet hip-width apart, knees straight but relaxed.',
    'Slowly bend forward, letting your arms hang, as far as is comfortable. Then slowly return to standing. Repeat 3 times.',
    'Stop if it brings on pain down the leg, pins and needles, numbness or dizziness.',
  ],
  cueStart: 'Slowly bend forward, then return to standing',
  targetCycles: 3,
  maxDurationSec: 60,
  cycle: upCycle(15, 35, 1500),
  signalLabel: 'Trunk inclination',
  signalUnit: 'deg',
  createSignal: () => angleSignal('trunk_forward_inclination', (f) => sideFromView(f.orientation), extraAt('knee_angle', 'knee_extension_angle')),
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const c = peaksOf(rec);
    return [maxPeak(TRUNK_FWD, c), medianExtra(TRUNK_KNEE, rec, c, 'knee_angle')];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    'The trunk line (hip to shoulder) combines hip and spinal movement: it is not lumbar flexion and must not be compared with lumbar inclinometry.',
    'Spinal curvature, segmental movement, posture and structural findings cannot be resolved from pose landmarks and are not inferred.',
    'Radicular or neurological signs are recorded from the patient and the clinical examination, not the camera.',
    ACTIVE_ONLY,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: () => [idx('shoulder', 'left'), idx('foot', 'left')], range: [0.45, 0.85], orientation: 'portrait', maxRollDeg: 3, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at hip height, level, about 3 m to your side.',
    distance: 'Head to feet fit on the screen with room in front of you for the bend.',
    view: 'Side-on to the camera.',
    region: 'Shoulder, hip, heel and toes of the near side stay visible throughout.',
    lighting: LIGHTING,
    clothing: 'Fitted top tucked in so the hip outline is visible.',
    example: (s) => ({ kind: 'standing_lateral', side: s ?? 'left', scale: 0.85 }),
  },
};

const TRUNK_SIDE: MetricSpec = { id: 'trunk_side_bend_peak', label: 'Trunk side bend (peak)', unit: 'deg', method: 'Max over valid repetitions of the mid-hip→mid-shoulder angle from image vertical toward the tested side, front view.', interpretation: 'Includes pelvic shift. Not segmental spinal range.' };

export const TRUNK_SIDE_BEND: ProtocolDef = {
  id: 'trunk_side_bend',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'spine',
  title: 'Standing side bend (front view)',
  shortTitle: 'Side bend',
  purpose: 'Camera-estimated sideways trunk bend toward one side from standing.',
  position: 'standing',
  sided: true,
  views: () => ['anterior'],
  requiredLandmarks: () => [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('hip', 'left'), idx('hip', 'right')],
  setup: [
    'Face the camera, feet hip-width apart, arms by your sides.',
    'Slide your hand down the side of your leg, bending sideways toward the tested side as far as is comfortable, without leaning forward. Return upright. Repeat 3 times.',
    'Stop if it brings on pain down the leg, pins and needles or numbness.',
  ],
  cueStart: 'Bend sideways, sliding your hand down your leg',
  targetCycles: 3,
  maxDurationSec: 60,
  cycle: upCycle(6, 14, 1200),
  signalLabel: 'Side bend',
  signalUnit: 'deg',
  createSignal: (side) => angleSignal('trunk_lateral_flexion', () => side ?? 'left'),
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => [maxPeak(TRUNK_SIDE, peaksOf(rec))],
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    'Measured from the image vertical: a tilted camera or a sideways pelvic shift changes the value.',
    'Leaning forward during the bend is not separated in the front view.',
    'Spinal curvature, rotation and structural findings are not inferred.',
    ACTIVE_ONLY,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: () => [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('hip', 'left'), idx('hip', 'right')], range: [0.2, 0.4], orientation: 'portrait', maxRollDeg: 2, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at chest height, carefully level, about 2.5 m in front of you.',
    distance: 'Shoulders to hips fill about a third of the screen height.',
    view: 'Face the camera squarely.',
    region: 'Both shoulders and both hips stay visible.',
    lighting: LIGHTING,
    clothing: 'Fitted top so the shoulders and hips are visible.',
    example: () => ({ kind: 'standing_anterior', scale: 0.85 }),
  },
};

const NECK_FLEX: MetricSpec = { id: 'neck_flexion_change', label: 'Head–neck forward movement (change from start)', unit: 'deg', method: 'Max forward change of the shoulder→ear line angle from its start position, side view.', interpretation: 'A head-on-trunk movement proxy — not cervical range of motion. Starting posture is not interpreted.' };
const NECK_EXT: MetricSpec = { id: 'neck_extension_change', label: 'Head–neck backward movement (change from start)', unit: 'deg', method: 'Max backward change of the shoulder→ear line angle from its start position, side view (reported as a positive number).', interpretation: 'A head-on-trunk movement proxy — not cervical range of motion.' };

export const NECK_FLEXION_EXTENSION: ProtocolDef = {
  id: 'neck_flexion_extension',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'spine',
  title: 'Neck forward and backward movement (side view)',
  shortTitle: 'Neck movement',
  purpose: 'Camera-estimated change in head-and-neck position when looking down and up, relative to the start.',
  position: 'standing',
  sided: false,
  views: anyLateral,
  requiredLandmarks: () => [idx('shoulder', 'left'), idx('ear', 'left'), 0],
  setup: [
    'Sit or stand side-on to the camera, looking straight ahead, shoulders relaxed.',
    'Slowly bring your chin toward your chest, return, then slowly look up toward the ceiling, return. Repeat twice. Move gently; keep your shoulders still.',
    'Stop straight away if you feel dizzy, sick, see double, or get pins and needles or weakness in the arms.',
  ],
  cueStart: 'Slowly look down, back to centre, then up',
  targetCycles: 4,
  maxDurationSec: 60,
  cycle: upCycle(5, 12, 1000),
  signalLabel: 'Head–neck movement',
  signalUnit: 'deg',
  createSignal: () => {
    const rel = relativeToStart(angleSignal('head_neck_angle', (f) => sideFromView(f.orientation)));
    return (f): SignalSample => {
      const s = rel(f);
      return s.value === null ? s : { ...s, value: Math.abs(s.value), extras: { ...s.extras, signed_change: s.value } };
    };
  },
  isComplete: (d) => d.validCount >= 4,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const c = peaksOf(rec);
    const signed = c.map((x) => extraNearPeak(rec, x, 'signed_change')).filter((v): v is number => v !== null);
    const fwd = signed.filter((v) => v > 0);
    const back = signed.filter((v) => v < 0).map((v) => -v);
    return [
      metric(NECK_FLEX, fwd.length ? Math.max(...fwd) : null, fwd, fwd.length ? undefined : 'No valid forward movement'),
      metric(NECK_EXT, back.length ? Math.max(...back) : null, back, back.length ? undefined : 'No valid backward movement'),
    ];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    'The ear and shoulder landmarks give a head-on-trunk angle, not cervical spine range; the start position is the zero, so posture is not measured or interpreted.',
    'Rotation and side-bending of the neck are not measured. Hair, collars and headwear can hide the ear.',
    'Dizziness, visual or neurological symptoms are safety findings for the clinician, never inferred from video.',
    ACTIVE_ONLY,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: () => [idx('ear', 'left'), idx('hip', 'left')], range: [0.3, 0.7], orientation: 'portrait', maxRollDeg: 3, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at head height, level, about 1.5–2 m to your side.',
    distance: 'Head to hips fill about half the screen height.',
    view: 'Side-on, looking straight ahead.',
    region: 'Ear, face and shoulder of the near side stay visible; tie back long hair.',
    lighting: LIGHTING,
    clothing: 'A top without a high collar or hood.',
    example: (s) => ({ kind: 'standing_lateral', side: s ?? 'left', scale: 0.9 }),
  },
};

// =============================================================================================
// Phase 15 — Balance and gait
// =============================================================================================
/** Lift of one foot above the other as % of the standing leg's hip→ankle length (front view). */
function footLiftPct(f: ProcessedFrame, lifted: Side): SignalSample {
  if (f.status !== 'tracking') return { value: null, confidence: 0, reason: f.status };
  if (f.orientation !== 'anterior') return { value: null, confidence: 0, reason: f.orientation === 'unknown' ? 'orientation_uncertain' : 'wrong_orientation' };
  const lms = f.smoothed!;
  const req = [idx('hip', 'left'), idx('hip', 'right'), idx('knee', 'left'), idx('knee', 'right'), idx('ankle', 'left'), idx('ankle', 'right')];
  const chk = checkRequired(lms, req, DEFAULT_MIN_CONFIDENCE, f.support);
  if (chk.issue) return { value: null, confidence: chk.confidence, reason: chk.issue, missing: chk.missing };
  const stance = other(lifted);
  const leg = (lms[idx('ankle', stance)].y - lms[idx('hip', stance)].y) * f.height;
  if (leg < 20) return { value: null, confidence: chk.confidence, reason: 'degenerate' };
  const lift = ((lms[idx('ankle', stance)].y - lms[idx('ankle', lifted)].y) * f.height * 100) / leg;
  const hipW = Math.abs(lms[idx('hip', 'left')].x - lms[idx('hip', 'right')].x) * f.width;
  const midX = ((lms[idx('hip', 'left')].x + lms[idx('hip', 'right')].x) / 2) * f.width;
  return { value: lift, confidence: chk.confidence, extras: { pelvis_x_hipwidths: hipW > 1 ? midX / hipW : null } };
}

export const STANCE_TIME_LIMIT_SEC = 30;
const SLS_TIME: MetricSpec = { id: 'single_leg_stance_time', label: 'Single-leg stance time', unit: 's', method: `Time from the lifted foot leaving the floor (> 3% of leg length above the standing foot) to touching down, longest valid trial; the capture stops at ${STANCE_TIME_LIMIT_SEC} s.`, interpretation: `Timing from video at the capture frame rate (±1 frame). A value of ${STANCE_TIME_LIMIT_SEC} s means the time limit was reached.` };
const SLS_SWAY: MetricSpec = { id: 'single_leg_stance_pelvis_sway', label: 'Pelvis side-to-side movement during stance (% of hip width)', unit: 'count', method: 'Range (max − min) of the mid-hip horizontal position during the longest valid trial, in % of hip width.', interpretation: 'Descriptive only; depends on camera distance and clothing.' };

export const SINGLE_LEG_STANCE: ProtocolDef = {
  id: 'single_leg_stance',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'balance',
  title: 'Single-leg stance, eyes open (front view)',
  shortTitle: 'Single-leg stance',
  purpose: 'Times how long the patient stands on the tested leg, with a descriptive pelvis-movement check. The side is the STANDING leg.',
  position: 'standing',
  sided: true,
  views: () => ['anterior'],
  requiredLandmarks: () => [idx('hip', 'left'), idx('hip', 'right'), idx('knee', 'left'), idx('knee', 'right'), idx('ankle', 'left'), idx('ankle', 'right')],
  setup: [
    'Only do this test with a sturdy support (worktop, heavy chair) within easy reach, clear floor around you and — if you have fallen in the last year or feel unsteady — someone standing next to you.',
    'Face the camera, arms relaxed. When ready, lift the other foot a little off the floor and stand on the tested leg for as long as you comfortably can, up to 30 seconds.',
    'Put the foot down or hold the support as soon as you feel unsteady — that ends the test safely.',
  ],
  cueStart: 'Lift the other foot and stand on the tested leg',
  targetCycles: 1,
  maxDurationSec: STANCE_TIME_LIMIT_SEC + 8,
  cycle: { direction: 'up', rest: 3, engaged: 6, minCycleMs: 500, pauseResetMs: 1000, readyMs: 800, maxGapInCycleMs: 250, minSamples: 8 },
  signalLabel: 'Foot lift',
  signalUnit: 'pct_leg',
  createSignal: (side) => (f) => footLiftPct(f, other(side ?? 'left')),
  isComplete: (d) => d.validCount >= 1,
  // Reaching the time limit mid-stance still counts: the trial ended safely at the limit.
  closeAcceptsEngaged: true,
  analyze: (rec) => {
    const trials = rec.detector.cycles.filter((c) => c.valid).map((c) => {
      const inCycle = rec.samples.filter((s) => s.t >= c.startT && s.t <= (c.endT ?? c.peakT) && s.value !== null);
      const up = inCycle.filter((s) => s.value! > rec.detector.cfg.rest);
      const dur = up.length > 1 ? (up[up.length - 1].t - up[0].t) / 1000 : 0;
      const xs = up.map((s) => s.extras?.pelvis_x_hipwidths).filter((v): v is number => typeof v === 'number');
      return { dur: Math.min(STANCE_TIME_LIMIT_SEC, dur), sway: xs.length > 1 ? (Math.max(...xs) - Math.min(...xs)) * 100 : null };
    });
    const best = trials.sort((a, b) => b.dur - a.dur)[0];
    return [metric(SLS_TIME, best ? best.dur : null, trials.map((t) => t.dur)), metric(SLS_SWAY, best?.sway ?? null, best?.sway !== null && best ? [best.sway!] : [])];
  },
  quality: { minCoverage: 0.8, minMeanConfidence: 0.7, minValidCycles: 1 },
  limitations: [
    'Timing is limited by the frame rate (about ±1 frame) and by the lift threshold; it has not yet been checked against a stopwatch on real phones.',
    'Eyes-open, firm floor only. Fall risk, vestibular function, proprioception and strength are NOT assessed and must not be inferred from the time.',
    'Touching the support is only detected if it moves the lifted foot back down; the clinician should note support use.',
    'Pelvis movement is a 2D descriptive value that depends on distance and clothing.',
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: () => [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('ankle', 'left'), idx('ankle', 'right')], range: [0.45, 0.85], orientation: 'portrait', maxRollDeg: 3, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at hip height, level, about 3 m in front of you.',
    distance: 'Head to feet fit on the screen.',
    view: 'Face the camera; the support beside you, not between you and the camera.',
    region: 'Both hips, knees and ankles stay visible throughout.',
    lighting: LIGHTING,
    clothing: 'Shorts or fitted trousers; flat, non-slip footwear or barefoot on a non-slip floor.',
    example: () => ({ kind: 'standing_anterior', scale: 0.9 }),
  },
};

const MARCH_STEPS: MetricSpec = { id: 'march_steps', label: 'Steps counted (marching on the spot)', unit: 'count', method: 'Valid foot lifts ≥ 8% of leg length above the other foot, maximum 20 per capture. Withheld unless steps are detected on both feet.' };
const MARCH_CADENCE: MetricSpec = { id: 'march_cadence', label: 'Cadence (steps per minute)', unit: 'count', method: 'Steps per minute between the first and last valid lift start: (n − 1) ÷ elapsed time × 60.', interpretation: 'Marching on the spot, not walking speed or gait.' };
const MARCH_LEFT: MetricSpec = { id: 'march_lift_left', label: 'Median foot lift, left', unit: 'pct_leg', method: 'Median peak lift of the left foot across valid steps, % of the standing leg length.' };
const MARCH_RIGHT: MetricSpec = { id: 'march_lift_right', label: 'Median foot lift, right', unit: 'pct_leg', method: 'Median peak lift of the right foot across valid steps, % of the standing leg length.' };
const MARCH_ALT: MetricSpec = { id: 'march_alternation', label: 'Alternating steps (% of consecutive steps)', unit: 'count', method: 'Share (%) of consecutive valid steps taken on the opposite foot to the previous one.', interpretation: 'Descriptive.' };
export const MARCH_MIN_STEPS = 10;

export const MARCH_IN_PLACE: ProtocolDef = {
  id: 'march_in_place',
  version: '1.0.0',
  algorithmVersion: REGIONS_ALGORITHM_VERSION,
  region: 'balance',
  title: 'Marching on the spot (front view)',
  shortTitle: 'Marching',
  purpose: 'Counts steps and describes step rhythm and left/right foot lift while marching on the spot — a camera-friendly stepping observation, not a walking gait analysis.',
  position: 'standing',
  sided: false,
  views: () => ['anterior'],
  requiredLandmarks: () => [idx('hip', 'left'), idx('hip', 'right'), idx('knee', 'left'), idx('knee', 'right'), idx('ankle', 'left'), idx('ankle', 'right')],
  setup: [
    'Face the camera with a sturdy support within reach; if you have fallen in the last year or feel unsteady, have someone next to you.',
    'March on the spot at a comfortable pace, lifting each foot a little, for about 20 steps.',
    'Stop and hold the support if you feel unsteady, dizzy or short of breath.',
  ],
  cueStart: 'March on the spot at a comfortable pace',
  targetCycles: 20,
  maxDurationSec: 45,
  cycle: { direction: 'up', rest: 3, engaged: 8, minCycleMs: 250, pauseResetMs: 1500, readyMs: 800, maxGapInCycleMs: 250, minSamples: 4 },
  signalLabel: 'Foot lift',
  signalUnit: 'pct_leg',
  createSignal: () => (f) => {
    const l = footLiftPct(f, 'left');
    const r = footLiftPct(f, 'right');
    if (l.value === null || r.value === null) return l.value === null ? l : r;
    const leftUp = l.value >= r.value;
    return { value: Math.max(l.value, r.value), confidence: Math.min(l.confidence, r.confidence), extras: { lifted_left: leftUp ? 1 : 0, lift_left: l.value, lift_right: r.value } };
  },
  isComplete: (d) => d.validCount >= 20,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const c = peaksOf(rec);
    const sideOf = (x: Cycle) => (extraNearPeak(rec, x, 'lifted_left') ?? 0) >= 0.5 ? 'left' : 'right';
    const sides = c.map(sideOf);
    const left = c.filter((_, i) => sides[i] === 'left').map((x) => x.peak);
    const right = c.filter((_, i) => sides[i] === 'right').map((x) => x.peak);
    // Cadence, rhythm and left/right values need steps detected on BOTH feet: if one foot lifts less
    // than the detection level, only the other foot's steps are counted and the rate would halve.
    const enough =
      c.length < MARCH_MIN_STEPS
        ? `Fewer than ${MARCH_MIN_STEPS} valid steps`
        : Math.min(left.length, right.length) < 3
          ? `Steps detected on only one foot (${left.length} left, ${right.length} right): the other foot's lift may be below the 8% detection level. Cadence and left/right values withheld.`
          : undefined;
    const span = c.length > 1 ? (c[c.length - 1].startT - c[0].startT) / 60_000 : 0;
    const alt = sides.length > 1 ? (sides.slice(1).filter((s, i) => s !== sides[i]).length / (sides.length - 1)) * 100 : null;
    const out: ProtocolMetric[] = [
      metric(MARCH_STEPS, c.length, c.map(() => 1), Math.min(left.length, right.length) < 3 ? enough : undefined),
      metric(MARCH_CADENCE, span > 0 ? (c.length - 1) / span : null, [], enough),
      metric(MARCH_LEFT, median(left), left, enough),
      metric(MARCH_RIGHT, median(right), right, enough),
      metric(MARCH_ALT, alt, [], enough),
    ];
    return out;
  },
  quality: { minCoverage: 0.8, minMeanConfidence: 0.7, minValidCycles: MARCH_MIN_STEPS },
  limitations: [
    'Marching on the spot is not walking: stride length, walking speed, turning and gait pattern are not measured.',
    'Foot lift is a 2D value in the front view: lifting the knee forward toward the camera is under-read.',
    'Fall risk, endurance and fatigue are NOT assessed and must not be inferred.',
    'Timing depends on the frame rate and has not yet been checked against a reference on real phones.',
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: () => [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('ankle', 'left'), idx('ankle', 'right')], range: [0.45, 0.85], orientation: 'portrait', maxRollDeg: 3, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at hip height, level, about 3 m in front of you.',
    distance: 'Head to feet fit on the screen.',
    view: 'Face the camera.',
    region: 'Both hips, knees and ankles stay visible.',
    lighting: LIGHTING,
    clothing: 'Shorts or fitted trousers; flat, non-slip footwear.',
    example: () => ({ kind: 'standing_anterior', scale: 0.9 }),
  },
};

export const REGION_PROTOCOLS: ProtocolDef[] = [HIP_FLEXION_STANDING, HIP_ABDUCTION_STANDING, ANKLE_KNEE_TO_WALL, HEEL_RAISE, TRUNK_FORWARD_BEND, TRUNK_SIDE_BEND, NECK_FLEXION_EXTENSION, SINGLE_LEG_STANCE, MARCH_IN_PLACE];

type Plan = { protocolId: string; side: Side | null }[];
const both = (id: string): Plan => [
  { protocolId: id, side: 'left' },
  { protocolId: id, side: 'right' },
];
export const HIP_DEFAULT_PLAN: Plan = [...both('hip_flexion_standing'), ...both('hip_abduction_standing')];
export const ANKLE_DEFAULT_PLAN: Plan = [...both('ankle_knee_to_wall'), { protocolId: 'heel_raise_double', side: null }];
export const SPINE_DEFAULT_PLAN: Plan = [{ protocolId: 'trunk_forward_bend', side: null }, ...both('trunk_side_bend'), { protocolId: 'neck_flexion_extension', side: null }];
export const BALANCE_DEFAULT_PLAN: Plan = [...both('single_leg_stance'), { protocolId: 'march_in_place', side: null }];
