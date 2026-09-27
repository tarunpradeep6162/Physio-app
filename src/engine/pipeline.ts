import { createCoordinateFilter, type FilterKind, type ScalarFilter } from './filters';
import { IdentityGuard, type IdentityEvent } from './identity';
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

/**
 * `reacquiring`: a person is tracked but identity/labels have not yet been stable for the
 * re-acquisition window (after first detection, a gap, a bystander switch or a limb-label swap).
 * Consumers treat anything other than `tracking` as "withhold measurement".
 */
export type TrackingStatus = 'no_person' | 'multiple_people' | 'reacquiring' | 'tracking';

/** A tracked pose must be stable this long (and this many frames) before measurements resume. */
export const REACQUIRE_MS = 500;
export const REACQUIRE_FRAMES = 3;
/** Orientation majority-vote window. */
export const ORIENTATION_WINDOW_MS = 400;

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
  /** Per-landmark body support from person segmentation (null when not available). */
  support: number[] | null;
  /** Identity / label continuity: last event and how long the pose has been stable since. */
  integrity: { event: IdentityEvent | null; detail?: string; stableForMs: number };
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
): { view: ViewOrientation; confidence: number; basis?: 'anatomy' | 'agreement' | 'depth' | 'frontal' } {
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
    return { view, confidence: Math.min(1, (ratio - 0.42) / 0.3 + 0.5) * vis, basis: 'frontal' };
  }
  if (ratio < 0.28) {
    const sagittal = Math.min(1, (0.28 - ratio) / 0.2 + 0.5) * vis;
    // 1) Anatomical near side (preferred): the body's superior axis S (hips → shoulders) crossed
    //    with the facing direction A (ears → nose). In an UN-MIRRORED image the patient's left side
    //    faces the camera when S × A points toward the viewer — true standing, sitting or lying.
    const anat = anatomicalNearSide(lms, width, height, pLs, pRs, pLh, pRh);
    // 2) Model depth (smaller z = nearer) and visibility — noisy on its own.
    const leftZ = (ls.z + lh.z) / 2;
    const rightZ = (rs.z + rh.z) / 2;
    const leftVis = (ls.visibility + lh.visibility) / 2;
    const rightVis = (rs.visibility + rh.visibility) / 2;
    const score = (rightZ - leftZ) + (leftVis - rightVis) * 0.5;
    const depthSide = score >= 0 ? 'left' : 'right';
    const asView = (s2: 'left' | 'right'): ViewOrientation => (s2 === 'left' ? 'lateral_left' : 'lateral_right');
    if (anat && anat.confidence >= 0.7) return { view: asView(anat.side), confidence: sagittal * anat.confidence, basis: 'anatomy' };
    // Weak anatomical evidence counts only when the depth cue agrees; a disagreement is "unknown".
    if (anat && anat.confidence >= 0.4) return anat.side === depthSide ? { view: asView(anat.side), confidence: sagittal * 0.6, basis: 'agreement' } : { view: 'unknown', confidence: 0.2 * vis };
    return { view: asView(depthSide), confidence: sagittal * 0.5, basis: 'depth' };
  }
  return { view: 'unknown', confidence: 0.3 * vis };
}

/**
 * Which side of the body faces the camera, from anatomy alone (see detectOrientation). Returns
 * null when the face direction is not measurable (nose not visible, head turned to the camera).
 * `confidence` is |sin| of the angle between the body axis and the facing direction.
 */
export function anatomicalNearSide(lms: Landmark[], width: number, height: number, pLs = toPixels(lms[LM.leftShoulder], width, height), pRs = toPixels(lms[LM.rightShoulder], width, height), pLh = toPixels(lms[LM.leftHip], width, height), pRh = toPixels(lms[LM.rightHip], width, height)): { side: 'left' | 'right'; confidence: number } | null {
  const nose = lms[LM.nose];
  const le = lms[LM.leftEar];
  const re = lms[LM.rightEar];
  if (nose.visibility < 0.5 || Math.max(le.visibility, re.visibility) < 0.3) return null;
  // Ear reference: the better-seen ear (the far ear is often hidden in a side view).
  const ear = le.visibility >= re.visibility ? le : re;
  const pn = toPixels(nose, width, height);
  const pe = toPixels(ear, width, height);
  const sh = midpoint(pLs, pRs);
  const hp = midpoint(pLh, pRh);
  const S = { x: sh.x - hp.x, y: sh.y - hp.y };
  const A = { x: pn.x - pe.x, y: pn.y - pe.y };
  const nS = Math.hypot(S.x, S.y);
  const nA = Math.hypot(A.x, A.y);
  // A face-direction vector that is tiny relative to the torso is landmark noise, not a direction.
  if (nS < 10 || nA < Math.max(3, 0.1 * nS)) return null;
  // Image y points down; with y up, the z-component of S × A is (−Sx·Ay + Sy·Ax).
  const lz = (-S.x * A.y + S.y * A.x) / (nS * nA);
  return { side: lz > 0 ? 'left' : 'right', confidence: Math.min(1, Math.abs(lz)) };
}

