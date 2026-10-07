/**
 * Service worker registration and update prompt (Phase 45). A new version installs in the
 * background and waits; the app shows a banner, and the person decides when to reload, so an update
 * never swaps the app in the middle of a camera capture or a form.
 */
type Listener = () => void;
let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export const updateReady = () => waiting !== null;
export function onUpdateReady(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Tell the waiting worker to take over, then reload once it controls the page. */
export function applyUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage('SKIP_WAITING');
}

export async function registerServiceWorker(url: string) {
  const reg = await navigator.serviceWorker.register(url);
  const track = (w: ServiceWorker | null) => {
    if (!w) return;
    const check = () => {
      // Only an UPDATE waits behind an existing controller; a first install just activates.
      if (w.state === 'installed' && navigator.serviceWorker.controller) {
        waiting = w;
        emit();
      }
    };
    check();
    w.addEventListener('statechange', check);
  };
  track(reg.waiting);
  reg.addEventListener('updatefound', () => track(reg.installing));
  // Check for a new version when the app returns to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => undefined);
  });
}
