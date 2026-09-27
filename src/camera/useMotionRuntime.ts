import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterKind } from '../engine/filters';
import { MotionPipeline, type ProcessedFrame } from '../engine/pipeline';
import { createPoseProvider, type PoseProvider, type PoseProviderId } from '../engine/pose/provider';
import { WorkerPoseProvider } from '../engine/pose/workerProvider';
import type { PoseFrame } from '../engine/types';
import { CameraError, closeCamera, openCamera, type CameraConstraints, type CameraErrorCode } from './camera';

/**
 * Runs the real-time loop:
 *
 *   camera frame → pose provider (on-device) → MotionPipeline (confidence + smoothing +
 *   orientation) → consumer callback (calibration / measurement / state machine / drawing)
 *
 * Inference runs in a Web Worker when the browser supports it (ImageBitmap transfer, at most one
 * frame in flight, newest frame sent as soon as the worker is free), so the interface never
 * blocks. Otherwise — or if the worker fails — inference runs synchronously on the main thread
 * (measured fallback). Frames are timestamped with their CAMERA CAPTURE time so landmarks, angles
 * and the drawn skeleton all refer to the same moment.
 */

export type RuntimeStatus = 'idle' | 'starting_camera' | 'loading_model' | 'running' | 'paused' | 'error';

export interface RuntimeStats {
  fps: number;
  inferenceMs: number;
  slow: boolean;
  /** Where inference runs, and why the worker is not used (if it is not). */
  thread: 'worker' | 'main' | null;
  fallbackReason: string | null;
}

export interface FrameTiming {
  /** Camera capture time of the analysed frame (performance clock), when the browser reports it. */
  captureTs: number | null;
  /** Frames presented by the camera so far (requestVideoFrameCallback metadata). */
  presentedFrames: number | null;
  /** When inference was requested and when landmarks were available. */
  startedAt: number;
  finishedAt: number;
}

export type RuntimeProvider = PoseProvider | WorkerPoseProvider;

export interface FrameContext {
  video: HTMLVideoElement;
  now: number;
  stats: RuntimeStats;
  provider: RuntimeProvider;
  timing: FrameTiming;
}

export interface RuntimeOptions {
  providerId: PoseProviderId;
  facing: 'user' | 'environment';
  filter?: FilterKind;
  enabled?: boolean;
  /** 'auto' (default): worker when supported, main thread otherwise. */
  thread?: 'auto' | 'worker' | 'main';
  delegate?: 'GPU' | 'CPU';
  constraints?: CameraConstraints;
  onFrame: (frame: ProcessedFrame, ctx: FrameContext) => void;
  /** Called when the page is hidden / the app is backgrounded (interrupted session). */
  onInterrupted?: () => void;
}

const SLOW_FPS = 12;

