import { LANDMARK_COUNT, LM } from '../landmarks';
import type { Landmark, Side } from '../types';

/**
 * Deterministic synthetic skeletons. Used by the unit tests and by the SIMULATED demo provider.
 * Everything produced here is synthetic and must be labelled as such wherever it is displayed.
 */

export interface SynthOptions {
  width?: number;
  height?: number;
  /** Gaussian-ish noise amplitude in pixels. */
  noisePx?: number;
  seed?: number;
  /** Visibility of the side nearest the camera. */
  nearVisibility?: number;
  farVisibility?: number;
}

export type SynthScene =
  | {
      kind: 'standing_lateral';
      side: Side;
      kneeFlexion?: number;
      shoulderFlexion?: number;
      trunkLean?: number;
      scale?: number;
      /** Near thigh swung forward from vertical (deg); knee bend is relative to the thigh. */
      hipFlexion?: number;
      /** Both heels raised: foot rotated about the toes (deg); the body rises with it. */
      heelLift?: number;
      /** Head and neck tilted forward (+) or back (−) about the shoulder (deg). */
      neckFlexion?: number;
    }
  /** Knee-to-wall lunge seen from the side: front (tested) foot flat, shin tilted forward by shankTilt (deg). */
  | { kind: 'lunge_lateral'; side: Side; shankTilt: number; scale?: number }
  | { kind: 'supine_lateral'; side: Side; legRaise?: number; kneeBend?: number }
  | {
      kind: 'standing_anterior';
      shoulderTiltDeg?: number;
      pelvicTiltDeg?: number;
      shoulderAbduction?: number;
      armSide?: Side;
      offsetX?: number;
      scale?: number;
      handsInFront?: boolean;
      /** Leg moved out to the side (deg) on legSide, knee straight. */
      hipAbduction?: number;
      legSide?: Side;
      /** Upper body bent sideways about the mid-hip (deg); + = toward the patient's left. */
      trunkSideBend?: number;
      /** One foot lifted off the floor by `height` × leg length. */
      footLift?: { side: Side; height: number };
    }
  /** Supine heel slide seen from the side: knee flexes with the heel on the floor. */
  | { kind: 'supine_heel_slide'; side: Side; kneeFlexion: number }
  /** Sit-to-stand seen from the side: kneeFlexion ~90 seated → ~0 standing; trunk leans forward to rise. */
  | { kind: 'sit_to_stand_lateral'; side: Side; kneeFlexion: number; trunkLean?: number }
  /** Double-leg squat seen from the front. depth = hip descent as a fraction of leg length; valgus = FPPA (deg), + = knee toward midline. */
  | { kind: 'squat_anterior'; depth: number; valgusLeft?: number; valgusRight?: number };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

const rad = (d: number) => (d * Math.PI) / 180;

interface P {
  x: number;
  y: number;
}

/**
 * Produces a PHYSICALLY POSSIBLE skeleton. The geometry below is built facing image-left (standing /
 * sitting) or head at image-left (lying on the back). Those layouts only show one real side:
 *   - standing/sitting facing image-left shows the LEFT side to the camera;
 *   - lying on the back with the head at image-left shows the RIGHT side.
 * The other side is produced by mirroring the image horizontally (labels unchanged), exactly as a
 * real patient would turn around. A real pose model labels sides from anatomy, so a scene that
 * violates this would be read as the opposite side.
 */
export function synthesize(scene: SynthScene, opts: SynthOptions = {}): Landmark[] {
  const lms = synthesizeRaw(scene, opts);
  deriveMinorLandmarks(lms);
  if (needsMirror(scene)) for (const l of lms) l.x = 1 - l.x;
  return lms;
}

/**
 * The scenes place the major joints; the minor points (hand, mouth, inner/outer eye) are derived
 * from them so no landmark is left at a meaningless default (the image centre) — a rule reading
 * the hands must see hands where the wrists are.
 */
