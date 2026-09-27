import type { ProcessedFrame } from './pipeline';
import { jointList, LANDMARK_NAMES, LM } from './landmarks';
import { MIN_SUPPORT } from './measurements';
import { handsInFront } from './posture';
import type { Landmark, ViewOrientation } from './types';

/**
 * Camera calibration: decides whether the scene is good enough to measure anything at all.
 * Nothing clinical-looking is computed until every required check passes and has stayed
 * passing for `stableMs`.
 */

export type CalibrationCheckId =
  | 'person'
  | 'single_person'
  | 'framing'
  | 'distance'
  | 'centering'
  | 'orientation'
  | 'camera_level'
  | 'lighting'
  | 'confidence'
  | 'stable'
  | 'hands_clear';

export type CheckStatus = 'pass' | 'fail' | 'unknown';

/** Instruction codes are translated by the UI (i18n key `calib.<code>`). */
export type InstructionCode =
  | 'no_person'
  | 'multiple_people'
  | 'full_body'
  | 'move_back'
  | 'move_closer'
  | 'move_left'
  | 'move_right'
  | 'turn_side_left'
  | 'turn_side_right'
  | 'turn_side'
  | 'face_camera'
  | 'camera_tilted'
  | 'increase_lighting'
  | 'reduce_backlight'
  | 'low_confidence'
  | 'joint_hidden'
  | 'joint_covered'
  | 'lower_hands'
  | 'hold_still'
  | 'ready';

export interface CalibrationCheck {
  id: CalibrationCheckId;
  status: CheckStatus;
  instruction?: InstructionCode;
  /** Measured value behind the decision, surfaced in Validation Mode. */
  detail?: string;
  /** Parameters for the instruction text (e.g. the joints that are hidden). */
  params?: Record<string, string>;
}

export interface LightingSample {
  /** Mean luma 0–255. */
  meanLuma: number;
  /** Fraction of pixels clipped near white (possible backlight/glare). */
  clippedFraction: number;
}

export interface CalibrationRequirements {
  /** Landmarks that must be inside the frame and confidently visible. */
  landmarks: number[];
  /** Acceptable views; empty = any. */
  views: ViewOrientation[];
  /** Fraction of frame height the body should occupy (min, max). */
  heightRange: [number, number];
  /** Axis along which body extent is judged: vertical for standing, horizontal for lying tests. */
  extentAxis?: 'vertical' | 'horizontal';
  /**
   * Landmarks whose extent is the distance proxy (e.g. hip→foot for a heel slide). When set, only
   * this region — not the whole body — decides "move closer / move back", and only REQUIRED
   * landmarks leaving the frame count as a framing failure.
   */
  extentLandmarks?: number[];
  minConfidence: number;
  maxRollDeg: number;
  /** Require the hands away from the front of the torso (static posture scan, front/back views). */
  handsFree?: boolean;
}

export interface CalibrationInput {
  frame: ProcessedFrame;
  req: CalibrationRequirements;
  lighting: LightingSample | null;
  /** Device roll from the orientation sensor, or null when unavailable (e.g. laptops). */
  cameraRollDeg: number | null;
  /** 'user' = front camera shown mirrored; affects left/right instructions. */
  facing: 'user' | 'environment';
}

export interface CalibrationResult {
  checks: CalibrationCheck[];
  /** All checks pass on this frame. */
  frameReady: boolean;
  /** Highest-priority instruction to show/speak. */
  instruction: InstructionCode;
  instructionParams?: Record<string, string>;
}

/** Same edge band as measurement (FRAME_MARGIN): setup must not pass a framing that measurement refuses. */
const EDGE_MARGIN = 0.04;
export const MIN_LUMA = 60;
const MAX_CLIPPED = 0.25;

function visibleIn(lm: Landmark, minC: number): boolean {
  return lm.visibility >= minC && lm.x >= EDGE_MARGIN && lm.x <= 1 - EDGE_MARGIN && lm.y >= EDGE_MARGIN && lm.y <= 1 - EDGE_MARGIN;
}

