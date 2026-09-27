import { EmaFilter, KalmanFilter1D, OneEuroFilter, type ScalarFilter } from '../engine/filters';
import { estimate } from '../engine/measurements';
import type { Landmark, Side } from '../engine/types';
import { summarize, type StageStats } from './metrics';
import type { FrameRecord } from './runner';
import { SignalGuard } from '../engine/signalGuard';
import { zeroPhaseSmooth } from '../engine/zeroPhase';

/**
 * Phase 7 filter study: replays the SAME recorded model outputs (real BlazePose landmarks from the
 * tracking lab) through different smoothing chains and scores jitter at rest, lag and peak
 * suppression against ground truth. Coordinate filters act on landmarks before the angle is
 * computed; angle filters act on the angle. Nothing here runs a model.
 */

export interface LandmarkFixture {
  frameWidth: number;
  frameHeight: number;
  scenarios: { id: string; title: string; side: Side; t: number[]; gt: (number | null)[]; frames: (string | null)[] }[];
}

export function decodeLandmarks(b64: string): Landmark[] {
  const bin = atob(b64);
  const out: Landmark[] = [];
  const v = (i: number) => ((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8)) / 65535) * 2 - 0.5;
  for (let k = 0; k < 33; k++) out.push({ x: v(k * 6), y: v(k * 6 + 2), z: 0, visibility: v(k * 6 + 4) });
  return out;
}

export type FilterSpec = { kind: 'none' } | { kind: 'one_euro'; minCutoff: number; beta: number } | { kind: 'ema'; tauMs: number } | { kind: 'kalman'; q: number; r: number };

export function makeFilter(f: FilterSpec): ScalarFilter | null {
  switch (f.kind) {
    case 'none':
      return null;
    case 'one_euro':
      return new OneEuroFilter({ minCutoff: f.minCutoff, beta: f.beta, dCutoff: 1 });
    case 'ema':
      return new EmaFilter(f.tauMs);
    case 'kalman':
      return new KalmanFilter1D(f.q, f.r);
  }
}

export interface ChainSpec {
  name: string;
  coord: FilterSpec;
  angle: FilterSpec;
  /** Apply the plausibility guard (max 900°/s + recovery window) before filtering. */
  guard?: boolean;
  /** Offline, zero-phase (centred) smoothing of the guarded raw angle: half-window in ms. */
  zeroPhaseMs?: number;
  zeroPhaseMeanMs?: number;
}

export interface ChainResult {
  chain: string;
  scenario: string;
  final: StageStats;
  invalidRate: number | null;
}

/** Runs one chain over one recorded scenario. Frames with low visibility break the chain (no bridging). */
export function runChain(fx: LandmarkFixture, sc: LandmarkFixture['scenarios'][number], chain: ChainSpec): ChainResult {
  const W = fx.frameWidth;
  const H = fx.frameHeight;
  const coordF = Array.from({ length: 33 * 2 }, () => makeFilter(chain.coord));
  const angleF = makeFilter(chain.angle);
  const guard = chain.guard || chain.zeroPhaseMs !== undefined ? new SignalGuard(900) : null;
  const recs: FrameRecord[] = [];
  for (let i = 0; i < sc.t.length; i++) {
    const t = sc.t[i];
    const b64 = sc.frames[i];
    const raw = b64 ? decodeLandmarks(b64) : null;
    let rawA: number | null = null;
    let fin: number | null = null;
    if (raw) {
      rawA = estimate('knee_flexion', raw, W, H, sc.side, { ignoreView: true, minConfidence: 0.6 }).value;
      const lms = raw.map((l, k) => (coordF[k * 2] ? { ...l, x: coordF[k * 2]!.filter(l.x, t), y: coordF[k * 2 + 1]!.filter(l.y, t) } : l));
      const a0 = estimate('knee_flexion', lms, W, H, sc.side, { ignoreView: true, minConfidence: 0.6 }).value;
      const a = guard ? guard.update(t, a0).value : a0;
      fin = a === null ? null : angleF ? angleF.filter(a, t) : a;
      if (a === null) angleF?.reset();
    } else {
      coordF.forEach((f) => f?.reset());
      angleF?.reset();
    }
    recs.push({ t, gt: sc.gt[i], gtHidden: false, gtMulti: false, persons: raw ? 1 : 0, status: raw ? 'tracking' : 'no_person', orientation: 'unknown', raw: rawA, smooth: rawA, final: fin, vis: [], inferMs: 0 });
  }
  if (chain.zeroPhaseMs !== undefined) {
    const sm = zeroPhaseSmooth(recs.map((r) => ({ t: r.t, v: r.final })), chain.zeroPhaseMs, chain.zeroPhaseMeanMs ?? 0);
    recs.forEach((r, i) => (r.final = sm[i]));
  }
  const gtAt = (tq: number): number | null => {
    const ts = sc.t;
    if (tq < ts[0] || tq > ts[ts.length - 1]) return null;
    let i = 0;
    while (i < ts.length - 1 && ts[i + 1] < tq) i++;
    const a = sc.gt[i];
    const b = sc.gt[Math.min(i + 1, ts.length - 1)];
    if (a === null || b === null) return a ?? b;
    const f = (tq - ts[i]) / Math.max(1, ts[Math.min(i + 1, ts.length - 1)] - ts[i]);
    return a + f * (b - a);
  };
  const s = summarize(recs, gtAt);
  return { chain: chain.name, scenario: sc.id, final: s.final, invalidRate: s.invalidRate };
}

