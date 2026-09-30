import type { DB, ID } from '../data/models';

/**
 * Clinician directory helpers. The patient code is an opaque display ID derived from the record's
 * random UUID — it carries no name, phone or date — so it is safe to show in lists and to type into
 * a search box. URLs keep using the full UUID.
 */

export function patientCode(id: ID): string {
  return `PT-${id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export interface MonthVolume {
  /** YYYY-MM */
  month: string;
  newPatients: number;
  assessments: number;
}

/** New patient registrations and assessments started per calendar month, oldest first. */
export function monthlyVolume(db: Pick<DB, 'patients' | 'assessments'>, months: number, now = new Date()): MonthVolume[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const rows = new Map(keys.map((k) => [k, { month: k, newPatients: 0, assessments: 0 }]));
  for (const p of db.patients) {
    const row = rows.get(p.createdAt.slice(0, 7));
    if (row) row.newPatients++;
  }
  for (const a of db.assessments) {
    const row = rows.get(a.createdAt.slice(0, 7));
    if (row) row.assessments++;
  }
  return keys.map((k) => rows.get(k)!);
}
