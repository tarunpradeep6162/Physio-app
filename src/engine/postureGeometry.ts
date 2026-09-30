import { checkRequired } from './measurements';
import { LM } from './landmarks';
import type { Landmark, ViewOrientation } from './types';

/**
 * Geometry for the clinical posture grid: the relative height scale, the plumb-line position and
 * the zoomed body regions. Everything is derived from landmarks that pass the same visibility and
 * in-frame checks as the measurements; when they do not, the element is not drawn and the reason
 * is returned. There is no centimetre scale: a single uncalibrated camera cannot measure distance.
 */

const MIN_CONF = 0.6;
const lateral = (v: ViewOrientation) => v === 'lateral_left' || v === 'lateral_right';
const near = (v: ViewOrientation, l: number, r: number) => (v === 'lateral_right' ? r : l);

export type GeometryResult<T> = { ok: true; value: T } | { ok: false; missing: number[] };

/**
 * Relative height scale: 0 at the ankles, 100 at the nose (the same span the plumb offsets are
 * normalised by). Only available when the feet and the face are both visible and in frame.
 */
export function heightScale(lms: Landmark[], view: ViewOrientation, support?: number[] | null): GeometryResult<{ ankleY: number; noseY: number }> {
  const ankles = lateral(view) ? [near(view, LM.leftAnkle, LM.rightAnkle)] : [LM.leftAnkle, LM.rightAnkle];
  const chk = checkRequired(lms, [LM.nose, ...ankles], MIN_CONF, support);
  if (chk.issue) return { ok: false, missing: chk.missing };
  const ankleY = ankles.reduce((a, i) => a + lms[i].y, 0) / ankles.length;
  const noseY = lms[LM.nose].y;
  if (ankleY - noseY < 0.2) return { ok: false, missing: [] };
  return { ok: true, value: { ankleY, noseY } };
}

/** Plumb line: through the ankle midpoint (front/back) or the near-side ankle (side view). */
export function plumbX(lms: Landmark[], view: ViewOrientation, support?: number[] | null): GeometryResult<number> {
  const ankles = lateral(view) ? [near(view, LM.leftAnkle, LM.rightAnkle)] : [LM.leftAnkle, LM.rightAnkle];
  const chk = checkRequired(lms, ankles, MIN_CONF, support);
  if (chk.issue) return { ok: false, missing: chk.missing };
  return { ok: true, value: ankles.reduce((a, i) => a + lms[i].x, 0) / ankles.length };
}

export type PostureRegion = 'full_body' | 'head_neck' | 'trunk' | 'lower_limb';
export const POSTURE_REGIONS: PostureRegion[] = ['full_body', 'head_neck', 'trunk', 'lower_limb'];

