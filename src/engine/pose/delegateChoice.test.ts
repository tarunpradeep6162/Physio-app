import { describe, expect, it } from 'vitest';
import { DelegateProbe, initialDelegate, isSoftwareRenderer, PROBE_FRAMES, PROBE_WARMUP } from './delegateChoice';

const feed = (p: DelegateProbe, ms: number) => {
  let r: ReturnType<DelegateProbe['add']> = { action: 'measuring' };
  for (let i = 0; i < PROBE_WARMUP + PROBE_FRAMES; i++) r = p.add(ms);
  return r;
};

describe('delegate choice', () => {
  it('starts on CPU for software WebGL and on GPU otherwise', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(initialDelegate('ANGLE (Qualcomm, Adreno (TM) 640, OpenGL ES 3.2)')).toBe('GPU');
    expect(initialDelegate(null)).toBe('CPU');
  });
  it('keeps a fast GPU without trying CPU', () => {
    const p = new DelegateProbe('GPU');
    expect(feed(p, 25)).toEqual({ action: 'done', delegate: 'GPU' });
  });
  it('switches from a slow GPU to a faster CPU and records both timings', () => {
    const p = new DelegateProbe('GPU');
    expect(feed(p, 650)).toEqual({ action: 'switch', to: 'CPU' });
    expect(feed(p, 60)).toEqual({ action: 'done', delegate: 'CPU' });
    expect(p.measured).toEqual({ GPU: 650, CPU: 60 });
  });
  it('goes back to GPU when CPU turns out slower still', () => {
    const p = new DelegateProbe('GPU');
    feed(p, 90);
    expect(feed(p, 200)).toEqual({ action: 'switch', to: 'GPU' });
    expect(feed(p, 90)).toEqual({ action: 'done', delegate: 'GPU' });
  });
});
