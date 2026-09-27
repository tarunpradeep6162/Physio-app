import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterKind } from '../engine/filters';
import { MotionPipeline, type ProcessedFrame } from '../engine/pipeline';
import { createPoseProvider, type PoseProvider, type PoseProviderId } from '../engine/pose/provider';
import { CameraError, closeCamera, openCamera, type CameraErrorCode } from './camera';

/**
 * Runs the real-time loop:
 *
 *   camera frame → pose provider (on-device) → MotionPipeline (confidence + smoothing +
 *   orientation) → consumer callback (calibration / measurement / state machine / drawing)
 *
 * The loop runs outside React; the consumer draws directly to a canvas each frame and React
 * state is only updated a few times per second, so charts or other UI never slow the camera.
 */

export type RuntimeStatus = 'idle' | 'starting_camera' | 'loading_model' | 'running' | 'paused' | 'error';

export interface RuntimeStats {
  fps: number;
  inferenceMs: number;
  slow: boolean;
}

export interface FrameTiming {
  /** Camera capture time of the analysed frame (performance clock), when the browser reports it. */
  captureTs: number | null;
  /** Frames presented by the camera so far (requestVideoFrameCallback metadata). */
  presentedFrames: number | null;
  /** When inference started and when landmarks were available. */
  startedAt: number;
  finishedAt: number;
}

export interface FrameContext {
  video: HTMLVideoElement;
  now: number;
  stats: RuntimeStats;
  provider: PoseProvider;
  timing: FrameTiming;
}

export interface RuntimeOptions {
  providerId: PoseProviderId;
  facing: 'user' | 'environment';
  filter?: FilterKind;
  enabled?: boolean;
  onFrame: (frame: ProcessedFrame, ctx: FrameContext) => void;
  /** Called when the page is hidden / the app is backgrounded (interrupted session). */
  onInterrupted?: () => void;
}

const SLOW_FPS = 12;

export function useMotionRuntime(opts: RuntimeOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const providerRef = useRef<PoseProvider | null>(null);
  const pipelineRef = useRef<MotionPipeline>(new MotionPipeline(opts.filter ?? 'one_euro'));
  const onFrameRef = useRef(opts.onFrame);
  const onInterruptedRef = useRef(opts.onInterrupted);
  onFrameRef.current = opts.onFrame;
  onInterruptedRef.current = opts.onInterrupted;

  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [error, setError] = useState<CameraErrorCode | 'model' | null>(null);
  const [stats, setStats] = useState<RuntimeStats>({ fps: 0, inferenceMs: 0, slow: false });
  const [attempt, setAttempt] = useState(0);
  const statsRef = useRef<RuntimeStats>({ fps: 0, inferenceMs: 0, slow: false });
  const pausedRef = useRef(false);

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
    const video = videoRef.current;
    const simulated = opts.providerId === 'simulated';

    async function start() {
      if (!video) return;
      setError(null);
      try {
        if (!simulated) {
          setStatus('starting_camera');
          stream = await openCamera(opts.facing, video);
          if (cancelled) return;
        }
        setStatus('loading_model');
        const provider = await createPoseProvider(opts.providerId);
        await provider.init();
        if (cancelled) {
          provider.close();
          return;
        }
        providerRef.current = provider;
        pipelineRef.current.reset();
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
      if (useVfc && video) vfc = video.requestVideoFrameCallback((_n, meta) => tick(meta));
      else raf = requestAnimationFrame(() => tick(null));
    }

    function tick(meta: VideoFrameCallbackMetadata | null) {
      if (cancelled) return;
      const provider = providerRef.current;
      if (!provider || !video || pausedRef.current) return schedule();
      if (!simulated && (video.readyState < 2 || video.videoWidth === 0)) return schedule();
      const now = performance.now();
      let frame;
      try {
        frame = provider.detect(video, now);
      } catch {
        return schedule();
      }
      const processed = pipelineRef.current.process(frame);
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
      const timing: FrameTiming = {
        captureTs: meta ? (meta.captureTime ?? meta.expectedDisplayTime ?? null) : null,
        presentedFrames: meta ? meta.presentedFrames : null,
        startedAt: now,
        finishedAt: performance.now(),
      };
      onFrameRef.current(processed, { video, now, stats: statsRef.current, provider, timing });
      if (now - lastUi > 250) {
        lastUi = now;
        setStats({ ...statsRef.current });
      }
      schedule();
    }

    const onVisibility = () => {
      if (document.hidden) {
        pausedRef.current = true;
        onInterruptedRef.current?.();
      } else {
        pausedRef.current = false;
        pipelineRef.current.reset();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(raf);
      if (vfc && video && 'cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(vfc);
      closeCamera(stream);
      if (video) video.srcObject = null;
      providerRef.current?.close();
      providerRef.current = null;
    };
  }, [opts.providerId, opts.facing, opts.enabled, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
    setStatus((s) => (s === 'running' || s === 'paused' ? (p ? 'paused' : 'running') : s));
  }, []);

  return { videoRef, providerRef, pipeline: pipelineRef.current, status, error, stats, retry, setPaused };
}
