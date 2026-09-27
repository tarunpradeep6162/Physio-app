import type { TrackingStatus } from './pipeline';
import type { ViewOrientation } from './types';

/**
 * Tracking diagnostics: separates what went wrong into four stages so an engineer or clinician
 * can tell a bad camera frame from bad pose output, filter lag or a measurement-algorithm refusal.
 *
 *   camera       frames arriving, how stale they are when analysed, lighting
 *   pose         person present, single person, required landmarks visible, no implausible jumps
 *   filter       delay and smoothing added between the model's raw angle and the reported angle
 *   measurement  whether a value was produced, and why not
 *
 * Pure TypeScript, no DOM: unit-tested and reusable in a worker.
 */

export interface DiagSample {
  /** Time the result became available (ms, performance clock). */
  t: number;
  /** Camera capture time of the analysed frame, when the browser reports it. */
  captureTs: number | null;
  /** Browser count of frames presented by the camera (requestVideoFrameCallback metadata). */
  presentedFrames: number | null;
  inferenceMs: number;
  persons: number;
  status: TrackingStatus;
  orientation: ViewOrientation;
  /** Visibility of each landmark the current measurement requires (raw model output). */
  requiredVis: number[];
  /** Largest per-frame displacement of a required landmark, in body-heights per second. */
  jumpRate: number | null;
  /** Angle from raw landmarks, from smoothed landmarks, and the final (reported) angle. */
  rawAngle: number | null;
  smoothAngle: number | null;
  finalAngle: number | null;
  reason?: string;
  meanLuma?: number | null;
}

export type StageStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface StageVerdict {
  stage: 'camera' | 'pose' | 'filter' | 'measurement';
  status: StageStatus;
  summary: string;
}

export interface DiagSnapshot {
  windowSec: number;
  cameraFps: number | null;
  inferenceFps: number;
  latency: { p50: number; p95: number; max: number; histogram: number[] };
  /** Camera frames not analysed because inference was busy (fraction of presented frames). */
  skippedFraction: number | null;
  /** Capture → result age of analysed frames (ms). */
  frameAge: { p50: number; p95: number } | null;
  presence: number;
  multiplePeople: number;
  /** Lowest recent visibility of each required landmark. */
  requiredVisMin: number[];
  /** Fraction of frames with an implausible landmark jump. */
  jumpFraction: number;
  /** Estimated delay of the final angle behind the raw-landmark angle during movement (ms). */
  filterLagMs: number | null;
  /** RMS difference between final and raw angle (deg). */
  filterDeltaRms: number | null;
  validFraction: number;
  reasons: Record<string, number>;
  verdicts: StageVerdict[];
}

/** Histogram bucket upper bounds for inference latency (ms). */
export const LATENCY_BUCKETS = [10, 20, 33, 50, 75, 100, 150, 250, 500, Infinity];
/** Required-landmark visibility below this is reported as a pose-stage problem. */
export const DIAG_MIN_VIS = 0.6;
/** Landmark speed above this (body-heights per second) is physically implausible for these tests. */
export const MAX_PLAUSIBLE_RATE = 6;

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const r1 = (v: number) => Math.round(v * 10) / 10;

export class TrackingDiagnostics {
  private buf: DiagSample[] = [];

  constructor(readonly windowMs = 5000) {}

  record(s: DiagSample) {
    this.buf.push(s);
    const cut = s.t - this.windowMs;
    while (this.buf.length && this.buf[0].t < cut) this.buf.shift();
  }

  reset() {
    this.buf = [];
  }

  get samples(): readonly DiagSample[] {
    return this.buf;
  }

