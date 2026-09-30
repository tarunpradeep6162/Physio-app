import { describe, expect, it } from 'vitest';
import { monthlyVolume, patientCode } from './directory';

describe('Clinician directory', () => {
  it('patient code is opaque: derived only from the random record id', () => {
    expect(patientCode('3f2a9c1e-7b4d-4e2a-9f10-0c5d8e7a6b21')).toBe('PT-3F2A9C');
    expect(patientCode('3f2a9c1e-7b4d-4e2a-9f10-0c5d8e7a6b21')).toMatch(/^PT-[0-9A-F]{6}$/);
  });

  it('counts registrations and assessments per month, with empty months kept and out-of-range months ignored', () => {
    const db = {
      patients: [{ createdAt: '2026-07-03T10:00:00Z' }, { createdAt: '2026-09-01T10:00:00Z' }, { createdAt: '2026-09-20T10:00:00Z' }, { createdAt: '2025-01-01T00:00:00Z' }],
      assessments: [{ createdAt: '2026-09-02T10:00:00Z' }, { createdAt: '2026-08-15T10:00:00Z' }],
    } as never;
    const v = monthlyVolume(db, 3, new Date('2026-09-30T12:00:00Z'));
    expect(v).toEqual([
      { month: '2026-07', newPatients: 1, assessments: 0 },
      { month: '2026-08', newPatients: 0, assessments: 1 },
      { month: '2026-09', newPatients: 2, assessments: 1 },
    ]);
  });
});
