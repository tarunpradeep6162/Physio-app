import { describe, expect, it } from 'vitest';
import { buildDemoDb } from '../data/demo';
import type { SafetyResponse } from '../data/models';
import { getProtocol } from '../engine/protocols/registry';
import { renderPdf } from '../features/report/pdf';
import { buildEvidence } from './evidence';
import { HISTORY_QUESTIONNAIRE, SHOULDER_HISTORY_QUESTIONNAIRE, visibleQuestions } from './intake';
import { PATHWAYS, pathwayFor } from './pathways';
import { buildReport } from './report';
import { evaluateSafety, levelFromResponses, SHOULDER_SAFETY_QUESTIONNAIRE } from './safety';

const shoulderRegion = [{ id: 'r', assessmentId: 'a', regionId: 'shoulder_right', anatomy: 'shoulder', side: 'right' as const, symptomTypes: ['pain' as const] }];

describe('Phase 1 — pathway registry', () => {
  it('every default plan uses protocols of its own region, and reassessment questions exist', () => {
    for (const p of Object.values(PATHWAYS)) {
      for (const item of p.defaultPlan) expect(getProtocol(item.protocolId).region).toBe(p.region);
      const ids = new Set(p.history.questions.map((q) => q.id));
      for (const q of p.reassessQuestions) expect(ids.has(q)).toBe(true);
      for (const r of [...p.sidedRows, ...p.symmetryRows, p.trend]) expect(getProtocol(r.protocolId).region).toBe(p.region);
    }
    expect(pathwayFor({ region: 'shoulder' }).region).toBe('shoulder');
    expect(pathwayFor({ region: undefined }).region).toBe('knee');
  });

  it('marks every shoulder clinical artefact as a draft', () => {
    expect(SHOULDER_HISTORY_QUESTIONNAIRE.status).toMatch(/DRAFT/);
    expect(SHOULDER_SAFETY_QUESTIONNAIRE.status).toMatch(/DRAFT/);
    expect(PATHWAYS.shoulder.hasConsiderationRules).toBe(false);
  });
});

describe('Phase 1 — shoulder history and safety', () => {
  it('asks shoulder questions for a shoulder region and never knee-specific ones', () => {
    const qs = visibleQuestions({ answers: {}, regions: shoulderRegion }, SHOULDER_HISTORY_QUESTIONNAIRE).map((q) => q.id);
    expect(qs).toEqual(expect.arrayContaining(['dominant_arm', 'instability', 'arm_symptoms', 'neck_link', 'func_overhead', 'func_behind_back']));
    expect(qs).not.toContain('locking');
    expect(qs).not.toContain('func_squat');
    // Mechanism only after a sudden onset (adaptive), with shoulder-specific options.
    const sudden = visibleQuestions({ answers: { onset: 'sudden' }, regions: shoulderRegion }, SHOULDER_HISTORY_QUESTIONNAIRE).find((q) => q.id === 'mechanism')!;
    expect(sudden.options!.map((o) => o.id)).toContain('out_of_joint');
    // The knee questionnaire is unchanged.
    expect(HISTORY_QUESTIONNAIRE.id).toBe('knee-history');
    expect(HISTORY_QUESTIONNAIRE.version).toBe('1.0.0');
  });

  it('routes shoulder red flags to the most severe action', () => {
    expect(evaluateSafety({ cardiac: true }, SHOULDER_SAFETY_QUESTIONNAIRE).level).toBe('emergency');
    expect(evaluateSafety({ trauma_cannot_lift: true, night_unrelieved: true }, SHOULDER_SAFETY_QUESTIONNAIRE).level).toBe('urgent');
    expect(evaluateSafety({}, SHOULDER_SAFETY_QUESTIONNAIRE).level).toBe('clear');
  });

  it('re-derives a stored shoulder safety level from its own questionnaire (regression)', () => {
    const rows: SafetyResponse[] = SHOULDER_SAFETY_QUESTIONNAIRE.items.map((it, i) => ({
      id: `s${i}`,
      assessmentId: 'a',
      patientId: 'p',
      questionnaireId: SHOULDER_SAFETY_QUESTIONNAIRE.id,
      questionnaireVersion: SHOULDER_SAFETY_QUESTIONNAIRE.version,
      questionId: it.id,
      questionText: it.text,
      answer: it.id === 'arm_swelling',
      triggered: it.id === 'arm_swelling',
      action: it.id === 'arm_swelling' ? it.action : null,
      at: '2026-09-27T00:00:00Z',
    }));
    // Before the fix this was evaluated against the knee screen and returned 'clear'.
    expect(levelFromResponses(rows)).toBe('urgent');
  });
});

