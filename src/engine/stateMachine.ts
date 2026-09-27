import type { MotionThresholds, Range } from './exercises/types';

/**
 * Repetition state machine.
 *
 *   NOT_READY → READY → MOVING → TARGET_APPROACH → HOLD (target reached) → RETURNING → READY
 *                           ↘ (returns to rest early) → rep_incomplete ↗
 *   any state → PAUSED on tracking loss (hold time never accumulates while paused)
 *
 * A repetition is counted ONLY on the return to rest after the target was reached and the
 * required hold was satisfied. Start and completion use different thresholds (hysteresis), so
 * jitter around a single angle can never produce a double count.
 */

export type MotionState = 'not_ready' | 'ready' | 'moving' | 'target_approach' | 'hold' | 'returning' | 'paused';

export type MotionEvent =
  | { type: 'ready' }
  | { type: 'movement_started' }
  | { type: 'target_approach' }
  | { type: 'target_reached' }
  | { type: 'hold_countdown'; remaining: number }
  | { type: 'hold_complete' }
  | { type: 'hold_broken'; heldSeconds: number }
  | { type: 'over_target'; angle: number }
  | { type: 'too_fast'; velocity: number }
  | { type: 'rep_complete'; rep: RepRecord }
  | { type: 'rep_incomplete'; rep: RepRecord }
  | { type: 'rep_discarded' }
  | { type: 'tracking_lost' }
  | { type: 'tracking_regained' };

export interface RepRecord {
  index: number;
  startT: number;
  endT: number;
  /** Peak camera-estimated angle during the attempt. */
  peak: number;
  reachedTarget: boolean;
  heldSeconds: number;
  holdRequired: number;
  holdAchieved: boolean;
  /** Time from movement start to target (ms), null if target not reached. */
  concentricMs: number | null;
  /** Time from hold completion (or peak) back to rest (ms). */
  eccentricMs: number | null;
  maxVelocity: number;
  tooFast: boolean;
  counted: boolean;
  reason?: 'target_not_reached' | 'hold_incomplete' | 'too_short';
}

export interface StateMachineConfig {
  target: Range;
  holdSeconds: number;
  minRepMs: number;
  maxVelocityDegPerSec: number;
  thresholds: MotionThresholds;
}

export interface MotionSnapshot {
  state: MotionState;
  angle: number | null;
  velocity: number;
  holdElapsed: number;
  repsCounted: number;
  attempts: number;
  peak: number | null;
}

export class RepStateMachine {
  private state: MotionState = 'not_ready';
  private resumeState: MotionState = 'not_ready';
  private pausedAt: number | null = null;
  private restSince: number | null = null;
  private lastT: number | null = null;
  private lastAngle: number | null = null;
  private velocity = 0;

  // Current attempt
  private repStart = 0;
  private targetAt: number | null = null;
  private holdDoneAt: number | null = null;
  private peak = -Infinity;
  private holdElapsed = 0;
  private maxHeld = 0;
  private holdAchieved = false;
  private reachedTarget = false;
  private approachAnnounced = false;
  private overAnnounced = false;
  private tooFastFlag = false;
  private maxVel = 0;
  private lastCountdown: number | null = null;

  private counted = 0;
  private attempts = 0;
  readonly reps: RepRecord[] = [];

  constructor(private cfg: StateMachineConfig) {}

  get snapshot(): MotionSnapshot {
    return {
      state: this.state,
      angle: this.lastAngle,
      velocity: this.velocity,
      holdElapsed: this.holdElapsed,
      repsCounted: this.counted,
      attempts: this.attempts,
      peak: Number.isFinite(this.peak) ? this.peak : null,
    };
  }

  get config(): StateMachineConfig {
    return this.cfg;
  }

  /** Resets per-set counters but keeps the history of completed reps. */
  resetSet() {
    this.counted = 0;
    this.state = 'not_ready';
    this.restSince = null;
    this.clearAttempt();
  }

  private clearAttempt() {
    this.peak = -Infinity;
    this.targetAt = null;
    this.holdDoneAt = null;
    this.holdElapsed = 0;
    this.maxHeld = 0;
    this.holdAchieved = false;
    this.reachedTarget = false;
    this.approachAnnounced = false;
    this.overAnnounced = false;
    this.tooFastFlag = false;
    this.maxVel = 0;
    this.lastCountdown = null;
  }

  private inAttempt(s: MotionState = this.state): boolean {
    return s === 'moving' || s === 'target_approach' || s === 'hold' || s === 'returning';
  }