  snapshot(): DiagSnapshot {
    const b = this.buf;
    const n = b.length;
    const span = n > 1 ? (b[n - 1].t - b[0].t) / 1000 : 0;
    const inf = b.map((x) => x.inferenceMs);
    const hist = LATENCY_BUCKETS.map(() => 0);
    for (const v of inf) hist[LATENCY_BUCKETS.findIndex((u) => v <= u)]++;

    const pres = b.filter((x) => x.presentedFrames !== null);
    let cameraFps: number | null = null;
    let skippedFraction: number | null = null;
    if (pres.length > 1) {
      const frames = pres[pres.length - 1].presentedFrames! - pres[0].presentedFrames!;
      const sec = (pres[pres.length - 1].t - pres[0].t) / 1000;
      if (sec > 0 && frames > 0) {
        cameraFps = r1(frames / sec);
        skippedFraction = Math.max(0, Math.round((1 - (pres.length - 1) / frames) * 1000) / 1000);
      }
    }
    const ages = b.filter((x) => x.captureTs !== null).map((x) => x.t - x.captureTs!);
    const tracking = b.filter((x) => x.status === 'tracking');
    const nReq = tracking[0]?.requiredVis.length ?? 0;
    const requiredVisMin = Array.from({ length: nReq }, (_, i) => Math.min(...tracking.map((x) => x.requiredVis[i] ?? 0)));
    const jumps = tracking.filter((x) => x.jumpRate !== null && x.jumpRate > MAX_PLAUSIBLE_RATE).length;
    const reasons: Record<string, number> = {};
    for (const x of b) if (x.finalAngle === null && x.reason) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
    const { lagMs, deltaRms } = estimateLag(b);
    const luma = b.map((x) => x.meanLuma).filter((v): v is number => typeof v === 'number');

    const snap: DiagSnapshot = {
      windowSec: r1(span),
      cameraFps,
      inferenceFps: span > 0 ? r1((n - 1) / span) : 0,
      latency: { p50: r1(pct(inf, 0.5)), p95: r1(pct(inf, 0.95)), max: r1(pct(inf, 1)), histogram: hist },
      skippedFraction,
      frameAge: ages.length ? { p50: r1(pct(ages, 0.5)), p95: r1(pct(ages, 0.95)) } : null,
      presence: n ? Math.round((b.filter((x) => x.persons > 0).length / n) * 1000) / 1000 : 0,
      multiplePeople: n ? Math.round((b.filter((x) => x.status === 'multiple_people').length / n) * 1000) / 1000 : 0,
      requiredVisMin: requiredVisMin.map((v) => Math.round(v * 100) / 100),
      jumpFraction: tracking.length ? Math.round((jumps / tracking.length) * 1000) / 1000 : 0,
      filterLagMs: lagMs,
      filterDeltaRms: deltaRms,
      validFraction: n ? Math.round((b.filter((x) => x.finalAngle !== null).length / n) * 1000) / 1000 : 0,
      reasons,
      verdicts: [],
    };
    snap.verdicts = verdicts(snap, luma.length ? luma.reduce((a, v) => a + v, 0) / luma.length : null);
    return snap;
  }
}

/** Delay of the final angle behind the raw-landmark angle, fitted over moving samples. */
export function estimateLag(b: readonly DiagSample[]): { lagMs: number | null; deltaRms: number | null } {
  const both = b.filter((x) => x.rawAngle !== null && x.finalAngle !== null);
  if (both.length < 10) return { lagMs: null, deltaRms: null };
  const deltaRms = Math.round(Math.sqrt(both.reduce((a, x) => a + (x.finalAngle! - x.rawAngle!) ** 2, 0) / both.length) * 100) / 100;
  // Moving samples only: raw angle speed > 20°/s.
  const moving: DiagSample[] = [];
  for (let i = 1; i < both.length; i++) {
    const dt = (both[i].t - both[i - 1].t) / 1000;
    if (dt > 0 && Math.abs(both[i].rawAngle! - both[i - 1].rawAngle!) / dt > 20) moving.push(both[i]);
  }
  if (moving.length < 8) return { lagMs: null, deltaRms };
  const rawAt = (t: number): number | null => {
    // Linear interpolation of the raw angle at time t (binary search; samples are time-ordered).
    let a0 = 0;
    let a1 = both.length - 1;
    if (t < both[0].t || t >= both[a1].t) return null;
    while (a1 - a0 > 1) {
      const m = (a0 + a1) >> 1;
      if (both[m].t <= t) a0 = m;
      else a1 = m;
    }
    const lo = a0;
    const a = both[lo];
    const c = both[lo + 1];
    const f = (t - a.t) / Math.max(1, c.t - a.t);
    return a.rawAngle! + f * (c.rawAngle! - a.rawAngle!);
  };
  let best = Infinity;
  let lagMs: number | null = null;
  for (let tau = 0; tau <= 500; tau += 10) {
    let s = 0;
    let c = 0;
    for (const x of moving) {
      const r = rawAt(x.t - tau);
      if (r === null) continue;
      s += (x.finalAngle! - r) ** 2;
      c++;
    }
    if (c >= 5 && s / c < best) {
      best = s / c;
      lagMs = tau;
    }
  }
  return { lagMs, deltaRms };
}

