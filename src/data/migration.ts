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

const TABLES = ['users', 'patients', 'clinicians', 'careRelationships', 'consents', 'assessments', 'painRegions', 'pros', 'scans', 'measurements', 'observations', 'programs', 'programExercises', 'sessions', 'notes', 'alerts', 'messages', 'audit', 'radiationPaths', 'intakeAnswers', 'safetyResponses', 'amendments', 'testPlans', 'captures', 'reasoningDecisions', 'impressions', 'reports'] as const;

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
  const demoPatients = new Set(db.patients.filter((p) => p.isDemo).map((p) => p.id));
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = (db[t] as unknown as Record<string, unknown>[]) ?? [];
    tables[t] = rows
      .filter((r) => {
        const demo = r.isDemo === true || (typeof r.patientId === 'string' && demoPatients.has(r.patientId)) || (r.provenance as { source?: string } | undefined)?.source === 'simulated_demo';
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