export const STUDY_CHAINS: ChainSpec[] = [
  { name: 'v1.0 default: coord 1€(1.5, 8) + angle 1€(1.2, 0.015)', coord: { kind: 'one_euro', minCutoff: 1.5, beta: 8 }, angle: { kind: 'one_euro', minCutoff: 1.2, beta: 0.015 } },
  { name: 'raw (no filter)', coord: { kind: 'none' }, angle: { kind: 'none' } },
  { name: 'coord 1€(1.5, 8) only', coord: { kind: 'one_euro', minCutoff: 1.5, beta: 8 }, angle: { kind: 'none' } },
  { name: 'angle 1€(1.2, 0.015) only', coord: { kind: 'none' }, angle: { kind: 'one_euro', minCutoff: 1.2, beta: 0.015 } },
  { name: 'angle 1€(1.0, 0.05)', coord: { kind: 'none' }, angle: { kind: 'one_euro', minCutoff: 1.0, beta: 0.05 } },
  { name: 'angle 1€(1.0, 0.2)', coord: { kind: 'none' }, angle: { kind: 'one_euro', minCutoff: 1.0, beta: 0.2 } },
  { name: 'angle 1€(0.7, 0.4)', coord: { kind: 'none' }, angle: { kind: 'one_euro', minCutoff: 0.7, beta: 0.4 } },
  { name: 'angle 1€(1.5, 0.4)', coord: { kind: 'none' }, angle: { kind: 'one_euro', minCutoff: 1.5, beta: 0.4 } },
  { name: 'angle EMA 110 ms', coord: { kind: 'none' }, angle: { kind: 'ema', tauMs: 110 } },
  { name: 'angle EMA 60 ms', coord: { kind: 'none' }, angle: { kind: 'ema', tauMs: 60 } },
  { name: 'angle Kalman (2500, 6)', coord: { kind: 'none' }, angle: { kind: 'kalman', q: 2500, r: 6 } },
  { name: 'guard + angle 1€(1.2, 0.015)', coord: { kind: 'none' }, angle: { kind: 'one_euro', minCutoff: 1.2, beta: 0.015 }, guard: true },
  { name: 'guard + angle EMA 60 ms', coord: { kind: 'none' }, angle: { kind: 'ema', tauMs: 60 }, guard: true },
  { name: 'guard + zero-phase median ±67 ms', coord: { kind: 'none' }, angle: { kind: 'none' }, zeroPhaseMs: 67 },
  { name: 'guard + zero-phase median ±100 ms', coord: { kind: 'none' }, angle: { kind: 'none' }, zeroPhaseMs: 100 },
  { name: 'guard + zero-phase median ±150 ms', coord: { kind: 'none' }, angle: { kind: 'none' }, zeroPhaseMs: 150 },
  { name: 'guard + zero-phase median ±100 + mean ±100 ms', coord: { kind: 'none' }, angle: { kind: 'none' }, zeroPhaseMs: 100, zeroPhaseMeanMs: 100 },
  { name: 'guard + zero-phase median ±100 + mean ±150 ms', coord: { kind: 'none' }, angle: { kind: 'none' }, zeroPhaseMs: 100, zeroPhaseMeanMs: 150 },
  { name: 'guard + zero-phase median ±150 + mean ±200 ms', coord: { kind: 'none' }, angle: { kind: 'none' }, zeroPhaseMs: 150, zeroPhaseMeanMs: 200 },
];
