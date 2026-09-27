import { describe, expect, it } from 'vitest';
import { buildReport } from '../clinical/report';
import { buildDemoDb } from '../data/demo';
import type { DB } from '../data/models';
import { AuthorizationError, getDb, insert, replaceDb, uuid } from '../data/store';
import { calibrationStatus, parseDeviceCsv, validateDeviceMeasurement, type DeviceMeasurement } from './deviceMeasurements';
import { checkBundle, exportPatientBundle } from './fhir';

const CSV = `kind,measure,side,value,unit,measured_at,manufacturer,model,serial,calibrated_on,trials,summary
grip_dynamometer,Grip strength,right,31.2,kg,2026-09-20T10:15:00+05:30,Acme,GD-100,SN42,2026-03-01,29.8;31.2;30.5,max
handheld_dynamometer,Knee extension isometric,left,180,N,2026-09-20T10:25:00+05:30,Acme,HHD-2,SN7,2024-01-01,,single
grip_dynamometer,Grip strength,left,210,deg,2026-09-20T10:16:00+05:30,Acme,GD-100,SN42,2026-03-01,,single
goniometer,Knee flexion,left,118,deg,2026-09-20 10:30,Plain,Long arm,,,,single`;

describe('Phase 18 — device and reference measurements', () => {
  it('imports only rows with valid units, offsets and device identity; calibration state is derived and kept', () => {
    const r = parseDeviceCsv(CSV, { patientId: 'p', enteredBy: 'c', file: 'dyno.csv', now: '2026-09-21T00:00:00Z' });
    expect(r.rows).toHaveLength(2);
    expect(r.errors.join(' ')).toMatch(/row 4: unit deg is not valid for grip_dynamometer/);
    expect(r.errors.join(' ')).toMatch(/row 5: measuredAt must be ISO 8601 with a time-zone offset/);
    const [grip, knee] = r.rows;
    expect(grip).toMatchObject({ value: 31.2, unit: 'kg', trials: [29.8, 31.2, 30.5], summary: 'max', measuredAt: '2026-09-20T10:15:00+05:30', device: { manufacturer: 'Acme', model: 'GD-100', serial: 'SN42' }, calibration: { status: 'in_date', lastCalibrated: '2026-03-01' }, source: { kind: 'file_import', file: 'dyno.csv', row: 2 } });
    expect(knee.calibration.status).toBe('expired');
    expect(calibrationStatus(undefined, '2026-01-01T00:00:00Z')).toBe('unknown');
    expect(validateDeviceMeasurement({ ...grip, value: 900 }).join()).toMatch(/plausible/);
  });

  it('device data is clinician-only (a patient session cannot record strength)', () => {
    replaceDb(buildDemoDb());
    const patient = getDb().users.find((u) => u.role === 'patient')!;
    const row = parseDeviceCsv(CSV, { patientId: 'p', enteredBy: patient.id, file: 'x.csv', now: '' }).rows[0];
    expect(() => insert('deviceMeasurements', { ...row, id: uuid() }, patient.id)).toThrow(AuthorizationError);
  });
});

