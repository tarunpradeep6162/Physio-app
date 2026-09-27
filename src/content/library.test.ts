import { describe, expect, it } from 'vitest';
import { preparePublish } from '../clinical/plan';
import { buildDemoDb } from '../data/demo';
import { AuthorizationError, getDb, insert, replaceDb, uuid } from '../data/store';
import { getDefinition } from '../engine/exercises/definitions';
import { approve, ContentWorkflowError, importLibrary, latestItems, newVersion, publishedItems, submitForReview } from './contentStore';
import { cameraLabel, isPublished, LibraryIndex, validateItem, type ContentItem } from './library';
import { SEED_CONTENT } from './seed';

describe('Phase 16 — exercise content system', () => {
  it('starter content is complete but unpublished: drafts awaiting review, camera subset labelled with its QA level', () => {
    const known = new Set(SEED_CONTENT.map((i) => i.id));
    for (const it of SEED_CONTENT) {
      expect(validateItem(it, known)).toEqual([]);
      expect(it.review.status).toBe('draft');
      expect(isPublished(it, known)).toBe(false);
    }
    const cam = SEED_CONTENT.filter((i) => i.camera.status === 'camera_guided');
    expect(cam.map((i) => i.id).sort()).toEqual(['arm-raise-forward', 'arm-raise-side', 'standing-knee-bend', 'straight-leg-raise']);
    for (const c of cam) expect(cameraLabel(c)).toMatch(/synthetic tests only; not yet tested on devices/);
    expect(SEED_CONTENT.filter((i) => i.camera.status !== 'camera_guided').every((i) => cameraLabel(i) === null)).toBe(true);
  });

  it('no item is advertised as camera-guided without an existing per-exercise definition, matching version and QA evidence', () => {
    const base = SEED_CONTENT[0];
    const bad = (camera: ContentItem['camera']) => validateItem({ ...base, camera });
    expect(bad({ status: 'camera_guided', definitionId: 'hip_hike', definitionVersion: '1.0.0', qa: 'validated', qaEvidence: 'x' }).join()).toMatch(/existing per-exercise camera definition/);
    expect(bad({ status: 'camera_guided', definitionId: 'knee_flexion', definitionVersion: '0.9.0', qa: 'synthetic_tested', qaEvidence: 'x' }).join()).toMatch(/does not match/);
    expect(bad({ status: 'camera_guided', definitionId: 'knee_flexion', definitionVersion: getDefinition('knee_flexion').version, qa: 'synthetic_tested', qaEvidence: '' }).join()).toMatch(/QA evidence/);
  });

  it('media needs rights and alternative text; expired licences block publication', () => {
    const it = { ...SEED_CONTENT[5], media: [{ kind: 'video' as const, uri: 'x.mp4', rights: { owner: '', licence: '' }, alt: '' }] };
    expect(validateItem(it).join()).toMatch(/rights owner and licence required.*alternative text required/);
    const expired = { ...SEED_CONTENT[5], media: [{ kind: 'video' as const, uri: 'x.mp4', rights: { owner: 'Clinic', licence: 'CC-BY', expires: '2020-01-01' }, alt: 'demo' }] };
    expect(validateItem(expired).join()).toMatch(/licence expired/);
  });

  it('imports are always unreviewed and never camera-guided, whatever the file claims; nothing imported is published', () => {
    replaceDb(buildDemoDb());
    const clin = getDb().users.find((u) => u.role === 'clinician')!;
    const file = JSON.stringify([
      { id: 'imported-squat', title: 'Wall squat', instructions: ['Stand against a wall', 'Slide down a little'], precautions: ['Stop if the knee hurts'], goals: ['strength'], regions: ['knee'], review: { status: 'approved', owner: 'x' }, camera: { status: 'camera_guided', definitionId: 'knee_flexion', qa: 'validated' } },
      { title: 'no id' },
    ]);
    const r = importLibrary(file, clin.id, 'vendor.json');
    expect(r.added).toBe(1);
    expect(r.errors[0]).toMatch(/id and title required/);
    const it = latestItems(getDb()).find((i) => i.id === 'imported-squat')!;
    expect(it.review.status).toBe('imported_unreviewed');
    expect(it.camera.status).toBe('not_camera_guided');
    expect(publishedItems(getDb()).some((i) => i.id === 'imported-squat')).toBe(false);
    expect(importLibrary(file, clin.id, 'vendor.json').added).toBe(0);
  });

  it('review workflow: only a clinician publishes, only complete items in review, and edits create a new version', () => {
    replaceDb(buildDemoDb());
    const clin = getDb().users.find((u) => u.role === 'clinician')!;
    const patient = getDb().users.find((u) => u.role === 'patient')!;
    const item = SEED_CONTENT.find((i) => i.id === 'sit-to-stand')!;
    expect(() => approve(item, clin.id, 'Demo clinician')).toThrow(ContentWorkflowError); // not in review
    expect(() => submitForReview(item, patient.id)).toThrow(AuthorizationError);
    submitForReview(item, clin.id);
    const inReview = latestItems(getDb()).find((i) => i.id === 'sit-to-stand')!;
    expect(() => approve({ ...inReview, precautions: [] }, clin.id, 'Demo clinician')).toThrow(/precautions/);
    approve(inReview, clin.id, 'Demo clinician', 'Demo approval');
    const pub = publishedItems(getDb());
    expect(pub.map((i) => i.id)).toEqual(['sit-to-stand']);
    expect(pub[0].review.reviewedBy).toBe('Demo clinician');
    const v2 = newVersion(pub[0], { instructions: [...pub[0].instructions, 'Rest between repetitions.'] }, clin.id);
    expect(v2.version).toBe('0.1.1');
    expect(v2.review.status).toBe('draft');
    // The approved version stays published until the new one is approved.
    expect(publishedItems(getDb())[0].version).toBe('0.1.0');
    expect(() => insert('contentReviews', { id: uuid(), itemId: 'x', version: '1', action: 'approve', by: patient.id, at: '' }, patient.id)).toThrow(AuthorizationError);
  });

  it('a plan version can prescribe approved library items with dosage; increasing their dosage needs a reason', () => {
    const db = getDb();
    const prog = db.programs.find((p) => p.status === 'active')!;
    const clin = db.clinicians.find((c) => c.id === prog.clinicianId)!;
    const rx = db.programExercises.filter((e) => e.programId === prog.id).map((e) => e.prescription);
    const lib = [{ itemId: 'sit-to-stand', itemVersion: '0.1.0', sets: 2, reps: 8, frequencyPerWeek: 5 }];
    const p1 = preparePublish(db, { patientId: prog.patientId, clinicianId: clin.id, title: 'x', startDate: '2026-01-01', endDate: '2026-02-01', exercises: rx, library: lib, changeReason: 'added library item' }, new Date().toISOString(), uuid, (r) => getDefinition(r.definitionId).version);
    expect(p1.errors).toEqual([]);
    expect(p1.programLibraryItems).toHaveLength(1);
    expect(p1.changes.find((c) => c.exercise === 'library:sit-to-stand')?.direction).toBe('intensify');
    const bad = preparePublish(db, { patientId: prog.patientId, clinicianId: clin.id, title: 'x', startDate: '2026-01-01', endDate: '2026-02-01', exercises: rx, library: [{ ...lib[0], reps: undefined }], changeReason: 'r' }, new Date().toISOString(), uuid, (r) => getDefinition(r.definitionId).version);
    expect(bad.errors).toContain('library_dosage');
  });

  it('designed for 2,000+ records: indexing and faceted search over 2,500 items stay interactive', () => {
    // Generated IN THE TEST ONLY to exercise scale — never shipped or shown as content.
    const regions = ['knee', 'hip', 'ankle', 'shoulder', 'neck', 'lower_back'] as const;
    const positions = ['standing', 'seated', 'supine'] as const;
    const many: ContentItem[] = Array.from({ length: 2500 }, (_, n) => ({
      ...SEED_CONTENT[4],
      id: `scale-test-${n}`,
      title: `Scale test item ${n}`,
      regions: [regions[n % regions.length]],
      position: positions[Math.floor(n / 6) % positions.length],
      difficulty: ((n % 5) + 1) as ContentItem['difficulty'],
      accessibility: Math.floor(n / 18) % 2 === 0 ? ['seated_option'] : [],
      review: { status: n % 10 === 0 ? 'approved' : 'draft', owner: 'test' },
    }));
    const t0 = performance.now();
    const idx = new LibraryIndex(many);
    const t1 = performance.now();
    const hits = idx.search({ regions: ['knee'], positions: ['seated'], accessibility: ['seated_option'], maxDifficulty: 3, text: 'scale' });
    const t2 = performance.now();
    expect(hits.every((h) => h.regions.includes('knee') && h.position === 'seated' && h.accessibility.includes('seated_option') && h.difficulty <= 3)).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
    expect(t1 - t0).toBeLessThan(500);
    expect(t2 - t1).toBeLessThan(50);
  });
});
