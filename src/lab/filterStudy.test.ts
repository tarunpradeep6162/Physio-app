import { describe, expect, it } from 'vitest';
import fixture from './fixtures/lab-landmarks-v1.json';
import { runChain, STUDY_CHAINS, type LandmarkFixture } from './filterStudy';

const fx = fixture as unknown as LandmarkFixture;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe('filter study on recorded model output', () => {
  const rows = STUDY_CHAINS.flatMap((c) => fx.scenarios.map((s) => runChain(fx, s, c)));
  const get = (chain: string, scenario: string) => rows.find((r) => r.chain.startsWith(chain) && r.scenario === scenario)!.final;

  it('produces figures for every chain (set STUDY_OUT to write them)', async () => {
    if (env.STUDY_OUT) {
      const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync: (p: string, d: string) => void };
      fs.writeFileSync(env.STUDY_OUT, JSON.stringify(rows, null, 1));
    }
    expect(rows.length).toBe(STUDY_CHAINS.length * fx.scenarios.length);
  });

  it('the stored-signal chain beats the v1.0 chain on lag and fast-peak error without more rest jitter when standing', () => {
    const v10 = 'v1.0 default';
    const zp = 'guard + zero-phase median ±100 + mean ±150 ms';
    expect(get(zp, 'heel_slide').lagMs!).toBeLessThan(get(v10, 'heel_slide').lagMs!);
    expect(Math.abs(get(zp, 'heel_slide_fast').peakError!)).toBeLessThan(Math.abs(get(v10, 'heel_slide_fast').peakError!));
    expect(get(zp, 'rest_standing').jitterSd!).toBeLessThan(get(v10, 'rest_standing').jitterSd!);
  });
});
