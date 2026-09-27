import { jointList } from './landmarks';
import type { ExerciseDefinition } from './exercises/types';
import type { RunnerEvent, RunnerSnapshot } from './exerciseRunner';

/**
 * Feedback engine: turns engine events into (a) one short on-screen cue and (b) event-driven
 * speech. It deliberately says very little — the patient should understand what to do from a
 * word or two, and the voice never narrates continuously.
 */

export type CueTone = 'info' | 'success' | 'attention' | 'warning';

export interface Cue {
  key: string;
  params?: Record<string, string | number>;
  tone: CueTone;
}

export interface SpeechCue extends Cue {
  /** Higher interrupts lower. */
  priority: number;
  /** Minimum time before the same key may be spoken again. */
  cooldownMs: number;
}

const TRANSIENT_MS = 1600;

export class FeedbackEngine {
  private transient: { cue: Cue; until: number } | null = null;

  constructor(private readonly def: ExerciseDefinition) {}

  handle(events: RunnerEvent[], snap: RunnerSnapshot, t: number): { display: Cue; speech: SpeechCue[] } {
    const speech: SpeechCue[] = [];
    const say = (key: string, tone: CueTone, priority: number, cooldownMs = 2500, params?: Cue['params']) =>
      speech.push({ key, tone, priority, cooldownMs, params });
    const flash = (cue: Cue, ms = TRANSIENT_MS) => {
      this.transient = { cue, until: t + ms };
    };

    for (const e of events) {
      switch (e.type) {
        case 'ready':
          say(this.def.cues.beginKey, 'info', 2, 4000);
          break;
        case 'target_approach':
          say(this.def.cues.approachKey, 'attention', 2, 3000);
          break;
        case 'target_reached':
          if (snap.phase === 'active' && snap.state === 'hold') say('cue.hold', 'success', 3, 1500);
          break;
        case 'hold_countdown':
          say(`cue.count.${e.remaining}`, 'info', 3, 700);
          break;
        case 'hold_complete':
          say('cue.return_slowly', 'info', 3, 1500);
          break;
        case 'hold_broken':
          flash({ key: 'cue.hold_steady', tone: 'attention' });
          say('cue.hold_steady', 'attention', 3, 3000);
          break;
        case 'rep_complete':
          flash({ key: 'cue.rep_complete', tone: 'success', params: { n: snap.repsCounted } });
          say('cue.reps_done', 'success', 4, 0, { n: snap.repsCounted });
          break;
        case 'rep_incomplete': {
          const key = e.rep.reason === 'hold_incomplete' ? 'cue.hold_longer' : e.rep.reason === 'too_short' ? 'cue.too_fast' : 'cue.not_quite_target';
          flash({ key, tone: 'attention' });
          say(key, 'attention', 3, 3000);
          break;
        }
        case 'over_target':
          flash({ key: 'cue.too_far', tone: 'warning' }, 2200);
          say('cue.too_far', 'warning', 5, 3000);
          break;
        case 'too_fast':
          flash({ key: 'cue.too_fast', tone: 'attention' });
          say('cue.too_fast', 'attention', 3, 5000);
          break;
        case 'form':
          say(e.cueKey, 'attention', 4, 5000);
          break;
        case 'tracking_lost':
          say('cue.paused_reposition', 'warning', 5, 6000);
          break;
        case 'rep_discarded':
          flash({ key: 'cue.rep_discarded', tone: 'warning' }, 2500);
          break;
        case 'set_complete':
          if (snap.phase !== 'complete') say('cue.set_complete', 'success', 4, 0, { n: e.set });
          break;
        case 'rest_over':
          say('cue.next_set', 'info', 4, 0, { n: e.nextSet });
          break;
        case 'exercise_complete':
          say('cue.exercise_complete', 'success', 5, 0);
          break;
        default:
          break;
      }
    }

    return { display: this.displayCue(snap, t), speech };
  }

  private displayCue(snap: RunnerSnapshot, t: number): Cue {
    if (snap.phase === 'complete') return { key: 'cue.exercise_complete', tone: 'success' };
    if (snap.phase === 'rest') return { key: 'cue.rest', tone: 'info', params: { s: snap.restRemaining } };
    if (snap.state === 'paused' || snap.estimate.value === null) {
      return { key: pauseKey(snap.estimate.reason), tone: 'warning' };
    }
    if (this.transient && t < this.transient.until) return this.transient.cue;
    this.transient = null;
    if (snap.activeFormCue) return { key: snap.activeFormCue, tone: 'attention' };
    switch (snap.state) {
      case 'not_ready':
        return { key: 'cue.get_ready', tone: 'info' };
      case 'ready':
        return { key: this.def.cues.beginKey, tone: 'info' };
      case 'moving':
        return { key: 'cue.keep_going', tone: 'info' };
      case 'target_approach':
        return { key: this.def.cues.approachKey, tone: 'attention' };
      case 'hold':
        return { key: 'cue.hold', tone: 'success' };
      case 'returning':
        return { key: 'cue.return_slowly', tone: 'info' };
      default:
        return { key: 'cue.get_ready', tone: 'info' };
    }
  }
}

/** Maps a measurement-pause reason to the patient-facing instruction. */
export function pauseKey(reason: string | undefined): string {
  switch (reason) {
    case 'no_person':
      return 'cue.pause.no_person';
    case 'multiple_people':
      return 'cue.pause.multiple_people';
    case 'out_of_frame':
      return 'cue.pause.out_of_frame';
    case 'occluded':
      return 'cue.pause.occluded';
    case 'not_on_body':
      return 'cue.pause.not_on_body';
    case 'reacquiring':
      return 'cue.pause.reacquiring';
    case 'implausible_jump':
      return 'cue.pause.implausible_jump';
    case 'wrong_orientation':
    case 'orientation_uncertain':
      return 'cue.pause.orientation';
    default:
      return 'cue.paused_reposition';
  }
}

/**
 * Patient-facing pause text that names the joint when it is known, e.g. "Measurement paused —
 * something is covering your left knee".
 */
export function pauseText(t: (k: string, p?: Record<string, string>) => string, reason: string | undefined, missing?: number[]): string {
  if (missing?.length && (reason === 'occluded' || reason === 'not_on_body' || reason === 'out_of_frame')) {
    return t(`cue.pause.${reason}_named`, { joints: jointList(missing) });
  }
  return t(pauseKey(reason));
}
