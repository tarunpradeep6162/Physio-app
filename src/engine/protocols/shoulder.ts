import { idx } from '../landmarks';
import { estimate, inFrame } from '../measurements';
import type { ProcessedFrame } from '../pipeline';
import type { Side } from '../types';
import { extraNearPeak, median, metric } from './common';
import type { MetricSpec, ProtocolDef, SignalFn } from './types';

/**
 * Shoulder pathway — two camera tests (v1.0.0, algorithm dl-shoulder-1.0.0). Protocol text,
 * thresholds and quality gates are a DRAFT for clinical-lead review (approval on hold).
 *
 * Scope is deliberately narrow: active arm elevation in one plane at a time, one side at a time,
 * compared with the patient's own other side and baseline. A single RGB camera cannot measure
 * shoulder rotation, hand-behind-back, scapular motion, strength or the cause of pain, so none of
 * these are estimated. No population norms are shown and no threshold observation is generated.
 */

export const SHOULDER_ALGORITHM_VERSION = 'dl-shoulder-1.0.0';

const MIN_VIS = 0.6;

function armSignal(type: 'shoulder_flexion' | 'shoulder_abduction', side: Side, extrasFn: (f: ProcessedFrame) => Record<string, number | null>): SignalFn {
  return (f) => {
    if (f.status !== 'tracking') return { value: null, confidence: 0, reason: f.status };
    if (f.orientation === 'unknown') return { value: null, confidence: 0, reason: 'orientation_uncertain' };
    const e = estimate(type, f.smoothed, f.width, f.height, side, { view: f.orientation, support: f.support });
    return { value: e.value, confidence: e.confidence, reason: e.reason, missing: e.missing, extras: e.value === null ? undefined : extrasFn(f) };
  };
}

/** Absolute hip→shoulder angle from image vertical on the tested side (lateral view). */
function sagittalTrunkLean(side: Side) {
  return (f: ProcessedFrame) => {
    const e = estimate('trunk_sagittal_lean', f.smoothed, f.width, f.height, side, { view: f.orientation, support: f.support });
    return { trunk_lean: e.value };
  };
}

/**
 * Signed trunk lateral lean from the mid-hip→mid-shoulder line (front view). Positive = the trunk
 * leans AWAY from the moving arm, the usual way a lateral lean inflates apparent abduction.
 * Null when any of the four points is not confidently in frame.
 */
function lateralTrunkLean(side: Side) {
  return (f: ProcessedFrame) => {
    const lms = f.smoothed;
    if (!lms) return { trunk_lateral_lean: null };
    const pts = [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('hip', 'left'), idx('hip', 'right')].map((i) => lms[i]);
    if (pts.some((p) => !p || p.visibility < MIN_VIS || !inFrame(p))) return { trunk_lateral_lean: null };
    const [ls, rs, lh, rh] = pts;
    const sx = ((ls.x + rs.x) / 2) * f.width;
    const sy = ((ls.y + rs.y) / 2) * f.height;
    const hx = ((lh.x + rh.x) / 2) * f.width;
    const hy = ((lh.y + rh.y) / 2) * f.height;
    if (hy - sy < 1) return { trunk_lateral_lean: null };
    // Facing the camera (un-mirrored), the patient's left is image-right: +x = toward patient's left.
    const towardLeft = (Math.atan2(sx - hx, hy - sy) * 180) / Math.PI;
    return { trunk_lateral_lean: side === 'left' ? -towardLeft : towardLeft };
  };
}

const sameSideLateral = (side: Side | null) => (side === 'right' ? ['lateral_right' as const] : ['lateral_left' as const]);
const arm = (s: Side | null) => [idx('hip', s ?? 'left'), idx('shoulder', s ?? 'left'), idx('elbow', s ?? 'left')];
const LIGHTING = 'Light falling on you from the front or side — not a bright window behind you.';
const CLOTHING = 'A fitted top or vest so the shoulder and elbow outline is visible; sleeves not covering the elbow.';
const LIMITS_COMMON = [
  'Rotation (internal/external), hand-behind-back and horizontal movements cannot be measured with one camera.',
  'Scapular (shoulder-blade) movement is not separated from arm movement.',
  'Active range only. Pain, a painful arc, apprehension and strength are not measured: record them from the patient and the clinical examination.',
  'Not interchangeable with goniometry or inclinometry until validated against them.',
];

