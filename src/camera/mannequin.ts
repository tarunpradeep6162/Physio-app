import { LM } from '../engine/landmarks';
import type { Landmark } from '../engine/types';

/**
 * Renders a synthetic ground-truth skeleton as a simple shaded human figure so the REAL pose
 * model can be exercised on reproducible imagery with known joint positions.
 *
 * This is test imagery, not a human participant: results obtained with it describe how the
 * pipeline behaves (jitter, lag, dropout, occlusion handling) — never clinical accuracy.
 * Joint centres are drawn exactly at the ground-truth landmarks; how a pose model places joints
 * inside a cartoon limb differs from a real body, so absolute offsets are not accuracy figures.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Figure {
  lms: Landmark[];
  skin?: string;
  shirt?: string;
  pants?: string;
}

export interface RenderOptions {
  /** Multiplies pixel intensity (1 = normal, 0.25 = dim room). */
  brightness?: number;
  /** Sensor-noise standard deviation in 8-bit levels (applied after brightness). */
  noise?: number;
  /** Opaque objects drawn over the figures, in normalised coordinates (e.g. a phone). */
  occluders?: Rect[];
  /** Flip the whole image horizontally (a mirrored camera stream). */
  mirror?: boolean;
  /** Draw a chair under the hips (sit-to-stand). */
  chair?: { x: number; y: number } | null;
  /** Draw a floor mat (supine tests). */
  mat?: boolean;
  seed?: number;
}

export const SKIN_TONES = ['#f1d3bd', '#e2b594', '#c68e6a', '#a86f4c', '#7a4a30', '#4a2b1c'];

type P = [number, number];

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

