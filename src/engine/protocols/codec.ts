import { LANDMARK_COUNT, LM } from '../landmarks';
import type { Landmark } from '../types';

/**
 * Compact landmark-only storage for dynamic replay (no raw video is kept).
 *
 * 19 joints × (x, y, visibility) quantised to uint16 and base64-encoded: ~120 bytes per frame,
 * ≈ 30 kB for a 25 s capture at 10 Hz. Quantisation error is ≤ 3e-5 of the frame (well below
 * a pixel), so replayed angles match the stored measurement calculation.
 */

export const REPLAY_JOINTS: number[] = [
  LM.nose,
  LM.leftEar,
  LM.rightEar,
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftHeel,
  LM.rightHeel,
  LM.leftFootIndex,
  LM.rightFootIndex,
];

export interface EncodedFrames {
  codec: 'pv-lm16-v1';
  joints: number[];
  /** Milliseconds relative to the first frame. */
  times: number[];
  /** base64(Uint16Array little-endian); 0xFFFF marks a frame with no valid pose. */
  data: string;
}

const NULL = 0xffff;
const Q = 65534;
const qXY = (v: number) => Math.max(0, Math.min(Q, Math.round(((v + 0.5) / 2) * Q)));
const dXY = (q: number) => (q / Q) * 2 - 0.5;
const qV = (v: number) => Math.max(0, Math.min(Q, Math.round(v * Q)));

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeFrames(frames: { t: number; lms: Landmark[] | null }[], joints = REPLAY_JOINTS): EncodedFrames {
  const per = joints.length * 3;
  const arr = new Uint16Array(frames.length * per);
  const t0 = frames[0]?.t ?? 0;
  frames.forEach((f, fi) => {
    const o = fi * per;
    if (!f.lms) {
      arr.fill(NULL, o, o + per);
      return;
    }
    joints.forEach((j, ji) => {
      const l = f.lms![j];
      arr[o + ji * 3] = qXY(l.x);
      arr[o + ji * 3 + 1] = qXY(l.y);
      arr[o + ji * 3 + 2] = qV(l.visibility);
    });
  });
  const bytes = new Uint8Array(arr.buffer);
  return { codec: 'pv-lm16-v1', joints, times: frames.map((f) => Math.round(f.t - t0)), data: toBase64(bytes) };
}

export function decodeFrames(enc: EncodedFrames): { t: number; lms: Landmark[] | null }[] {
  const bytes = fromBase64(enc.data);
  const arr = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const per = enc.joints.length * 3;
  return enc.times.map((t, fi) => {
    const o = fi * per;
    if (arr[o] === NULL && arr[o + 1] === NULL) return { t, lms: null };
    const lms: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    enc.joints.forEach((j, ji) => {
      lms[j] = { x: dXY(arr[o + ji * 3]), y: dXY(arr[o + ji * 3 + 1]), z: 0, visibility: arr[o + ji * 3 + 2] / Q };
    });
    return { t, lms };
  });
}

/** Rounded copy for keyframes stored as plain JSON. */
export function compactLandmarks(lms: Landmark[]): Landmark[] {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return lms.map((l) => ({ x: r(l.x), y: r(l.y), z: r(l.z), visibility: Math.round(l.visibility * 1000) / 1000 }));
}
