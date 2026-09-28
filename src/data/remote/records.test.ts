import { describe, expect, it } from 'vitest';
import { buildDemoDb } from '../demo';
import type { DB } from '../models';
import { applyRemote, emptyDb, getDb, insert, onWrite, replaceDb, uuid, type WriteEvent } from '../store';
import { flushBatches, Outbox, patientIdOf, toRemoteRows, type RemoteRow } from './records';

/** A small non-demo database: one patient (with a sign-in) and one physiotherapist. */
function realDb(): { db: DB; patientUser: string; clinUser: string; patientId: string; assessmentId: string } {
  const db = emptyDb();
  const patientUser = uuid();
  const clinUser = uuid();
  const patientId = uuid();
  const assessmentId = uuid();
  const now = new Date().toISOString();
  db.users.push({ id: patientUser, email: 'p@example.test', passwordHash: 'h', passwordSalt: 's', role: 'patient', displayName: 'P', createdAt: now });
  db.users.push({ id: clinUser, email: 'c@example.test', passwordHash: '', passwordSalt: '', role: 'clinician', displayName: 'C', createdAt: now });
  db.patients.push({ id: patientId, userId: patientUser, name: 'P', preferredLanguage: 'en', createdAt: now });
  db.assessments.push({ ...(buildDemoDb().assessments[0] as DB['assessments'][number]), id: assessmentId, patientId, isDemo: undefined });
  return { db, patientUser, clinUser, patientId, assessmentId };
}

const row = (tbl: string, id: string, extra: Partial<RemoteRow> = {}): RemoteRow => ({ tbl, id, patient_id: 'p', data: { id }, deleted: false, ...extra });

describe('Supabase sync — mapping local records to server rows', () => {
  it('finds the patient of a row by following its links', () => {
    const { db, patientUser, patientId, assessmentId } = realDb();
    expect(patientIdOf(db, 'patients', { id: patientId })).toBe(patientId);
    expect(patientIdOf(db, 'users', { id: patientUser })).toBe(patientId);
    expect(patientIdOf(db, 'painRegions', { id: 'x', assessmentId })).toBe(patientId);
    expect(patientIdOf(db, 'clinicians', { id: 'c', patientId: 'nope' })).toBeNull();
    expect(patientIdOf(db, 'audit', { id: 'a', actorId: patientUser, entity: 'assessments', entityId: assessmentId })).toBe(patientId);
    expect(patientIdOf(db, 'audit', { id: 'a', actorId: patientUser, entity: 'somewhere', entityId: 'z' })).toBe(patientId);
  });

  it('never sends demonstration data or password material', () => {
    const demo = buildDemoDb();
    const demoPatient = demo.patients[0];
    const demoRows = toRemoteRows(demo, [{ kind: 'upsert', table: 'patients', rows: [demoPatient as never] }, { kind: 'upsert', table: 'assessments', rows: demo.assessments.slice(0, 2) as never }], 'clinician');
    expect(demoRows).toEqual([]);

    const { db, patientUser } = realDb();
    const [u] = toRemoteRows(db, [{ kind: 'upsert', table: 'users', rows: [db.users[0] as never] }], 'patient');
    expect(u.id).toBe(patientUser);
    expect(u.data).not.toHaveProperty('passwordHash');
    expect(u.data).not.toHaveProperty('passwordSalt');
    expect(JSON.stringify(u)).not.toContain('"h"');
  });

  it("a patient's rows that cannot be tied to their record stay local; a physiotherapist's organisation rows are sent", () => {
    const { db, clinUser } = realDb();
    const ev: WriteEvent[] = [{ kind: 'upsert', table: 'settings', rows: [{ id: 'clinic', clinicName: 'X' }] }];
    expect(toRemoteRows(db, ev, 'patient')).toEqual([]);
    const [s] = toRemoteRows(db, ev, 'clinician');
    expect(s).toMatchObject({ tbl: 'settings', id: 'clinic', patient_id: null, deleted: false });
    const [d] = toRemoteRows(db, [{ kind: 'delete', table: 'clinicians', rows: [{ id: clinUser }] }], 'clinician');
    expect(d.deleted).toBe(true);
  });

  it('sends identity rows first, one per request, then other rows, then append-only history separately', () => {
    const rows = [row('audit', 'a1'), row('assessments', 'x1'), row('patients', 'p1'), row('users', 'u1'), row('impressions', 'i1'), row('painRegions', 'r1')];
    const batches = flushBatches(rows);
    expect(batches.map((b) => b.rows.map((r) => r.tbl))).toEqual([['users'], ['patients'], ['assessments', 'painRegions'], ['audit', 'impressions']]);
    expect(batches.map((b) => b.appendOnly)).toEqual([false, false, false, true]);
    const many = Array.from({ length: 450 }, (_, i) => row('sessions', `s${i}`));
    expect(flushBatches(many).map((b) => b.rows.length)).toEqual([200, 200, 50]);
  });

  it('the outbox keeps the latest change per row, never replaces queued history, and acknowledges only what was sent', () => {
    const ob = new Outbox(null);
    const first = row('assessments', 'x');
    ob.add([first, row('audit', 'a')]);
    const second = row('assessments', 'x', { data: { id: 'x', v: 2 } });
    ob.add([second, row('audit', 'a', { deleted: true })]);
    expect(ob.size).toBe(2);
    expect(ob.all().find((r) => r.tbl === 'audit')?.deleted).toBe(false);
    // An acknowledgement for the older copy must not drop the newer change queued meanwhile.
    ob.ack([first]);
    expect(ob.has('assessments', 'x')).toBe(true);
    ob.ack([second]);
    expect(ob.has('assessments', 'x')).toBe(false);
  });
});

describe('Supabase sync — store hooks', () => {
  it('local writes are announced; changes from the server are applied silently', () => {
    const { db, patientUser, patientId } = realDb();
    replaceDb(db);
    const seen: WriteEvent[][] = [];
    const off = onWrite((e) => seen.push(e));
    const id = uuid();
    insert('careRelationships', { id, patientId, clinicianId: 'c', status: 'active', createdAt: '' }, patientUser);
    expect(seen).toHaveLength(1);
    expect(seen[0].map((e) => e.table)).toEqual(['careRelationships', 'audit']);

    applyRemote([
      { table: 'careRelationships', id, data: null },
      { table: 'settings', id: 'clinic', data: { id: 'clinic', clinicName: 'From server' } },
      { table: 'tableFromANewerVersion', id: 'z', data: { id: 'z' } },
    ]);
    off();
    expect(seen).toHaveLength(1);
    expect(getDb().careRelationships.some((c) => c.id === id)).toBe(false);
    expect(getDb().settings.clinicName).toBe('From server');
    expect((getDb() as unknown as Record<string, unknown>).tableFromANewerVersion).toBeUndefined();
  });
});
