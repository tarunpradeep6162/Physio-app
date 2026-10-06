import { LM } from './landmarks';
import type { Landmark } from './types';
import { deviationFromVertical, jointAngle, toPixels } from './vector';

/**
 * Desk posture check: a person SEATED, seen from the side. Only angles that the camera can measure
 * in 2D from visible landmarks are reported:
 *
 *   head_line   — ear→shoulder line from image vertical (a head-forward PROXY, not craniovertebral angle)
 *   trunk_lean  — shoulder→hip line from image vertical
 *   hip_angle   — shoulder–hip–knee angle (withheld unless the near-side knee is visible)
 *
 * Positive values mean the upper point lies FORWARD (toward the face) of the lower one. There are
 * no "ideal" values, no screen or chair claims and no severity bands: the numbers are descriptive
 * camera estimates for a clinician to review.
 */

export const DESK_CHECK_VERSION = 'desk-check-1.0.0';
export const DESK_METRICS = ['head_line', 'trunk_lean', 'hip_angle'] as const;
export type DeskMetricId = (typeof DESK_METRICS)[number];

export const DESK_MIN_VISIBILITY = 0.6;
/** A capture is withheld when readings vary more than this across the window (degrees, max − min after trimming). */
export const DESK_MAX_SPREAD = 6;
/** Fraction of capture frames that must yield a reading. */
export const DESK_MIN_COVERAGE = 0.6;

export type DeskWithheld = 'landmarks_hidden' | 'direction_unknown' | 'degenerate';

export interface DeskReading {
  id: DeskMetricId;
  value: number | null;
  withheld?: DeskWithheld;
  /** Landmarks the reading needs that are not visible enough. */
  missing: number[];
  /** Mean visibility of the landmarks used. */
  confidence: number;
}

export interface DeskFrame {
  side: 'left' | 'right' | null;
  facing: 'image_left' | 'image_right' | null;
  readings: DeskReading[];
}

const near = (side: 'left' | 'right') =>
  side === 'left'
    ? { ear: LM.leftEar, shoulder: LM.leftShoulder, hip: LM.leftHip, knee: LM.leftKnee }
    : { ear: LM.rightEar, shoulder: LM.rightShoulder, hip: LM.rightHip, knee: LM.rightKnee };

const vis = (l: Landmark | undefined) => l?.visibility ?? 0;

/** The side facing the camera: the one whose ear, shoulder and hip are most visible. */
export function deskNearSide(lms: Landmark[]): 'left' | 'right' | null {
  const score = (s: 'left' | 'right') => {
    const n = near(s);
    return vis(lms[n.ear]) + vis(lms[n.shoulder]) + vis(lms[n.hip]);
  };
  const l = score('left');
  const r = score('right');
  if (Math.max(l, r) < DESK_MIN_VISIBILITY * 3) return null;
  return l >= r ? 'left' : 'right';
}

/** Which way the face points in the image (nose relative to the near ear); null when unclear. */
export function deskFacing(lms: Landmark[], side: 'left' | 'right', width: number): 'image_left' | 'image_right' | null {
  const nose = lms[LM.nose];
  const ear = lms[near(side).ear];
  if (vis(nose) < 0.5 || vis(ear) < DESK_MIN_VISIBILITY) return null;
  const dx = (nose.x - ear.x) * width;
  if (Math.abs(dx) < 4) return null;
  return dx < 0 ? 'image_left' : 'image_right';
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function deskReadings(lms: Landmark[], width: number, height: number, minVis = DESK_MIN_VISIBILITY): DeskFrame {
  const side = deskNearSide(lms);
  if (!side) {
    const all = [LM.leftEar, LM.leftShoulder, LM.leftHip];
    return { side: null, facing: null, readings: DESK_METRICS.map((id) => ({ id, value: null, withheld: 'landmarks_hidden', missing: all, confidence: 0 })) };
  }
  const n = near(side);
  const facing = deskFacing(lms, side, width);
  const px = (i: number) => toPixels(lms[i], width, height);
  const reading = (id: DeskMetricId, used: number[], compute: () => number | null, signed: boolean): DeskReading => {
    const missing = used.filter((i) => vis(lms[i]) < minVis);
    const confidence = used.reduce((a, i) => a + vis(lms[i]), 0) / used.length;
    if (missing.length) return { id, value: null, withheld: 'landmarks_hidden', missing, confidence };
    if (signed && !facing) return { id, value: null, withheld: 'direction_unknown', missing: [], confidence };
    const v = compute();
    if (v === null || !Number.isFinite(v)) return { id, value: null, withheld: 'degenerate', missing: [], confidence };
    return { id, value: round1(v), missing: [], confidence };
  };
  // deviationFromVertical is positive toward image-right; flip so that positive = toward the face.
  const forward = (d: number | null) => (d === null ? null : facing === 'image_left' ? -d : d);
  return {
    side,
    facing,
    readings: [
      reading('head_line', [n.ear, n.shoulder], () => forward(deviationFromVertical(px(n.shoulder), px(n.ear))), true),
      reading('trunk_lean', [n.shoulder, n.hip], () => forward(deviationFromVertical(px(n.hip), px(n.shoulder))), true),
      reading('hip_angle', [n.shoulder, n.hip, n.knee], () => jointAngle(px(n.shoulder), px(n.hip), px(n.knee)), false),
    ],
  };
}

export interface DeskResult {
  id: DeskMetricId;
  /** Median over the capture window, or null when withheld. */
  value: number | null;
  sd: number | null;
  spread: number | null;
  frames: number;
  coverage: number;
  confidence: number;
  withheld?: DeskWithheld | 'unstable' | 'too_few_frames';
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Collects frames over the hold window and reports the median of each metric, or why it is withheld. */
export class DeskCapture {
  private frames = 0;
  private values: Record<DeskMetricId, number[]> = { head_line: [], trunk_lean: [], hip_angle: [] };
  private conf: Record<DeskMetricId, number[]> = { head_line: [], trunk_lean: [], hip_angle: [] };
  private lastWithheld: Partial<Record<DeskMetricId, DeskWithheld>> = {};
  side: 'left' | 'right' | null = null;

  add(f: DeskFrame) {
    this.frames++;
    this.side ??= f.side;
    for (const r of f.readings) {
      if (r.value === null) {
        if (r.withheld) this.lastWithheld[r.id] = r.withheld;
        continue;
      }
      this.values[r.id].push(r.value);
      this.conf[r.id].push(r.confidence);
    }
  }

  result(): DeskResult[] {
    return DESK_METRICS.map((id) => {
      const xs = this.values[id];
      const coverage = this.frames ? xs.length / this.frames : 0;
      const confidence = xs.length ? this.conf[id].reduce((a, b) => a + b, 0) / xs.length : 0;
      const base = { id, frames: xs.length, coverage: round1(coverage * 100) / 100, confidence: Math.round(confidence * 1000) / 1000 };
      if (coverage < DESK_MIN_COVERAGE || xs.length < 5) return { ...base, value: null, sd: null, spread: null, withheld: this.lastWithheld[id] ?? 'too_few_frames' };
      // Trim the outer 10% each side before judging stability (single-frame jitter).
      const s = [...xs].sort((a, b) => a - b);
      const k = Math.floor(s.length * 0.1);
      const core = s.slice(k, s.length - k);
      const spread = core[core.length - 1] - core[0];
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
      if (spread > DESK_MAX_SPREAD) return { ...base, value: null, sd: round1(sd), spread: round1(spread), withheld: 'unstable' };
      return { ...base, value: round1(median(xs)), sd: round1(sd), spread: round1(spread) };
    });
  }
}
