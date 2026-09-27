import { describe, expect, it } from 'vitest';
import { LM } from '../landmarks';
import { MotionPipeline } from '../pipeline';
import { synthesize } from '../pose/synthetic';
import type { Landmark } from '../types';
import { CaptureCueEngine, latencySummary } from './cues';
import { ProtocolRecorder } from './recorder';
import { getProtocol } from './registry';
import { sceneAt, SIM_PROVIDER, type SimParams } from './simulate';

function coach(protocolId: string, p: SimParams, perturb?: (l: Landmark[], t: number) => Landmark[]) {
  const def = getProtocol(protocolId);
  const rec = new ProtocolRecorder(def, 'left');
  const pipe = new MotionPipeline();
  const cues = new CaptureCueEngine();
  const log: { t: number; key: string; valid: boolean }[] = [];
  const spoken: string[] = [];
  for (let t = 0; t < def.maxDurationSec * 1000; t += 33) {
    const sc = sceneAt(protocolId, 'left', t / 1000, p);
    let lms = sc ? synthesize(sc, { noisePx: 1, seed: t }) : null;
    if (lms && perturb) lms = perturb(lms, t / 1000);
    const f = pipe.process({ timestamp: t, width: 720, height: 1280, poses: lms ? [lms] : [], inferenceMs: 4, provider: SIM_PROVIDER });
    const events = rec.update(f, t, 30);
    const u = cues.update(rec.state, events, t);
    log.push({ t, key: u.display.key, valid: rec.state.value !== null });
    spoken.push(...u.speech.map((s) => s.key));
    if (rec.state.complete) break;
  }
  return { log, spoken };
}

describe('Phase 5 — capture coaching cues', () => {
  it('coaches one step at a time through clean repetitions and announces each counted one', () => {
    const { log, spoken } = coach('shoulder_abduction_active', { peak: 140 });
    const seq = log.map((x) => x.key).filter((k, i, a) => k !== a[i - 1]);
    expect(seq).toEqual(expect.arrayContaining(['pcue.begin', 'pcue.keep_going', 'pcue.return', 'pcue.returning', 'pcue.again']));
    expect(spoken.filter((s) => s === 'pcue.rep_counted')).toHaveLength(3);
    expect(spoken).not.toContain('pcue.slower');
    expect(spoken).not.toContain('pcue.range');
  });

  it('a repetition that is too fast gets a pace cue; one that stops short gets a comfortable-range cue', () => {
    expect(coach('shoulder_abduction_active', { peak: 140, tempo: 0.35 }).spoken).toContain('pcue.slower');
    expect(coach('shoulder_abduction_active', { peak: 50 }).spoken).toContain('pcue.range');
  });

  it('while tracking is lost only the recovery cue is shown — no pace or range coaching', () => {
    const hide = (l: Landmark[], t: number) => (t > 2.5 && t < 5.5 ? l.map((x, i) => (i === LM.leftElbow ? { ...x, visibility: 0.1 } : x)) : l);
    const { log } = coach('shoulder_abduction_active', { peak: 140 }, hide);
    const invalid = log.filter((x) => x.t > 2700 && x.t < 5400);
    expect(invalid.length).toBeGreaterThan(50);
    expect(invalid.every((x) => x.key.startsWith('pause:'))).toBe(true);
    // Coaching resumes once the joint is measurable again.
    expect(log.filter((x) => x.t > 7000).some((x) => x.key.startsWith('pcue.'))).toBe(true);
  });

  it('summarises cue latency', () => {
    expect(latencySummary([10, 20, 30, 40, 200])).toEqual({ n: 5, p50: 30, p95: 40 });
    expect(latencySummary([]).p50).toBeNull();
  });
});
