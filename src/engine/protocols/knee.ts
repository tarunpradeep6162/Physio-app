import { idx, LM } from '../landmarks';
import { checkRequired, estimate } from '../measurements';
import type { ProcessedFrame } from '../pipeline';
import type { Side } from '../types';
import { jointAngle, toPixels } from '../vector';
import type { Cycle } from './cycles';
import type { MetricSpec, ProtocolDef, ProtocolMetric, Recording, SignalFn } from './types';

/**
 * Knee pathway — three camera tests (v1.0.0). Protocol text, thresholds and quality gates are a
 * DRAFT for clinical-lead review. No population norms are shown: comparisons are to the
 * patient's own baseline (and descriptive left/right differences).
 */

/**
 * pv-knee-1.1.0: plausibility guard + recovery window, per-landmark validation with body support,
 * no coordinate smoothing, and stored signals/metrics from zero-phase smoothing (no filter lag).
 * pv-knee-1.0.0 results are kept as recorded.
 */
export const KNEE_ALGORITHM_VERSION = 'pv-knee-1.1.0';

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function metric(spec: MetricSpec, value: number | null, perCycle: number[], reason?: string): ProtocolMetric {
  return { ...spec, value: r1(value), perCycle: perCycle.map((v) => Math.round(v * 10) / 10), validity: value === null || reason ? 'invalid' : 'valid', reason };
}

const lateral = (side: Side | null) => (side === 'right' ? ['lateral_right' as const] : ['lateral_left' as const]);

