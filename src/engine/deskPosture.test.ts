import { describe, expect, it } from 'vitest';
import { DeskCapture, deskReadings } from './deskPosture';
import { LM } from './landmarks';
import { synthesize } from './pose/synthetic';

const W = 720;
const H = 1280;
const seated = (side: 'left' | 'right', trunkLean = 8, seed = 3) => synthesize({ kind: 'sit_to_stand_lateral', side, kneeFlexion: 90, trunkLean }, { width: W, height: H, seed });

describe('desk posture check', () => {
  it('measures a seated side view and reports forward lean as positive on either side', () => {
    for (const side of ['left', 'right'] as const) {
      const f = deskReadings(seated(side, 10), W, H);
      expect(f.side).toBe(side);
      const trunk = f.readings.find((r) => r.id === 'trunk_lean')!;
      expect(trunk.value).toBeCloseTo(10, 0);
      const head = f.readings.find((r) => r.id === 'head_line')!;
      expect(head.value).toBeGreaterThan(0);
      const hip = f.readings.find((r) => r.id === 'hip_angle')!;
      // The synthetic seated thigh slopes ~18° (hip above knee); with a 10° forward lean → ~98° at the hip.
      expect(hip.value).toBeGreaterThan(90);
      expect(hip.value).toBeLessThan(106);
    }
  });

  it('withholds the hip angle when the knee is hidden (e.g. under the desk)', () => {
    const lms = seated('left');
    lms[LM.leftKnee] = { ...lms[LM.leftKnee], visibility: 0.1 };
    const f = deskReadings(lms, W, H);
    const hip = f.readings.find((r) => r.id === 'hip_angle')!;
    expect(hip.value).toBeNull();
    expect(hip.withheld).toBe('landmarks_hidden');
    expect(hip.missing).toEqual([LM.leftKnee]);
    expect(f.readings.find((r) => r.id === 'trunk_lean')!.value).not.toBeNull();
  });

  it('withholds signed angles when the facing direction cannot be read', () => {
    const lms = seated('left');
    lms[LM.nose] = { ...lms[LM.nose], visibility: 0.1 };
    const f = deskReadings(lms, W, H);
    expect(f.readings.find((r) => r.id === 'head_line')!.withheld).toBe('direction_unknown');
    expect(f.readings.find((r) => r.id === 'hip_angle')!.value).not.toBeNull();
  });

  it('withholds everything when no side is visible', () => {
    const lms = seated('left').map((l) => ({ ...l, visibility: 0.2 }));
    const f = deskReadings(lms, W, H);
    expect(f.side).toBeNull();
    expect(f.readings.every((r) => r.value === null)).toBe(true);
  });

  it('reports the median of a stable window and withholds an unstable or sparse one', () => {
    const stable = new DeskCapture();
    for (let i = 0; i < 30; i++) stable.add(deskReadings(seated('left', 8, i + 1), W, H));
    const r = stable.result();
    expect(r.find((x) => x.id === 'trunk_lean')!.value).toBeCloseTo(8, 0);
    expect(r.every((x) => x.value !== null)).toBe(true);

    const moving = new DeskCapture();
    for (let i = 0; i < 30; i++) moving.add(deskReadings(seated('left', 2 + (i % 2) * 15, i + 1), W, H));
    expect(moving.result().find((x) => x.id === 'trunk_lean')!.withheld).toBe('unstable');

    const sparse = new DeskCapture();
    for (let i = 0; i < 30; i++) {
      const lms = seated('left', 8, i + 1);
      if (i % 3) lms[LM.leftKnee] = { ...lms[LM.leftKnee], visibility: 0.1 };
      sparse.add(deskReadings(lms, W, H));
    }
    expect(sparse.result().find((x) => x.id === 'hip_angle')!.value).toBeNull();
  });
});
