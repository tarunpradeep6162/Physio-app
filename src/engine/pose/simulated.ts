import type { ExerciseId } from '../exercises/types';
import type { PoseFrame, PoseProviderInfo, Side } from '../types';
import type { PoseProvider } from './provider';
import { synthesize, type SynthScene } from './synthetic';

/**
 * SIMULATED pose provider for demonstrations and UI development without a camera.
 * Every frame is flagged `simulated: true`; measurements it produces are stored with
 * source = "simulated_demo" and are rendered with a DEMO badge. Never use for patient care.
 */

export interface SimulationScenario {
  exercise: ExerciseId | 'posture_anterior' | 'posture_posterior' | 'posture_lateral';
  side: Side;
  /** Peak angle the simulated patient reaches (can be set below target to show incomplete reps). */
  peak: number;
  holdSeconds: number;
}

export const SIM_FRAME = { width: 720, height: 1280 };

export class SimulatedPoseProvider implements PoseProvider {
  readonly info: PoseProviderInfo = { id: 'simulated', model: 'synthetic-skeleton', version: '1.0.0', simulated: true };
  private start = 0;
  private seed = 1;
  scenario: SimulationScenario = { exercise: 'knee_flexion', side: 'left', peak: 92, holdSeconds: 3 };

  async init(): Promise<void> {
    this.start = performance.now();
  }

  /** Angle for the current time in a rest → raise → hold → lower cycle. */
  private angleAt(elapsed: number): number {
    const rest = 1.4;
    const up = 1.6;
    const hold = this.scenario.holdSeconds + 0.6;
    const down = 1.8;
    const cycle = rest + up + hold + down;
    const k = elapsed % cycle;
    const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
    const peak = this.scenario.peak;
    if (k < rest) return 0;
    if (k < rest + up) return ease((k - rest) / up) * peak;
    if (k < rest + up + hold) return peak;
    return (1 - ease((k - rest - up - hold) / down)) * peak;
  }

  detect(_source: HTMLVideoElement, timestamp: number): PoseFrame {
    const t0 = performance.now();
    const elapsed = (timestamp - this.start) / 1000;
    const a = this.angleAt(elapsed);
    const s = this.scenario;
    let scene: SynthScene;
    switch (s.exercise) {
      case 'knee_flexion':
        scene = { kind: 'standing_lateral', side: s.side, kneeFlexion: 5 + a };
        break;
      case 'shoulder_flexion':
        scene = { kind: 'standing_lateral', side: s.side, shoulderFlexion: 8 + a };
        break;
      case 'straight_leg_raise':
        scene = { kind: 'supine_lateral', side: s.side, legRaise: a };
        break;
      case 'posture_lateral':
        scene = { kind: 'standing_lateral', side: s.side, trunkLean: 3 };
        break;
      default:
        scene = { kind: 'standing_anterior', shoulderTiltDeg: 2.5, pelvicTiltDeg: 1.2 };
    }
    let lm = synthesize(scene, { ...SIM_FRAME, noisePx: 1.5, seed: this.seed++ });
    if (s.exercise === 'posture_posterior') {
      // Back view: mirror horizontally so the patient's left appears on the image left; face hidden.
      lm = lm.map((l, i) => ({ ...l, x: 1 - l.x, visibility: i <= 10 && i !== 7 && i !== 8 ? 0.2 : l.visibility }));
    }
    return { timestamp, ...SIM_FRAME, poses: [lm], inferenceMs: performance.now() - t0, provider: this.info };
  }

  close(): void {}
}