/** Landmarks a region needs before it is shown zoomed (near side only in a side view). */
export function regionLandmarks(region: PostureRegion, view: ViewOrientation): number[] {
  const side = lateral(view);
  const pair = (l: number, r: number) => (side ? [near(view, l, r)] : [l, r]);
  const head = [LM.nose, ...pair(LM.leftEar, LM.rightEar)];
  const shoulders = pair(LM.leftShoulder, LM.rightShoulder);
  const hips = pair(LM.leftHip, LM.rightHip);
  const legs = [...pair(LM.leftKnee, LM.rightKnee), ...pair(LM.leftAnkle, LM.rightAnkle), ...pair(LM.leftHeel, LM.rightHeel), ...pair(LM.leftFootIndex, LM.rightFootIndex)];
  switch (region) {
    case 'head_neck':
      return [...head, ...shoulders];
    case 'trunk':
      return [...shoulders, ...hips];
    case 'lower_limb':
      return [...hips, ...legs];
    case 'full_body':
      return [...head, ...shoulders, ...hips, ...legs];
  }
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Normalised crop box for a region, padded and widened to the target aspect ratio (w/h in
 * pixels). Withheld — never guessed — when any required landmark is hidden or out of frame.
 */
export function regionBox(lms: Landmark[], region: PostureRegion, view: ViewOrientation, frameW: number, frameH: number, aspect = 4 / 3, support?: number[] | null): GeometryResult<Box> {
  const idx = regionLandmarks(region, view);
  const chk = checkRequired(lms, idx, MIN_CONF, support);
  if (chk.issue) return { ok: false, missing: chk.missing };
  const xs = idx.map((i) => lms[i].x * frameW);
  const ys = idx.map((i) => lms[i].y * frameH);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const pad = Math.max(x1 - x0, y1 - y0) * 0.18 + frameH * 0.02;
  // The head needs room above the nose and ears; the feet need room below.
  x0 -= pad;
  x1 += pad;
  y0 -= region === 'head_neck' || region === 'full_body' ? pad * 1.6 : pad;
  y1 += pad;
  let w = x1 - x0;
  let h = y1 - y0;
  if (w / h < aspect) {
    const nw = h * aspect;
    x0 -= (nw - w) / 2;
    w = nw;
  } else {
    const nh = w / aspect;
    y0 -= (nh - h) / 2;
    h = nh;
  }
  return { ok: true, value: { x: x0 / frameW, y: y0 / frameH, w: w / frameW, h: h / frameH } };
}

/**
 * The scan region that contains a body-map region the patient marked (pain map ids such as
 * "neck_side_left", "lower_back_center", "knee_right"). Arms and hands map to the full body.
 * Used only to zoom and to outline the PATIENT-REPORTED area — never as a finding.
 */
export function postureRegionFor(bodyMapRegionId: string): PostureRegion {
  const id = bodyMapRegionId.toLowerCase();
  if (/^(head|neck|jaw|face)/.test(id)) return 'head_neck';
  if (/^(shoulder|chest|upper_back|mid_back|lower_back|abdomen|flank|spine|back)/.test(id)) return 'trunk';
  if (/^(buttock|groin|hip|thigh|knee|shin|calf|ankle|foot|heel|toe)/.test(id)) return 'lower_limb';
  return 'full_body';
}

/** Zoom focus (frame 0–1 coordinates) and scale that fit a region box, clamped to [1, max]. */
export function zoomToBox(b: Box, max = 2.2): { fx: number; fy: number; scale: number } {
  return { fx: b.x + b.w / 2, fy: b.y + b.h / 2, scale: Math.max(1, Math.min(max, 0.9 / Math.max(b.w, b.h))) };
}

/** Landmarks that outline one body-map area (side taken from the id, e.g. "knee_left"). */
export function reportedAreaLandmarks(bodyMapRegionId: string): number[] {
  const id = bodyMapRegionId.toLowerCase();
  const side: 'left' | 'right' | null = /(^|_)left(_|$)/.test(id) ? 'left' : /(^|_)right(_|$)/.test(id) ? 'right' : null;
  const s = (l: number, r: number) => (side === 'left' ? [l] : side === 'right' ? [r] : [l, r]);
  if (/^head|^face|^jaw/.test(id)) return [LM.nose, LM.leftEar, LM.rightEar];
  if (/^neck/.test(id)) return [...s(LM.leftEar, LM.rightEar), ...s(LM.leftShoulder, LM.rightShoulder)];
  if (/^shoulder/.test(id)) return s(LM.leftShoulder, LM.rightShoulder);
  if (/^(upper_back|chest)/.test(id)) return [LM.leftShoulder, LM.rightShoulder];
  if (/^(mid_back|abdomen_upper)/.test(id)) return [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
  if (/^(lower_back|abdomen_lower)/.test(id)) return [LM.leftHip, LM.rightHip];
  if (/^(flank|buttock|groin|hip)/.test(id)) return s(LM.leftHip, LM.rightHip);
  if (/^thigh/.test(id)) return [...s(LM.leftHip, LM.rightHip), ...s(LM.leftKnee, LM.rightKnee)];
  if (/^knee/.test(id)) return s(LM.leftKnee, LM.rightKnee);
  if (/^(shin|calf)/.test(id)) return [...s(LM.leftKnee, LM.rightKnee), ...s(LM.leftAnkle, LM.rightAnkle)];
  if (/^ankle/.test(id)) return s(LM.leftAnkle, LM.rightAnkle);
  if (/^(foot|heel|toe)/.test(id)) return [...s(LM.leftAnkle, LM.rightAnkle), ...s(LM.leftHeel, LM.rightHeel), ...s(LM.leftFootIndex, LM.rightFootIndex)];
  if (/^upper_arm/.test(id)) return [...s(LM.leftShoulder, LM.rightShoulder), ...s(LM.leftElbow, LM.rightElbow)];
  if (/^elbow/.test(id)) return s(LM.leftElbow, LM.rightElbow);
  if (/^forearm/.test(id)) return [...s(LM.leftElbow, LM.rightElbow), ...s(LM.leftWrist, LM.rightWrist)];
  if (/^(wrist|hand)/.test(id)) return [...s(LM.leftWrist, LM.rightWrist), ...s(LM.leftIndex, LM.rightIndex)];
  return [];
}

/**
 * Tight box around the exact area the patient marked (for the outline and "zoom to pain area"),
 * padded in proportion to shoulder width. Withheld when those landmarks are not visible.
 */
export function reportedAreaBox(lms: Landmark[], bodyMapRegionId: string, frameW: number, frameH: number, aspect?: number, support?: number[] | null): GeometryResult<Box> {
  const idx = reportedAreaLandmarks(bodyMapRegionId);
  if (!idx.length) return { ok: false, missing: [] };
  const chk = checkRequired(lms, idx, MIN_CONF, support);
  if (chk.issue) return { ok: false, missing: chk.missing };
  const xs = idx.map((i) => lms[i].x * frameW);
  const ys = idx.map((i) => lms[i].y * frameH);
  const shoulders = checkRequired(lms, [LM.leftShoulder, LM.rightShoulder], MIN_CONF, support).issue
    ? frameH * 0.08
    : Math.hypot((lms[LM.leftShoulder].x - lms[LM.rightShoulder].x) * frameW, (lms[LM.leftShoulder].y - lms[LM.rightShoulder].y) * frameH);
  const pad = Math.max(frameH * 0.03, shoulders * 0.45);
  let x0 = Math.min(...xs) - pad;
  let x1 = Math.max(...xs) + pad;
  let y0 = Math.min(...ys) - pad;
  let y1 = Math.max(...ys) + pad;
  if (aspect) {
    const w = x1 - x0;
    const h = y1 - y0;
    if (w / h < aspect) {
      const nw = h * aspect;
      x0 -= (nw - w) / 2;
      x1 = x0 + nw;
    } else {
      const nh = w / aspect;
      y0 -= (nh - h) / 2;
      y1 = y0 + nh;
    }
  }
  return { ok: true, value: { x: x0 / frameW, y: y0 / frameH, w: (x1 - x0) / frameW, h: (y1 - y0) / frameH } };
}
