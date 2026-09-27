import { createCoordinateFilter, type FilterKind, type ScalarFilter } from './filters';
import { LANDMARK_COUNT, LM } from './landmarks';
import type { Landmark, PoseFrame, ViewOrientation } from './types';
import { distance, midpoint, toPixels } from './vector';

/**
 * Stage 1 of the Motion Intelligence Engine (after the pose provider):
 *
 *   landmark extraction → confidence filtering → temporal smoothing → orientation
 *
 * The output keeps BOTH the raw and the smoothed landmarks so Validation Mode can compare them.
 */

export type TrackingStatus = 'no_person' | 'multiple_people' | 'tracking';

export interface ProcessedFrame {
  t: number;
  width: number;
  height: number;
  status: TrackingStatus;
  personCount: number;
  /** Primary person, unfiltered (null when not tracking). */
  raw: Landmark[] | null;
  /** Primary person after confidence gating + smoothing. */
  smoothed: Landmark[] | null;
  world: Landmark[] | null;
  orientation: ViewOrientation;
  orientationConfidence: number;
  inferenceMs: number;
  source: PoseFrame['provider'];
}

/** Landmarks below this visibility are not fed to the smoother (they keep their own low visibility). */
export const MIN_SMOOTHING_VISIBILITY = 0.3;
/** Filters are reset if a landmark has not been reliably seen for this long. */
const LOST_RESET_MS = 350;

class LandmarkSmoother {
  private fx: ScalarFilter[] = [];
  private fy: ScalarFilter[] = [];
  private fz: ScalarFilter[] = [];
  private lastSeen: number[] = [];

  constructor(private kind: FilterKind) {
    this.build();
  }

  private build() {
    this.fx = Array.from({ length: LANDMARK_COUNT }, () => createCoordinateFilter(this.kind));
    this.fy = Array.from({ length: LANDMARK_COUNT }, () => createCoordinateFilter(this.kind));
    this.fz = Array.from({ length: LANDMARK_COUNT }, () => createCoordinateFilter(this.kind));
    this.lastSeen = new Array(LANDMARK_COUNT).fill(-Infinity);
  }

  setKind(kind: FilterKind) {
    this.kind = kind;
    this.build();
  }

  reset() {
    this.build();
  }

  apply(lms: Landmark[], t: number): Landmark[] {
    return lms.map((lm, i) => {
      if (lm.visibility < MIN_SMOOTHING_VISIBILITY) {
        // Do not let occluded/guessed points drag the filter state; pass through unchanged so the
        // downstream confidence gate still sees the low visibility.
        return { ...lm };
      }
      if (t - this.lastSeen[i] > LOST_RESET_MS) {
        this.fx[i].reset();
        this.fy[i].reset();
        this.fz[i].reset();
      }
      this.lastSeen[i] = t;
      return {
        x: this.fx[i].filter(lm.x, t),
        y: this.fy[i].filter(lm.y, t),
        z: this.fz[i].filter(lm.z, t),
        visibility: lm.visibility,
      };
    });
  }
}

/**
 * Classifies the camera view of the body from shoulder width relative to torso length and the
 * left/right ordering of landmarks. Works on RAW (un-mirrored) image coordinates.
 */
export function detectOrientation(
  lms: Landmark[],
  width: number,
  height: number,
): { view: ViewOrientation; confidence: number } {
  const ls = lms[LM.leftShoulder];
  const rs = lms[LM.rightShoulder];
  const lh = lms[LM.leftHip];
  const rh = lms[LM.rightHip];
  const vis = Math.min(
    Math.max(ls.visibility, rs.visibility),
    Math.max(lh.visibility, rh.visibility),
  );
  if (vis < 0.5) return { view: 'unknown', confidence: 0 };

  const pLs = toPixels(ls, width, height);
  const pRs = toPixels(rs, width, height);
  const pLh = toPixels(lh, width, height);
  const pRh = toPixels(rh, width, height);
  const torso = distance(midpoint(pLs, pRs), midpoint(pLh, pRh));
  if (torso < 10) return { view: 'unknown', confidence: 0 };
  const ratio = Math.abs(pLs.x - pRs.x) / torso;

  if (ratio > 0.42) {
    // Frontal plane view. In an un-mirrored camera image a person FACING the camera has their
    // left shoulder on the image right (larger x).
    const nose = lms[LM.nose];
    const facing = ls.x > rs.x;
    const view: ViewOrientation = facing && nose.visibility > 0.4 ? 'anterior' : !facing ? 'posterior' : 'unknown';
    return { view, confidence: Math.min(1, (ratio - 0.42) / 0.3 + 0.5) * vis };
  }
  if (ratio < 0.28) {
    // Sagittal view: the side nearer the camera has the smaller z and usually higher visibility.
    const leftZ = (ls.z + lh.z) / 2;
    const rightZ = (rs.z + rh.z) / 2;
    const leftVis = (ls.visibility + lh.visibility) / 2;
    const rightVis = (rs.visibility + rh.visibility) / 2;
    const score = (rightZ - leftZ) + (leftVis - rightVis) * 0.5;
    const view: ViewOrientation = score >= 0 ? 'lateral_left' : 'lateral_right';
    return { view, confidence: Math.min(1, (0.28 - ratio) / 0.2 + 0.5) * vis };
  }
  return { view: 'unknown', confidence: 0.3 * vis };
}

export class MotionPipeline {
  private smoother: LandmarkSmoother;
  private lastOrientation: ViewOrientation = 'unknown';
  private orientationVotes: ViewOrientation[] = [];

  constructor(private filterKind: FilterKind = 'one_euro') {
    this.smoother = new LandmarkSmoother(filterKind);
  }

  get filter(): FilterKind {
    return this.filterKind;
  }

  setFilter(kind: FilterKind) {
    this.filterKind = kind;
    this.smoother.setKind(kind);
  }

  reset() {
    this.smoother.reset();
    this.orientationVotes = [];
    this.lastOrientation = 'unknown';
  }

  process(frame: PoseFrame): ProcessedFrame {
    const base = {
      t: frame.timestamp,
      width: frame.width,
      height: frame.height,
      personCount: frame.poses.length,
      inferenceMs: frame.inferenceMs,
      source: frame.provider,
    };
    if (frame.poses.length === 0) {
      this.smoother.reset();
      return { ...base, status: 'no_person', raw: null, smoothed: null, world: null, orientation: 'unknown', orientationConfidence: 0 };
    }
    if (frame.poses.length > 1) {
      // Never guess which person is the patient.
      return { ...base, status: 'multiple_people', raw: null, smoothed: null, world: null, orientation: 'unknown', orientationConfidence: 0 };
    }
    const raw = frame.poses[0];
    const smoothed = this.smoother.apply(raw, frame.timestamp);
    const o = detectOrientation(smoothed, frame.width, frame.height);
    // Majority vote over recent frames to stop the orientation flickering at boundaries.
    this.orientationVotes.push(o.view);
    if (this.orientationVotes.length > 9) this.orientationVotes.shift();
    const counts = new Map<ViewOrientation, number>();
    for (const v of this.orientationVotes) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: ViewOrientation = this.lastOrientation;
    let bestN = 0;
    for (const [v, n] of counts) {
      if (n > bestN) {
        best = v;
        bestN = n;
      }
    }
    this.lastOrientation = best;
    return {
      ...base,
      status: 'tracking',
      raw,
      smoothed,
      world: frame.worldLandmarks ?? null,
      orientation: best,
      orientationConfidence: o.confidence,
    };
  }
}
