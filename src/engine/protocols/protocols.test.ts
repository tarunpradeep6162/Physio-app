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

  it('still measures on a slow device (10 fps), within the same tolerance', () => {
    const r = simulateCapture('knee_supported_flexion', 'right', { peak: 118, fps: 10 });
    expect(r.quality.verdict).toBe('valid');
    expect(metric(r, 'knee_flexion_peak').value!).toBeGreaterThan(112);
    expect(metric(r, 'knee_flexion_peak').value!).toBeLessThan(122);
  });

  it('refuses to measure when part of the body leaves the frame', () => {
    const r = simulateCapture('knee_squat', null, {
      perturb: (lms, t) => (t > 2 ? lms.map((l, i) => (i === LM.leftAnkle || i === LM.rightAnkle ? { ...l, y: 1.2 } : l)) : lms),
    });
    expect(r.quality.verdict).toBe('invalid');
    expect(Object.keys(r.quality.issues)).toContain('out_of_frame');
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

describe('engine change during capture', () => {
  it('invalidates every metric when the tracking engine changed mid-capture', async () => {
    const { ProtocolRecorder } = await import('./recorder');
    const { getProtocol } = await import('./registry');
    const { MotionPipeline } = await import('../pipeline');
    const { sceneAt, SIM_PROVIDER } = await import('./simulate');
    const { synthesize } = await import('../pose/synthetic');
    const rec = new ProtocolRecorder(getProtocol('knee_supported_flexion'), 'left');
    const pipe = new MotionPipeline();
    let t = 0;
    for (; t < 16000; t += 33) {
      const lms = synthesize(sceneAt('knee_supported_flexion', 'left', t / 1000, { peak: 110 })!);
      rec.update(pipe.process({ timestamp: t, width: 720, height: 1280, poses: [lms], inferenceMs: 4, provider: SIM_PROVIDER }), t, 30);
      if (t === 6006) rec.invalidate('Tracking engine changed during capture');
    }
    const r = rec.finish(t);
    expect(r.quality.verdict).toBe('invalid');
    expect(r.quality.reasons).toContain('Tracking engine changed during capture');
    expect(r.metrics.every((m) => m.validity === 'invalid')).toBe(true);
  });
});

describe('per-test framing (v1.1.0)', () => {
  it('a heel slide framed on the leg passes even with the head out of frame; whole-body rules would refuse it', async () => {
    const { evaluateCalibration } = await import('../calibration');
    const { MotionPipeline } = await import('../pipeline');
    const { synthesize } = await import('../pose/synthetic');
    const { getProtocol } = await import('./registry');
    const { SIM_PROVIDER } = await import('./simulate');
    const def = getProtocol('knee_supported_flexion');
    expect(def.version).toBe('1.1.0');
    // Left heel slide (head at image-right). Shift the body so the head leaves the frame.
    const lms = synthesize({ kind: 'supine_heel_slide', side: 'left', kneeFlexion: 3 }).map((l) => ({ ...l, x: l.x + 0.2 }));
    expect(lms[LM.nose].x).toBeGreaterThan(1);
    const pipe = new MotionPipeline();
    let f = pipe.process({ timestamp: 0, width: 720, height: 1280, poses: [lms], inferenceMs: 1, provider: SIM_PROVIDER });
    for (let t = 33; t < 400; t += 33) f = pipe.process({ timestamp: t, width: 720, height: 1280, poses: [lms], inferenceMs: 1, provider: SIM_PROVIDER });
    const fr = def.framing!;
    const base = { landmarks: def.requiredLandmarks('left'), views: def.views('left'), minConfidence: 0.65, maxRollDeg: 4 };
    const now = evaluateCalibration({ frame: f, req: { ...base, heightRange: fr.range, extentAxis: fr.axis, extentLandmarks: fr.extentLandmarks('left') }, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user' });
    const old = evaluateCalibration({ frame: f, req: { ...base, heightRange: [0.45, 0.98], extentAxis: 'horizontal' }, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user' });
    expect(now.checks.find((c) => c.id === 'distance')!.status).toBe('pass');
    expect(old.checks.find((c) => c.id === 'distance')!.status).toBe('fail');
  });

  it('keeps v1.0.0 definitions for existing records', async () => {
    const { getProtocol, PROTOCOL_VERSIONS } = await import('./registry');
    expect(getProtocol('knee_squat', '1.0.0').version).toBe('1.0.0');
    expect(getProtocol('knee_squat', '1.0.0').framing).toBeUndefined();
    expect(PROTOCOL_VERSIONS).toEqual(expect.arrayContaining(['knee_squat@1.0.0', 'knee_squat@1.1.0']));
  });
});
