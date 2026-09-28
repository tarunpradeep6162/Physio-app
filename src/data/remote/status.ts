/** Observable sync status (import-free so the app shell can show it without loading the client). */

export type SyncState = 'off' | 'syncing' | 'synced' | 'offline' | 'error';
export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt: string | null;
  message?: string;
}

let status: SyncStatus = { state: 'off', pending: 0, lastSyncAt: null };
const listeners = new Set<() => void>();

export const getSyncStatus = () => status;
export function setSyncStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  listeners.forEach((l) => l());
}
export function onSyncStatus(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
