import type { DB, ID } from './models';

/**
 * Data access and erasure (Phase 19). Rows are found by LINKAGE, not by a hand-kept table list:
 * any row whose patientId, assessmentId, programId, sessionId, captureId, scanId or importId points
 * at the patient's records belongs to the patient. A table added in a later phase is therefore
 * covered automatically (the test checks every table in the schema).
 */

type Row = Record<string, unknown> & { id?: unknown };
const LINKS = ['patientId', 'assessmentId', 'programId', 'sessionId', 'captureId', 'scanId', 'importId', 'pauseId', 'measurementId'] as const;
/** Organisation-level tables that are never patient data. */
const ORG_TABLES = new Set(['clinicians', 'contentItems', 'contentReviews', 'expenses']);

export function patientLinkedIds(db: DB, patientId: ID): Set<string> {
  const ids = new Set<string>([patientId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [k, v] of Object.entries(db)) {
      if (!Array.isArray(v) || ORG_TABLES.has(k) || k === 'audit' || k === 'users') continue;
      for (const r of v as Row[]) {
        if (typeof r.id !== 'string' || ids.has(r.id)) continue;
        if (LINKS.some((l) => typeof r[l] === 'string' && ids.has(r[l] as string))) {
          ids.add(r.id);
          changed = true;
        }
      }
    }
  }
  return ids;
}

const linked = (r: Row, ids: Set<string>) => (typeof r.id === 'string' && ids.has(r.id)) || LINKS.some((l) => typeof r[l] === 'string' && ids.has(r[l] as string));

/** Everything the app holds about one patient (the "data access" export). */
export function exportPatientData(db: DB, patientId: ID): Record<string, unknown[]> & { exportedAt: string } {
  const ids = patientLinkedIds(db, patientId);
  const userId = db.patients.find((p) => p.id === patientId)?.userId;
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(db)) {
    if (!Array.isArray(v) || ORG_TABLES.has(k)) continue;
    if (k === 'users') out.users = (v as Row[]).filter((u) => u.id === userId).map(({ passwordHash: _h, passwordSalt: _s, ...u }) => u);
    else if (k === 'audit') out.audit = (v as Row[]).filter((e) => e.actorId === userId || ids.has(e.entityId as string));
    else {
      const rows = (v as Row[]).filter((r) => linked(r, ids));
      if (rows.length) out[k] = rows;
    }
  }
  return { ...out, exportedAt: new Date().toISOString() } as never;
}

/**
 * Erases a patient's records. The audit trail keeps only a pseudonymous deletion record; events
 * about the erased rows or by the erased user are removed.
 */
export function erasePatient(db: DB, patientId: ID, now: string): DB {
  const ids = patientLinkedIds(db, patientId);
  const userId = db.patients.find((p) => p.id === patientId)?.userId ?? null;
  const next = { ...db } as DB;
  for (const [k, v] of Object.entries(db)) {
    if (!Array.isArray(v) || ORG_TABLES.has(k)) continue;
    if (k === 'users') (next as unknown as Record<string, Row[]>).users = (v as Row[]).filter((u) => u.id !== userId);
    else if (k === 'audit') (next as unknown as Record<string, Row[]>).audit = (v as Row[]).filter((e) => e.actorId !== userId && !ids.has(e.entityId as string));
    else (next as unknown as Record<string, Row[]>)[k] = (v as Row[]).filter((r) => !linked(r, ids));
  }
  next.audit = [...next.audit, { id: `erasure-${now}`, actorId: 'system', action: 'account_deleted', entity: 'patients', entityId: 'erased', at: now }];
  return next;
}
