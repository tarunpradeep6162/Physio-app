import { getDefinition } from './exercises/definitions';
import type { ExerciseDefinition, ExercisePrescription, FormRule } from './exercises/types';
import { SignalGuard } from './signalGuard';
import { createAngleFilter, type FilterKind, type ScalarFilter } from './filters';
import { estimate, MEASUREMENT_ALGORITHM_VERSION } from './measurements';
import type { ProcessedFrame } from './pipeline';
import { RepStateMachine, type MotionEvent, type MotionSnapshot, type RepRecord } from './stateMachine';
import type { Estimate, Side } from './types';

/**
 * Runs one prescribed exercise: measurement → angle filter → state machine → form rules →
 * sets/rest. Emits engine events consumed by the feedback engine and records an interpretable
 * result (never a single opaque "AI score").
 */

export type RunnerPhase = 'active' | 'rest' | 'complete';

export type RunnerEvent =
  | MotionEvent
  | { type: 'form'; ruleId: string; cueKey: string }
  | { type: 'measurement_paused'; reason: string }
  | { type: 'set_complete'; set: number }
  | { type: 'rest_tick'; remaining: number }
  | { type: 'rest_over'; nextSet: number }
  | { type: 'exercise_complete' };

export interface TrajectorySample {
  /** Seconds since exercise start. */
  t: number;
  /** Filtered camera-estimated angle, or null while measurement was paused. */
  angle: number | null;
}

export interface RunnerSnapshot extends MotionSnapshot {
  phase: RunnerPhase;
  set: number;
  totalSets: number;
  repsTarget: number;
  restRemaining: number;
  estimate: Estimate;
  rawAngle: number | null;
  activeFormCue: string | null;
}

export interface ExerciseResult {
  definitionId: string;
  definitionVersion: string;
  algorithmVersion: string;
  side: Side;
  prescription: ExercisePrescription;
  setsCompleted: number;
  repsCompleted: number;
  repsAttempted: number;
  reps: (RepRecord & { set: number })[];
  peakRom: number | null;
  meanPeakRom: number | null;
  holdsAchieved: number;
  holdsRequired: number;
  meanConcentricMs: number | null;
  meanEccentricMs: number | null;
  fastReps: number;
  formCues: Record<string, number>;
  /** Fraction of active time with a valid measurement. */
  trackingCoverage: number;
  meanConfidence: number | null;
  trajectory: TrajectorySample[];
  durationSec: number;
  endedEarly: boolean;
}

const TRAJECTORY_HZ = 10;

export class ExerciseRunner {
  readonly def: ExerciseDefinition;
  private readonly sm: RepStateMachine;
  private readonly filter: ScalarFilter;
  private phase: RunnerPhase = 'active';
  private set = 1;
  private restUntil = 0;
  private lastRestTick = -1;
  private startT: number | null = null;
  private lastTrajT = -Infinity;
  private trajectory: TrajectorySample[] = [];
  private repSet: number[] = [];
  private formSince = new Map<string, number>();
  private formFired = new Set<string>();
  private formCounts: Record<string, number> = {};
  private activeFormCue: string | null = null;
  private validFrames = 0;
  private totalFrames = 0;
  private confSum = 0;
  private lastEstimate: Estimate = { value: null, confidence: 0, level: 'insufficient', reason: 'no_person' };
  private lastRaw: number | null = null;
  private lastPauseReason: string | null = null;
  private endT = 0;
  /** Physically impossible jumps are rejected; values resume only after a short stable window. */
  private readonly guard: SignalGuard;

  constructor(readonly rx: ExercisePrescription, filterKind: FilterKind = 'one_euro') {
    this.def = getDefinition(rx.definitionId, rx.definitionVersion);
    this.filter = createAngleFilter(filterKind);
    this.guard = new SignalGuard(900);
    // The prescription is executed exactly as the clinician configured it; the engine never
    // adjusts targets on its own.
    this.sm = new RepStateMachine({
      target: rx.target,
      holdSeconds: rx.holdSeconds,
      minRepMs: rx.tempo.minRepMs,
      maxVelocityDegPerSec: rx.tempo.maxVelocityDegPerSec,
      thresholds: this.def.thresholds,
    });
  }

