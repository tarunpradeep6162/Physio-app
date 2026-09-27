/// <reference lib="webworker" />
/**
 * Pose inference worker (classic worker: the MediaPipe WASM loader uses importScripts).
 * Receives transferred ImageBitmaps with their camera capture timestamp, runs BlazePose and
 * returns landmarks. The main thread keeps at most one frame in flight, so frames never queue.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { ProviderOptions } from './provider';
import { createLandmarker, detectWithSupport } from './mediapipe';
import type { PoseProviderInfo } from '../types';

export type WorkerRequest =
  | { type: 'init'; variant: 'lite' | 'full'; opts: ProviderOptions; info: PoseProviderInfo }
  | { type: 'frame'; id: number; ts: number; bitmap: ImageBitmap }
  | { type: 'close' };

export type WorkerResponse =
  | { type: 'ready'; config: NonNullable<PoseProviderInfo['config']>; loadMs: number }
  | { type: 'result'; id: number; frame: import('../types').PoseFrame }
  | { type: 'error'; id?: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let landmarker: PoseLandmarker | null = null;
let info: PoseProviderInfo | null = null;
let lastTs = -1;

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const r = await createLandmarker(m.variant, m.opts);
      landmarker = r.landmarker;
      info = { ...m.info, config: { ...r.config, thread: 'worker' } };
      ctx.postMessage({ type: 'ready', config: info.config!, loadMs: r.loadMs } satisfies WorkerResponse);
    } catch (err) {
      ctx.postMessage({ type: 'error', message: String(err) } satisfies WorkerResponse);
    }
    return;
  }
  if (m.type === 'frame') {
    const { bitmap } = m;
    try {
      if (!landmarker || !info) throw new Error('not initialised');
      const ts = m.ts <= lastTs ? lastTs + 1 : m.ts;
      lastTs = ts;
      const frame = detectWithSupport(landmarker, bitmap, ts, bitmap.width, bitmap.height, info);
      ctx.postMessage({ type: 'result', id: m.id, frame } satisfies WorkerResponse);
    } catch (err) {
      ctx.postMessage({ type: 'error', id: m.id, message: String(err) } satisfies WorkerResponse);
    } finally {
      bitmap.close();
    }
    return;
  }
  if (m.type === 'close') {
    landmarker?.close();
    landmarker = null;
    ctx.close();
  }
};
