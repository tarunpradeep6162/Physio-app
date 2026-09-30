import type { PoseFrame, PoseProviderInfo } from '../types';
import { MP_VERSION, type PoseVariant } from './mediapipe';
import type { ProviderOptions } from './provider';
import type { WorkerRequest, WorkerResponse } from './pose.worker';

/**
 * Runs BlazePose in a Web Worker so inference never blocks the interface. The caller transfers an
 * ImageBitmap per frame and awaits the landmarks; `busy` is true while a frame is in flight so the
 * caller can drop stale frames instead of queueing them.
 */
export class WorkerPoseProvider {
  info: PoseProviderInfo;
  loadMs = 0;
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (f: PoseFrame) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private failed: ((e: Error) => void) | null = null;
  busy = false;

  constructor(private readonly variant: PoseVariant, private readonly opts: ProviderOptions) {
    this.info = { id: `mediapipe-${variant}`, model: `blazepose-ghum-${variant}`, version: `tasks-vision@${MP_VERSION}`, simulated: false };
  }

  static supported(): boolean {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
  }

  /** Called if the worker dies after init (e.g. out of memory) so the runtime can fall back. */
  onFailure(cb: (e: Error) => void) {
    this.failed = cb;
  }

  async init(timeoutMs = 30000): Promise<void> {
    const w = new Worker(new URL('./pose.worker.ts', import.meta.url));
    this.worker = w;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('pose worker init timeout')), timeoutMs);
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === 'ready') {
          clearTimeout(timer);
          this.loadMs = m.loadMs;
          this.info = { ...this.info, config: m.config };
          w.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
          resolve();
        } else if (m.type === 'error') {
          clearTimeout(timer);
          reject(new Error(m.message));
        }
      };
      w.onerror = (ev) => {
        clearTimeout(timer);
        reject(new Error(ev.message || 'pose worker failed to start'));
      };
      w.postMessage({ type: 'init', variant: this.variant, opts: this.opts, info: this.info } satisfies WorkerRequest);
    });
    w.onerror = (ev) => this.fail(new Error(ev.message || 'pose worker crashed'));
  }

  private onMessage(m: WorkerResponse) {
    if (m.type === 'result') {
      const p = this.pending.get(m.id);
      if (p) clearTimeout(p.timer);
      this.pending.delete(m.id);
      this.busy = this.pending.size > 0;
      p?.resolve(m.frame);
    } else if (m.type === 'error' && m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (p) clearTimeout(p.timer);
      this.pending.delete(m.id);
      this.busy = this.pending.size > 0;
      p?.reject(new Error(m.message));
    }
  }

  private fail(e: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
    this.busy = false;
    const callback = this.failed;
    this.failed = null;
    callback?.(e);
  }

  /** Transfers the bitmap (it is closed in the worker) and resolves with the pose frame. */
  submit(bitmap: ImageBitmap, ts: number, timeoutMs = 1500): Promise<PoseFrame> {
    if (!this.worker) {
      bitmap.close();
      return Promise.reject(new Error('pose worker not initialised'));
    }
    const id = this.nextId++;
    this.busy = true;
    return new Promise<PoseFrame>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('pose worker frame timeout')), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker!.postMessage({ type: 'frame', id, ts, bitmap } satisfies WorkerRequest, [bitmap]);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.busy = false;
        bitmap.close();
        const error = e instanceof Error ? e : new Error('pose worker frame transfer failed');
        reject(error);
        this.fail(error);
      }
    });
  }

  close() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('closed'));
    }
    this.pending.clear();
    this.busy = false;
    this.worker?.postMessage({ type: 'close' } satisfies WorkerRequest);
    // Terminate after a grace period in case the worker is stuck inside inference.
    const w = this.worker;
    setTimeout(() => w?.terminate(), 500);
    this.worker = null;
  }
}
