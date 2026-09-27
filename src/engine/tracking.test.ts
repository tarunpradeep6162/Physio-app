import { describe, expect, it } from 'vitest';
import { evaluateCalibration } from './calibration';
import { IdentityGuard } from './identity';
import { LM } from './landmarks';
import { estimate } from './measurements';
import { MotionPipeline, REACQUIRE_MS } from './pipeline';
import { computePostureMetrics, handsInFront } from './posture';
import { CycleDetector } from './protocols/cycles';
import { SIM_PROVIDER } from './protocols/simulate';
import { synthesize } from './pose/synthetic';
import { SignalGuard } from './signalGuard';
import type { Landmark } from './types';

const W = 720;
const H = 1280;
const frame = (t: number, poses: Landmark[][], support?: number[]) => ({ timestamp: t, width: W, height: H, poses, inferenceMs: 1, provider: SIM_PROVIDER, support });
const shift = (l: Landmark[], dx: number) => l.map((p) => ({ ...p, x: p.x + dx }));

describe('Phase 6 — subject identity', () => {
  it('flags a jump to another person and a left/right leg swap, never re-labelling landmarks', () => {
    const g = new IdentityGuard();
    const a = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: 60 });
    expect(g.update(a, 0, W, H).event).toBe('acquired');
    expect(g.update(a, 33, W, H).event).toBeNull();
    expect(g.update(shift(a, 0.45), 66, W, H).event).toBe('identity_change');
    const g2 = new IdentityGuard();
    g2.update(a, 0, W, H);
    const swapped = a.map((p) => ({ ...p }));
    for (const [l, r] of [[LM.leftKnee, LM.rightKnee], [LM.leftAnkle, LM.rightAnkle], [LM.leftHeel, LM.rightHeel]]) [swapped[l], swapped[r]] = [swapped[r], swapped[l]];
    expect(g2.update(swapped, 33, W, H).event).toBe('limb_swap');
    // Back after leaving the frame: must be re-acquired.
    expect(g2.update(a, 2000, W, H).event).toBe('reacquired');
  });

  it('withholds measurement while re-acquiring, and pauses for more than one person', () => {
    const p = new MotionPipeline();
    const a = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: 30 });
    let f = p.process(frame(0, [a]));
    expect(f.status).toBe('reacquiring');
    let t = 33;
    for (; t <= REACQUIRE_MS + 66; t += 33) f = p.process(frame(t, [a]));
    expect(f.status).toBe('tracking');
    f = p.process(frame(t, [shift(a, 0.45)]));
    expect(f.status).toBe('reacquiring');
    expect(f.integrity.event).toBe('identity_change');
    expect(p.process(frame(t + 33, [a, shift(a, 0.3)])).status).toBe('multiple_people');
  });
});