export class MotionPipeline {
  private smoother: LandmarkSmoother;
  private lastOrientation: ViewOrientation = 'unknown';
  private orientationVotes: { t: number; v: ViewOrientation }[] = [];
  private identity = new IdentityGuard();
  private stableSince: number | null = null;
  private stableFrames = 0;
  private lastEvent: { event: IdentityEvent | null; detail?: string } = { event: null };
  /** Side view established from strong anatomical evidence for the current identity. */
  private lateralLock: ViewOrientation | null = null;

  /**
   * Coordinate smoothing defaults to NONE (Phase 7 filter study: it added 40–50 ms lag and passed
   * leg-swap spikes). The drawn skeleton and the measured angle therefore come from the same,
   * unsmoothed landmarks of the same frame; smoothing is applied to the angle signal instead.
   */
  constructor(private filterKind: FilterKind = 'none') {
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
    this.identity.reset();
    this.stableSince = null;
    this.stableFrames = 0;
    this.lastEvent = { event: null };
    this.lateralLock = null;
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
    const none = { raw: null, smoothed: null, world: null, support: null, orientation: 'unknown' as const, orientationConfidence: 0 };
    if (frame.poses.length !== 1) {
      // No person, or more than one: never guess which person is the patient.
      this.smoother.reset();
      this.stableSince = null;
      this.stableFrames = 0;
      this.identity.update(null, frame.timestamp, frame.width, frame.height);
      return { ...base, ...none, status: frame.poses.length === 0 ? 'no_person' : 'multiple_people', integrity: { event: null, stableForMs: 0 } };
    }
    const raw = frame.poses[0];
    const id = this.identity.update(raw, frame.timestamp, frame.width, frame.height);
    if (id.event) {
      // New or changed identity / swapped labels: do not blend it with the previous person's filter state.
      this.smoother.reset();
      this.orientationVotes = [];
      this.lateralLock = null;
      this.stableSince = frame.timestamp;
      this.stableFrames = 0;
      this.lastEvent = id;
    }
    this.stableSince ??= frame.timestamp;
    this.stableFrames++;
    const stableForMs = frame.timestamp - this.stableSince;
    const smoothed = this.smoother.apply(raw, frame.timestamp);
    const o0 = detectOrientation(smoothed, frame.width, frame.height);
    // A side view confirmed by strong anatomy stays locked for this identity: lying or standing
    // still, the side facing the camera cannot change without turning (which moves the body and
    // produces strong anatomical evidence or an identity event). Weak depth-only frames do not flip it.
    if (o0.basis === 'anatomy') this.lateralLock = o0.view;
    else if (o0.basis === 'frontal') this.lateralLock = null;
    const o = o0.basis === 'depth' && this.lateralLock ? { ...o0, view: this.lateralLock } : o0;
    // Majority vote over a TIME window (not a frame count, so it behaves the same at 3 and 30 fps),
    // with at least 3 votes, to stop the orientation flickering at boundaries.
    this.orientationVotes.push({ t: frame.timestamp, v: o.view });
    while (this.orientationVotes.length > 3 && frame.timestamp - this.orientationVotes[0].t > ORIENTATION_WINDOW_MS) this.orientationVotes.shift();
    const counts = new Map<ViewOrientation, number>();
    for (const { v } of this.orientationVotes) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: ViewOrientation = this.lastOrientation;
    let bestN = 0;
    for (const [v, n] of counts) {
      if (n > bestN) {
        best = v;
        bestN = n;
      }
    }
    this.lastOrientation = best;
    const stable = stableForMs >= REACQUIRE_MS && this.stableFrames >= REACQUIRE_FRAMES;
    return {
      ...base,
      status: stable ? 'tracking' : 'reacquiring',
      raw,
      smoothed,
      world: frame.worldLandmarks ?? null,
      support: frame.support ?? null,
      integrity: { event: this.lastEvent.event, detail: this.lastEvent.detail, stableForMs },
      orientation: best,
      orientationConfidence: o.confidence,
    };
  }
}
