import { describe, expect, it } from 'vitest';
import { LM } from '../landmarks';
import { MotionPipeline } from '../pipeline';
import { synthesize } from '../pose/synthetic';
import type { Landmark, Side } from '../types';
import { ProtocolRecorder } from './recorder';
import { getProtocol, PROTOCOL_VERSIONS } from './registry';
import { SHOULDER_ALGORITHM_VERSION } from './shoulder';
import { sceneAt, SIM_PROVIDER, simulateCapture } from './simulate';

const metric = (r: ReturnType<typeof simulateCapture>, id: string) => r.metrics.find((m) => m.id === id)!;

/** Records protocol `protocolId` for `side` while the synthetic person performs `sceneFn`. */
function record(protocolId: string, side: Side, sceneFn: (t: number) => ReturnType<typeof sceneAt>) {
  const def = getProtocol(protocolId);
  const rec = new ProtocolRecorder(def, side);
  const pipe = new MotionPipeline();
  let t = 0;
  let seed = 3;
  while (t / 1000 < def.maxDurationSec) {
    const sc = sceneFn(t / 1000);
    const lms = sc ? synthesize(sc, { noisePx: 1, seed: seed++ }) : null;
    rec.update(pipe.process({ timestamp: t, width: 720, height: 1280, poses: lms ? [lms] : [], inferenceMs: 4, provider: SIM_PROVIDER }), t, 30);
    if (rec.state.complete) break;
    t += 1000 / 30;
  }
  return rec.finish(t);
}

describe('Phase 1 — shoulder protocols on synthetic captures', () => {
  it('registers both shoulder protocols with their own algorithm version', () => {
    expect(PROTOCOL_VERSIONS).toContain('shoulder_flexion_active@1.0.0');
    expect(PROTOCOL_VERSIONS).toContain('shoulder_abduction_active@1.0.0');
    const r = simulateCapture('shoulder_flexion_active', 'left', { peak: 150 });
    expect(r.algorithmVersion).toBe(SHOULDER_ALGORITHM_VERSION);
    expect(r.protocolVersion).toBe('1.0.0');
  });

  it('active flexion (side view) reports the peak and a trunk compensation angle', () => {
    for (const side of ['left', 'right'] as const) {
      const r = simulateCapture('shoulder_flexion_active', side, { peak: 150 });
      expect(r.quality.verdict).toBe('valid');
      expect(r.quality.validCycles).toBe(3);
      expect(metric(r, 'shoulder_flexion_peak').value!).toBeGreaterThan(142);
      expect(metric(r, 'shoulder_flexion_peak').value!).toBeLessThan(156);
      expect(metric(r, 'shoulder_flexion_trunk_lean').value!).toBeLessThan(5);
    }
    // Leaning the trunk while raising the arm is recorded as its own channel, not hidden.
    const leaning = simulateCapture('shoulder_flexion_active', 'left', { peak: 150, trunkLean: 14 });
    expect(metric(leaning, 'shoulder_flexion_trunk_lean').value!).toBeGreaterThan(9);
  });

  it('active abduction (front view) reports the peak, one side at a time', () => {
    for (const side of ['left', 'right'] as const) {
      const r = simulateCapture('shoulder_abduction_active', side, { peak: 140 });
      expect(r.quality.verdict).toBe('valid');
      expect(r.view).toBe('anterior');
      expect(metric(r, 'shoulder_abduction_peak').value!).toBeGreaterThan(132);
      expect(metric(r, 'shoulder_abduction_peak').value!).toBeLessThan(148);
      expect(Math.abs(metric(r, 'shoulder_abduction_trunk_lean').value!)).toBeLessThan(3);
    }
  });

  it('a trunk side-lean away from the moving arm is reported as a positive compensation angle', () => {
    // Shift the shoulder girdle toward image-left (away from the patient's left arm) as the arm rises.
    const shift = (lms: Landmark[], t: number) => {
      const u = Math.max(0, Math.min(1, Math.sin(((t - 1) / 4.3) * Math.PI)));
      for (const i of [LM.leftShoulder, LM.rightShoulder, LM.nose, LM.leftEar, LM.rightEar, LM.leftEye, LM.rightEye]) lms[i] = { ...lms[i], x: lms[i].x - 0.03 * u };
      return lms;
    };
    const r = simulateCapture('shoulder_abduction_active', 'left', { peak: 140, perturb: shift });
    expect(metric(r, 'shoulder_abduction_trunk_lean').value!).toBeGreaterThan(2);
  });

  it('an occluded elbow produces no metric at all', () => {
    const hide = (lms: Landmark[]) => {
      lms[LM.leftElbow] = { ...lms[LM.leftElbow], visibility: 0.1 };
      return lms;
    };
    for (const id of ['shoulder_flexion_active', 'shoulder_abduction_active']) {
      const r = simulateCapture(id, 'left', { perturb: hide });
      expect(r.quality.verdict).toBe('invalid');
      expect(r.metrics.every((m) => m.value === null || m.validity === 'invalid')).toBe(true);
    }
  });

  it('the wrong view or the wrong side facing the camera produces no metric', () => {
    // Flexion needs the tested (left) side toward the camera: the right side is facing it.
    const wrongSide = record('shoulder_flexion_active', 'left', (t) => sceneAt('shoulder_flexion_active', 'right', t, {}));
    expect(wrongSide.quality.verdict).toBe('invalid');
    expect(wrongSide.metrics.every((m) => m.value === null || m.validity === 'invalid')).toBe(true);
    // Flexion from the front: the side-view calculation must refuse.
    const front = record('shoulder_flexion_active', 'left', (t) => sceneAt('shoulder_abduction_active', 'left', t, {}));
    expect(front.quality.verdict).toBe('invalid');
    expect(front.metrics.every((m) => m.value === null || m.validity === 'invalid')).toBe(true);
    // Abduction filmed side-on: refused.
    const side = record('shoulder_abduction_active', 'left', (t) => sceneAt('shoulder_flexion_active', 'left', t, {}));
    expect(side.quality.verdict).toBe('invalid');
  });

  it('nobody in view, or the arm leaving the frame, never yields a number', () => {
    const empty = record('shoulder_abduction_active', 'left', () => null);
    expect(empty.quality.verdict).toBe('invalid');
    expect(empty.metrics.every((m) => m.value === null)).toBe(true);
    const cropped = simulateCapture('shoulder_flexion_active', 'left', {
      perturb: (lms) => {
        lms[LM.leftElbow] = { ...lms[LM.leftElbow], x: 0.995 };
        return lms;
      },
    });
    expect(cropped.quality.verdict).toBe('invalid');
  });
});

