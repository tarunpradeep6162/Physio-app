import { useMemo, useSyncExternalStore } from 'react';
import type { AuditEvent, ClinicSettings, DB, ID, Program, Table } from './models';
import { applyScope, scopeFor } from './scope';
import { mergeReplicas, type SyncConflict } from './sync';

/**
 * Local repository (MVP). Persists to localStorage on this device only.
 *
 * PRODUCTION NOTE: this is a development/offline store. Clinical deployment requires the
 * server-side PostgreSQL implementation (db/schema.sql) with encryption at rest, TLS, RBAC and
 * server-enforced audit logging. The API below (insert/update/remove + audit) is the seam where
 * an ApiRepository plugs in.
 */

const KEY = 'physiovision.db.v1';
export const SCHEMA_VERSION = 8;

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
    draftDecisions: [],
    examFindings: [],
    planPauses: [],
    planResumes: [],
    appointments: [],
    activitySamples: [],
    activityImports: [],
    contentItems: [],
    contentReviews: [],
    programLibraryItems: [],
    deviceMeasurements: [],
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
  // Earlier demo fixtures used the clinical lead's real name for a simulated sign-off. Existing
  // browser copies must be corrected too; scope this to explicitly marked demo identities only.
  out.users = out.users.map((u) => u.isDemo && u.displayName === 'Dheepika' ? { ...u, displayName: 'Demo clinician' } : u);
  out.clinicians = out.clinicians.map((c) => c.isDemo && c.name === 'Dheepika' ? { ...c, name: 'Demo clinician', title: 'Physiotherapist (simulation)' } : c);
  if (v < 2) {
    // v1 → v2: knee pathway tables; existing assessments are 'general' initial assessments.
    out.assessments = parsed.assessments.map((a) => ({ region: 'general', type: 'initial', ...a }));
  }
  // v2 → v3: draftDecisions and examFindings start empty (added by the base spread above).
  if (v < 4) {
    // v3 → v4: plan versions. Existing programs are numbered per patient in creation order and
    // linked to the version they replaced; their content is unchanged. planPauses / planResumes start empty.
    const byPatient = new Map<ID, Program[]>();
    for (const p of [...out.programs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) byPatient.set(p.patientId, [...(byPatient.get(p.patientId) ?? []), p]);
    const numbered = new Map<ID, Program>();
    for (const list of byPatient.values()) list.forEach((p, i) => numbered.set(p.id, { ...p, version: p.version ?? i + 1, supersedes: p.supersedes ?? (i > 0 ? list[i - 1].id : undefined) }));
    out.programs = out.programs.map((p) => numbered.get(p.id) ?? p);
  }
  // v4 → v5: appointments start empty; programs without scheduleDays stay flexible.
  // v5 → v6: activitySamples / activityImports start empty (Phase 11).
  // v6 → v7: contentItems, contentReviews and programLibraryItems start empty (Phase 16).
  // v7 → v8: deviceMeasurements starts empty (Phase 18).
  return out;
}

// ---- Persistence and multi-tab safety (Phase 10) ----------------------------------------------
// Each save writes a revision token next to the data. If another tab saved since this tab last
// loaded or saved, the two copies are MERGED (sync.ts) before writing, so neither tab's records are
// overwritten. A deliberate reset (account deletion, demo purge, seeding) writes a 'reset:' token
// that other tabs adopt wholesale instead of merging deleted rows back in.
const REV_KEY = `${KEY}.rev`;
let knownRev: string | null = readRev();
let conflicts: SyncConflict[] = [];

function readRev(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(REV_KEY) : null;
  } catch {
    return null;
  }
}

function recordConflicts(found: SyncConflict[]) {
  if (!found.length) return;
  conflicts = [...conflicts, ...found];
  db = { ...db, audit: [...db.audit, ...found.map((c) => auditEvent('system', 'sync_conflict', c.table, c.rowId, `kept ${c.kept} version (${c.keptAt}); other version from ${c.discardedAt} not applied`))] };
}

