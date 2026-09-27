import type { DB, ID, User } from './models';

/**
 * Read scope for the browser-local store (Phase 6). Until the server boundary exists, every
 * account on a device shares one localStorage database, so views must be scoped in code:
 *
 * - a DEMO session (e.g. "Explore demo — physiotherapist") sees demonstration patients only;
 * - a real clinician account sees non-demo patients only — never demonstration data mixed in;
 * - a patient sees only their own record.
 *
 * Every patient-linked table is filtered by the visible patient set, following its links
 * (patientId, assessmentId, programId, captureId, sessionId, scanId). This is defence in depth for
 * the pilot; server-side row-level security (db/security.sql) is the real boundary.
 */

export interface ReadScope {
  key: string;
  visiblePatients: (db: DB) => Set<ID>;
}

export function scopeFor(user: User | null | undefined, db: DB): ReadScope | null {
  if (!user) return null;
  if (user.role === 'patient') {
    return { key: `patient:${user.id}`, visiblePatients: (d) => new Set(d.patients.filter((p) => p.userId === user.id).map((p) => p.id)) };
  }
  const demo = !!user.isDemo;
  void db;
  return { key: `${demo ? 'demo' : 'real'}:${user.role}:${user.id}`, visiblePatients: (d) => new Set(d.patients.filter((p) => !!p.isDemo === demo).map((p) => p.id)) };
}

type AnyRow = { patientId?: ID; assessmentId?: ID; programId?: ID; captureId?: ID; sessionId?: ID; scanId?: ID; isDemo?: boolean; id?: ID; actorId?: ID; userId?: ID | null };

export function applyScope(db: DB, scope: ReadScope | null, user: User | null | undefined): DB {
  if (!scope) return db;
  const pts = scope.visiblePatients(db);
  const assess = new Set(db.assessments.filter((a) => pts.has(a.patientId)).map((a) => a.id));
  const programs = new Set(db.programs.filter((p) => pts.has(p.patientId)).map((p) => p.id));
  const keep = (r: AnyRow): boolean => {
    if (r.patientId !== undefined) return pts.has(r.patientId);
    if (r.assessmentId !== undefined) return assess.has(r.assessmentId);
    if (r.programId !== undefined) return programs.has(r.programId);
    return true;
  };
  const out = { ...db } as DB;
  for (const k of Object.keys(db) as (keyof DB)[]) {
    const v = db[k];
    if (!Array.isArray(v) || k === 'users' || k === 'clinicians' || k === 'audit' || k === 'patients') continue;
    (out as unknown as Record<string, unknown[]>)[k] = (v as AnyRow[]).filter(keep);
  }
  out.patients = db.patients.filter((p) => pts.has(p.id));
  const patientUsers = new Set(out.patients.map((p) => p.userId).filter(Boolean) as ID[]);
  const demo = !!user?.isDemo;
  out.clinicians = user?.role === 'patient' ? db.clinicians.filter((c) => out.careRelationships.some((cr) => cr.clinicianId === c.id)) : db.clinicians.filter((c) => !!c.isDemo === demo);
  const clinUsers = new Set(out.clinicians.map((c) => c.userId));
  out.users = db.users.filter((u) => u.id === user?.id || patientUsers.has(u.id) || clinUsers.has(u.id));
  const visibleUsers = new Set(out.users.map((u) => u.id));
  out.audit = db.audit.filter((e) => visibleUsers.has(e.actorId));
  return out;
}
