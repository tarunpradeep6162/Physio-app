/**
 * Generic movement-cycle detector used by the assessment protocols.
 *
 *   waiting ─(at rest ≥ readyMs)→ rest ─(leaves rest band)→ moving ─(reaches engaged)→ engaged
 *   engaged ─(moves back off peak)→ returning ─(back at rest)→ COMPLETE
 *   moving ─(back at rest without reaching engaged)→ incomplete (insufficient excursion)
 *   any ─(null sample)→ paused; a gap > pauseResetMs inside a cycle discards that cycle, and any
 *   gap > maxGapInCycleMs inside a cycle means that repetition can never count (interrupted).
 *
 * Works for movements that increase the signal ('up', e.g. knee flexion during a heel slide) or
 * decrease it ('down', e.g. knee flexion while rising from a chair). The rest→start boundary has
 * hysteresis so noise at the threshold cannot create phantom cycles.
 */

export interface CycleConfig {
  direction: 'up' | 'down';
  /** Boundary of the rest band (signal units). */
  rest: number;
  /** Signal level that counts as the movement's target position. */
  engaged: number;
  minCycleMs: number;
  pauseResetMs: number;
  readyMs: number;
  /** A tracking gap longer than this inside a repetition invalidates it (from protocol v1.1.0). */
  maxGapInCycleMs?: number;
  /** Minimum valid samples inside a repetition for its peak to be trusted (from v1.1.0). */
  minSamples?: number;
}

export type CyclePhase = 'waiting' | 'rest' | 'moving' | 'engaged' | 'returning' | 'paused';

export interface Cycle {
  index: number;
  startT: number;
  engagedT: number | null;
  peakT: number;
  /** Peak in ORIGINAL signal units (max for 'up', min for 'down'). */
  peak: number;
  endT: number | null;
  valid: boolean;
  reason?: 'insufficient_excursion' | 'too_short' | 'tracking_gap' | 'unfinished' | 'too_few_frames';
  /** Longest tracking gap inside this repetition (ms). */
  maxGapMs?: number;
  /** Valid samples inside this repetition. */
  samples?: number;
}

export type CycleEvent =
  | { type: 'ready'; t: number }
  | { type: 'start'; t: number; index: number }
  | { type: 'engaged'; t: number; index: number }
  | { type: 'returning'; t: number; index: number }
  | { type: 'complete'; t: number; cycle: Cycle }
  | { type: 'incomplete'; t: number; cycle: Cycle }
  | { type: 'discarded'; t: number; index: number }
  | { type: 'paused'; t: number }
  | { type: 'resumed'; t: number };

export class CycleDetector {
  phase: CyclePhase = 'waiting';
  readonly cycles: Cycle[] = [];
  private resume: CyclePhase = 'waiting';
  private pausedAt: number | null = null;
  private restSince: number | null = null;
  private cur: Cycle | null = null;
  private peakS = -Infinity;
  private readonly sign: 1 | -1;
  private readonly restS: number;
  private readonly engagedS: number;
  private readonly hyst: number;

  constructor(readonly cfg: CycleConfig) {
    this.sign = cfg.direction === 'up' ? 1 : -1;
    this.restS = this.sign * cfg.rest;
    this.engagedS = this.sign * cfg.engaged;
    this.hyst = 0.1 * (this.engagedS - this.restS);
  }

  get current(): Cycle | null {
    return this.cur;
  }

  get validCount(): number {
    return this.cycles.filter((c) => c.valid).length;
  }

