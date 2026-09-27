import { createAngleFilter, type ScalarFilter } from '../filters';
import { LM } from '../landmarks';
import type { ProcessedFrame } from '../pipeline';
import type { Landmark, Side } from '../types';
import { compactLandmarks, encodeFrames } from './codec';
import { CycleDetector, type Cycle, type CycleEvent } from './cycles';
import { KNEE_ALGORITHM_VERSION } from './knee';
import type { CaptureConfig, ConditionMatch, Keyframe, MovementEvent, ProtocolDef, ProtocolResult, QualityReport, Recording, SignalFn } from './types';

/**
 * Records one protocol capture: per-frame signal (confidence-gated, filtered), cycle
 * segmentation, landmark frames for replay and keyframes for the report, then produces a
 * versioned, quality-gated result. Invalid samples are never interpolated.
 */

const STORE_HZ = 10;

export interface LiveState {
  phase: CycleDetector['phase'];
  validCycles: number;
  attempts: number;
  value: number | null;
  reason?: string;
  complete: boolean;
  elapsedSec: number;
}

export class ProtocolRecorder {
  private readonly signal: SignalFn;
  private readonly filter: ScalarFilter;
  readonly detector: CycleDetector;
  private readonly rec: Recording;
  private startT: number | null = null;
  private lastStoreT = -Infinity;
  private stored: { t: number; lms: Landmark[] | null }[] = [];
  private full: { t: number; raw: Landmark[] | null; smoothed: Landmark[] | null }[] = [];
  private live: LiveState = { phase: 'waiting', validCycles: 0, attempts: 0, value: null, complete: false, elapsedSec: 0 };
  private view: ProcessedFrame['orientation'] = 'unknown';
  private fpsSum = 0;
  private fpsN = 0;

  constructor(readonly def: ProtocolDef, readonly side: Side | null) {
    this.signal = def.createSignal(side);
    this.filter = createAngleFilter('one_euro');
    this.detector = new CycleDetector(def.cycle);
    this.rec = { samples: [], detector: this.detector, events: [], fps: null };
  }

  get state(): LiveState {
    return this.live;
  }

  update(frame: ProcessedFrame, t: number, fps?: number): CycleEvent[] {
    this.startT ??= t;
    if (fps) {
      this.fpsSum += fps;
      this.fpsN++;
    }
    if (frame.orientation !== 'unknown') this.view = frame.orientation;
    const s = this.signal(frame);
    let value: number | null = null;
    if (s.value !== null) value = this.filter.filter(s.value, t);
    else this.filter.reset();
    this.rec.samples.push({ t, raw: s.value, value, confidence: s.confidence, reason: s.reason, extras: s.extras });
    const events = this.detector.update(t, value);
    for (const e of events) {
      const me: MovementEvent = { t, type: e.type === 'complete' ? 'end' : e.type, cycle: 'index' in e ? e.index : 'cycle' in e ? e.cycle.index : undefined };
      this.rec.events.push(me);
    }
    // Replay storage (10 Hz) + full-rate buffer for keyframe selection.
    if (t - this.lastStoreT >= 1000 / STORE_HZ - 1) {
      this.lastStoreT = t;
      this.stored.push({ t, lms: frame.status === 'tracking' ? frame.smoothed : null });
    }
    this.full.push({ t, raw: frame.raw, smoothed: frame.status === 'tracking' ? frame.smoothed : null });
    this.live = {
      phase: this.detector.phase,
      validCycles: this.detector.validCount,
      attempts: this.detector.cycles.length + (this.detector.current ? 1 : 0),
      value,
      reason: s.reason,
      complete: this.def.isComplete(this.detector) || (t - this.startT) / 1000 >= this.def.maxDurationSec,
      elapsedSec: (t - this.startT) / 1000,
    };
    return events;
  }

