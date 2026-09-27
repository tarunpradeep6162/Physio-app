import { describe, expect, it } from 'vitest';
import { LM } from '../engine/landmarks';
import { synthesize } from '../engine/pose/synthetic';
import { summarize } from './metrics';
import type { FrameRecord } from './runner';

const gt = (t: number) => 60 - 50 * Math.cos((2 * Math.PI * t) / 4000);
function recs(fn: (t: number, i: number) => Partial<FrameRecord>): FrameRecord[] {
  return Array.from({ length: 240 }, (_, i) => {
    const t = (i * 1000) / 30;
    return { t, gt: gt(t), gtHidden: false, gtMulti: false, persons: 1, status: 'tracking', orientation: 'lateral_left', raw: gt(t), smooth: gt(t), final: gt(t), vis: [1, 1, 1], inferMs: 10, ...fn(t, i) } as FrameRecord;
  });
}

describe('tracking-lab scoring', () => {
  it('recovers a known lag and peak suppression', () => {
    const s = summarize(recs((t) => ({ final: gt(t - 120) * 0.95 + 3 })), gt);
    expect(s.final.lagMs).toBeGreaterThanOrEqual(100);
    expect(s.final.lagMs).toBeLessThanOrEqual(140);
    expect(s.raw.lagMs).toBe(0);
  });
  it('measures jitter at rest and counts unsafe values', () => {
    const still = (i: number) => (i % 2 ? 1 : -1);
    const s = summarize(recs((_t, i) => ({ gt: 30, raw: 30 + still(i) * 2, smooth: 30, final: 30, gtHidden: i < 10 })), () => 30);
    expect(s.raw.jitterSd).toBeCloseTo(2, 0);
    expect(s.final.jitterSd).toBe(0);
    expect(s.unsafeValues).toBe(10);
  });
});

describe('synthetic scenes are physically possible views', () => {
  it('a left-side supine view has the head at image-right; a left standing view faces image-left', () => {
    const supine = synthesize({ kind: 'supine_heel_slide', side: 'left', kneeFlexion: 40 });
    expect(supine[LM.nose].x).toBeGreaterThan(supine[LM.leftAnkle].x);
    const stand = synthesize({ kind: 'standing_lateral', side: 'left' });
    expect(stand[LM.nose].x).toBeLessThan(stand[LM.leftEar].x);
    const standR = synthesize({ kind: 'standing_lateral', side: 'right' });
    expect(standR[LM.nose].x).toBeGreaterThan(standR[LM.rightEar].x);
  });
});
