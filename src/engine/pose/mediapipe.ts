import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PoseFrame, PoseProviderInfo } from '../types';
import type { PoseProvider, ProviderOptions } from './provider';

/**
 * MediaPipe Pose Landmarker (BlazePose GHUM, 33 landmarks) running fully on-device via WASM
 * (+ WebGL/GPU delegate where available). Raw video never leaves the browser.
 *
 * Assets are served from our own origin (`/pose/…`, prepared by scripts/prepare-pose-assets.mjs)
 * with the official CDN as fallback.
 */

const MP_VERSION = '1.0.1';
const LOCAL_WASM = `${import.meta.env.BASE_URL}pose/wasm`;
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODELS = {
  lite: {
    local: `${import.meta.env.BASE_URL}pose/models/pose_landmarker_lite.task`,
    cdn: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  },
  full: {
    local: `${import.meta.env.BASE_URL}pose/models/pose_landmarker_full.task`,
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
  readonly info: PoseProviderInfo;
  private landmarker: PoseLandmarker | null = null;
  private lastTs = -1;

  constructor(private readonly variant: 'lite' | 'full', private readonly opts: ProviderOptions) {
    this.info = { id: `mediapipe-${variant}`, model: `blazepose-ghum-${variant}`, version: `tasks-vision@${MP_VERSION}`, simulated: false };
  }

  async init(): Promise<void> {
    if (this.landmarker) return;
    const wasmBase = (await reachable(`${LOCAL_WASM}/vision_wasm_internal.js`)) ? LOCAL_WASM : CDN_WASM;
    const model = MODELS[this.variant];
    const modelPath = (await reachable(model.local)) ? model.local : model.cdn;
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        numPoses: this.opts.maxPoses ?? 2,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    try {
      this.landmarker = await make(this.opts.delegate ?? 'GPU');
    } catch {
      // Some devices/browsers lack WebGL2 — fall back to CPU inference.
      this.landmarker = await make('CPU');
    }
  }

  detect(source: HTMLVideoElement, timestamp: number): PoseFrame {
    if (!this.landmarker) throw new Error('Pose provider not initialised');
    // MediaPipe requires strictly increasing timestamps.
    const ts = timestamp <= this.lastTs ? this.lastTs + 1 : timestamp;
    this.lastTs = ts;
    const t0 = performance.now();
    const res = this.landmarker.detectForVideo(source, ts);
    const inferenceMs = performance.now() - t0;
    return {
      timestamp: ts,
      width: source.videoWidth,
      height: source.videoHeight,
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
