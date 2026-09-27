import { MotionPipeline } from '../pipeline';
import { synthesize, type SynthScene } from '../pose/synthetic';
import type { Landmark, PoseProviderInfo, Side } from '../types';
import { getProtocol } from './registry';

/** Protocol ids the synthetic scene generator can animate. */
export const SIMULATED_PROTOCOLS = new Set(['knee_supported_flexion', 'knee_sit_to_stand', 'knee_squat', 'shoulder_flexion_active', 'shoulder_abduction_active']);
import { ProtocolRecorder } from './recorder';
import type { ProtocolResult } from './types';

/**
 * Runs the REAL pipeline + protocol recorder over a synthetic landmark sequence. Used by unit
 * tests and to generate demonstration data, so every demo number is produced by the same
 * versioned calculation as a real capture (and is labelled SIMULATED wherever shown).
 */

export const SIM_PROVIDER: PoseProviderInfo = { id: 'simulated', model: 'synthetic-skeleton', version: '1.0.0', simulated: true };

export interface SimParams {
  /** Peak value: knee flexion (deg) for flexion/STS seated; depth fraction for squat. */
  peak?: number;
  valgusLeft?: number;
  valgusRight?: number;
  /** Shoulder flexion: trunk lean (deg) reached at peak arm elevation. */
  trunkLean?: number;
  /** Seconds per cycle multiplier (1 = default tempo). */
  tempo?: number;
  cycles?: number;
  fps?: number;
  noisePx?: number;
  seed?: number;
  /** Mutate landmarks at time t (s) — e.g. inject occlusion. */
  perturb?: (lms: Landmark[], t: number) => Landmark[] | null;
}

/** Figure scale matching the shoulder protocols' framing guide (room above the head for the raised arm). */
const SHOULDER_FRAMING_SCALE = 0.75;

const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

export function sceneAt(protocolId: string, side: Side | null, t: number, p: SimParams): SynthScene | null {
  const k = p.tempo ?? 1;
  const n = p.cycles ?? 5;
  if (protocolId === 'knee_supported_flexion') {
    const peak = p.peak ?? 120;
    const [rest, up, hold, down] = [1.0 * k, 1.6 * k, 0.4 * k, 1.6 * k];
    const cyc = rest + up + hold + down;
    if (t >= 1 + (p.cycles ?? 3) * cyc) return { kind: 'supine_heel_slide', side: side ?? 'left', kneeFlexion: 3 };
    const x = (t - 1 + cyc) % cyc;
    let f = 3;
    if (t < 1) f = 3;
    else if (x < rest) f = 3;
    else if (x < rest + up) f = 3 + ease((x - rest) / up) * (peak - 3);
    else if (x < rest + up + hold) f = peak;
    else f = peak - ease((x - rest - up - hold) / down) * (peak - 3);
    return { kind: 'supine_heel_slide', side: side ?? 'left', kneeFlexion: f };
  }
  if (protocolId === 'knee_sit_to_stand') {
    const seated = p.peak ?? 92;
    const [sit, rise, stand, lower] = [0.5 * k, 0.9 * k, 0.3 * k, 0.9 * k];
    const cyc = sit + rise + stand + lower;
    const t2 = t - 1.2;
    if (t2 < 0) return { kind: 'sit_to_stand_lateral', side: side ?? 'left', kneeFlexion: seated, trunkLean: 8 };
    const i = Math.floor(t2 / cyc);
    const x = t2 - i * cyc;
    if (i >= n) return { kind: 'sit_to_stand_lateral', side: side ?? 'left', kneeFlexion: 3, trunkLean: 5 };
    let f = seated;
    let lean = 8;
    if (x < sit) f = seated;
    else if (x < sit + rise) {
      const u = (x - sit) / rise;
      f = seated - ease(u) * (seated - 3);
      lean = 8 + Math.sin(Math.PI * u) * 32;
    } else if (x < sit + rise + stand) f = 3;
    else f = 3 + ease((x - sit - rise - stand) / lower) * (seated - 3);
    return { kind: 'sit_to_stand_lateral', side: side ?? 'left', kneeFlexion: f, trunkLean: lean };
  }
  if (protocolId === 'shoulder_flexion_active' || protocolId === 'shoulder_abduction_active') {
    const peak = p.peak ?? (protocolId === 'shoulder_flexion_active' ? 150 : 140);
    const [rest, up, hold, down] = [1.0 * k, 1.5 * k, 0.3 * k, 1.5 * k];
    const cyc = rest + up + hold + down;
    const x = t < 1 ? 0 : (t - 1) % cyc;
    let a = 5;
    if (t >= 1 && t < 1 + (p.cycles ?? 3) * cyc) {
      if (x < rest) a = 5;
      else if (x < rest + up) a = 5 + ease((x - rest) / up) * (peak - 5);
      else if (x < rest + up + hold) a = peak;
      else a = peak - ease((x - rest - up - hold) / down) * (peak - 5);
    }
    const lean = (p.trunkLean ?? 0) * ((a - 5) / Math.max(1, peak - 5));
    return protocolId === 'shoulder_flexion_active'
      ? { kind: 'standing_lateral', side: side ?? 'left', shoulderFlexion: a, trunkLean: lean, scale: SHOULDER_FRAMING_SCALE }
      : { kind: 'standing_anterior', armSide: side ?? 'left', shoulderAbduction: a, scale: SHOULDER_FRAMING_SCALE };
  }
  // knee_squat
  const peak = p.peak ?? 0.32;
  const [rest, down, up] = [0.8 * k, 1.2 * k, 1.2 * k];
  const cyc = rest + down + up;
  const t2 = t - 1;
  if (t2 < 0 || t2 >= n * cyc) return { kind: 'squat_anterior', depth: 0 };
  const x = t2 % cyc;
  let d = 0;
  if (x < rest) d = 0;
  else if (x < rest + down) d = ease((x - rest) / down) * peak;
  else d = peak - ease((x - rest - down) / up) * peak;
  const frac = d / peak;
  return { kind: 'squat_anterior', depth: d, valgusLeft: (p.valgusLeft ?? 6) * frac, valgusRight: (p.valgusRight ?? 2) * frac };
}

export function simulateCapture(protocolId: string, side: Side | null, p: SimParams = {}): ProtocolResult {
  const def = getProtocol(protocolId);
  const rec = new ProtocolRecorder(def, side);
  const pipeline = new MotionPipeline();
  const fps = p.fps ?? 30;
  const dt = 1000 / fps;
  let t = 0;
  let seed = p.seed ?? 1;
  while (t / 1000 < def.maxDurationSec) {
    const scene = sceneAt(protocolId, side, t / 1000, p);
    let lms: Landmark[] | null = scene ? synthesize(scene, { noisePx: p.noisePx ?? 1, seed: seed++ }) : null;
    if (lms && p.perturb) lms = p.perturb(lms, t / 1000);
    const frame = pipeline.process({ timestamp: t, width: 720, height: 1280, poses: lms ? [lms] : [], inferenceMs: 4, provider: SIM_PROVIDER });
    rec.update(frame, t, fps);
    if (rec.state.complete) break;
    t += dt;
  }
  return rec.finish(t);
}
