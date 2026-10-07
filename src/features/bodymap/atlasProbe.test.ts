import { describe, expect, it } from 'vitest';
import { Samples, summarise } from './atlasProbe';

describe('atlas performance probe', () => {
  it('summarises samples without inventing values for an empty run', () => {
    expect(summarise([])).toEqual({ n: 0, p50: null, p95: null, max: null, over50ms: null });
    const s = summarise([16, 17, 16, 18, 120, 16, 17, 16, 16, 60]);
    expect(s).toMatchObject({ n: 10, p50: 16, max: 120, over50ms: 0.2 });
    expect(s.p95).toBe(120);
  });
  it('keeps a bounded buffer and ignores invalid timings', () => {
    const b = new Samples(3);
    for (const v of [1, 2, 3, 4, -1, Number.NaN]) b.add(v);
    expect(b.summary()).toMatchObject({ n: 3, p50: 3, max: 4 });
  });
});
