/**
 * On-device performance record for the 3D anatomy atlas (Phase 24). Measures what a tester needs to
 * judge the atlas on a target phone — load and tagging time, frame intervals while turning the
 * model, render cost, tap-to-highlight latency, memory where the browser reports it, and WebGL
 * context loss. It holds NO patient data, and it sets no pass/fail thresholds: acceptance is decided
 * by the product owner with real-phone runs recorded in docs/ANATOMY_PHONE_QA.md.
 */

export interface AtlasStats {
  kind: 'dheepika-atlas-device-qa';
  version: 1;
  recordedAt: string;
  device: {
    userAgent: string;
    devicePixelRatio: number;
    viewport: string;
    webglRenderer: string | null;
    maxTextureSize: number | null;
    saveData: boolean | null;
    effectiveType: string | null;
  };
  load: {
    /** Muscle model: request → first frame drawn (ms). */
    modelMs: number | null;
    /** Of which: per-vertex region tagging (ms). */
    tagMs: number | null;
    /** Optional skeleton: request → drawn (ms). */
    skeletonMs: number | null;
    meshes: number;
    vertices: number;
    triangles: number;
    /** Geometry buffers uploaded to the GPU (bytes, from the arrays). */
    geometryBytes: number;
  };
  interaction: {
    /** Intervals between frames while the model was being turned (ms). */
    frameInterval: Summary;
    /** CPU time spent issuing each render (ms; GPU time is not observable from the page). */
    renderCpu: Summary;
    /** Tap → selection drawn (ms). */
    tapToHighlight: Summary;
  };
  memory: { jsHeapUsedMB: number | null; jsHeapLimitMB: number | null };
  contextLost: number;
}

export interface Summary {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  /** Share of samples over 50 ms (a visibly janky frame or slow tap response). */
  over50ms: number | null;
}

export function summarise(xs: number[]): Summary {
  if (!xs.length) return { n: 0, p50: null, p95: null, max: null, over50ms: null };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  const r = (v: number) => Math.round(v * 10) / 10;
  return { n: s.length, p50: r(at(0.5)), p95: r(at(0.95)), max: r(s[s.length - 1]), over50ms: Math.round((s.filter((x) => x > 50).length / s.length) * 1000) / 1000 };
}

/** Bounded sample buffer: keeps the most recent `cap` values so a long session cannot grow memory. */
export class Samples {
  private xs: number[] = [];
  constructor(private readonly cap = 600) {}
  add(v: number) {
    if (!Number.isFinite(v) || v < 0) return;
    this.xs.push(v);
    if (this.xs.length > this.cap) this.xs.shift();
  }
  summary(): Summary {
    return summarise(this.xs);
  }
}

export function deviceInfo(gl: WebGLRenderingContext | WebGL2RenderingContext | null): AtlasStats['device'] {
  let webglRenderer: string | null = null;
  let maxTextureSize: number | null = null;
  if (gl) {
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      webglRenderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null;
    } catch {
      /* some browsers block renderer details */
    }
  }
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return {
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio || 1,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    webglRenderer,
    maxTextureSize,
    saveData: c?.saveData ?? null,
    effectiveType: c?.effectiveType ?? null,
  };
}

export function memoryInfo(): AtlasStats['memory'] {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
  return m ? { jsHeapUsedMB: mb(m.usedJSHeapSize), jsHeapLimitMB: mb(m.jsHeapSizeLimit) } : { jsHeapUsedMB: null, jsHeapLimitMB: null };
}
