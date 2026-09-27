import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, PoseProviderInfo } from '../types';
import { sourceSize, type PoseProvider, type PoseSource, type ProviderOptions } from './provider';

/**
 * MediaPipe Pose Landmarker (BlazePose GHUM, 33 landmarks) running fully on-device via WASM
 * (+ WebGL/GPU delegate where available). Raw video never leaves the browser.
 *
 * Assets are served from our own origin (`/pose/…`, prepared by scripts/prepare-pose-assets.mjs)
 * with the official CDN as fallback. Works on the main thread and inside a Web Worker.
 */

export const MP_VERSION = '1.0.1';
const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const LOCAL_WASM = `${BASE}pose/wasm`;
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
export const POSE_MODELS = {
  lite: {
    local: `${BASE}pose/models/pose_landmarker_lite.task`,
    cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  },
  full: {
    local: `${BASE}pose/models/pose_landmarker_full.task`,
    cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  },
};

async function reachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export class MediaPipePoseProvider implements PoseProvider {
  info: PoseProviderInfo;
  private landmarker: PoseLandmarker | null = null;
  private lastTs = -1;
  /** Wall time spent loading runtime + model (ms), for benchmarking. */
  loadMs = 0;

  constructor(private readonly variant: 'lite' | 'full', private readonly opts: ProviderOptions) {
    this.info = { id: `mediapipe-${variant}`, model: `blazepose-ghum-${variant}`, version: `tasks-vision@${MP_VERSION}`, simulated: false };
  }

  async init(): Promise<void> {
    if (this.landmarker) return;
    const t0 = performance.now();
    const wasmBase = (await reachable(`${LOCAL_WASM}/vision_wasm_internal.js`)) ? LOCAL_WASM : CDN_WASM;
    const model = POSE_MODELS[this.variant];
    const modelPath = (await reachable(model.local)) ? model.local : model.cdn;
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    const o = this.opts;
    const thresholds = {
      minPoseDetectionConfidence: o.minPoseDetectionConfidence ?? 0.5,
      minPosePresenceConfidence: o.minPosePresenceConfidence ?? 0.5,
      minTrackingConfidence: o.minTrackingConfidence ?? 0.5,
    };
    const numPoses = o.maxPoses ?? 2;
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        numPoses,
        ...thresholds,
        outputSegmentationMasks: false,
      });
    let delegate: 'GPU' | 'CPU' = o.delegate ?? 'GPU';
    try {
      this.landmarker = await make(delegate);
    } catch {
      // Some devices/browsers lack WebGL2 (or OffscreenCanvas in a worker) — fall back to CPU.
      delegate = 'CPU';
      this.landmarker = await make('CPU');
    }
    this.info = {
      ...this.info,
      config: {
        ...this.info.config,
        delegate,
        numPoses,
        minDetection: thresholds.minPoseDetectionConfidence,
        minPresence: thresholds.minPosePresenceConfidence,
        minTracking: thresholds.minTrackingConfidence,
      },
    };
    this.loadMs = performance.now() - t0;
  }

  detect(source: PoseSource, timestamp: number): PoseFrame {
    if (!this.landmarker) throw new Error('Pose provider not initialised');
    // MediaPipe requires strictly increasing timestamps.
    const ts = timestamp <= this.lastTs ? this.lastTs + 1 : timestamp;
    this.lastTs = ts;
    const { width, height } = sourceSize(source);
    const t0 = performance.now();
    const res = this.landmarker.detectForVideo(source, ts);
    const inferenceMs = performance.now() - t0;
    return {
      timestamp: ts,
      width,
      height,
      poses: res.landmarks.map((pose) => pose.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0 }))),
      worldLandmarks: res.worldLandmarks[0]?.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0 })),
      inferenceMs,
      provider: this.info,
    };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