// ---------------------------------------------------------------------------------------------
// 1. Active shoulder flexion (side view)
// ---------------------------------------------------------------------------------------------
const FLEX_PEAK: MetricSpec = {
  id: 'shoulder_flexion_peak',
  label: 'Shoulder flexion (peak arm elevation, forward)',
  unit: 'deg',
  method: 'Max over valid repetitions of ∠(hip, shoulder, elbow) on the tested side: upper arm relative to the trunk line, 2D side view. Stored signal zero-phase smoothed.',
  interpretation: '0° = arm by the side. Values are capped at 180° by the method.',
};
const FLEX_LEAN: MetricSpec = {
  id: 'shoulder_flexion_trunk_lean',
  label: 'Trunk angle at peak (compensation check)',
  unit: 'deg',
  method: 'Median across valid repetitions of the hip→shoulder angle from image vertical within ±250 ms of each peak.',
  interpretation: 'Descriptive only. A larger angle means more trunk movement accompanied the arm; compare with the same person’s other side and baseline.',
};

export const SHOULDER_FLEXION_ACTIVE: ProtocolDef = {
  id: 'shoulder_flexion_active',
  version: '1.0.0',
  algorithmVersion: SHOULDER_ALGORITHM_VERSION,
  region: 'shoulder',
  title: 'Active shoulder flexion (side view)',
  shortTitle: 'Shoulder flexion',
  purpose: 'Camera-estimated active forward arm elevation, one side at a time, with a trunk compensation check.',
  position: 'standing',
  sided: true,
  views: sameSideLateral,
  requiredLandmarks: arm,
  setup: [
    'Stand side-on to the camera with the tested arm nearest it, feet hip-width apart.',
    'Start with the arm relaxed by your side, thumb pointing forward.',
    'Raise the arm forward and up as far as is comfortable, keeping the elbow straight, then lower it. Repeat 3 times. Stop if it hurts more than usual.',
  ],
  cueStart: 'Raise your arm forward and up, then lower it slowly',
  targetCycles: 3,
  maxDurationSec: 60,
  cycle: { direction: 'up', rest: 30, engaged: 60, minCycleMs: 1200, pauseResetMs: 2000, readyMs: 500, maxGapInCycleMs: 250, minSamples: 8 },
  signalLabel: 'Shoulder flexion',
  signalUnit: 'deg',
  createSignal: (side) => armSignal('shoulder_flexion', side ?? 'left', sagittalTrunkLean(side ?? 'left')),
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const valid = rec.detector.cycles.filter((c) => c.valid);
    const peaks = valid.map((c) => c.peak);
    const lean = valid.map((c) => extraNearPeak(rec, c, 'trunk_lean')).filter((v): v is number => v !== null);
    return [metric(FLEX_PEAK, peaks.length ? Math.max(...peaks) : null, peaks), metric(FLEX_LEAN, median(lean), lean)];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    '2D side-view projection: accurate only when the arm moves straight forward, parallel to a level camera. Drifting out to the side changes the estimate.',
    'The angle is the upper arm relative to the trunk line. Leaning back is recorded as a separate trunk angle, not removed from the arm value.',
    ...LIMITS_COMMON,
  ],
  references: [],
  framing: { axis: 'vertical', extentLandmarks: (s) => [idx('shoulder', s ?? 'left'), idx('hip', s ?? 'left')], range: [0.16, 0.36], orientation: 'portrait', maxRollDeg: 4, minConfidence: 0.65 },
  guide: {
    camera: 'Phone upright (portrait) at chest height, level, about 2.5–3 m to your side.',
    distance: 'Your shoulders to hips fill about a quarter of the screen height, leaving room above your head for the raised arm.',
    view: 'Stand side-on, the tested arm nearest the camera.',
    region: 'Hip, shoulder, elbow and hand of the tested arm stay visible, including with the arm overhead.',
    lighting: LIGHTING,
    clothing: CLOTHING,
    example: (s) => ({ kind: 'standing_lateral', side: s ?? 'left', shoulderFlexion: 0, scale: 0.75 }),
  },
};

