import { useState } from 'react';
import { CategoryBadge, Notice } from '../../components/ui';
import type { DB, Patient } from '../../data/models';
import { fmtDateTime } from '../../data/queries';
import { insert, insertMany, uuid } from '../../data/store';
import { ALLOWED_UNITS, calibrationStatus, parseDeviceCsv, STRENGTH_KINDS, validateDeviceMeasurement, type DeviceKind, type DeviceMeasurement, type DeviceUnit } from '../../interop/deviceMeasurements';
import { checkBundle, exportPatientBundle } from '../../interop/fhir';

/**
 * Reference and device measurements + care-system export (Phase 18). Strength and force come only
 * from measuring devices and are shown apart from camera-estimated kinematics.
 */
const KINDS = Object.keys(ALLOWED_UNITS) as DeviceKind[];
const nowWithOffset = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19)}${sign}${pad(off / 60)}:${pad(off % 60)}`;
};

export function DeviceTab({ db, patient, actorId }: { db: DB; patient: Patient; actorId: string }) {
  const rows = (db.deviceMeasurements ?? []).filter((d) => d.patientId === patient.id).sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
  const [kind, setKind] = useState<DeviceKind>('grip_dynamometer');
  const [unit, setUnit] = useState<DeviceUnit>('kg');
  const [f, setF] = useState({ measure: 'Grip strength', side: 'right', value: '', trials: '', manufacturer: '', model: '', serial: '', calibrated: '', measuredAt: nowWithOffset() });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const candidate = (): Omit<DeviceMeasurement, 'id'> => {
    const trials = f.trials.trim() ? f.trials.split(/[;, ]+/).filter(Boolean).map(Number) : undefined;
    return {
      patientId: patient.id,
      kind,
      measure: f.measure.trim(),
      side: f.side === 'left' || f.side === 'right' ? f.side : undefined,
      value: trials?.length ? Math.max(...trials) : Number(f.value),
      unit,
      trials,
      summary: trials?.length ? 'max' : 'single',
      measuredAt: f.measuredAt.trim(),
      device: { manufacturer: f.manufacturer.trim(), model: f.model.trim(), serial: f.serial.trim() || undefined },
      calibration: { status: calibrationStatus(f.calibrated || undefined, f.measuredAt), lastCalibrated: f.calibrated || undefined },
      source: { kind: 'clinician_entry' },
      enteredBy: actorId,
      createdAt: new Date().toISOString(),
      category: 'device_measured',
      isDemo: patient.isDemo,
    };
  };
  const problems = validateDeviceMeasurement(candidate());

  const download = () => {
    const bundle = exportPatientBundle(db, patient.id, db.deviceMeasurements ?? [], new Date().toISOString());
    const errs = checkBundle(bundle);
    if (errs.length) {
      setMsg({ tone: 'danger', text: `Export blocked: ${errs.slice(0, 5).join('; ')}` });
      return;
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fhir-${patient.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg({ tone: 'ok', text: `Exported ${bundle.entry.length} FHIR resources.` });
  };

  return (
    <div className="stack">
      <Notice>Strength, force and balance-platform values come only from measuring devices and stay separate from camera-estimated movement. Every value keeps its unit, device, calibration, time and source through import, the report and export.</Notice>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <section className="panel stack">
        <div className="row between wrap">
          <h2>Record a device measurement</h2>
          <CategoryBadge kind="clinician" />
        </div>
        <div className="grid cols-4">
          <label className="field">
            <span>Device type</span>
            <select className="input" value={kind} onChange={(e) => { const k = e.target.value as DeviceKind; setKind(k); setUnit(ALLOWED_UNITS[k][0]); }}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Unit</span>
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as DeviceUnit)}>
              {ALLOWED_UNITS[kind].map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>What was measured</span>
            <input className="input" value={f.measure} onChange={(e) => setF({ ...f, measure: e.target.value })} />
          </label>
          <label className="field">
            <span>Side</span>
            <select className="input" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
              <option value="">n/a</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="field">
            <span>Value ({unit})</span>
            <input className="input num" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} disabled={!!f.trials.trim()} />
          </label>
          <label className="field">
            <span>Trials (optional; max is recorded)</span>
            <input className="input" value={f.trials} placeholder="e.g. 28.5; 30.1; 29.4" onChange={(e) => setF({ ...f, trials: e.target.value })} />
          </label>
          <label className="field">
            <span>Measured at (ISO with offset)</span>
            <input className="input" value={f.measuredAt} onChange={(e) => setF({ ...f, measuredAt: e.target.value })} />
          </label>
          <label className="field">
            <span>Last calibrated (date)</span>
            <input className="input" type="date" value={f.calibrated} onChange={(e) => setF({ ...f, calibrated: e.target.value })} />
          </label>
          <label className="field">
            <span>Manufacturer</span>
            <input className="input" value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} />
          </label>
          <label className="field">
            <span>Model</span>
            <input className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
          </label>
          <label className="field">
            <span>Serial (optional)</span>
            <input className="input" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />
          </label>
        </div>
        {problems.length > 0 && <p className="xs muted">To save: {problems.join('; ')}</p>}
        <button
          className="btn primary"
          disabled={problems.length > 0}
          onClick={() => {
            insert('deviceMeasurements', { ...candidate(), id: uuid() }, actorId, `device:${kind}`);
            setF({ ...f, value: '', trials: '' });
            setMsg({ tone: 'ok', text: 'Saved.' });
          }}
        >
          Save measurement
        </button>
      </section>

      <section className="panel stack tight">
        <h2>Import from a device export (CSV)</h2>
        <p className="xs muted">Columns: kind, measure, side, value, unit, measured_at, manufacturer, model, serial, calibrated_on, trials (semicolon-separated), summary. Rows with any problem are listed and not imported; units are never converted.</p>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Import device CSV"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const r = parseDeviceCsv(await file.text(), { patientId: patient.id, enteredBy: actorId, file: file.name, now: new Date().toISOString(), isDemo: patient.isDemo });
            insertMany('deviceMeasurements', r.rows.map((x) => ({ ...x, id: uuid() })), actorId, `device_import:${file.name}`);
            setMsg({ tone: r.errors.length ? 'danger' : 'ok', text: `Imported ${r.rows.length} row(s).${r.errors.length ? ` Not imported: ${r.errors.join(' | ')}` : ''}` });
          }}
        />
      </section>

      <section className="panel stack tight">
        <div className="row between wrap">
          <h2>Device-measured values</h2>
          <button className="btn secondary sm" onClick={download}>
            Export FHIR bundle
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="small muted">None recorded.</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Device measurements">
            <table className="data">
              <thead>
                <tr>
                  <th>Measured</th>
                  <th>Measure</th>
                  <th>Value</th>
                  <th>Device</th>
                  <th>Calibration</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="xs">{d.measuredAt}</td>
                    <td className="small">
                      {d.measure}
                      {d.side ? ` (${d.side})` : ''} {STRENGTH_KINDS.includes(d.kind) && <span className="badge">device strength/force</span>}
                    </td>
                    <td className="num">
                      {d.value} {d.unit}
                      {d.trials ? <div className="xs muted">{d.summary} of {d.trials.join(', ')}</div> : null}
                    </td>
                    <td className="xs">
                      {d.device.manufacturer} {d.device.model}
                      {d.device.serial ? ` #${d.device.serial}` : ''}
                    </td>
                    <td className="xs">
                      <span className={`badge ${d.calibration.status === 'in_date' ? 'clinical' : 'warn'}`}>{d.calibration.status.replace('_', ' ')}</span>
                      {d.calibration.lastCalibrated ? ` ${d.calibration.lastCalibrated}` : ''}
                    </td>
                    <td className="xs">
                      {d.source.kind === 'file_import' ? `${d.source.file} row ${d.source.row}` : 'clinician entry'} · {fmtDateTime(d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