  get snapshot(): RunnerSnapshot {
    return {
      ...this.sm.snapshot,
      phase: this.phase,
      set: this.set,
      totalSets: this.rx.sets,
      repsTarget: this.rx.reps,
      restRemaining: Math.max(0, Math.ceil((this.restUntil - this.endT) / 1000)),
      estimate: this.lastEstimate,
      rawAngle: this.lastRaw,
      activeFormCue: this.activeFormCue,
    };
  }

  get machine(): RepStateMachine {
    return this.sm;
  }

  /** Skip the remaining rest period (patient taps "Start next set"). */
  skipRest(t: number): RunnerEvent[] {
    if (this.phase !== 'rest') return [];
    this.restUntil = t;
    return this.update(null, t);
  }

  update(frame: ProcessedFrame | null, t: number): RunnerEvent[] {
    const ev: RunnerEvent[] = [];
    if (this.startT === null) this.startT = t;
    this.endT = t;

    if (this.phase === 'complete') return ev;

    if (this.phase === 'rest') {
      const remaining = Math.ceil((this.restUntil - t) / 1000);
      if (remaining !== this.lastRestTick && remaining >= 0) {
        this.lastRestTick = remaining;
        ev.push({ type: 'rest_tick', remaining });
      }
      if (t >= this.restUntil) {
        this.phase = 'active';
        this.set++;
        this.sm.resetSet();
        this.filter.reset();
        ev.push({ type: 'rest_over', nextSet: this.set });
      }
      return ev;
    }

    // ---- Measurement -----------------------------------------------------------------------
    const side = this.rx.side;
    let est: Estimate;
    if (!frame || frame.status !== 'tracking') {
      est = { value: null, confidence: 0, level: 'insufficient', reason: frame?.status ?? 'no_person' };
    } else {
      // Sagittal-plane angles are only meaningful from the prescribed lateral view; an ambiguous
      // orientation pauses measurement rather than risking a projected (wrong) angle.
      est =
        frame.orientation === 'unknown'
          ? { value: null, confidence: 0, level: 'insufficient', reason: 'orientation_uncertain' }
          : estimate(this.def.primary, frame.smoothed, frame.width, frame.height, side, { view: frame.orientation, support: frame.support });
    }
    // Plausibility guard: a leg-label flip or landmark jump must never count toward a rep or a hold.
    const g = this.guard.update(t, est.value);
    if (est.value !== null && g.value === null) est = { value: null, confidence: est.confidence, level: est.level, reason: g.reason };
    this.lastEstimate = est;
    this.totalFrames++;
    let filtered: number | null = null;
    if (est.value !== null) {
      this.validFrames++;
      this.confSum += est.confidence;
      this.lastRaw = est.value;
      filtered = this.filter.filter(est.value, t);
      this.lastPauseReason = null;
    } else {
      this.lastRaw = null;
      this.filter.reset();
      if (est.reason && est.reason !== this.lastPauseReason) {
        this.lastPauseReason = est.reason;
        ev.push({ type: 'measurement_paused', reason: est.reason });
      }
    }

    // ---- Trajectory (downsampled) -----------------------------------------------------------
    const rel = (t - this.startT) / 1000;
    if (rel - this.lastTrajT >= 1 / TRAJECTORY_HZ) {
      this.lastTrajT = rel;
      this.trajectory.push({ t: Math.round(rel * 100) / 100, angle: filtered === null ? null : Math.round(filtered * 10) / 10 });
    }

    // ---- State machine ----------------------------------------------------------------------
    const smEvents = this.sm.update(t, filtered);
    for (const e of smEvents) {
      ev.push(e);
      if (e.type === 'rep_complete' || e.type === 'rep_incomplete') this.repSet.push(this.set);
    }

    // ---- Form rules -------------------------------------------------------------------------
    this.activeFormCue = null;
    if (frame?.status === 'tracking' && filtered !== null) {
      for (const rule of this.def.formRules) this.evaluateRule(rule, frame, t, ev);
    }

    // ---- Set / exercise completion ----------------------------------------------------------
    if (this.sm.snapshot.repsCounted >= this.rx.reps) {
      ev.push({ type: 'set_complete', set: this.set });
      if (this.set >= this.rx.sets) {
        this.phase = 'complete';
        ev.push({ type: 'exercise_complete' });
      } else {
        this.phase = 'rest';
        this.restUntil = t + this.rx.restSeconds * 1000;
        this.lastRestTick = -1;
      }
    }
    return ev;
  }