function deriveMinorLandmarks(l: Landmark[]) {
  const along = (from: Landmark, to: Landmark, k: number, dx = 0, dy = 0): Landmark => ({ x: to.x + (to.x - from.x) * k + dx, y: to.y + (to.y - from.y) * k + dy, z: to.z, visibility: to.visibility * 0.95 });
  for (const [el, wr, pinky, index, thumb] of [
    [LM.leftElbow, LM.leftWrist, LM.leftPinky, LM.leftIndex, LM.leftThumb],
    [LM.rightElbow, LM.rightWrist, LM.rightPinky, LM.rightIndex, LM.rightThumb],
  ]) {
    l[pinky] = along(l[el], l[wr], 0.25, 0.004, 0);
    l[index] = along(l[el], l[wr], 0.28, -0.004, 0);
    l[thumb] = along(l[el], l[wr], 0.15, 0, -0.004);
  }
  const n = l[LM.nose];
  l[LM.mouthLeft] = { ...n, x: n.x + 0.01, y: n.y + 0.012 };
  l[LM.mouthRight] = { ...n, x: n.x - 0.01, y: n.y + 0.012 };
  for (const [eye, inner, outer, s] of [[LM.leftEye, LM.leftEyeInner, LM.leftEyeOuter, 1], [LM.rightEye, LM.rightEyeInner, LM.rightEyeOuter, -1]] as const) {
    l[inner] = { ...l[eye], x: l[eye].x - s * 0.006 };
    l[outer] = { ...l[eye], x: l[eye].x + s * 0.006 };
  }
}

function needsMirror(scene: SynthScene): boolean {
  switch (scene.kind) {
    case 'standing_lateral':
    case 'sit_to_stand_lateral':
    case 'lunge_lateral':
      return scene.side === 'right';
    case 'supine_lateral':
    case 'supine_heel_slide':
      return scene.side === 'left';
    default:
      return false;
  }
}

