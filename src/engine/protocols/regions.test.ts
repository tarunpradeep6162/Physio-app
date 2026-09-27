import { describe, expect, it } from 'vitest';
import { LM } from '../landmarks';
import type { Landmark } from '../types';
import { MARCH_MIN_STEPS, REGION_PROTOCOLS, STANCE_TIME_LIMIT_SEC } from './regions';
import { getProtocol } from './registry';
import { simulateCapture } from './simulate';

const val = (r: ReturnType<typeof simulateCapture>, id: string) => {
  const m = r.metrics.find((x) => x.id === id)!;
  return m.validity === 'valid' ? m.value : null;
};
const setVis = (idxs: number[], v: number) => (l: Landmark[]) => l.map((p, i) => (idxs.includes(i) ? { ...p, visibility: v } : p));

describe('Phases 12–15 — every region protocol is registered, versioned and documented', () => {
  it('has setup, limitations, framing, a guide and a versioned algorithm; no invented rotation, strength, fall-risk or norm metrics', () => {
    for (const p of REGION_PROTOCOLS) {
      expect(getProtocol(p.id)).toBe(p);
      expect(p.algorithmVersion).toBe('dl-regions-1.0.0');
      expect(p.setup.length).toBeGreaterThan(1);
      expect(p.limitations.length).toBeGreaterThan(1);
      expect(p.framing && p.guide).toBeTruthy();
    }
    const metricIds = REGION_PROTOCOLS.flatMap((p) => simulateCapture(p.id, p.sided ? 'left' : null).metrics.map((m) => `${m.id} ${m.label}`)).join(' ');
    expect(metricIds).not.toMatch(/rotation|strength|force|fall.?risk|normal|severity|lumbar range/i);
    const limits = REGION_PROTOCOLS.map((p) => p.limitations.join(' ')).join(' ');
    expect(limits).toMatch(/rotation/i);
    expect(limits).toMatch(/strength/i);
    expect(limits).toMatch(/fall risk/i);
  });
});

describe('Phase 12 — hip', () => {
  it('recovers the simulated hip flexion and abduction on both sides', () => {
    for (const s of ['left', 'right'] as const) {
      expect(val(simulateCapture('hip_flexion_standing', s, { peak: 95 }), 'hip_flexion_peak')).toBeCloseTo(95, 0);
      expect(val(simulateCapture('hip_abduction_standing', s, { peak: 30 }), 'hip_abduction_peak')).toBeCloseTo(30, 0);
    }
  });
  it('withholds the value when the tested knee is hidden (e.g. behind the support)', () => {
    const r = simulateCapture('hip_flexion_standing', 'left', { perturb: (l, t) => (t > 2 ? setVis([LM.leftKnee], 0.2)(l) : l) });
    expect(r.quality.verdict).toBe('invalid');
    expect(val(r, 'hip_flexion_peak')).toBeNull();
  });
});

describe('Phase 13 — ankle and foot', () => {
  it('recovers the lunge shin angle and counts heel raises', () => {
    expect(val(simulateCapture('ankle_knee_to_wall', 'right', { peak: 40 }), 'knee_to_wall_shin_angle')).toBeCloseTo(40, 0);
    const h = simulateCapture('heel_raise_double', null, { cycles: 7, peak: 25 });
    expect(val(h, 'heel_raise_count')).toBe(7);
    expect(val(h, 'heel_raise_height_angle')).toBeCloseTo(25, 0);
  });
  it('shoe or foot occlusion invalidates dependent metrics', () => {
    const r = simulateCapture('ankle_knee_to_wall', 'left', { perturb: (l, t) => (t > 1.5 ? setVis([LM.leftHeel, LM.leftFootIndex], 0.25)(l) : l) });
    expect(r.quality.verdict).toBe('invalid');
    expect(val(r, 'knee_to_wall_shin_angle')).toBeNull();
  });
  it('the wrong view (the other side facing the camera) produces no value', () => {
    const r = simulateCapture('ankle_knee_to_wall', 'left', { perturb: (l) => l.map((p) => ({ ...p, x: 1 - p.x })) });
    expect(val(r, 'knee_to_wall_shin_angle')).toBeNull();
  });
  it('partial framing (toes out of frame) invalidates the capture', () => {
    const r = simulateCapture('heel_raise_double', null, { perturb: (l) => l.map((p, i) => (i === LM.leftFootIndex ? { ...p, y: 1.01 } : p)) });
    expect(r.quality.verdict).toBe('invalid');
    expect(val(r, 'heel_raise_count')).toBeNull();
  });
  it('a lunge repetition with the heel lifted is excluded from the heel-down measurement', () => {
    // Heel landmark rises during every lunge (after the start baseline).
    const r = simulateCapture('ankle_knee_to_wall', 'left', { perturb: (l, t) => (t > 2.2 ? l.map((p, i) => (i === LM.leftHeel ? { ...p, y: p.y - 0.02 } : p)) : l) });
    expect(val(r, 'knee_to_wall_shin_angle')).toBeNull();
    expect(r.metrics.find((m) => m.id === 'knee_to_wall_shin_angle')!.reason).toMatch(/heel lifted/i);
  });
});

