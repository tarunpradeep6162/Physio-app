import type { Cycle } from './cycles';
import type { MetricSpec, ProtocolMetric, Recording } from './types';

/** Small numeric helpers shared by every region's protocol definitions. */

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const percentile = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};
export const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export function metric(spec: MetricSpec, value: number | null, perCycle: number[], reason?: string): ProtocolMetric {
  return { ...spec, value: r1(value), perCycle: perCycle.map((v) => Math.round(v * 10) / 10), validity: value === null || reason ? 'invalid' : 'valid', reason };
}

/** Median of a secondary channel within ±250 ms of a cycle's peak. */
export function extraNearPeak(rec: Recording, c: Cycle, key: string): number | null {
  const vs = rec.samples.filter((s) => Math.abs(s.t - c.peakT) <= 250).map((s) => s.extras?.[key]).filter((v): v is number => typeof v === 'number');
  return median(vs);
}