export function evaluateCalibration(input: CalibrationInput): CalibrationResult {
  const { frame, req, lighting, cameraRollDeg, facing } = input;
  const checks: CalibrationCheck[] = [];
  const add = (c: CalibrationCheck) => checks.push(c);

  // Lighting and camera level are independent of the body, so evaluate them first.
  if (lighting) {
    if (lighting.meanLuma < MIN_LUMA) add({ id: 'lighting', status: 'fail', instruction: 'increase_lighting', detail: `luma ${lighting.meanLuma.toFixed(0)}` });
    else if (lighting.clippedFraction > MAX_CLIPPED) add({ id: 'lighting', status: 'fail', instruction: 'reduce_backlight', detail: `clipped ${(lighting.clippedFraction * 100).toFixed(0)}%` });
    else add({ id: 'lighting', status: 'pass', detail: `luma ${lighting.meanLuma.toFixed(0)}` });
  } else add({ id: 'lighting', status: 'unknown' });

  if (cameraRollDeg === null) add({ id: 'camera_level', status: 'unknown', detail: 'no orientation sensor' });
  else if (Math.abs(cameraRollDeg) > req.maxRollDeg) add({ id: 'camera_level', status: 'fail', instruction: 'camera_tilted', detail: `${cameraRollDeg.toFixed(1)}°` });
  else add({ id: 'camera_level', status: 'pass', detail: `${cameraRollDeg.toFixed(1)}°` });

  if (frame.status === 'no_person') {
    add({ id: 'person', status: 'fail', instruction: 'no_person' });
    return finish(checks);
  }
  add({ id: 'person', status: 'pass' });
  if (frame.status === 'multiple_people') {
    add({ id: 'single_person', status: 'fail', instruction: 'multiple_people', detail: `${frame.personCount} people` });
    return finish(checks);
  }
  add({ id: 'single_person', status: 'pass' });
  // Identity / limb labels must have been stable for the re-acquisition window.
  if (frame.status === 'reacquiring') add({ id: 'stable', status: 'fail', instruction: 'hold_still', detail: `${frame.integrity.event ?? 'acquiring'} · stable ${Math.round(frame.integrity.stableForMs)} ms` });
  else add({ id: 'stable', status: 'pass' });

  const lms = frame.smoothed!;
  const required = req.landmarks.map((i) => lms[i]);

  // Distance: vertical extent of the body in the frame.
  // Body extent along the relevant axis: a distance proxy (fraction of frame, not metres).
  const horiz = req.extentAxis === 'horizontal';
  const coord = (l: Landmark) => (horiz ? l.x : l.y);
  let top: number;
  let bottom: number;
  if (req.extentLandmarks?.length) {
    const region = req.extentLandmarks.map((i) => lms[i]).filter((l) => l.visibility > 0.4);
    const pts = (region.length >= 2 ? region : required).map(coord);
    top = Math.min(...pts);
    bottom = Math.max(...pts);
  } else {
    const ys = [lms[LM.nose], lms[LM.leftAnkle], lms[LM.rightAnkle], lms[LM.leftShoulder], lms[LM.rightShoulder], lms[LM.leftHip], lms[LM.rightHip]]
      .filter((l) => l.visibility > 0.4)
      .map(coord);
    top = Math.min(...required.map(coord), ...ys);
    bottom = Math.max(...required.map(coord), ...ys);
  }
  const extent = bottom - top;
  const tooClose = extent > req.heightRange[1] || top < 0 || bottom > 1;

  const outside = required.filter((l) => !visibleIn(l, 0.3));
  if (outside.length > 0) {
    add({ id: 'framing', status: 'fail', instruction: tooClose ? 'move_back' : 'full_body', detail: `${outside.length} landmarks outside` });
  } else add({ id: 'framing', status: 'pass' });

  if (tooClose) add({ id: 'distance', status: 'fail', instruction: 'move_back', detail: `extent ${(extent * 100).toFixed(0)}%` });
  else if (extent < req.heightRange[0]) add({ id: 'distance', status: 'fail', instruction: 'move_closer', detail: `extent ${(extent * 100).toFixed(0)}%` });
  else add({ id: 'distance', status: 'pass', detail: `extent ${(extent * 100).toFixed(0)}%` });

  // Horizontal centring on the hip midpoint.
  const cx = (lms[LM.leftHip].x + lms[LM.rightHip].x) / 2;
  const off = cx - 0.5;
  if (Math.abs(off) > 0.17) {
    // Raw image: a person who steps to THEIR left moves to the image right when facing a front camera.
    // For a rear (clinician-held) camera the instruction is phrased relative to the displayed image.
    let instruction: InstructionCode;
    if (facing === 'user') instruction = off > 0 ? 'move_right' : 'move_left';
    else instruction = off > 0 ? 'move_left' : 'move_right';
    add({ id: 'centering', status: 'fail', instruction, detail: `offset ${(off * 100).toFixed(0)}%` });
  } else add({ id: 'centering', status: 'pass', detail: `offset ${(off * 100).toFixed(0)}%` });

  if (req.views.length === 0) add({ id: 'orientation', status: 'pass', detail: frame.orientation });
  else if (req.views.includes(frame.orientation)) add({ id: 'orientation', status: 'pass', detail: frame.orientation });
  else {
    const wantsLateral = req.views.every((v) => v.startsWith('lateral'));
    let instruction: InstructionCode = 'face_camera';
    if (wantsLateral) {
      instruction = req.views.length === 1 ? (req.views[0] === 'lateral_left' ? 'turn_side_left' : 'turn_side_right') : 'turn_side';
    }
    add({ id: 'orientation', status: 'fail', instruction, detail: frame.orientation });
  }

  // EVERY landmark the selected test needs must be confidently visible: a strong mean must not
  // hide one occluded joint.
  if (req.handsFree && (frame.orientation === 'anterior' || frame.orientation === 'posterior')) {
    if (handsInFront(lms, frame.width, frame.height)) add({ id: 'hands_clear', status: 'fail', instruction: 'lower_hands', detail: 'wrist inside the torso outline' });
    else add({ id: 'hands_clear', status: 'pass' });
  }

  // Body support (segmentation) catches an object held in front of a joint that the model still
  // reports as visible.
  const occluded = req.landmarks.filter((i) => lms[i].visibility < req.minConfidence);
  const covered = frame.support ? req.landmarks.filter((i) => (frame.support![i] ?? 1) < MIN_SUPPORT && lms[i].visibility >= req.minConfidence) : [];
  if (occluded.length > 0 || covered.length > 0) {
    const parts = [occluded.length ? `occluded: ${occluded.map((i) => LANDMARK_NAMES[i]).join(', ')}` : '', covered.length ? `covered: ${covered.map((i) => LANDMARK_NAMES[i]).join(', ')}` : ''].filter(Boolean);
    add({ id: 'confidence', status: 'fail', instruction: covered.length ? 'joint_covered' : 'joint_hidden', detail: parts.join(' · '), params: { joints: jointList(covered.length ? covered : occluded) } });
  } else {
    add({ id: 'confidence', status: 'pass', detail: `min ${Math.min(...required.map((l) => l.visibility)).toFixed(2)}` });
  }

  return finish(checks);
}

