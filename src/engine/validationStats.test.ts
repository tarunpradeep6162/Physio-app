import { describe, expect, it } from 'vitest';
import { agreement, bySubgroup, checkRelease, failureRate, icc21, repeatability } from './validationStats';

describe('validation statistics', () => {
  it('ICC(2,1) matches the Shrout & Fleiss (1979) worked example (0.29)', () => {
    const data = [
      [9, 2, 5, 8],
      [6, 1, 3, 2],
      [8, 4, 6, 8],
      [7, 1, 2, 6],
      [10, 5, 6, 9],
      [6, 2, 4, 7],
    ];
    expect(icc21(data)).toBeCloseTo(0.29, 2);
  });

  it('Bland–Altman agreement on a hand-computed case', () => {
    const a = agreement([
      { camera: 10, reference: 9 },
      { camera: 12, reference: 12 },
      { camera: 14, reference: 15 },
    ])!;
    expect(a.bias).toBeCloseTo(0, 10);
    expect(a.sdDiff).toBeCloseTo(1, 10);
    expect(a.loaUpper).toBeCloseTo(1.96, 10);
    expect(a.mae).toBeCloseTo(2 / 3, 10);
    expect(a.rmse).toBeCloseTo(Math.sqrt(2 / 3), 10);
  });

  it('repeatability, failure rate, subgroups and a release check against pre-set thresholds', () => {
    const rep = repeatability([
      { first: 100, second: 102 },
      { first: 120, second: 118 },
      { first: 90, second: 91 },
      { first: 130, second: 133 },
    ]);
    expect(rep.icc!).toBeGreaterThan(0.95);
    expect(rep.mdc95!).toBeGreaterThan(0);
    expect(failureRate([{ valid: true }, { valid: false }, { valid: true }, { valid: true }]).rate).toBe(0.25);
    const g = bySubgroup(
      [
        { camera: 10, reference: 9, device: 'A' },
        { camera: 11, reference: 11, device: 'A' },
        { camera: 20, reference: 25, device: 'B' },
        { camera: 22, reference: 26, device: 'B' },
      ],
      (p) => p.device,
    );
    expect(g.A!.bias).toBeCloseTo(0.5, 10);
    expect(g.B!.bias).toBeCloseTo(-4.5, 10);
    const res = checkRelease({ metric: 'x', loaWithin: 10, maxFailureRate: 0.2, minIcc: 0.8, minN: 30 }, agreement([{ camera: 1, reference: 1 }, { camera: 2, reference: 2 }]), { rate: 0.1, n: 2 }, { icc: 0.9, n: 2 });
    expect(res.pass).toBe(false);
    expect(res.reasons[0]).toMatch(/n = 2 < 30/);
  });
});
