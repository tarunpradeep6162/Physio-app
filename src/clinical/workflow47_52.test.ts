import { describe, expect, it } from 'vitest';
import { buildDemoDb } from '../data/demo';
import type { ChallengeClip, ClinicalNote, Letter, Measurement, OutcomeInstrument } from '../data/models';
import { AuthorizationError, getDb, insert, remove, replaceDb, update, uuid } from '../data/store';
import { decodeLandmarks } from '../lab/filterStudy';
import { checkClip, encodeLandmarks, exportChallengeSet } from '../lab/challenge';
import { captureQuality } from './captureQuality';
import { goalViews, validateGoalText, validateRating } from './goals';
import { canEditLetter, letterText, LETTER_LIMITATIONS, newVersion, signLetter } from './letters';
import { noteChains, quoteMeasurement, soapBody } from './notes';
import { canEnable, editInstrument, enableBlockers } from './outcomes';

const NOW = '2026-10-07T09:00:00.000Z';

describe('Phase 47 — patient goals', () => {
  it('accepts the patient’s own words and 0–10 whole-number ratings only', () => {
    expect(validateGoalText('  ')).not.toBeNull();
    expect(validateGoalText('Climb the stairs at home without stopping')).toBeNull();
    expect(validateRating(7)).toBeNull();
    expect(validateRating(11)).not.toBeNull();
    expect(validateRating(6.5)).not.toBeNull();
  });

  it('shows ratings in order and a descriptive change, active goals first', () => {
    const goals = [
      { id: 'g1', patientId: 'p', text: 'Old goal', createdBy: 'p', createdAt: '2026-09-01', status: 'achieved' as const },
      { id: 'g2', patientId: 'p', text: 'Stairs', createdBy: 'p', createdAt: '2026-09-10', status: 'active' as const },
    ];
    const ratings = [
      { id: 'r2', goalId: 'g2', patientId: 'p', rating: 6, ratedBy: 'p', ratedAt: '2026-10-01' },
      { id: 'r1', goalId: 'g2', patientId: 'p', rating: 2, ratedBy: 'p', ratedAt: '2026-09-12' },
    ];
    const v = goalViews('p', goals, ratings);
    expect(v.map((x) => x.goal.id)).toEqual(['g2', 'g1']);
    expect(v[0].latest?.rating).toBe(6);
    expect(v[0].change).toBe(4);
    expect(v[1].change).toBeNull();
  });
});

describe('Phase 48 — structured notes keep sources separate', () => {
  const m = (over: Partial<Measurement>): Measurement => ({
    id: 'm1', patientId: 'p', type: 'knee_flexion', value: 112.4, unit: 'deg', side: 'left', confidence: 0.82, category: 'camera_estimate',
    provenance: { source: 'camera_estimation', createdBy: 'p', createdAt: NOW, engineVersion: 'e', algorithmVersion: 'knee-1.1.0', view: 'side' }, reviewStatus: 'pending', createdAt: NOW, ...over,
  } as Measurement);

  it('quotes a camera value with view, confidence, review state and version', () => {
    const q = quoteMeasurement(m({}), 'Knee flexion');
    expect(q).toMatchObject({ source: 'camera_estimate', value: '112°', view: 'side', version: 'knee-1.1.0' });
    expect(q.quality).toContain('not yet reviewed');
  });

  it('never turns a withheld camera value into a number', () => {
    const q = quoteMeasurement(m({ validity: 'invalid', validityReason: 'knee not in view' }), 'Knee flexion');
    expect(q.value).toBe('withheld: knee not in view');
  });

  it('labels clinician measurements as clinician findings', () => {
    expect(quoteMeasurement(m({ category: 'clinician_measured', reference: { instrument: 'goniometer', blinded: true } }), 'Knee flexion').source).toBe('clinician_finding');
  });

  it('builds the body from the SOAP sections and the labelled quotes', () => {
    const body = soapBody({ subjective: 'Stairs painful', objective: '', assessment: 'Improving', plan: 'Continue' }, [quoteMeasurement(m({}), 'Knee flexion')]);
    expect(body).toContain('S — Subjective\nStairs painful');
    expect(body).not.toContain('O — Objective');
    expect(body).toContain('[Camera estimate; view side');
  });

  it('a correction is a new note; the chain shows the current version and its history', () => {
    const n = (id: string, createdAt: string, amends?: string): ClinicalNote => ({ id, patientId: 'p', authorId: 'c', body: id, createdAt, amends });
    const chains = noteChains([n('a', '2026-10-01'), n('b', '2026-10-02', 'a'), n('c', '2026-10-03')]);
    expect(chains.map((c) => c.current.id)).toEqual(['c', 'b']);
    expect(chains[1].history.map((h) => h.id)).toEqual(['a']);
  });
});