export function renderFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, figures: Figure[], o: RenderOptions = {}) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  if (o.mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#cdc8bf');
  bg.addColorStop(0.72, '#aca395');
  bg.addColorStop(1, '#6e655a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // A little background structure (door frame, skirting) so the scene is not a flat field.
  ctx.fillStyle = '#b7ad9f';
  ctx.fillRect(W * 0.78, H * 0.18, W * 0.16, H * 0.55);
  ctx.fillStyle = '#8f8576';
  ctx.fillRect(0, H * 0.72, W, H * 0.012);
  if (o.mat) {
    ctx.fillStyle = '#3f6f63';
    ctx.fillRect(W * 0.04, H * 0.63, W * 0.92, H * 0.03);
  }
  if (o.chair) {
    const cx = o.chair.x * W;
    const cy = o.chair.y * H;
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(cx - W * 0.1, cy, W * 0.22, H * 0.018);
    ctx.fillRect(cx - W * 0.09, cy, W * 0.02, H * 0.9 - cy);
    ctx.fillRect(cx + W * 0.09, cy, W * 0.02, H * 0.9 - cy);
    ctx.fillRect(cx + W * 0.1, cy - H * 0.22, W * 0.02, H * 0.22);
  }
  for (const f of figures) drawFigure(ctx, f, W, H);
  for (const r of o.occluders ?? []) {
    // A phone held up in front of the body: dark body, bright screen.
    ctx.fillStyle = '#16181c';
    roundRect(ctx, r.x * W, r.y * H, r.w * W, r.h * H, Math.min(r.w * W, r.h * H) * 0.12);
    ctx.fillStyle = '#9fb6d8';
    roundRect(ctx, r.x * W + r.w * W * 0.07, r.y * H + r.h * H * 0.06, r.w * W * 0.86, r.h * H * 0.88, 6);
  }
  ctx.restore();

  applyExposure(ctx, o.brightness ?? 1, o.noise ?? 0, o.seed ?? 1);
}

/** Scales intensity and adds luma sensor noise to what is already on the canvas. */
export function applyExposure(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, brightness: number, noise: number, seed = 1) {
  if (brightness === 1 && noise <= 0) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
  for (let i = 0; i < d.length; i += 4) {
    // Approximately Gaussian (sum of uniforms), shared across channels like luma noise.
    const n = noise ? (rnd() + rnd() + rnd() - 1.5) * 2 * noise : 0;
    d[i] = d[i] * brightness + n;
    d[i + 1] = d[i + 1] * brightness + n;
    d[i + 2] = d[i + 2] * brightness + n;
  }
  ctx.putImageData(img, 0, 0);
}

function roundRect(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function drawFigure(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, f: Figure, W: number, H: number) {
  const L = f.lms;
  const p = (i: number): P => [L[i].x * W, L[i].y * H];
  const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const skin = f.skin ?? SKIN_TONES[2];
  const shirt = f.shirt ?? '#2f5d8a';
  const pants = f.pants ?? '#333a44';

  const shMid = mid(p(LM.leftShoulder), p(LM.rightShoulder));
  const hipMid = mid(p(LM.leftHip), p(LM.rightHip));
  const torsoLen = Math.max(40, dist(shMid, hipMid));
  const shoulderSpan = dist(p(LM.leftShoulder), p(LM.rightShoulder));
  const frontal = shoulderSpan > torsoLen * 0.35;

  const cap = (a: P, b: P, w: number, col: string) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };

  const limbs = (side: 'left' | 'right', k: number) => {
    const I = side === 'left'
      ? { sh: LM.leftShoulder, el: LM.leftElbow, wr: LM.leftWrist, hip: LM.leftHip, kn: LM.leftKnee, an: LM.leftAnkle, heel: LM.leftHeel, toe: LM.leftFootIndex }
      : { sh: LM.rightShoulder, el: LM.rightElbow, wr: LM.rightWrist, hip: LM.rightHip, kn: LM.rightKnee, an: LM.rightAnkle, heel: LM.rightHeel, toe: LM.rightFootIndex };
    const legs = () => {
      cap(p(I.hip), p(I.kn), torsoLen * 0.3, shade(pants, k));
      cap(p(I.kn), p(I.an), torsoLen * 0.22, shade(pants, k));
      cap(p(I.heel), p(I.toe), torsoLen * 0.13, shade('#1a1a1a', k));
      cap(p(I.an), p(I.heel), torsoLen * 0.15, shade('#1a1a1a', k));
    };
    const arms = () => {
      cap(p(I.sh), p(I.el), torsoLen * 0.2, shade(shirt, k));
      cap(p(I.el), p(I.wr), torsoLen * 0.15, shade(skin, k));
      const dir = [p(I.wr)[0] - p(I.el)[0], p(I.wr)[1] - p(I.el)[1]];
      const n = Math.hypot(dir[0], dir[1]) || 1;
      const hand: P = [p(I.wr)[0] + (dir[0] / n) * torsoLen * 0.08, p(I.wr)[1] + (dir[1] / n) * torsoLen * 0.08];
      cap(p(I.wr), hand, torsoLen * 0.14, shade(skin, k));
    };
    return { legs, arms };
  };

  // Near side = smaller z. Draw the far side first, darker.
  const leftZ = (L[LM.leftHip].z + L[LM.leftShoulder].z) / 2;
  const rightZ = (L[LM.rightHip].z + L[LM.rightShoulder].z) / 2;
  const far = frontal ? null : leftZ > rightZ ? 'left' : 'right';
  const near = far === 'left' ? 'right' : 'left';

  if (far) {
    const fl = limbs(far, 0.72);
    fl.arms();
    fl.legs();
  }
  // Torso.
  if (frontal) {
    const ls = p(LM.leftShoulder);
    const rs = p(LM.rightShoulder);
    const lh = p(LM.leftHip);
    const rh = p(LM.rightHip);
    const ox = (a: P, b: P, amt: number): P => {
      const d = [a[0] - b[0], a[1] - b[1]];
      const n = Math.hypot(d[0], d[1]) || 1;
      return [a[0] + (d[0] / n) * amt, a[1] + (d[1] / n) * amt];
    };
    ctx.fillStyle = shirt;
    ctx.beginPath();
    const a = ox(ls, rs, torsoLen * 0.06);
    const b = ox(rs, ls, torsoLen * 0.06);
    const c = ox(rh, lh, torsoLen * 0.08);
    const d = ox(lh, rh, torsoLen * 0.08);
    ctx.moveTo(a[0], a[1] - torsoLen * 0.04);
    ctx.lineTo(b[0], b[1] - torsoLen * 0.04);
    ctx.lineTo(c[0], c[1] + torsoLen * 0.06);
    ctx.lineTo(d[0], d[1] + torsoLen * 0.06);
    ctx.closePath();
    ctx.fill();
    const lf = limbs('left', 1);
    const rf = limbs('right', 1);
    lf.legs();
    rf.legs();
    // Re-draw the pelvis band over the thighs so hips read as one body.
    ctx.fillStyle = pants;
    ctx.beginPath();
    ctx.moveTo(d[0], d[1] - torsoLen * 0.1);
    ctx.lineTo(c[0], c[1] - torsoLen * 0.1);
    ctx.lineTo(c[0], c[1] + torsoLen * 0.08);
    ctx.lineTo(d[0], d[1] + torsoLen * 0.08);
    ctx.closePath();
    ctx.fill();
    lf.arms();
    rf.arms();
  } else {
    cap(shMid, hipMid, torsoLen * 0.42, shirt);
    const nl = limbs(near, 1);
    nl.legs();
    cap(hipMid, [hipMid[0] + (shMid[0] - hipMid[0]) * 0.15, hipMid[1] + (shMid[1] - hipMid[1]) * 0.15], torsoLen * 0.4, pants);
    nl.arms();
  }

  // Neck + head.
  const nose = p(LM.nose);
  const earMid = mid(p(LM.leftEar), p(LM.rightEar));
  const headR = torsoLen * 0.2;
  const headC: P = frontal ? [earMid[0], earMid[1] - headR * 0.1] : [earMid[0] + (nose[0] - earMid[0]) * 0.35, earMid[1] - headR * 0.1];
  cap(shMid, headC, torsoLen * 0.16, skin);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(headC[0], headC[1], headR * 0.82, headR, 0, 0, Math.PI * 2);
  ctx.fill();
  // Hair on the crown / back of the head.
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  if (frontal) ctx.ellipse(headC[0], headC[1] - headR * 0.55, headR * 0.84, headR * 0.5, 0, Math.PI, 0);
  else {
    const back = nose[0] > earMid[0] ? -1 : 1;
    ctx.ellipse(headC[0] + back * headR * 0.25, headC[1] - headR * 0.35, headR * 0.7, headR * 0.7, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  if (frontal) {
    const facing = L[LM.leftShoulder].x > L[LM.rightShoulder].x;
    if (facing) {
      for (const e of [p(LM.leftEye), p(LM.rightEye)]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(e[0], e[1], headR * 0.16, headR * 0.1, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(e[0], e[1], headR * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = shade(skin, 0.7);
      ctx.lineWidth = Math.max(2, headR * 0.05);
      ctx.beginPath();
      ctx.moveTo(nose[0], nose[1] - headR * 0.25);
      ctx.lineTo(nose[0] - headR * 0.06, nose[1]);
      ctx.lineTo(nose[0] + headR * 0.06, nose[1] + headR * 0.03);
      ctx.stroke();
      ctx.strokeStyle = '#7a3030';
      ctx.beginPath();
      ctx.moveTo(nose[0] - headR * 0.22, nose[1] + headR * 0.35);
      ctx.quadraticCurveTo(nose[0], nose[1] + headR * 0.45, nose[0] + headR * 0.22, nose[1] + headR * 0.35);
      ctx.stroke();
    } else {
      // Seen from behind: hair covers the head.
      ctx.fillStyle = '#2a1a10';
      ctx.beginPath();
      ctx.ellipse(headC[0], headC[1] - headR * 0.1, headR * 0.8, headR * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Profile: nose bump and one eye.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(nose[0], nose[1], headR * 0.18, headR * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    const eye = L[LM.leftEye].z < L[LM.rightEye].z ? p(LM.leftEye) : p(LM.rightEye);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(eye[0], eye[1], headR * 0.1, headR * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(eye[0], eye[1], headR * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
}
