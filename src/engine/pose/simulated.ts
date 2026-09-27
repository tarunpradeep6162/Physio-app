import type { ExerciseId } from '../exercises/types';
import type { PoseFrame, PoseProviderInfo, Side } from '../types';
import type { PoseProvider, PoseSource } from './provider';
import { sceneAt, SIMULATED_PROTOCOLS, type SimParams } from '../protocols/simulate';
import { synthesize, type SynthScene } from './synthetic';

/**
 * SIMULATED pose provider for demonstrations and UI development without a camera.
 * Every frame is flagged `simulated: true`; measurements it produces are stored with
 * source = "simulated_demo" and are rendered with a DEMO badge. Never use for patient care.
 */

export interface SimulationScenario {
  exercise: ExerciseId | 'posture_anterior' | 'posture_posterior' | 'posture_lateral' | import('../protocols/types').ProtocolId;
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
  /** Protocol simulations stay at the start position until `startProtocol()` is called. */
  private protocolStart: number | null = null;
  protocolParams: SimParams = {};

  startProtocol() {
    this.protocolStart = performance.now();
  }

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

  detect(_source: PoseSource, timestamp: number): PoseFrame {
    const t0 = performance.now();
    const elapsed = (timestamp - this.start) / 1000;
    const a = this.angleAt(elapsed);
    const s = this.scenario;
    let scene: SynthScene;
    if (SIMULATED_PROTOCOLS.has(s.exercise)) {
      const t = this.protocolStart === null ? 0 : (timestamp - this.protocolStart) / 1000;
      const side = s.exercise === 'knee_squat' || s.exercise === 'heel_raise_double' || s.exercise === 'trunk_forward_bend' || s.exercise === 'neck_flexion_extension' || s.exercise === 'march_in_place' ? null : s.side;
      const sc = sceneAt(s.exercise, side, t, this.protocolParams);
      const lms = sc ? synthesize(sc, { ...SIM_FRAME, noisePx: 1.5, seed: this.seed++ }) : null;
      return { timestamp, ...SIM_FRAME, poses: lms ? [lms] : [], inferenceMs: performance.now() - t0, provider: this.info };
    }
    switch (s.exercise) {
      case 'knee_flexion':
        scene = { kind: 'standing_lateral', side: s.side, kneeFlexion: 5 + a };
        break;
      case 'shoulder_flexion':
        scene = { kind: 'standing_lateral', side: s.side, shoulderFlexion: 8 + a };
        break;
      case 'shoulder_abduction':
        scene = { kind: 'standing_anterior', armSide: s.side, shoulderAbduction: a };
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
