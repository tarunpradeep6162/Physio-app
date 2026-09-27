/**
 * Temporal smoothing filters.
 *
 * Three candidates are implemented so they can be compared on real recordings in Validation
 * Mode (jitter at rest vs. lag during movement). The One Euro filter is the default because it
 * adapts its cut-off to signal speed: heavy smoothing when the patient holds still (stable hold
 * readings) and light smoothing during fast movement (low lag).
 */

export type FilterKind = 'one_euro' | 'ema' | 'kalman' | 'none';

export interface ScalarFilter {
  /** Filter a sample. `t` is a timestamp in milliseconds. */
  filter(value: number, t: number): number;
  reset(): void;
}

function smoothingFactor(dtSeconds: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

export interface OneEuroParams {
  /** Minimum cut-off frequency (Hz). Lower = smoother at rest. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag during fast movement. */
  beta: number;
  /** Cut-off for the derivative (Hz). */
  dCutoff: number;
}

/** Casiez, Roussel & Vogel (2012), "1€ Filter". */
export class OneEuroFilter implements ScalarFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(private readonly p: OneEuroParams = { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 }) {}

  filter(x: number, t: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max((t - this.tPrev) / 1000, 1e-3);
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingFactor(dt, this.p.dCutoff);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(dxHat);
    const a = smoothingFactor(dt, cutoff);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.tPrev = null;
    this.dxPrev = 0;
  }
}

/** Exponential moving average with a time constant, robust to variable frame rate. */
export class EmaFilter implements ScalarFilter {
  private prev: number | null = null;
  private tPrev: number | null = null;
  constructor(private readonly timeConstantMs = 120) {}

  filter(x: number, t: number): number {
    if (this.prev === null || this.tPrev === null) {
      this.prev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(t - this.tPrev, 1);
    const a = 1 - Math.exp(-dt / this.timeConstantMs);
    this.prev = this.prev + a * (x - this.prev);
    this.tPrev = t;
    return this.prev;
  }
  reset(): void {
    this.prev = null;
    this.tPrev = null;
  }
}

/** 1D constant-velocity Kalman filter. */
export class KalmanFilter1D implements ScalarFilter {
  private x = 0; // position
  private v = 0; // velocity
  private p00 = 1;
  private p01 = 0;
  private p10 = 0;
  private p11 = 1;
  private tPrev: number | null = null;

  /** q: process noise (acceleration variance), r: measurement noise variance. */
  constructor(private readonly q = 400, private readonly r = 4) {}

  filter(z: number, t: number): number {
    if (this.tPrev === null) {
      this.x = z;
      this.v = 0;
      this.tPrev = t;
      return z;
    }
    const dt = Math.max((t - this.tPrev) / 1000, 1e-3);
    this.tPrev = t;
    // Predict
    this.x += this.v * dt;
    const dt2 = dt * dt;
    const q00 = (this.q * dt2 * dt2) / 4;
    const q01 = (this.q * dt2 * dt) / 2;
    const q11 = this.q * dt2;
    const p00 = this.p00 + dt * (this.p10 + this.p01) + dt2 * this.p11 + q00;
    const p01 = this.p01 + dt * this.p11 + q01;
    const p10 = this.p10 + dt * this.p11 + q01;
    const p11 = this.p11 + q11;
    // Update
    const s = p00 + this.r;
    const k0 = p00 / s;
    const k1 = p10 / s;
    const y = z - this.x;
    this.x += k0 * y;
    this.v += k1 * y;
    this.p00 = (1 - k0) * p00;
    this.p01 = (1 - k0) * p01;
    this.p10 = p10 - k1 * p00;
    this.p11 = p11 - k1 * p01;
    return this.x;
  }
  reset(): void {
    this.tPrev = null;
    this.p00 = 1;
    this.p01 = 0;
    this.p10 = 0;
    this.p11 = 1;
  }
}

class PassThrough implements ScalarFilter {
  filter(x: number): number {
    return x;
  }
  reset(): void {}
}

/** Default parameters for joint-angle signals (units: degrees). */
export function createAngleFilter(kind: FilterKind = 'one_euro'): ScalarFilter {
  switch (kind) {
    case 'one_euro':
      return new OneEuroFilter({ minCutoff: 1.2, beta: 0.015, dCutoff: 1.0 });
    case 'ema':
      return new EmaFilter(110);
    case 'kalman':
      return new KalmanFilter1D(2500, 6);
    case 'none':
      return new PassThrough();
  }
}

/** Default parameters for normalised landmark coordinates (units: fraction of frame). */
export function createCoordinateFilter(kind: FilterKind = 'one_euro'): ScalarFilter {
  switch (kind) {
    case 'one_euro':
      return new OneEuroFilter({ minCutoff: 1.5, beta: 8, dCutoff: 1.0 });
    case 'ema':
      return new EmaFilter(90);
    case 'kalman':
      return new KalmanFilter1D(2, 0.00002);
    case 'none':
      return new PassThrough();
  }
}