describe('Phase 18 — FHIR export keeps provenance, units, calibration, time and source', () => {
  const setup = () => {
    const db: DB = buildDemoDb();
    const dp01 = db.patients.find((p) => p.name.includes('DP-01'))!;
    const rows = parseDeviceCsv(CSV, { patientId: dp01.id, enteredBy: 'c', file: 'dyno.csv', now: '2026-09-21T00:00:00Z', isDemo: true }).rows.map((r) => ({ ...r, id: uuid() })) as DeviceMeasurement[];
    db.deviceMeasurements.push(...rows);
    return { db, dp01, rows };
  };

  it('produces a structurally valid collection bundle; device values survive a JSON round trip unchanged', () => {
    const { db, dp01 } = setup();
    const b = JSON.parse(JSON.stringify(exportPatientBundle(db, dp01.id, db.deviceMeasurements, '2026-09-21T00:00:00Z')));
    expect(checkBundle(b)).toEqual([]);
    const obs = b.entry.map((e: { resource: Record<string, unknown> }) => e.resource).filter((r: Record<string, unknown>) => r.resourceType === 'Observation');
    const grip = obs.find((o: { code: { text: string } }) => o.code.text === 'Grip strength');
    expect(grip.valueQuantity).toEqual({ value: 31.2, unit: 'kg', system: 'http://unitsofmeasure.org', code: 'kg' });
    expect(grip.effectiveDateTime).toBe('2026-09-20T10:15:00+05:30');
    expect(grip.component.map((c: { valueQuantity: { value: number } }) => c.valueQuantity.value)).toEqual([29.8, 31.2, 30.5]);
    expect(JSON.stringify(grip.extension)).toMatch(/in_date; last calibrated 2026-03-01/);
    expect(JSON.stringify(grip.extension)).toMatch(/dyno.csv row 2/);
    const dev = b.entry.find((e: { resource: { resourceType: string; id: string } }) => `Device/${e.resource.id}` === grip.device.reference).resource;
    expect(dev).toMatchObject({ manufacturer: 'Acme', serialNumber: 'SN42' });
    const knee = obs.find((o: { code: { text: string } }) => o.code.text === 'Knee extension isometric');
    expect(knee.valueQuantity.code).toBe('N');
    expect(JSON.stringify(knee.extension)).toMatch(/expired/);
  });

  it('camera values are preliminary kinematics with protocol/algorithm/view; invalid captures carry no number; simulated data is tagged', () => {
    const { db, dp01 } = setup();
    const b = exportPatientBundle(db, dp01.id, db.deviceMeasurements, '2026-09-21T00:00:00Z');
    const cam = b.entry.map((e) => e.resource).filter((r) => String(r.id).startsWith('cam-'));
    expect(cam.length).toBeGreaterThan(0);
    for (const o of cam) {
      expect(o.status).toBe('preliminary');
      expect(String((o.method as { text: string }).text)).toMatch(/Camera-estimated 2D pose.*not strength or force/);
      expect(JSON.stringify(o.extension)).toMatch(/protocol.*algorithm.*view.*quality/);
      expect(JSON.stringify(o.meta)).toMatch(/simulated/);
      if ('dataAbsentReason' in o) expect(o.valueQuantity).toBeUndefined();
    }
    const units = new Set(cam.map((o) => (o.valueQuantity as { unit?: string } | undefined)?.unit).filter(Boolean));
    expect([...units].some((u) => ['kg', 'N', 'Nm'].includes(u as string))).toBe(false);
  });

  it('never exports AI drafts; pain uses LOINC 72514-3 as patient-reported', () => {
    const { db, dp01 } = setup();
    db.draftDecisions.push({ id: 'd1', assessmentId: db.assessments.find((a) => a.patientId === dp01.id)!.id, draftSchema: 's', generator: 'g', section: 'summary', proposal: 'AI PROPOSAL TEXT', evidence: [], action: 'accept', by: 'c', at: '' });
    const s = JSON.stringify(exportPatientBundle(db, dp01.id, db.deviceMeasurements, '2026-09-21T00:00:00Z'));
    expect(s).not.toMatch(/AI PROPOSAL TEXT|ai_draft/);
    expect(s).toMatch(/72514-3/);
  });

  it('device values appear in the report as their own category, with unit, device and calibration', () => {
    const { db, dp01 } = setup();
    const a = db.assessments.filter((x) => x.patientId === dp01.id && x.status !== 'in_progress').sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    for (const d of db.deviceMeasurements) d.assessmentId = a.id;
    const rep = buildReport(db, a.id, 'clinician');
    const text = JSON.stringify(rep);
    expect(text).toMatch(/Device-measured \(strength, force, balance platform, instruments\) — not camera estimates/);
    expect(text).toMatch(/31.2 kg \(max of 3\)/);
    expect(text).toMatch(/Acme GD-100 #SN42/);
  });
});
