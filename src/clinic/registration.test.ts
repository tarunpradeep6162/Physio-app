import { describe, expect, it } from 'vitest';
import { buildWalkInPatient, normalisePhone, samePhone, validateWalkIn } from './registration';

describe('walk-in registration', () => {
  it('normalises Indian mobile numbers and rejects non-numbers', () => {
    expect(normalisePhone('98765 43210')).toBe('+919876543210');
    expect(normalisePhone('098765-43210')).toBe('+919876543210');
    expect(normalisePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalisePhone('919876543210')).toBe('+919876543210');
    expect(normalisePhone('+447700900123')).toBe('+447700900123');
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('+91 12345')).toBeNull();
    expect(normalisePhone('abc')).toBeNull();
  });
  it('validates name, phone and date of birth', () => {
    expect(validateWalkIn({ name: 'A' }, '2026-10-06')).toEqual(['name']);
    expect(validateWalkIn({ name: 'Asha K', phone: '123', dob: '2030-01-01' }, '2026-10-06')).toEqual(['phone', 'dob']);
    expect(validateWalkIn({ name: 'Asha K', phone: '9876543210', dob: '1990-05-01' }, '2026-10-06')).toEqual([]);
  });
  it('stores only what was provided — no default complaint, diagnosis or score', () => {
    const p = buildWalkInPatient({ name: '  Asha   K ', phone: '9876543210', sex: '' }, 'id1', '2026-10-06T10:00:00Z');
    expect(p).toEqual({ id: 'id1', userId: null, name: 'Asha K', phone: '+919876543210', preferredLanguage: 'en', createdAt: '2026-10-06T10:00:00Z' });
  });
  it('finds existing patients with the same number', () => {
    const a = buildWalkInPatient({ name: 'Asha', phone: '+91 98765 43210' }, 'a', 'x');
    expect(samePhone([a], '09876543210').map((p) => p.id)).toEqual(['a']);
    expect(samePhone([a], '9000000000')).toEqual([]);
  });
});
