import { describe, expect, it } from 'vitest';
import { redact } from '../app/incidents';
import { buildDemoDb } from './demo';
import type { DB } from './models';
import { erasePatient, exportPatientData, patientLinkedIds } from './privacy';
import { emptyDb } from './store';

function richDb(): { db: DB; pid: string; uid: string; otherPid: string } {
  const db = buildDemoDb();
  const p = db.patients.find((x) => x.name.includes('DP-01'))!;
  const other = db.patients.find((x) => x.name.includes('DP-02'))!;
  const prog = db.programs.find((x) => x.patientId === p.id)!;
  // Rows in the newer tables, linked in different ways.
  db.planPauses.push({ id: 'pp1', programId: prog.id, patientId: p.id, reason: 'patient_report', by: p.userId!, at: '2026-01-01' });
  db.planResumes.push({ id: 'pr1', pauseId: 'pp1', programId: prog.id, patientId: p.id, note: 'ok', by: 'c', at: '2026-01-02' });
  db.programLibraryItems.push({ id: 'pl1', programId: prog.id, order: 0, itemId: 'sit-to-stand', itemVersion: '0.1.0', sets: 1, reps: 5, frequencyPerWeek: 3 });
  db.activityImports.push({ id: 'ai1', patientId: p.id, platform: 'csv', at: '', status: 'ok', added: 1, duplicates: 0, ignored: {}, errors: [] });
  db.activitySamples.push({ id: 'as1', patientId: p.id, metric: 'steps', value: 100, start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', tzOffsetMin: 0, source: { platform: 'csv', app: 'x' }, importId: 'ai1', importedAt: '' });
  db.deviceMeasurements.push({ id: 'dm1', patientId: p.id, kind: 'grip_dynamometer', measure: 'Grip', value: 30, unit: 'kg', measuredAt: '2026-01-01T00:00:00+05:30', device: { manufacturer: 'A', model: 'B' }, calibration: { status: 'unknown' }, source: { kind: 'clinician_entry' }, enteredBy: 'c', createdAt: '', category: 'device_measured' });
  db.examFindings.push({ id: 'ef1', assessmentId: db.assessments.find((a) => a.patientId === p.id)!.id, area: 'x', text: 'y', by: 'c', at: '' });
  db.appointments.push({ id: 'ap1', patientId: p.id, clinicianId: 'c', at: '', kind: 'call', status: 'scheduled', createdBy: 'c', createdAt: '' });
  return { db, pid: p.id, uid: p.userId!, otherPid: other.id };
}

describe('Phase 19 — data access and erasure cover every table', () => {
  it('erasure leaves no row linked to the patient in ANY table, and keeps other patients intact', () => {
    const { db, pid, uid, otherPid } = richDb();
    const ids = patientLinkedIds(db, pid);
    const before = JSON.stringify(db.captures.filter((c) => c.patientId === otherPid));
    const out = erasePatient(db, pid, '2026-09-27T00:00:00Z');
    for (const table of Object.keys(emptyDb()) as (keyof DB)[]) {
      const rows = out[table];
      if (!Array.isArray(rows)) continue;
      const leak = (rows as unknown as Record<string, unknown>[]).filter((r) => Object.values(r).some((v) => typeof v === 'string' && (v === pid || v === uid || (ids.has(v) && table !== 'contentItems'))));
      expect(leak, `table ${table}`).toEqual([]);
    }
    expect(JSON.stringify(out)).not.toContain(pid);
    expect(JSON.stringify(out.captures.filter((c) => c.patientId === otherPid))).toBe(before);
    expect(out.audit.at(-1)).toMatchObject({ action: 'account_deleted', entityId: 'erased' });
  });

  it('the data export contains exactly what erasure removes (plus the audit trail), without password material', () => {
    const { db, pid } = richDb();
    const exp = exportPatientData(db, pid);
    const out = erasePatient(db, pid, 'now');
    for (const [k, rows] of Object.entries(exp)) {
      if (k === 'exportedAt' || k === 'audit' || k === 'users') continue;
      expect((rows as unknown[]).length, k).toBe((db[k as keyof DB] as unknown[]).length - (out[k as keyof DB] as unknown[]).length);
    }
    for (const k of ['planPauses', 'planResumes', 'programLibraryItems', 'activitySamples', 'activityImports', 'deviceMeasurements', 'examFindings', 'appointments', 'captures', 'sessions']) expect(exp[k]?.length, k).toBeGreaterThan(0);
    expect(JSON.stringify(exp.users)).not.toMatch(/passwordHash|passwordSalt/);
  });
});

describe('Phase 19 — no health information leaks to logs or analytics', () => {
  it('redacts identifiers, dates, numbers and free text from incident messages', () => {
    const r = redact('TypeError: cannot read value: 118 for patient a1b2c3d4-1111-2222-3333-444455556666 (asha@example.com) on 2026-09-20T10:15:00+05:30 note="knee hurts" 5551234');
    expect(r).not.toMatch(/118|asha|example\.com|2026-09-20|knee hurts|5551234|a1b2c3d4/);
    expect(r).toMatch(/TypeError/);
  });

  it('the source contains no analytics or remote logging, and console output only in the lab tools', () => {
    const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const [f, s] of Object.entries(sources)) {
      if (/sendBeacon|google-analytics\.com|googletagmanager|gtag\(|mixpanel|segment\.(io|com)|@sentry\/|posthog|@amplitude\/|amplitude\.com|navigator\.sendBeacon/i.test(s)) offenders.push(`${f}: analytics/telemetry`);
      if (/console\.(log|info|debug|warn|error)\(/.test(s) && !f.includes('/lab/')) offenders.push(`${f}: console output`);
      for (const m of s.matchAll(/fetch\(([^)]*)\)/g)) if (!/url|asset|href/i.test(m[1])) offenders.push(`${f}: fetch(${m[1]})`);
    }
    expect(offenders).toEqual([]);
  });
});