  private evaluateRule(rule: FormRule, frame: ProcessedFrame, t: number, ev: RunnerEvent[]) {
    const state = this.sm.snapshot.state;
    if (!rule.activeIn.includes(state as FormRule['activeIn'][number])) {
      this.formSince.delete(rule.id);
      this.formFired.delete(rule.id);
      return;
    }
    const side: Side = rule.on === 'same' ? this.rx.side : this.rx.side === 'left' ? 'right' : 'left';
    const e = estimate(rule.measurement, frame.smoothed, frame.width, frame.height, side, { ignoreView: true, support: frame.support });
    if (e.value === null) return;
    const violated = rule.op === 'lt' ? e.value < rule.threshold : e.value > rule.threshold;
    if (!violated) {
      this.formSince.delete(rule.id);
      this.formFired.delete(rule.id);
      return;
    }
    const since = this.formSince.get(rule.id) ?? t;
    this.formSince.set(rule.id, since);
    if (t - since >= rule.sustainMs) {
      this.activeFormCue = rule.cueKey;
      if (!this.formFired.has(rule.id)) {
        this.formFired.add(rule.id);
        this.formCounts[rule.id] = (this.formCounts[rule.id] ?? 0) + 1;
        ev.push({ type: 'form', ruleId: rule.id, cueKey: rule.cueKey });
      }
    }
  }

  result(endedEarly = false): ExerciseResult {
    const reps = this.sm.reps.map((r, i) => ({ ...r, set: this.repSet[i] ?? this.set }));
    const peaks = reps.map((r) => r.peak).filter((p) => Number.isFinite(p));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const reached = reps.filter((r) => r.reachedTarget);
    const counted = reps.filter((r) => r.counted);
    const setsCompleted = this.phase === 'complete' ? this.rx.sets : this.set - 1;
    return {
      definitionId: this.def.id,
      definitionVersion: this.def.version,
      algorithmVersion: MEASUREMENT_ALGORITHM_VERSION,
      side: this.rx.side,
      prescription: this.rx,
      setsCompleted,
      repsCompleted: counted.length,
      repsAttempted: reps.length,
      reps,
      peakRom: peaks.length ? Math.max(...peaks) : null,
      meanPeakRom: mean(peaks),
      holdsAchieved: reps.filter((r) => r.holdAchieved).length,
      holdsRequired: this.rx.holdSeconds > 0 ? reached.length : 0,
      meanConcentricMs: mean(counted.map((r) => r.concentricMs).filter((x): x is number => x !== null)),
      meanEccentricMs: mean(counted.map((r) => r.eccentricMs).filter((x): x is number => x !== null)),
      fastReps: reps.filter((r) => r.tooFast).length,
      formCues: { ...this.formCounts },
      trackingCoverage: this.totalFrames ? this.validFrames / this.totalFrames : 0,
      meanConfidence: this.validFrames ? this.confSum / this.validFrames : null,
      trajectory: this.trajectory,
      durationSec: this.startT === null ? 0 : (this.endT - this.startT) / 1000,
      endedEarly,
    };
  }
}
