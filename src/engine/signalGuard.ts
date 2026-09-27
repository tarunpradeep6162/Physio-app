/**
 * Plausibility + recovery guard for a measured signal (e.g. a knee angle).
 *
 * - A change faster than `maxRate` (units per second) between consecutive samples is physically
 *   impossible for these movements (typically a landmark flip or leg-label swap): the sample is
 *   rejected ('implausible_jump'), never smoothed into the result.
 * - After a rejected sample, or after a gap longer than `gapMs`, values are withheld
 *   ('reacquiring') until the signal has been continuous and plausible for `recoverMs`.
 * No value is interpolated across a gap.
 */
export class SignalGuard {
  private last: { t: number; v: number } | null = null;
  private lastValidT: number | null = null;
  private recoverSince: number | null = null;

  constructor(
    readonly maxRate: number,
    readonly recoverMs = 250,
    readonly gapMs = 150,
  ) {}

  reset() {
    this.last = null;
    this.lastValidT = null;
    this.recoverSince = null;
  }

  update(t: number, v: number | null): { value: number | null; reason?: 'implausible_jump' | 'reacquiring' } {
    if (v === null) return { value: null };
    const prev = this.last;
    this.last = { t, v };
    // Gap since the last accepted sample: start a recovery window.
    if (this.lastValidT !== null && t - this.lastValidT > this.gapMs && this.recoverSince === null) this.recoverSince = t;
    if (prev) {
      const dt = Math.max(1, t - prev.t) / 1000;
      if (Math.abs(v - prev.v) / dt > this.maxRate) {
        this.recoverSince = t;
        return { value: null, reason: 'implausible_jump' };
      }
    }
    if (this.recoverSince !== null) {
      if (t - this.recoverSince < this.recoverMs) return { value: null, reason: 'reacquiring' };
      this.recoverSince = null;
    }
    this.lastValidT = t;
    return { value: v };
  }
}
