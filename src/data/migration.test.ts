import { describe, expect, it } from 'vitest';
import { buildDemoDb } from './demo';
import { buildMigrationBundle, canonical, sha256Hex } from './migration';

describe('server migration export', () => {
  it('excludes demo data and password hashes by default and carries a verifiable checksum', async () => {
    const db = buildDemoDb();
    // One real (non-demo) patient + user alongside the demo set.
    db.users.push({ id: 'u-real', email: 'r@example.test', passwordHash: 'h', passwordSalt: 's', role: 'patient', displayName: 'R', createdAt: '2026-01-01' } as never);
    db.patients.push({ id: 'p-real', userId: 'u-real', name: 'TEST-R', preferredLanguage: 'en', createdAt: '2026-01-01' });
    const b = await buildMigrationBundle(db);
    expect(b.tables.patients).toHaveLength(1);
    expect((b.tables.patients[0] as { id: string }).id).toBe('p-real');
    expect(b.tables.captures).toHaveLength(0);
    expect(b.excluded.demoRows).toBeGreaterThan(10);
    expect(JSON.stringify(b.tables.users)).not.toMatch(/passwordHash|passwordSalt/);
    expect(b.sha256).toBe(await sha256Hex(canonical(b.tables)));
    // Canonical form ignores key order.
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});