function kneeFlexionSignal(side: Side, extrasFn?: (f: ProcessedFrame) => Record<string, number | null>): SignalFn {
  return (f) => {
    if (f.status !== 'tracking') return { value: null, confidence: 0, reason: f.status };
    if (f.orientation === 'unknown') return { value: null, confidence: 0, reason: 'orientation_uncertain' };
    const e = estimate('knee_flexion', f.smoothed, f.width, f.height, side, { view: f.orientation, support: f.support });
    return { value: e.value, confidence: e.confidence, reason: e.reason, missing: e.missing, extras: e.value === null ? undefined : extrasFn?.(f) };
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Supported knee flexion (supine heel slide)
// ---------------------------------------------------------------------------------------------
const FLEX_PEAK: MetricSpec = {
  id: 'knee_flexion_peak',
  label: 'Knee flexion (peak)',
  unit: 'deg',
  method: 'Max over valid cycles of 180° − ∠(hip, knee, ankle), 2D lateral view, One Euro filtered.',
};
const FLEX_EXT: MetricSpec = {
  id: 'knee_extension_position',
  label: 'Knee extension (most-extended position)',
  unit: 'deg',
  method: '5th percentile of the filtered knee-flexion signal over the capture.',
  interpretation: '0° = straight. Higher = knee did not fully straighten. Hyperextension cannot be measured by this 2D method.',
};

/** v1.0.0 — kept so records made with it can be shown and recalculated as originally defined. */
export const KNEE_SUPPORTED_FLEXION_V1_0: ProtocolDef = {
  id: 'knee_supported_flexion',
  version: '1.0.0',
  region: 'knee',
  title: 'Supported knee flexion (supine heel slide)',
  shortTitle: 'Knee flexion',
  purpose: 'Camera-estimated active knee flexion range and most-extended position, one side at a time.',
  position: 'supine',
  sided: true,
  views: lateral,
  requiredLandmarks: (s) => [idx('hip', s ?? 'left'), idx('knee', s ?? 'left'), idx('ankle', s ?? 'left')],
  setup: [
    'Lie on your back on a firm surface, legs straight.',
    'Place the camera low, level with your body, with the tested leg nearest the camera.',
    'Slide your heel toward your buttock as far as comfortable, then slide it back until the knee is straight. Repeat 3 times.',
  ],
  cueStart: 'Slide your heel up, then straighten fully',
  targetCycles: 3,
  maxDurationSec: 75,
  cycle: { direction: 'up', rest: 25, engaged: 45, minCycleMs: 1500, pauseResetMs: 2000, readyMs: 500 },
  signalLabel: 'Knee flexion',
  signalUnit: 'deg',
  createSignal: (side) => kneeFlexionSignal(side ?? 'left'),
  isComplete: (d) => d.validCount >= 3,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const valid = rec.detector.cycles.filter((c) => c.valid);
    const peaks = valid.map((c) => c.peak);
    const vals = rec.samples.map((s) => s.value).filter((v): v is number => v !== null);
    const ext = percentile(vals, 0.05);
    return [metric(FLEX_PEAK, peaks.length ? Math.max(...peaks) : null, peaks), metric(FLEX_EXT, ext === null ? null : Math.max(0, ext), [])];
  },
  quality: { minCoverage: 0.75, minMeanConfidence: 0.7, minValidCycles: 2 },
  limitations: [
    '2D projection of a 3D movement: accurate only when the tested leg is side-on to a level camera.',
    'Soft tissue, clothing and landmark placement error affect the estimate; not interchangeable with goniometry until validated.',
    'Hyperextension (knee beyond straight) is not measurable.',
    'Active range only; passive range and end-feel require clinical examination.',
  ],
  references: [],
};

// ---------------------------------------------------------------------------------------------
// 2. Five-times sit-to-stand (lateral view)
// ---------------------------------------------------------------------------------------------
const STS_TIME: MetricSpec = { id: 'sts_time_5', label: 'Time for 5 stands', unit: 's', method: 'From the first rise onset (knee flexion leaves the seated plateau by > 5°) to reaching full standing on the 5th stand (knee flexion ≤ 25°).' };
const STS_RISE: MetricSpec = { id: 'sts_rise_time', label: 'Mean rise time', unit: 's', method: 'Mean time from rise onset (leaving the seated plateau by > 5°) to full standing (≤ 25°) across valid stands.' };
const STS_LEAN: MetricSpec = {
  id: 'sts_trunk_lean_peak',
  label: 'Peak trunk forward lean during rise',
  unit: 'deg',
  method: 'Median across valid stands of the max hip→shoulder angle from vertical between rise onset and standing.',
};
const STS_SEAT: MetricSpec = { id: 'sts_seated_knee_flexion', label: 'Seated knee flexion', unit: 'deg', method: 'Median knee flexion in the second before each rise.' };

/** v1.0.0 — kept for existing records. */
export const KNEE_SIT_TO_STAND_V1_0: ProtocolDef = {
  id: 'knee_sit_to_stand',
  version: '1.0.0',
  region: 'knee',
  title: 'Five-times sit-to-stand',
  shortTitle: 'Sit-to-stand ×5',
  purpose: 'Timed functional test of standing up from a chair, with camera-estimated movement features.',
  position: 'seated_to_standing',
  sided: true,
  views: lateral,
  requiredLandmarks: (s) => {
    const side = s ?? 'left';
    return [idx('shoulder', side), idx('hip', side), idx('knee', side), idx('ankle', side)];
  },
  setup: [
    'Use a firm chair without wheels, back against a wall. Note its seat height for reassessment.',
    'Sit side-on to the camera; the chosen side faces the camera. Cross your arms over your chest.',
    'When prompted, stand up fully and sit down fully 5 times as quickly as you safely can. Do not use your arms.',
  ],
  cueStart: 'Stand up fully, sit down fully — 5 times',
  targetCycles: 5,
  maxDurationSec: 60,
  cycle: { direction: 'down', rest: 65, engaged: 25, minCycleMs: 600, pauseResetMs: 1500, readyMs: 600 },
  signalLabel: 'Knee flexion',
  signalUnit: 'deg',
  createSignal: (side) =>
    kneeFlexionSignal(side ?? 'left', (f) => ({ trunk_lean: estimate('trunk_sagittal_lean', f.smoothed, f.width, f.height, side ?? 'left', { ignoreView: true, support: f.support }).value })),
  isComplete: (d) => d.validCount + (d.current?.engagedT != null ? 1 : 0) >= 5,
  closeAcceptsEngaged: true,
  analyze: (rec) => {
    const all = rec.detector.cycles;
    const valid = all.filter((c) => c.valid);
    const invalidBefore5 = all.slice(0, all.indexOf(valid[4] ?? all[all.length - 1]) + 1).filter((c) => !c.valid).length;
    const onset = (c: Cycle) => riseOnset(rec, c);
    const rise = valid.filter((c) => c.engagedT !== null).map((c) => (c.engagedT! - onset(c)) / 1000);
    const leans = valid.map((c) => maxExtra(rec, 'trunk_lean', c.startT, c.engagedT ?? c.peakT)).filter((v): v is number => v !== null);
    const seated = valid.map((c) => maxValue(rec, c.startT - 1000, c.startT)).filter((v): v is number => v !== null);
    let time: number | null = null;
    let reason: string | undefined;
    if (valid.length >= 5 && valid[4].engagedT !== null) {
      time = (valid[4].engagedT - onset(valid[0])) / 1000;
      if (invalidBefore5 > 0) reason = `${invalidBefore5} incomplete stand(s) during the test — protocol deviation`;
    } else reason = 'Fewer than 5 complete stands';
    return [metric(STS_TIME, time, [], reason), metric(STS_RISE, mean(rise), rise), metric(STS_LEAN, median(leans), leans), metric(STS_SEAT, median(seated), seated)];
  },
  quality: { minCoverage: 0.8, minMeanConfidence: 0.7, minValidCycles: 5 },
  limitations: [
    'Chair height, footwear and arm use change the result; record them and keep them the same at reassessment.',
    'Use of the arms is not detected automatically — the patient must keep them crossed.',
    'Timing resolution is one camera frame (≈33–100 ms depending on device).',
    'No population reference values are shown; compare with the patient’s own baseline.',
  ],
  references: [
    'Csuka M, McCarty DJ. Simple method for measurement of lower extremity muscle strength. Am J Med. 1985;78(1):77-81.',
    'Bohannon RW. Reference values for the five-repetition sit-to-stand test: a descriptive meta-analysis of data from elders. Percept Mot Skills. 2006;103(1):215-222.',
  ],
};

/**
 * Rise onset: the cycle detector starts a cycle only when flexion crosses the rest boundary, which
 * is part-way through the rise. Onset is taken as the last moment the knee was still within 5° of
 * the seated plateau (median flexion in the preceding second).
 */
function riseOnset(rec: Recording, c: Cycle): number {
  const before = rec.samples.filter((s) => s.t >= c.startT - 1000 && s.t <= c.startT && s.value !== null);
  const seated = median(before.map((s) => s.value as number));
  if (seated === null) return c.startT;
  for (let i = before.length - 1; i >= 0; i--) if ((before[i].value as number) >= seated - 5) return before[i].t;
  return c.startT;
}

function maxExtra(rec: Recording, key: string, t0: number, t1: number): number | null {
  const vs = rec.samples.filter((s) => s.t >= t0 && s.t <= t1).map((s) => s.extras?.[key]).filter((v): v is number => typeof v === 'number');
  return vs.length ? Math.max(...vs) : null;
}
function maxValue(rec: Recording, t0: number, t1: number): number | null {
  const vs = rec.samples.filter((s) => s.t >= t0 && s.t <= t1).map((s) => s.value).filter((v): v is number => v !== null);
  return vs.length ? median(vs) : null;
}

// ---------------------------------------------------------------------------------------------
// 3. Double-leg squat (anterior view)
// ---------------------------------------------------------------------------------------------
const SQ_DEPTH: MetricSpec = {
  id: 'squat_depth',
  label: 'Squat depth (hip descent)',
  unit: 'pct_leg',
  method: 'Median across valid squats of the peak mid-hip descent below standing, as % of standing hip-to-ankle length (image plane).',
  interpretation: 'Not a knee angle: depth proxy only.',
};
const fppaSpec = (side: Side): MetricSpec => ({
  id: `squat_fppa_${side}`,
  label: `Knee frontal-plane projection angle — ${side}`,
  unit: 'deg',
  side,
  method: 'Median across valid squats of 180° − ∠(hip, knee, ankle) in the frontal image plane, within ±250 ms of peak depth.',
  interpretation: '+ = knee toward the midline (medial), − = away (lateral). 2D proxy for dynamic knee alignment, not a joint angle.',
});

export function signedFppa(f: ProcessedFrame, side: Side): number | null {
  const lms = f.smoothed;
  if (!lms) return null;
  const p = (i: number) => toPixels(lms[i], f.width, f.height);
  const hip = p(idx('hip', side));
  const knee = p(idx('knee', side));
  const ankle = p(idx('ankle', side));
  const a = jointAngle(hip, knee, ankle);
  if (a === null || Math.abs(ankle.y - hip.y) < 5) return null;
  const lineX = hip.x + ((ankle.x - hip.x) * (knee.y - hip.y)) / (ankle.y - hip.y);
  const mid = (p(LM.leftHip).x + p(LM.rightHip).x) / 2;
  const medial = Math.abs(knee.x - mid) < Math.abs(lineX - mid);
  const fppa = 180 - a;
  return medial ? fppa : -fppa;
}

const SQUAT_LMS = [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

function squatSignal(): SignalFn {
  let standHipY: number | null = null;
  let legLen: number | null = null;
  return (f) => {
    if (f.status !== 'tracking') return { value: null, confidence: 0, reason: f.status };
    if (f.orientation !== 'anterior') return { value: null, confidence: 0, reason: f.orientation === 'unknown' ? 'orientation_uncertain' : 'wrong_orientation' };
    const lms = f.smoothed!;
    // Each required landmark on its own: in frame, on the body (segmentation) and visible.
    const chk = checkRequired(lms, SQUAT_LMS, 0.6, f.support);
    const conf = chk.confidence;
    if (chk.issue) return { value: null, confidence: chk.issue === 'out_of_frame' ? 0 : conf, reason: chk.issue, missing: chk.missing };
    const p = (i: number) => toPixels(lms[i], f.width, f.height);
    const hipY = (p(LM.leftHip).y + p(LM.rightHip).y) / 2;
    const len = (Math.hypot(p(LM.leftHip).x - p(LM.leftAnkle).x, p(LM.leftHip).y - p(LM.leftAnkle).y) + Math.hypot(p(LM.rightHip).x - p(LM.rightAnkle).x, p(LM.rightHip).y - p(LM.rightAnkle).y)) / 2;
    // Standing reference = highest hip position seen (leg length captured at that moment).
    if (standHipY === null || hipY < standHipY) {
      standHipY = hipY;
      legLen = len;
    }
    const depth = ((hipY - standHipY) / Math.max(1, legLen!)) * 100;
    return { value: depth, confidence: conf, extras: { fppa_left: signedFppa(f, 'left'), fppa_right: signedFppa(f, 'right') } };
  };
}

function extraNearPeak(rec: Recording, c: Cycle, key: string): number | null {
  const vs = rec.samples.filter((s) => Math.abs(s.t - c.peakT) <= 250).map((s) => s.extras?.[key]).filter((v): v is number => typeof v === 'number');
  return median(vs);
}

/** v1.0.0 — kept for existing records. */
export const KNEE_SQUAT_V1_0: ProtocolDef = {
  id: 'knee_squat',
  version: '1.0.0',
  region: 'knee',
  title: 'Double-leg squat (front view)',
  shortTitle: 'Squat',
  purpose: 'Camera-estimated squat depth and left/right frontal-plane knee alignment (FPPA) during a bodyweight squat.',
  position: 'standing',
  sided: false,
  views: () => ['anterior'],
  requiredLandmarks: () => SQUAT_LMS,
  setup: [
    'Stand facing the camera, feet hip-width apart, toes forward. Camera at knee height, level.',
    'Wear shorts or fitted clothing so knees are visible.',
    'Squat down as far as comfortable and stand back up, 5 times, at a steady pace. Arms forward for balance.',
  ],
  cueStart: 'Squat down and stand up — 5 times',
  targetCycles: 5,
  maxDurationSec: 60,
  cycle: { direction: 'up', rest: 5, engaged: 15, minCycleMs: 1000, pauseResetMs: 1500, readyMs: 500 },
  signalLabel: 'Hip descent',
  signalUnit: 'pct_leg',
  createSignal: () => squatSignal(),
  isComplete: (d) => d.validCount >= 5,
  closeAcceptsEngaged: false,
  analyze: (rec) => {
    const valid = rec.detector.cycles.filter((c) => c.valid);
    const depths = valid.map((c) => c.peak);
    const fl = valid.map((c) => extraNearPeak(rec, c, 'fppa_left')).filter((v): v is number => v !== null);
    const fr = valid.map((c) => extraNearPeak(rec, c, 'fppa_right')).filter((v): v is number => v !== null);
    return [metric(SQ_DEPTH, median(depths), depths), metric(fppaSpec('left'), median(fl), fl), metric(fppaSpec('right'), median(fr), fr)];
  },
  quality: { minCoverage: 0.8, minMeanConfidence: 0.7, minValidCycles: 3 },
  limitations: [
    'FPPA is a 2D projection: camera height, hip rotation and foot position change it. Keep setup identical at reassessment.',
    'Depth is hip descent in the image, not knee flexion.',
    'A left/right difference is descriptive only and is not, by itself, evidence of pathology.',
    'Validated 2D FPPA work mostly uses single-leg tasks; this double-leg adaptation is unvalidated.',
  ],
  references: ['Munro A, Herrington L, Carolan M. Reliability of 2-dimensional video assessment of frontal-plane dynamic knee valgus during common athletic screening tasks. J Sport Rehabil. 2012;21(1):7-11.'],
};

// ---------------------------------------------------------------------------------------------
// v1.1.0 — same calculation as 1.0.0; adds per-test framing (distance judged on the body region
// the test needs, not standing full-body rules), recommended phone orientation and an
// illustrated setup guide. Captures made under 1.0.0 keep 1.0.0.
// ---------------------------------------------------------------------------------------------
const V1_1_CHANGES = [
  'Distance is judged on the body region this test needs, not on whole-body standing rules',
  'Recommended phone orientation and camera placement are shown with an illustrated example',
  'A repetition with a tracking gap over 250 ms is not counted (interrupted), and needs a minimum number of valid frames',
  'Each required landmark must be in frame, visible and on the body (segmentation, where enabled); a bystander, identity change or leg-label swap pauses measurement until tracking is stable again',
  'Stored values use zero-phase smoothing (no filter lag); physically impossible jumps are rejected (algorithm pv-knee-1.1.0)',
];
const LIGHTING = 'Light falling on you from the front or side — not a bright window behind you.';
const CLOTHING = 'Shorts or fitted clothing so the knee outline is visible; nothing covering the joints.';
const leg = (s: Side | null) => {
  const side = s ?? 'left';
  return [idx('hip', side), idx('knee', side), idx('ankle', side), idx('heel', side), idx('foot', side)];
};

export const KNEE_SUPPORTED_FLEXION: ProtocolDef = {
  ...KNEE_SUPPORTED_FLEXION_V1_0,
  version: '1.1.0',
  cycle: { ...KNEE_SUPPORTED_FLEXION_V1_0.cycle, maxGapInCycleMs: 250, minSamples: 10 },
  framing: { axis: 'horizontal', extentLandmarks: leg, range: [0.3, 0.9], orientation: 'landscape', maxRollDeg: 4, minConfidence: 0.65 },
  guide: {
    camera: 'Phone turned sideways (landscape) on the floor or a low step, level, about 2–3 m from your side.',
    distance: 'Your tested leg, hip to foot, fills about a third to most of the screen width.',
    view: 'Lie on your back with the tested leg nearest the camera.',
    region: 'Hip, knee, ankle and foot of the tested leg must stay visible the whole time.',
    lighting: LIGHTING,
    clothing: CLOTHING,
    example: (s) => ({ kind: 'supine_heel_slide', side: s ?? 'left', kneeFlexion: 3 }),
  },
  changes: V1_1_CHANGES,
};

export const KNEE_SIT_TO_STAND: ProtocolDef = {
  ...KNEE_SIT_TO_STAND_V1_0,
  version: '1.1.0',
  cycle: { ...KNEE_SIT_TO_STAND_V1_0.cycle, maxGapInCycleMs: 250, minSamples: 6 },
  framing: {
    axis: 'vertical',
    extentLandmarks: (s) => {
      const side = s ?? 'left';
      return [idx('shoulder', side), idx('hip', side), idx('knee', side), idx('ankle', side), idx('foot', side)];
    },
    // Seated shoulder→foot extent; leaves headroom for standing up.
    range: [0.3, 0.62],
    orientation: 'portrait',
    maxRollDeg: 4,
    minConfidence: 0.65,
  },
  guide: {
    camera: 'Phone upright (portrait) at about hip height, level, 2–3 m to your side.',
    distance: 'Seated, your shoulders to feet fill about half of the screen height, so you still fit when you stand.',
    view: 'Sit side-on, the chosen side nearest the camera, arms crossed on your chest.',
    region: 'Shoulder, hip, knee, ankle and foot on that side stay visible, seated and standing.',
    lighting: LIGHTING,
    clothing: CLOTHING,
    example: (s) => ({ kind: 'sit_to_stand_lateral', side: s ?? 'left', kneeFlexion: 92, trunkLean: 8 }),
  },
  changes: V1_1_CHANGES,
};

export const KNEE_SQUAT: ProtocolDef = {
  ...KNEE_SQUAT_V1_0,
  version: '1.1.0',
  cycle: { ...KNEE_SQUAT_V1_0.cycle, maxGapInCycleMs: 250, minSamples: 8 },
  framing: {
    axis: 'vertical',
    extentLandmarks: () => [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle, LM.leftFootIndex, LM.rightFootIndex],
    range: [0.3, 0.7],
    orientation: 'portrait',
    maxRollDeg: 4,
    minConfidence: 0.65,
  },
  guide: {
    camera: 'Phone upright (portrait) at knee height, level, 2–3 m in front of you.',
    distance: 'Standing, your hips to feet fill about half of the screen height; both feet in view.',
    view: 'Face the camera, feet hip-width apart, toes forward.',
    region: 'Both hips, knees, ankles and feet stay visible, including at the bottom of the squat.',
    lighting: LIGHTING,
    clothing: CLOTHING,
    example: () => ({ kind: 'squat_anterior', depth: 0 }),
  },
  changes: V1_1_CHANGES,
};

export const PROTOCOLS: Record<string, ProtocolDef> = {
  [KNEE_SUPPORTED_FLEXION.id]: KNEE_SUPPORTED_FLEXION,
  [KNEE_SIT_TO_STAND.id]: KNEE_SIT_TO_STAND,
  [KNEE_SQUAT.id]: KNEE_SQUAT,
};

const HISTORY: Record<string, ProtocolDef> = Object.fromEntries(
  [KNEE_SUPPORTED_FLEXION_V1_0, KNEE_SIT_TO_STAND_V1_0, KNEE_SQUAT_V1_0, ...Object.values(PROTOCOLS)].map((p) => [`${p.id}@${p.version}`, p]),
);

/** Every version ever released, for provenance display. */
export const PROTOCOL_VERSIONS = Object.keys(HISTORY);

export function getProtocol(id: string, version?: string): ProtocolDef {
  return (version && HISTORY[`${id}@${version}`]) || PROTOCOLS[id];
}

export const KNEE_DEFAULT_PLAN: { protocolId: string; side: Side | null }[] = [
  { protocolId: 'knee_supported_flexion', side: 'left' },
  { protocolId: 'knee_supported_flexion', side: 'right' },
  { protocolId: 'knee_sit_to_stand', side: 'left' },
  { protocolId: 'knee_squat', side: null },
];

