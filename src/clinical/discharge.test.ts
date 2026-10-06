import { describe, expect, it } from 'vitest';
import type { DB } from '../data/models';
import { emptyDb } from '../data/store';
import { parseSummary } from '../evidence/pubmed';
import { buildDischarge, dischargeFingerprint, dischargeStatus } from './discharge';

function fixture(): DB {
  const db = emptyDb();
  db.patients.push({ id: 'p1', userId: null, name: 'Asha Raman', preferredLanguage: 'en', concern: 'Knee pain on stairs', createdAt: '2026-09-01T00:00:00Z' });
  db.clinicians.push({ id: 'c1', userId: 'u1', name: 'Demo physio', title: 'Physiotherapist', clinic: 'Lab', createdAt: '2026-09-01T00:00:00Z' });
  db.treatmentCourses.push({ id: 'tc', patientId: 'p1', title: 'Knee rehab', plannedSessions: 6, feePaise: 600000, startDate: '2026-09-02', status: 'active', createdBy: 'u1', createdAt: '2026-09-02T00:00:00Z' });
  db.appointments.push({ id: 'a1', patientId: 'p1', clinicianId: 'c1', at: '2026-09-03T04:30:00Z', kind: 'session', status: 'done', courseId: 'tc', createdBy: 'u1', createdAt: '2026-09-02T00:00:00Z' });
  db.appointments.push({ id: 'a2', patientId: 'p1', clinicianId: 'c1', at: '2026-09-10T04:30:00Z', kind: 'session', status: 'scheduled', courseId: 'tc', createdBy: 'u1', createdAt: '2026-09-02T00:00:00Z' });
  db.pros.push({ id: 'n1', patientId: 'p1', type: 'nprs_now', value: 6, recordedAt: '2026-09-02T00:00:00Z' });
  db.pros.push({ id: 'n2', patientId: 'p1', type: 'nprs_now', value: 3, recordedAt: '2026-09-20T00:00:00Z' });
  return db;
}

const section = (m: ReturnType<typeof buildDischarge>, title: string) => m.sections.find((s) => s.title === title);

describe('discharge summary', () => {
  it('uses recorded data only and marks gaps as missing', () => {
    const m = buildDischarge(fixture(), 'p1');
    expect(m.state).toBe('preliminary');
    expect(JSON.stringify(section(m, 'Treatment and attendance'))).toContain('"Knee rehab","2026-09-02","6","1","0","active"');
    expect(JSON.stringify(section(m, 'Pain'))).toContain('6/10');
    expect(section(m, 'Pain')?.label).toBe('Patient-reported');
    expect(section(m, 'Measurements')?.blocks[0]).toEqual({ kind: 'missing', text: 'No assessment recorded.' });
    expect(section(m, 'Discharge summary')?.blocks[0].kind).toBe('missing');
  });

  it('is clinician-reviewed once signed, and preliminary again when attendance changes', () => {
    const db = fixture();
    db.discharges.push({ id: 'd1', patientId: 'p1', version: 1, summary: 'Goals met', advice: 'Continue home plan', followUp: 'Review if pain returns', signedBy: 'c1', signedAt: '2026-09-21T00:00:00Z', fingerprint: dischargeFingerprint(db, 'p1') });
    const signed = buildDischarge(db, 'p1');
    expect(signed.state).toBe('clinician_reviewed');
    expect(signed.approvedBy).toBe('Demo physio');
    expect(JSON.stringify(section(signed, 'Discharge summary'))).toContain('Goals met');
    // A visit marked attended after signing has no timestamp of its own; the fingerprint still catches it.
    db.appointments = db.appointments.map((a) => (a.id === 'a2' ? { ...a, status: 'done' } : a));
    expect(dischargeStatus(db, 'p1')).toMatchObject({ signed: false, stale: true, nextVersion: 2 });
    const after = buildDischarge(db, 'p1');
    expect(after.state).toBe('preliminary');
    expect(after.staleApproval).toBe(true);
  });

  it('a draft preview is always preliminary', () => {
    const db = fixture();
    db.discharges.push({ id: 'd1', patientId: 'p1', version: 1, summary: 'x', advice: '', followUp: '', signedBy: 'c1', signedAt: '2026-09-21T00:00:00Z', fingerprint: dischargeFingerprint(db, 'p1') });
    const m = buildDischarge(db, 'p1', { summary: 'new text', advice: '', followUp: '' });
    expect(m.state).toBe('preliminary');
    expect(m.documentVersion).toBe(2);
  });
});

describe('PubMed DOI', () => {
  it('copies a DOI listed by PubMed and never invents one', () => {
    const json = {
      result: {
        '1': { uid: '1', title: 'A trial', source: 'J', pubdate: '2020', articleids: [{ idtype: 'pubmed', value: '1' }, { idtype: 'doi', value: '10.1000/xyz.123' }] },
        '2': { uid: '2', title: 'No DOI', source: 'J', pubdate: '2021', articleids: [{ idtype: 'pubmed', value: '2' }] },
        '3': { uid: '3', title: 'Bad DOI', source: 'J', pubdate: '2021', articleids: [{ idtype: 'doi', value: 'not-a-doi' }] },
      },
    };
    const refs = parseSummary(json, ['1', '2', '3'], 'q', 't');
    expect(refs[0].doi).toBe('10.1000/xyz.123');
    expect(refs[1].doi).toBeUndefined();
    expect(refs[2].doi).toBeUndefined();
  });
});