describe('Phase 14 — spine and neck', () => {
  it('recovers trunk forward bend and side bend; neck reported as change from the start in both directions', () => {
    expect(val(simulateCapture('trunk_forward_bend', null, { peak: 60 }), 'trunk_forward_bend_peak')).toBeCloseTo(60, 0);
    expect(val(simulateCapture('trunk_side_bend', 'right', { peak: 20 }), 'trunk_side_bend_peak')).toBeCloseTo(20, 0);
    const n = simulateCapture('neck_flexion_extension', null, { peak: 35, peakBack: 25 });
    // Ear-on-shoulder proxy: close to, not identical with, the simulated head rotation.
    expect(Math.abs(val(n, 'neck_flexion_change')! - 35)).toBeLessThan(3);
    expect(Math.abs(val(n, 'neck_extension_change')! - 25)).toBeLessThan(3);
  });
  it('a forward-leaning start posture does not change the neck result (posture is not measured)', () => {
    const a = simulateCapture('neck_flexion_extension', null, { peak: 30, peakBack: 20 });
    const b = simulateCapture('neck_flexion_extension', null, { peak: 30, peakBack: 20, perturb: (l) => l.map((p, i) => (i === LM.leftEar || i === LM.rightEar ? { ...p, x: p.x - 0.01 } : p)) });
    expect(Math.abs(val(a, 'neck_flexion_change')! - val(b, 'neck_flexion_change')!)).toBeLessThan(3);
  });
  it('hidden ear (hair, hood) withholds the neck value', () => {
    const r = simulateCapture('neck_flexion_extension', null, { perturb: (l, t) => (t > 2 ? setVis([LM.leftEar], 0.2)(l) : l) });
    expect(val(r, 'neck_flexion_change')).toBeNull();
  });
});

describe('Phase 15 — balance and gait, timing checked against simulated reference captures', () => {
  it('single-leg stance time matches the reference within one frame, and stops at the time limit', () => {
    for (const sec of [2.5, 7, 15]) {
      const r = simulateCapture('single_leg_stance', 'right', { stanceSec: sec });
      expect(Math.abs(val(r, 'single_leg_stance_time')! - (sec + 0.2))).toBeLessThanOrEqual(0.2 + 1 / 30);
    }
    expect(val(simulateCapture('single_leg_stance', 'left', { stanceSec: 45 }), 'single_leg_stance_time')).toBe(STANCE_TIME_LIMIT_SEC);
  });
  it('an unsafe or incomplete trial stops without a number: lost tracking mid-stance invalidates it', () => {
    const r = simulateCapture('single_leg_stance', 'left', { stanceSec: 10, perturb: (l, t) => (t > 5 && t < 6 ? null : l) });
    expect(val(r, 'single_leg_stance_time')).toBeNull();
    const occluded = simulateCapture('single_leg_stance', 'left', { stanceSec: 10, perturb: (l, t) => (t > 4 ? setVis([LM.rightAnkle], 0.2)(l) : l) });
    expect(val(occluded, 'single_leg_stance_time')).toBeNull();
  });
  it('marching cadence matches the reference; one-sided detection and too few steps withhold values', () => {
    for (const cad of [70, 100, 120]) expect(Math.abs(val(simulateCapture('march_in_place', null, { cadence: cad }), 'march_cadence')! - cad)).toBeLessThanOrEqual(2);
    const lop = simulateCapture('march_in_place', null, { cadence: 80, rightLiftRatio: 0.6 });
    expect(val(lop, 'march_cadence')).toBeNull();
    expect(lop.metrics.find((m) => m.id === 'march_cadence')!.reason).toMatch(/only one foot/);
    const few = simulateCapture('march_in_place', null, { cycles: MARCH_MIN_STEPS - 4 });
    expect(few.quality.verdict).toBe('invalid');
  });
});
