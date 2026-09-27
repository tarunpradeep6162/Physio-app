import { describe, expect, it } from 'vitest';
import { buildDemoDb } from '../data/demo';
import { PROTOCOLS } from '../engine/protocols/registry';
import { INTENDED_USES, REAL_PATIENT_USE_ENABLED, releaseAllowed, releaseGate } from './intendedUses';

describe('Phase 20 — controlled release', () => {
  it('real-patient use is disabled and the gate is no-go; the clinical lead approval stays pending', () => {
    const db = buildDemoDb();
    expect(REAL_PATIENT_USE_ENABLED).toBe(false);
    expect(releaseAllowed(db)).toBe(false);
    const g = releaseGate(db);
    expect(g.find((x) => x.id === 'clinical_approval')!.status).toBe('pending');
    expect(g.find((x) => x.id === 'occlusion')!.status).toBe('fail');
    // Even with every rule reviewed and thresholds locked, the build flag and approval keep it closed.
    db.settings.releaseThresholds = { values: {}, lockedBy: 'x', lockedAt: '2026-01-01' };
    expect(releaseAllowed(db)).toBe(false);
  });

  it('every protocol has an intended-use entry locked to its version, with exclusions and a reference measure; none is claimed validated', () => {
    expect(INTENDED_USES.map((u) => u.protocolId).sort()).toEqual(Object.keys(PROTOCOLS).sort());
    for (const u of INTENDED_USES) {
      expect(u.protocolVersion).toBe(PROTOCOLS[u.protocolId].version);
      expect(u.status).toBe('not_validated');
      expect(['synthetic_only', 'lab_emulated']).toContain(u.evidence);
      expect(u.notFor.join(' ')).toMatch(/Diagnosis/);
      expect(u.reference).not.toBe('To be defined');
    }
  });
});