  /**
   * Feed one sample. `angle` must be the FILTERED camera estimate, or null when the measurement
   * is invalid (low confidence, occluded, wrong orientation, out of frame).
   */
  update(t: number, angle: number | null): MotionEvent[] {
    const ev: MotionEvent[] = [];
    const th = this.cfg.thresholds;

    // ---- Tracking loss handling -------------------------------------------------------------
    if (angle === null) {
      if (this.state !== 'paused') {
        this.resumeState = this.state;
        this.state = 'paused';
        this.pausedAt = t;
        ev.push({ type: 'tracking_lost' });
      } else if (this.pausedAt !== null && this.inAttempt(this.resumeState) && t - this.pausedAt > th.pauseResetMs) {
        // Too long without reliable tracking: the in-progress attempt cannot be trusted.
        this.clearAttempt();
        this.resumeState = 'not_ready';
        ev.push({ type: 'rep_discarded' });
      }
      this.lastT = null; // do not compute velocity across the gap
      return ev;
    }

    if (this.state === 'paused') {
      this.state = this.resumeState === 'ready' ? 'not_ready' : this.resumeState;
      this.pausedAt = null;
      this.restSince = null;
      ev.push({ type: 'tracking_regained' });
    }

    // ---- Kinematics ---------------------------------------------------------------------------
    const dt = this.lastT === null ? 0 : (t - this.lastT) / 1000;
    if (dt > 0 && this.lastAngle !== null) {
      const v = (angle - this.lastAngle) / dt;
      this.velocity = this.velocity * 0.6 + v * 0.4;
    } else {
      this.velocity = 0;
    }
    this.lastT = t;
    this.lastAngle = angle;

    const startAt = th.restThreshold + th.startDelta;
    const { min: tMin, max: tMax } = this.cfg.target;

    if (this.inAttempt()) {
      this.peak = Math.max(this.peak, angle);
      this.maxVel = Math.max(this.maxVel, Math.abs(this.velocity));
      if (!this.tooFastFlag && Math.abs(this.velocity) > this.cfg.maxVelocityDegPerSec) {
        this.tooFastFlag = true;
        ev.push({ type: 'too_fast', velocity: this.velocity });
      }
      if (angle > tMax + th.overTolerance) {
        if (!this.overAnnounced) {
          this.overAnnounced = true;
          ev.push({ type: 'over_target', angle });
        }
      } else if (angle < tMax) {
        this.overAnnounced = false;
      }
    }

    switch (this.state) {
      case 'not_ready': {
        if (angle <= th.restThreshold) {
          if (this.restSince === null) this.restSince = t;
          if (t - this.restSince >= th.readyStableMs) {
            this.state = 'ready';
            ev.push({ type: 'ready' });
          }
        } else this.restSince = null;
        break;
      }
      case 'ready': {
        if (angle > startAt) {
          this.clearAttempt();
          this.state = 'moving';
          this.repStart = t;
          this.peak = angle;
          this.attempts++;
          ev.push({ type: 'movement_started' });
          // Fall through to evaluate target on the same frame.
          this.evaluateMoving(t, angle, ev);
        }
        break;
      }
      case 'moving':
      case 'target_approach':
        this.evaluateMoving(t, angle, ev);
        break;
      case 'hold': {
        if (angle >= tMin - th.holdTolerance) {
          this.holdElapsed += dt;
          this.maxHeld = Math.max(this.maxHeld, this.holdElapsed);
          const remaining = Math.ceil(this.cfg.holdSeconds - this.holdElapsed);
          if (remaining > 0 && remaining <= 3 && remaining !== this.lastCountdown) {
            this.lastCountdown = remaining;
            ev.push({ type: 'hold_countdown', remaining });
          }
          if (this.holdElapsed >= this.cfg.holdSeconds) {
            this.holdAchieved = true;
            this.holdDoneAt = t;
            this.state = 'returning';
            ev.push({ type: 'hold_complete' });
          }
        } else {
          ev.push({ type: 'hold_broken', heldSeconds: this.holdElapsed });
          this.holdElapsed = 0;
          this.lastCountdown = null;
          this.state = 'moving';
          this.evaluateMoving(t, angle, ev);
        }
        break;
      }
      case 'returning': {
        if (angle <= th.restThreshold) this.finishAttempt(t, ev);
        break;
      }
    }
    return ev;
  }

  private evaluateMoving(t: number, angle: number, ev: MotionEvent[]) {
    const th = this.cfg.thresholds;
    const { min: tMin } = this.cfg.target;
    if (angle >= tMin) {
      this.reachedTarget = true;
      if (this.targetAt === null) this.targetAt = t;
      ev.push({ type: 'target_reached' });
      if (this.cfg.holdSeconds <= 0) {
        this.holdAchieved = true;
        this.holdDoneAt = t;
        this.state = 'returning';
        ev.push({ type: 'hold_complete' });
      } else {
        this.state = 'hold';
        this.holdElapsed = 0;
      }
      return;
    }
    if (angle >= tMin - th.approachMargin && !this.approachAnnounced) {
      this.approachAnnounced = true;
      this.state = 'target_approach';
      ev.push({ type: 'target_approach' });
    }
    if (angle <= th.restThreshold) this.finishAttempt(t, ev);
  }

  private finishAttempt(t: number, ev: MotionEvent[]) {
    const duration = t - this.repStart;
    let reason: RepRecord['reason'];
    if (!this.reachedTarget) reason = 'target_not_reached';
    else if (!this.holdAchieved) reason = 'hold_incomplete';
    else if (duration < this.cfg.minRepMs * 0.5) reason = 'too_short';
    const counted = reason === undefined;
    const rep: RepRecord = {
      index: this.reps.length + 1,
      startT: this.repStart,
      endT: t,
      peak: this.peak,
      reachedTarget: this.reachedTarget,
      heldSeconds: this.cfg.holdSeconds > 0 ? Math.min(this.maxHeld, this.cfg.holdSeconds) : 0,
      holdRequired: this.cfg.holdSeconds,
      holdAchieved: this.holdAchieved,
      concentricMs: this.targetAt !== null ? this.targetAt - this.repStart : null,
      eccentricMs: this.holdDoneAt !== null ? t - this.holdDoneAt : null,
      maxVelocity: this.maxVel,
      tooFast: this.tooFastFlag || duration < this.cfg.minRepMs,
      counted,
      reason,
    };
    this.reps.push(rep);
    if (counted) this.counted++;
    ev.push(counted ? { type: 'rep_complete', rep } : { type: 'rep_incomplete', rep });
    this.state = 'ready';
    this.clearAttempt();
  }
}
