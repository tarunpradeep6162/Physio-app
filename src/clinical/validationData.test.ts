import { describe, expect, it } from 'vitest';
import type { DB } from '../data/models';
import { emptyDb } from '../data/store';
import { simulateCapture } from '../engine/protocols/simulate';
import { ageBand, hasFinalEvaluationData, retestPairs, summariseValidation, validationPairs } from './validationData';

function db(lockedAt: string | null): DB {
  const d = emptyDb();
  const provider = { id: 'mediapipe-lite', model: 'blazepose-ghum-lite', version: 'tasks-vision@1.0.1', simulated: false };
  for (let i = 0; i < 4; i++) {
    const pid = `p${i}`;
    d.patients.push({ id: pid, userId: null, name: `VP-${i}`, preferredLanguage: 'en', createdAt: '2026-01-01', validationSplit: i < 2 ? 'tuning' : 'evaluation' });
    // The engine run here is a stand-in for a real capture; provenance is set as camera for the test.
    const result = simulateCapture('knee_supported_flexion', 'left', { peak: 100 + i * 5 });
    const capId = `c${i}`;
    d.captures.push({ id: capId, assessmentId: 'a', patientId: pid, protocolId: result.protocolId, protocolVersion: result.protocolVersion, side: 'left', result, config: null, provenance: { source: 'camera_estimation', createdBy: 'u', createdAt: '2026-02-01', engineVersion: 'x', algorithmVersion: 'y', poseModel: provider.model }, createdAt: '2026-02-01' });
    d.measurements.push({ id: `r${i}`, patientId: pid, type: 'reference.knee_flexion_peak', value: 100 + i * 5 + 2, unit: 'deg', confidence: 1, category: 'clinician_measured', captureId: capId, metricId: 'knee_flexion_peak', reference: { instrument: 'goniometer', blinded: true }, provenance: { source: 'clinician_goniometer', createdBy: 'u', createdAt: '2026-02-02', engineVersion: 'n/a', algorithmVersion: 'n/a' }, reviewStatus: 'accepted', createdAt: `2026-02-0${2 + i}T10:00:00Z` });
  }
  // A demo record must never count.
  d.measurements.push({ ...d.measurements[0], id: 'demo', isDemo: true });
  if (lockedAt) d.settings.releaseThresholds = { values: { knee_flexion_peak: { loaWithin: 10, maxFailureRate: 0.2, minIcc: 0.8, minN: 2 } }, lockedBy: 'lead', lockedAt };
  return d;
}

