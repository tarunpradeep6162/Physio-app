import type { OutcomeInstrument } from '../data/models';

/**
 * Phase 49: outcome-measure registry gate. The app holds only metadata about questionnaires. An
 * instrument may be enabled only when its licence position, licence holder, licence reference, the
 * official scoring source and a clinical approval are all recorded. Questionnaire wording and
 * scoring are never typed in from memory; they come from the licensed official materials.
 */
export const LICENCE_LABEL: Record<OutcomeInstrument['licenceStatus'], string> = {
  not_checked: 'Not checked',
  requested: 'Permission requested',
  licensed: 'Licensed',
  free_with_terms: 'Free to use under published terms',
  refused: 'Permission refused',
};

export function enableBlockers(i: OutcomeInstrument): string[] {
  const out: string[] = [];
  if (i.licenceStatus !== 'licensed' && i.licenceStatus !== 'free_with_terms') out.push(`Licence: ${LICENCE_LABEL[i.licenceStatus].toLowerCase()}`);
  if (!i.licenceHolder?.trim()) out.push('Licence holder not recorded');
  if (!i.licenceRef?.trim()) out.push('Licence document or terms not recorded');
  if (!i.scoringSource?.trim()) out.push('Official scoring source not recorded');
  if (!i.clinicalApprovedBy || !i.clinicalApprovedAt) out.push('No clinical approval of this version');
  return out;
}

export const canEnable = (i: OutcomeInstrument) => enableBlockers(i).length === 0;

/**
 * Apply an edit. Changing the version, licence or scoring source withdraws the clinical approval
 * and disables the instrument, so an approval never carries over to different material.
 */
export function editInstrument(i: OutcomeInstrument, patch: Partial<OutcomeInstrument>, at: string): OutcomeInstrument {
  const next = { ...i, ...patch, updatedAt: at };
  const material = (['version', 'licenceStatus', 'licenceHolder', 'licenceRef', 'scoringSource'] as const).some((k) => k in patch && patch[k] !== i[k]);
  if (material) {
    delete next.clinicalApprovedBy;
    delete next.clinicalApprovedAt;
    next.enabled = false;
  }
  if (next.enabled && !canEnable(next)) next.enabled = false;
  return next;
}
