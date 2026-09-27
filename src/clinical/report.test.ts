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

  it('a clinician-rejected capture metric is not reported as a finding, and the approval reverts', () => {
    const copy = structuredClone(db);
    const cap = copy.captures.find((c) => c.assessmentId === base.id && c.protocolId === 'knee_supported_flexion')!;
    let row = copy.measurements.find((m) => m.captureId === cap.id && m.metricId === 'knee_flexion_peak' && m.category === 'camera_estimate');
    if (!row) {
      row = { id: 'mrow', patientId: cap.patientId, assessmentId: base.id, type: 'knee_flexion_peak', value: 1, unit: 'deg', confidence: 0.9, category: 'camera_estimate', captureId: cap.id, metricId: 'knee_flexion_peak', provenance: cap.provenance, reviewStatus: 'pending', createdAt: cap.createdAt } as never;
      copy.measurements.push(row!);
    }
    const before = JSON.stringify(buildReport(copy, base.id, 'clinician').sections.find((x) => x.n === 5));
    const peak = cap.result.metrics.find((m) => m.id === 'knee_flexion_peak')!.value!;
    expect(before).toContain(`${peak}`);
    row!.reviewStatus = 'rejected';
    row!.reviewedAt = new Date(Date.now() + 60_000).toISOString();
    const m = buildReport(copy, base.id, 'clinician');
    expect(m.state).toBe('preliminary');
    const rom = JSON.stringify(m.sections.find((x) => x.n === 5));
    expect(rom).not.toContain(`${peak}°`);
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