describe('Phase 49 — outcome-measure registry gate', () => {
  const base: OutcomeInstrument = { id: 'i', name: 'Example questionnaire', version: '1.0', licenceStatus: 'not_checked', enabled: false, createdBy: 'c', createdAt: NOW };

  it('cannot be enabled without licence, holder, terms, scoring source and clinical approval', () => {
    expect(canEnable(base)).toBe(false);
    expect(enableBlockers(base)).toHaveLength(5);
    const ready = { ...base, licenceStatus: 'licensed' as const, licenceHolder: 'Holder', licenceRef: 'Agreement 12', scoringSource: 'Official manual v1', clinicalApprovedBy: 'c', clinicalApprovedAt: NOW };
    expect(canEnable(ready)).toBe(true);
    expect(editInstrument(base, { enabled: true }, NOW).enabled).toBe(false);
  });

  it('a change of version or licence withdraws the approval and disables the instrument', () => {
    const live = { ...base, licenceStatus: 'licensed' as const, licenceHolder: 'Holder', licenceRef: 'Agreement 12', scoringSource: 'Manual', clinicalApprovedBy: 'c', clinicalApprovedAt: NOW, enabled: true };
    const next = editInstrument(live, { version: '2.0' }, NOW);
    expect(next.enabled).toBe(false);
    expect(next.clinicalApprovedBy).toBeUndefined();
    expect(editInstrument(live, { name: 'Renamed' }, NOW).enabled).toBe(true);
  });
});

describe('Phase 50 — capture quality counts', () => {
  it('counts withheld captures and metrics by reason and excludes demo data', () => {
    const db = buildDemoDb();
    const demo = captureQuality(db);
    expect(demo.totals.captures).toBe(0);
    expect(demo.excludedDemo).toBeGreaterThan(0);
    const cap = structuredClone(db.captures[0]);
    cap.isDemo = false;
    cap.id = 'real';
    cap.result.quality.verdict = 'invalid';
    cap.result.quality.reasons = ['knee hidden'];
    cap.result.metrics = cap.result.metrics.slice(0, 1).map((x) => ({ ...x, validity: 'invalid' as const, value: null, reason: 'knee hidden' }));
    const q = captureQuality({ ...db, captures: [...db.captures, cap] });
    expect(q.totals).toMatchObject({ captures: 1, invalidCaptures: 1, metrics: 1, withheldMetrics: 1 });
    expect(q.reasons[0]).toEqual({ reason: 'knee hidden', count: 2 });
  });
});