// ---------------------------------------------------------------------------------------------
// 2. Active shoulder abduction (front view)
// ---------------------------------------------------------------------------------------------
const ABD_PEAK: MetricSpec = {
  id: 'shoulder_abduction_peak',
  label: 'Shoulder abduction (peak arm elevation, sideways)',
  unit: 'deg',
  method: 'Max over valid repetitions of the shoulder→elbow angle from image vertical in the front view. Includes any trunk side-lean (recorded separately). Stored signal zero-phase smoothed.',
  interpretation: '0° = arm by the side. Arm angle in the image, not glenohumeral abduction.',
};
const ABD_LEAN: MetricSpec = {
  id: 'shoulder_abduction_trunk_lean',
  label: 'Trunk side-lean at peak (compensation check)',
  unit: 'deg',
  method: 'Median across valid repetitions of the mid-hip→mid-shoulder angle from image vertical within ±250 ms of each peak; + = leaning away from the moving arm.',
  interpretation: 'Descriptive only. A positive value adds to the apparent arm angle.',
};

export const SHOULDER_ABDUCTION_ACTIVE: ProtocolDef = {
  id: 'shoulder_abduction_active',
  version: '1.0.0',
  algorithmVersion: SHOULDER_ALGORITHM_VERSION,
  region: 'shoulder',
  title: 'Active shoulder abduction (front view)',
  shortTitle: 'Shoulder abduction',
  purpose: 'Camera-estimated active sideways arm elevation, one side at a time, with a trunk side-lean check.',
  position: 'standing',
  sided: true,
  views: () => ['anterior'],
  requiredLandmarks: arm,
  setup: [
    'Face the camera, feet hip-width apart, arms relaxed by your sides.',
    'Turn the palm of the tested arm forward.',
    'Raise that arm out to the side and up as far as is comfortable, elbow straight, then lower it. Keep your body upright. Repeat 3 times. Stop if it hurts more than usual.',
  ],
  cueStart: 'Raise your arm out to the side, then lower it slowly',
  targetCycles: 3,
  maxDurationSec: 60,
  cycle: { direction: 'up', rest: 30, engaged: 60, minCycleMs: 1200, pauseResetMs: 2000, readyMs: 500, maxGapInCycleMs: 250, minSamples: 8 },
  signalLabel: 'Shoulder abduction',
  signalUnit: 'deg',
  createSignal: (side) => armSignal('shoulder_abduction', side ?? 'left', lateralTrunkLean(side ?? 'left')),
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const valid = rec.detector.cycles.filter((c) => c.valid);
    const peaks = valid.map((c) => c.peak);
    const lean = valid.map((c) => extraNearPeak(rec, c, 'trunk_lateral_lean')).filter((v): v is number => v !== null);
    return [metric(ABD_PEAK, peaks.length ? Math.max(...peaks) : null, peaks), metric(ABD_LEAN, median(lean), lean)];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    'Measured from the image vertical, so a tilted camera or a trunk side-lean changes the value. The side-lean is recorded separately; keep the phone level.',
    'An arm that drifts forward (toward flexion) is foreshortened in the front view and under-reads.',
    'Shoulder shrugging (elevation) is not separated from arm movement.',
    ...LIMITS_COMMON,
  ],
  references: [],
  framing: {
    axis: 'vertical',
    extentLandmarks: () => [idx('shoulder', 'left'), idx('shoulder', 'right'), idx('hip', 'left'), idx('hip', 'right')],
    range: [0.16, 0.36],
    orientation: 'portrait',
    maxRollDeg: 3,
    minConfidence: 0.65,
  },
  guide: {
    camera: 'Phone upright (portrait) at chest height, level, about 2.5–3 m in front of you.',
    distance: 'Your shoulders to hips fill about a quarter of the screen height, so the raised arm stays in view.',
    view: 'Face the camera squarely; do not turn toward the moving arm.',
    region: 'Both shoulders and hips, and the tested elbow, stay visible throughout.',
    lighting: LIGHTING,
    clothing: CLOTHING,
    example: (s) => ({ kind: 'standing_anterior', armSide: s ?? 'left', shoulderAbduction: 0, scale: 0.75 }),
  },
};

export const SHOULDER_PROTOCOLS: ProtocolDef[] = [SHOULDER_FLEXION_ACTIVE, SHOULDER_ABDUCTION_ACTIVE];

export const SHOULDER_DEFAULT_PLAN: { protocolId: string; side: Side | null }[] = [
  { protocolId: 'shoulder_flexion_active', side: 'left' },
  { protocolId: 'shoulder_flexion_active', side: 'right' },
  { protocolId: 'shoulder_abduction_active', side: 'left' },
  { protocolId: 'shoulder_abduction_active', side: 'right' },
];
