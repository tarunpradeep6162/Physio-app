import { closeCamera, openCamera } from '../camera/camera';
import { createPoseProvider, variantOf, type PoseProvider, type PoseProviderId } from '../engine/pose/provider';
import { WorkerPoseProvider } from '../engine/pose/workerProvider';
import { sustainedWindows, type SustainedSummary } from './sustained';

/**
 * Live camera benchmark: measures what the real-time loop actually delivers on this device —
 * camera frame rate, inference rate and latency, how stale each analysed frame is, how many
 * camera frames were skipped, and how long the main thread was blocked (UI jank).
 *
 * `loop: 'sync'` reproduces the app's original loop (inference inside the video-frame callback on
 * the main thread). Other loops are added as they are implemented so they are compared on the
 * same measurements.
 */

export interface LiveBenchOptions {
  provider: PoseProviderId;
  delegate?: 'GPU' | 'CPU';
  facing?: 'user' | 'environment';
  durationSec?: number;
  loop?: 'sync' | 'worker';
  constraints?: { width?: number; height?: number; frameRate?: number };
}

export interface LiveBenchResult {
  loop: string;
  provider: string;
  delegate: string | undefined;
  camera: { width: number; height: number; fps: number; label: string };
  inferenceFps: number;
  inferenceMs: { p50: number; p95: number; max: number };
  /** Age of the analysed frame when its landmarks became available (capture → result), ms. */
  resultAgeMs: { p50: number; p95: number } | null;
  skippedCameraFrames: number;
  presence: number;
  /** Main-thread blocking: longest gap between animation frames and total long-task time. */
  ui: { rafGapP95Ms: number; rafGapMaxMs: number; longTaskMsPerSec: number };
  loadMs: number;
  /** Per-window timings over the run (thermal / sustained-load slowdown). No frames are kept. */
  sustained: SustainedSummary;
  /** When and on what this ran (Phase 23 exit evidence). No personal data. */
  context: RunContext;
}

export interface RunContext {
  startedAt: string;
  endedAt: string;
  userAgent: string;
  platform: string;
  devicePixelRatio: number;
  hardwareConcurrency: number | null;
  /** GB, rounded by the browser (Chrome only). */
  deviceMemoryGB: number | null;
  /** Battery API where available (e.g. Chrome on Android); null elsewhere. */
  battery: { startLevel: number; endLevel: number; charging: boolean } | null;
  /** False if the page was hidden at any point (results not comparable). */
  visibleThroughout: boolean;
}

type BatteryLike = { level: number; charging: boolean };
async function battery(): Promise<BatteryLike | null> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    return nav.getBattery ? await nav.getBattery() : null;
  } catch {
    return null;
  }
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] * 10) / 10;
};