/** Conflicts found while merging changes from another tab/device in this session. */
export function syncConflicts(): readonly SyncConflict[] {
  return conflicts;
}

let persistError: string | null = null;
function persist(reset = false) {
  try {
    const stored = readRev();
    if (!reset && stored && stored !== knownRev && !stored.startsWith('reset:')) {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const merged = mergeReplicas(db, migrate(JSON.parse(raw) as DB));
        db = merged.db;
        recordConflicts(merged.conflicts);
      }
    }
    const rev = `${reset ? 'reset:' : ''}${uuid()}`;
    localStorage.setItem(KEY, JSON.stringify(db));
    localStorage.setItem(REV_KEY, rev);
    knownRev = rev;
    persistError = null;
  } catch (e) {
    // Quota exceeded or storage disabled: keep working in memory and surface the problem.
    persistError = e instanceof Error ? e.message : 'storage error';
  }
}

/** Another tab saved: merge its copy into this one (or adopt it after a deliberate reset). */
function onStorage(e: StorageEvent) {
  if (e.key !== REV_KEY || !e.newValue || e.newValue === knownRev) return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const remote = migrate(JSON.parse(raw) as DB);
    if (e.newValue.startsWith('reset:')) db = remote;
    else {
      const merged = mergeReplicas(db, remote);
      db = merged.db;
      recordConflicts(merged.conflicts);
    }
    knownRev = e.newValue;
    listeners.forEach((l) => l());
  } catch {
    /* unreadable copy: keep this tab's data; the next save merges again */
  }
}
if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

export function storageError(): string | null {
  return persistError;
}

function commit(next: DB, reset = false) {
  db = next;
  persist(reset);
  listeners.forEach((l) => l());
}

export function getDb(): DB {
  return db;
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ---- Read scope (Phase 6) ------------------------------------------------------------------
// Screens read through a scope derived from the signed-in account (see scope.ts), so a demo
// session never shows a real sign-up's records on the same device and a patient sees only their
// own. Writes, persistence and exports use the unscoped database.
let sessionUser: () => string | null = () => null;
let scoped: { db: DB; key: string; out: DB } | null = null;

/** Registered by the auth module (avoids a circular import). */
export function bindSession(getter: () => string | null) {
  sessionUser = getter;
}

/** Called when the signed-in account changes. */
export function sessionChanged() {
  scoped = null;
  listeners.forEach((l) => l());
}

export function getScopedDb(): DB {
  const uid = sessionUser();
  const user = uid ? (db.users.find((u) => u.id === uid) ?? null) : null;
  const key = `${uid ?? '-'}|${user?.role ?? '-'}|${user?.isDemo ? 'demo' : 'real'}`;
  if (scoped && scoped.db === db && scoped.key === key) return scoped.out;
  const out = applyScope(db, scopeFor(user, db), user);
  scoped = { db, key, out };
  return out;
}

/** React binding. The selector result is memoised on the (immutable) scoped db reference. */
export function useDb<T>(selector: (d: DB) => T, deps: unknown[] = []): T {
  const snapshot = useSyncExternalStore(subscribe, getScopedDb, getScopedDb);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selector(snapshot), [snapshot, ...deps]);
}

type Row<T extends Table> = DB[T][number];

function auditEvent(actorId: ID, action: string, entity: string, entityId: ID, detail?: string): AuditEvent {
  return { id: uuid(), actorId, action, entity, entityId, at: new Date().toISOString(), detail };
}

