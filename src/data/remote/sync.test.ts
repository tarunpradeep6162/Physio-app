import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteRow } from './records';

/**
 * The sync engine against an in-memory stand-in for the server's `records` table. The real
 * row-level security is tested in PostgreSQL (db/supabase_test.sql); here the fake refuses one
 * table to check that refused rows are dropped while network failures are retried.
 */

type ServerRow = RemoteRow & { updated_at: string };
const server = { rows: new Map<string, ServerRow>(), clock: 0, calls: [] as string[][], refuse: new Set<string>(), down: false };

vi.mock('./client', () => {
  const upsert = async (rows: RemoteRow[], opts: { ignoreDuplicates?: boolean }) => {
    if (server.down) return { error: { code: 'fetch', message: 'Failed to fetch' } };
    server.calls.push(rows.map((r) => r.tbl));
    if (rows.some((r) => server.refuse.has(r.tbl))) return { error: { code: '42501', message: 'new row violates row-level security policy' } };
    for (const r of rows) {
      const k = `${r.tbl}:${r.id}`;
      if (opts.ignoreDuplicates && server.rows.has(k)) continue;
      server.rows.set(k, { ...r, updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++server.clock)).toISOString() });
    }
    return { error: null };
  };
  const select = () => {
    let after = '';
    const q = {
      gt: (_c: string, v: string) => ((after = v), q),
      order: () => q,
      limit: async (n: number) => ({ data: [...server.rows.values()].filter((r) => r.updated_at > after).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, n), error: null }),
    };
    return q;
  };
  return { supabase: () => ({ from: () => ({ upsert, select }) }), remoteConfigured: () => true };
});

const { startSync, stopSync, syncNow, flush, pendingCount, getSyncStatus } = await import('./sync');
const { emptyDb, getDb, insert, replaceDb, uuid } = await import('../store');

function seed() {
  const db = emptyDb();
  const uid = uuid();
  const pid = uuid();
  db.users.push({ id: uid, email: 'p@example.test', passwordHash: '', passwordSalt: '', role: 'patient', displayName: 'P', createdAt: '' });
  replaceDb(db);
  return { uid, pid };
}

describe('Supabase sync engine', () => {
  beforeEach(() => {
    stopSync();
    server.rows.clear();
    server.calls = [];
    server.refuse.clear();
    server.down = false;
  });

  it("a patient's new records reach the server in a safe order, and another device pulls them", async () => {
    const { uid, pid } = seed();
    await startSync(uid, 'patient');
    insert('patients', { id: pid, userId: uid, name: 'P', preferredLanguage: 'en', createdAt: '' }, uid);
    insert('consents', { id: uuid(), patientId: pid, kind: 'camera_processing', granted: true, at: '', textVersion: 'v' } as never, uid);
    await flush();
    expect(pendingCount()).toBe(0);
    expect(server.calls[0]).toEqual(['patients']);
    expect(server.rows.has(`patients:${pid}`)).toBe(true);
    expect([...server.rows.values()].every((r) => r.tbl !== 'consents' || r.patient_id === pid)).toBe(true);
    stopSync();

    // "Physiotherapist's device": an empty local copy pulls everything the server holds.
    replaceDb(emptyDb());
    await startSync(uuid(), 'clinician');
    expect(getDb().patients.map((p) => p.id)).toEqual([pid]);
    expect(getDb().consents).toHaveLength(1);
    expect(getSyncStatus().state).toBe('synced');
  });

  it('keeps changes while the server is unreachable and sends them later', async () => {
    const { uid, pid } = seed();
    await startSync(uid, 'patient');
    server.down = true;
    insert('patients', { id: pid, userId: uid, name: 'P', preferredLanguage: 'en', createdAt: '' }, uid);
    await syncNow();
    expect(pendingCount()).toBeGreaterThan(0);
    expect(getSyncStatus().state).toBe('error');
    server.down = false;
    await syncNow();
    expect(pendingCount()).toBe(0);
    expect(server.rows.has(`patients:${pid}`)).toBe(true);
  });

  it('drops rows the server refuses (they can never succeed) instead of retrying forever', async () => {
    const { uid, pid } = seed();
    await startSync(uid, 'patient');
    insert('patients', { id: pid, userId: uid, name: 'P', preferredLanguage: 'en', createdAt: '' }, uid);
    server.refuse.add('patients');
    await flush();
    expect(pendingCount()).toBe(0);
    expect(server.rows.has(`patients:${pid}`)).toBe(false);
  });
});
