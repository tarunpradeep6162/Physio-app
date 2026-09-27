import { createPoseProvider, type PoseProviderId } from '../engine/pose/provider';
import type { FilterKind } from '../engine/filters';
import { runLiveBench, type LiveBenchResult } from './liveBench';
import { summarize, type RunSummary } from './metrics';
import { renderFrame } from '../camera/mannequin';
import { groundTruthAt, runScenario, type FrameRecord } from './runner';
import { SCENARIOS } from './scenarios';

/**
 * PhysioVision tracking lab (engineering / validation tool).
 *
 * Runs rendered, ground-truth test sequences through the real on-device pose model and the app's
 * pipeline, and benchmarks the live camera loop. Open /lab.html on the device to be measured.
 * Query parameters allow unattended runs: ?auto=scenarios|live&model=lite&delegate=CPU&only=a,b
 */

interface LabEnv {
  userAgent: string;
  platform: string;
  cores: number | null;
  memoryGb: number | null;
  webgl: string | null;
  crossOriginIsolated: boolean;
  offscreenCanvas: boolean;
}

export interface ScenarioResult {
  id: string;
  title: string;
  failure: string;
  deliveredFps: number;
  summary: RunSummary;
  records?: FrameRecord[];
}

export interface LabReport {
  kind: 'physiovision-tracking-lab';
  version: 1;
  source: 'synthetic_rendered';
  createdAt: string;
  env: LabEnv;
  config: { model: PoseProviderId; delegate: string | undefined; coordFilter: FilterKind; angleFilter: FilterKind; loadMs: number; thresholds?: Record<string, number | boolean | undefined>; resolution?: string };
  scenarios: ScenarioResult[];
  live?: LiveBenchResult[];
}

declare global {
  interface Window {
    __LAB__?: { done: boolean; report?: LabReport; error?: string };
  }
}

function env(): LabEnv {
  let webgl: string | null = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      webgl = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    }
  } catch {
    webgl = null;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    webgl,
    crossOriginIsolated: self.crossOriginIsolated,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

/** Optional overrides from the URL: model thresholds (det/pres/trk) and frame resolution (res=WxH). */
function labOverrides() {
  const num = (k: string) => (params.get(k) === null ? undefined : Number(params.get(k)));
  const res = params.get('res')?.split('x').map(Number);
  return {
    thresholds: { minPoseDetectionConfidence: num('det'), minPosePresenceConfidence: num('pres'), minTrackingConfidence: num('trk'), segmentation: params.get('seg') === '1' },
    res: res && res.length === 2 ? { w: res[0], h: res[1] } : null,
  };
}

async function runScenarios(model: PoseProviderId, delegate: 'GPU' | 'CPU' | undefined, coordFilter: FilterKind, angleFilter: FilterKind, only: string[] | null, keep: boolean): Promise<LabReport> {
  const canvas = $<HTMLCanvasElement>('stage');
  const ov = labOverrides();
  if (ov.res) {
    canvas.width = ov.res.w;
    canvas.height = ov.res.h;
  }
  const results: ScenarioResult[] = [];
  let loadMs = 0;
  let usedDelegate: string | undefined;
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.id)) continue;
    $('status').textContent = `Running ${sc.id}…`;
    // Fresh model per scenario: no tracking state carries over between sequences.
    const t0 = performance.now();
    const provider = await createPoseProvider(model, { delegate, ...ov.thresholds });
    await provider.init();
    loadMs = Math.max(loadMs, performance.now() - t0);
    usedDelegate = provider.info.config?.delegate;
    const recs = await runScenario(sc, provider, canvas, { coordFilter, angleFilter, keepLandmarks: keep });
    provider.close();
    const summary = summarize(recs, (t) => groundTruthAt(sc, t / 1000, canvas.width, canvas.height));
    results.push({ id: sc.id, title: sc.title, failure: sc.failure, deliveredFps: sc.cameraFps / (sc.processEvery ?? 1), summary, records: keep ? recs : undefined });
    renderTable(results);
  }
  return {
    kind: 'physiovision-tracking-lab',
    version: 1,
    source: 'synthetic_rendered',
    createdAt: new Date().toISOString(),
    env: env(),
    config: { model, delegate: usedDelegate, coordFilter, angleFilter, loadMs: Math.round(loadMs), thresholds: ov.thresholds, resolution: `${canvas.width}x${canvas.height}` },
    scenarios: results,
  };
}

const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '–' : v.toFixed(d));

function renderTable(rows: ScenarioResult[]) {
  const head = ['Scenario', 'Failure mode', 'fps', 'infer p50 ms', 'presence', 'dropout', 'invalid', 'UNSAFE', 'hidden→confident', 'jitter raw/final °', 'lag raw/final ms', 'peak err final °', 'reacquire s', 'reasons'];
  $('results').innerHTML = `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => {
      const s = r.summary;
      return `<tr><td>${r.id}</td><td>${r.failure}</td><td>${r.deliveredFps}</td><td>${fmt(s.inference.p50Ms)}</td><td>${fmt(s.presence, 2)}</td><td>${fmt(s.dropout, 2)}</td><td>${fmt(s.invalidRate, 2)}</td><td class="${s.unsafeValues ? 'bad' : ''}">${s.unsafeValues}</td><td>${s.hiddenButConfident}/${s.hiddenFrames}</td><td>${fmt(s.raw.jitterSd, 2)} / ${fmt(s.final.jitterSd, 2)}</td><td>${fmt(s.raw.lagMs, 0)} / ${fmt(s.final.lagMs, 0)}</td><td>${fmt(s.final.peakError)}</td><td>${fmt(s.reacquireSec, 2)}</td><td class="small">${Object.entries(s.reasons).map(([k, v]) => `${k}:${v}`).join(' ')}</td></tr>`;
    })
    .join('')}</tbody></table>`;
}

