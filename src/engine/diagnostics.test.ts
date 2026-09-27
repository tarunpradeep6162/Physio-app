import { describe, expect, it } from 'vitest';
import { TrackingDiagnostics, type DiagSample } from './diagnostics';

const angle = (t: number) => 60 - 50 * Math.cos((2 * Math.PI * t) / 3000);
function sample(i: number, over: Partial<DiagSample> = {}): DiagSample {
  const t = 1000 + i * 100; // 10 inferences/s
  return {
    t,
    captureTs: t - 40,
    presentedFrames: i * 3, // camera at 30 fps, every third frame analysed
    inferenceMs: 30 + (i % 5),
    persons: 1,
    status: 'tracking',
    orientation: 'lateral_left',
    requiredVis: [0.95, 0.9, 0.92],
    jumpRate: 0.5,
    rawAngle: angle(t),
    smoothAngle: angle(t),
    finalAngle: angle(t - 120),
    meanLuma: 140,
    ...over,
  };
}

describe('tracking diagnostics', () => {
  it('separates camera rate, skipped frames, frame age and filter lag', () => {
    const d = new TrackingDiagnostics(5000);
    for (let i = 0; i < 50; i++) d.record(sample(i));
    const s = d.snapshot();
    expect(s.cameraFps).toBeCloseTo(30, 0);
    expect(s.inferenceFps).toBeCloseTo(10, 0);
    expect(s.skippedFraction).toBeCloseTo(2 / 3, 1);
    expect(s.frameAge?.p50).toBe(40);
    expect(s.filterLagMs).toBeGreaterThanOrEqual(100);
    expect(s.filterLagMs).toBeLessThanOrEqual(140);
    expect(s.verdicts.map((v) => v.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('attributes stale results to slow inference, and queueing to the camera/scheduling stage', () => {
    const slow = new TrackingDiagnostics(20000);
    for (let i = 0; i < 20; i++) slow.record(sample(i * 8, { inferenceMs: 700, captureTs: 1000 + i * 800 - 720 }));
    const v = slow.snapshot().verdicts;
    expect(v[0].status).toBe('ok');
    expect(v[1].summary).toMatch(/Slow inference/);
    const queued = new TrackingDiagnostics(5000);
    for (let i = 0; i < 30; i++) queued.record(sample(i, { captureTs: 1000 + i * 100 - 400 }));
    expect(queued.snapshot().verdicts[0].summary).toMatch(/wait/);
  });

  it('blames the first failing stage: dark camera, then occluded landmark, then measurement refusal', () => {
    const d = new TrackingDiagnostics(5000);
    for (let i = 0; i < 30; i++) d.record(sample(i, { meanLuma: 30, requiredVis: [0.95, 0.3, 0.9], finalAngle: null, reason: 'occluded' }));
    const v = d.snapshot().verdicts;
    expect(v[0]).toMatchObject({ stage: 'camera', status: 'fail' });
    expect(v[1]).toMatchObject({ stage: 'pose', status: 'warn' });
    expect(v[3].summary).toContain('occluded');
  });

  it('keeps only the rolling window', () => {
    const d = new TrackingDiagnostics(1000);
    for (let i = 0; i < 50; i++) d.record(sample(i));
    expect(d.samples.length).toBeLessThanOrEqual(11);
  });
});
