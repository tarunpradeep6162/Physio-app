import { describe, expect, it } from 'vitest';
import { sustainedWindows } from './sustained';

describe('sustained-run telemetry (Phase 2)', () => {
  it('detects inference slowing over time and a falling frame rate', () => {
    // 120 s: 20 fps at 40 ms early, 10 fps at 80 ms late (a throttling phone).
    const samples: { t: number; ms: number }[] = [];
    for (let t = 0; t < 60_000; t += 50) samples.push({ t, ms: 40 });
    for (let t = 60_000; t < 120_000; t += 100) samples.push({ t, ms: 80 });
    const s = sustainedWindows(samples, 120_000, 30);
    expect(s.windows).toHaveLength(4);
    expect(s.windows[0].fps).toBeCloseTo(20, 0);
    expect(s.slowdownRatio).toBe(2);
    expect(s.fpsRatio).toBe(0.5);
  });

  it('reports no ratio for a run too short to compare', () => {
    expect(sustainedWindows([{ t: 0, ms: 30 }], 1000).slowdownRatio).toBeNull();
  });
});
