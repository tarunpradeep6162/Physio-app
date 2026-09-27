import { ExerciseRunner, type ExerciseResult } from '../exerciseRunner';
import { MotionPipeline } from '../pipeline';
import { synthesize, type SynthScene } from '../pose/synthetic';
import { SIM_PROVIDER } from '../protocols/simulate';
import type { ExercisePrescription } from './types';

/**
 * Runs the real ExerciseRunner over a synthetic exercise performance (demo data and tests).
 * The patient reaches `peak` degrees on each rep; results are therefore engine-derived.
 */
export function simulateExercise(rx: ExercisePrescription, peak: number, fps = 10, seed = 1): ExerciseResult {
  const runner = new ExerciseRunner(rx);
  const pipeline = new MotionPipeline();
  const hold = rx.holdSeconds + 0.5;
  const [rest, up, down] = [1.2, 1.6, 1.8];
  const cycle = rest + up + hold + down;
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  const angleAt = (t: number) => {
    const k = t % cycle;
    if (k < rest) return 0;
    if (k < rest + up) return ease((k - rest) / up) * peak;
    if (k < rest + up + hold) return peak;
    return (1 - ease((k - rest - up - hold) / down)) * peak;
  };
  const scene = (a: number): SynthScene =>
    rx.definitionId === 'straight_leg_raise'
      ? { kind: 'supine_lateral', side: rx.side, legRaise: a }
      : rx.definitionId === 'shoulder_flexion'
        ? { kind: 'standing_lateral', side: rx.side, shoulderFlexion: 8 + a }
        : { kind: 'standing_lateral', side: rx.side, kneeFlexion: 5 + a };
  const maxT = (rx.sets * rx.reps + 2) * cycle + rx.sets * rx.restSeconds;
  let t = 0;
  let s = seed;
  for (; t < maxT * 1000; t += 1000 / fps) {
    const lm = synthesize(scene(angleAt(t / 1000)), { noisePx: 1, seed: s++ });
    runner.update(pipeline.process({ timestamp: t, width: 720, height: 1280, poses: [lm], inferenceMs: 4, provider: SIM_PROVIDER }), t);
    if (runner.snapshot.phase === 'rest') runner.skipRest(t);
    if (runner.snapshot.phase === 'complete') break;
  }
  return runner.result(runner.snapshot.phase !== 'complete');
}
