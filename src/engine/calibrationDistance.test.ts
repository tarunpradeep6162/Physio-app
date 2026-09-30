import { describe, expect, it } from 'vitest';
import { effectiveDistanceRange, evaluateCalibration, type CalibrationMemory } from './calibration';
import { FULL_BODY_LANDMARKS, LM } from './landmarks';
import { MotionPipeline } from './pipeline';
import { SIM_PROVIDER } from './protocols/simulate';
import { synthesize } from './pose/synthetic';
import type { Landmark } from './types';

/** A standing front view scaled so the body (nose → ankles) fills `extent` of the frame height. */
function bodyFilling(extent: number): Landmark[] {
  const lms = synthesize({ kind: 'standing_anterior' });
  const top = lms[LM.nose].y;
  const bottom = Math.max(lms[LM.leftFootIndex].y, lms[LM.rightFootIndex].y, lms[LM.leftHeel].y, lms[LM.rightHeel].y);
  const k = extent / (bottom - top);
  const cy = (top + bottom) / 2;
  return lms.map((l) => ({ ...l, y: 0.5 + (l.y - cy) * k }));
}

function distanceCheck(lms: Landmark[], height: number, memory?: CalibrationMemory) {
  const width = Math.round((height * 9) / 16);
  const p = new MotionPipeline('none');
  let f = p.process({ timestamp: 0, width, height, poses: [lms], inferenceMs: 1, provider: SIM_PROVIDER });
  for (let t = 33; t < 700; t += 33) f = p.process({ timestamp: t, width, height, poses: [lms], inferenceMs: 1, provider: SIM_PROVIDER });
  const c = evaluateCalibration({ frame: f, req: { landmarks: FULL_BODY_LANDMARKS, views: [], heightRange: [0.5, 0.97], minConfidence: 0.6, maxRollDeg: 3 }, lighting: { meanLuma: 140, clippedFraction: 0 }, cameraRollDeg: 0, facing: 'user', memory });
  return c.checks.find((x) => x.id === 'distance')!;
}

describe('Setup distance check — "move closer" only when it matters', () => {
  it('keeps the same pixel detail on bigger frames, never below 60% of the written limit', () => {
    expect(effectiveDistanceRange([0.5, 0.97], 480)).toEqual([0.5, 0.97]);
    expect(effectiveDistanceRange([0.5, 0.97], 720)).toEqual([0.5, 0.97]);
    expect(effectiveDistanceRange([0.5, 0.97], 1080)[0]).toBeCloseTo(0.3333, 3);
    expect(effectiveDistanceRange([0.5, 0.97], 1920)[0]).toBeCloseTo(0.3, 5); // floor
  });

  it('a person 3 m from a portrait HD phone camera (body ≈ 40% of the height) is no longer told to move closer', () => {
    const lms = bodyFilling(0.4);
    expect(distanceCheck(lms, 1280).status).toBe('pass');
    // The same framing on a low-resolution (480 px) camera really is too small.
    const low = distanceCheck(lms, 480);
    expect(low.status).toBe('fail');
    expect(low.instruction).toBe('move_closer');
    expect(low.params).toMatchObject({ min: '50', max: '97' });
  });

  it('shows the reading and the target band for the checklist', () => {
    const c = distanceCheck(bodyFilling(0.6), 1280);
    expect(Number(c.params?.pct)).toBeGreaterThanOrEqual(55); // nose → ankles (the helper scaled nose → toes to 60%)
    expect(Number(c.params?.pct)).toBeLessThanOrEqual(60);
    expect(c.params?.min).toBe('30');
  });

  it('standing still at the limit does not flip between ready and "move closer" (smoothing + hysteresis)', () => {
    const mem: CalibrationMemory = {};
    const statuses: string[] = [];
    // Jitter of ±2% around the 50% limit on a 480 px frame.
    for (let i = 0; i < 30; i++) statuses.push(distanceCheck(bodyFilling(i % 2 ? 0.49 : 0.52), 480, mem).status);
    const flips = statuses.slice(1).filter((s, i) => s !== statuses[i]).length;
    expect(flips).toBeLessThanOrEqual(1);
    // Without memory the same jitter flips every frame.
    const raw = Array.from({ length: 6 }, (_, i) => distanceCheck(bodyFilling(i % 2 ? 0.49 : 0.52), 480).status);
    expect(raw.slice(1).filter((s, i) => s !== raw[i]).length).toBeGreaterThan(3);
  });
});