function download(name: string, data: unknown) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  a.download = name;
  a.click();
}

async function main() {
  $('env').textContent = JSON.stringify(env(), null, 1);
  const preview = $<HTMLCanvasElement>('stage');
  renderFrame(preview.getContext('2d')!, [], {});
  window.__LAB__ = { done: false };
  let last: LabReport | null = null;
  const cfg = () => ({
    model: $<HTMLSelectElement>('model').value as PoseProviderId,
    delegate: ($<HTMLSelectElement>('delegate').value || undefined) as 'GPU' | 'CPU' | undefined,
    coord: $<HTMLSelectElement>('coord').value as FilterKind,
    angle: $<HTMLSelectElement>('angle').value as FilterKind,
  });
  for (const k of ['model', 'delegate', 'coord', 'angle'] as const) {
    const v = params.get(k === 'coord' ? 'coordFilter' : k === 'angle' ? 'angleFilter' : k);
    if (v !== null) $<HTMLSelectElement>(k).value = v;
  }
  $('run').addEventListener('click', async () => {
    const c = cfg();
    last = await runScenarios(c.model, c.delegate, c.coord, c.angle, null, false);
    $('status').textContent = 'Done.';
  });
  $('live').addEventListener('click', async () => {
    const c = cfg();
    $('status').textContent = 'Live camera benchmark (10 s)…';
    const r = await runLiveBench($<HTMLVideoElement>('video'), { provider: c.model, delegate: c.delegate, durationSec: 10 });
    $('liveOut').textContent = JSON.stringify(r, null, 1);
    last = last ?? ({ kind: 'physiovision-tracking-lab', version: 1, source: 'synthetic_rendered', createdAt: new Date().toISOString(), env: env(), config: { model: c.model, delegate: r.delegate, coordFilter: c.coord, angleFilter: c.angle, loadMs: r.loadMs }, scenarios: [] } as LabReport);
    last.live = [...(last.live ?? []), r];
    $('status').textContent = 'Done.';
  });
  $('save').addEventListener('click', () => last && download(`tracking-lab-${Date.now()}.json`, last));

  // ?make=y4m&scene=<id>&w=360&h=640 — renders a scenario as I420 frames for a fake-camera clip.
  // Frames are handed to window.__pushFrame (provided by the benchmark harness); nothing is uploaded.
  if (params.get('make') === 'y4m') {
    const { rgbaToI420 } = await import('./y4m');
    const sc = SCENARIOS.find((x) => x.id === params.get('scene'))!;
    const w = Number(params.get('w') ?? 360);
    const h = Number(params.get('h') ?? 640);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const push = (window as unknown as { __pushFrame: (b64: string) => Promise<void> }).__pushFrame;
    const n = Math.round(sc.durationSec * sc.cameraFps);
    for (let i = 0; i < n; i++) {
      const f = sc.frame(i / sc.cameraFps);
      renderFrame(g, f.figures, { ...f.render, seed: i + 1 });
      const yuv = rgbaToI420(g.getImageData(0, 0, w, h).data, w, h);
      let bin = '';
      for (let k = 0; k < yuv.length; k += 0x8000) bin += String.fromCharCode(...yuv.subarray(k, k + 0x8000));
      await push(btoa(bin));
    }
    window.__LAB__ = { done: true };
    return;
  }

  const auto = params.get('auto');
  if (auto) {
    try {
      const c = cfg();
      const only = params.get('only')?.split(',') ?? null;
      if (auto === 'scenarios') last = await runScenarios(c.model, c.delegate, c.coord, c.angle, only, params.get('keep') === '1');
      if (auto === 'live') {
        const loops = (params.get('loops') ?? 'sync').split(',') as ('sync' | 'worker')[];
        const live: LiveBenchResult[] = [];
        for (const loop of loops) live.push(await runLiveBench($<HTMLVideoElement>('video'), { provider: c.model, delegate: c.delegate, loop, durationSec: Number(params.get('sec') ?? 10), constraints: params.get('w') ? { width: Number(params.get('w')), height: Number(params.get('h')) } : undefined }));
        last = { kind: 'physiovision-tracking-lab', version: 1, source: 'synthetic_rendered', createdAt: new Date().toISOString(), env: env(), config: { model: c.model, delegate: live[0]?.delegate, coordFilter: c.coord, angleFilter: c.angle, loadMs: live[0]?.loadMs ?? 0 }, scenarios: [], live };
      }
      window.__LAB__ = { done: true, report: last ?? undefined };
    } catch (e) {
      window.__LAB__ = { done: true, error: String(e) };
    }
  }
}

main();