  finish(t: number): ProtocolResult {
    this.detector.close(t, this.def.closeAcceptsEngaged);
    this.rec.fps = this.fpsN ? this.fpsSum / this.fpsN : null;
    const t0 = this.startT ?? t;
    const metrics = this.def.analyze(this.rec, this.side);
    const quality = this.quality();
    // A failed capture keeps its numbers for audit/validation, but every metric is invalid.
    const gated = quality.verdict === 'valid' ? metrics : metrics.map((m) => ({ ...m, validity: 'invalid' as const, reason: m.reason ?? 'Capture failed quality gate' }));
    const cycles = this.detector.cycles;
    const events: MovementEvent[] = [
      ...this.rec.events.map((e) => ({ ...e, t: Math.round(e.t - t0) })),
      ...cycles.filter((c) => c.valid).map((c) => ({ t: Math.round(c.peakT - t0), type: 'peak' as const, cycle: c.index })),
    ].sort((a, b) => a.t - b.t);
    const signal: { t: number; v: number | null }[] = [];
    let last = -Infinity;
    for (const s of this.rec.samples) {
      if (s.t - last >= 1000 / STORE_HZ - 1) {
        last = s.t;
        signal.push({ t: Math.round((s.t - t0) / 10) / 100, v: s.value === null ? null : Math.round(s.value * 10) / 10 });
      }
    }
    return {
      protocolId: this.def.id,
      protocolVersion: this.def.version,
      algorithmVersion: KNEE_ALGORITHM_VERSION,
      side: this.side,
      view: this.view,
      durationSec: Math.round(((t - t0) / 1000) * 10) / 10,
      cycles: cycles.map((c) => ({ ...c, startT: c.startT - t0, peakT: c.peakT - t0, engagedT: c.engagedT === null ? null : c.engagedT - t0, endT: c.endT === null ? null : c.endT - t0 })),
      metrics: gated,
      quality,
      signal,
      events,
      keyframes: this.keyframes(t0),
      frames: encodeFrames(this.stored),
    };
  }

  private quality(): QualityReport {
    const readyIdx = this.rec.samples.findIndex((s) => this.rec.events.some((e) => e.type === 'ready' && e.t === s.t));
    const window = readyIdx >= 0 ? this.rec.samples.slice(readyIdx) : this.rec.samples;
    const valid = window.filter((s) => s.value !== null);
    const coverage = window.length ? valid.length / window.length : 0;
    const meanConfidence = valid.length ? valid.reduce((a, s) => a + s.confidence, 0) / valid.length : null;
    const issues: Record<string, number> = {};
    for (const s of window) if (s.value === null && s.reason) issues[s.reason] = (issues[s.reason] ?? 0) + 1;
    const q = this.def.quality;
    const validCycles = this.detector.validCount;
    const reasons: string[] = [];
    if (readyIdx < 0) reasons.push('Never reached the start position steadily');
    if (coverage < q.minCoverage) reasons.push(`Tracking coverage ${Math.round(coverage * 100)}% < ${Math.round(q.minCoverage * 100)}% required`);
    if (meanConfidence !== null && meanConfidence < q.minMeanConfidence) reasons.push(`Mean landmark confidence ${meanConfidence.toFixed(2)} < ${q.minMeanConfidence}`);
    if (validCycles < q.minValidCycles) reasons.push(`${validCycles} valid repetition(s) < ${q.minValidCycles} required`);
    return {
      verdict: reasons.length ? 'invalid' : 'valid',
      reasons,
      coverage: Math.round(coverage * 1000) / 1000,
      meanConfidence: meanConfidence === null ? null : Math.round(meanConfidence * 1000) / 1000,
      validCycles,
      attemptedCycles: this.detector.cycles.length,
      issues,
      meanFps: this.rec.fps === null ? null : Math.round(this.rec.fps * 10) / 10,
    };
  }