export function useMotionRuntime(opts: RuntimeOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const providerRef = useRef<RuntimeProvider | null>(null);
  const pipelineRef = useRef<MotionPipeline>(new MotionPipeline(opts.filter ?? 'one_euro'));
  const onFrameRef = useRef(opts.onFrame);
  const onInterruptedRef = useRef(opts.onInterrupted);
  onFrameRef.current = opts.onFrame;
  onInterruptedRef.current = opts.onInterrupted;

  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [error, setError] = useState<CameraErrorCode | 'model' | null>(null);
  const initialStats: RuntimeStats = { fps: 0, inferenceMs: 0, slow: false, thread: null, fallbackReason: null };
  const [stats, setStats] = useState<RuntimeStats>(initialStats);
  const [attempt, setAttempt] = useState(0);
  const statsRef = useRef<RuntimeStats>({ ...initialStats });
  const pausedRef = useRef(false);
  const epochRef = useRef(0);

  useEffect(() => {
    if (opts.filter) pipelineRef.current.setFilter(opts.filter);
  }, [opts.filter]);

  useEffect(() => {
    if (opts.enabled === false) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let vfc = 0;
    let lastFrameT = 0;
    let slowSince: number | null = null;
    let lastUi = 0;
    let inflight = false;
    let lastMeta: VideoFrameCallbackMetadata | null = null;
    const video = videoRef.current;
    const simulated = opts.providerId === 'simulated';
    const variant = opts.providerId === 'mediapipe-full' ? 'full' : 'lite';
    statsRef.current = { ...initialStats };

    async function startMain(reason: string | null) {
      const provider = await createPoseProvider(opts.providerId, { delegate: opts.delegate });
      await provider.init();
      if (cancelled) {
        provider.close();
        return;
      }
      providerRef.current = provider;
      statsRef.current.thread = simulated ? null : 'main';
      statsRef.current.fallbackReason = reason;
    }

    async function startWorker() {
      const wp = new WorkerPoseProvider(variant, { delegate: opts.delegate });
      await wp.init();
      if (cancelled) {
        wp.close();
        return;
      }
      wp.onFailure((e) => {
        // The worker died mid-session: continue on the main thread and say so.
        if (cancelled) return;
        wp.close();
        providerRef.current = null;
        inflight = false;
        pipelineRef.current.reset();
        startMain(`worker failed: ${e.message}`).catch(() => {
          setError('model');
          setStatus('error');
        });
      });
      providerRef.current = wp;
      statsRef.current.thread = 'worker';
      statsRef.current.fallbackReason = null;
    }

    async function start() {
      if (!video) return;
      setError(null);
      try {
        if (!simulated) {
          setStatus('starting_camera');
          stream = await openCamera(opts.facing, video, opts.constraints);
          if (cancelled) return;
        }
        setStatus('loading_model');
        const want = opts.thread ?? 'auto';
        if (!simulated && want !== 'main' && WorkerPoseProvider.supported()) {
          try {
            await startWorker();
          } catch (e) {
            if (cancelled) return;
            await startMain(`worker unavailable: ${(e as Error).message}`);
          }
        } else {
          await startMain(simulated ? null : want === 'main' ? 'main thread requested' : 'worker not supported by this browser');
        }
        if (cancelled) return;
        pipelineRef.current.reset();
        setStats({ ...statsRef.current });
        setStatus('running');
        schedule();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof CameraError ? e.code : 'model');
        setStatus('error');
      }
    }

    const useVfc = !simulated && video && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    function schedule() {
      if (cancelled) return;
      if (useVfc && video) vfc = video.requestVideoFrameCallback((_n, meta) => onVideoFrame(meta));
      else raf = requestAnimationFrame(() => onVideoFrame(null));
    }

    function deliver(frame: PoseFrame, timing: FrameTiming) {
      const provider = providerRef.current;
      if (!provider || !video) return;
      const processed = pipelineRef.current.process(frame);
      const now = timing.finishedAt;
      // FPS / latency (exponential averages).
      if (lastFrameT) {
        const inst = 1000 / Math.max(1, now - lastFrameT);
        statsRef.current.fps = statsRef.current.fps ? statsRef.current.fps * 0.9 + inst * 0.1 : inst;
      }
      lastFrameT = now;
      statsRef.current.inferenceMs = statsRef.current.inferenceMs ? statsRef.current.inferenceMs * 0.9 + frame.inferenceMs * 0.1 : frame.inferenceMs;
      if (statsRef.current.fps && statsRef.current.fps < SLOW_FPS) {
        slowSince ??= now;
        statsRef.current.slow = now - slowSince > 3000;
      } else {
        slowSince = null;
        statsRef.current.slow = false;
      }
      onFrameRef.current(processed, { video, now, stats: statsRef.current, provider, timing });
      if (now - lastUi > 250) {
        lastUi = now;
        setStats({ ...statsRef.current });
      }
    }

    async function submitToWorker(wp: WorkerPoseProvider, meta: VideoFrameCallbackMetadata) {
      if (!video) return;
      inflight = true;
      const epoch = epochRef.current;
      const captureTs = meta.captureTime ?? meta.expectedDisplayTime ?? performance.now();
      const startedAt = performance.now();
      let frame: PoseFrame;
      try {
        const bmp = await createImageBitmap(video);
        if (cancelled || providerRef.current !== wp) {
          bmp.close();
          inflight = false;
          return;
        }
        frame = await wp.submit(bmp, captureTs);
      } catch {
        inflight = false;
        return;
      }
      inflight = false;
      // Drop results that belong to a session state that has since been reset.
      if (cancelled || epoch !== epochRef.current || providerRef.current !== wp) return;
      deliver(frame, { captureTs, presentedFrames: meta.presentedFrames, startedAt, finishedAt: performance.now() });
      // A newer camera frame arrived while we were busy: analyse it now rather than waiting.
      if (!pausedRef.current && lastMeta && lastMeta.presentedFrames > meta.presentedFrames && providerRef.current === wp) void submitToWorker(wp, lastMeta);
    }

    function onVideoFrame(meta: VideoFrameCallbackMetadata | null) {
      if (cancelled) return;
      const provider = providerRef.current;
      if (meta) lastMeta = meta;
      if (!provider || !video || pausedRef.current) return schedule();
      if (!simulated && (video.readyState < 2 || video.videoWidth === 0)) return schedule();
      if (provider instanceof WorkerPoseProvider) {
        if (!inflight && meta) void submitToWorker(provider, meta);
        return schedule();
      }
      const startedAt = performance.now();
      const captureTs = meta ? (meta.captureTime ?? meta.expectedDisplayTime ?? null) : null;
      let frame: PoseFrame;
      try {
        frame = provider.detect(video, captureTs ?? startedAt);
      } catch {
        return schedule();
      }
      deliver(frame, { captureTs, presentedFrames: meta ? meta.presentedFrames : null, startedAt, finishedAt: performance.now() });
      schedule();
    }

    const onVisibility = () => {
      if (document.hidden) {
        pausedRef.current = true;
        onInterruptedRef.current?.();
      } else {
        pausedRef.current = false;
        epochRef.current++;
        pipelineRef.current.reset();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      cancelled = true;
      epochRef.current++;
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(raf);
      if (vfc && video && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(vfc);
      closeCamera(stream);
      if (video) video.srcObject = null;
      providerRef.current?.close();
      providerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.providerId, opts.facing, opts.enabled, opts.thread, opts.delegate, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
    if (!p) epochRef.current++;
    setStatus((s) => (s === 'running' || s === 'paused' ? (p ? 'paused' : 'running') : s));
  }, []);

  return { videoRef, providerRef, pipeline: pipelineRef.current, status, error, stats, retry, setPaused };
}
