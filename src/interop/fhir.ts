import { capturesFor } from '../clinical/evidence';
import type { DailyCheckin, DB, ID } from '../data/models';
import { getProtocol } from '../engine/protocols/registry';
import { dailyActivity } from '../integrations/activity';
import { activityConsent } from '../integrations/activityStore';
import type { DeviceMeasurement } from './deviceMeasurements';

/**
 * Structured export for care systems (Phase 18): a FHIR R4 `collection` Bundle.
 *
 * - Camera values are Observations with method "camera-estimated 2D pose", status `preliminary`,
 *   and extensions for protocol, algorithm, view and quality. An invalid capture is exported with a
 *   dataAbsentReason, never with a number.
 * - Device measurements (strength, force, balance platform, goniometer) are separate Observations
 *   referencing a Device resource with manufacturer/model/serial and a calibration extension.
 * - Patient-reported pain uses LOINC 72514-3; device steps use LOINC 55423-8. Other measures use
 *   this product's own code system (no external code is claimed where none was verified).
 * - AI consultation drafts are never exported; only a clinician-signed impression is.
 * - Simulated/demo records carry a `simulated` meta tag.
 */

export const FHIR_EXPORT_VERSION = 'dl-fhir-export-1.0.0';
const SYS = 'https://dheepika-lab.example/fhir/CodeSystem/measure';
const EXT = 'https://dheepika-lab.example/fhir/StructureDefinition';
const UCUM = 'http://unitsofmeasure.org';
const UCUM_CODE: Record<string, string> = { deg: 'deg', s: 's', kg: 'kg', N: 'N', Nm: 'N.m', mm: 'mm', mm2: 'mm2', cm: 'cm', pct_leg: '%', count: '1' };

type Resource = Record<string, unknown> & { resourceType: string; id: string };
const cat = (code: 'exam' | 'survey' | 'activity') => [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code }] }];
const simTag = (sim: boolean | undefined) => (sim ? { meta: { tag: [{ system: `${EXT}/tag`, code: 'simulated', display: 'Simulated demonstration data — not a real patient measurement' }] } } : {});

export type FhirBundle = { resourceType: 'Bundle'; id: string; type: 'collection'; timestamp: string; meta: unknown; entry: { fullUrl: string; resource: Resource }[] };

