import type { ActivityImport, ConsentType, DB, ID } from '../data/models';
import { getDb, insert, insertMany, remove, uuid } from '../data/store';
import { dailyActivity, dedupeKey, type ActivityMetric, type ActivitySample, type DailyActivity, type ParseResult } from './activity';

/** Consent text version for the activity consents (granular: steps and walking time separately). */
export const ACTIVITY_CONSENT_VERSION = 'dl-activity-consent-1.0.0';

export const CONSENT_FOR: Record<ActivityMetric, ConsentType> = { steps: 'activity_steps', walking_minutes: 'activity_walking' };

export function activityConsent(db: DB, patientId: ID, metric: ActivityMetric): { granted: boolean; at: string | null } {
  const c = db.consents.filter((x) => x.patientId === patientId && x.type === CONSENT_FOR[metric]).sort((a, b) => b.at.localeCompare(a.at))[0];
  return { granted: !!c?.granted, at: c?.at ?? null };
}

/**
 * Stores parsed samples. Only metrics the patient has consented to are kept; duplicates of
 * already-stored samples (re-importing the same file, or an overlapping export) are dropped.
 */
export function importActivity(patientId: ID, actorId: ID, parsed: ParseResult, platform: ActivityImport['platform'], opts: { fileName?: string; isDemo?: boolean; revoked?: ActivityMetric[]; now?: string } = {}): ActivityImport {
  const db = getDb();
  const at = opts.now ?? new Date().toISOString();
  const allowed = new Set((['steps', 'walking_minutes'] as ActivityMetric[]).filter((m) => activityConsent(db, patientId, m).granted));
  const importId = uuid();
  const existing = new Set(db.activitySamples.filter((s) => s.patientId === patientId).map(dedupeKey));
  const ignored = { ...parsed.ignored };
  let duplicates = 0;
  const rows: ActivitySample[] = [];
  for (const s of parsed.samples) {
    if (!allowed.has(s.metric)) {
      ignored[`${s.metric} (no consent)`] = (ignored[`${s.metric} (no consent)`] ?? 0) + 1;
      continue;
    }
    const k = dedupeKey(s);
    if (existing.has(k)) {
      duplicates++;
      continue;
    }
    existing.add(k);
    rows.push({ ...s, id: uuid(), patientId, importId, importedAt: at, isDemo: opts.isDemo });
  }
  const status: ActivityImport['status'] = opts.revoked?.length ? 'permission_revoked' : allowed.size === 0 ? 'consent_missing' : parsed.errors.length && !rows.length ? 'error' : 'ok';
  const rec: ActivityImport = { id: importId, patientId, platform, fileName: opts.fileName, at, status, added: rows.length, duplicates, ignored, errors: parsed.errors.slice(0, 20), isDemo: opts.isDemo };
  insertMany('activitySamples', rows, actorId, `activity_import:${platform}`);
  insert('activityImports', rec, actorId, 'activity_import');
  return rec;
}

/** Withdraws consent for one metric; by default also deletes what was imported for it. */
export function withdrawActivityConsent(patientId: ID, actorId: ID, metric: ActivityMetric, deleteData: boolean, textVersion = ACTIVITY_CONSENT_VERSION) {
  insert('consents', { id: uuid(), patientId, type: CONSENT_FOR[metric], granted: false, textVersion, at: new Date().toISOString() }, actorId, 'consent_change');
  if (deleteData) for (const s of getDb().activitySamples.filter((x) => x.patientId === patientId && x.metric === metric)) remove('activitySamples', s.id, actorId, 'consent_withdrawn');
}

export function grantActivityConsent(patientId: ID, actorId: ID, metric: ActivityMetric, textVersion = ACTIVITY_CONSENT_VERSION) {
  insert('consents', { id: uuid(), patientId, type: CONSENT_FOR[metric], granted: true, textVersion, at: new Date().toISOString() }, actorId, 'consent_change');
}

export interface ActivityView {
  metric: ActivityMetric;
  consent: { granted: boolean; at: string | null };
  /** Empty when consent is not currently granted: withdrawn data is never displayed. */
  days: DailyActivity[];
  lastImport: ActivityImport | null;
  /** The last import found the OS permission revoked: newer days are a gap, not inactivity. */
  permissionRevoked: boolean;
}

export function lastNDays(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i))).toISOString().slice(0, 10));
}

export function activityView(db: DB, patientId: ID, metric: ActivityMetric, days: string[]): ActivityView {
  const consent = activityConsent(db, patientId, metric);
  const imports = db.activityImports.filter((i) => i.patientId === patientId).sort((a, b) => b.at.localeCompare(a.at));
  return {
    metric,
    consent,
    days: consent.granted ? dailyActivity(db.activitySamples.filter((s) => s.patientId === patientId), metric, days) : [],
    lastImport: imports[0] ?? null,
    permissionRevoked: imports[0]?.status === 'permission_revoked',
  };
}
