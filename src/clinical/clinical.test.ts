import { describe, expect, it } from 'vitest';
import type { DB } from '../data/models';
import { emptyDb, migrate } from '../data/store';
import { cameraProvenance } from '../engine/provenance';
import { SIM_PROVIDER, simulateCapture } from '../engine/protocols/simulate';
import { buildEvidence } from './evidence';
import { organiseHistory, visibleQuestions } from './intake';
import { evaluate } from './reasoning';
import { evaluateSafety, routineAllowed } from './safety';

function dbWith(answers: Record<string, unknown>, regions: { regionId: string; sub?: string[]; symptoms?: string[] }[] = [], dob = '1990-01-01'): DB {
  const db = emptyDb();
  db.patients.push({ id: 'p', userId: null, name: 'DP-TEST', dob, preferredLanguage: 'en', createdAt: '2026-01-01' });
  db.assessments.push({ id: 'a', patientId: 'p', createdBy: 'u', status: 'in_progress', createdAt: '2026-01-01', step: 0, region: 'knee', type: 'initial' });
  regions.forEach((r, i) => db.painRegions.push({ id: `r${i}`, assessmentId: 'a', regionId: r.regionId, subLocations: r.sub, symptomTypes: (r.symptoms ?? ['pain']) as never }));
  Object.entries(answers).forEach(([q, v], i) =>
    db.intakeAnswers.push({ id: `ans${i}`, assessmentId: 'a', patientId: 'p', questionnaireId: 'knee-history', questionnaireVersion: '1.0.0', questionId: q, questionText: q, answer: v as never, answeredAt: `2026-01-01T00:00:0${i % 10}Z` }),
  );
  return db;
}

describe('adaptive history', () => {
  it('asks mechanism only after a sudden onset and knee questions only for knee symptoms', () => {
    const base = { answers: {}, regions: [] };
    expect(visibleQuestions(base).some((q) => q.id === 'mechanism')).toBe(false);
    expect(visibleQuestions({ ...base, answers: { onset: 'sudden' } }).some((q) => q.id === 'mechanism')).toBe(true);
    expect(visibleQuestions(base).some((q) => q.id === 'locking')).toBe(false);
    expect(visibleQuestions({ answers: {}, regions: [{ id: 'r', assessmentId: 'a', regionId: 'knee_left' }] }).some((q) => q.id === 'locking')).toBe(true);
  });
  it('organises answers into traceable lines', () => {
    const lines = organiseHistory({ onset: 'sudden', mechanism: ['twisting'], duration: '1_6w', nprs_now: 4, nprs_worst: 7 }, []);
    const onset = lines.find((l) => l.key === 'onset')!;
    expect(onset.text).toContain('twisting');
    expect(onset.sources).toEqual(['onset', 'mechanism', 'duration']);
  });
});

describe('safety questionnaire', () => {
  it('takes the most severe triggered action and blocks routine steps', () => {
    expect(evaluateSafety({ locked: true }).level).toBe('clinician_review');
    expect(evaluateSafety({ locked: true, calf: true }).level).toBe('urgent');
    expect(evaluateSafety({ calf: true, hot_swollen_fever: true }).level).toBe('emergency');
    expect(routineAllowed('clear')).toBe(true);
    expect(routineAllowed('clinician_review')).toBe(false);
  });
});

describe('evidence and reasoning', () => {
  it('links answers to considerations with supportive / conflicting evidence and missing info', () => {
    const db = dbWith(
      { onset: 'gradual', aggravating: ['stairs_down', 'squatting'], swelling: 'none', time_of_day: ['during_activity'] },
      [{ regionId: 'knee_left', sub: ['anterior'] }],
    );
    const ev = buildEvidence(db, 'a');
    const res = evaluate(ev, 'clear');
    const pf = res.find((r) => r.rule.id === 'patellofemoral')!;
    expect(pf.state).toBe('supportive');
    expect(pf.supporting.map((s) => s.label)).toContain('Pain at the front of the knee');
    expect(pf.missing).toContain('Squat capture');
    const menisc = res.find((r) => r.rule.id === 'meniscal')!;
    expect(menisc.conflicting.map((c) => c.label)).toContain('No swelling reported');
    // No numeric probabilities anywhere in the output.
    expect(JSON.stringify(res)).not.toMatch(/probability|%/i);
  });

  it('suppresses all considerations while a safety pathway is active', () => {
    const db = dbWith({ onset: 'sudden', mechanism: ['twisting'] }, [{ regionId: 'knee_right' }]);
    const res = evaluate(buildEvidence(db, 'a'), 'urgent');
    expect(res.every((r) => r.state === 'safety_hold')).toBe(true);
  });

  it('uses only VALID camera captures as evidence facts, via versioned observation rules', () => {
    const db = dbWith({ onset: 'after_surgery' }, [{ regionId: 'knee_left' }]);
    const mk = (side: 'left' | 'right', peak: number, occlude = false) => {
      const result = simulateCapture('knee_supported_flexion', side, {
        peak,
        perturb: occlude ? (l, t) => (t > 2 ? l.map((x, i) => (i === 25 || i === 26 ? { ...x, visibility: 0.1 } : x)) : l) : undefined,
      });
      db.captures.push({ id: `c${side}${occlude}`, assessmentId: 'a', patientId: 'p', protocolId: result.protocolId, protocolVersion: result.protocolVersion, side, result, config: null, provenance: cameraProvenance({ createdBy: 'u', provider: SIM_PROVIDER, confidence: 0.9, filter: 'one_euro' }), createdAt: `2026-01-02T00:00:0${side === 'left' ? 1 : 2}Z` });
    };
    mk('left', 95);
    mk('right', 128);
    const ev = buildEvidence(db, 'a');
    expect(ev.some((e) => e.facts.includes('rom:flexion_limited_left'))).toBe(true);
    expect(ev.some((e) => e.facts.includes('rom:flexion_asymmetry'))).toBe(true);
    const post = evaluate(ev, 'clear').find((r) => r.rule.id === 'post_operative')!;
    expect(post.state).toBe('supportive');

    // A later INVALID recapture replaces the left result: no numeric facts may be drawn from it.
    mk('left', 95, true);
    const ev2 = buildEvidence(db, 'a');
    expect(ev2.some((e) => e.facts.includes('rom:flexion_limited_left'))).toBe(false);
    expect(ev2.find((e) => e.id.includes('knee_flexion_peak') && e.validity === 'invalid')?.value).toMatch(/Not reported/);
  });
});

describe('data migration', () => {
  it('preserves v1 records when upgrading to v2', () => {
    const v1 = { ...emptyDb(), schemaVersion: 1 } as DB;
    v1.assessments = [{ id: 'old', patientId: 'p', createdBy: 'u', status: 'reviewed', createdAt: '2025-01-01', step: 5 }];
    delete (v1 as Partial<DB>).captures;
    const m = migrate(v1);
    expect(m.schemaVersion).toBe(2);
    expect(m.assessments[0].id).toBe('old');
    expect(m.assessments[0].type).toBe('initial');
    expect(m.captures).toEqual([]);
  });
});
