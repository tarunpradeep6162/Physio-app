import { describe, expect, it } from 'vitest';
import { LM } from '../landmarks';
import { decodeFrames, encodeFrames } from './codec';
import { CycleDetector } from './cycles';
import { compareConfig } from './recorder';
import { simulateCapture } from './simulate';

const metric = (r: ReturnType<typeof simulateCapture>, id: string) => r.metrics.find((m) => m.id === id)!;

describe('landmark codec', () => {
  it('round-trips frames with sub-pixel error and null frames', () => {
    const lms = Array.from({ length: 33 }, (_, i) => ({ x: i / 40, y: 1 - i / 50, z: 0, visibility: 0.5 + i / 100 }));
    const enc = encodeFrames([
      { t: 1000, lms },
      { t: 1100, lms: null },
    ]);
    const dec = decodeFrames(enc);
    expect(dec[0].t).toBe(0);
    expect(dec[1].lms).toBeNull();
    expect(Math.abs(dec[0].lms![LM.leftKnee].x - lms[LM.leftKnee].x)).toBeLessThan(1e-4);
    expect(Math.abs(dec[0].lms![LM.leftKnee].visibility - lms[LM.leftKnee].visibility)).toBeLessThan(1e-4);
  });
});

describe('cycle detector', () => {
  it('counts only full excursions and needs a steady start', () => {
    const d = new CycleDetector({ direction: 'up', rest: 20, engaged: 45, minCycleMs: 500, pauseResetMs: 1000, readyMs: 300 });
    const seq = [
      ...Array(20).fill(5),
      ...Array.from({ length: 20 }, (_, i) => 5 + i * 4),
      ...Array.from({ length: 20 }, (_, i) => 85 - i * 4),
      ...Array(10).fill(5),
      // shallow attempt: never reaches 45
      ...Array.from({ length: 10 }, (_, i) => 5 + i * 3),
      ...Array.from({ length: 10 }, (_, i) => 35 - i * 3),
      ...Array(10).fill(5),
    ];
    seq.forEach((v, i) => d.update(i * 33, v));
    expect(d.validCount).toBe(1);
    expect(d.cycles[1].reason).toBe('insufficient_excursion');
  });
});

describe('knee protocols on synthetic captures', () => {
  it('supported knee flexion reports peak flexion and extension position', () => {
    const r = simulateCapture('knee_supported_flexion', 'left', { peak: 118 });
    expect(r.quality.verdict).toBe('valid');
    expect(r.quality.validCycles).toBe(3);
    expect(metric(r, 'knee_flexion_peak').value!).toBeGreaterThan(112);
    expect(metric(r, 'knee_flexion_peak').value!).toBeLessThan(122);
    expect(metric(r, 'knee_extension_position').value!).toBeLessThan(8);
    expect(r.keyframes.map((k) => k.label)).toEqual(['start', 'mid', 'peak', 'return']);
    expect(decodeFrames(r.frames).length).toBeGreaterThan(50);
  });

  it('sit-to-stand times five stands and ends on the fifth stand', () => {
    const r = simulateCapture('knee_sit_to_stand', 'right', { tempo: 1 });
    expect(r.quality.verdict).toBe('valid');
    const time = metric(r, 'sts_time_5');
    expect(time.validity).toBe('valid');
    // 4 full cycles of 2.6 s + the 5th rise (0.5 + 0.9 s), measured onset → standing.
    expect(time.value!).toBeGreaterThan(10.5);
    expect(time.value!).toBeLessThan(12.5);
    expect(metric(r, 'sts_trunk_lean_peak').value!).toBeGreaterThan(25);
    // Simulated rise: 92°→3° over 0.9 s with cosine easing. By definition (plateau − 5° → ≤ 25°)
    // the reference rise time is 0.9 × (u(25°) − u(87°)) = 0.9 × (0.672 − 0.152) ≈ 0.47 s.
    // Before the fix onset was taken at the 61° cycle boundary (≈ 0.24 s).
    expect(metric(r, 'sts_rise_time').value!).toBeGreaterThan(0.35);
    expect(metric(r, 'sts_rise_time').value!).toBeLessThan(0.55);
  });

  it('squat reports signed left/right FPPA and depth', () => {
    const r = simulateCapture('knee_squat', null, { valgusLeft: 10, valgusRight: 2 });
    expect(r.quality.verdict).toBe('valid');
    expect(metric(r, 'squat_fppa_left').value!).toBeGreaterThan(7);
    expect(metric(r, 'squat_fppa_right').value!).toBeLessThan(4);
    expect(metric(r, 'squat_depth').value!).toBeGreaterThan(20);
  });

  it('fails the quality gate and invalidates metrics when a required joint is occluded', () => {
    const r = simulateCapture('knee_supported_flexion', 'left', {
      peak: 118,
      perturb: (lms, t) => {
        if (t > 2) lms[LM.leftKnee] = { ...lms[LM.leftKnee], visibility: 0.2 };
        return lms;
      },
    });
    expect(r.quality.verdict).toBe('invalid');
    expect(r.metrics.every((m) => m.validity === 'invalid')).toBe(true);
    expect(r.quality.issues.occluded).toBeGreaterThan(0);
  });

  it('refuses to measure when the patient faces the wrong way', () => {
    const r = simulateCapture('knee_squat', null, {
      perturb: (lms) => lms.map((l) => ({ ...l, x: 1 - l.x })), // mirrored = back view
    });
    expect(r.quality.verdict).toBe('invalid');
    expect(Object.keys(r.quality.issues)).toContain('wrong_orientation');
  });

  it('refuses to measure when nobody is in view', () => {
    const r = simulateCapture('knee_sit_to_stand', 'left', { perturb: () => null });
    expect(r.quality.verdict).toBe('invalid');
    expect(r.metrics.find((m) => m.id === 'sts_time_5')!.validity).toBe('invalid');
  });
});

describe('reassessment condition matching', () => {
  it('scores how closely the setup matches the baseline (no metric distances)', () => {
    const base = { view: 'lateral_left' as const, facing: 'user' as const, frameWidth: 720, frameHeight: 1280, cameraRollDeg: 0, bodyHeightFrac: 0.7, bodyCenterX: 0.5, bodyCenterY: 0.5 };
    expect(compareConfig(base, base).score).toBe(1);
    const far = compareConfig(base, { ...base, bodyHeightFrac: 0.5 });
    expect(far.checks.find((c) => c.id === 'distance')!.match).toBe(false);
    expect(far.score).toBeLessThan(1);
  });
});
