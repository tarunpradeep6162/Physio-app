import { MotionPipeline } from '../pipeline';
import { synthesize, type SynthScene } from '../pose/synthetic';
import type { Landmark, PoseProviderInfo, Side } from '../types';
import { getProtocol } from './registry';

/** Protocol ids the synthetic scene generator can animate. */
export const SIMULATED_PROTOCOLS = new Set(['knee_supported_flexion', 'knee_sit_to_stand', 'knee_squat', 'shoulder_flexion_active', 'shoulder_abduction_active', 'hip_flexion_standing', 'hip_abduction_standing', 'ankle_knee_to_wall', 'heel_raise_double', 'trunk_forward_bend', 'trunk_side_bend', 'neck_flexion_extension', 'single_leg_stance', 'march_in_place']);
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
  /** Neck: backward movement peak (deg, positive number) for the extension repetitions. */
  peakBack?: number;
  /** Single-leg stance: seconds the foot stays up (reference timing). */
  stanceSec?: number;
  /** Marching: steps per minute. */
  cadence?: number;
  /** Marching: lift height of the right foot relative to the left (1 = equal). */
  rightLiftRatio?: number;
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
  const region = regionScene(protocolId, side, t, p);
  if (region !== undefined) return region;
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

/** rest → rise → hold → lower cycles; returns 0..1 of the movement at time t (0 before start/after end). */
function cyc(t: number, k: number, n: number, rest = 1.0, up = 1.4, hold = 0.4, down = 1.4, start = 1) {
  const c = (rest + up + hold + down) * k;
  if (t < start || t >= start + n * c) return { f: 0, i: -1 };
  const i = Math.floor((t - start) / c);
  const x = (t - start - i * c) / k;
  if (x < rest) return { f: 0, i };
  if (x < rest + up) return { f: ease((x - rest) / up), i };
  if (x < rest + up + hold) return { f: 1, i };
  return { f: 1 - ease((x - rest - up - hold) / down), i };
}

function regionScene(id: string, side: Side | null, t: number, p: SimParams): SynthScene | null | undefined {
  const k = p.tempo ?? 1;
  const s = side ?? 'left';
  const opp: Side = s === 'left' ? 'right' : 'left';
  switch (id) {
    case 'hip_flexion_standing': {
      const a = 3 + cyc(t, k, p.cycles ?? 3).f * ((p.peak ?? 100) - 3);
      return { kind: 'standing_lateral', side: s, hipFlexion: a, kneeFlexion: a, scale: 0.9 };
    }
    case 'hip_abduction_standing':
      return { kind: 'standing_anterior', legSide: s, hipAbduction: 2 + cyc(t, k, p.cycles ?? 3).f * ((p.peak ?? 35) - 2), scale: 0.9 };
    case 'ankle_knee_to_wall':
      return { kind: 'lunge_lateral', side: s, shankTilt: 5 + cyc(t, k, p.cycles ?? 3, 1.0, 1.5, 2.0, 1.5).f * ((p.peak ?? 38) - 5) };
    case 'heel_raise_double':
      return { kind: 'standing_lateral', side: s, heelLift: cyc(t, k, p.cycles ?? 10, 0.4, 0.8, 0.2, 0.8).f * (p.peak ?? 30), scale: 0.9 };
    case 'trunk_forward_bend':
      return { kind: 'standing_lateral', side: s, trunkLean: cyc(t, k, p.cycles ?? 3, 1.0, 2.0, 0.5, 2.0).f * (p.peak ?? 70), scale: 0.85 };
    case 'trunk_side_bend': {
      const a = cyc(t, k, p.cycles ?? 3).f * (p.peak ?? 25);
      return { kind: 'standing_anterior', trunkSideBend: s === 'left' ? a : -a, scale: 0.85 };
    }
    case 'neck_flexion_extension': {
      const { f, i } = cyc(t, k, p.cycles ?? 4, 1.0, 1.2, 0.4, 1.2);
      const peak = i % 2 === 0 ? (p.peak ?? 40) : -(p.peakBack ?? 30);
      return { kind: 'standing_lateral', side: s, neckFlexion: f * peak, scale: 0.9 };
    }
    case 'single_leg_stance': {
      const dur = p.stanceSec ?? 10;
      const t0 = 2;
      const ramp = 0.2;
      const f = t < t0 || t > t0 + dur + ramp ? 0 : t < t0 + ramp ? ease((t - t0) / ramp) : t > t0 + dur ? 1 - ease((t - t0 - dur) / ramp) : 1;
      return { kind: 'standing_anterior', footLift: { side: opp, height: 0.12 * f }, offsetX: 0.01 * Math.sin(t * 3) * f, scale: 0.9 };
    }
    case 'march_in_place': {
      const period = 60 / (p.cadence ?? 100);
      const n = p.cycles ?? 20;
      const t0 = 1.5;
      if (t < t0 || t >= t0 + n * period) return { kind: 'standing_anterior', scale: 0.9 };
      const i = Math.floor((t - t0) / period);
      const x = (t - t0 - i * period) / period;
      const lifted: Side = i % 2 === 0 ? 'left' : 'right';
      const h = x < 0.7 ? Math.sin((Math.PI * x) / 0.7) : 0;
      const ratio = lifted === 'right' ? (p.rightLiftRatio ?? 1) : 1;
      return { kind: 'standing_anterior', footLift: { side: lifted, height: 0.14 * h * ratio }, scale: 0.9 };
    }
    default:
      return undefined;
  }
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
