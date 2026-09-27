/**
 * Red-flag screening. DRAFT content for review by the supervising clinician — it routes the
 * patient to the right level of care; it does not diagnose anything.
 *
 * - urgent: advise emergency care now, block exercise, raise a critical clinician alert.
 * - review: block camera tests/exercise until the clinician clears it, raise a review alert.
 */

export type RedFlagId = 'bladder' | 'saddle' | 'chest' | 'calf' | 'weakness' | 'trauma' | 'fever' | 'weight' | 'night' | 'cancer';

export const RED_FLAGS: { id: RedFlagId; level: 'urgent' | 'review' }[] = [
  { id: 'bladder', level: 'urgent' },
  { id: 'saddle', level: 'urgent' },
  { id: 'chest', level: 'urgent' },
  { id: 'calf', level: 'urgent' },
  { id: 'weakness', level: 'review' },
  { id: 'trauma', level: 'review' },
  { id: 'fever', level: 'review' },
  { id: 'weight', level: 'review' },
  { id: 'night', level: 'review' },
  { id: 'cancer', level: 'review' },
];

export function triage(answers: Partial<Record<RedFlagId, boolean>>): 'urgent' | 'review' | 'clear' {
  const yes = RED_FLAGS.filter((f) => answers[f.id]);
  if (yes.some((f) => f.level === 'urgent')) return 'urgent';
  if (yes.length > 0) return 'review';
  return 'clear';
}
