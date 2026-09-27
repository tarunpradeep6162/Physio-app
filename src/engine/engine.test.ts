import { describe, expect, it } from 'vitest';
import { evaluateCalibration, CalibrationGate, lightingFromPixels, type CalibrationRequirements } from './calibration';
import { defaultPrescription, validatePrescription } from './exercises/definitions';
import { simulateExercise } from './exercises/simulateSession';
import { painRuleOutcome } from './exercises/painRule';
import { ExerciseRunner, type RunnerEvent } from './exerciseRunner';
import { EmaFilter, KalmanFilter1D, OneEuroFilter } from './filters';
import { FULL_BODY_LANDMARKS, LM } from './landmarks';
import { estimate } from './measurements';
import { detectOrientation, MotionPipeline, type ProcessedFrame } from './pipeline';
import { synthesize, type SynthScene } from './pose/synthetic';
import { computePostureMetrics, PostureCapture } from './posture';
import { RepStateMachine } from './stateMachine';
import type { PoseFrame } from './types';
import { deviationFromVertical, jointAngle, tiltFromHorizontal } from './vector';

const W = 720;
const H = 1280;
const provider = { id: 'test', model: 'synthetic', version: '0', simulated: true };

function frameOf(scene: SynthScene | null, t: number, noisePx = 0, seed = 1): PoseFrame {
  return { timestamp: t, width: W, height: H, poses: scene ? [synthesize(scene, { noisePx, seed })] : [], inferenceMs: 5, provider };
}

