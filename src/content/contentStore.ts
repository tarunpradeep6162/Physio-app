import type { ContentReview, DB, ID } from '../data/models';
import { getDb, insert, insertMany, update, uuid } from '../data/store';
import { bumpVersion, importItems, isPublished, validateItem, type ContentItem } from './library';
import { SEED_CONTENT } from './seed';

/**
 * Library persistence and review workflow (Phase 16). Stored versions override the built-in draft
 * seed; the seed itself is never published. Every transition is recorded in the append-only
 * contentReviews trail. Writes are clinician-only (store guard); approval additionally requires a
 * complete item and records the reviewer against that exact version.
 */

const rowId = (i: Pick<ContentItem, 'id' | 'version'>) => `${i.id}@${i.version}`;

/** All versions, stored rows first, then seed rows not yet stored. */
export function allVersions(db: DB): ContentItem[] {
  const stored = (db.contentItems ?? []).map((r) => r.item);
  const have = new Set(stored.map(rowId));
  return [...stored, ...SEED_CONTENT.filter((s) => !have.has(rowId(s)))];
}

/** The latest version of every item. */
export function latestItems(db: DB): ContentItem[] {
  const by = new Map<string, ContentItem>();
  for (const it of allVersions(db)) {
    const cur = by.get(it.id);
    if (!cur || cmp(it.version, cur.version) > 0) by.set(it.id, it);
  }
  return [...by.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** What a patient may be shown or prescribed: the latest APPROVED version of each item. */
export function publishedItems(db: DB): ContentItem[] {
  const known = new Set(allVersions(db).map((i) => i.id));
  const by = new Map<string, ContentItem>();
  for (const it of allVersions(db)) if (isPublished(it, known) && (!by.has(it.id) || cmp(it.version, by.get(it.id)!.version) > 0)) by.set(it.id, it);
  return [...by.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function findVersion(db: DB, id: string, version: string): ContentItem | undefined {
  return allVersions(db).find((i) => i.id === id && i.version === version);
}

function cmp(a: string, b: string) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function save(item: ContentItem, actorId: ID) {
  const id = rowId(item);
  if (getDb().contentItems.some((r) => r.id === id)) update('contentItems', id, { item }, actorId, `content:${item.review.status}`);
  else insert('contentItems', { id, item }, actorId, `content:${item.review.status}`);
}

function trail(item: ContentItem, action: ContentReview['action'], actorId: ID, note?: string) {
  insert('contentReviews', { id: uuid(), itemId: item.id, version: item.version, action, note, by: actorId, at: new Date().toISOString() }, actorId, `content_review:${action}`);
}

export class ContentWorkflowError extends Error {}

export function submitForReview(item: ContentItem, actorId: ID) {
  if (!['draft', 'imported_unreviewed'].includes(item.review.status)) throw new ContentWorkflowError(`Cannot submit an item that is ${item.review.status}.`);
  const next = { ...item, review: { ...item.review, status: 'in_review' as const } };
  save(next, actorId);
  trail(next, 'submit', actorId);
}

/** Approval publishes this exact version. It needs a complete item that is in review. */
export function approve(item: ContentItem, reviewerId: ID, reviewerName: string, note?: string) {
  if (item.review.status !== 'in_review') throw new ContentWorkflowError('Only an item in review can be approved.');
  const problems = validateItem(item, new Set(allVersions(getDb()).map((i) => i.id)));
  if (problems.length) throw new ContentWorkflowError(`Incomplete: ${problems.join('; ')}`);
  const next = { ...item, review: { ...item.review, status: 'approved' as const, reviewedBy: reviewerName, reviewedAt: new Date().toISOString(), note } };
  save(next, reviewerId);
  trail(next, 'approve', reviewerId, note);
}

export function requestChanges(item: ContentItem, actorId: ID, note: string) {
  if (item.review.status !== 'in_review') throw new ContentWorkflowError('Only an item in review can be sent back.');
  const next = { ...item, review: { ...item.review, status: 'draft' as const, note } };
  save(next, actorId);
  trail(next, 'request_changes', actorId, note);
}

export function retire(item: ContentItem, actorId: ID, note: string) {
  const next = { ...item, review: { ...item.review, status: 'retired' as const, note } };
  save(next, actorId);
  trail(next, 'retire', actorId, note);
}

/** Editing an approved (or retired) item creates a new draft version; the approved one stays as it was. */
export function newVersion(item: ContentItem, patch: Partial<ContentItem>, actorId: ID, kind: 'patch' | 'minor' = 'patch'): ContentItem {
  const editable = item.review.status === 'draft' || item.review.status === 'imported_unreviewed';
  const next: ContentItem = { ...item, ...patch, id: item.id, version: editable ? item.version : bumpVersion(item.version, kind), review: { status: 'draft', owner: patch.review?.owner ?? item.review.owner }, createdAt: new Date().toISOString() };
  // Content edits invalidate camera QA if the camera definition changed.
  save(next, actorId);
  trail(next, editable ? 'new_version' : 'new_version', actorId, editable ? 'edited draft' : `from ${item.version}`);
  return next;
}

export function importLibrary(json: string, actorId: ID, sourceRef: string): { added: number; errors: string[] } {
  const { items, errors } = importItems(json, new Date().toISOString(), sourceRef);
  const existing = new Set(allVersions(getDb()).map(rowId));
  const fresh = items.filter((i) => !existing.has(rowId(i)));
  insertMany('contentItems', fresh.map((item) => ({ id: rowId(item), item })), actorId, 'content_import');
  for (const it of fresh) trail(it, 'import', actorId, sourceRef);
  return { added: fresh.length, errors: [...errors, ...items.filter((i) => existing.has(rowId(i))).map((i) => `${rowId(i)} already exists — not overwritten`)] };
}