describe('Phase 1 — shoulder assessment through evidence and report (demo DP-04)', () => {
  const db = buildDemoDb();
  const a = db.assessments.find((x) => x.region === 'shoulder')!;

  it('keeps the invalid capture out of every result and invents no observation', () => {
    const invalid = db.captures.find((c) => c.assessmentId === a.id && c.protocolId === 'shoulder_abduction_active' && c.side === 'right')!;
    expect(invalid.result.quality.verdict).toBe('invalid');
    expect(invalid.result.metrics.every((m) => m.validity === 'invalid')).toBe(true);
    const ev = buildEvidence(db, a.id);
    const cam = ev.filter((e) => e.category === 'camera_estimated');
    expect(cam.length).toBeGreaterThan(0);
    for (const e of cam.filter((x) => x.validity !== 'invalid')) expect(e.label).not.toMatch(/abduction.*right|right.*abduction/i);
    // No norms, no thresholds: the shoulder pathway generates no algorithmic observation.
    expect(ev.filter((e) => e.category === 'algorithmic')).toHaveLength(0);
    // Patient answers are recorded against the shoulder questionnaire.
    expect(ev.find((e) => e.id === 'ans:dominant_arm')?.source).toMatchObject({ questionnaire: 'shoulder-history@1.0.0' });
    // Regression: the safety evidence names the screen actually used.
    const safetyItem = ev.find((e) => e.label.startsWith('Safety screen'))!;
    expect(safetyItem.label).toContain('shoulder-safety@1.0.0');
  });

  it('builds a shoulder report: own template, left/right rows, invalid marked, no diagnosis', () => {
    const m = buildReport(db, a.id, 'clinician');
    expect(m.title).toBe('Shoulder assessment report');
    expect(m.templateVersion).toBe('dl-shoulder-report-1.0.0');
    expect(m.state).toBe('preliminary');
    const rom = JSON.stringify(m.sections.find((s) => s.n === 5));
    expect(rom).toContain('Shoulder left — Flexion (peak)');
    expect(rom).toContain('Shoulder right — Abduction (peak)');
    expect(rom).toContain('invalid — recapture');
    const rightAbd = m.sections.find((s) => s.n === 5)!.blocks[0] as { rows: string[][] };
    const row = rightAbd.rows.find((r) => r[0] === 'Shoulder right — Abduction (peak)')!;
    expect(row[2]).toMatch(/^—/);
    const reasoning = JSON.stringify(m.sections.find((s) => s.n === 11));
    expect(reasoning).toContain('No automated considerations');
    expect(reasoning).toContain('DRAFT — no clinician conclusion');
    expect(JSON.stringify(m.sections.find((s) => s.n === 8))).toContain('No camera functional tests');
    expect(JSON.stringify(m.sections.find((s) => s.n === 14))).toContain('shoulder-safety@1.0.0');
    // Patient version: no clinical conclusion until a clinician approves.
    const pt = buildReport(db, a.id, 'patient');
    expect(pt.title).toBe('Shoulder assessment — your summary');
    expect(JSON.stringify(pt.sections)).toContain('has not reviewed this yet');
    expect(renderPdf(m).getNumberOfPages()).toBeGreaterThan(2);
  });

  it('an approved shoulder report becomes stale when a new capture arrives', () => {
    const copy = structuredClone(db);
    const now = Date.now();
    copy.impressions.push({ id: 'imp', assessmentId: a.id, text: 'Demo impression', by: 'u', at: new Date(now - 1000).toISOString(), isDemo: true } as never);
    copy.reports.push({ id: 'r1', assessmentId: a.id, version: 1, status: 'clinician_reviewed', generatedAt: new Date(now).toISOString(), generatedBy: 'u', approvedBy: copy.clinicians[0].id, approvedAt: new Date(now).toISOString(), templateVersion: 'dl-shoulder-report-1.0.0' } as never);
    expect(buildReport(copy, a.id, 'clinician').state).toBe('clinician_reviewed');
    const cap = structuredClone(copy.captures.find((c) => c.assessmentId === a.id)!);
    cap.id = 'late';
    cap.createdAt = new Date(now + 60_000).toISOString();
    copy.captures.push(cap);
    expect(buildReport(copy, a.id, 'clinician').state).toBe('preliminary');
  });
});