// ---- Authorization boundary for clinical decisions (Phase 8) ---------------------------------
// Clinical conclusions, plans and approvals are written only by a clinician account. A patient
// session (or anything acting for one, such as an AI draft) cannot put them into an approved state.
// The server enforces the same rule with row-level security (clinician-write policies).
type Guard = (row: Record<string, unknown>) => boolean;
const CLINICIAN_ONLY: Partial<Record<Table, Guard>> = {
  impressions: () => true,
  draftDecisions: () => true,
  examFindings: () => true,
  reasoningDecisions: () => true,
  amendments: () => true,
  programs: () => true,
  programExercises: () => true,
  planResumes: () => true,
  appointments: () => true,
  contentItems: () => true,
  contentReviews: () => true,
  programLibraryItems: () => true,
  deviceMeasurements: () => true,
  notes: () => true,
  reports: (r) => r.status === 'clinician_reviewed',
  testPlans: (r) => r.source === 'clinician',
  measurements: (r) => r.reviewStatus !== undefined && r.reviewStatus !== 'pending' && r.category === 'camera_estimate',
};

export class AuthorizationError extends Error {}

/** History tables: rows are never edited or deleted through the app (Phase 9 append-only history). */
const APPEND_ONLY: ReadonlySet<Table> = new Set<Table>(['contentReviews', 'planPauses', 'planResumes', 'draftDecisions', 'examFindings', 'impressions', 'reasoningDecisions', 'amendments']);
function assertAppendOnly(table: Table, op: string) {
  if (APPEND_ONLY.has(table)) throw new AuthorizationError(`${table} is append-only history; ${op} is not allowed.`);
}

function assertMayWrite(table: Table, row: Record<string, unknown>, actorId: ID, isUpdate = false) {
  const guard = CLINICIAN_ONLY[table];
  if (!guard) return;
  // A clinician-review update of a measurement is the only guarded measurement write.
  if (table === 'measurements' && !isUpdate) return;
  if (!guard(row)) return;
  const actor = db.users.find((u) => u.id === actorId);
  if (!actor || actor.role === 'patient') throw new AuthorizationError(`Only a clinician can record ${table} (actor ${actorId}).`);
}

/** Every write goes through these helpers so that it is always audited. */
export function insert<T extends Table>(table: T, row: Row<T>, actorId: ID, detail?: string): Row<T> {
  assertMayWrite(table, row as unknown as Record<string, unknown>, actorId);
  const r = row as Row<T> & { id: ID };
  const next = { ...db, [table]: [...(db[table] as Row<T>[]), row] } as DB;
  const ev = table !== 'audit' ? auditEvent(actorId, 'create', table, r.id, detail) : null;
  if (ev) next.audit = [...next.audit, ev];
  commit(next);
  emit([{ kind: 'upsert', table, rows: [row as unknown as Rec] }, ...(ev ? [{ kind: 'upsert' as const, table: 'audit' as const, rows: [ev as unknown as Rec] }] : [])]);
  return row;
}

export function insertMany<T extends Table>(table: T, rows: Row<T>[], actorId: ID, detail?: string) {
  if (rows.length === 0) return;
  for (const r of rows) assertMayWrite(table, r as unknown as Record<string, unknown>, actorId);
  const next = { ...db, [table]: [...(db[table] as Row<T>[]), ...rows] } as DB;
  const evs = rows.map((r) => auditEvent(actorId, 'create', table, (r as { id: ID }).id, detail));
  next.audit = [...next.audit, ...evs];
  commit(next);
  emit([{ kind: 'upsert', table, rows: rows as unknown as Rec[] }, { kind: 'upsert', table: 'audit', rows: evs as unknown as Rec[] }]);
}

export function update<T extends Table>(table: T, id: ID, patch: Partial<Row<T>>, actorId: ID, detail?: string) {
  assertAppendOnly(table, 'update');
  const rows = db[table] as (Row<T> & { id: ID })[];
  const cur = rows.find((r) => r.id === id);
  if (cur) assertMayWrite(table, { ...cur, ...patch } as unknown as Record<string, unknown>, actorId, true);
  const next = { ...db, [table]: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) } as DB;
  const ev = auditEvent(actorId, 'update', table, id, detail ?? Object.keys(patch).join(','));
  next.audit = [...next.audit, ev];
  commit(next);
  const updated = (next[table] as unknown as Rec[]).find((r) => r.id === id);
  emit([...(updated ? [{ kind: 'upsert' as const, table, rows: [updated] }] : []), { kind: 'upsert', table: 'audit', rows: [ev as unknown as Rec] }]);
}

