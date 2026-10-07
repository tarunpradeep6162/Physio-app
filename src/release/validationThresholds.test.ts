import { describe, expect, it } from 'vitest';
import { REQUIRED_VALIDATION_METRICS, METRICS_BY_PROTOCOL, validateReleaseThresholds } from './validationThresholds';
import { PROTOCOLS } from '../engine/protocols/registry';
import { simulateCapture } from '../engine/protocols/simulate';

const complete = () => ({
  values: Object.fromEntries(REQUIRED_VALIDATION_METRICS.map((metric) => [metric, {
    loaWithin: 10, maxFailureRate: 0, minIcc: 0.8, minN: 20,
  }])),
  lockedBy: 'clinician-id',
  lockedAt: '2026-10-06T00:00:00.000Z',
});

describe('release threshold integrity', () => {
  it('declares every emitted metric for every current protocol', () => {
    for (const protocol of Object.values(PROTOCOLS)) {
      const result = simulateCapture(protocol.id, protocol.sided ? 'left' : null, { fps: 10, cycles: 1 });
      expect([...METRICS_BY_PROTOCOL[protocol.id]].sort(), protocol.id).toEqual(result.metrics.map((m) => m.id).sort());
    }
  });
  it('requires all current protocol metrics and a valid lock', () => {
    const full = complete();
    expect(validateReleaseThresholds(full)).toEqual([]);
    delete full.values[REQUIRED_VALIDATION_METRICS[0]];
    expect(validateReleaseThresholds(full)).toContain(`Missing threshold: ${REQUIRED_VALIDATION_METRICS[0]}.`);
  });
  it('rejects invalid limits and accepts a zero failure ceiling', () => {
    const full = complete();
    const metric = REQUIRED_VALIDATION_METRICS[0];
    full.values[metric].minN = 1.5;
    full.values[metric].maxFailureRate = 1.2;
    full.values[metric].minIcc = 1.2;
    expect(validateReleaseThresholds(full)).toEqual(expect.arrayContaining([
      `Invalid failure rate for ${metric} (use 0–100%).`,
      `Invalid ICC for ${metric} (use −1 to 1).`,
      `Invalid minimum n for ${metric} (at least 2).`,
    ]));
  });
  it('rejects unknown metrics and missing lock metadata', () => {
    const full = complete();
    full.values.retired_metric = { loaWithin: 10, maxFailureRate: 0, minIcc: 0.8, minN: 20 };
    full.lockedBy = '';
    expect(validateReleaseThresholds(full)).toEqual(expect.arrayContaining([
      'Unknown or retired metric: retired_metric.',
      'Threshold lock needs an actor and a valid timestamp.',
    ]));
  });
});
