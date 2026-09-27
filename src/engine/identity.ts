import { LM } from './landmarks';
import type { Landmark } from './types';

/**
 * Subject-identity and label-continuity guard (runs on RAW model landmarks, before smoothing).
 *
 * The pose model tracks "a person", not "the patient". It can jump to a bystander, re-detect a
 * different person after someone steps out, or swap left/right limb labels when the legs overlap
 * in a side view. None of these may be bridged by guessing: the guard reports an event, the
 * pipeline resets its filters and withholds measurement until the pose has been stable again.
 * No landmark is ever invented or re-labelled here.
 */

export type IdentityEvent = 'acquired' | 'reacquired' | 'identity_change' | 'limb_swap';

export interface IdentityResult {
  event: IdentityEvent | null;
  /** Human-readable detail for diagnostics. */
  detail?: string;
}

/** Body-centre speed above this (torso lengths per second, ≈2.5 m/s) is not the same person moving in these tests (STS rise ≈1/s). */
export const MAX_CENTRE_SPEED = 5;
/** Relative change in torso length within `SCALE_WINDOW_MS` treated as a different person / glitch. */
export const MAX_SCALE_CHANGE = 0.35;
const SCALE_WINDOW_MS = 400;
/** After a gap longer than this, the next person seen must be re-acquired. */
export const GAP_REACQUIRE_MS = 500;

type P = { x: number; y: number };
const px = (l: Landmark, w: number, h: number): P => ({ x: l.x * w, y: l.y * h });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const PAIRS: [number, number][] = [
  [LM.leftKnee, LM.rightKnee],
  [LM.leftAnkle, LM.rightAnkle],
  [LM.leftHeel, LM.rightHeel],
];

export class IdentityGuard {
  private last: { lms: Landmark[]; t: number; torso: number; centre: P } | null = null;
  private lastSeenT = -Infinity;

  reset() {
    this.last = null;
    this.lastSeenT = -Infinity;
  }

  /** Call for every frame; `lms` is null when no single person is being tracked. */
  update(lms: Landmark[] | null, t: number, w: number, h: number): IdentityResult {
    if (!lms) return { event: null };
    const shoulder = mid(px(lms[LM.leftShoulder], w, h), px(lms[LM.rightShoulder], w, h));
    const hips = mid(px(lms[LM.leftHip], w, h), px(lms[LM.rightHip], w, h));
    const torso = Math.max(1, dist(shoulder, hips));
    const cur = { lms, t, torso, centre: hips };
    const prev = this.last;
    const gap = t - this.lastSeenT;
    this.last = cur;
    this.lastSeenT = t;
    if (!prev) return { event: 'acquired' };
    if (gap > GAP_REACQUIRE_MS) return { event: 'reacquired', detail: `no single person for ${Math.round(gap)} ms` };

    const dt = Math.max(1, t - prev.t) / 1000;
    const speed = dist(cur.centre, prev.centre) / prev.torso / dt;
    if (speed > MAX_CENTRE_SPEED) return { event: 'identity_change', detail: `body centre moved ${speed.toFixed(1)} torso-lengths/s` };
    const scale = Math.abs(torso / prev.torso - 1);
    if (t - prev.t <= SCALE_WINDOW_MS && scale > MAX_SCALE_CHANGE) return { event: 'identity_change', detail: `body size changed ${Math.round(scale * 100)}% in ${Math.round(t - prev.t)} ms` };

    // Left/right label swap: the crossed assignment explains the motion far better than the direct one.
    let direct = 0;
    let crossed = 0;
    for (const [a, b] of PAIRS) {
      const pa = px(prev.lms[a], w, h);
      const pb = px(prev.lms[b], w, h);
      const ca = px(lms[a], w, h);
      const cb = px(lms[b], w, h);
      direct += dist(pa, ca) + dist(pb, cb);
      crossed += dist(pa, cb) + dist(pb, ca);
    }
    if (direct > 0.3 * prev.torso * PAIRS.length && crossed < 0.5 * direct) {
      return { event: 'limb_swap', detail: `left/right leg labels exchanged (${Math.round(direct)} px direct vs ${Math.round(crossed)} px crossed)` };
    }
    return { event: null };
  }
}
