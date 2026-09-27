import { describe, expect, it } from 'vitest';
import { ExerciseRunner } from './exerciseRunner';
import { defaultPrescription } from './exercises/definitions';
import { LM } from './landmarks';
import { MotionPipeline } from './pipeline';
import { SIM_PROVIDER } from './protocols/simulate';
import { synthesize } from './pose/synthetic';
import type { Landmark, Side } from './types';

/**
 * Phase 12 — repetition counting robustness. Each run drives the real pipeline + ExerciseRunner
 * with synthetic knee-flexion reps (peak 95°, target 80–100°, 3 s hold) and a perturbation.
 */
function run(opts: { fps?: number; reps?: number; sceneSide?: Side; perturb?: (lms: Landmark[], t: number, rep: number) => Landmark[] | null }) {
  const rx = { ...defaultPrescription('knee_flexion', 'left'), sets: 1, reps: opts.reps ?? 3, restSeconds: 0 };
  const runner = new ExerciseRunner(rx);
  const pipe = new MotionPipeline();
  const fps = opts.fps ?? 30;
  const [rest, up, hold, down] = [1.2, 1.6, rx.holdSeconds + 0.6, 1.8];
  const cyc = rest + up + hold + down;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  const angle = (t: number) => {
    const k = t % cyc;
    if (k < rest) return 0;
    if (k < rest + up) return ease((k - rest) / up) * 95;
    if (k < rest + up + hold) return 95;
    return (1 - ease((k - rest - up - hold) / down)) * 95;
  };
  let live = 0;
  const total = (rx.reps + 1) * cyc;
  for (let t = 0; t < total * 1000; t += 1000 / fps) {
    const s = t / 1000;
    let lms: Landmark[] | null = synthesize({ kind: 'standing_lateral', side: opts.sceneSide ?? 'left', kneeFlexion: 5 + angle(s) }, { noisePx: 1, seed: Math.round(t) + 1 });
    if (opts.perturb) lms = opts.perturb(lms, s, Math.floor(s / cyc));
    const ev = runner.update(pipe.process({ timestamp: t, width: 720, height: 1280, poses: lms ? [lms] : [], inferenceMs: 4, provider: SIM_PROVIDER }), t);
    live += ev.filter((e) => e.type === 'rep_complete').length;
    if (runner.snapshot.phase === 'complete') break;
  }
  return { result: runner.result(runner.snapshot.phase !== 'complete'), live, liveSnapshot: runner.snapshot.repsCounted };
}

describe('Phase 12 — repetition counting', () => {
  it('counts clean reps, and the live counter equals the saved result', () => {
    const r = run({});
    expect(r.result.repsCompleted).toBe(3);
    expect(r.live).toBe(3);
    expect(r.result.reps.filter((x) => x.counted).length).toBe(r.result.repsCompleted);
  });

  it('a short occlusion during a rep: that rep is stored with a reason and never counted', () => {
    // Knee hidden for ~0.5 s in the middle of the hold of rep index 1.
    const r = run({ perturb: (l, s, rep) => (rep === 1 && s % 7.2 > 3.3 && s % 7.2 < 3.8 ? l.map((p, i) => (i === LM.leftKnee ? { ...p, visibility: 0.2 } : p)) : l) });
    const interrupted = r.result.reps.find((x) => x.reason === 'tracking_interrupted');
    expect(interrupted).toBeDefined();
    expect(interrupted!.counted).toBe(false);
    expect(r.live).toBe(r.result.repsCompleted);
  });

  it('a long tracking loss mid-rep is stored as an attempt that failed, not dropped silently', () => {
    const r = run({ perturb: (l, s, rep) => (rep === 0 && s > 2.5 && s < 6.0 ? null : l) });
    const lost = r.result.reps.find((x) => x.reason === 'tracking_lost');
    expect(lost).toBeDefined();
    expect(lost!.counted).toBe(false);
    expect(r.result.repsAttempted).toBeGreaterThanOrEqual(r.result.reps.length - 0);
  });

  it('moving the wrong leg (the other side toward the camera) produces no counted reps', () => {
    const r = run({ sceneSide: 'right' });
    expect(r.result.repsCompleted).toBe(0);
  });

  it('still counts correctly at a low frame rate (8 fps)', () => {
    const r = run({ fps: 8 });
    expect(r.result.repsCompleted).toBe(3);
    expect(r.live).toBe(3);
  });
});
