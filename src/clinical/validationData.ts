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
  // Repeated references to one camera result are ambiguous, not independent study samples.
  const refCounts = new Map<string, number>();
  for (const m of db.measurements) if (m.captureId && m.metricId && m.reference) {
    const key = `${m.captureId}|${m.metricId}`;
    refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
  }
  for (const m of db.measurements) {
    if (m.category !== 'clinician_measured' || !m.reference?.blinded || !m.captureId || !m.metricId || m.isDemo || !Number.isFinite(m.value)) continue;
    if (refCounts.get(`${m.captureId}|${m.metricId}`) !== 1) continue;
    const cap = db.captures.find((c) => c.id === m.captureId);
    const patient = db.patients.find((p) => p.id === m.patientId);
    const assessment = db.assessments.find((a) => a.id === cap?.assessmentId);
    if (!cap || !patient?.validationSplit || patient.isDemo || cap.isDemo || assessment?.isDemo ||
      m.patientId !== cap.patientId || cap.provenance.source !== 'camera_estimation' ||
      !Number.isFinite(Date.parse(m.createdAt)) || !Number.isFinite(Date.parse(cap.createdAt))) continue;
    if (m.unit !== cap.result.metrics.find((x) => x.id === m.metricId)?.unit) continue;
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
  const keys = new Set(pairs.map((p) => `${p.metricId}|${p.split}`));
  for (const cap of db.captures) {
    const patient = db.patients.find((p) => p.id === cap.patientId);
    const assessment = db.assessments.find((a) => a.id === cap.assessmentId);
    if (!patient?.validationSplit || patient.isDemo || cap.isDemo || assessment?.isDemo ||
      cap.provenance.source !== 'camera_estimation') continue;
    for (const metric of cap.result.metrics) keys.add(`${metric.id}|${patient.validationSplit}`);
  }
  const rt = db.settings.releaseThresholds ?? null;
  return [...keys].sort().map((k) => {
    const [metricId, split] = k.split('|') as [string, 'tuning' | 'evaluation'];
    const ps = pairs.filter((p) => p.metricId === metricId && p.split === split);
    const valid = ps.filter((p) => p.cameraValid && p.camera !== null).map((p) => ({ camera: p.camera!, reference: p.reference }));
    const a = agreement(valid);
    // Every eligible attempt is counted, even if its failed capture has no reference measurement.
    const attempts = db.captures.filter((cap) => {
      const patient = db.patients.find((p) => p.id === cap.patientId);
      const assessment = db.assessments.find((a) => a.id === cap.assessmentId);
      return patient?.validationSplit === split && !patient.isDemo && !cap.isDemo &&
        !assessment?.isDemo && cap.provenance.source === 'camera_estimation' &&
        cap.result.metrics.some((m) => m.id === metricId);
    });
    const fr = failureRate(attempts.map((cap) => {
      const m = cap.result.metrics.find((x) => x.id === metricId)!;
      return { valid: cap.result.quality.verdict === 'valid' && m.validity === 'valid' && m.value !== null };
    }));
    let release: MetricSummary['release'] = null;
    if (split === 'evaluation') {
      const t = rt?.values[metricId];
      const firstEval = Math.min(
        ...ps.map((p) => Date.parse(p.referenceAt)),
        ...attempts.map((cap) => Date.parse(cap.createdAt)),
      );
      const preSpecified = !!rt && Number.isFinite(firstEval) && Date.parse(rt.lockedAt) < firstEval;
      if (t) {
        // Test–retest needs repeated sessions per participant; not derivable from single pairs here.
        const r = checkRelease({ metric: metricId, ...t }, a, fr, { icc: null, n: 0 });
        release = { ...r, preSpecified };
        if (!preSpecified) release.reasons.unshift('thresholds were not locked before the evaluation data existed');
        release.pass = release.pass && preSpecified;
      } else release = { pass: false, reasons: ['no release threshold set for this metric'], preSpecified: false };
    }
    return { metricId, split, participants: new Set(attempts.map((cap) => cap.patientId)).size, agreement: a, failure: fr, release };
  });
}
