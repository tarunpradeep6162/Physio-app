import type { ExercisePrescription } from './types';

/** Clinician-configured pain rule from the prescription. The engine never changes the rule. */
export function painRuleOutcome(rx: ExercisePrescription, nprs: number, painBefore: number | null): { stop: boolean; rule: string } {
  if (rx.painStopAt !== undefined && nprs >= rx.painStopAt) return { stop: true, rule: `pain ≥ ${rx.painStopAt}/10` };
  if (rx.painRiseStop !== undefined && painBefore !== null && nprs - painBefore >= rx.painRiseStop) return { stop: true, rule: `pain rose ≥ ${rx.painRiseStop} from ${painBefore}/10` };
  return { stop: false, rule: rx.painStopAt !== undefined || rx.painRiseStop !== undefined ? 'within configured limits' : 'no pain rule configured' };}
