import type { FrameRecord } from './runner';

/**
 * Scores a tracking-lab run. All figures describe PIPELINE BEHAVIOUR on rendered test imagery.
 * `offset` (model vs rendered skeleton) is not a clinical accuracy figure.
 */

export interface StageStats {
  /** SD (deg) of the value while the ground truth is stationary — jitter at rest. */
  jitterSd: number | null;
  /** Time shift (ms) that best aligns the value with ground truth during movement. */
  lagMs: number | null;
  /** max(value) − max(ground truth) during movement (deg); negative = peak suppressed. */
  peakError: number | null;
  /** Median value − ground truth on frames with both (deg). Rendering-convention offset, not accuracy. */
  offset: number | null;
}

export interface RunSummary {
  frames: number;
  inference: { meanMs: number; p50Ms: number; p95Ms: number };
  /** Fraction of frames where the model returned at least one pose. */
  presence: number;
  /** Of single-person frames where every required landmark is truly visible: fraction where any required landmark visibility < 0.6. */
  dropout: number | null;
  /** Of frames where a measurement was possible (required landmarks visible, one person): fraction with no value. */
  invalidRate: number | null;
  /** Frames where a value was produced although a required landmark was hidden or another person was in view. */
  unsafeValues: number;
  /** Frames where a required landmark was hidden but the model still reported visibility ≥ 0.6 for all required landmarks. */
  hiddenButConfident: number;
  /** Hidden frames where segmentation support also stayed ≥ 0.5 for every required landmark (occlusion missed by both signals). */
  hiddenButSupported: number | null;
  hiddenFrames: number;
  reasons: Record<string, number>;
  orientations: Record<string, number>;
  raw: StageStats;
  smooth: StageStats;
  final: StageStats;
  /** Seconds from ground truth becoming measurable again to the first reported value (if the run had a gap). */
  reacquireSec: number | null;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const median = (xs: number[]) => (xs.length ? pct(xs, 0.5) : null);
const r = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

type Key = 'raw' | 'smooth' | 'final';

/**
 * @param gtAt ground-truth value at any time (ms) — used for lag fitting at sub-frame shifts.
 */
export function summarize(recs: FrameRecord[], gtAt: (tMs: number) => number | null): RunSummary {
  const n = recs.length;
  const inf = recs.map((x) => x.inferMs);
  const possible = recs.filter((x) => !x.gtHidden && !x.gtMulti && x.gt !== null);
  const single = recs.filter((x) => x.persons === 1 && !x.gtHidden && !x.gtMulti);
  const reasons: Record<string, number> = {};
  const orientations: Record<string, number> = {};
  for (const x of recs) {
    if (x.final === null && x.reason) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
    orientations[x.orientation] = (orientations[x.orientation] ?? 0) + 1;
  }
  const hidden = recs.filter((x) => x.gtHidden);
  // Re-acquisition: first frame after a withheld stretch where a value was possible again.
  let reacquireSec: number | null = null;
  const firstBlocked = recs.findIndex((x) => x.gtHidden || x.gtMulti);
  if (firstBlocked >= 0) {
    const back = recs.findIndex((x, i) => i > firstBlocked && !x.gtHidden && !x.gtMulti && x.gt !== null && recs.slice(i).every((y) => !y.gtHidden && !y.gtMulti));
    if (back >= 0) {
      const got = recs.findIndex((x, i) => i >= back && x.final !== null);
      reacquireSec = got >= 0 ? (recs[got].t - recs[back].t) / 1000 : null;
    }
  }
  return {
    frames: n,
    inference: { meanMs: r(inf.reduce((a, b) => a + b, 0) / Math.max(1, n))!, p50Ms: r(pct(inf, 0.5))!, p95Ms: r(pct(inf, 0.95))! },
    presence: r(recs.filter((x) => x.persons >= 1).length / Math.max(1, n), 3)!,
    dropout: single.length ? r(single.filter((x) => x.vis.some((v) => v < 0.6)).length / single.length, 3) : null,
    invalidRate: possible.length ? r(possible.filter((x) => x.final === null).length / possible.length, 3) : null,
    unsafeValues: recs.filter((x) => x.final !== null && (x.gtHidden || x.gtMulti)).length,
    hiddenButConfident: hidden.filter((x) => x.vis.length > 0 && x.vis.every((v) => v >= 0.6)).length,
    hiddenButSupported: recs.some((x) => x.sup) ? hidden.filter((x) => x.sup && x.sup.length > 0 && x.sup.every((v) => v >= 0.5)).length : null,
    hiddenFrames: hidden.length,
    reasons,
    orientations,
    raw: stage(recs, 'raw', gtAt),
    smooth: stage(recs, 'smooth', gtAt),
    final: stage(recs, 'final', gtAt),
    reacquireSec,
  };
}

function stage(recs: FrameRecord[], key: Key, gtAt: (t: number) => number | null): StageStats {
  const ok = recs.filter((x) => x[key] !== null && x.gt !== null && !x.gtHidden && !x.gtMulti);
  const offset = median(ok.map((x) => x[key]! - x.gt!));

  // Stationary windows: ground truth changes < 0.5° across ±150 ms.
  const still = ok.filter((x) => {
    const a = gtAt(x.t - 150);
    const b = gtAt(x.t + 150);
    return a !== null && b !== null && Math.abs(a - x.gt!) < 0.5 && Math.abs(b - x.gt!) < 0.5;
  });
  let jitterSd: number | null = null;
  if (still.length >= 10) {
    // Pool deviations from each stationary run's own mean (so different hold angles don't add variance).
    const runs: FrameRecord[][] = [];
    for (const x of still) {
      const last = runs[runs.length - 1];
      if (last && x.t - last[last.length - 1].t < 200 && Math.abs(last[0].gt! - x.gt!) < 0.5) last.push(x);
      else runs.push([x]);
    }
    const dev: number[] = [];
    for (const run of runs) {
      if (run.length < 5) continue;
      const m = run.reduce((a, x) => a + x[key]!, 0) / run.length;
      for (const x of run) dev.push(x[key]! - m);
    }
    if (dev.length >= 10) jitterSd = Math.sqrt(dev.reduce((a, d) => a + d * d, 0) / (dev.length - 1));
  }

  // Movement: ground truth changes ≥ 1° across ±100 ms.
  const moving = ok.filter((x) => {
    const a = gtAt(x.t - 100);
    const b = gtAt(x.t + 100);
    return a !== null && b !== null && Math.abs(b - a) >= 1;
  });
  let lagMs: number | null = null;
  let peakError: number | null = null;
  if (moving.length >= 10 && offset !== null) {
    let best = Infinity;
    for (let tau = -100; tau <= 800; tau += 10) {
      let s = 0;
      let c = 0;
      for (const x of moving) {
        const g = gtAt(x.t - tau);
        if (g === null) continue;
        const e = x[key]! - offset - g;
        s += e * e;
        c++;
      }
      if (c && s / c < best) {
        best = s / c;
        lagMs = tau;
      }
    }
    const gtPeak = Math.max(...recs.filter((x) => x.gt !== null && !x.gtHidden).map((x) => x.gt!));
    const vals = recs.filter((x) => x[key] !== null && !x.gtHidden && !x.gtMulti).map((x) => x[key]!);
    if (vals.length) peakError = Math.max(...vals) - offset - gtPeak;
  }
  return { jitterSd: r(jitterSd, 2), lagMs, peakError: r(peakError), offset: r(offset) };
}