function verdicts(s: DiagSnapshot, meanLuma: number | null): StageVerdict[] {
  const out: StageVerdict[] = [];
  // Camera: light, frame rate, and time frames spend WAITING before analysis (not inference time).
  const queueMs = s.frameAge ? s.frameAge.p50 - s.latency.p50 : null;
  if (s.cameraFps === null && s.frameAge === null && meanLuma === null) out.push({ stage: 'camera', status: 'unknown', summary: 'No camera timing (simulated or unsupported browser)' });
  else if (meanLuma !== null && meanLuma < 60) out.push({ stage: 'camera', status: 'fail', summary: `Too dark (luma ${Math.round(meanLuma)})` });
  else if (s.cameraFps !== null && s.cameraFps < 15) out.push({ stage: 'camera', status: 'warn', summary: `Camera delivering ${s.cameraFps} fps` });
  else if (queueMs !== null && queueMs > 100) out.push({ stage: 'camera', status: 'warn', summary: `Frames wait ~${Math.round(queueMs)} ms before analysis` });
  else out.push({ stage: 'camera', status: 'ok', summary: `${s.cameraFps ?? '?'} fps${s.frameAge ? ` · age p50 ${Math.round(s.frameAge.p50)} ms` : ''}` });
  // Pose: correctness first (presence, one person, visible landmarks, plausible motion), then speed.
  const lowVis = s.requiredVisMin.some((v) => v < DIAG_MIN_VIS);
  if (s.presence < 0.5) out.push({ stage: 'pose', status: 'fail', summary: `Person found in ${Math.round(s.presence * 100)}% of frames` });
  else if (s.multiplePeople > 0.05) out.push({ stage: 'pose', status: 'fail', summary: `More than one person in ${Math.round(s.multiplePeople * 100)}% of frames` });
  else if (s.jumpFraction > 0.05) out.push({ stage: 'pose', status: 'warn', summary: `Implausible landmark jumps in ${Math.round(s.jumpFraction * 100)}% of frames` });
  else if (lowVis) out.push({ stage: 'pose', status: 'warn', summary: `Required landmark visibility down to ${Math.min(...s.requiredVisMin).toFixed(2)}` });
  else if (s.latency.p95 > 150) out.push({ stage: 'pose', status: 'warn', summary: `Slow inference: p95 ${Math.round(s.latency.p95)} ms (${s.inferenceFps} fps)` });
  else out.push({ stage: 'pose', status: 'ok', summary: `Inference ${s.inferenceFps} fps · p95 ${s.latency.p95} ms` });
  // Filter.
  if (s.filterLagMs === null) out.push({ stage: 'filter', status: 'unknown', summary: s.filterDeltaRms === null ? 'No angle yet' : 'Needs movement to estimate lag' });
  else if (s.filterLagMs > 150) out.push({ stage: 'filter', status: 'warn', summary: `Reported angle ~${s.filterLagMs} ms behind raw` });
  else out.push({ stage: 'filter', status: 'ok', summary: `Lag ~${s.filterLagMs} ms · RMS Δ ${s.filterDeltaRms}°` });
  // Measurement.
  const top = Object.entries(s.reasons).sort((a, b) => b[1] - a[1])[0];
  if (s.validFraction >= 0.8) out.push({ stage: 'measurement', status: 'ok', summary: `Value in ${Math.round(s.validFraction * 100)}% of frames` });
  else out.push({ stage: 'measurement', status: s.validFraction >= 0.3 ? 'warn' : 'fail', summary: `Value in ${Math.round(s.validFraction * 100)}% of frames${top ? ` · mostly ${top[0].replace(/_/g, ' ')}` : ''}` });
  return out;
}

/** Largest normalised displacement of the given landmarks between two frames (body-heights per second). */
export function jumpRate(prev: { x: number; y: number }[] | null, cur: { x: number; y: number }[] | null, idx: number[], dtMs: number, bodyHeightPx: number, width: number, height: number): number | null {
  if (!prev || !cur || dtMs <= 0 || bodyHeightPx <= 0) return null;
  let max = 0;
  for (const i of idx) {
    const d = Math.hypot((cur[i].x - prev[i].x) * width, (cur[i].y - prev[i].y) * height);
    max = Math.max(max, d);
  }
  return max / bodyHeightPx / (dtMs / 1000);
}
