import type { AuditEvent, DB, ID } from './models';

/**
 * Replica merge (Phase 10 gate: "offline / poor-network behaviour and cross-device
 * synchronisation preserve the record and explain conflicts").
 *
 * Every write in this app goes through the store and leaves an audit event (create / update /
 * delete, table, row id, time). Two copies of the database — another browser tab today, another
 * device through a server later — are merged with those events:
 *
 * - a row that exists on only one side is kept (nothing recorded on either side is lost), unless
 *   the other side's audit shows it was deleted;
 * - a row present on both sides with different content keeps the version with the later audited
 *   write. If BOTH sides changed it since they last agreed, that is a conflict: the later version
 *   wins, and the conflict — with the version that lost — is returned so it can be shown to the
 *   user and written to the audit trail. Nothing is merged silently;
 * - audit events are unioned (append-only), so the merged history shows both sides' writes.
 *
 * Pure function; the transport (storage event, server) is the caller's business.
 */

export interface SyncConflict {
  table: string;
  rowId: ID;
  kept: 'local' | 'remote';
  keptAt: string;
  discarded: unknown;
  discardedAt: string;
}

export interface MergeResult {
  db: DB;
  conflicts: SyncConflict[];
  addedFromRemote: number;
}

type Row = { id: ID } & Record<string, unknown>;

function lastWrite(audit: AuditEvent[]): Map<string, AuditEvent> {
  const m = new Map<string, AuditEvent>();
  for (const e of audit) {
    if (e.action !== 'create' && e.action !== 'update') continue;
    const k = `${e.entity}:${e.entityId}`;
    const cur = m.get(k);
    if (!cur || e.at > cur.at || (e.at === cur.at && e.id > cur.id)) m.set(k, e);
  }
  return m;
}

const stable = (v: unknown) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

export function mergeReplicas(local: DB, remote: DB): MergeResult {
  const conflicts: SyncConflict[] = [];
  let addedFromRemote = 0;
  const localIds = new Set(local.audit.map((e) => e.id));
  const remoteIds = new Set(remote.audit.map((e) => e.id));
  const audit = [...local.audit, ...remote.audit.filter((e) => !localIds.has(e.id))].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const deleted = new Set(audit.filter((e) => e.action === 'delete').map((e) => `${e.entity}:${e.entityId}`));
  const lwLocal = lastWrite(local.audit);
  const lwRemote = lastWrite(remote.audit);

  const out = { ...local, audit } as DB;
  for (const table of Object.keys(local) as (keyof DB)[]) {
    if (table === 'audit' || !Array.isArray(local[table])) continue;
    const L = local[table] as unknown as Row[];
    const R = ((remote[table] as unknown as Row[] | undefined) ?? []) as Row[];
    const byId = new Map<ID, Row>(L.map((r) => [r.id, r]));
    for (const r of R) {
      const key = `${table}:${r.id}`;
      const l = byId.get(r.id);
      if (!l) {
        // New on the remote side — unless this side deleted it.
        if (!deleted.has(key)) {
          byId.set(r.id, r);
          addedFromRemote++;
        }
        continue;
      }
      if (stable(l) === stable(r)) continue;
      const wl = lwLocal.get(key);
      const wr = lwRemote.get(key);
      const remoteNewer = !!wr && (!wl || wr.at > wl.at || (wr.at === wl.at && wr.id > wl.id));
      // Both sides wrote since they agreed: a write the other side has not seen, on each side.
      const localUnseen = !!wl && !remoteIds.has(wl.id);
      const remoteUnseen = !!wr && !localIds.has(wr.id);
      if (localUnseen && remoteUnseen) {
        conflicts.push({ table, rowId: r.id, kept: remoteNewer ? 'remote' : 'local', keptAt: (remoteNewer ? wr : wl)!.at, discarded: remoteNewer ? l : r, discardedAt: (remoteNewer ? wl : wr)!.at });
      }
      if (remoteNewer) byId.set(r.id, r);
    }
    for (const id of [...byId.keys()]) if (deleted.has(`${table}:${id}`) && !L.some((r) => r.id === id)) byId.delete(id);
    // Rows deleted on the remote side after this side last wrote them are removed here too.
    for (const r of L) {
      const key = `${table}:${r.id}`;
      if (deleted.has(key) && remote.audit.some((e) => e.action === 'delete' && `${e.entity}:${e.entityId}` === key && !localIds.has(e.id))) byId.delete(r.id);
    }
    (out as unknown as Record<string, Row[]>)[table] = [...byId.values()];
  }
  // Settings: the side whose last settings write is later.
  const sl = local.audit.filter((e) => e.entity === 'settings').map((e) => e.at).sort().at(-1) ?? '';
  const sr = remote.audit.filter((e) => e.entity === 'settings').map((e) => e.at).sort().at(-1) ?? '';
  out.settings = sr > sl ? remote.settings : local.settings;
  out.schemaVersion = Math.max(local.schemaVersion, remote.schemaVersion);
  return { db: out, conflicts, addedFromRemote };
}
