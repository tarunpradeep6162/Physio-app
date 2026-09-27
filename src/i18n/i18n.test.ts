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
