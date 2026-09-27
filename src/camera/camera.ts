/** Camera access with explicit, user-facing error classification. */

export type CameraErrorCode = 'permission' | 'not_found' | 'in_use' | 'insecure' | 'unsupported' | 'unknown';

export class CameraError extends Error {
  constructor(public code: CameraErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface CameraConstraints {
  width?: number;
  height?: number;
  frameRate?: number;
}

export async function openCamera(facing: 'user' | 'environment', video: HTMLVideoElement, c: CameraConstraints = {}): Promise<MediaStream> {
  if (typeof window !== 'undefined' && !window.isSecureContext) throw new CameraError('insecure');
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError('unsupported');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        // 720p is a good balance of landmark precision and inference cost on phones.
        width: { ideal: c.width ?? 1280 },
        height: { ideal: c.height ?? 720 },
        frameRate: { ideal: c.frameRate ?? 30, max: 30 },
      },
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('permission');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('not_found');
    if (name === 'NotReadableError' || name === 'AbortError') throw new CameraError('in_use');
    throw new CameraError('unknown', String(e));
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => undefined);
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }));
  }
  return stream;
}

export function closeCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Samples mean luma / clipping from a downscaled frame (cheap: 32×24 px). */
export class LightingSampler {
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(32, 24) : Object.assign(document.createElement('canvas'), { width: 32, height: 24 });
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  }
  sample(video: HTMLVideoElement): Uint8ClampedArray | null {
    if (!this.ctx || video.readyState < 2) return null;
    this.ctx.drawImage(video, 0, 0, 32, 24);
    return this.ctx.getImageData(0, 0, 32, 24).data;
  }
}

/** Captures a small JPEG still — only called when the patient granted image_storage consent. */
export function captureStill(video: HTMLVideoElement, maxWidth = 360): string | null {
  if (video.readyState < 2) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale);
  c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d')?.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
