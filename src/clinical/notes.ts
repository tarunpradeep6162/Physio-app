import type { ClinicalNote, ID, Measurement, NoteMeasurement, Observation, PatientReportedOutcome } from '../data/models';

/**
 * Phase 48: structured notes and quoted measurements. Every quoted value carries its source, so a
 * camera estimate, an algorithmic observation, a patient report and a clinician finding stay
 * distinguishable inside the note and any letter built from it. Quotes are frozen snapshots.
 */
export const SOURCE_LABEL: Record<NoteMeasurement['source'], string> = {
  patient_report: 'Patient-reported',
  camera_estimate: 'Camera estimate',
  algorithmic_observation: 'Algorithmic observation',
  clinician_finding: 'Clinician finding',
};

const unit = (m: Measurement) => (m.unit === 'deg' ? '°' : m.unit === 's' ? ' s' : m.unit === 'pct_height' || m.unit === 'pct_leg' ? '%' : '');
const round = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));

/** Quote a measurement. A withheld (invalid) camera value is quoted as withheld, never as a number. */
export function quoteMeasurement(m: Measurement, label: string): NoteMeasurement {
  const camera = m.category === 'camera_estimate';
  const invalid = m.validity === 'invalid';
  return {
    measurementId: m.id,
    label: m.side && !label.toLowerCase().includes(m.side) ? `${label} (${m.side})` : label,
    value: invalid ? `withheld${m.validityReason ? `: ${m.validityReason}` : ''}` : `${round(m.value)}${unit(m)}`,
    source: camera ? 'camera_estimate' : 'clinician_finding',
    view: m.provenance.view,
    quality: camera ? `confidence ${Math.round(m.confidence * 100)}%${m.reviewStatus !== 'pending' ? `, ${m.reviewStatus.replace('_', ' ')}` : ', not yet reviewed'}` : m.reference ? `instrument: ${m.reference.instrument}` : undefined,
    version: camera ? m.provenance.algorithmVersion : undefined,
    recordedAt: m.createdAt,
  };
}

/** Quote an algorithmic observation (a threshold crossing), with its rule, threshold and review state. */
export function quoteObservation(o: Observation, label: string): NoteMeasurement {
  return {
    measurementId: o.measurementId,
    label: `${label}: ${o.rule}`,
    value: `${round(o.value)} (threshold ${round(o.threshold)})`,
    source: 'algorithmic_observation',
    quality: o.status === 'pending' ? 'awaiting clinician review' : o.status.replace('_', ' '),
    recordedAt: o.createdAt,
  };
}

/** Quote a patient-reported answer verbatim. */
export function quotePro(p: PatientReportedOutcome, label: string): NoteMeasurement {
  const v = p.value;
  const text = typeof v === 'number' || typeof v === 'string' ? String(v) : Array.isArray(v) ? v.join(', ') : 'pain' in v ? `${v.pain}/10${v.note ? ` — "${v.note}"` : ''}` : Object.entries(v).filter(([, b]) => b).map(([k]) => k).join(', ');
  return { measurementId: p.id, label, value: text, source: 'patient_report', recordedAt: p.recordedAt };
}

export function formatQuote(q: NoteMeasurement): string {
  const extra = [q.view && `view ${q.view}`, q.quality, q.version && `version ${q.version}`].filter(Boolean).join('; ');
  return `${q.label}: ${q.value} [${SOURCE_LABEL[q.source]}${extra ? `; ${extra}` : ''}; ${q.recordedAt.slice(0, 10)}]`;
}

export type Soap = NonNullable<ClinicalNote['soap']>;
export const SOAP_HEADINGS: Record<keyof Soap, string> = { subjective: 'S — Subjective', objective: 'O — Objective', assessment: 'A — Assessment', plan: 'P — Plan' };

export function soapBody(soap: Soap, inserted: NoteMeasurement[] = []): string {
  const parts = (Object.keys(SOAP_HEADINGS) as (keyof Soap)[]).filter((k) => soap[k].trim()).map((k) => `${SOAP_HEADINGS[k]}\n${soap[k].trim()}`);
  if (inserted.length) parts.push(`Quoted measurements\n${inserted.map(formatQuote).join('\n')}`);
  return parts.join('\n\n');
}

export function soapEmpty(soap: Soap): boolean {
  return !Object.values(soap).some((v) => v.trim());
}

/**
 * Notes are never edited: a correction is a new note with `amends`. Returns each chain's current
 * version (newest first) with the versions it replaced, oldest first.
 */
export function noteChains(notes: ClinicalNote[]): { current: ClinicalNote; history: ClinicalNote[] }[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const replaced = new Set(notes.map((n) => n.amends).filter((x): x is ID => !!x));
  return notes
    .filter((n) => !replaced.has(n.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((current) => {
      const history: ClinicalNote[] = [];
      let at = current.amends ? byId.get(current.amends) : undefined;
      while (at && history.length < 50) {
        history.unshift(at);
        at = at.amends ? byId.get(at.amends) : undefined;
      }
      return { current, history };
    });
}
