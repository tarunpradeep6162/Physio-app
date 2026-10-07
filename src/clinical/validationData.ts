import type { DB } from '../data/models';
import { agreement, bySubgroup, checkRelease, failureRate, repeatability, type AgreementStats } from '../engine/validationStats';

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
  /** Subgroup fields (STUDY_PROTOCOL step 6); 'not recorded' when absent. */
  lighting: string;
  clothing: string;
  /** Only present with the participant's consent; otherwise 'not recorded'. */
  skinToneBand: string;
  sex: string;
  ageBand: string;
}

const NR = 'not recorded';

/** Age band at the capture date. Bands are descriptive groupings for reporting, not norms. */
export function ageBand(dob: string | undefined, at: string): string {
  if (!dob) return NR;
  const b = new Date(dob), d = new Date(at);
  if (!Number.isFinite(b.getTime()) || !Number.isFinite(d.getTime())) return NR;
  let age = d.getFullYear() - b.getFullYear();
  if (d.getMonth() < b.getMonth() || (d.getMonth() === b.getMonth() && d.getDate() < b.getDate())) age--;
  return age < 40 ? 'under 40' : age < 65 ? '40–64' : '65 and over';
}

function deviceClass(ua: string): string {
  return /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : ua ? 'desktop/other' : 'unknown';
}

/** A prospective threshold lock is unavailable once real evaluation data of either kind exists. */
export function hasFinalEvaluationData(db: DB): boolean {
  const patients = new Set(db.patients.filter((p) => p.validationSplit === 'evaluation' && !p.isDemo).map((p) => p.id));
  const eligible = (patientId: string, assessmentId?: string) =>
    patients.has(patientId) && !db.assessments.find((a) => a.id === assessmentId)?.isDemo;
  return db.captures.some((cap) => !cap.isDemo && cap.provenance.source === 'camera_estimation' &&
    eligible(cap.patientId, cap.assessmentId)) ||
    db.measurements.some((m) => !m.isDemo && !!m.reference && eligible(m.patientId, m.assessmentId));
}

