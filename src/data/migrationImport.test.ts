import { describe, expect, it } from 'vitest';
import type { DB } from './models';
import { emptyDb } from './store';
import { buildMigrationBundle, verifyMigrationBundle } from './migration';
import { applyImportPlan, planMigrationImport, rollbackImport } from './migrationImport';
import { erasePatient, patientLinkedIds } from './privacy';

const NOW = '2026-10-07T10:00:00Z';

function localDb(consent: boolean | null): DB {
  const d = emptyDb();
  d.users.push({ id: 'local-u', email: 'a@example.test', role: 'patient', displayName: 'A', createdAt: NOW } as DB['users'][number]);
  d.patients.push({ id: 'pa', userId: 'local-u', name: 'A', preferredLanguage: 'en', createdAt: NOW });
  d.patients.push({ id: 'pb', userId: 'someone-else', name: 'B', preferredLanguage: 'en', createdAt: NOW });
  if (consent !== null) d.consents.push({ id: 'c1', patientId: 'pa', type: 'data_storage', granted: consent, textVersion: '1', at: NOW });
  for (const pid of ['pa', 'pb']) {
    d.assessments.push({ id: `as-${pid}`, patientId: pid, createdBy: 'local-u', status: 'submitted', createdAt: NOW } as DB['assessments'][number]);
    d.measurements.push({ id: `m-${pid}`, patientId: pid, assessmentId: `as-${pid}`, type: 'knee_flexion', value: 100, unit: 'deg', confidence: 0.9, category: 'camera_estimate', provenance: { source: 'camera_estimation', createdBy: 'local-u', createdAt: NOW, engineVersion: 'x', algorithmVersion: 'y' }, reviewStatus: 'pending', createdAt: NOW });
  }
  return d;
}
const account = { localUserId: 'local-u', serverUserId: 'server-u' };

describe('account-bound migration import (Phase 32)', () => {
  it('moves only the account holder’s records, remaps the account, and rolls back exactly', async () => {
    const bundle = await verifyMigrationBundle(await buildMigrationBundle(localDb(true)));
    const server = emptyDb();
    const plan = planMigrationImport(bundle, server, account);
    expect(plan.ok).toBe(true);
    expect(plan.insert.map((x) => `${x.table}:${x.row.id}`).sort()).toEqual(['assessments:as-pa', 'consents:c1', 'measurements:m-pa', 'patients:pa']);
    expect(plan.notOwned).toBeGreaterThan(0); // patient B, the local user row
    expect(plan.provenance.bundleSha256).toBe(bundle.sha256);
    const after = applyImportPlan(server, plan);
    expect(after.patients[0].userId).toBe('server-u');
    expect(after.measurements.map((m) => m.id)).toEqual(['m-pa']);
    // Re-running the same import is idempotent: everything is identical, nothing is inserted twice.
    const again = planMigrationImport(bundle, after, account);
    expect(again.insert).toEqual([]);
    expect(again.skippedIdentical).toBe(4);
    // Rollback removes exactly the inserted rows.
    expect(rollbackImport(after, plan)).toEqual(server);
  });

  it('erasure on the server removes every imported record (deletion test)', async () => {
    const bundle = await verifyMigrationBundle(await buildMigrationBundle(localDb(true)));
    const after = applyImportPlan(emptyDb(), planMigrationImport(bundle, emptyDb(), account));
    const erased = erasePatient(after, 'pa', NOW);
    expect(patientLinkedIds(erased, 'pa').size).toBeLessThanOrEqual(1);
    expect([...erased.patients, ...erased.assessments, ...erased.measurements, ...erased.consents].filter((r) => JSON.stringify(r).includes('"pa"'))).toEqual([]);
  });

  it('refuses without a current data-storage consent', async () => {
    for (const consent of [false, null]) {
      const bundle = await verifyMigrationBundle(await buildMigrationBundle(localDb(consent)));
      const plan = planMigrationImport(bundle, emptyDb(), account);
      expect(plan.ok).toBe(false);
      expect(plan.refused).toContain('no current data-storage consent from the patient');
      expect(plan.insert).toEqual([]);
    }
  });

  it('never overwrites: a different server copy is a conflict and blocks the import', async () => {
    const bundle = await verifyMigrationBundle(await buildMigrationBundle(localDb(true)));
    const server = emptyDb();
    server.measurements.push({ ...(bundle.tables.measurements as DB['measurements']).find((m) => m.id === 'm-pa')!, value: 95 });
    const plan = planMigrationImport(bundle, server, account);
    expect(plan.ok).toBe(false);
    expect(plan.conflicts).toEqual([{ table: 'measurements', id: 'm-pa', reason: 'already on the server with different content' }]);
    expect(plan.rollback).toEqual([]);
  });

  it('refuses a bundle with no patient record for this account', async () => {
    const bundle = await verifyMigrationBundle(await buildMigrationBundle(localDb(true)));
    expect(planMigrationImport(bundle, emptyDb(), { localUserId: 'stranger', serverUserId: 's' }).refused).toEqual(['no patient record for this account in the bundle']);
  });
});