describe('Phase 8 — strict occlusion', () => {
  const lms = synthesize({ kind: 'standing_anterior' });
  it('a joint covered by an object is refused even when the model reports it visible, and is named', () => {
    const support = lms.map(() => 1);
    support[LM.leftHip] = 0.05;
    support[LM.rightHip] = 0.1;
    const side = synthesize({ kind: 'standing_lateral', side: 'left' });
    const sup2 = side.map(() => 1);
    sup2[LM.leftKnee] = 0.1;
    const e = estimate('knee_flexion', side, W, H, 'left', { view: 'lateral_left', support: sup2 });
    expect(e.value).toBeNull();
    expect(e.reason).toBe('not_on_body');
    expect(e.missing).toEqual([LM.leftKnee]);
    const m = computePostureMetrics(lms, W, H, 'anterior', 0.6, support);
    expect(m.find((x) => x.id === 'pelvic_level')).toBeUndefined();
    expect(m.find((x) => x.id === 'shoulder_level')).toBeDefined();
  });

  it('posture metrics refuse landmarks outside the frame even with high model visibility (partial body)', () => {
    const low = lms.map((l) => ({ ...l, y: l.y + 0.14 }));
    expect(low[LM.leftAnkle].y).toBeGreaterThan(1);
    const m = computePostureMetrics(low, W, H, 'anterior');
    expect(m.find((x) => x.id === 'knee_frontal_left')).toBeUndefined();
  });

  it('calibration names covered joints', () => {
    const p = new MotionPipeline();
    const support = lms.map(() => 1);
    support[LM.leftHip] = 0;
    support[LM.rightHip] = 0;
    let f = p.process(frame(0, [lms], support));
    for (let t = 33; t < 700; t += 33) f = p.process(frame(t, [lms], support));
    const c = evaluateCalibration({ frame: f, req: { landmarks: [LM.leftHip, LM.rightHip, LM.leftKnee], views: [], heightRange: [0.3, 0.98], minConfidence: 0.6, maxRollDeg: 5 }, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user' });
    const chk = c.checks.find((x) => x.id === 'confidence')!;
    expect(chk.status).toBe('fail');
    expect(chk.instruction).toBe('joint_covered');
    expect(chk.params?.joints).toBe('left hip and right hip');
  });

  it('rejects physically impossible jumps and resumes only after a stable window', () => {
    const g = new SignalGuard(900, 250);
    expect(g.update(0, 20).value).toBe(20);
    expect(g.update(33, 22).value).toBe(22);
    expect(g.update(66, 176)).toEqual({ value: null, reason: 'implausible_jump' });
    expect(g.update(99, 24)).toEqual({ value: null, reason: 'implausible_jump' });
    expect(g.update(132, 25).reason).toBe('reacquiring');
    let out = g.update(400, 26);
    expect(out.value).toBe(26);
    // A gap followed by data: a short recovery window before values resume.
    g.update(433, null);
    out = g.update(800, 30);
    expect(out.reason).toBe('reacquiring');
  });

  it('an interrupted repetition does not count (v1.1 rule); v1.0 behaviour is preserved for old records', () => {
    const base = { direction: 'up' as const, rest: 20, engaged: 45, minCycleMs: 500, pauseResetMs: 2000, readyMs: 300 };
    const seq: (number | null)[] = [...Array(15).fill(5), ...Array.from({ length: 15 }, (_, i) => 5 + i * 5), ...Array(12).fill(null), ...Array.from({ length: 15 }, (_, i) => 75 - i * 5), ...Array(10).fill(5)];
    const d = new CycleDetector({ ...base, maxGapInCycleMs: 250 });
    seq.forEach((v, i) => d.update(i * 33, v));
    expect(d.cycles[0].valid).toBe(false);
    expect(d.cycles[0].reason).toBe('tracking_gap');
    expect(d.validCount).toBe(0);
    const legacy = new CycleDetector(base);
    seq.forEach((v, i) => legacy.update(i * 33, v));
    expect(legacy.validCount).toBe(1);
  });

  it('a repetition with too few valid frames does not count (low frame rate)', () => {
    const d = new CycleDetector({ direction: 'up', rest: 20, engaged: 45, minCycleMs: 500, pauseResetMs: 2000, readyMs: 300, minSamples: 10 });
    // 2.5 fps: a full excursion seen in only 5 samples.
    const seq = [5, 5, 5, 5, 40, 80, 90, 60, 30, 5, 5];
    seq.forEach((v, i) => d.update(i * 400, v));
    expect(d.cycles[0].reason).toBe('too_few_frames');
  });
});

describe('Phase 8 — object held in front of the body (phone screenshot case)', () => {
  it('withholds torso/hip frontal measures when the hands are in front of the torso, and asks to lower them', () => {
    const held = synthesize({ kind: 'standing_anterior', handsInFront: true, pelvicTiltDeg: 3 });
    const clear = synthesize({ kind: 'standing_anterior', pelvicTiltDeg: 3 });
    const ids = (l: Landmark[]) => computePostureMetrics(l, W, H, 'anterior').map((m) => m.id);
    expect(ids(clear)).toContain('pelvic_level');
    expect(ids(held)).not.toContain('pelvic_level');
    expect(ids(held)).not.toContain('shoulder_level');
    expect(ids(held)).toContain('knee_frontal_left'); // legs are not covered by the hands
    const p = new MotionPipeline();
    let f = p.process(frame(0, [held]));
    for (let t = 33; t < 700; t += 33) f = p.process(frame(t, [held]));
    const c = evaluateCalibration({ frame: f, req: { landmarks: [LM.leftHip, LM.rightHip], views: [], heightRange: [0.3, 0.98], minConfidence: 0.6, maxRollDeg: 5, handsFree: true }, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user' });
    expect(c.instruction).toBe('lower_hands');
  });

  it('detects a phone gripped at its sides (wrists just outside the torso, fingers inside), not relaxed hands', () => {
    const held = synthesize({ kind: 'standing_anterior', handsInFront: true });
    const lms = held.map((l) => ({ ...l }));
    // Wrists just outside the torso outline; index fingers reach inward over the phone.
    lms[LM.leftWrist] = { ...lms[LM.leftWrist], x: lms[LM.leftShoulder].x + 0.01 };
    lms[LM.rightWrist] = { ...lms[LM.rightWrist], x: lms[LM.rightShoulder].x - 0.01 };
    lms[LM.leftIndex] = { ...lms[LM.leftWrist], x: lms[LM.leftWrist].x - 0.05, visibility: 0.8 };
    lms[LM.rightIndex] = { ...lms[LM.rightWrist], x: lms[LM.rightWrist].x + 0.05, visibility: 0.8 };
    expect(handsInFront(lms, W, H)).toBe(true);
    expect(handsInFront(synthesize({ kind: 'standing_anterior' }), W, H)).toBe(false);
  });
});