export function exportPatientBundle(db: DB, patientId: ID, deviceRows: DeviceMeasurement[], now: string): FhirBundle {
  const p = db.patients.find((x) => x.id === patientId)!;
  const subject = { reference: `Patient/${p.id}` };
  const entries: Resource[] = [];
  entries.push({ resourceType: 'Patient', id: p.id, ...simTag(p.isDemo), name: [{ text: p.name }], ...(p.dob ? { birthDate: p.dob } : {}) });

  // Camera-estimated kinematics.
  for (const a of db.assessments.filter((x) => x.patientId === p.id && x.status !== 'in_progress')) {
    for (const c of capturesFor(db, a.id)) {
      const def = getProtocol(c.protocolId, c.protocolVersion);
      const valid = c.result.quality.verdict === 'valid';
      for (const m of c.result.metrics) {
        const ok = valid && m.validity === 'valid' && m.value !== null;
        entries.push({
          resourceType: 'Observation',
          id: `cam-${c.id}-${m.id}`,
          ...simTag(c.isDemo || c.provenance.source === 'simulated_demo'),
          status: 'preliminary',
          category: cat('exam'),
          code: { coding: [{ system: SYS, code: m.id, display: m.label }], text: m.label },
          subject,
          effectiveDateTime: c.createdAt,
          issued: now,
          ...(c.side ? { bodySite: { text: c.side } } : {}),
          method: { text: `Camera-estimated 2D pose — ${def.title} (${c.protocolId}@${c.protocolVersion}, ${c.result.algorithmVersion}). Kinematics only; not strength or force.` },
          ...(ok ? { valueQuantity: { value: m.value, unit: m.unit, system: UCUM, code: UCUM_CODE[m.unit] ?? '1' } } : { dataAbsentReason: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason', code: 'error' }], text: m.reason ?? c.result.quality.reasons.join('; ') } }),
          extension: [
            { url: `${EXT}/source`, valueCode: 'camera_estimate' },
            { url: `${EXT}/protocol`, valueString: `${c.protocolId}@${c.protocolVersion}` },
            { url: `${EXT}/algorithm`, valueString: c.result.algorithmVersion },
            { url: `${EXT}/view`, valueString: c.result.view },
            { url: `${EXT}/quality`, valueString: `${c.result.quality.verdict}; coverage ${Math.round(c.result.quality.coverage * 100)}%` },
          ],
        });
      }
    }
    // A clinician-signed impression (never the AI draft).
    const imp = db.impressions.filter((i) => i.assessmentId === a.id).sort((x, y) => y.at.localeCompare(x.at))[0];
    if (imp) entries.push({ resourceType: 'ClinicalImpression', id: `imp-${imp.id}`, ...simTag(a.isDemo), status: 'completed', subject, date: imp.at, summary: imp.text, assessor: { display: db.clinicians.find((x) => x.id === imp.by || x.userId === imp.by)?.name ?? 'clinician' } });
  }

  // Device-measured strength / force / balance / instrument readings.
  const devices = new Map<string, Resource>();
  for (const d of deviceRows.filter((x) => x.patientId === p.id)) {
    const key = `${d.device.manufacturer}|${d.device.model}|${d.device.serial ?? ''}`;
    if (!devices.has(key))
      devices.set(key, {
        resourceType: 'Device',
        id: `dev-${devices.size + 1}`,
        manufacturer: d.device.manufacturer,
        deviceName: [{ name: d.device.model, type: 'model-name' }],
        ...(d.device.serial ? { serialNumber: d.device.serial } : {}),
        type: { text: d.kind.replace(/_/g, ' ') },
      });
    const dev = devices.get(key)!;
    entries.push({
      resourceType: 'Observation',
      id: `dev-${d.id}`,
      ...simTag(d.isDemo),
      status: 'final',
      category: cat('exam'),
      code: { coding: [{ system: SYS, code: `device.${d.kind}`, display: d.measure }], text: d.measure },
      subject,
      effectiveDateTime: d.measuredAt,
      issued: d.createdAt,
      ...(d.side ? { bodySite: { text: d.side } } : {}),
      method: { text: `Device-measured with ${d.device.manufacturer} ${d.device.model}${d.summary ? ` (${d.summary} of ${d.trials?.length ?? 1} trial(s))` : ''}${d.protocolNote ? `; ${d.protocolNote}` : ''}` },
      device: { reference: `Device/${dev.id}` },
      valueQuantity: { value: d.value, unit: d.unit, system: UCUM, code: UCUM_CODE[d.unit] ?? '1' },
      ...(d.trials ? { component: d.trials.map((t, i) => ({ code: { text: `trial ${i + 1}` }, valueQuantity: { value: t, unit: d.unit, system: UCUM, code: UCUM_CODE[d.unit] ?? '1' } })) } : {}),
      extension: [
        { url: `${EXT}/source`, valueCode: d.source.kind === 'file_import' ? 'device_import' : 'clinician_entry' },
        { url: `${EXT}/calibration`, valueString: `${d.calibration.status}${d.calibration.lastCalibrated ? `; last calibrated ${d.calibration.lastCalibrated}` : ''}${d.calibration.certificateRef ? `; certificate ${d.calibration.certificateRef}` : ''}` },
        ...(d.source.file ? [{ url: `${EXT}/import`, valueString: `${d.source.file} row ${d.source.row ?? '?'} at ${d.source.importedAt}` }] : []),
      ],
    });
  }
  entries.push(...devices.values());

  // Patient-reported pain (0–10 NRS).
  const pain = [
    ...db.intakeAnswers.filter((r) => r.patientId === p.id && r.questionId === 'nprs_now' && typeof r.answer === 'number' && !r.supersededBy).map((r) => ({ id: r.id, at: r.answeredAt, v: r.answer as number, ctx: 'assessment intake', demo: r.isDemo })),
    ...db.pros.filter((x) => x.patientId === p.id && x.type === 'daily_checkin').map((x) => ({ id: x.id, at: x.recordedAt, v: (x.value as DailyCheckin).pain, ctx: 'daily check-in', demo: x.isDemo })),
  ];
  for (const r of pain)
    entries.push({ resourceType: 'Observation', id: `nrs-${r.id}`, ...simTag(r.demo), status: 'final', category: cat('survey'), code: { coding: [{ system: 'http://loinc.org', code: '72514-3', display: 'Pain severity - 0-10 verbal numeric rating [Score] - Reported' }] }, subject, effectiveDateTime: r.at, valueInteger: r.v, performer: [subject], note: [{ text: `Patient-reported (${r.ctx})` }] });

  // Device-imported daily steps (only while consent is granted; days without data are omitted, never 0).
  if (activityConsent(db, p.id, 'steps').granted) {
    const samples = db.activitySamples.filter((s) => s.patientId === p.id && s.metric === 'steps');
    const days = [...new Set(samples.map((s) => new Date(Date.parse(s.start) + s.tzOffsetMin * 60_000).toISOString().slice(0, 10)))].sort();
    for (const d of dailyActivity(samples, 'steps', days))
      if (d.value !== null)
        entries.push({ resourceType: 'Observation', id: `steps-${d.day}`, ...simTag(samples.some((s) => s.isDemo)), status: 'final', category: cat('activity'), code: { coding: [{ system: 'http://loinc.org', code: '55423-8', display: 'Number of steps in unspecified time Pedometer' }] }, subject, effectivePeriod: { start: `${d.day}T00:00:00`, end: `${d.day}T23:59:59` }, valueQuantity: { value: d.value, unit: 'steps', system: UCUM, code: '{steps}' }, method: { text: d.method }, note: [{ text: `Sources: ${d.bySource.map((s) => `${s.source} ${s.value}`).join('; ')}` }] });
  }

  return { resourceType: 'Bundle', id: `export-${p.id}-${now}`, type: 'collection', timestamp: now, meta: { tag: [{ system: `${EXT}/export`, code: FHIR_EXPORT_VERSION }] }, entry: entries.map((r) => ({ fullUrl: `urn:uuid:${r.resourceType}-${r.id}`, resource: r })) };
}

/** Minimal structural checks used by the tests and before download. */
export function checkBundle(b: { resourceType: string; type: string; entry: { resource: Resource }[] }): string[] {
  const e: string[] = [];
  if (b.resourceType !== 'Bundle' || b.type !== 'collection') e.push('not a collection Bundle');
  const ids = new Set<string>();
  for (const { resource: r } of b.entry) {
    const k = `${r.resourceType}/${r.id}`;
    if (ids.has(k)) e.push(`duplicate ${k}`);
    ids.add(k);
    if (r.resourceType === 'Observation') {
      if (!r.status || !r.code || !r.subject) e.push(`${k}: status, code and subject required`);
      if (!('valueQuantity' in r) && !('valueInteger' in r) && !('dataAbsentReason' in r)) e.push(`${k}: value or dataAbsentReason required`);
      const q = r.valueQuantity as { unit?: string; system?: string; code?: string } | undefined;
      if (q && (!q.unit || q.system !== UCUM || !q.code)) e.push(`${k}: UCUM unit required`);
      if (!r.effectiveDateTime && !r.effectivePeriod) e.push(`${k}: effective time required`);
    }
  }
  for (const { resource: r } of b.entry) {
    const ref = (r.device as { reference?: string } | undefined)?.reference;
    if (ref && !ids.has(ref)) e.push(`${r.resourceType}/${r.id}: dangling ${ref}`);
  }
  return e;
}
