import { en, type MessageKey } from './en';
import { ta } from './ta';
import reviews from './ta.review.json';

/**
 * Tamil review status per UI string (Phase 46). A review records the exact English and Tamil text
 * the reviewer approved, so any later change to either side makes the review STALE instead of
 * silently carrying an approval to new wording. Reviews are entered from the translator sheet
 * (scripts/i18n-sheet.mjs import); nothing in the app marks a string reviewed by itself.
 */
export interface ReviewEntry {
  en: string;
  ta: string;
  reviewer: string;
  /** YYYY-MM-DD */
  date: string;
}

export type ReviewState = 'missing' | 'draft' | 'reviewed' | 'stale';

export const TA_REVIEWS = reviews as Record<string, ReviewEntry>;

export function reviewState(key: MessageKey, r: Record<string, ReviewEntry> = TA_REVIEWS): ReviewState {
  const t = (ta as Record<string, string | undefined>)[key];
  if (!t) return 'missing';
  const e = r[key];
  if (!e) return 'draft';
  return e.en === en[key] && e.ta === t ? 'reviewed' : 'stale';
}

export function reviewSummary(r: Record<string, ReviewEntry> = TA_REVIEWS): Record<ReviewState, number> {
  const out: Record<ReviewState, number> = { missing: 0, draft: 0, reviewed: 0, stale: 0 };
  for (const k of Object.keys(en) as MessageKey[]) out[reviewState(k, r)]++;
  return out;
}
