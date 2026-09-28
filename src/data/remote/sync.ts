import { recordIncident } from '../../app/incidents';
import { applyRemote, getDb, onWrite, type Rec } from '../store';
import { flushBatches, Outbox, toRemoteRows, type RemoteRow } from './records';
import { supabase } from './client';
import { getSyncStatus, setSyncStatus as setStatus } from './status';

export { getSyncStatus, onSyncStatus, type SyncState, type SyncStatus } from './status';

/**
 * Sync engine. Local writes go to a persisted outbox and are sent to Supabase in a safe order;
 * changes made on other devices are pulled incrementally (by server timestamp). A row with a local
 * change still waiting to be sent is not overwritten by the server copy until it has been sent.
 * Rows the server refuses (row-level security) are dropped from the outbox and logged as an
 * incident — they would never succeed — while network failures are retried.
 */

let outbox: Outbox | null = null;
let role: 'patient' | 'clinician' = 'patient';
let cursorKey = '';
let stopWrites: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

const readCursor = () => {
  try {
    return localStorage.getItem(cursorKey) ?? '1970-01-01T00:00:00Z';
  } catch {
    return '1970-01-01T00:00:00Z';
  }
};
const writeCursor = (c: string) => {
  try {
    localStorage.setItem(cursorKey, c);
  } catch {
    /* ignore */
  }
};

export async function flush(): Promise<void> {
  if (!outbox || !outbox.size) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus({ state: 'offline', pending: outbox.size });
    return;
  }
  setStatus({ state: 'syncing', pending: outbox.size });
  for (const batch of flushBatches(outbox.all())) {
    const rows = batch.rows.map(({ tbl, id, patient_id, data, deleted }) => ({ tbl, id, patient_id, data, deleted }));
    const { error } = await supabase().from('records').upsert(rows, { onConflict: 'tbl,id', ignoreDuplicates: batch.appendOnly });
    if (!error) {
      outbox.ack(batch.rows);
      continue;
    }
    if (error.code === '42501' || /row-level security|append-only/i.test(error.message)) {
      // Refused by the server's rules: retrying cannot succeed. Keep a redacted record.
      recordIncident('error', new Error(`sync refused for ${batch.rows.map((r) => r.tbl).join(',')}: ${error.message}`));
      outbox.ack(batch.rows);
      continue;
    }
    setStatus({ state: 'error', pending: outbox.size, message: error.message });
    return;
  }
  setStatus({ pending: outbox.size });
}

export async function pull(): Promise<number> {
  let cursor = readCursor();
  let total = 0;
  for (;;) {
    const { data, error } = await supabase().from('records').select('tbl,id,data,deleted,updated_at').gt('updated_at', cursor).order('updated_at', { ascending: true }).limit(1000);
    if (error) throw error;
    const rows = (data ?? []) as { tbl: string; id: string; data: Rec; deleted: boolean; updated_at: string }[];
    if (!rows.length) break;
    applyRemote(rows.filter((r) => !outbox?.has(r.tbl, r.id)).map((r) => ({ table: r.tbl, id: r.id, data: r.deleted ? null : r.data })));
    total += rows.length;
    cursor = rows[rows.length - 1].updated_at;
    writeCursor(cursor);
    if (rows.length < 1000) break;
  }
  return total;
}

export async function syncNow(): Promise<void> {
  if (!running) return;
  try {
    await flush();
    await pull();
    if (getSyncStatus().state !== 'error') setStatus({ state: outbox?.size ? 'syncing' : 'synced', pending: outbox?.size ?? 0, lastSyncAt: new Date().toISOString(), message: undefined });
  } catch (e) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setStatus({ state: offline ? 'offline' : 'error', pending: outbox?.size ?? 0, message: offline ? undefined : e instanceof Error ? e.message : String(e) });
  }
}

const onOnline = () => void syncNow();
const onVisible = () => {
  if (document.visibilityState === 'visible') void syncNow();
};

/** Starts syncing for the signed-in account. `userId` scopes the outbox and cursor to this account. */
export async function startSync(userId: string, userRole: 'patient' | 'clinician'): Promise<void> {
  stopSync();
  running = true;
  role = userRole;
  cursorKey = `dl.sync.cursor.${userId}`;
  outbox = new Outbox(`dl.sync.outbox.${userId}`);
  stopWrites = onWrite((events) => {
    const rows = toRemoteRows(getDb(), events, role);
    if (!rows.length || !outbox) return;
    outbox.add(rows);
    setStatus({ pending: outbox.size });
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => void syncNow(), 800);
  });
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    timer = setInterval(() => void syncNow(), 20_000);
  }
  setStatus({ state: 'syncing', pending: outbox.size });
  await syncNow();
}

export function stopSync() {
  running = false;
  stopWrites?.();
  stopWrites = null;
  if (timer) clearInterval(timer);
  if (flushTimer) clearTimeout(flushTimer);
  timer = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  }
  outbox = null;
  setStatus({ state: 'off', pending: 0 });
}

/** Changes still waiting to reach the server (e.g. before signing out). */
export const pendingCount = () => outbox?.size ?? 0;

/** Sends a batch of rows directly (used right after sign-up, before the write hook exists). */
export async function pushNow(rows: RemoteRow[]) {
  outbox?.add(rows);
  await flush();
}
