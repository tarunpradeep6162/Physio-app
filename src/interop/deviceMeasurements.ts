/**
 * Reference and device measurements (Phase 18). Strength, force and balance-platform values come
 * ONLY from measuring devices (or clinician-entered instrument readings) — never from the camera,
 * which estimates kinematics. Every value keeps its unit, device identity, calibration state,
 * measurement time (with the original offset) and source through import, display and export.
 */

export type DeviceKind = 'grip_dynamometer' | 'handheld_dynamometer' | 'isokinetic' | 'force_plate' | 'balance_platform' | 'goniometer' | 'inclinometer' | 'stopwatch';
export type DeviceUnit = 'kg' | 'N' | 'Nm' | 'deg' | 's' | 'mm' | 'mm2' | 'cm';

/** Units a value from each device kind may carry (anything else is rejected, never converted silently). */
export const ALLOWED_UNITS: Record<DeviceKind, DeviceUnit[]> = {
  grip_dynamometer: ['kg', 'N'],
  handheld_dynamometer: ['kg', 'N', 'Nm'],
  isokinetic: ['Nm'],
  force_plate: ['N', 's'],
  balance_platform: ['mm', 'mm2', 's'],
  goniometer: ['deg'],
  inclinometer: ['deg'],
  stopwatch: ['s'],
};

/** Plausible ranges per unit — a typo guard, not a clinical range. */
const PLAUSIBLE: Record<DeviceUnit, [number, number]> = { kg: [0, 150], N: [0, 5000], Nm: [0, 600], deg: [-30, 200], s: [0, 600], mm: [0, 10000], mm2: [0, 100000], cm: [0, 300] };

export const STRENGTH_KINDS: DeviceKind[] = ['grip_dynamometer', 'handheld_dynamometer', 'isokinetic', 'force_plate'];

export interface DeviceMeasurement {
  id: string;
  patientId: string;
  assessmentId?: string;
  kind: DeviceKind;
  /** What was measured, e.g. "grip", "knee extension isometric", "quiet stance eyes open". */
  measure: string;
  side?: 'left' | 'right';
  value: number;
  unit: DeviceUnit;
  /** Individual trials when the device reports them (value = the protocol's summary of them). */
  trials?: number[];
  summary?: 'max' | 'mean' | 'single';
  /** ISO 8601 with the original offset, as recorded at the point of measurement. */
  measuredAt: string;
  device: { manufacturer: string; model: string; serial?: string; firmware?: string };
  calibration: { status: 'in_date' | 'expired' | 'unknown'; lastCalibrated?: string; certificateRef?: string };
  protocolNote?: string;
  source: { kind: 'clinician_entry' | 'file_import'; file?: string; importedAt?: string; row?: number };
  enteredBy: string;
  createdAt: string;
  category: 'device_measured';
  isDemo?: boolean;
}

export function calibrationStatus(lastCalibrated: string | undefined, measuredAt: string, maxAgeDays = 365): DeviceMeasurement['calibration']['status'] {
  if (!lastCalibrated) return 'unknown';
  const age = (Date.parse(measuredAt) - Date.parse(lastCalibrated)) / 86_400_000;
  return Number.isFinite(age) && age >= 0 && age <= maxAgeDays ? 'in_date' : 'expired';
}

const ISO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function validateDeviceMeasurement(m: Omit<DeviceMeasurement, 'id' | 'createdAt' | 'category'>): string[] {
  const e: string[] = [];
  if (!ALLOWED_UNITS[m.kind]) e.push(`unknown device kind ${m.kind}`);
  else if (!ALLOWED_UNITS[m.kind].includes(m.unit)) e.push(`unit ${m.unit} is not valid for ${m.kind} (allowed: ${ALLOWED_UNITS[m.kind].join(', ')})`);
  const r = PLAUSIBLE[m.unit];
  if (!Number.isFinite(m.value) || (r && (m.value < r[0] || m.value > r[1]))) e.push(`value ${m.value} ${m.unit} outside the plausible range`);
  if (!ISO_OFFSET.test(m.measuredAt)) e.push('measuredAt must be ISO 8601 with a time-zone offset');
  if (!m.device.manufacturer.trim() || !m.device.model.trim()) e.push('device manufacturer and model required');
  if (!m.measure.trim()) e.push('what was measured is required');
  if (m.trials && (m.trials.some((t) => !Number.isFinite(t)) || !m.summary)) e.push('trials need numeric values and a summary (max/mean/single)');
  return e;
}

/**
 * CSV import. Header (any order):
 * kind,measure,side,value,unit,measured_at,manufacturer,model,serial,calibrated_on,trials,summary
 * `trials` is a semicolon-separated list. Rows with any problem are reported and NOT imported.
 */
export function parseDeviceCsv(csv: string, ctx: { patientId: string; enteredBy: string; file: string; now: string; assessmentId?: string; isDemo?: boolean }): { rows: Omit<DeviceMeasurement, 'id'>[]; errors: string[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = lines.shift()?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const need = ['kind', 'measure', 'value', 'unit', 'measured_at', 'manufacturer', 'model'];
  const missing = need.filter((n) => !head.includes(n));
  if (missing.length) return { rows: [], errors: [`missing columns: ${missing.join(', ')}`] };
  const rows: Omit<DeviceMeasurement, 'id'>[] = [];
  const errors: string[] = [];
  lines.forEach((line, i) => {
    const c = line.split(',').map((x) => x.trim());
    const get = (k: string) => (head.includes(k) ? c[head.indexOf(k)] ?? '' : '');
    const trials = get('trials') ? get('trials').split(';').map(Number) : undefined;
    const measuredAt = get('measured_at');
    const lastCalibrated = get('calibrated_on') || undefined;
    const row: Omit<DeviceMeasurement, 'id'> = {
      patientId: ctx.patientId,
      assessmentId: ctx.assessmentId,
      kind: get('kind') as DeviceKind,
      measure: get('measure'),
      side: get('side') === 'left' || get('side') === 'right' ? (get('side') as 'left' | 'right') : undefined,
      value: Number(get('value')),
      unit: get('unit') as DeviceUnit,
      trials,
      summary: (['max', 'mean', 'single'].includes(get('summary')) ? get('summary') : trials ? undefined : 'single') as DeviceMeasurement['summary'],
      measuredAt,
      device: { manufacturer: get('manufacturer'), model: get('model'), serial: get('serial') || undefined },
      calibration: { status: calibrationStatus(lastCalibrated, measuredAt), lastCalibrated },
      source: { kind: 'file_import', file: ctx.file, importedAt: ctx.now, row: i + 2 },
      enteredBy: ctx.enteredBy,
      createdAt: ctx.now,
      category: 'device_measured',
      isDemo: ctx.isDemo,
    };
    const problems = validateDeviceMeasurement(row);
    if (problems.length) errors.push(`row ${i + 2}: ${problems.join('; ')}`);
    else rows.push(row);
  });
  return { rows, errors };
}
