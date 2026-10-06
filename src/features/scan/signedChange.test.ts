import { describe, expect, it } from 'vitest';
import { signedChange } from './StaticScan';

describe('self-correction change label', () => {
  it('signs non-zero changes and never prints -0.0', () => {
    expect(signedChange(1.24, 'deg')).toBe('+1.2°');
    expect(signedChange(-0.84, 'pct')).toBe('−0.8%');
    expect(signedChange(-0.04, 'deg')).toBe('0.0°');
    expect(signedChange(0, 'deg')).toBe('0.0°');
  });
});
