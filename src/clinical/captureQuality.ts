import type { DB } from '../data/models';
import { deviceClass } from './validationData';

/**
 * Phase 50: capture quality dashboard. Counts camera captures and metrics that were withheld, and
 * why, by protocol version, view and device class. These are descriptive counts of where capture
 * fails in this clinic; they say nothing about how accurate the values that passed are.
 */
export interface QualityRow {
  key: string;
  protocol: string;
  view: string;
  device: string;
  captures: number;
  invalidCaptures: number;
  metrics: number;
  withheldMetrics: number;
}

export interface QualitySummary {
  rows: QualityRow[];
  /** Reasons a capture or metric was withheld, most frequent first. */
  reasons: { reason: string; count: number }[];
  /** Desk and posture checks (measurements without a capture) withheld, by reason. */
  staticWithheld: { reason: string; count: number }[];
  totals: { captures: number; invalidCaptures: number; metrics: number; withheldMetrics: number };
  /** Demo rows are always excluded. */
  excludedDemo: number;
}

const tally = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const sorted = (m: Map<string, number>) => [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

export function captureQuality(db: DB, opts: { since?: string } = {}): QualitySummary {
  const rows = new Map<string, QualityRow>();
  const reasons = new Map<string, number>();
  const staticReasons = new Map<string, number>();
  let excludedDemo = 0;
  for (const cap of db.captures) {
    if (cap.isDemo) {
      excludedDemo++;
      continue;
    }
    if (opts.since && cap.createdAt < opts.since) continue;
    const protocol = `${cap.protocolId}@${cap.protocolVersion}`;
    const view = cap.result.view ?? 'unknown';
    const device = deviceClass(cap.provenance.device?.userAgent ?? '');
    const key = `${protocol}|${view}|${device}`;
    const row = rows.get(key) ?? { key, protocol, view, device, captures: 0, invalidCaptures: 0, metrics: 0, withheldMetrics: 0 };
    row.captures++;
    if (cap.result.quality.verdict === 'invalid') {
      row.invalidCaptures++;
      for (const r of cap.result.quality.reasons.length ? cap.result.quality.reasons : ['no reason recorded']) tally(reasons, r);
    }
    for (const m of cap.result.metrics) {
      row.metrics++;
      if (m.validity === 'invalid' || m.value === null) {
        row.withheldMetrics++;
        tally(reasons, m.reason ?? 'no reason recorded');
      }
    }
    rows.set(key, row);
  }
  for (const m of db.measurements) {
    if (m.captureId || m.category !== 'camera_estimate') continue;
    if (m.isDemo) {
      excludedDemo++;
      continue;
    }
    if (opts.since && m.createdAt < opts.since) continue;
    if (m.validity === 'invalid') tally(staticReasons, m.validityReason ?? 'no reason recorded');
  }
  const list = [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
  const sum = (k: keyof Omit<QualityRow, 'key' | 'protocol' | 'view' | 'device'>) => list.reduce((n, r) => n + r[k], 0);
  return {
    rows: list,
    reasons: sorted(reasons),
    staticWithheld: sorted(staticReasons),
    totals: { captures: sum('captures'), invalidCaptures: sum('invalidCaptures'), metrics: sum('metrics'), withheldMetrics: sum('withheldMetrics') },
    excludedDemo,
  };
}
