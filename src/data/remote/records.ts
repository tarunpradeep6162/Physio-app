import type { DB } from '../models';
import type { Rec, WriteEvent } from '../store';

/**
 * Pure mapping between the app's local tables and the server's `records` table
 * (supabase/migrations/*_dheepika_lab_sync.sql). Kept free of network code so it is unit-tested.
 */

export interface RemoteRow {
  tbl: string;
  id: string;
  patient_id: string | null;
  data: Rec;
  deleted: boolean;
}

/** Mirrors dl_append_only() on the server: these rows are inserted once and never updated. */
export const APPEND_ONLY_TABLES = new Set(['audit', 'planPauses', 'planResumes', 'draftDecisions', 'examFindings', 'impressions', 'reasoningDecisions', 'amendments', 'contentReviews']);
/** The patient's own identity rows go first: the server checks other rows against them. */
export const IDENTITY_TABLES = new Set(['users', 'patients']);
/** Organisation-level tables with no patient. */
const ORG_TABLES = new Set(['clinicians', 'settings', 'contentItems', 'contentReviews', 'expenses']);

const PARENTS: [string, keyof DB][] = [
  ['assessmentId', 'assessments'],
  ['programId', 'programs'],
  ['sessionId', 'sessions'],
  ['captureId', 'captures'],
  ['scanId', 'scans'],
  ['importId', 'activityImports'],
  ['pauseId', 'planPauses'],
  ['measurementId', 'measurements'],
];

/** The patient record a row belongs to (null = organisation-level), following its links. */
export function patientIdOf(db: DB, table: string, row: Rec, depth = 0): string | null {
  if (table === 'patients') return String(row.id);
  if (ORG_TABLES.has(table)) return null;
  if (table === 'users') return db.patients.find((p) => p.userId === row.id)?.id ?? null;
  if (typeof row.patientId === 'string') return row.patientId;
  if (depth > 3) return null;
  for (const [key, parent] of PARENTS) {
    const ref = row[key];
    if (typeof ref !== 'string') continue;
    const p = (db[parent] as unknown as Rec[]).find((r) => r.id === ref);
    if (p) return patientIdOf(db, String(parent), p, depth + 1);
  }
  if (table === 'audit') {
    // An audit event belongs to the patient whose row it describes, else to the acting patient.
    const entity = (db as unknown as Record<string, Rec[] | undefined>)[String(row.entity)];
    const target = Array.isArray(entity) ? entity.find((r) => r.id === row.entityId) : undefined;
    if (target) return patientIdOf(db, String(row.entity), target, depth + 1);
    return db.patients.find((p) => p.userId === row.actorId)?.id ?? null;
  }
  return null;
}

const isDemoRow = (db: DB, table: string, row: Rec): boolean => {
  if (row.isDemo === true) return true;
  if (table === 'audit') return db.users.some((u) => u.id === row.actorId && u.isDemo);
  if (table === 'users') return false;
  const pid = patientIdOf(db, table, row);
  return !!pid && !!db.patients.find((p) => p.id === pid)?.isDemo;
};

/**
 * Converts local write events to server rows. Demonstration data never leaves the device; password
 * material from the old local sign-in is never sent; a patient's audit events that cannot be tied
 * to their own record are kept local (the server would refuse them).
 */
export function toRemoteRows(db: DB, events: WriteEvent[], role: 'patient' | 'clinician'): RemoteRow[] {
  const out: RemoteRow[] = [];
  for (const e of events) {
    for (const row of e.rows) {
      if (row.id === undefined || row.id === null) continue;
      if (isDemoRow(db, e.table, row)) continue;
      const pid = patientIdOf(db, e.table, row);
      if (role === 'patient' && pid === null && !IDENTITY_TABLES.has(e.table)) continue;
      let data: Rec = row;
      if (e.table === 'users') {
        const { passwordHash: _h, passwordSalt: _s, ...rest } = row;
        data = rest;
      }
      out.push({ tbl: e.table, id: String(row.id), patient_id: pid, data, deleted: e.kind === 'delete' });
    }
  }
  return out;
}

/** Order for sending: identity rows first, then everything else; append-only rows separated (insert-once). */
export function flushBatches(rows: RemoteRow[]): { rows: RemoteRow[]; appendOnly: boolean }[] {
  const identity = rows.filter((r) => IDENTITY_TABLES.has(r.tbl));
  const rest = rows.filter((r) => !IDENTITY_TABLES.has(r.tbl));
  const batches: { rows: RemoteRow[]; appendOnly: boolean }[] = [];
  // Identity rows one statement each (users, then patients), so later rows can be checked against them.
  for (const t of ['users', 'patients']) for (const r of identity.filter((x) => x.tbl === t)) batches.push({ rows: [r], appendOnly: false });
  const chunk = (list: RemoteRow[], appendOnly: boolean) => {
    let cur: RemoteRow[] = [];
    let size = 0;
    for (const r of list) {
      const n = JSON.stringify(r.data).length;
      if (cur.length && (size + n > 900_000 || cur.length >= 200)) {
        batches.push({ rows: cur, appendOnly });
        cur = [];
        size = 0;
      }
      cur.push(r);
      size += n;
    }
    if (cur.length) batches.push({ rows: cur, appendOnly });
  };
  chunk(rest.filter((r) => !APPEND_ONLY_TABLES.has(r.tbl)), false);
  chunk(rest.filter((r) => APPEND_ONLY_TABLES.has(r.tbl)), true);
  return batches;
}

/** Pending local changes, persisted so nothing is lost offline. Later changes to a row replace earlier ones. */
export class Outbox {
  private items = new Map<string, RemoteRow>();
  constructor(private readonly key: string | null) {
    if (!key) return;
    try {
      for (const r of JSON.parse(localStorage.getItem(key) ?? '[]') as RemoteRow[]) this.items.set(`${r.tbl}:${r.id}`, r);
    } catch {
      /* unreadable: start empty */
    }
  }
  private save() {
    if (!this.key) return;
    try {
      localStorage.setItem(this.key, JSON.stringify([...this.items.values()]));
    } catch {
      /* storage full: items stay in memory and are retried */
    }
  }
  add(rows: RemoteRow[]) {
    for (const r of rows) {
      const k = `${r.tbl}:${r.id}`;
      // Append-only rows are sent once; a later "delete" of one is impossible by design.
      if (APPEND_ONLY_TABLES.has(r.tbl) && this.items.has(k)) continue;
      this.items.set(k, r);
    }
    this.save();
  }
  has(tbl: string, id: string) {
    return this.items.has(`${tbl}:${id}`);
  }
  get size() {
    return this.items.size;
  }
  all(): RemoteRow[] {
    return [...this.items.values()];
  }
  ack(rows: RemoteRow[]) {
    for (const r of rows) {
      const k = `${r.tbl}:${r.id}`;
      if (this.items.get(k) === r) this.items.delete(k);
    }
    this.save();
  }
}