export function remove<T extends Table>(table: T, id: ID, actorId: ID, detail?: string) {
  assertAppendOnly(table, 'delete');
  const rows = db[table] as (Row<T> & { id: ID })[];
  const cur = rows.find((r) => r.id === id);
  if (cur && CLINICIAN_ONLY[table]) assertMayWrite(table, cur as unknown as Record<string, unknown>, actorId, true);
  const next = { ...db, [table]: rows.filter((r) => r.id !== id) } as DB;
  const ev = auditEvent(actorId, 'delete', table, id, detail);
  next.audit = [...next.audit, ev];
  commit(next);
  emit([{ kind: 'delete', table, rows: cur ? [cur as unknown as Rec] : [{ id }] }, { kind: 'upsert', table: 'audit', rows: [ev as unknown as Rec] }]);
}

export function recordAudit(actorId: ID, action: string, entity: string, entityId: ID, detail?: string) {
  const ev = auditEvent(actorId, action, entity, entityId, detail);
  commit({ ...db, audit: [...db.audit, ev] });
  emit([{ kind: 'upsert', table: 'audit', rows: [ev as unknown as Rec] }]);
}

export function updateSettings(patch: Partial<ClinicSettings>, actorId: ID) {
  // Clinic settings (thresholds, rule reviews, approvals) are a clinician responsibility.
  const actor = db.users.find((u) => u.id === actorId);
  if (!actor || actor.role === 'patient') throw new AuthorizationError(`Only a clinician can change clinic settings (actor ${actorId}).`);
  const next = { ...db, settings: { ...db.settings, ...patch } };
  const ev = auditEvent(actorId, 'update', 'settings', 'clinic', Object.keys(patch).join(','));
  next.audit = [...next.audit, ev];
  commit(next);
  emit([{ kind: 'upsert', table: 'settings', rows: [{ id: 'clinic', ...next.settings } as unknown as Rec] }, { kind: 'upsert', table: 'audit', rows: [ev as unknown as Rec] }]);
}

// ---- Write events (server sync) -----------------------------------------------------------------
// Every local write is announced so the sync layer (data/remote) can queue it for the server.
// Changes that ARRIVE from the server are applied with applyRemote(), which does not announce them.
export type Rec = Record<string, unknown> & { id?: unknown };
export type WriteEvent = { kind: 'upsert' | 'delete'; table: Table | 'settings'; rows: Rec[] };
const writeListeners = new Set<(events: WriteEvent[]) => void>();
export function onWrite(fn: (events: WriteEvent[]) => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}
function emit(events: WriteEvent[]) {
  writeListeners.forEach((l) => l(events));
}

/** Applies rows received from the server (upserts and deletions) without re-announcing them. */
export function applyRemote(changes: { table: string; id: string; data: Rec | null }[]) {
  if (!changes.length) return;
  const next = { ...db } as DB;
  const tables = next as unknown as Record<string, unknown>;
  for (const c of changes) {
    if (c.table === 'settings') {
      if (c.data) {
        const { id: _i, ...rest } = c.data;
        next.settings = { ...next.settings, ...(rest as Partial<ClinicSettings>) };
      }
      continue;
    }
    const cur = tables[c.table];
    if (!Array.isArray(cur)) continue; // unknown table (newer app version on another device): ignore
    const rows = cur as Rec[];
    const without = rows.filter((r) => r.id !== c.id);
    tables[c.table] = c.data ? [...without, c.data] : without;
  }
  commit(next);
}

/** Replace the whole database (seeding, account deletion). */
export function replaceDb(next: DB) {
  commit(next, true);
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
  commit(next, true);
}