describe('validation dataset', () => {
  it('blocks prospective threshold locking after any evaluation camera capture, even without references', () => {
    const d = db(null);
    d.measurements = [];
    expect(hasFinalEvaluationData(d)).toBe(true);
    d.captures = d.captures.filter((cap) => cap.patientId !== 'p2' && cap.patientId !== 'p3');
    expect(hasFinalEvaluationData(d)).toBe(false);
    d.measurements.push({ ...db(null).measurements[2], id: 'reference-only' });
    expect(hasFinalEvaluationData(d)).toBe(true);
  });
  it('pairs camera and reference per participant split and excludes demo data', () => {
    const pairs = validationPairs(db(null));
    expect(pairs).toHaveLength(4);
    expect(pairs.filter((p) => p.split === 'evaluation')).toHaveLength(2);
    expect(pairs.every((p) => p.cameraValid)).toBe(true);
  });

  it('excludes demo patients and captures even when their references are not marked demo', () => {
    const d = db(null);
    d.patients[0].isDemo = true;
    d.captures[1].isDemo = true;
    expect(validationPairs(d).map((p) => p.patientId)).toEqual(['p2', 'p3']);
  });

  it('excludes unblinded, mismatched and duplicate reference pairs', () => {
    const d = db(null);
    d.measurements[0].reference!.blinded = false;
    d.measurements[1].patientId = 'p0';
    d.measurements.push({ ...d.measurements[2], id: 'duplicate', isDemo: false });
    expect(validationPairs(d).map((p) => p.patientId)).toEqual(['p3']);
  });

  it('allows an independently measured reference before capture, but excludes non-camera provenance', () => {
    const d = db(null);
    d.measurements[0].createdAt = '2026-01-31T00:00:00Z';
    d.captures[1].provenance.source = 'simulated_demo';
    expect(validationPairs(d).map((p) => p.patientId)).toEqual(['p0', 'p2', 'p3']);
  });

  it('counts unpaired failed attempts in the capture-failure denominator', () => {
    const d = db(null);
    const failed = { ...d.captures[2], id: 'failed-attempt',
      result: { ...d.captures[2].result, quality: { ...d.captures[2].result.quality, verdict: 'invalid' as const } } };
    d.captures.push(failed);
    const row = summariseValidation(d).find((r) => r.metricId === 'knee_flexion_peak' && r.split === 'evaluation')!;
    expect(row.agreement?.n).toBe(2);
    expect(row.failure).toMatchObject({ n: 3, failed: 1, rate: 1 / 3 });
  });

  it('shows failure-only metrics with no reference pair', () => {
    const d = db(null);
    d.measurements = [];
    d.captures[2].result.quality.verdict = 'invalid';
    const row = summariseValidation(d).find((r) => r.metricId === 'knee_flexion_peak' && r.split === 'evaluation')!;
    expect(row.participants).toBe(2);
    expect(row.agreement).toBeNull();
    expect(row.failure).toMatchObject({ n: 2, failed: 1, rate: 0.5 });
    expect(row.release?.pass).toBe(false);
  });

  it('a release check only counts when thresholds were locked before the evaluation data existed', () => {
    const before = summariseValidation(db('2026-01-15T00:00:00Z')).find((r) => r.split === 'evaluation' && r.metricId === 'knee_flexion_peak')!;
    expect(before.release!.preSpecified).toBe(true);
    const after = summariseValidation(db('2026-03-01T00:00:00Z')).find((r) => r.split === 'evaluation' && r.metricId === 'knee_flexion_peak')!;
    expect(after.release!.pass).toBe(false);
    expect(after.release!.reasons[0]).toMatch(/not locked before/);
    // Locking after camera capture but before its reference also fails: the estimate was visible.
    const late = summariseValidation(db('2026-02-01T12:00:00Z')).find((r) => r.split === 'evaluation' && r.metricId === 'knee_flexion_peak')!;
    expect(late.release!.preSpecified).toBe(false);
    // Repeatability needs repeated sessions: never silently passed.
    expect(before.release!.reasons.join(' ')).toMatch(/repeatability not established/);
  });

  it('pairs a second-day session for test–retest and reports participants without one', () => {
    const d = db(null);
    const second = (i: number, day: string, patch: Partial<DB['captures'][number]> = {}) => {
      const first = d.captures[i];
      const result = simulateCapture('knee_supported_flexion', 'left', { peak: 102 + i * 5 });
      d.captures.push({ ...first, id: `c${i}-retest`, result, createdAt: day, provenance: { ...first.provenance, createdAt: day }, ...patch });
    };
    second(0, '2026-02-04T10:00:00Z'); // tuning, later day → pairs
    second(1, '2026-02-01T18:00:00Z'); // same day only → excluded
    const tuning = retestPairs(d, 'knee_flexion_peak', 'tuning');
    expect(tuning.pairs.map((p) => p.patientId)).toEqual(['p0']);
    expect(tuning.pairs[0].intervalDays).toBe(3);
    expect(tuning.excluded).toEqual([{ reason: 'no valid second-day session', count: 1 }]);
    // A later session on a different protocol version is not a retest of the same set-up.
    second(2, '2026-02-05T10:00:00Z', { protocolVersion: '9.9.9' });
    second(3, '2026-02-06T10:00:00Z');
    const evaluation = retestPairs(d, 'knee_flexion_peak', 'evaluation');
    expect(evaluation.pairs.map((p) => p.patientId)).toEqual(['p3']);
    expect(evaluation.excluded).toEqual([{ reason: 'second session differs in protocol version, view or device', count: 1 }]);
    const rep = summariseValidation(d).find((r) => r.split === 'tuning' && r.metricId === 'knee_flexion_peak')!.repeatability;
    expect(rep.n).toBe(1);
    expect(rep.icc).toBeNull(); // n < 2: no ICC is reported
  });

  it('reports agreement per subgroup, records skin tone only with consent, and shows missing data', () => {
    const d = db(null);
    d.patients[2].sex = 'female';
    d.patients[3].dob = '1950-06-01';
    d.measurements[2].reference!.conditions = { lighting: 'dim', clothing: 'fitted', skinToneBand: 'V-VI', skinToneConsent: false };
    d.measurements[3].reference!.conditions = { lighting: 'dim', skinToneBand: 'III-IV', skinToneConsent: true };
    const pairs = validationPairs(d).filter((p) => p.split === 'evaluation');
    expect(pairs.map((p) => p.skinToneBand)).toEqual(['not recorded', 'III-IV']);
    expect(pairs.map((p) => p.ageBand)).toEqual(['not recorded', '65 and over']);
    const row = summariseValidation(d).find((r) => r.split === 'evaluation' && r.metricId === 'knee_flexion_peak')!;
    expect(row.subgroups.lighting).toEqual([{ group: 'dim', n: 2, agreement: expect.objectContaining({ n: 2 }) }]);
    expect(row.subgroups.sex.map((g) => [g.group, g.n])).toEqual(expect.arrayContaining([['female', 1], ['not recorded', 1]]));
    // A single-person group is reported with its n, never pooled away (agreement needs n ≥ 2).
    expect(row.subgroups.sex.every((g) => g.agreement === null)).toBe(true);
    expect(row.missing).toEqual({ validCaptureNoReference: 0, referenceCameraInvalid: 0 });
    d.measurements = d.measurements.filter((m) => m.id !== 'r3');
    expect(summariseValidation(d).find((r) => r.split === 'evaluation' && r.metricId === 'knee_flexion_peak')!.missing.validCaptureNoReference).toBe(1);
  });

  it('lists failure reasons for failed attempts', () => {
    const d = db(null);
    d.captures[0].result = { ...d.captures[0].result, quality: { ...d.captures[0].result.quality, verdict: 'invalid', reasons: ['coverage below 75%'] } };
    const row = summariseValidation(d).find((r) => r.split === 'tuning' && r.metricId === 'knee_flexion_peak')!;
    expect(row.failureReasons).toEqual([{ reason: 'coverage below 75%', count: 1 }]);
  });

  it('age bands are computed at the capture date', () => {
    expect(ageBand('1986-10-08', '2026-10-07T12:00:00Z')).toBe('under 40');
    expect(ageBand('1986-10-07', '2026-10-07T12:00:00Z')).toBe('40–64');
    expect(ageBand(undefined, '2026-10-07')).toBe('not recorded');
  });
});