/** Order in which failing instructions are shown: fix the most fundamental problem first. */
const PRIORITY: CalibrationCheckId[] = ['person', 'single_person', 'lighting', 'camera_level', 'distance', 'framing', 'centering', 'orientation', 'hands_clear', 'confidence', 'stable'];

function finish(checks: CalibrationCheck[]): CalibrationResult {
  const failing = checks.filter((c) => c.status === 'fail').sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));
  return {
    checks,
    frameReady: failing.length === 0 && checks.some((c) => c.id === 'confidence' && c.status === 'pass'),
    instruction: failing[0]?.instruction ?? 'ready',
    instructionParams: failing[0]?.params,
  };
}

/** Requires calibration to hold continuously before a scan may start (debounces flicker). */
export class CalibrationGate {
  private since: number | null = null;
  constructor(private readonly stableMs = 1000) {}

  update(result: CalibrationResult, t: number): { ready: boolean; progress: number } {
    if (!result.frameReady) {
      this.since = null;
      return { ready: false, progress: 0 };
    }
    if (this.since === null) this.since = t;
    const progress = Math.min(1, (t - this.since) / this.stableMs);
    return { ready: progress >= 1, progress };
  }

  reset() {
    this.since = null;
  }
}

/** Mean luma / clipping from an RGBA buffer (e.g. a 32×24 downscaled video frame). */
export function lightingFromPixels(data: Uint8ClampedArray): LightingSample {
  let sum = 0;
  let clipped = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += y;
    if (y > 245) clipped++;
  }
  return { meanLuma: sum / Math.max(1, n), clippedFraction: clipped / Math.max(1, n) };
}