  /** Start / mid / peak / return frames of the most representative valid cycle. */
  private keyframes(t0: number): Keyframe[] {
    const valid = this.detector.cycles.filter((c) => c.valid && c.endT !== null);
    if (!valid.length) return [];
    const peaks = valid.map((c) => c.peak).sort((a, b) => a - b);
    const med = peaks[Math.floor(peaks.length / 2)];
    const c: Cycle = valid.reduce((best, x) => (Math.abs(x.peak - med) < Math.abs(best.peak - med) ? x : best));
    const at = (t: number) => this.full.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) && f.smoothed ? f : best), this.full.find((f) => f.smoothed) ?? this.full[0]);
    const marks: [Keyframe['label'], number][] = [
      ['start', c.startT],
      ['mid', (c.startT + c.peakT) / 2],
      ['peak', c.peakT],
      ['return', (c.peakT + (c.endT ?? c.peakT)) / 2],
    ];
    return marks
      .map(([label, t]) => {
        const f = at(t);
        return f.smoothed ? { label, t: Math.round(f.t - t0), cycle: c.index, filtered: compactLandmarks(f.smoothed), raw: f.raw ? compactLandmarks(f.raw) : null } : null;
      })
      .filter((k): k is Keyframe => k !== null);
  }
}

/** Setup description used to reproduce the capture at reassessment. */
export function captureConfig(frame: ProcessedFrame, facing: 'user' | 'environment', roll: number | null): CaptureConfig | null {
  const lms = frame.smoothed;
  if (!lms) return null;
  const pts = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftAnkle, LM.rightAnkle].map((i) => lms[i]).filter((l) => l.visibility > 0.4);
  if (pts.length < 3) return null;
  const ys = pts.map((p) => p.y);
  const xs = pts.map((p) => p.x);
  return {
    view: frame.orientation,
    facing,
    frameWidth: frame.width,
    frameHeight: frame.height,
    cameraRollDeg: roll,
    bodyHeightFrac: Math.round((Math.max(...ys) - Math.min(...ys)) * 1000) / 1000,
    bodyCenterX: Math.round(((Math.max(...xs) + Math.min(...xs)) / 2) * 1000) / 1000,
    bodyCenterY: Math.round(((Math.max(...ys) + Math.min(...ys)) / 2) * 1000) / 1000,
  };
}

/**
 * Compares the current capture setup with the baseline's. Distances are relative framing
 * proxies (share of frame) — never metres, because distance is not calibrated.
 */
export function compareConfig(base: CaptureConfig, cur: CaptureConfig): ConditionMatch {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const checks = [
    { id: 'view', label: 'Camera view', baseline: base.view, current: cur.view, match: base.view === cur.view },
    { id: 'aspect', label: 'Frame orientation', baseline: base.frameWidth > base.frameHeight ? 'landscape' : 'portrait', current: cur.frameWidth > cur.frameHeight ? 'landscape' : 'portrait', match: base.frameWidth > base.frameHeight === cur.frameWidth > cur.frameHeight },
    { id: 'distance', label: 'Body size in frame (distance proxy)', baseline: pct(base.bodyHeightFrac), current: pct(cur.bodyHeightFrac), match: Math.abs(base.bodyHeightFrac - cur.bodyHeightFrac) <= 0.08 },
    { id: 'position', label: 'Horizontal position', baseline: pct(base.bodyCenterX), current: pct(cur.bodyCenterX), match: Math.abs(base.bodyCenterX - cur.bodyCenterX) <= 0.1 },
    {
      id: 'roll',
      label: 'Camera tilt',
      baseline: base.cameraRollDeg === null ? 'unknown' : `${base.cameraRollDeg}°`,
      current: cur.cameraRollDeg === null ? 'unknown' : `${cur.cameraRollDeg}°`,
      match: base.cameraRollDeg !== null && cur.cameraRollDeg !== null && Math.abs(base.cameraRollDeg - cur.cameraRollDeg) <= 3,
    },
  ];
  return { score: Math.round((checks.filter((c) => c.match).length / checks.length) * 100) / 100, checks };
}
