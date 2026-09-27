import type { CycleEvent } from './cycles';
import type { LiveState } from './recorder';

/**
 * Coaching for assessment captures (Phase 5). Decisions are deterministic and come only from the
 * recorder's validated state; phrasing lives in i18n (`pcue.*`, `cue.pause.*`). Rules:
 *
 * - One actionable cue at a time.
 * - Tracking recovery pre-empts everything: while the measurement is invalid, pace and range cues
 *   are suspended and cleared — there is no form correction on low confidence.
 * - Pace and range cues follow a finished repetition (they are about what just happened), are
 *   phrased "as far as is comfortable", and never push for more range or speed.
 * - Cues switch as soon as the movement phase does (the cycle detector's hysteresis prevents
 *   flicker); speech has per-cue cooldowns so the voice never narrates continuously.
 */

export interface CaptureCue {
  key: string;
  tone: 'info' | 'success' | 'attention' | 'warning';
  params?: Record<string, string | number>;
}

export interface CaptureSpeech extends CaptureCue {
  priority: number;
  cooldownMs: number;
}

export interface CueUpdate {
  display: CaptureCue;
  speech: CaptureSpeech[];
  /** True when the displayed cue changed on this frame (for latency measurement). */
  changed: boolean;
}

/** How long a pace / range / not-counted cue is shown after the repetition that caused it. */
export const REVIEW_CUE_MS = 2200;

export class CaptureCueEngine {
  private shown: { cue: CaptureCue; since: number } | null = null;
  private review: { cue: CaptureCue; until: number } | null = null;

  update(live: LiveState, events: CycleEvent[], t: number): CueUpdate {
    const speech: CaptureSpeech[] = [];
    const say = (key: string, tone: CaptureCue['tone'], priority: number, cooldownMs: number, params?: CaptureCue['params']) => speech.push({ key, tone, priority, cooldownMs, params });
    // Not measurable right now (any reason, or no reading yet once the test has started).
    const tracking = live.value === null ? (live.reason ?? (live.phase === 'waiting' ? null : 'paused')) : null;

    for (const e of events) {
      if (e.type === 'complete') say('pcue.rep_counted', 'success', 4, 0, { n: live.validCycles });
      else if (e.type === 'incomplete') {
        const r = e.cycle.reason;
        const key = r === 'too_short' ? 'pcue.slower' : r === 'insufficient_excursion' ? 'pcue.range' : 'pcue.not_counted_tracking';
        this.review = { cue: { key, tone: 'attention' }, until: t + REVIEW_CUE_MS };
        say(key, 'attention', 3, 3000);
      } else if (e.type === 'paused') say('cue.paused_reposition', 'warning', 5, 5000);
    }

    let next: CaptureCue;
    if (tracking) {
      // Tracking recovery first; coaching about the movement is suspended while it is not measurable.
      this.review = null;
      next = { key: `pause:${tracking}`, tone: 'warning', params: { reason: tracking } };
    } else if (this.review && t < this.review.until) next = this.review.cue;
    else {
      this.review = null;
      next = phaseCue(live);
    }

    const changed = this.shown?.cue.key !== next.key;
    if (changed) this.shown = { cue: next, since: t };
    return { display: this.shown!.cue, speech, changed };
  }
}

function phaseCue(live: LiveState): CaptureCue {
  switch (live.phase) {
    case 'waiting':
      return { key: 'pcue.get_ready', tone: 'info' };
    case 'rest':
      return { key: live.validCycles ? 'pcue.again' : 'pcue.begin', tone: 'info', params: { n: live.validCycles } };
    case 'moving':
      return { key: 'pcue.keep_going', tone: 'info' };
    case 'engaged':
      return { key: 'pcue.return', tone: 'success' };
    case 'returning':
      return { key: 'pcue.returning', tone: 'info' };
    default:
      return { key: 'pcue.get_ready', tone: 'info' };
  }
}

/** Latency summary (ms) from the frame that caused a cue change to the cue being on screen. */
export function latencySummary(ms: number[]): { n: number; p50: number | null; p95: number | null } {
  if (!ms.length) return { n: 0, p50: null, p95: null };
  const s = [...ms].sort((a, b) => a - b);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]);
  return { n: s.length, p50: q(0.5), p95: q(0.95) };
}
