import { checkRequired } from './measurements';
import { LM } from './landmarks';
import type { Landmark, ViewOrientation } from './types';
import { confidenceLevel, type ConfidenceLevel } from './types';
import { deviationFromVertical, jointAngle, midpoint, tiltFromHorizontal, toPixels, type Vec2 } from './vector';

/**
 * Static posture metrics. Each metric declares the views in which it is valid and the landmarks
 * it depends on. Names are deliberately literal about what BlazePose can support — e.g. the
 * ear–shoulder line angle is reported as a proxy, NOT as the craniovertebral angle (which needs
 * a C7 landmark the model does not provide).
 */

export type PostureMetricId =
  | 'shoulder_level'
  | 'pelvic_level'
  | 'head_tilt'
  | 'trunk_lateral_lean'
  | 'knee_frontal_left'
  | 'knee_frontal_right'
  | 'ear_shoulder_line'
  | 'trunk_sagittal'
  | 'knee_sagittal'
  | 'plumb_ear_offset'
  | 'plumb_shoulder_offset'
  | 'plumb_hip_offset'
  | 'plumb_knee_offset';

export interface PostureMetricSample {
  id: PostureMetricId;
  value: number;
  unit: 'deg' | 'pct_height';
  /** Direction qualifier, e.g. which shoulder is higher. i18n key suffix. */
  direction?: string;
  confidence: number;
}

interface MetricDef {
  id: PostureMetricId;
  views: ViewOrientation[];
  unit: 'deg' | 'pct_height';
  landmarks: (view: ViewOrientation) => number[];
  compute: (p: (i: number) => Vec2, view: ViewOrientation, lms: Landmark[]) => { value: number; direction?: string } | null;
}

const FRONTAL: ViewOrientation[] = ['anterior', 'posterior'];
const LATERAL: ViewOrientation[] = ['lateral_left', 'lateral_right'];

/** Side nearest the camera in a lateral view. */
function near(view: ViewOrientation): 'left' | 'right' {
  return view === 'lateral_right' ? 'right' : 'left';
}
const nearIdx = (view: ViewOrientation, l: number, r: number) => (near(view) === 'left' ? l : r);

function levelMetric(id: PostureMetricId, left: number, right: number): MetricDef {
  return {
    id,
    views: FRONTAL,
    unit: 'deg',
    landmarks: () => [left, right],
    compute: (p) => {
      const tilt = tiltFromHorizontal(p(right), p(left));
      if (tilt === null) return null;
      const lY = p(left).y;
      const rY = p(right).y;
      return { value: Math.abs(tilt), direction: Math.abs(tilt) < 0.5 ? 'level' : lY < rY ? 'left_higher' : 'right_higher' };
    },
  };
}

function plumbOffset(id: PostureMetricId, pick: (v: ViewOrientation) => number): MetricDef {
  return {
    id,
    views: LATERAL,
    unit: 'pct_height',
    landmarks: (v) => [pick(v), nearIdx(v, LM.leftAnkle, LM.rightAnkle), LM.nose,
      nearIdx(v, LM.leftFootIndex, LM.rightFootIndex), nearIdx(v, LM.leftHeel, LM.rightHeel)],
    compute: (p, v) => {
      const ankle = p(nearIdx(v, LM.leftAnkle, LM.rightAnkle));
      const pt = p(pick(v));
      const height = Math.abs(ankle.y - p(LM.nose).y);
      if (height < 20) return null;
      // Positive = anterior of the ankle plumb line; "forward" is the heel→toe direction.
      const toe = p(nearIdx(v, LM.leftFootIndex, LM.rightFootIndex));
      const heel = p(nearIdx(v, LM.leftHeel, LM.rightHeel));
      const forward = Math.sign(toe.x - heel.x) || 1;
      const off = ((pt.x - ankle.x) * forward) / height;
      return { value: off * 100, direction: off > 0.005 ? 'anterior' : off < -0.005 ? 'posterior' : 'aligned' };
    },
  };
}

