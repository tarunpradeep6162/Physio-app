import { describe, expect, it } from 'vitest';
import { buildDemoDb } from '../data/demo';
import { renderPdf } from '../features/report/pdf';
import { buildReport } from './report';

describe('report', () => {
  const db = buildDemoDb();
  const re = db.assessments.find((a) => a.type === 'reassessment')!;
  const base = db.assessments.find((a) => a.id === re.baselineAssessmentId)!;

  it('builds all 14 sections and keeps the unreviewed report preliminary', () => {
    const m = buildReport(db, re.id, 'clinician');
    expect(m.sections.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(m.state).toBe('preliminary');
    const reasoning = JSON.stringify(m.sections.find((s) => s.n === 11));
    expect(reasoning).toContain('DRAFT — no clinician conclusion');
    // Missing data is marked, never invented.
    expect(JSON.stringify(m.sections.find((s) => s.n === 4))).toContain('No static posture capture');
  });

  it('shows the clinician conclusion only once approved', () => {
    const m = buildReport(db, base.id, 'clinician');
    expect(m.state).toBe('clinician_reviewed');
    expect(JSON.stringify(m.sections.find((s) => s.n === 11))).toContain('Clinician conclusion');
  });

  it('reverts to preliminary when assessment data changes after approval', () => {
    const copy = structuredClone(db);
    copy.amendments.push({ id: 'late', assessmentId: base.id, by: 'u', at: new Date(Date.now() + 60_000).toISOString(), key: 'onset', text: 'late edit' } as never);
    const m = buildReport(copy, base.id, 'clinician');
    expect(m.state).toBe('preliminary');
    expect(JSON.stringify(m.sections.find((s) => s.n === 11))).not.toContain('Clinician conclusion');
  });

  it('reverts an approved report after a new static camera scan', () => {
    const copy = structuredClone(db);
    copy.scans.push({ id: 'late-scan', assessmentId: base.id, patientId: base.patientId, kind: 'static_posture', view: 'anterior', createdAt: new Date(Date.now() + 60_000).toISOString() } as never);
    expect(buildReport(copy, base.id, 'clinician').state).toBe('preliminary');
  });

  it('renders a real multi-page PDF', () => {
    const doc = renderPdf(buildReport(db, re.id, 'clinician'));
    const bytes = doc.output('arraybuffer');
    expect(new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5))).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
    const patient = renderPdf(buildReport(db, base.id, 'patient'));
    expect(patient.getNumberOfPages()).toBeGreaterThan(1);
  });
});
