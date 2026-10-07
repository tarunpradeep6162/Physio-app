import { describe, expect, it } from 'vitest';
import { ANATOMY_CACHE, keepModelOffline, MODEL_FILES, offlineModelState, removeOfflineModels } from './offlineModel';

const fs = (await import('node:' + 'fs')) as { readFileSync: (path: string, enc: string) => string };

/** In-memory Cache Storage; `fail` makes addAll reject after storing the first file. */
function fakeCaches(fail = false) {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (url: string) => m.get(url),
      delete: async (url: string) => m.delete(url),
      addAll: async (urls: string[]) => {
        for (const [i, u] of urls.entries()) {
          if (fail && i === 1) throw new Error('network');
          m.set(u, new Response(new Uint8Array(10 + i), { headers: { 'content-length': String(10 + i) } }));
        }
      },
    } as unknown as Cache;
  };
  return { stores, cs: { open, has: async (n: string) => stores.has(n), delete: async (n: string) => stores.delete(n) } };
}

describe('offline anatomy model (Phase 45)', () => {
  it('nothing is stored until the person asks', async () => {
    const { cs } = fakeCaches();
    expect(await offlineModelState(cs)).toEqual({ stored: [], bytes: 0 });
  });

  it('keeps the chosen model, reports its size, and removes it on request', async () => {
    const { cs } = fakeCaches();
    await keepModelOffline('lite', cs);
    expect(await offlineModelState(cs)).toEqual({ stored: ['lite'], bytes: 21 });
    await removeOfflineModels(cs);
    expect((await offlineModelState(cs)).stored).toEqual([]);
  });

  it('a failed download leaves no partial copy', async () => {
    const { cs, stores } = fakeCaches(true);
    await expect(keepModelOffline('full', cs)).rejects.toThrow();
    expect([...stores.get(ANATOMY_CACHE)!.keys()]).toEqual([]);
  });

  it('the service worker serves from the same cache name and never caches the model itself', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    expect(sw).toContain(`const ANATOMY_CACHE = '${ANATOMY_CACHE}'`);
    // The anatomy branch only reads the cache and falls back to the network.
    const branch = sw.slice(sw.indexOf("startsWith('/anatomy/')"), sw.indexOf('// SPA navigations'));
    expect(branch).not.toMatch(/\.put\(|addAll/);
    // Old app-shell caches are cleared on update; the opt-in model cache is not.
    expect(sw).toMatch(/k\.startsWith\('dl-sw-'\) && k !== VERSION/);
  });

  it('lists files that exist in the build', () => {
    for (const f of [...MODEL_FILES.lite, ...MODEL_FILES.full]) expect(() => fs.readFileSync(`public${f}`, 'latin1')).not.toThrow();
  });
});
