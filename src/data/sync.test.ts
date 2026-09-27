import { describe, expect, it } from 'vitest';
import type { AuditEvent, DB } from './models';
import { emptyDb } from './store';
import { mergeReplicas } from './sync';

const ev = (id: string, action: string, entity: string, entityId: string, at: string): AuditEvent => ({ id, actorId: 'u', action, entity, entityId, at });
const note = (id: string, body: string) => ({ id, patientId: 'p', authorId: 'c', body, createdAt: '2026-01-01T00:00:00Z' });

function base(): DB {
  const db = emptyDb();
  db.notes = [note('n1', 'original')];
  db.audit = [ev('e1', 'create', 'notes', 'n1', '2026-01-01T00:00:00Z')];
  return db;
}

describe('Phase 10 — replica merge preserves the record and explains conflicts', () => {
  it('keeps rows written on either side (two tabs writing different records lose nothing)', () => {
    const a = base();
    const b = base();
    a.notes.push(note('n2', 'from tab A'));
    a.audit.push(ev('e2', 'create', 'notes', 'n2', '2026-01-02T00:00:00Z'));
    b.pros.push({ id: 'x1', patientId: 'p', type: 'daily_checkin', value: { pain: 3 }, recordedAt: '2026-01-02T00:00:01Z' });
    b.audit.push(ev('e3', 'create', 'pros', 'x1', '2026-01-02T00:00:01Z'));
    const m = mergeReplicas(a, b);
    expect(m.db.notes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(m.db.pros.map((p) => p.id)).toEqual(['x1']);
    expect(m.db.audit.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(m.conflicts).toEqual([]);
    expect(m.addedFromRemote).toBe(1);
  });

  it('a one-sided edit is taken without conflict; an edit on both sides keeps the later one and reports the other', () => {
    const a = base();
    const b = base();
    b.notes[0] = note('n1', 'edited on B');
    b.audit.push(ev('e4', 'update', 'notes', 'n1', '2026-01-03T00:00:00Z'));
    const one = mergeReplicas(a, b);
    expect(one.db.notes[0].body).toBe('edited on B');
    expect(one.conflicts).toEqual([]);

    a.notes[0] = note('n1', 'edited on A later');
    a.audit.push(ev('e5', 'update', 'notes', 'n1', '2026-01-04T00:00:00Z'));
    const both = mergeReplicas(a, b);
    expect(both.db.notes[0].body).toBe('edited on A later');
    expect(both.conflicts).toHaveLength(1);
    expect(both.conflicts[0]).toMatchObject({ table: 'notes', rowId: 'n1', kept: 'local', discardedAt: '2026-01-03T00:00:00Z' });
    expect((both.conflicts[0].discarded as { body: string }).body).toBe('edited on B');
    // Merging in the other direction reaches the same content.
    expect(mergeReplicas(b, a).db.notes[0].body).toBe('edited on A later');
  });

  it('a delete on one side is honoured and not resurrected by the other side', () => {
    const a = base();
    const b = base();
    a.notes = [];
    a.audit.push(ev('e6', 'delete', 'notes', 'n1', '2026-01-02T00:00:00Z'));
    expect(mergeReplicas(a, b).db.notes).toEqual([]);
    expect(mergeReplicas(b, a).db.notes).toEqual([]);
  });

  it('merging is idempotent', () => {
    const a = base();
    const b = base();
    b.notes.push(note('n3', 'b'));
    b.audit.push(ev('e7', 'create', 'notes', 'n3', '2026-01-02T00:00:00Z'));
    const once = mergeReplicas(a, b).db;
    const twice = mergeReplicas(once, b).db;
    expect(twice.notes).toEqual(once.notes);
    expect(twice.audit).toEqual(once.audit);
  });
});
