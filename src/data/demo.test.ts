import { describe, expect, it } from 'vitest';
import { buildDemoDb } from './demo';

describe('demo data', () => {
  const db = buildDemoDb();
  it('uses pseudonymous patients only', () => {
    expect(db.patients.every((p) => /^Demo patient DP-\d\d$/.test(p.name) && p.isDemo)).toBe(true);
  });
  it('derives every camera number from engine runs over synthetic landmarks', () => {
    expect(db.captures.length).toBeGreaterThan(8);
    for (const c of db.captures) {
      expect(c.provenance.source).toBe('simulated_demo');
      expect(c.result.frames.data.length).toBeGreaterThan(100); // landmark stream exists
    }
    const cam = db.measurements.filter((m) => m.category === 'camera_estimate');
    expect(cam.every((m) => m.provenance.source === 'simulated_demo')).toBe(true);
    expect(db.measurements.some((m) => m.category === 'clinician_measured')).toBe(false);
  });
  it('includes an invalid capture that stays excluded', () => {
    expect(db.captures.some((c) => c.result.quality.verdict === 'invalid')).toBe(true);
  });
  it('sessions come from the exercise runner', () => {
    expect(db.sessions.length).toBe(8);
    expect(db.sessions.every((s) => s.results.every((r) => r.repsAttempted > 0))).toBe(true);
  });
  it('fits comfortably in local storage', () => {
    expect(JSON.stringify(db).length).toBeLessThan(1_500_000);
  });
});