describe('Phase 3 — adversarial shoulder sequences never become silent valid measurements', () => {
  const swapArms = (lms: Landmark[]) => {
    const s = [...lms];
    [s[LM.leftElbow], s[LM.rightElbow]] = [lms[LM.rightElbow], lms[LM.leftElbow]];
    [s[LM.leftWrist], s[LM.rightWrist]] = [lms[LM.rightWrist], lms[LM.leftWrist]];
    return s;
  };

  it('an arm label swap is detected and withheld; the swapped arm is never measured as the tested one', () => {
    // Labels swap from 3 s to the end: the "left elbow" becomes the resting right arm.
    const r = simulateCapture('shoulder_abduction_active', 'left', { peak: 140, perturb: (l, t) => (t >= 3 ? swapArms(l) : l) });
    // Only what was captured before the swap can count; the swapped segment reads a resting arm.
    const peaks = r.cycles.filter((c) => c.valid).map((c) => c.peak);
    expect(peaks.every((p) => p > 100)).toBe(true);
    expect(r.quality.verdict).toBe('invalid');
  });

  it('flip-flopping arm labels produce identity events, not a smooth fake signal', async () => {
    const { IdentityGuard } = await import('../identity');
    const g = new IdentityGuard();
    let swaps = 0;
    for (let k = 0; k < 20; k++) {
      const lms = synthesize({ kind: 'standing_anterior', armSide: 'left', shoulderAbduction: 90 }, { seed: k });
      const e = g.update(k % 2 ? swapArms(lms) : lms, k * 33, 720, 1280);
      if (e.event === 'limb_swap') swaps++;
    }
    expect(swaps).toBeGreaterThan(15);
  });

  it('a second person entering stops measurement for the whole time both are in view', () => {
    const def = getProtocol('shoulder_flexion_active');
    const rec = new ProtocolRecorder(def, 'left');
    const pipe = new MotionPipeline();
    let t = 0;
    const during: (number | null)[] = [];
    for (; t < 12_000; t += 33) {
      const sc = sceneAt('shoulder_flexion_active', 'left', t / 1000, {})!;
      const me = synthesize(sc, { seed: t });
      const poses = t > 4000 && t < 7000 ? [me, synthesize({ kind: 'standing_anterior', offsetX: 0.3 }, { seed: t + 1 })] : [me];
      const f = pipe.process({ timestamp: t, width: 720, height: 1280, poses, inferenceMs: 4, provider: SIM_PROVIDER });
      const s = def.createSignal('left')(f);
      if (t > 4200 && t < 6900) during.push(s.value);
      rec.update(f, t, 30);
    }
    expect(during.length).toBeGreaterThan(50);
    expect(during.every((v) => v === null)).toBe(true);
    // A repetition overlapping the bystander interval is not counted as valid.
    const r = rec.finish(t);
    for (const c of r.cycles.filter((x) => x.valid)) expect((c.endT ?? Infinity) < 4000 || c.startT > 7000).toBe(true);
  });
});