  update(t: number, value: number | null): CycleEvent[] {
    const ev: CycleEvent[] = [];
    if (value === null) {
      if (this.phase !== 'paused') {
        this.resume = this.phase;
        this.phase = 'paused';
        this.pausedAt = t;
        ev.push({ type: 'paused', t });
      } else if (this.cur && this.pausedAt !== null && t - this.pausedAt > this.cfg.pauseResetMs) {
        this.cur = { ...this.cur, valid: false, reason: 'tracking_gap', endT: t };
        this.cycles.push(this.cur);
        ev.push({ type: 'discarded', t, index: this.cur.index });
        this.cur = null;
        this.resume = 'waiting';
      }
      return ev;
    }
    if (this.phase === 'paused') {
      if (this.cur && this.pausedAt !== null) this.cur.maxGapMs = Math.max(this.cur.maxGapMs ?? 0, t - this.pausedAt);
      this.phase = this.resume === 'rest' ? 'waiting' : this.resume;
      this.restSince = null;
      this.pausedAt = null;
      ev.push({ type: 'resumed', t });
    }

    const s = this.sign * value;
    const atRest = s <= this.restS;

    switch (this.phase) {
      case 'waiting':
        if (atRest) {
          this.restSince ??= t;
          if (t - this.restSince >= this.cfg.readyMs) {
            this.phase = 'rest';
            ev.push({ type: 'ready', t });
          }
        } else this.restSince = null;
        break;
      case 'rest':
        if (s > this.restS + this.hyst) {
          const index = this.cycles.length + 1;
          this.cur = { index, startT: t, engagedT: null, peakT: t, peak: value, endT: null, valid: false };
          this.peakS = s;
          this.phase = 'moving';
          ev.push({ type: 'start', t, index });
          this.track(t, s, value, ev);
        }
        break;
      case 'moving':
      case 'engaged':
      case 'returning':
        this.track(t, s, value, ev);
        break;
    }
    return ev;
  }

  private track(t: number, s: number, value: number, ev: CycleEvent[]) {
    const c = this.cur!;
    c.samples = (c.samples ?? 0) + 1;
    if (s > this.peakS) {
      this.peakS = s;
      c.peak = value;
      c.peakT = t;
    }
    if (this.phase === 'moving' && s >= this.engagedS) {
      this.phase = 'engaged';
      c.engagedT = t;
      ev.push({ type: 'engaged', t, index: c.index });
    } else if (this.phase === 'engaged' && s < this.peakS - this.hyst) {
      this.phase = 'returning';
      ev.push({ type: 'returning', t, index: c.index });
    }
    if (s <= this.restS) {
      c.endT = t;
      if (c.engagedT === null) {
        c.valid = false;
        c.reason = 'insufficient_excursion';
        this.cycles.push(c);
        ev.push({ type: 'incomplete', t, cycle: c });
      } else if ((c.maxGapMs ?? 0) > (this.cfg.maxGapInCycleMs ?? Infinity)) {
        // Tracking was interrupted during this repetition: it cannot be verified, so it does not count.
        c.valid = false;
        c.reason = 'tracking_gap';
        this.cycles.push(c);
        ev.push({ type: 'incomplete', t, cycle: c });
      } else if ((c.samples ?? 0) < (this.cfg.minSamples ?? 0)) {
        // Too few frames to know where the peak was (e.g. very low frame rate).
        c.valid = false;
        c.reason = 'too_few_frames';
        this.cycles.push(c);
        ev.push({ type: 'incomplete', t, cycle: c });
      } else if (t - c.startT < this.cfg.minCycleMs) {
        c.valid = false;
        c.reason = 'too_short';
        this.cycles.push(c);
        ev.push({ type: 'incomplete', t, cycle: c });
      } else {
        c.valid = true;
        this.cycles.push(c);
        ev.push({ type: 'complete', t, cycle: c });
      }
      this.cur = null;
      this.phase = 'rest';
    }
  }

  /**
   * Closes an in-progress cycle at the end of a recording. It never counts, unless the protocol
   * ends on reaching the engaged position (e.g. the 5th stand of a sit-to-stand test) and
   * `acceptEngaged` is set.
   */
  close(t: number, acceptEngaged = false) {
    if (this.cur) {
      const ok = acceptEngaged && this.cur.engagedT !== null;
      this.cycles.push({ ...this.cur, valid: ok, reason: ok ? undefined : 'unfinished', endT: t });
      this.cur = null;
    }
  }
}
