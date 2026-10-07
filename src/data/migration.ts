import type { DB } from './models';

/**
 * Explicit, one-way export of browser-local records for import into the server data boundary
 * (db/schema.sql + db/security.sql). Nothing is migrated automatically. By default:
 *   - demonstration/simulated rows are EXCLUDED (they must never become patient records);
 *   - local password hashes are REMOVED (the server authenticates with OIDC);
 *   - stored still images are OMITTED unless explicitly requested (separate consent on the server).
 * The bundle carries per-table counts and a SHA-256 of its canonical content so the importer can
 * verify it arrived intact.
 */

export interface MigrationBundle {
  kind: 'physiovision-migration';
  version: 1;
  schemaVersion: number;
  exportedAt: string;
  options: { includeDemo: boolean; includeImages: boolean };
  excluded: { demoRows: number; passwordHashes: number; images: number };
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
  sha256: string;
}

export const MIGRATION_TABLES = ['users', 'patients', 'clinicians', 'careRelationships', 'consents', 'assessments', 'painRegions', 'pros', 'scans', 'measurements', 'observations', 'programs', 'programExercises', 'sessions', 'notes', 'alerts', 'messages', 'audit', 'radiationPaths', 'intakeAnswers', 'safetyResponses', 'amendments', 'testPlans', 'captures', 'reasoningDecisions', 'impressions', 'reports', 'draftDecisions', 'examFindings', 'planPauses', 'planResumes', 'appointments', 'activitySamples', 'activityImports', 'contentItems', 'contentReviews', 'programLibraryItems', 'deviceMeasurements', 'treatmentCourses', 'payments', 'expenses', 'discharges', 'goals', 'goalRatings', 'outcomeInstruments', 'letters', 'challengeClips'] as const;
const LINK_KEYS = ['patientId', 'assessmentId', 'programId', 'sessionId', 'captureId', 'scanId', 'userId', 'clinicianId', 'fromUserId', 'createdBy', 'reviewedBy', 'authorId', 'approvedBy', 'actorId', 'baselineAssessmentId', 'baselineCaptureId', 'entityId'] as const;

/** Follow demo relationships, including rows without patientId or isDemo (plans, paths, audit). */
function demoRecordIds(db: DB): Set<string> {
  const ids = new Set<string>();
  const rows = MIGRATION_TABLES.flatMap((t) => db[t] as unknown as Record<string, unknown>[]);
  for (const row of rows) {
    if (row.isDemo === true || (row.provenance as { source?: string } | undefined)?.source === 'simulated_demo') {
      if (typeof row.id === 'string') ids.add(row.id);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (typeof row.id !== 'string' || ids.has(row.id)) continue;
      if (LINK_KEYS.some((k) => typeof row[k] === 'string' && ids.has(row[k] as string))) {
        ids.add(row.id);
        changed = true;
      }
    }
  }
  return ids;
}

/** Deterministic JSON (sorted keys) so the checksum does not depend on property order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildMigrationBundle(db: DB, opts: { includeDemo?: boolean; includeImages?: boolean } = {}): Promise<MigrationBundle> {
  const includeDemo = !!opts.includeDemo;
  const includeImages = !!opts.includeImages;
  const excluded = { demoRows: 0, passwordHashes: 0, images: 0 };
  const demoIds = includeDemo ? new Set<string>() : demoRecordIds(db);
  const tables: Record<string, unknown[]> = {};
  for (const t of MIGRATION_TABLES) {
    const rows = (db[t] as unknown as Record<string, unknown>[]) ?? [];
    tables[t] = rows
      .filter((r) => {
        const demo = typeof r.id === 'string' && demoIds.has(r.id);
        if (demo && !includeDemo) {
          excluded.demoRows++;
          return false;
        }
        return true;
      })
      .map((r) => {
        const out = { ...r };
        if (t === 'users' && ('passwordHash' in out || 'passwordSalt' in out)) {
          delete out.passwordHash;
          delete out.passwordSalt;
          excluded.passwordHashes++;
        }
        if (t === 'scans' && out.imageDataUrl && !includeImages) {
          delete out.imageDataUrl;
          excluded.images++;
        }
        return out;
      });
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return {
    kind: 'physiovision-migration',
    version: 1,
    schemaVersion: db.schemaVersion,
    exportedAt: new Date().toISOString(),
    options: { includeDemo, includeImages },
    excluded,
    counts,
    tables,
    sha256: await sha256Hex(canonical(tables)),
  };
}

/** Verify integrity and default privacy policy before any future server import. Not authentication. */
export async function verifyMigrationBundle(input: unknown, opts: { allowDemo?: boolean; allowImages?: boolean } = {}): Promise<MigrationBundle> {
  if (!input || typeof input !== 'object') throw new Error('Invalid migration bundle');
  const b = input as MigrationBundle;
  if (b.kind !== 'physiovision-migration' || b.version !== 1 || !Number.isInteger(b.schemaVersion) || b.schemaVersion < 1 || !Number.isFinite(Date.parse(b.exportedAt))) throw new Error('Unsupported migration bundle');
  if (!b.options || !b.excluded || !b.tables || !b.counts || !/^[a-f0-9]{64}$/.test(b.sha256)) throw new Error('Incomplete migration bundle');
  if (b.options.includeDemo && !opts.allowDemo) throw new Error('Demo data import is disabled');
  if (b.options.includeImages && !opts.allowImages) throw new Error('Image import requires separate consent');
  if (Object.keys(b.tables).length !== MIGRATION_TABLES.length || Object.keys(b.counts).length !== MIGRATION_TABLES.length) throw new Error('Unexpected migration table');
  for (const t of MIGRATION_TABLES) {
    if (!Array.isArray(b.tables[t]) || b.counts[t] !== b.tables[t].length) throw new Error(`Invalid row count for ${t}`);
  }
  if (b.tables.users.some((u) => u && typeof u === 'object' && ('passwordHash' in u || 'passwordSalt' in u))) throw new Error('Local credentials may not be imported');
  if (!opts.allowDemo && MIGRATION_TABLES.some((t) => b.tables[t].some((r) => r && typeof r === 'object' && (r as { isDemo?: boolean }).isDemo === true))) throw new Error('Demo data found in bundle');
  if (!opts.allowImages && b.tables.scans.some((r) => r && typeof r === 'object' && 'imageDataUrl' in r)) throw new Error('Images found in bundle');
  if (await sha256Hex(canonical(b.tables)) !== b.sha256) throw new Error('Migration checksum mismatch');
  return b;
}