export async function runLiveBench(video: HTMLVideoElement, o: LiveBenchOptions): Promise<LiveBenchResult> {
  const duration = (o.durationSec ?? 10) * 1000;
  const startedAt = new Date().toISOString();
  const bat = await battery();
  const batStart = bat ? { level: bat.level, charging: bat.charging } : null;
  let visibleThroughout = document.visibilityState === 'visible';
  const onVis = () => {
    if (document.visibilityState !== 'visible') visibleThroughout = false;
  };
  document.addEventListener('visibilitychange', onVis);
  const stream = await openCamera(o.facing ?? 'user', video, o.constraints);
  const track = stream.getVideoTracks()[0];
  const t0Load = performance.now();
  const loop = o.loop ?? 'sync';
  const variant = variantOf(o.provider);
  let provider: PoseProvider | null = null;
  let worker: WorkerPoseProvider | null = null;
  if (loop === 'worker') {
    worker = new WorkerPoseProvider(variant, { delegate: o.delegate });
    await worker.init();
  } else {
    provider = await createPoseProvider(o.provider, { delegate: o.delegate });
    await provider.init();
  }
  const info = (worker ?? provider)!.info;
  const loadMs = performance.now() - t0Load;

  const inf: number[] = [];
  const timeline: { t: number; ms: number }[] = [];
  const ages: number[] = [];
  let processed = 0;
  let present = 0;
  let skipped = 0;
  let firstPresented: number | null = null;
  let lastPresented: number | null = null;
  // UI responsiveness probes.
  const gaps: number[] = [];
  let lastRaf = performance.now();
  let rafId = 0;
  const raf = () => {
    const now = performance.now();
    gaps.push(now - lastRaf);
    lastRaf = now;
    rafId = requestAnimationFrame(raf);
  };
  rafId = requestAnimationFrame(raf);
  let longTask = 0;
  let po: PerformanceObserver | null = null;
  try {
    po = new PerformanceObserver((l) => l.getEntries().forEach((e) => (longTask += e.duration)));
    po.observe({ type: 'longtask', buffered: false });
  } catch {
    po = null;
  }

  const start = performance.now();
  let done = false;
  let inflight = false;
  let lastMeta: VideoFrameCallbackMetadata | null = null;
  const analysed = (captured: number | null, inferenceMs: number, persons: number) => {
    const b = performance.now();
    inf.push(inferenceMs);
    timeline.push({ t: b - start, ms: inferenceMs });
    if (captured) ages.push(b - captured);
    processed++;
    if (persons) present++;
  };
  // Worker loop: at most one frame in flight; when a result returns and a newer frame exists, send it at once.
  const submit = async (meta: VideoFrameCallbackMetadata) => {
    inflight = true;
    const captured = meta.captureTime ?? meta.expectedDisplayTime ?? performance.now();
    try {
      const bmp = await createImageBitmap(video);
      const f = await worker!.submit(bmp, captured);
      if (!done) analysed(captured, f.inferenceMs, f.poses.length);
    } catch {
      /* counted as not analysed */
    }
    inflight = false;
    if (!done && lastMeta && lastMeta.presentedFrames > meta.presentedFrames) void submit(lastMeta);
  };
  await new Promise<void>((resolve) => {
    const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (performance.now() - start > duration) {
        done = true;
        return resolve();
      }
      firstPresented ??= meta.presentedFrames;
      lastPresented = meta.presentedFrames;
      lastMeta = meta;
      if (loop === 'worker') {
        if (!inflight) void submit(meta);
      } else {
        const captured = meta.captureTime ?? meta.expectedDisplayTime ?? null;
        const f = provider!.detect(video, captured ?? performance.now());
        analysed(captured, f.inferenceMs, f.poses.length);
      }
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
  });
  const elapsed = performance.now() - start;
  cancelAnimationFrame(rafId);
  po?.disconnect();
  const settings = track.getSettings();
  const presentedTotal = lastPresented !== null && firstPresented !== null ? lastPresented - firstPresented : 0;
  skipped = Math.max(0, presentedTotal - processed);
  provider?.close();
  worker?.close();
  closeCamera(stream);
  video.srcObject = null;
  document.removeEventListener('visibilitychange', onVis);
  const nav = navigator as Navigator & { deviceMemory?: number };
  const context: RunContext = {
    startedAt,
    endedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGB: nav.deviceMemory ?? null,
    battery: bat && batStart ? { startLevel: Math.round(batStart.level * 100) / 100, endLevel: Math.round(bat.level * 100) / 100, charging: batStart.charging || bat.charging } : null,
    visibleThroughout,
  };
  return {
    loop,
    provider: info.id,
    delegate: info.config?.delegate,
    camera: { width: settings.width ?? video.videoWidth, height: settings.height ?? video.videoHeight, fps: Math.round((presentedTotal / elapsed) * 10000) / 10, label: track.label },
    inferenceFps: Math.round((processed / elapsed) * 10000) / 10,
    inferenceMs: { p50: pct(inf, 0.5), p95: pct(inf, 0.95), max: pct(inf, 1) },
    resultAgeMs: ages.length ? { p50: pct(ages, 0.5), p95: pct(ages, 0.95) } : null,
    skippedCameraFrames: skipped,
    presence: Math.round((present / Math.max(1, processed)) * 1000) / 1000,
    ui: { rafGapP95Ms: pct(gaps, 0.95), rafGapMaxMs: pct(gaps, 1), longTaskMsPerSec: Math.round((longTask / elapsed) * 1000) },
    loadMs: Math.round(loadMs),
    sustained: sustainedWindows(timeline, elapsed),
    context,
  };
}
