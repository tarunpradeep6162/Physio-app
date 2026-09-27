import { describe, expect, it } from 'vitest';
import { CoverageDetector, PatchMotion, type Gray } from './appearance';
import { LM } from './landmarks';
import { estimate } from './measurements';
import { MotionPipeline } from './pipeline';
import { synthesize } from './pose/synthetic';
import { SIM_PROVIDER } from './protocols/simulate';
import type { Landmark } from './types';

const W = 160;
const H = 284;
/** Thumbnail with a bright 8×8 "joint" at (jx, jy) on a mid-grey background, optional static block, noise. */
function thumb(jx: number, jy: number, block: { x: number; y: number; w: number; h: number } | null, seed: number): Gray {
  const data = new Uint8Array(W * H);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 4 - 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = 100 + rnd();
  for (let y = jy - 4; y < jy + 4; y++) for (let x = jx - 4; x < jx + 4; x++) if (x >= 0 && y >= 0 && x < W && y < H) data[y * W + x] = 220;
  if (block) for (let y = block.y; y < block.y + block.h; y++) for (let x = block.x; x < block.x + block.w; x++) data[y * W + x] = 40 + rnd();
  return { data, w: W, h: H };
}
const at = (x: number, y: number): Landmark[] => Array.from({ length: 33 }, (_, i) => ({ x: i === LM.leftElbow ? x / W : 0.5, y: i === LM.leftElbow ? y / H : 0.5, z: 0, visibility: 0.99 }));

describe('Phase 3 — motion–appearance consistency', () => {
  it('compares the joint position now with the same spot ~250 ms earlier: visible → changed, covered → unchanged', () => {
    const block = { x: 60, y: 100, w: 60, h: 60 };
    const run = (y: number, x0: number, withBlock: boolean) => {
      const pm = new PatchMotion();
      let last = NaN;
      for (let k = 0; k < 14; k++) {
        const x = x0 + k * 3; // 3 thumbnail px per frame at 30 fps
        const r = pm.sample(thumb(x, y, withBlock ? block : null, k + 1), at(x, y), k * 33);
        if (r) last = r.values[LM.leftElbow];
      }
      return last;
    };
    expect(run(60, 10, false)).toBeGreaterThan(10); // visible joint arrived where there was background
    expect(run(130, 64, true)).toBeLessThan(3); // behind the block: same block pixels at both times
  });

  it('landmark jitter on a still joint is never evidence; clear movement with an unchanged image is', () => {
    const cd = new CoverageDetector();
    const staticSample = { values: Array.from({ length: 33 }, () => 0.5), dtMs: 250 };
    let s = 1;
    const jitter = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 0.012; // ±0.6% of width ≈ ±4 px
    for (let k = 0; k < 60; k++) {
      const l = at(80, 100).map((p) => ({ ...p, x: p.x + jitter(), y: p.y + jitter() }));
      expect(cd.update(l, k * 33, 720, 1280, staticSample)).toEqual([]);
    }
    // Now the elbow sweeps 40 px per frame while the image at its position does not change.
    const cd2 = new CoverageDetector();
    let covered: number[] = [];
    for (let k = 0; k < 20; k++) covered = cd2.update(at(20 + k * 6, 100), k * 33, 720, 1280, k >= 8 ? staticSample : undefined);
    expect(covered).toContain(LM.leftElbow);
    // Seen again (image changes as it moves): cleared.
    const moving = { values: Array.from({ length: 33 }, () => 25), dtMs: 250 };
    for (let k = 20; k < 30; k++) covered = cd2.update(at(20 + k * 6, 100), k * 33, 720, 1280, moving);
    expect(covered).not.toContain(LM.leftElbow);
  });

  it('the pipeline refuses a measurement whose joint is judged covered, and leaves visible joints alone', () => {
    const pipe = new MotionPipeline('none');
    let last: ReturnType<MotionPipeline['process']> | null = null;
    for (let k = 0; k < 40; k++) {
      const lms = synthesize({ kind: 'standing_anterior', armSide: 'left', shoulderAbduction: 20 + k * 3, scale: 0.75 }, { seed: k });
      const values = Array.from({ length: 33 }, (_, i) => (i === LM.leftElbow ? 0.3 : 30));
      last = pipe.process({ timestamp: k * 33, width: 720, height: 1280, poses: [lms], inferenceMs: 4, provider: SIM_PROVIDER, patchMotion: k >= 8 ? { values, dtMs: 264 } : undefined });
    }
    expect(last!.covered).toContain(LM.leftElbow);
    const e = estimate('shoulder_abduction', last!.smoothed, 720, 1280, 'left', { view: last!.orientation, support: last!.support });
    expect(e.value).toBeNull();
    expect(e.missing).toContain(LM.leftElbow);
    expect(last!.covered).not.toContain(LM.rightElbow);
  });
});