export const POSTURE_METRICS: MetricDef[] = [
  levelMetric('shoulder_level', LM.leftShoulder, LM.rightShoulder),
  levelMetric('pelvic_level', LM.leftHip, LM.rightHip),
  levelMetric('head_tilt', LM.leftEar, LM.rightEar),
  {
    id: 'trunk_lateral_lean',
    views: FRONTAL,
    unit: 'deg',
    landmarks: () => [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
    compute: (p) => {
      const d = deviationFromVertical(midpoint(p(LM.leftHip), p(LM.rightHip)), midpoint(p(LM.leftShoulder), p(LM.rightShoulder)));
      if (d === null) return null;
      return { value: Math.abs(d), direction: Math.abs(d) < 0.5 ? 'neutral' : d > 0 ? 'image_right' : 'image_left' };
    },
  },
  ...(['left', 'right'] as const).map<MetricDef>((s) => ({
    id: s === 'left' ? 'knee_frontal_left' : 'knee_frontal_right',
    views: ['anterior'],
    unit: 'deg',
    landmarks: () => (s === 'left' ? [LM.leftHip, LM.leftKnee, LM.leftAnkle] : [LM.rightHip, LM.rightKnee, LM.rightAnkle]),
    compute: (p) => {
      const [h, k, a] = s === 'left' ? [LM.leftHip, LM.leftKnee, LM.leftAnkle] : [LM.rightHip, LM.rightKnee, LM.rightAnkle];
      const ang = jointAngle(p(h), p(k), p(a));
      if (ang === null) return null;
      // Which side of the hip→ankle line the knee sits on, relative to the body midline.
      const hip = p(h);
      const ank = p(a);
      const knee = p(k);
      const cross = (ank.x - hip.x) * (knee.y - hip.y) - (ank.y - hip.y) * (knee.x - hip.x);
      const mid = (p(LM.leftHip).x + p(LM.rightHip).x) / 2;
      const kneeTowardMidline = Math.abs(knee.x - mid) < Math.abs((hip.x + ank.x) / 2 - mid);
      const dev = 180 - ang;
      return { value: dev, direction: dev < 1 || Math.abs(cross) < 1 ? 'neutral' : kneeTowardMidline ? 'medial' : 'lateral' };
    },
  })),
  {
    id: 'ear_shoulder_line',
    views: LATERAL,
    unit: 'deg',
    landmarks: (v) => [nearIdx(v, LM.leftEar, LM.rightEar), nearIdx(v, LM.leftShoulder, LM.rightShoulder)],
    compute: (p, v) => {
      const d = deviationFromVertical(p(nearIdx(v, LM.leftShoulder, LM.rightShoulder)), p(nearIdx(v, LM.leftEar, LM.rightEar)));
      if (d === null) return null;
      return { value: Math.abs(d) };
    },
  },
  {
    id: 'trunk_sagittal',
    views: LATERAL,
    unit: 'deg',
    landmarks: (v) => [nearIdx(v, LM.leftShoulder, LM.rightShoulder), nearIdx(v, LM.leftHip, LM.rightHip)],
    compute: (p, v) => {
      const d = deviationFromVertical(p(nearIdx(v, LM.leftHip, LM.rightHip)), p(nearIdx(v, LM.leftShoulder, LM.rightShoulder)));
      return d === null ? null : { value: Math.abs(d) };
    },
  },
  {
    id: 'knee_sagittal',
    views: LATERAL,
    unit: 'deg',
    landmarks: (v) => [nearIdx(v, LM.leftHip, LM.rightHip), nearIdx(v, LM.leftKnee, LM.rightKnee), nearIdx(v, LM.leftAnkle, LM.rightAnkle)],
    compute: (p, v) => {
      const a = jointAngle(p(nearIdx(v, LM.leftHip, LM.rightHip)), p(nearIdx(v, LM.leftKnee, LM.rightKnee)), p(nearIdx(v, LM.leftAnkle, LM.rightAnkle)));
      return a === null ? null : { value: 180 - a };
    },
  },
  plumbOffset('plumb_ear_offset', (v) => nearIdx(v, LM.leftEar, LM.rightEar)),
  plumbOffset('plumb_shoulder_offset', (v) => nearIdx(v, LM.leftShoulder, LM.rightShoulder)),
  plumbOffset('plumb_hip_offset', (v) => nearIdx(v, LM.leftHip, LM.rightHip)),
  plumbOffset('plumb_knee_offset', (v) => nearIdx(v, LM.leftKnee, LM.rightKnee)),
];

/** Frontal metrics that depend on the torso outline (shoulders and/or hips). */
const TORSO_METRICS = new Set<PostureMetricId>(['shoulder_level', 'pelvic_level', 'trunk_lateral_lean']);

/**
 * Hands in front of the body: a wrist inside the torso outline (shoulders→hips, slightly expanded).
 * An object held there (a phone, a bag) can cover the torso and hips while the pose model still
 * reports them as visible — measured in the tracking lab: neither landmark visibility nor person
 * segmentation flags it. Torso-dependent frontal measures are withheld while this is true.
 */
export function handsInFront(lms: Landmark[], width: number, height: number): boolean {
  const p = (i: number) => toPixels(lms[i], width, height);
  const quad = [p(LM.leftShoulder), p(LM.rightShoulder), p(LM.rightHip), p(LM.leftHip)];
  const c = { x: quad.reduce((a, q) => a + q.x, 0) / 4, y: quad.reduce((a, q) => a + q.y, 0) / 4 };
  const grown = quad.map((q) => ({ x: c.x + (q.x - c.x) * 1.15, y: c.y + (q.y - c.y) * 1.15 }));
  // Ignore hand points level with / below the hips: relaxed hands hang beside the pelvis.
  const shY = (quad[0].y + quad[1].y) / 2;
  const hipY = (quad[2].y + quad[3].y) / 2;
  const lowest = shY + (hipY - shY) * 0.9;
  const inside = (pt: { x: number; y: number }) => {
    let s0 = 0;
    for (let i = 0; i < 4; i++) {
      const a = grown[i];
      const b = grown[(i + 1) % 4];
      const cr = (b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x);
      if (cr !== 0) {
        if (s0 === 0) s0 = Math.sign(cr);
        else if (Math.sign(cr) !== s0) return false;
      }
    }
    return true;
  };
  // Wrists AND hand points: a phone is gripped at its sides, so the fingers reach inward.
  const HAND = [LM.leftWrist, LM.rightWrist, LM.leftIndex, LM.rightIndex, LM.leftPinky, LM.rightPinky, LM.leftThumb, LM.rightThumb];
  return HAND.some((i) => lms[i].visibility >= 0.5 && p(i).y < lowest && inside(p(i)));
}

export function computePostureMetrics(lms: Landmark[], width: number, height: number, view: ViewOrientation, minConfidence = 0.6, support?: number[] | null): PostureMetricSample[] {
  const p = (i: number) => toPixels(lms[i], width, height);
  const out: PostureMetricSample[] = [];
  const handsBlock = (view === 'anterior' || view === 'posterior') && handsInFront(lms, width, height);
  for (const def of POSTURE_METRICS) {
    if (!def.views.includes(view)) continue;
    if (handsBlock && TORSO_METRICS.has(def.id)) continue; // something may be held in front of the torso
    // Every required landmark must be inside the frame, on the body (segmentation) and visible.
    const chk = checkRequired(lms, def.landmarks(view), minConfidence, support);
    if (chk.issue) continue; // never compute from occluded, off-frame or covered landmarks
    const conf = chk.confidence;
    const r = def.compute(p, view, lms);
    if (!r || !Number.isFinite(r.value)) continue;
    out.push({ id: def.id, value: r.value, unit: def.unit, direction: r.direction, confidence: conf });
  }
  return out;
}

export interface PostureMetricResult {
  id: PostureMetricId;
  unit: 'deg' | 'pct_height';
  /** Median over the capture window. */
  value: number;
  /** Standard deviation over the window — a direct measure of reading stability. */
  sd: number;
  samples: number;
  direction?: string;
  /** Combined confidence: landmark visibility × stability. */
  confidence: number;
  level: ConfidenceLevel;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Aggregates per-frame samples over a hold-still capture window. A metric is only reported if it
 * was computed on at least `minFraction` of frames; unstable readings get reduced confidence.
 */
export class PostureCapture {
  private samples = new Map<PostureMetricId, PostureMetricSample[]>();
  private frames = 0;

  add(samples: PostureMetricSample[]) {
    this.frames++;
    for (const s of samples) {
      const arr = this.samples.get(s.id) ?? [];
      arr.push(s);
      this.samples.set(s.id, arr);
    }
  }

  get frameCount() {
    return this.frames;
  }

  result(minFraction = 0.6): PostureMetricResult[] {
    const out: PostureMetricResult[] = [];
    for (const [id, arr] of this.samples) {
      if (arr.length < Math.max(5, this.frames * minFraction)) continue;
      const vals = arr.map((s) => s.value);
      const med = median(vals);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      const vis = arr.reduce((a, s) => a + s.confidence, 0) / arr.length;
      const tol = arr[0].unit === 'deg' ? 1.5 : 1.0;
      const stability = sd <= tol ? 1 : Math.max(0.3, tol / sd);
      const coverage = arr.length / this.frames;
      const confidence = vis * stability * Math.min(1, coverage / 0.9);
      const dirCounts = new Map<string, number>();
      for (const s of arr) if (s.direction) dirCounts.set(s.direction, (dirCounts.get(s.direction) ?? 0) + 1);
      const direction = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      out.push({ id, unit: arr[0].unit, value: med, sd, samples: arr.length, direction, confidence, level: confidenceLevel(confidence) });
    }
    return out;
  }
}
