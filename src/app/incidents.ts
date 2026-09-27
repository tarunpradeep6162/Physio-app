/**
 * Incident observability (Phase 19) without leaking health data. Errors are kept in a small local
 * ring buffer (never sent anywhere) after redaction: e-mail addresses, UUIDs, long numbers, dates,
 * quoted text and anything after "value", "name", "answer" or "note" are removed, and stack
 * frames keep only the file name. A clinician can export the buffer for support.
 */

export interface Incident {
  at: string;
  kind: 'error' | 'unhandled_rejection' | 'route';
  message: string;
  where?: string;
  build?: string;
}

const KEY = 'dl.incidents';
const MAX = 50;

export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?\b/g, '[date]')
    .replace(/"[^"]*"|“[^”]*”|'[^']{3,}'/g, '[text]')
    .replace(/\b(value|name|answer|note|body|text|detail)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\d{3,}/g, '[n]')
    .slice(0, 300);
}

function where(stack: string | undefined): string | undefined {
  const m = stack?.split('\n').find((l) => /\.(t|j)sx?:\d+/.test(l));
  const f = m?.match(/([\w-]+\.(?:t|j)sx?):(\d+)/);
  return f ? `${f[1]}:${f[2]}` : undefined;
}

export function readIncidents(): Incident[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Incident[];
  } catch {
    return [];
  }
}

export function recordIncident(kind: Incident['kind'], err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err));
  const inc: Incident = { at: new Date().toISOString(), kind, message: redact(`${e.name}: ${e.message}`), where: where(e.stack), build: typeof document !== 'undefined' ? document.querySelector('script[src*="main-"]')?.getAttribute('src')?.match(/main-[\w-]+/)?.[0] : undefined };
  try {
    localStorage.setItem(KEY, JSON.stringify([...readIncidents(), inc].slice(-MAX)));
  } catch {
    /* storage unavailable: nothing is recorded, nothing is sent */
  }
}

export function clearIncidents() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function installIncidentHandlers() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (e) => recordIncident('error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => recordIncident('unhandled_rejection', e.reason));
}
