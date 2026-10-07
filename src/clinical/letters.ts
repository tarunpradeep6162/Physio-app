import type { ID, Letter, NoteMeasurement } from '../data/models';
import { formatQuote } from './notes';

/**
 * Phase 52: clinician-written referral and update letters. The app supplies a layout, the quoted
 * measurements with their source labels and a fixed limitations paragraph; the clinician writes the
 * letter. A draft can be edited; a signed letter is final and a change makes a new version.
 */
export const LETTER_LIMITATIONS =
  'Camera values in this letter are 2D estimates from a phone or tablet camera, labelled with their view, confidence and algorithm version. They are not instrument measurements and cannot identify the tissue or condition causing symptoms. Algorithmic observations are threshold crossings that the physiotherapist has reviewed as stated. Patient-reported answers are quoted as given.';

export const canEditLetter = (l: Letter) => l.status === 'draft';

export function signLetter(l: Letter, by: ID, at: string): Letter {
  if (!canEditLetter(l)) throw new Error('This letter is already signed.');
  if (!l.to.trim() || !l.body.trim()) throw new Error('Add the recipient and the letter text before signing.');
  return { ...l, status: 'signed', signedBy: by, signedAt: at };
}

/** A new draft based on a signed letter (the signed one stays as it was). */
export function newVersion(l: Letter, id: ID, by: ID, at: string): Letter {
  return { ...l, id, status: 'draft', createdBy: by, createdAt: at, signedBy: undefined, signedAt: undefined, supersedes: l.id };
}

export function letterText(l: Letter, patientName: string, clinicianName: string): string {
  const title = l.kind === 'referral' ? 'Referral' : 'Progress update';
  const quotes = l.inserted.length ? `\n\nMeasurements quoted\n${l.inserted.map(formatQuote).join('\n')}` : '';
  const status = l.status === 'signed' ? `Signed by ${clinicianName} on ${l.signedAt?.slice(0, 10)}` : 'DRAFT — not signed';
  return `${title}\nTo: ${l.to}\nRe: ${patientName}\n\n${l.body.trim()}${quotes}\n\nLimitations\n${LETTER_LIMITATIONS}\n\n${status}`;
}

export function quotesFromIds(all: NoteMeasurement[], ids: ID[]): NoteMeasurement[] {
  return all.filter((q) => ids.includes(q.measurementId));
}
