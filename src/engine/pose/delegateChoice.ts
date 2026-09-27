/**
 * Chooses the MediaPipe delegate (GPU/WebGL vs CPU/WASM-SIMD) by MEASUREMENT on this device.
 *
 * Why: the GPU delegate is not always faster. On software WebGL (SwiftShader, llvmpipe, some
 * blocklisted phone GPUs) it measured ~10× slower than CPU (≈650 vs ≈60 ms per frame, Phase 1).
 * The runtime starts with the best guess, times the first frames, tries the other delegate if the
 * first is slow, keeps the faster one and caches the decision for this device + browser + model.
 */

export type Delegate = 'GPU' | 'CPU';

export interface DelegateDecision {
  key: string;
  delegate: Delegate;
  measuredMs: Partial<Record<Delegate, number>>;
  at: string;
}

const STORE = 'physiovision.poseDelegate';
const MAX_AGE_MS = 30 * 86_400_000;
/** Median inference time above which the other delegate is tried. */
export const PROBE_SLOW_MS = 60;
/** Frames timed per delegate (after the first `PROBE_WARMUP` frames are discarded). */
export const PROBE_FRAMES = 15;
export const PROBE_WARMUP = 5;

export function webglRenderer(): string | null {
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return null;
  }
}

export function isSoftwareRenderer(r: string | null): boolean {
  return r === null || /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(r);
}

export function decisionKey(variant: string, renderer: string | null, ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  return `${variant}|${renderer ?? 'no-webgl'}|${ua}`;
}

export function cachedDecision(key: string, now = Date.now()): DelegateDecision | null {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, DelegateDecision>;
    const d = all[key];
    return d && now - Date.parse(d.at) < MAX_AGE_MS ? d : null;
  } catch {
    return null;
  }
}

export function saveDecision(d: DelegateDecision) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, DelegateDecision>;
    all[d.key] = d;
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage unavailable: re-probe next time */
  }
}

/** Starting delegate before any measurement on this device. */
export function initialDelegate(renderer: string | null): Delegate {
  return isSoftwareRenderer(renderer) ? 'CPU' : 'GPU';
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/**
 * Probe state machine. Feed each inference time; it answers whether to keep measuring, switch
 * delegate, or finish (with the decision).
 */
export class DelegateProbe {
  private times: number[] = [];
  readonly measured: Partial<Record<Delegate, number>> = {};
  constructor(public current: Delegate) {}

  add(ms: number): { action: 'measuring' } | { action: 'switch'; to: Delegate } | { action: 'done'; delegate: Delegate } {
    this.times.push(ms);
    if (this.times.length < PROBE_WARMUP + PROBE_FRAMES) return { action: 'measuring' };
    const med = median(this.times.slice(PROBE_WARMUP));
    this.measured[this.current] = Math.round(med * 10) / 10;
    this.times = [];
    const other: Delegate = this.current === 'GPU' ? 'CPU' : 'GPU';
    if (this.measured[other] === undefined && med > PROBE_SLOW_MS) {
      this.current = other;
      return { action: 'switch', to: other };
    }
    // Both measured (or the first was fast enough): keep the faster.
    const g = this.measured.GPU;
    const c = this.measured.CPU;
    const best: Delegate = g !== undefined && c !== undefined ? (g <= c ? 'GPU' : 'CPU') : this.current;
    if (best !== this.current) {
      this.current = best;
      return { action: 'switch', to: best };
    }
    return { action: 'done', delegate: best };
  }
}
