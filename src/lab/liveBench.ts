import { closeCamera, openCamera } from '../camera/camera';
import { createPoseProvider, type PoseProviderId } from '../engine/pose/provider';

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
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] * 10) / 10;
};

export async function runLiveBench(video: HTMLVideoElement, o: LiveBenchOptions): Promise<LiveBenchResult> {
  const duration = (o.durationSec ?? 10) * 1000;
  const stream = await openCamera(o.facing ?? 'user', video, o.constraints);
  const track = stream.getVideoTracks()[0];
  const t0Load = performance.now();
  const provider = await createPoseProvider(o.provider, { delegate: o.delegate });
  await provider.init();
  const loadMs = performance.now() - t0Load;

  const inf: number[] = [];
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
  await new Promise<void>((resolve) => {
    const tick = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (performance.now() - start > duration) return resolve();
      firstPresented ??= meta.presentedFrames;
      if (lastPresented !== null && meta.presentedFrames - lastPresented > 1) skipped += meta.presentedFrames - lastPresented - 1;
      lastPresented = meta.presentedFrames;
      const captured = meta.captureTime ?? meta.expectedDisplayTime;
      const a = performance.now();
      const f = provider.detect(video, a);
      const b = performance.now();
      inf.push(b - a);
      if (captured) ages.push(b - captured);
      processed++;
      if (f.poses.length) present++;
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
  });
  const elapsed = performance.now() - start;
  cancelAnimationFrame(rafId);
  po?.disconnect();
  const settings = track.getSettings();
  const presentedTotal = lastPresented !== null && firstPresented !== null ? lastPresented - firstPresented : 0;
  provider.close();
  closeCamera(stream);
  video.srcObject = null;
  return {
    loop: o.loop ?? 'sync',
    provider: provider.info.id,
    delegate: provider.info.config?.delegate,
    camera: { width: settings.width ?? video.videoWidth, height: settings.height ?? video.videoHeight, fps: Math.round((presentedTotal / elapsed) * 10000) / 10, label: track.label },
    inferenceFps: Math.round((processed / elapsed) * 10000) / 10,
    inferenceMs: { p50: pct(inf, 0.5), p95: pct(inf, 0.95), max: pct(inf, 1) },
    resultAgeMs: ages.length ? { p50: pct(ages, 0.5), p95: pct(ages, 0.95) } : null,
    skippedCameraFrames: skipped,
    presence: Math.round((present / Math.max(1, processed)) * 1000) / 1000,
    ui: { rafGapP95Ms: pct(gaps, 0.95), rafGapMaxMs: pct(gaps, 1), longTaskMsPerSec: Math.round((longTask / elapsed) * 1000) },
    loadMs: Math.round(loadMs),
  };
}