describe('vector math', () => {
  it('computes the A-B-C interior angle', () => {
    expect(jointAngle({ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90, 6);
    expect(jointAngle({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(180, 6);
    expect(jointAngle({ x: 10, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(45, 6);
  });
  it('refuses degenerate segments instead of returning a number', () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });
  it('measures tilt and vertical deviation with image-y pointing down', () => {
    expect(tiltFromHorizontal({ x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(0);
    expect(tiltFromHorizontal({ x: 0, y: 0 }, { x: 100, y: -100 })).toBeCloseTo(45);
    expect(deviationFromVertical({ x: 0, y: 100 }, { x: 0, y: 0 })).toBeCloseTo(0);
    expect(deviationFromVertical({ x: 0, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(45);
  });
});

describe('filters', () => {
  const noisy = (i: number) => 90 + Math.sin(i * 12.9898) * 3; // deterministic ±3° jitter
  for (const [name, f] of [
    ['one euro', new OneEuroFilter({ minCutoff: 1.2, beta: 0.015, dCutoff: 1 })],
    ['ema', new EmaFilter(110)],
    ['kalman', new KalmanFilter1D(2500, 6)],
  ] as const) {
    it(`${name} reduces jitter on a static signal`, () => {
      const out: number[] = [];
      for (let i = 0; i < 120; i++) out.push(f.filter(noisy(i), i * 33));
      const tail = out.slice(60);
      const sd = Math.sqrt(tail.reduce((a, v) => a + (v - 90) ** 2, 0) / tail.length);
      expect(sd).toBeLessThan(2.1);
    });
  }
});

describe('measurements', () => {
  it('gates draft shoulder abduction to the front view and refuses a hidden elbow', () => {
    const lms = synthesize({ kind: 'standing_anterior', armSide: 'left', shoulderAbduction: 85 });
    const e = estimate('shoulder_abduction', lms, W, H, 'left', { view: 'anterior' });
    expect(e.value).not.toBeNull();
    expect(e.value!).toBeCloseTo(85, 0);
    expect(estimate('shoulder_abduction', lms, W, H, 'left', { view: 'lateral_left' }).reason).toBe('wrong_orientation');
    lms[LM.leftElbow] = { ...lms[LM.leftElbow], visibility: 0.2 };
    expect(estimate('shoulder_abduction', lms, W, H, 'left', { view: 'anterior' }).reason).toBe('occluded');
  });
  it('runs prescribed shoulder abduction through the same rep engine', () => {
    const rx = { ...defaultPrescription('shoulder_abduction', 'left'), reps: 2, sets: 1, restSeconds: 0 };
    const result = simulateExercise(rx, 80, 15);
    expect(result.repsCompleted).toBe(2);
  });
  it('estimates knee flexion from a lateral view', () => {
    for (const flex of [0, 45, 90, 120]) {
      const lms = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: flex });
      const e = estimate('knee_flexion', lms, W, H, 'left', { view: 'lateral_left' });
      expect(e.value).not.toBeNull();
      expect(e.value!).toBeCloseTo(flex, 0);
    }
  });
  it('estimates shoulder flexion and straight-leg raise', () => {
    // Arm overhead: leave headroom — an elbow in the outer 4% edge band is treated as out of frame.
    const sh0 = synthesize({ kind: 'standing_lateral', side: 'right', shoulderFlexion: 150 });
    expect(estimate('shoulder_flexion', sh0, W, H, 'right', { view: 'lateral_right' }).reason).toBe('out_of_frame');
    const sh = sh0.map((l) => ({ ...l, y: l.y + 0.04 }));
    expect(estimate('shoulder_flexion', sh, W, H, 'right', { view: 'lateral_right' }).value!).toBeCloseTo(150, 0);
    const slr = synthesize({ kind: 'supine_lateral', side: 'left', legRaise: 40 });
    expect(estimate('hip_flexion_slr', slr, W, H, 'left', { view: 'lateral_left' }).value!).toBeCloseTo(40, 0);
  });
  it('corrects for non-square frames (angles computed in pixel space)', () => {
    const lms = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: 60 }, { width: 1280, height: 720 });
    expect(estimate('knee_flexion', lms, 1280, 720, 'left', { view: 'lateral_left' }).value!).toBeCloseTo(60, 0);
  });
  it('returns null (never a number) for occluded landmarks or the wrong orientation', () => {
    const lms = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: 60 });
    lms[LM.leftKnee].visibility = 0.2;
    const occluded = estimate('knee_flexion', lms, W, H, 'left', { view: 'lateral_left' });
    expect(occluded.value).toBeNull();
    expect(occluded.reason).toBe('occluded');
    const ok = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: 60 });
    const wrongView = estimate('knee_flexion', ok, W, H, 'left', { view: 'anterior' });
    expect(wrongView.value).toBeNull();
    expect(wrongView.reason).toBe('wrong_orientation');
  });
  it('returns null when a landmark is outside the frame', () => {
    const lms = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: 30 });
    lms[LM.leftAnkle].y = 1.2;
    expect(estimate('knee_flexion', lms, W, H, 'left').reason).toBe('out_of_frame');
  });
});

describe('orientation detection', () => {
  it('distinguishes anterior, lateral-left and lateral-right views', () => {
    expect(detectOrientation(synthesize({ kind: 'standing_anterior' }), W, H).view).toBe('anterior');
    expect(detectOrientation(synthesize({ kind: 'standing_lateral', side: 'left' }), W, H).view).toBe('lateral_left');
    expect(detectOrientation(synthesize({ kind: 'standing_lateral', side: 'right' }), W, H).view).toBe('lateral_right');
    expect(detectOrientation(synthesize({ kind: 'supine_lateral', side: 'right' }), W, H).view).toBe('lateral_right');
  });
});

describe('pipeline', () => {
  it('reports no person and multiple people without guessing', () => {
    const p = new MotionPipeline();
    expect(p.process(frameOf(null, 0)).status).toBe('no_person');
    const lm = synthesize({ kind: 'standing_anterior' });
    const multi = p.process({ timestamp: 10, width: W, height: H, poses: [lm, lm], inferenceMs: 4, provider });
    expect(multi.status).toBe('multiple_people');
    expect(multi.smoothed).toBeNull();
  });
});

describe('calibration', () => {
  const req: CalibrationRequirements = { landmarks: FULL_BODY_LANDMARKS, views: ['anterior'], heightRange: [0.5, 0.95], minConfidence: 0.7, maxRollDeg: 3 };
  const run = (scene: SynthScene | null, roll: number | null = 0, luma = 140) => {
    const p = new MotionPipeline('none');
    let f!: ProcessedFrame;
    // Past the re-acquisition window (identity stable) so only the scene checks decide.
    for (let i = 0; i < 20; i++) f = p.process(frameOf(scene, i * 33));
    return evaluateCalibration({ frame: f, req, lighting: { meanLuma: luma, clippedFraction: 0 }, cameraRollDeg: roll, facing: 'user' });
  };
  it('passes a well-framed, level, well-lit subject', () => {
    const r = run({ kind: 'standing_anterior' });
    expect(r.frameReady).toBe(true);
    expect(r.instruction).toBe('ready');
  });
  it('asks the person to move back when too close, and closer when too far', () => {
    expect(run({ kind: 'standing_anterior', scale: 1.4 }).instruction).toBe('move_back');
    expect(run({ kind: 'standing_anterior', scale: 0.5 }).instruction).toBe('move_closer');
  });
  it('gives mirrored-aware left/right instructions', () => {
    // Subject on image-right in a front camera = too far to their own left → "move right".
    expect(run({ kind: 'standing_anterior', offsetX: 0.25 }).instruction).toBe('move_right');
  });
  it('fails when any single required landmark is occluded, even if the mean is high', () => {
    const p = new MotionPipeline('none');
    let f!: ProcessedFrame;
    for (let i = 0; i < 10; i++) {
      const lm = synthesize({ kind: 'standing_anterior' });
      lm[LM.leftKnee].visibility = 0.35; // e.g. hidden behind a chair
      f = p.process({ timestamp: i * 33, width: W, height: H, poses: [lm], inferenceMs: 5, provider });
    }
    const r = evaluateCalibration({ frame: f, req, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user' });
    expect(r.frameReady).toBe(false);
    expect(r.checks.find((c) => c.id === 'confidence')?.detail).toContain('leftKnee');
  });
  it('judges distance horizontally for a patient lying down', () => {
    const p = new MotionPipeline('none');
    let f!: ProcessedFrame;
    for (let i = 0; i < 20; i++) f = p.process(frameOf({ kind: 'supine_heel_slide', side: 'left', kneeFlexion: 5 }, i * 33));
    const lying = { landmarks: [LM.leftHip, LM.leftKnee, LM.leftAnkle], views: ['lateral_left' as const], heightRange: [0.45, 0.98] as [number, number], minConfidence: 0.65, maxRollDeg: 4 };
    const vertical = evaluateCalibration({ frame: f, req: lying, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user' });
    expect(vertical.instruction).toBe('move_closer');
    const horizontal = evaluateCalibration({ frame: f, req: { ...lying, extentAxis: 'horizontal' }, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user' });
    expect(horizontal.frameReady).toBe(true);
  });
  it('flags camera tilt, poor lighting and absence', () => {
    expect(run({ kind: 'standing_anterior' }, 8).instruction).toBe('camera_tilted');
    expect(run({ kind: 'standing_anterior' }, 0, 30).instruction).toBe('increase_lighting');
    expect(run(null).instruction).toBe('no_person');
  });
  it('requires calibration to remain stable before scanning', () => {
    const gate = new CalibrationGate(1000);
    const ok = run({ kind: 'standing_anterior' });
    expect(gate.update(ok, 0).ready).toBe(false);
    expect(gate.update(ok, 600).ready).toBe(false);
    expect(gate.update(run(null), 700).ready).toBe(false);
    expect(gate.update(ok, 800).ready).toBe(false);
    expect(gate.update(ok, 1850).ready).toBe(true);
  });
  it('computes lighting from pixels', () => {
    const dark = new Uint8ClampedArray(4 * 16).fill(20);
    expect(lightingFromPixels(dark).meanLuma).toBeLessThan(25);
  });
});

describe('posture', () => {
  it('estimates shoulder and pelvic level differences with direction', () => {
    const lms = synthesize({ kind: 'standing_anterior', shoulderTiltDeg: 3.4, pelvicTiltDeg: -2 });
    const m = computePostureMetrics(lms, W, H, 'anterior');
    const sh = m.find((x) => x.id === 'shoulder_level')!;
    expect(sh.value).toBeCloseTo(3.4, 1);
    expect(sh.direction).toBe('left_higher');
    const pv = m.find((x) => x.id === 'pelvic_level')!;
    expect(pv.value).toBeCloseTo(2, 1);
    expect(pv.direction).toBe('right_higher');
  });
  it('aggregates a capture window and reports stability', () => {
    const cap = new PostureCapture();
    for (let i = 0; i < 60; i++) {
      const lms = synthesize({ kind: 'standing_anterior', shoulderTiltDeg: 3 }, { noisePx: 1, seed: i + 1 });
      cap.add(computePostureMetrics(lms, W, H, 'anterior'));
    }
    const sh = cap.result().find((x) => x.id === 'shoulder_level')!;
    expect(sh.value).toBeGreaterThan(2);
    expect(sh.value).toBeLessThan(4);
    expect(sh.samples).toBe(60);
    expect(['high', 'moderate']).toContain(sh.level);
  });
  it('skips metrics computed from occluded landmarks', () => {
    const lms = synthesize({ kind: 'standing_anterior', shoulderTiltDeg: 3 });
    lms[LM.leftShoulder].visibility = 0.1;
    expect(computePostureMetrics(lms, W, H, 'anterior').find((x) => x.id === 'shoulder_level')).toBeUndefined();
  });
  it('withholds lateral plumb offsets when a foot-direction landmark is hidden', () => {
    const lms = synthesize({ kind: 'standing_lateral', side: 'left' });
    lms[LM.leftHeel].visibility = 0.1;
    const metrics = computePostureMetrics(lms, W, H, 'lateral_left');
    expect(metrics.some((m) => m.id.startsWith('plumb_'))).toBe(false);
  });
});

/** Drives the state machine with a synthetic angle profile at 30 fps. */
function drive(sm: RepStateMachine, profile: (t: number) => number | null, seconds: number) {
  const events: string[] = [];
  for (let t = 0; t <= seconds * 1000; t += 33) {
    for (const e of sm.update(t, profile(t / 1000))) events.push(e.type);
  }
  return events;
}

const cfg = () => ({
  target: { min: 80, max: 100 },
  holdSeconds: 2,
  minRepMs: 2000,
  maxVelocityDegPerSec: 400,
  thresholds: { restThreshold: 20, startDelta: 10, approachMargin: 15, holdTolerance: 6, overTolerance: 10, pauseResetMs: 2500, readyStableMs: 500 },
});

/** rest 1s → up 1.5s → hold h s → down 1.5s, repeated. */
function repProfile(peak: number, hold: number, reps: number) {
  const cycle = 1 + 1.5 + hold + 1.5;
  return (t: number) => {
    if (t >= cycle * reps) return 0;
    const k = t % cycle;
    if (k < 1) return 0;
    if (k < 2.5) return ((k - 1) / 1.5) * peak;
    if (k < 2.5 + hold) return peak;
    return peak * (1 - (k - 2.5 - hold) / 1.5);
  };
}

describe('rep state machine', () => {
  it('counts complete reps only after target, hold and return', () => {
    const sm = new RepStateMachine(cfg());
    const events = drive(sm, repProfile(90, 2.5, 3), 3 * 6.5 + 1);
    expect(sm.snapshot.repsCounted).toBe(3);
    expect(events.filter((e) => e === 'rep_complete')).toHaveLength(3);
    expect(events).toContain('hold_countdown');
  });

  it('does not count reps that miss the target', () => {
    const sm = new RepStateMachine(cfg());
    const events = drive(sm, repProfile(65, 2.5, 2), 14);
    expect(sm.snapshot.repsCounted).toBe(0);
    expect(events.filter((e) => e === 'rep_incomplete')).toHaveLength(2);
    expect(sm.reps.every((r) => r.reason === 'target_not_reached')).toBe(true);
  });

  it('does not count reps whose hold is too short', () => {
    const sm = new RepStateMachine(cfg());
    drive(sm, repProfile(90, 0.8, 2), 10);
    expect(sm.snapshot.repsCounted).toBe(0);
    expect(sm.reps.every((r) => r.reason === 'hold_incomplete')).toBe(true);
  });

  it('never double-counts jitter around thresholds', () => {
    const sm = new RepStateMachine(cfg());
    const base = repProfile(90, 2.5, 1);
    // ±5° jitter at every frame, including around rest/start and target thresholds.
    drive(sm, (t) => base(t) + Math.sin(t * 97) * 5, 8);
    expect(sm.snapshot.repsCounted).toBe(1);
    expect(sm.reps).toHaveLength(1);
  });

  it('pauses on tracking loss without accumulating hold time', () => {
    const sm = new RepStateMachine(cfg());
    // Target (80°) is reached at ~2.3s and the limb stays above the hold tolerance until ~5.3s,
    // i.e. ~3s of hold with continuous tracking. Losing tracking for 1.1s leaves ~1.9s observed,
    // which must NOT satisfy the 2s hold.
    const base = repProfile(90, 2.5, 1);
    const events = drive(sm, (t) => (t > 2.8 && t < 3.9 ? null : base(t)), 8);
    expect(events).toContain('tracking_lost');
    expect(events).toContain('tracking_regained');
    const rep = sm.reps[0];
    expect(rep.heldSeconds).toBeLessThan(2);
    expect(rep.holdAchieved).toBe(false);
    expect(rep.counted).toBe(false);
  });

  it('discards an attempt after a long tracking gap', () => {
    const sm = new RepStateMachine(cfg());
    const base = repProfile(90, 2.5, 1);
    const events = drive(sm, (t) => (t > 2 && t < 6 ? null : base(t)), 9);
    expect(events).toContain('rep_discarded');
    expect(sm.snapshot.repsCounted).toBe(0);
  });

  it('flags movement beyond the prescribed maximum', () => {
    const sm = new RepStateMachine(cfg());
    const events = drive(sm, repProfile(125, 2.5, 1), 8);
    expect(events).toContain('over_target');
  });
});

describe('exercise runner (end-to-end on synthetic frames)', () => {
  it('runs a prescribed knee-flexion set through pipeline, measurement and state machine', () => {
    const rx = { ...defaultPrescription('knee_flexion', 'left'), reps: 3, sets: 1, holdSeconds: 2 };
    expect(validatePrescription(rx)).toEqual([]);
    const runner = new ExerciseRunner(rx);
    const pipeline = new MotionPipeline();
    const angle = repProfile(92, 2.6, 3);
    const all: RunnerEvent[] = [];
    for (let t = 0; t <= 22000; t += 33) {
      const a = angle(t / 1000);
      const f = pipeline.process(frameOf({ kind: 'standing_lateral', side: 'left', kneeFlexion: 3 + (a ?? 0) }, t, 1.2, t + 1));
      all.push(...runner.update(f, t));
    }
    const res = runner.result();
    expect(res.repsCompleted).toBe(3);
    expect(all.some((e) => e.type === 'exercise_complete')).toBe(true);
    expect(res.peakRom!).toBeGreaterThan(85);
    expect(res.peakRom!).toBeLessThan(100);
    expect(res.trackingCoverage).toBeGreaterThan(0.95);
    expect(res.definitionVersion).toBe('1.0.0');
  });

  it('pauses measurement when the patient faces the wrong way', () => {
    const rx = { ...defaultPrescription('knee_flexion', 'left'), reps: 2, sets: 1 };
    const runner = new ExerciseRunner(rx);
    const pipeline = new MotionPipeline();
    let paused = false;
    for (let t = 0; t < 2000; t += 33) {
      const f = pipeline.process(frameOf({ kind: 'standing_anterior' }, t));
      for (const e of runner.update(f, t)) if (e.type === 'measurement_paused') paused = true;
    }
    expect(paused).toBe(true);
    expect(runner.snapshot.estimate.value).toBeNull();
    expect(runner.result().repsAttempted).toBe(0);
  });

  it('rejects unsafe prescriptions', () => {
    const rx = { ...defaultPrescription('straight_leg_raise', 'right'), target: { min: 70, max: 120 } };
    expect(validatePrescription(rx)).toContain('target_out_of_range');
  });
});

describe('pain-pause rule', () => {
  it('stops only under the clinician-configured limits', () => {
    const rx = { ...defaultPrescription('knee_flexion', 'left'), painStopAt: 7, painRiseStop: 3 };
    expect(painRuleOutcome(rx, 6, 4).stop).toBe(false);
    expect(painRuleOutcome(rx, 7, 4).stop).toBe(true);
    expect(painRuleOutcome(rx, 5, 2).stop).toBe(true);
    expect(painRuleOutcome({ ...rx, painStopAt: undefined, painRiseStop: undefined }, 9, 1)).toEqual({ stop: false, rule: 'no pain rule configured' });
  });
});
