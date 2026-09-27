import { createAngleFilter, type FilterKind } from '../engine/filters';
import { estimate, MEASUREMENTS } from '../engine/measurements';
import { MotionPipeline, type ProcessedFrame } from '../engine/pipeline';
import { computePostureMetrics, POSTURE_METRICS } from '../engine/posture';
import type { PoseProvider } from '../engine/pose/provider';
import type { Landmark } from '../engine/types';
import { applyExposure, renderFrame } from '../camera/mannequin';
import { SignalGuard } from '../engine/signalGuard';
import { hiddenLandmarks, type LabMeasure, type Scenario } from './scenarios';

/**
 * Runs one tracking-lab scenario through the REAL pose provider and the app's own pipeline,
 * recording each stage separately so a bad frame, bad pose output, filter lag and a
 * measurement-algorithm error can be told apart:
 *
 *   gt      angle computed from the ground-truth skeleton that was rendered
 *   raw     same formula on the model's raw landmarks (no smoothing, no view gate)
 *   smooth  same formula on the pipeline's smoothed landmarks (no view gate)
 *   final   what the app would record: view/confidence gated, then angle-filtered
 */

export interface FrameRecord {
  t: number;
  gt: number | null;
  /** A landmark required by the measurement is hidden (occluded / out of frame) in ground truth. */
  gtHidden: boolean;
  /** More than one person is visible in ground truth. */
  gtMulti: boolean;
  persons: number;
  status: ProcessedFrame['status'];
  orientation: ProcessedFrame['orientation'];
  raw: number | null;
  smooth: number | null;
  final: number | null;
  reason?: string;
  /** Model visibility of each required landmark (raw output), in measure-definition order. */
  vis: number[];
  /** Segmentation body support of each required landmark (when enabled). */
  sup?: number[];
  inferMs: number;
  /** Compact raw model landmarks (x, y, visibility ×33) for offline filter studies. */
  lms?: number[] | null;
}

export interface RunOptions {
  /** Reproduce the pre-Phase-6 measurement path (no plausibility guard). */
  legacy?: boolean;
  coordFilter?: FilterKind;
  angleFilter?: FilterKind;
  keepLandmarks?: boolean;
  /** Yield to the event loop every n frames so the page stays responsive. */
  yieldEvery?: number;
}

export function requiredLandmarks(m: LabMeasure): number[] {
  if (m.kind === 'angle') return MEASUREMENTS[m.type].landmarks(m.side);
  const def = POSTURE_METRICS.find((d) => d.id === m.id)!;
  return def.landmarks('anterior');
}

export function measureOn(m: LabMeasure, lms: Landmark[] | null, w: number, h: number, view: ProcessedFrame['orientation'] | null, support?: number[] | null): { value: number | null; reason?: string } {
  if (!lms) return { value: null, reason: 'no_person' };
  if (m.kind === 'angle') {
    const e = estimate(m.type, lms, w, h, m.side, view ? { view, support } : { ignoreView: true, minConfidence: 0 });
    return { value: e.value, reason: e.reason };
  }
  const v = view ?? 'anterior';
  const found = computePostureMetrics(lms, w, h, v, view ? 0.6 : 0, view ? support : null).find((s) => s.id === m.id);
  return found ? { value: found.value } : { value: null, reason: view && v !== 'anterior' ? 'wrong_orientation' : 'withheld' };
}

