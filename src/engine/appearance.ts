import type { Landmark } from './types';

/**
 * Motion–appearance consistency (Phase 3). The pose model can report a joint it cannot see — an
 * elbow behind a folder, a knee behind a cushion — with high confidence, and the person-mask is
 * fooled too (measured in the tracking lab). A cue independent of the model: when a joint really
 * moves across the image, the pixels at its position change. If the model says the joint moved
 * clearly but the image patch around it stayed still, something static is in front of it.
 *
 * Only a tiny grayscale thumbnail of the previous frame is kept in memory to compare with; no
 * frame is stored or sent anywhere.
 */

/** Thumbnail width used for the comparison (height follows the frame aspect). */
export const PATCH_THUMB_WIDTH = 160;
/** Patch radius in thumbnail pixels (≈ 2% of the frame width each side). */
const PATCH_RADIUS = 3;

export interface Gray {
  data: Uint8Array;
  w: number;
  h: number;
}

/** Grayscale thumbnail of a video frame, canvas or bitmap; null where OffscreenCanvas is unavailable. */
export function grayThumb(source: CanvasImageSource, srcW: number, srcH: number, w = PATCH_THUMB_WIDTH): Gray | null {
  if (typeof OffscreenCanvas === 'undefined' || !srcW || !srcH) return null;
  const h = Math.max(1, Math.round((w * srcH) / srcW));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;
  return { data, w, h };
}

/** Reference frame age for the comparison: long enough for a moving joint to leave its old patch. */
export const REF_MS = 250;
const MAX_HISTORY = 12;

export interface PatchMotionSample {
  /** Per landmark: grey-level change at the landmark's CURRENT position between the reference frame and now, minus the frame-wide change. NaN = off the thumbnail. */
  values: number[];
  /** Age of the reference frame (ms). */
  dtMs: number;
}

/**
 * Compares the image at each landmark's current position with the same image position about
 * REF_MS earlier. A joint that really moved there brings its own appearance with it (the earlier
 * image showed background at that spot); a static object covering it looks the same at both times.
 */
export class PatchMotion {
  private hist: { t: number; g: Gray }[] = [];

  reset() {
    this.hist = [];
  }

  sample(cur: Gray | null, pose: { x: number; y: number }[] | undefined, t: number): PatchMotionSample | undefined {
    if (!cur) return undefined;
    const ref = [...this.hist].reverse().find((h) => t - h.t >= REF_MS && h.g.w === cur.w && h.g.h === cur.h);
    this.hist.push({ t, g: cur });
    while (this.hist.length > MAX_HISTORY || (this.hist.length > 2 && t - this.hist[1].t > 3 * REF_MS)) this.hist.shift();
    if (!ref || !pose) return undefined;
    const prev = ref.g;
    // Frame-wide change: median absolute difference on a coarse grid (noise, exposure drift).
    const grid: number[] = [];
    for (let y = 2; y < cur.h; y += 6) for (let x = 2; x < cur.w; x += 6) grid.push(Math.abs(cur.data[y * cur.w + x] - prev.data[y * cur.w + x]));
    grid.sort((a, b) => a - b);
    const noise = grid.length ? grid[Math.floor(grid.length / 2)] : 0;
    const values = pose.map((l) => {
      const cx = Math.round(l.x * cur.w);
      const cy = Math.round(l.y * cur.h);
      if (cx < 0 || cy < 0 || cx >= cur.w || cy >= cur.h) return NaN;
      let sum = 0;
      let n = 0;
      for (let y = Math.max(0, cy - PATCH_RADIUS); y <= Math.min(cur.h - 1, cy + PATCH_RADIUS); y++) {
        for (let x = Math.max(0, cx - PATCH_RADIUS); x <= Math.min(cur.w - 1, cx + PATCH_RADIUS); x++) {
          sum += Math.abs(cur.data[y * cur.w + x] - prev.data[y * cur.w + x]);
          n++;
        }
      }
      return Math.round((sum / n - noise) * 10) / 10;
    });
    return { values, dtMs: t - ref.t };
  }
}

/**
 * Evidence requires the joint to have moved farther than the patch itself over the reference
 * interval (so landmark jitter never counts as movement): patch diameter in thumbnail pixels,
 * scaled to the frame, times a margin.
 */
const MOVE_PATCHES = 1.5;
/** Patch change (grey levels above frame-wide change) below this counts as "the image did not change". */
export const STATIC_LEVEL = 3;
const HISTORY = 6;
const COVER_VOTES = 4;

/**
 * Decides which landmarks are covered by a static object, from clearly moving joints only. A
 * still joint gives no evidence either way, so the last decision is held until it moves again.
 */
export class CoverageDetector {
  private track: { t: number; lms: Landmark[] }[] = [];
  private votes: boolean[][] = [];

  reset() {
    this.track = [];
    this.votes = [];
  }

  /** Returns the indices currently judged covered. `motion` comes from PatchMotion (undefined = no evidence). */
  update(lms: Landmark[] | null, t: number, width: number, height: number, motion: PatchMotionSample | undefined): number[] {
    if (!lms) {
      this.reset();
      return [];
    }
    this.track.push({ t, lms });
    while (this.track.length > 2 && t - this.track[0].t > 4 * REF_MS) this.track.shift();
    if (!motion) return this.current();
    // Landmark positions at the reference frame's time (closest earlier sample).
    const refT = t - motion.dtMs;
    const ref = [...this.track].reverse().find((s) => s.t <= refT + 20);
    if (!ref) return this.current();
    const minMove = (((2 * PATCH_RADIUS + 1) / PATCH_THUMB_WIDTH) * width) * MOVE_PATCHES;
    for (let i = 0; i < lms.length; i++) {
      const v = motion.values[i];
      if (!Number.isFinite(v)) continue;
      const d = Math.hypot((lms[i].x - ref.lms[i].x) * width, (lms[i].y - ref.lms[i].y) * height);
      if (d < minMove) continue;
      const votes = (this.votes[i] ??= []);
      votes.push(v < STATIC_LEVEL);
      if (votes.length > HISTORY) votes.shift();
    }
    return this.current();
  }

  private current(): number[] {
    const out: number[] = [];
    this.votes.forEach((v, i) => {
      if (v && v.filter(Boolean).length >= COVER_VOTES) out.push(i);
    });
    return out;
  }
}
