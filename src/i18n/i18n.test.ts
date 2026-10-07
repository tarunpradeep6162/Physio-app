import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ta } from './ta';

describe('Phase 19 — localisation integrity', () => {
  it('every Tamil string belongs to an English key and keeps the same placeholders', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const [k, v] of Object.entries(ta)) {
      expect(k in en, `stale Tamil key ${k}`).toBe(true);
      expect(ph(v as string), `placeholders in ${k}`).toBe(ph(en[k as keyof typeof en]));
    }
  });
  it('safety-critical English strings exist (the fallback when Tamil is missing)', () => {
    for (const k of ['plan.paused_body', 'companion.checkin_explain', 'safety.review_body'] as const) expect(en[k]).toBeTruthy();
  });
});

describe('Phase 46 — translation review workflow', async () => {
  const { reviewState, reviewSummary, TA_REVIEWS } = await import('./review');
  const { pseudo, translate } = await import('./index');

  it('no recorded review is stale: a changed English or Tamil string needs re-review', () => {
    const stale = Object.keys(TA_REVIEWS).filter((k) => !(k in en) || reviewState(k as keyof typeof en) !== 'reviewed');
    expect(stale, `re-review: ${stale.join(', ')}`).toEqual([]);
  });

  it('every review names a reviewer and a date', () => {
    for (const [k, r] of Object.entries(TA_REVIEWS)) {
      expect(r.reviewer.trim(), k).not.toBe('');
      expect(r.date, k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('review state follows the exact approved text', () => {
    const key = Object.keys(ta)[0] as keyof typeof en;
    const r = { [key]: { en: en[key], ta: ta[key]!, reviewer: 'Test', date: '2026-10-07' } };
    expect(reviewState(key, r)).toBe('reviewed');
    expect(reviewState(key, { [key]: { ...r[key], en: en[key] + ' (old wording)' } })).toBe('stale');
    expect(reviewState(key, {})).toBe('draft');
    const missing = (Object.keys(en) as (keyof typeof en)[]).find((k) => !(k in ta))!;
    expect(reviewState(missing, {})).toBe('missing');
    const s = reviewSummary({});
    expect(s.missing + s.draft).toBe(Object.keys(en).length);
  });

  it('pseudo-locale lengthens text and keeps placeholders intact', () => {
    const p = pseudo('Pain {n} of {max} today');
    expect(p).toContain('{n}');
    expect(p).toContain('{max}');
    expect(p.length).toBeGreaterThan('Pain {n} of {max} today'.length * 1.3);
    expect(translate('pseudo', 'common.continue')).toMatch(/^\[.*\]$/);
    expect(translate('pseudo', 'calib.joint_hidden', { joints: 'knees' })).toContain('knees');
  });
});