function synthesizeRaw(scene: SynthScene, opts: SynthOptions = {}): Landmark[] {
  const W = opts.width ?? 720;
  const H = opts.height ?? 1280;
  const noise = opts.noisePx ?? 0;
  const r = rng(opts.seed ?? 7);
  const nearV = opts.nearVisibility ?? 0.97;
  const farV = opts.farVisibility ?? 0.75;
  const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const set = (i: number, p: P, z: number, v: number) => {
    lm[i] = { x: (p.x + r() * noise) / W, y: (p.y + r() * noise) / H, z, visibility: v };
  };

  if (scene.kind === 'standing_anterior') {
    const s = scene.scale ?? 1;
    const cx = W / 2 + (scene.offsetX ?? 0) * W;
    const shTilt = rad(scene.shoulderTiltDeg ?? 0);
    const pvTilt = rad(scene.pelvicTiltDeg ?? 0);
    const hipY = H * 0.52;
    const halfSh = 0.13 * H * s * 0.62;
    const halfHip = 0.07 * H * s * 0.62;
    // Patient's LEFT appears on the image RIGHT (facing the camera, un-mirrored).
    // Positive tilt raises the patient's left side.
    set(LM.leftShoulder, { x: cx + halfSh, y: hipY - 0.28 * H * s - Math.sin(shTilt) * halfSh }, 0, 0.98);
    set(LM.rightShoulder, { x: cx - halfSh, y: hipY - 0.28 * H * s + Math.sin(shTilt) * halfSh }, 0, 0.98);
    set(LM.leftHip, { x: cx + halfHip, y: hipY - Math.sin(pvTilt) * halfHip }, 0, 0.97);
    set(LM.rightHip, { x: cx - halfHip, y: hipY + Math.sin(pvTilt) * halfHip }, 0, 0.97);
    set(LM.nose, { x: cx, y: hipY - 0.38 * H * s }, -0.2, 0.99);
    set(LM.leftEar, { x: cx + 0.035 * H * s, y: hipY - 0.37 * H * s }, 0, 0.9);
    set(LM.rightEar, { x: cx - 0.035 * H * s, y: hipY - 0.37 * H * s }, 0, 0.9);
    set(LM.leftEye, { x: cx + 0.02 * H * s, y: hipY - 0.385 * H * s }, -0.1, 0.95);
    set(LM.rightEye, { x: cx - 0.02 * H * s, y: hipY - 0.385 * H * s }, -0.1, 0.95);
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const hipX = cx + sign * halfHip;
      const L = side === 'left';
      const hipYs = hipY - (L ? 1 : -1) * Math.sin(pvTilt) * halfHip;
      const abd = scene.legSide === side ? rad(scene.hipAbduction ?? 0) : 0;
      const dir = { x: sign * Math.sin(abd), y: Math.cos(abd) };
      const lift = scene.footLift?.side === side ? scene.footLift.height * 0.4 * H * s : 0;
      const knee = { x: hipX + dir.x * 0.2 * H * s, y: hipYs + dir.y * 0.2 * H * s - lift * 0.5 };
      const ankle = { x: hipX + dir.x * 0.4 * H * s, y: hipYs + dir.y * 0.4 * H * s - lift };
      set(L ? LM.leftKnee : LM.rightKnee, knee, 0, 0.96);
      set(L ? LM.leftAnkle : LM.rightAnkle, ankle, 0, 0.94);
      set(L ? LM.leftHeel : LM.rightHeel, { x: ankle.x, y: ankle.y + 0.02 * H * s }, 0, 0.9);
      set(L ? LM.leftFootIndex : LM.rightFootIndex, { x: ankle.x + sign * 10, y: ankle.y + 0.03 * H * s }, -0.1, 0.9);
      const shX = cx + sign * halfSh;
      if (scene.handsInFront) {
        // Holding something (e.g. a phone) in front of the belly with both hands.
        set(L ? LM.leftElbow : LM.rightElbow, { x: shX + sign * 6, y: hipY - 0.1 * H * s }, 0, 0.95);
        set(L ? LM.leftWrist : LM.rightWrist, { x: cx + sign * 0.05 * H * s, y: hipY - 0.08 * H * s }, -0.2, 0.93);
      } else if (scene.armSide === side && scene.shoulderAbduction !== undefined) {
        const a = rad(scene.shoulderAbduction);
        const shY = hipY - 0.28 * H * s + (side === 'left' ? -1 : 1) * Math.sin(shTilt) * halfSh;
        const upper = 0.15 * H * s;
        const forearm = 0.14 * H * s;
        const direction = { x: sign * Math.sin(a), y: Math.cos(a) };
        set(L ? LM.leftElbow : LM.rightElbow, { x: shX + direction.x * upper, y: shY + direction.y * upper }, 0, 0.95);
        set(L ? LM.leftWrist : LM.rightWrist, { x: shX + direction.x * (upper + forearm), y: shY + direction.y * (upper + forearm) }, 0, 0.93);
      } else {
        set(L ? LM.leftElbow : LM.rightElbow, { x: shX + sign * 12, y: hipY - 0.12 * H * s }, 0, 0.95);
        set(L ? LM.leftWrist : LM.rightWrist, { x: shX + sign * 16, y: hipY + 0.02 * H * s }, 0, 0.93);
      }
    }
    if (scene.trunkSideBend) {
      // Rotate the upper body about the mid-hip; + moves the head toward image +x (patient's left).
      const d = rad(scene.trunkSideBend);
      const mx = cx / W;
      const my = hipY / H;
      for (const i of [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist, LM.nose, LM.leftEar, LM.rightEar, LM.leftEye, LM.rightEye]) {
        const dx = (lm[i].x - mx) * W;
        const dy = (lm[i].y - my) * H;
        lm[i] = { ...lm[i], x: mx + (dx * Math.cos(d) - dy * Math.sin(d)) / W, y: my + (dx * Math.sin(d) + dy * Math.cos(d)) / H };
      }
    }
    return lm;
  }

  if (scene.kind === 'lunge_lateral') {
    const side = scene.side;
    const near = (l: number, rr: number) => (side === 'left' ? l : rr);
    const far = (l: number, rr: number) => (side === 'left' ? rr : l);
    const sc = scene.scale ?? 1;
    const fwd = -1;
    const shin = 0.22 * H * sc;
    const thigh = 0.22 * H * sc;
    const torso = 0.28 * H * sc;
    const b = rad(scene.shankTilt);
    const ankle: P = { x: W * 0.4, y: H * 0.88 };
    const knee: P = { x: ankle.x + fwd * Math.sin(b) * shin, y: ankle.y - Math.cos(b) * shin };
    const g = rad(25);
    const hip: P = { x: knee.x - fwd * Math.sin(g) * thigh, y: knee.y - Math.cos(g) * thigh };
    const sh: P = { x: hip.x + fwd * 10, y: hip.y - torso };
    const farAnkle: P = { x: ankle.x - fwd * 0.2 * H * sc, y: ankle.y };
    const farKnee: P = { x: (hip.x + farAnkle.x) / 2 - fwd * 10, y: (hip.y + farAnkle.y) / 2 + 20 };
    const put = (l: number, rr: number, pn: P, pf: P) => {
      set(near(l, rr), pn, -0.15, nearV);
      set(far(l, rr), pf, 0.15, farV);
    };
    put(LM.leftAnkle, LM.rightAnkle, ankle, farAnkle);
    put(LM.leftKnee, LM.rightKnee, knee, farKnee);
    put(LM.leftHip, LM.rightHip, hip, { x: hip.x + 4, y: hip.y });
    put(LM.leftHeel, LM.rightHeel, { x: ankle.x - fwd * 8, y: ankle.y + 10 }, { x: farAnkle.x - fwd * 8, y: farAnkle.y + 4 });
    put(LM.leftFootIndex, LM.rightFootIndex, { x: ankle.x + fwd * 40, y: ankle.y + 14 }, { x: farAnkle.x + fwd * 40, y: farAnkle.y + 14 });
    put(LM.leftShoulder, LM.rightShoulder, sh, { x: sh.x + 4, y: sh.y });
    // Hands on the wall in front.
    put(LM.leftElbow, LM.rightElbow, { x: sh.x + fwd * 0.1 * H * sc, y: sh.y + 0.08 * H * sc }, { x: sh.x + fwd * 0.1 * H * sc + 4, y: sh.y + 0.08 * H * sc });
    put(LM.leftWrist, LM.rightWrist, { x: sh.x + fwd * 0.22 * H * sc, y: sh.y + 0.04 * H * sc }, { x: sh.x + fwd * 0.22 * H * sc + 4, y: sh.y + 0.04 * H * sc });
    const ear: P = { x: sh.x + fwd * 6, y: sh.y - 0.07 * H * sc };
    put(LM.leftEar, LM.rightEar, ear, { x: ear.x + 4, y: ear.y });
    put(LM.leftEye, LM.rightEye, { x: ear.x + fwd * 30, y: ear.y - 6 }, { x: ear.x + fwd * 30 + 4, y: ear.y - 6 });
    set(LM.nose, { x: ear.x + fwd * 45, y: ear.y + 4 }, -0.1, 0.95);
    return lm;
  }

  if (scene.kind === 'squat_anterior') {
    const cx = W / 2;
    const ankleY = H * 0.9;
    const leg = 0.4 * H;
    const halfHip = 0.045 * H;
    const hipY = ankleY - leg + scene.depth * leg;
    const drop = hipY - (ankleY - leg);
    const shY = hipY - 0.28 * H;
    set(LM.nose, { x: cx, y: shY - 0.1 * H }, -0.2, 0.99);
    set(LM.leftEar, { x: cx + 0.035 * H, y: shY - 0.09 * H }, 0, 0.9);
    set(LM.rightEar, { x: cx - 0.035 * H, y: shY - 0.09 * H }, 0, 0.9);
    set(LM.leftEye, { x: cx + 0.02 * H, y: shY - 0.105 * H }, -0.1, 0.95);
    set(LM.rightEye, { x: cx - 0.02 * H, y: shY - 0.105 * H }, -0.1, 0.95);
    for (const [sd, sign] of [['left', 1], ['right', -1]] as const) {
      const L = sd === 'left';
      const x = cx + sign * halfHip;
      const hip = { x, y: hipY };
      const ankle = { x, y: ankleY };
      // Knee halfway between hip and ankle, displaced toward the midline to produce the FPPA.
      const half = (ankleY - hipY) / 2;
      const fppa = rad((L ? scene.valgusLeft : scene.valgusRight) ?? 0);
      const e = half * Math.tan(fppa / 2);
      const knee = { x: x - sign * e, y: hipY + half };
      set(L ? LM.leftHip : LM.rightHip, hip, 0, 0.97);
      set(L ? LM.leftKnee : LM.rightKnee, knee, -0.1 - drop / H, 0.95);
      set(L ? LM.leftAnkle : LM.rightAnkle, ankle, 0, 0.94);
      set(L ? LM.leftHeel : LM.rightHeel, { x, y: ankleY + 0.02 * H }, 0, 0.9);
      set(L ? LM.leftFootIndex : LM.rightFootIndex, { x: x + sign * 8, y: ankleY + 0.03 * H }, -0.1, 0.9);
      const shX = cx + sign * 0.08 * H;
      set(L ? LM.leftShoulder : LM.rightShoulder, { x: shX, y: shY }, 0, 0.98);
      set(L ? LM.leftElbow : LM.rightElbow, { x: shX + sign * 6, y: shY + 0.1 * H }, -0.2, 0.92);
      set(L ? LM.leftWrist : LM.rightWrist, { x: shX - sign * 20, y: shY + 0.14 * H }, -0.3, 0.9);
    }
    return lm;
  }

  const side = scene.side;
  // The patient faces image-left; the near side (exercised side) gets smaller z.
  const fwd = -1;
  const near = (l: number, rr: number) => (side === 'left' ? l : rr);
  const far = (l: number, rr: number) => (side === 'left' ? rr : l);
  const pair = (l: number, rr: number, p: P, farP: P = p) => {
    set(near(l, rr), p, -0.15, nearV);
    set(far(l, rr), { x: farP.x + 4, y: farP.y }, 0.15, farV);
  };

  if (scene.kind === 'supine_heel_slide') {
    const baseY = H * 0.62;
    const L = 0.2 * W * 1.6 * 0.6;
    const hip: P = { x: W * 0.2 + 0.25 * W * 1.6 * 0.62, y: baseY };
    const theta = rad(180 - scene.kneeFlexion); // interior knee angle
    const span = 2 * L * Math.sin(theta / 2);
    const ankle: P = { x: hip.x + span, y: baseY };
    const knee: P = { x: hip.x + span / 2, y: baseY - L * Math.cos(theta / 2) };
    const sh: P = { x: W * 0.2, y: baseY };
    const farKnee: P = { x: hip.x + L, y: baseY };
    const farAnkle: P = { x: hip.x + 2 * L, y: baseY };
    pair(LM.leftShoulder, LM.rightShoulder, sh);
    pair(LM.leftHip, LM.rightHip, hip);
    pair(LM.leftKnee, LM.rightKnee, knee, farKnee);
    pair(LM.leftAnkle, LM.rightAnkle, ankle, farAnkle);
    pair(LM.leftHeel, LM.rightHeel, { x: ankle.x + 6, y: ankle.y + 6 }, { x: farAnkle.x + 6, y: farAnkle.y + 6 });
    pair(LM.leftFootIndex, LM.rightFootIndex, { x: ankle.x + 12, y: ankle.y - 30 }, { x: farAnkle.x + 12, y: farAnkle.y - 30 });
    pair(LM.leftElbow, LM.rightElbow, { x: sh.x + 90, y: baseY + 4 });
    pair(LM.leftWrist, LM.rightWrist, { x: sh.x + 170, y: baseY + 6 });
    // Lying on the back: the face points at the ceiling (nose straight "up" from the ears).
    pair(LM.leftEar, LM.rightEar, { x: sh.x - 70, y: baseY - 10 });
    pair(LM.leftEye, LM.rightEye, { x: sh.x - 74, y: baseY - 30 });
    set(LM.nose, { x: sh.x - 76, y: baseY - 40 }, -0.1, 0.95);
    return lm;
  }

  if (scene.kind === 'sit_to_stand_lateral') {
    const Ls = 0.22 * H;
    const Lt = 0.22 * H;
    const torso = 0.28 * H;
    const f = rad(scene.kneeFlexion);
    const alpha = f * 0.2; // shank tilts slightly forward as the knee bends
    const ankle: P = { x: W * 0.46, y: H * 0.9 };
    const us = { x: fwd * Math.sin(alpha), y: -Math.cos(alpha) };
    const knee: P = { x: ankle.x + Ls * us.x, y: ankle.y + Ls * us.y };
    const ut = { x: fwd * Math.sin(alpha - f), y: -Math.cos(alpha - f) };
    const hip: P = { x: knee.x + Lt * ut.x, y: knee.y + Lt * ut.y };
    const lean = rad(scene.trunkLean ?? 5);
    const sh: P = { x: hip.x + fwd * Math.sin(lean) * torso, y: hip.y - Math.cos(lean) * torso };
    pair(LM.leftAnkle, LM.rightAnkle, ankle);
    pair(LM.leftKnee, LM.rightKnee, knee);
    pair(LM.leftHip, LM.rightHip, hip);
    pair(LM.leftShoulder, LM.rightShoulder, sh);
    pair(LM.leftHeel, LM.rightHeel, { x: ankle.x - fwd * 8, y: ankle.y + 10 });
    pair(LM.leftFootIndex, LM.rightFootIndex, { x: ankle.x + fwd * 40, y: ankle.y + 14 });
    // Arms crossed over the chest (per protocol).
    pair(LM.leftElbow, LM.rightElbow, { x: sh.x + fwd * 30, y: sh.y + 0.08 * H });
    pair(LM.leftWrist, LM.rightWrist, { x: sh.x + fwd * 10, y: sh.y + 0.03 * H });
    const ear: P = { x: sh.x + fwd * (6 + Math.sin(lean) * 40), y: sh.y - 0.07 * H };
    pair(LM.leftEar, LM.rightEar, ear);
    pair(LM.leftEye, LM.rightEye, { x: ear.x + fwd * 30, y: ear.y - 6 });
    set(LM.nose, { x: ear.x + fwd * 45, y: ear.y + 4 }, -0.1, 0.95);
    return lm;
  }

  if (scene.kind === 'standing_lateral') {
    const cx = W * 0.5;
    const ankleY = H * 0.88;
    // scale < 1 = standing further back (the figure shrinks toward the floor line, leaving headroom).
    const sc = scene.scale ?? 1;
    const shin = 0.22 * H * sc;
    const thigh = 0.22 * H * sc;
    const torso = 0.28 * H * sc;
    const lean = rad(scene.trunkLean ?? 0);
    const kneeFlex = rad(scene.kneeFlexion ?? 0);
    const shFlex = rad(scene.shoulderFlexion ?? 0);
    // Stance leg (far side) straight; the exercised (near) leg performs knee flexion.
    const hipFlex = rad(scene.hipFlexion ?? 0);
    const hip: P = { x: cx, y: ankleY - shin - thigh };
    const knee: P = { x: hip.x + fwd * Math.sin(hipFlex) * thigh, y: hip.y + Math.cos(hipFlex) * thigh };
    const ankle: P = { x: knee.x + fwd * Math.sin(hipFlex - kneeFlex) * shin, y: knee.y + Math.cos(hipFlex - kneeFlex) * shin };
    const farKnee: P = { x: cx, y: hip.y + thigh };
    const farAnkle: P = { x: cx, y: ankleY };
    pair(LM.leftHip, LM.rightHip, hip);
    pair(LM.leftKnee, LM.rightKnee, knee, farKnee);
    pair(LM.leftAnkle, LM.rightAnkle, ankle, farAnkle);
    pair(LM.leftHeel, LM.rightHeel, { x: ankle.x - fwd * 8, y: ankle.y + 10 }, { x: farAnkle.x - fwd * 8, y: farAnkle.y + 10 });
    pair(LM.leftFootIndex, LM.rightFootIndex, { x: ankle.x + fwd * 40, y: ankle.y + 14 }, { x: farAnkle.x + fwd * 40, y: farAnkle.y + 14 });
    const sh: P = { x: hip.x + fwd * Math.sin(lean) * torso, y: hip.y - Math.cos(lean) * torso };
    pair(LM.leftShoulder, LM.rightShoulder, sh);
    const ua = 0.16 * H * sc;
    const fa = 0.14 * H * sc;
    // Arm flexion angle measured from the trunk-down direction, rotating forward.
    const armDir = { x: fwd * Math.sin(shFlex - lean), y: Math.cos(shFlex - lean) };
    const elbow: P = { x: sh.x + armDir.x * ua, y: sh.y + armDir.y * ua };
    const wrist: P = { x: elbow.x + armDir.x * fa, y: elbow.y + armDir.y * fa };
    pair(LM.leftElbow, LM.rightElbow, elbow, { x: sh.x, y: sh.y + ua });
    pair(LM.leftWrist, LM.rightWrist, wrist, { x: sh.x, y: sh.y + ua + fa });
    const neck = rad(scene.neckFlexion ?? 0);
    const headL = 0.07 * H * sc;
    const ear: P = { x: sh.x + fwd * (6 + Math.sin(neck) * headL), y: sh.y - Math.cos(neck) * headL };
    pair(LM.leftEar, LM.rightEar, ear);
    pair(LM.leftEye, LM.rightEye, { x: ear.x + fwd * 30, y: ear.y - 6 + Math.sin(neck) * 12 });
    set(LM.nose, { x: ear.x + fwd * 45, y: ear.y + 4 + Math.sin(neck) * 20 }, -0.1, 0.95);
    if (scene.heelLift) {
      // Both feet rotate about the toes; everything above the feet rises with the ankles.
      const phi = rad(scene.heelLift);
      const toe: P = { x: ankle.x + fwd * 40, y: ankle.y + 14 };
      const rot = (dx: number, dy: number): P => {
        const r = Math.hypot(dx, dy);
        const a0 = Math.atan2(dy, dx);
        return { x: toe.x - fwd * r * Math.cos(a0 + phi), y: toe.y - r * Math.sin(a0 + phi) };
      };
      const newAnkle = rot(40, 14);
      const newHeel = rot(48, 4);
      const dx = (newAnkle.x - ankle.x) / W;
      const dy = (newAnkle.y - ankle.y) / H;
      const feet = new Set<number>([LM.leftFootIndex, LM.rightFootIndex, LM.leftHeel, LM.rightHeel]);
      for (let i = 0; i < lm.length; i++) if (!feet.has(i)) lm[i] = { ...lm[i], x: lm[i].x + dx, y: lm[i].y + dy };
      for (const h of [LM.leftHeel, LM.rightHeel]) lm[h] = { ...lm[h], x: lm[h].x + (newHeel.x - (ankle.x - fwd * 8)) / W, y: lm[h].y + (newHeel.y - (ankle.y + 10)) / H };
    }
    return lm;
  }

  // supine_lateral: lying on the floor, head at image-left, feet at image-right.
  const baseY = H * 0.62;
  const W0 = W * 0.2;
  const torso = 0.25 * W * 1.6;
  const thigh = 0.2 * W * 1.6;
  const shin = 0.2 * W * 1.6;
  const raise = rad(scene.legRaise ?? 0);
  const bend = rad(scene.kneeBend ?? 0);
  const sh: P = { x: W0, y: baseY };
  const hip: P = { x: W0 + torso * 0.62, y: baseY };
  const knee: P = { x: hip.x + Math.cos(raise) * thigh * 0.6, y: hip.y - Math.sin(raise) * thigh * 0.6 };
  const shinAng = raise - bend;
  const ankle: P = { x: knee.x + Math.cos(shinAng) * shin * 0.6, y: knee.y - Math.sin(shinAng) * shin * 0.6 };
  const farKnee: P = { x: hip.x + thigh * 0.6, y: baseY };
  const farAnkle: P = { x: farKnee.x + shin * 0.6, y: baseY };
  pair(LM.leftShoulder, LM.rightShoulder, sh);
  pair(LM.leftHip, LM.rightHip, hip);
  pair(LM.leftKnee, LM.rightKnee, knee, farKnee);
  pair(LM.leftAnkle, LM.rightAnkle, ankle, farAnkle);
  pair(LM.leftHeel, LM.rightHeel, { x: ankle.x + 6, y: ankle.y + 8 }, { x: farAnkle.x + 6, y: farAnkle.y + 8 });
  pair(LM.leftFootIndex, LM.rightFootIndex, { x: ankle.x + 10, y: ankle.y - 30 }, { x: farAnkle.x + 10, y: farAnkle.y - 30 });
  pair(LM.leftElbow, LM.rightElbow, { x: sh.x + 90, y: baseY + 4 });
  pair(LM.leftWrist, LM.rightWrist, { x: sh.x + 170, y: baseY + 6 });
  pair(LM.leftEar, LM.rightEar, { x: sh.x - 70, y: baseY - 10 });
  pair(LM.leftEye, LM.rightEye, { x: sh.x - 74, y: baseY - 30 });
  set(LM.nose, { x: sh.x - 76, y: baseY - 40 }, -0.1, 0.95);
  return lm;
}
