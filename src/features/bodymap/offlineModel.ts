/**
 * Opt-in offline copy of the 3D anatomy model (Phase 45). The page stores the files in a named
 * Cache Storage bucket that the service worker serves from (public/sw.js, ANATOMY_CACHE); nothing
 * is cached unless the person asks. The model is illustration only and holds no patient data.
 */
import type { AnatomyDetail } from '../../data/prefs';

/** Must match ANATOMY_CACHE in public/sw.js. */
export const ANATOMY_CACHE = 'dl-anatomy-1';
export const MODEL_FILES: Record<AnatomyDetail, readonly string[]> = {
  lite: ['/anatomy/anatomy-lite.glb', '/anatomy/skeleton-lite.glb'],
  full: ['/anatomy/anatomy.glb', '/anatomy/skeleton.glb'],
};

export interface OfflineModelState {
  /** Details whose files are all stored. */
  stored: AnatomyDetail[];
  /** Bytes held by the stored model files. */
  bytes: number;
}

type Caches = Pick<CacheStorage, 'open' | 'delete' | 'has'>;

export async function offlineModelState(cs: Caches | undefined = globalThis.caches): Promise<OfflineModelState> {
  if (!cs || !(await cs.has(ANATOMY_CACHE))) return { stored: [], bytes: 0 };
  const cache = await cs.open(ANATOMY_CACHE);
  const stored: AnatomyDetail[] = [];
  let bytes = 0;
  for (const detail of ['lite', 'full'] as const) {
    let all = true;
    for (const f of MODEL_FILES[detail]) {
      const hit = await cache.match(f);
      if (!hit) {
        all = false;
        continue;
      }
      bytes += Number(hit.headers.get('content-length')) || (await hit.clone().arrayBuffer()).byteLength;
    }
    if (all) stored.push(detail);
  }
  return { stored, bytes };
}

/** Download and keep one model. Fails as a whole: a partial copy is removed again. */
export async function keepModelOffline(detail: AnatomyDetail, cs: Caches | undefined = globalThis.caches): Promise<void> {
  if (!cs) throw new Error('This browser cannot store files for offline use.');
  const cache = await cs.open(ANATOMY_CACHE);
  try {
    await cache.addAll([...MODEL_FILES[detail]]);
  } catch (e) {
    for (const f of MODEL_FILES[detail]) await cache.delete(f);
    throw e;
  }
}

/** Remove every offline model file. */
export async function removeOfflineModels(cs: Caches | undefined = globalThis.caches): Promise<void> {
  if (cs) await cs.delete(ANATOMY_CACHE);
}

/** Storage this site uses and may use, where the browser reports it. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const s = (navigator as Navigator & { storage?: StorageManager }).storage;
  if (!s?.estimate) return null;
  const e = await s.estimate();
  return e.usage !== undefined && e.quota !== undefined ? { usage: e.usage, quota: e.quota } : null;
}
