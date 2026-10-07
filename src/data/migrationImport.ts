import type { DB, ID } from './models';
import { canonical, MIGRATION_TABLES, type MigrationBundle } from './migration';
import { patientLinkedIds } from './privacy';

/**
 * Account-bound import plan for a VERIFIED migration bundle (Phase 32). Pure: it never writes.
 * The server applies a plan inside one transaction and keeps `rollback` to undo exactly what it
 * inserted. Rules:
 *  - only the signed-in patient's own records move (the bundle patient whose userId is the local
 *    account being transferred); other people's rows are refused, never merged;
 *  - the patient must have a current, granted data-storage consent in the bundle;
 *  - a row whose id already exists on the server with identical content is skipped; with different
 *    content it is a CONFLICT — nothing is overwritten, the clinician resolves it;
 *  - every inserted row is recorded with the bundle checksum and export time (provenance).
 */

type Row = Record<string, unknown> & { id?: unknown };

export interface ImportPlan {
  ok: boolean;
  /** Why the whole import is refused (empty when ok). */
  refused: string[];
  insert: { table: string; row: Row }[];
  skippedIdentical: number;
  conflicts: { table: string; id: string; reason: string }[];
  /** Rows in the bundle that do not belong to this account (not imported). */
  notOwned: number;
  provenance: { bundleSha256: string; exportedAt: string; localUserId: ID; serverUserId: ID };
  /** Exact ids to delete to undo this import. */
  rollback: { table: string; id: string }[];
}

export function planMigrationImport(bundle: MigrationBundle, server: Pick<DB, (typeof MIGRATION_TABLES)[number]>, account: { localUserId: ID; serverUserId: ID }): ImportPlan {
  const refused: string[] = [];
  const patients = (bundle.tables.patients as Row[]).filter((p) => p.userId === account.localUserId);
  if (patients.length !== 1) refused.push(patients.length ? 'more than one patient record for this account' : 'no patient record for this account in the bundle');
  const patientId = patients[0]?.id as string | undefined;
  const consents = (bundle.tables.consents as Row[])
    .filter((c) => c.patientId === patientId && c.type === 'data_storage')
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (patientId && consents[0]?.granted !== true) refused.push('no current data-storage consent from the patient');

  // Ownership by linkage over the bundle itself (the same rule used for data access and erasure).
  const asDb = Object.fromEntries(MIGRATION_TABLES.map((t) => [t, bundle.tables[t] ?? []])) as unknown as DB;
  const owned = patientId ? patientLinkedIds(asDb, patientId) : new Set<string>();
  const insert: ImportPlan['insert'] = [];
  const conflicts: ImportPlan['conflicts'] = [];
  let skippedIdentical = 0;
  let notOwned = 0;
  for (const t of MIGRATION_TABLES) {
    if (t === 'users' || t === 'audit' || t === 'clinicians' || t === 'contentItems' || t === 'contentReviews' || t === 'expenses') {
      notOwned += (bundle.tables[t] ?? []).length;
      continue; // accounts, audit and clinic-level tables are never transferred from a browser
    }
    const existing = new Map(((server[t] as unknown as Row[]) ?? []).map((r) => [r.id as string, r]));
    for (const raw of bundle.tables[t] as Row[]) {
      const id = typeof raw.id === 'string' ? raw.id : null;
      if (!id || !owned.has(id)) {
        notOwned++;
        continue;
      }
      // The local account id becomes the server account id; nothing else is rewritten.
      const row: Row = t === 'patients' ? { ...raw, userId: account.serverUserId } : raw;
      const prior = existing.get(id);
      if (prior) {
        if (canonical(prior) === canonical(row)) skippedIdentical++;
        else conflicts.push({ table: t, id, reason: 'already on the server with different content' });
        continue;
      }
      insert.push({ table: t, row });
    }
  }
  if (conflicts.length) refused.push(`${conflicts.length} conflicting record(s) need review before import`);
  return {
    ok: refused.length === 0,
    refused,
    insert: refused.length ? [] : insert,
    skippedIdentical,
    conflicts,
    notOwned,
    provenance: { bundleSha256: bundle.sha256, exportedAt: bundle.exportedAt, ...account },
    rollback: refused.length ? [] : insert.map((x) => ({ table: x.table, id: x.row.id as string })),
  };
}

/** Applies a plan to a database copy (used by tests and a future staging importer). */
export function applyImportPlan<T extends object>(server: T, plan: ImportPlan): T {
  if (!plan.ok) return server;
  const out = { ...server } as Record<string, unknown>;
  for (const { table, row } of plan.insert) out[table] = [...((out[table] as Row[]) ?? []), row];
  return out as unknown as T;
}

/** Undoes exactly the rows a plan inserted. */
export function rollbackImport<T extends object>(server: T, plan: ImportPlan): T {
  const drop = new Map<string, Set<string>>();
  for (const r of plan.rollback) drop.set(r.table, (drop.get(r.table) ?? new Set()).add(r.id));
  const out = { ...server } as Record<string, unknown>;
  for (const [t, ids] of drop) out[t] = ((out[t] as Row[]) ?? []).filter((r) => !ids.has(r.id as string));
  return out as unknown as T;
}
