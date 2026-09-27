import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerPoseProvider } from './workerProvider';

class FakeWorker {
  static instance: FakeWorker;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() { FakeWorker.instance = this; }
  postMessage(message: { type: string }) {
    if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', loadMs: 1, config: { delegate: 'CPU' } } } as MessageEvent));
  }
  terminate() {}
}

describe('pose worker frame timeout', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('rejects a stalled frame and invokes fallback only once', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const provider = new WorkerPoseProvider('lite', { delegate: 'CPU' });
    await provider.init();
    vi.useFakeTimers();
    const failed = vi.fn();
    provider.onFailure(failed);
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const result = provider.submit(bitmap, 10, 100);
    const rejected = expect(result).rejects.toThrow('pose worker frame timeout');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(failed).toHaveBeenCalledTimes(1);
    expect(provider.busy).toBe(false);
    provider.close();
  });
});
