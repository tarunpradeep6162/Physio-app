import { useMemo, useSyncExternalStore } from 'react';
import type { AuditEvent, ClinicSettings, DB, ID, Table } from './models';

/**
 * Local repository (MVP). Persists to localStorage on this device only.
 *
 * PRODUCTION NOTE: this is a development/offline store. Clinical deployment requires the
 * server-side PostgreSQL implementation (db/schema.sql) with encryption at rest, TLS, RBAC and
 * server-enforced audit logging. The API below (insert/update/remove + audit) is the seam where
 * an ApiRepository plugs in.
 */

const KEY = 'physiovision.db.v1';
export const SCHEMA_VERSION = 2;

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* insecure context — fall through */
    }
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const DEFAULT_SETTINGS: ClinicSettings = {
  clinicName: 'Dheepika Lab',
  emergencyNumber: '112',
  thresholds: {
    shoulder_level: 2,
    pelvic_level: 2,
    head_tilt: 3,
    trunk_lateral_lean: 2,
    knee_frontal: 8,
    ear_shoulder_line: 15,
    trunk_sagittal: 8,
    asymmetry: 10,
    knee_flexion_limited: 120,
  },
  validationModeEnabled: false,
  ruleApprovals: {},
  retentionDays: 0,
};

export function emptyDb(): DB {
  return {
    schemaVersion: SCHEMA_VERSION,
    users: [],
    patients: [],
    clinicians: [],
    careRelationships: [],
    consents: [],
    assessments: [],
    painRegions: [],
    pros: [],
    scans: [],
    measurements: [],
    observations: [],
    programs: [],
    programExercises: [],
    sessions: [],
    notes: [],
    alerts: [],
    messages: [],
    audit: [],
    radiationPaths: [],
    intakeAnswers: [],
    safetyResponses: [],
    amendments: [],
    testPlans: [],
    captures: [],
    reasoningDecisions: [],
    impressions: [],
    reports: [],
    settings: DEFAULT_SETTINGS,
  };
}

let db: DB = load();
const listeners = new Set<() => void>();

function load(): DB {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return emptyDb();
    return migrate(JSON.parse(raw) as DB);
  } catch {
    return emptyDb();
  }
}

/**
 * Forward-only migrations. Existing patient data is preserved: new tables start empty and new
 * settings take defaults. Unknown future versions are left untouched rather than wiped.
 */
export function migrate(parsed: DB): DB {
  const base = emptyDb();
  const v = parsed.schemaVersion ?? 1;
  if (v > SCHEMA_VERSION) return parsed;
  const out: DB = { ...base, ...parsed, schemaVersion: SCHEMA_VERSION };
  out.settings = { ...DEFAULT_SETTINGS, ...parsed.settings, thresholds: { ...DEFAULT_SETTINGS.thresholds, ...parsed.settings?.thresholds } };
  if (v < 2) {
    // v1 → v2: knee pathway tables; existing assessments are 'general' initial assessments.
    out.assessments = parsed.assessments.map((a) => ({ region: 'general', type: 'initial', ...a }));
  }
  return out;
}

let persistError: string | null = null;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    persistError = null;
  } catch (e) {
    // Quota exceeded or storage disabled: keep working in memory and surface the problem.
    persistError = e instanceof Error ? e.message : 'storage error';
  }
}

export function storageError(): string | null {
  return persistError;
}

function commit(next: DB) {
  db = next;
  persist();
  listeners.forEach((l) => l());
}

export function getDb(): DB {
  return db;
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React binding. The selector result is memoised on the (immutable) db reference. */
export function useDb<T>(selector: (d: DB) => T, deps: unknown[] = []): T {
  const snapshot = useSyncExternalStore(subscribe, getDb, getDb);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selector(snapshot), [snapshot, ...deps]);
}

type Row<T extends Table> = DB[T][number];

function auditEvent(actorId: ID, action: string, entity: string, entityId: ID, detail?: string): AuditEvent {
  return { id: uuid(), actorId, action, entity, entityId, at: new Date().toISOString(), detail };
}

/** Every write goes through these helpers so that it is always audited. */
export function insert<T extends Table>(table: T, row: Row<T>, actorId: ID, detail?: string): Row<T> {
  const r = row as Row<T> & { id: ID };
  const next = { ...db, [table]: [...(db[table] as Row<T>[]), row] } as DB;
  if (table !== 'audit') next.audit = [...next.audit, auditEvent(actorId, 'create', table, r.id, detail)];
  commit(next);
  return row;
}

export function insertMany<T extends Table>(table: T, rows: Row<T>[], actorId: ID, detail?: string) {
  if (rows.length === 0) return;
  const next = { ...db, [table]: [...(db[table] as Row<T>[]), ...rows] } as DB;
  next.audit = [...next.audit, ...rows.map((r) => auditEvent(actorId, 'create', table, (r as { id: ID }).id, detail))];
  commit(next);
}

export function update<T extends Table>(table: T, id: ID, patch: Partial<Row<T>>, actorId: ID, detail?: string) {
  const rows = db[table] as (Row<T> & { id: ID })[];
  const next = { ...db, [table]: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } as DB;
  next.audit = [...next.audit, auditEvent(actorId, 'update', table, id, detail ?? Object.keys(patch).join(','))];
  commit(next);
}

export function remove<T extends Table>(table: T, id: ID, actorId: ID, detail?: string) {
  const rows = db[table] as (Row<T> & { id: ID })[];
  const next = { ...db, [table]: rows.filter((r) => r.id !== id) } as DB;
  next.audit = [...next.audit, auditEvent(actorId, 'delete', table, id, detail)];
  commit(next);
}

export function recordAudit(actorId: ID, action: string, entity: string, entityId: ID, detail?: string) {
  commit({ ...db, audit: [...db.audit, auditEvent(actorId, action, entity, entityId, detail)] });
}

export function updateSettings(patch: Partial<ClinicSettings>, actorId: ID) {
  const next = { ...db, settings: { ...db.settings, ...patch } };
  next.audit = [...next.audit, auditEvent(actorId, 'update', 'settings', 'clinic', Object.keys(patch).join(','))];
  commit(next);
}

/** Replace the whole database (seeding, account deletion). */
export function replaceDb(next: DB) {
  commit(next);
}

/** Removes every row flagged as demonstration data. */
export function purgeDemo(actorId: ID) {
  const next = { ...db } as DB;
  for (const k of Object.keys(next) as (keyof DB)[]) {
    const v = next[k];
    if (Array.isArray(v)) (next as unknown as Record<string, unknown[]>)[k] = (v as { isDemo?: boolean }[]).filter((r) => !r.isDemo);
  }
  const demoPatientIds = new Set(db.patients.filter((p) => p.isDemo).map((p) => p.id));
  const demoClinicianIds = new Set(db.clinicians.filter((c) => c.isDemo).map((c) => c.id));
  next.careRelationships = next.careRelationships.filter((c) => !demoPatientIds.has(c.patientId) && !demoClinicianIds.has(c.clinicianId));
  next.consents = next.consents.filter((c) => !demoPatientIds.has(c.patientId));
  next.painRegions = next.painRegions.filter((r) => next.assessments.some((a) => a.id === r.assessmentId));
  next.programExercises = next.programExercises.filter((pe) => next.programs.some((p) => p.id === pe.programId));
  next.audit = [...next.audit, auditEvent(actorId, 'purge_demo', 'db', 'all')];
  commit(next);
}
