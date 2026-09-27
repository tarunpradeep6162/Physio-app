import { describe, expect, it } from 'vitest';
import { buildDemoDb } from '../data/demo';
import type { CaptureSession, DB } from '../data/models';
import { DEFAULT_EXCEPTION_RULES, exceptionQueue, metricTrend, reviewRule, symptomTrend, updateRule } from './trends';

const kneePatient = (db: DB) => db.patients.find((p) => db.assessments.filter((a) => a.patientId === p.id && a.region === 'knee').length >= 2)!;

describe('Phase 17 — longitudinal trends', () => {
  it('shows absolute values with protocol, view and source, and a change only between comparable captures', () => {
    const db = buildDemoDb();
    const p = kneePatient(db);
    const t = metricTrend(db, p.id, 'knee_supported_flexion', 'knee_flexion_peak', 'left');
    expect(t.points.length).toBeGreaterThanOrEqual(2);
    expect(t.points.every((x) => x.protocol.startsWith('knee_supported_flexion@') && x.source === 'camera_estimate' && x.simulated)).toBe(true);
    const l = t.links.at(-1)!;
    expect(l.comparable).toBe(true);
    expect(l.change).toBeCloseTo(t.points.at(-1)!.value! - t.points.at(-2)!.value!, 1);
  });

  it('missing or incomparable data breaks the trend with the reason: invalid capture, version change, view change, setup change', () => {
    const base = buildDemoDb();
    const p = kneePatient(base);
    const lastCap = (db: DB) => db.captures.filter((c) => c.patientId === p.id && c.protocolId === 'knee_supported_flexion' && c.side === 'left').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const variant = (f: (c: CaptureSession) => void) => {
      const db = structuredClone(base);
      f(lastCap(db));
      return metricTrend(db, p.id, 'knee_supported_flexion', 'knee_flexion_peak', 'left').links.at(-1)!;
    };
    expect(variant((c) => (c.result.quality.verdict = 'invalid')).breakReason).toMatch(/invalid/);
    expect(variant((c) => (c.protocolVersion = '9.9.9')).breakReason).toMatch(/protocol changed/);
    expect(variant((c) => (c.result.algorithmVersion = 'pv-knee-9')).breakReason).toMatch(/algorithm changed/);
    expect(variant((c) => (c.result.view = 'lateral_right')).breakReason).toMatch(/view changed/);
    expect(variant((c) => c.config && (c.config = { ...c.config, bodyHeightFrac: c.config.bodyHeightFrac + 0.3, bodyCenterX: c.config.bodyCenterX + 0.3, cameraRollDeg: 25 })).breakReason).toMatch(/setup differs/);
    expect(variant((c) => (c.config = null)).breakReason).toMatch(/setup not recorded/);
  });

  it('symptom trend keeps each value’s source', () => {
    const db = buildDemoDb();
    const s = symptomTrend(db, kneePatient(db).id);
    expect(new Set(s.map((x) => x.source))).toEqual(new Set(['daily_checkin', 'intake_now', 'session_before']));
  });
});

describe('Phase 17 — exception queue with configurable, reviewed thresholds', () => {
  it('flags a check-in pain rise, repeated invalid captures and a comparable decrease; each item carries its evidence', () => {
    const db = buildDemoDb();
    const p = kneePatient(db);
    db.pros.push({ id: 'x', patientId: p.id, type: 'daily_checkin', value: { pain: 7 }, recordedAt: new Date().toISOString(), isDemo: true });
    const q = exceptionQueue(db, DEFAULT_EXCEPTION_RULES, new Date().toISOString(), () => [{ protocolId: 'knee_supported_flexion', metricId: 'knee_flexion_peak', side: 'left' }]);
    const pain = q.find((x) => x.patientId === p.id && x.ruleId === 'pain_rise')!;
    expect(pain.summary).toMatch(/7\/10/);
    expect(pain.evidence[0]).toMatch(/patient-reported/);
    expect(pain.ruleReviewed).toBe(false);
    // Raising the threshold removes it; changing a threshold clears its review.
    const reviewed = reviewRule(DEFAULT_EXCEPTION_RULES, 'pain_rise', 'Demo clinician', '2026-01-01');
    expect(reviewed.find((r) => r.id === 'pain_rise')!.reviewedBy).toBe('Demo clinician');
    const raised = updateRule(reviewed, 'pain_rise', { threshold: 9 });
    expect(raised.find((r) => r.id === 'pain_rise')!.reviewedBy).toBeUndefined();
    expect(exceptionQueue(db, raised, new Date().toISOString(), () => []).some((x) => x.ruleId === 'pain_rise' && x.patientId === p.id)).toBe(false);
    // Disabling a rule removes its items.
    expect(exceptionQueue(db, updateRule(DEFAULT_EXCEPTION_RULES, 'pain_rise', { enabled: false }), new Date().toISOString(), () => []).some((x) => x.ruleId === 'pain_rise')).toBe(false);
  });

  it('a camera decrease is flagged only between comparable captures', () => {
    const db = buildDemoDb();
    const p = kneePatient(db);
    const caps = db.captures.filter((c) => c.patientId === p.id && c.protocolId === 'knee_supported_flexion' && c.side === 'left').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const m = caps[0].result.metrics.find((x) => x.id === 'knee_flexion_peak')!;
    m.value = (m.value ?? 0) - 40;
    const rows = () => [{ protocolId: 'knee_supported_flexion', metricId: 'knee_flexion_peak', side: 'left' as const }];
    expect(exceptionQueue(db, DEFAULT_EXCEPTION_RULES, new Date().toISOString(), rows).some((x) => x.ruleId === 'rom_decrease' && x.patientId === p.id)).toBe(true);
    caps[0].result.view = 'lateral_right'; // now incomparable → no decrease can be claimed
    expect(exceptionQueue(db, DEFAULT_EXCEPTION_RULES, new Date().toISOString(), rows).some((x) => x.ruleId === 'rom_decrease' && x.patientId === p.id)).toBe(false);
  });

  it('the shoulder demo with an invalid capture is not over-flagged below the repeat-invalid threshold', () => {
    const db = buildDemoDb();
    const q = exceptionQueue(db, DEFAULT_EXCEPTION_RULES, new Date().toISOString(), () => []);
    const dp4 = db.patients.find((p) => p.name.includes('DP-04'))!;
    expect(q.some((x) => x.patientId === dp4.id && x.ruleId === 'repeat_invalid')).toBe(false); // 1 invalid < 2
  });
});