export async function runScenario(sc: Scenario, provider: PoseProvider, canvas: HTMLCanvasElement, o: RunOptions = {}): Promise<FrameRecord[]> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const sub = document.createElement('canvas');
  sub.width = canvas.width;
  sub.height = canvas.height;
  const subCtx = sub.getContext('2d', { willReadFrequently: true })!;
  const W = canvas.width;
  const H = canvas.height;
  // Mirrors the app: pipeline (identity guard, re-acquisition, coordinate filter), per-landmark
  // validation with body support, plausibility guard, then the live angle filter.
  const pipeline = new MotionPipeline(o.coordFilter ?? 'none');
  const angleFilter = createAngleFilter(o.angleFilter ?? 'one_euro');
  const guard = o.legacy ? null : new SignalGuard(sc.measure.kind === 'angle' ? 900 : 400);
  const req = requiredLandmarks(sc.measure);
  const out: FrameRecord[] = [];
  const n = Math.round(sc.durationSec * sc.cameraFps);
  const every = sc.processEvery ?? 1;
  for (let i = 0; i < n; i += every) {
    const tMs = (i * 1000) / sc.cameraFps;
    const t = tMs / 1000;
    const spec = sc.frame(t);
    // Motion blur: mean of sub-frames spread across the exposure.
    const exp = sc.exposureMs ?? 0;
    if (exp > 0) {
      const k = 4;
      for (let j = 0; j < k; j++) {
        const st = t + ((j / (k - 1) - 0.5) * exp) / 1000;
        const s2 = sc.frame(st);
        renderFrame(subCtx, s2.figures, { ...s2.render, noise: 0, brightness: 1 });
        ctx.globalAlpha = 1 / (j + 1);
        ctx.drawImage(sub, 0, 0);
      }
      ctx.globalAlpha = 1;
      applyExposure(ctx, spec.render.brightness ?? 1, spec.render.noise ?? 0, i + 1);
    } else {
      renderFrame(ctx, spec.figures, { ...spec.render, seed: i + 1 });
    }

    const patient = spec.figures[spec.patient ?? 0].lms;
    const hidden = hiddenLandmarks(patient, spec.render.occluders);
    const gtHidden = req.some((r) => hidden.has(r));
    const gtMulti = spec.figures.filter((f) => f.lms.some((l) => l.x > 0.02 && l.x < 0.98 && l.y > 0 && l.y < 1)).length > 1;
    const gt = measureOn(sc.measure, patient, W, H, null).value;

    const frame = provider.detect(canvas, tMs + 1);
    const p = pipeline.process(frame);
    const raw = measureOn(sc.measure, p.raw, W, H, null).value;
    const smooth = measureOn(sc.measure, p.smoothed, W, H, null).value;
    let final: number | null = null;
    let reason: string | undefined;
    let candidate: number | null = null;
    if (p.status !== 'tracking') reason = p.status;
    else if (p.orientation === 'unknown' && sc.measure.kind === 'angle') reason = 'orientation_uncertain';
    else {
      const r = measureOn(sc.measure, p.smoothed, W, H, p.orientation, p.support);
      reason = r.reason;
      candidate = r.value;
    }
    const g = guard ? guard.update(tMs, candidate) : { value: candidate };
    if (g.value !== null) final = sc.measure.kind === 'angle' ? angleFilter.filter(g.value, tMs) : g.value;
    else if (candidate !== null && 'reason' in g) reason = g.reason;
    if (final === null) angleFilter.reset();
    out.push({
      t: tMs,
      gt,
      gtHidden,
      gtMulti,
      persons: frame.poses.length,
      status: p.status,
      orientation: p.orientation,
      raw,
      smooth,
      final,
      reason: final === null ? reason : undefined,
      vis: p.raw ? req.map((r) => Math.round(p.raw![r].visibility * 100) / 100) : [],
      sup: p.support ? req.map((r) => p.support![r] ?? 0) : undefined,
      inferMs: frame.inferenceMs,
      lms: o.keepLandmarks ? (frame.poses[0] ? frame.poses[0].flatMap((l) => [r4(l.x), r4(l.y), r4(l.visibility)]) : null) : undefined,
    });
    if (out.length % (o.yieldEvery ?? 15) === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/** Ground-truth value of the scenario's measurement at time t (s), from the rendered skeleton. */
export function groundTruthAt(sc: Scenario, tSec: number, width = 720, height = 1280): number | null {
  const spec = sc.frame(tSec);
  return measureOn(sc.measure, spec.figures[spec.patient ?? 0].lms, width, height, null).value;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