export function validationPairs(db: DB): ValidationPair[] {
  const out: ValidationPair[] = [];
  // Repeated references to one camera result are ambiguous, not independent study samples.
  const refCounts = new Map<string, number>();
  for (const m of db.measurements) if (m.captureId && m.metricId && m.reference && !m.isDemo) {
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
      device: deviceClass(ua),
      model: `${cap.provenance.poseModel ?? '?'}${cap.provenance.device?.inferenceThread ? ` · ${cap.provenance.device.inferenceThread}` : ''}`,
      view: cap.result.view,
      captureId: cap.id,
      referenceAt: m.createdAt,
      lighting: m.reference.conditions?.lighting ?? NR,
      clothing: m.reference.conditions?.clothing ?? NR,
      skinToneBand: m.reference.conditions?.skinToneConsent && m.reference.conditions.skinToneBand ? m.reference.conditions.skinToneBand : NR,
      sex: patient.sex ?? NR,
      ageBand: ageBand(patient.dob, cap.createdAt),
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
  /** Why attempts failed (capture quality reasons and metric validity reasons), most frequent first. */
  failureReasons: { reason: string; count: number }[];
  /** Test–retest from a second session on a different day (STUDY_PROTOCOL step 4). */
  repeatability: { n: number; icc: number | null; sem: number | null; mdc95: number | null; excluded: { reason: string; count: number }[] };
  /** Missing data, shown rather than silently dropped. */
  missing: { validCaptureNoReference: number; referenceCameraInvalid: number };
  /** Agreement per subgroup, each with its own n (small groups are reported, never pooled away). */
  subgroups: Record<SubgroupKey, { group: string; n: number; agreement: AgreementStats | null }[]>;
  /** Only for the evaluation split, only when thresholds were locked BEFORE the first evaluation reference. */
  release: { pass: boolean; reasons: string[]; preSpecified: boolean } | null;
}

export const SUBGROUP_KEYS = ['device', 'model', 'view', 'lighting', 'clothing', 'skinToneBand', 'sex', 'ageBand'] as const;
export type SubgroupKey = (typeof SUBGROUP_KEYS)[number];

function eligibleCapture(db: DB, cap: DB['captures'][number], split: 'tuning' | 'evaluation'): boolean {
  const patient = db.patients.find((p) => p.id === cap.patientId);
  const assessment = db.assessments.find((a) => a.id === cap.assessmentId);
  return patient?.validationSplit === split && !patient.isDemo && !cap.isDemo && !assessment?.isDemo && cap.provenance.source === 'camera_estimation';
}

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export interface RetestPair {
  patientId: string;
  first: number;
  second: number;
  firstCaptureId: string;
  secondCaptureId: string;
  intervalDays: number;
}

/**
 * Test–retest pairs for one metric and split: a participant's first valid capture and their first
 * valid capture on a LATER DAY with the same protocol version, side, view and device class
 * (STUDY_PROTOCOL step 4). Participants without such a second session are counted with the reason.
 */
export function retestPairs(db: DB, metricId: string, split: 'tuning' | 'evaluation'): { pairs: RetestPair[]; excluded: { reason: string; count: number }[] } {
  const valid = db.captures
    .filter((cap) => eligibleCapture(db, cap, split) && Number.isFinite(Date.parse(cap.createdAt)))
    .map((cap) => ({ cap, m: cap.result.metrics.find((x) => x.id === metricId) }))
    .filter((x): x is { cap: typeof x.cap; m: NonNullable<typeof x.m> } => !!x.m && x.cap.result.quality.verdict === 'valid' && x.m.validity === 'valid' && x.m.value !== null)
    .sort((a, b) => a.cap.createdAt.localeCompare(b.cap.createdAt));
  const byPerson = new Map<string, typeof valid>();
  for (const v of valid) {
    const k = `${v.cap.patientId}|${v.m.side ?? v.cap.side ?? '-'}`;
    byPerson.set(k, [...(byPerson.get(k) ?? []), v]);
  }
  const pairs: RetestPair[] = [];
  const excluded = new Map<string, number>();
  const skip = (r: string) => excluded.set(r, (excluded.get(r) ?? 0) + 1);
  for (const list of byPerson.values()) {
    const a = list[0];
    const setup = (x: typeof a) => `${x.cap.protocolId}@${x.cap.protocolVersion}|${x.cap.result.view}|${deviceClass(x.cap.provenance.device?.userAgent ?? '')}`;
    const later = list.filter((x) => localDay(x.cap.createdAt) !== localDay(a.cap.createdAt));
    if (!later.length) {
      skip('no valid second-day session');
      continue;
    }
    const b = later.find((x) => setup(x) === setup(a));
    if (!b) {
      skip('second session differs in protocol version, view or device');
      continue;
    }
    pairs.push({ patientId: a.cap.patientId, first: a.m.value!, second: b.m.value!, firstCaptureId: a.cap.id, secondCaptureId: b.cap.id, intervalDays: Math.round((Date.parse(b.cap.createdAt) - Date.parse(a.cap.createdAt)) / 86_400_000) });
  }
  return { pairs, excluded: [...excluded].map(([reason, count]) => ({ reason, count })) };
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
    const retest = retestPairs(db, metricId, split);
    const rep = repeatability(retest.pairs.map((p) => ({ first: p.first, second: p.second })));
    const reasons = new Map<string, number>();
    for (const cap of attempts) {
      const m = cap.result.metrics.find((x) => x.id === metricId)!;
      if (cap.result.quality.verdict === 'valid' && m.validity === 'valid' && m.value !== null) continue;
      const why = cap.result.quality.verdict !== 'valid' ? cap.result.quality.reasons.length ? cap.result.quality.reasons : ['capture quality invalid'] : [m.reason ?? 'metric withheld'];
      for (const w of why) reasons.set(w, (reasons.get(w) ?? 0) + 1);
    }
    const referenced = new Set(ps.map((p) => p.captureId));
    const missing = {
      validCaptureNoReference: attempts.filter((cap) => {
        const m = cap.result.metrics.find((x) => x.id === metricId)!;
        return cap.result.quality.verdict === 'valid' && m.validity === 'valid' && m.value !== null && !referenced.has(cap.id);
      }).length,
      referenceCameraInvalid: ps.filter((p) => !p.cameraValid).length,
    };
    const validPairs = ps.filter((p) => p.cameraValid && p.camera !== null).map((p) => ({ ...p, camera: p.camera!, reference: p.reference }));
    const subgroups = Object.fromEntries(SUBGROUP_KEYS.map((k) => {
      const g = bySubgroup(validPairs, (p) => String(p[k]));
      return [k, Object.entries(g).map(([group, ag]) => ({ group, n: validPairs.filter((p) => String(p[k]) === group).length, agreement: ag })).sort((x, y) => y.n - x.n)];
    })) as MetricSummary['subgroups'];
    let release: MetricSummary['release'] = null;
    if (split === 'evaluation') {
      const t = rt?.values[metricId];
      const firstEval = Math.min(
        ...ps.map((p) => Date.parse(p.referenceAt)),
        ...attempts.map((cap) => Date.parse(cap.createdAt)),
      );
      const preSpecified = !!rt && Number.isFinite(firstEval) && Date.parse(rt.lockedAt) < firstEval;
      if (t) {
        const r = checkRelease({ metric: metricId, ...t }, a, fr, rep);
        release = { ...r, preSpecified };
        if (!preSpecified) release.reasons.unshift('thresholds were not locked before the evaluation data existed');
        release.pass = release.pass && preSpecified;
      } else release = { pass: false, reasons: ['no release threshold set for this metric'], preSpecified: false };
    }
    return {
      metricId,
      split,
      participants: new Set(attempts.map((cap) => cap.patientId)).size,
      agreement: a,
      failure: fr,
      failureReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((x, y) => y.count - x.count),
      repeatability: { ...rep, excluded: retest.excluded },
      missing,
      subgroups,
      release,
    };
  });
}
