// Dheepika Lab service worker: offline app shell + cached pose runtime.
// Never caches API responses or anything containing patient data (all patient data lives in
// on-device storage in this MVP build).
//
// Updates wait: a new worker installs in the background and takes over only when the person taps
// "Reload" in the update banner (message SKIP_WAITING), never in the middle of a session.
// The 3D anatomy model is served from the cache only if the person chose "Keep for offline use"
// (the page fills ANATOMY_CACHE itself); the worker never caches it on its own.
const VERSION = 'dl-sw-3';
const ANATOMY_CACHE = 'dl-anatomy-1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('dl-sw-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Anatomy model: opt-in offline copy first, otherwise the network as usual.
  if (url.pathname.startsWith('/anatomy/')) {
    e.respondWith(caches.open(ANATOMY_CACHE).then((c) => c.match(req)).then((hit) => hit || fetch(req)));
    return;
  }
  // SPA navigations: network first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // Hashed build assets and the pose model/WASM are immutable: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pose/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
