import { describe, expect, it } from 'vitest';
import { buildDemoDb } from './demo';
import { AuthorizationError, getDb, insert, replaceDb, update, uuid } from './store';

describe('Phase 8 — clinical decisions are an enforced authorization boundary', () => {
  replaceDb(buildDemoDb());
  const db = getDb();
  const clinician = db.users.find((u) => u.role === 'clinician')!;
  const patientUser = db.users.find((u) => u.role === 'patient')!;
  const a = db.assessments.find((x) => x.region === 'shoulder')!;

  it('a patient session, or a non-user actor such as an AI draft, cannot sign an impression or approve a report', () => {
    const imp = () => ({ id: uuid(), assessmentId: a.id, text: 'Impression', by: 'x', at: new Date().toISOString() });
    expect(() => insert('impressions', imp(), patientUser.id)).toThrow(AuthorizationError);
    expect(() => insert('impressions', imp(), 'ai-draft')).toThrow(AuthorizationError);
    expect(() => insert('reports', { id: uuid(), assessmentId: a.id, version: 9, status: 'clinician_reviewed', generatedAt: '', generatedBy: patientUser.id, approvedBy: patientUser.id, approvedAt: '', templateVersion: 't' }, patientUser.id)).toThrow(AuthorizationError);
    expect(() => insert('draftDecisions', { id: uuid(), assessmentId: a.id, draftSchema: 's', generator: 'g', section: 'summary', proposal: 'p', evidence: [], action: 'accept', by: 'x', at: '' }, patientUser.id)).toThrow(AuthorizationError);
  });

  it('a patient cannot mark a camera measurement as clinician-accepted', () => {
    const m = getDb().measurements.find((x) => x.assessmentId === a.id && x.category === 'camera_estimate')!;
    expect(() => update('measurements', m.id, { reviewStatus: 'accepted' }, patientUser.id)).toThrow(AuthorizationError);
  });

  it('the clinician can, and a patient can still do patient things (a preliminary report, their default plan)', () => {
    expect(() => insert('impressions', { id: uuid(), assessmentId: a.id, text: 'Clinician impression', by: clinician.id, at: new Date().toISOString() }, clinician.id)).not.toThrow();
    expect(() => insert('reports', { id: uuid(), assessmentId: a.id, version: 10, status: 'preliminary', generatedAt: '', generatedBy: patientUser.id, templateVersion: 't' }, patientUser.id)).not.toThrow();
    expect(() => insert('testPlans', { id: uuid(), assessmentId: a.id, items: [], source: 'protocol_default', createdBy: patientUser.id, createdAt: '' }, patientUser.id)).not.toThrow();
    expect(() => insert('testPlans', { id: uuid(), assessmentId: a.id, items: [], source: 'clinician', createdBy: patientUser.id, createdAt: '' }, patientUser.id)).toThrow(AuthorizationError);
  });
});