describe('Phase 51 — occlusion challenge clips', () => {
  const lms = Array.from({ length: 33 }, (_, k) => ({ x: k / 40, y: 0.5 - k / 100, z: 0, visibility: 0.9 }));
  const clip = (over: Partial<ChallengeClip> = {}): ChallengeClip => ({
    id: 'c1', label: { occluder: 'phone', joints: ['left elbow'], view: 'front', deviceClass: 'Android' },
    t: Array.from({ length: 40 }, (_, i) => i * 33), frames: Array.from({ length: 40 }, () => encodeLandmarks(lms)),
    occluded: Array.from({ length: 40 }, (_, i) => i >= 20), frameWidth: 720, frameHeight: 1280,
    consent: { participantCode: 'V-01', landmarkUse: true, videoRetained: false, consentVersion: 'x', recordedBy: 'c' }, createdAt: NOW, ...over,
  });

  it('encodes landmarks exactly as the lab fixture decoder reads them', () => {
    const back = decodeLandmarks(encodeLandmarks(lms)!);
    for (let k = 0; k < 33; k++) {
      expect(back[k].x).toBeCloseTo(lms[k].x, 4);
      expect(back[k].y).toBeCloseTo(lms[k].y, 4);
      expect(back[k].visibility).toBeCloseTo(0.9, 4);
    }
  });

  it('refuses clips without occluded and clear frames, labels or participant code', () => {
    expect(checkClip(clip())).toEqual([]);
    expect(checkClip(clip({ occluded: Array(40).fill(false) }))).toContain('no frame is marked as occluded');
    expect(checkClip(clip({ consent: { ...clip().consent, participantCode: '' } }))).toContain('no participant code');
    const bad = exportChallengeSet([clip(), clip({ id: 'c2', t: [0, 1] })], 'occlusion-v1', NOW);
    expect(bad.ok).toBe(false);
    const good = exportChallengeSet([clip()], 'occlusion-v1', NOW);
    expect(good.ok && good.file.scenarios[0].occluded.filter(Boolean)).toHaveLength(20);
  });
});

describe('Phase 52 — letters', () => {
  const draft: Letter = { id: 'l1', patientId: 'p', kind: 'referral', to: 'Orthopaedic clinic', body: 'Please review.', inserted: [], status: 'draft', createdBy: 'c', createdAt: NOW };

  it('signs once; a change after signing is a new version', () => {
    const signed = signLetter(draft, 'c', NOW);
    expect(canEditLetter(signed)).toBe(false);
    expect(() => signLetter(signed, 'c', NOW)).toThrow();
    const v2 = newVersion(signed, 'l2', 'c', NOW);
    expect(v2).toMatchObject({ status: 'draft', supersedes: 'l1' });
    expect(v2.signedBy).toBeUndefined();
  });

  it('a draft is marked as a draft and every letter carries the limitations', () => {
    expect(letterText(draft, 'Patient', 'Physio')).toContain('DRAFT — not signed');
    expect(letterText(draft, 'Patient', 'Physio')).toContain(LETTER_LIMITATIONS);
    expect(() => signLetter({ ...draft, to: '' }, 'c', NOW)).toThrow();
  });
});

describe('Phases 47–52 — store rules', () => {
  replaceDb(buildDemoDb());
  const db = getDb();
  const clinician = db.users.find((u) => u.role === 'clinician')!;
  const patientUser = db.users.find((u) => u.role === 'patient')!;
  const patient = db.patients.find((p) => p.userId === patientUser.id)!;

  it('a patient may set goals and rate them, but ratings are append-only', () => {
    insert('goals', { id: 'g', patientId: patient.id, text: 'Walk to the market', createdBy: patientUser.id, createdAt: NOW, status: 'active' }, patientUser.id);
    insert('goalRatings', { id: 'r', goalId: 'g', patientId: patient.id, rating: 3, ratedBy: patientUser.id, ratedAt: NOW }, patientUser.id);
    expect(() => update('goalRatings', 'r', { rating: 9 }, patientUser.id)).toThrow(AuthorizationError);
  });

  it('only a clinician writes letters, notes, instruments and challenge clips; notes are never edited', () => {
    expect(() => insert('letters', { id: uuid(), patientId: patient.id, kind: 'update', to: 'x', body: 'y', inserted: [], status: 'draft', createdBy: patientUser.id, createdAt: NOW }, patientUser.id)).toThrow(AuthorizationError);
    expect(() => insert('outcomeInstruments', { id: uuid(), name: 'x', version: '1', licenceStatus: 'licensed', enabled: true, createdBy: patientUser.id, createdAt: NOW }, patientUser.id)).toThrow(AuthorizationError);
    insert('notes', { id: 'n', patientId: patient.id, authorId: clinician.id, body: 'S: better', createdAt: NOW }, clinician.id);
    expect(() => update('notes', 'n', { body: 'changed' }, clinician.id)).toThrow(AuthorizationError);
    expect(() => remove('notes', 'n', clinician.id)).toThrow(AuthorizationError);
  });
});
