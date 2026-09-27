import type { DB } from '../data/models';
import { agreement, checkRelease, failureRate, type AgreementStats } from '../engine/validationStats';

/**
 * Builds the validation dataset from the local records: camera metric ↔ clinician reference pairs
 * and capture attempts, split by PARTICIPANT (tuning vs final evaluation). Simulated/demo data is
 * excluded — it can never count as validation evidence.
 */

export interface ValidationPair {
  metricId: string;
  protocol: string;
  patientId: string;
  split: 'tuning' | 'evaluation';
  camera: number | null;
  cameraValid: boolean;
  reference: number;
  instrument: string;
  blinded: boolean;
  device: string;
  model: string;
  view: string;
  captureId: string;
  referenceAt: string;
}

export function validationPairs(db: DB): ValidationPair[] {
  const out: ValidationPair[] = [];
  for (const m of db.measurements) {
    if (m.category !== 'clinician_measured' || !m.reference || !m.captureId || !m.metricId || m.isDemo) continue;
    const cap = db.captures.find((c) => c.id === m.captureId);
    const patient = db.patients.find((p) => p.id === m.patientId);
    if (!cap || !patient?.validationSplit || cap.provenance.source === 'simulated_demo') continue;
    const cm = cap.result.metrics.find((x) => x.id === m.metricId);
    const valid = !!cm && cm.validity === 'valid' && cm.value !== null && cap.result.quality.verdict === 'valid';
    const ua = cap.provenance.device?.userAgent ?? '';
    out.push({
      metricId: m.metricId,
      protocol: `${cap.protocolId}@${cap.protocolVersion}`,
      patientId: m.patientId,
      split: patient.validationSplit,
      camera: valid ? cm!.value : null,
      cameraValid: valid,
      reference: m.value,
      instrument: m.reference.instrument,
      blinded: m.reference.blinded,
      device: /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : ua ? 'desktop/other' : 'unknown',
      model: `${cap.provenance.poseModel ?? '?'}${cap.provenance.device?.inferenceThread ? ` · ${cap.provenance.device.inferenceThread}` : ''}`,
      view: cap.result.view,
      captureId: cap.id,
      referenceAt: m.createdAt,
    });
  }
  return out;
}

export interface MetricSummary {
  metricId: string;
  split: 'tuning' | 'evaluation';
  participants: number;
  agreement: AgreementStats | null;
  failure: { n: number; failed: number; rate: number | null };
  /** Only for the evaluation split, only when thresholds were locked BEFORE the first evaluation reference. */
  release: { pass: boolean; reasons: string[]; preSpecified: boolean } | null;
}

export function summariseValidation(db: DB): MetricSummary[] {
  const pairs = validationPairs(db);
  const keys = [...new Set(pairs.map((p) => `${p.metricId}|${p.split}`))].sort();
  const rt = db.settings.releaseThresholds ?? null;
  return keys.map((k) => {
    const [metricId, split] = k.split('|') as [string, 'tuning' | 'evaluation'];
    const ps = pairs.filter((p) => p.metricId === metricId && p.split === split);
    const valid = ps.filter((p) => p.cameraValid && p.camera !== null).map((p) => ({ camera: p.camera!, reference: p.reference }));
    const a = agreement(valid);
    const fr = failureRate(ps.map((p) => ({ valid: p.cameraValid })));
    let release: MetricSummary['release'] = null;
    if (split === 'evaluation') {
      const t = rt?.values[metricId];
      const firstEval = ps.map((p) => p.referenceAt).sort()[0];
      const preSpecified = !!rt && !!firstEval && rt.lockedAt < firstEval;
      if (t) {
        // Test–retest needs repeated sessions per participant; not derivable from single pairs here.
        const r = checkRelease({ metric: metricId, ...t }, a, fr, { icc: null, n: 0 });
        release = { ...r, preSpecified };
        if (!preSpecified) release.reasons.unshift('thresholds were not locked before the evaluation data existed');
        release.pass = release.pass && preSpecified;
      } else release = { pass: false, reasons: ['no release threshold set for this metric'], preSpecified: false };
    }
    return { metricId, split, participants: new Set(ps.map((p) => p.patientId)).size, agreement: a, failure: fr, release };
  });
}
