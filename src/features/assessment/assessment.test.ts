import { describe, expect, it } from 'vitest';
import { parseRegion, regionLabel, VIEWS, viewsFor } from '../bodymap/regions';
import { triage } from './redFlags';

describe('red-flag triage', () => {
  it('routes urgent, review and clear answers', () => {
    expect(triage({ bladder: true })).toBe('urgent');
    expect(triage({ calf: true, night: true })).toBe('urgent');
    expect(triage({ night: true })).toBe('review');
    expect(triage({ bladder: false, night: false })).toBe('clear');
  });
});

describe('body map regions', () => {
  it('uses unique ids within each view', () => {
    for (const regions of Object.values(VIEWS)) {
      const ids = regions.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('shares view-independent ids across views', () => {
    expect(viewsFor('knee_left')).toEqual(expect.arrayContaining(['front', 'left']));
    expect(viewsFor('lower_back_center')).toEqual(expect.arrayContaining(['back', 'left', 'right']));
  });
  it('labels regions from the patient perspective', () => {
    expect(parseRegion('shoulder_right_back')).toEqual({ part: 'shoulder_back', side: 'right' });
    expect(regionLabel('knee_left')).toBe('Left knee');
    expect(regionLabel('lower_back_center')).toBe('Lower back');
  });
  it('places the patient LEFT knee on the viewer RIGHT in the front view', () => {
    const k = VIEWS.front.find((r) => r.id === 'knee_left')!.shape;
    expect(k.kind).toBe('capsule');
    if (k.kind === 'capsule') expect(k.x1).toBeGreaterThan(110);
    const back = VIEWS.back.find((r) => r.id === 'knee_left_back')!.shape;
    if (back.kind === 'capsule') expect(back.x1).toBeLessThan(110);
  });
});
