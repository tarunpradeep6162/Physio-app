import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { CategoryBadge, Notice, Segmented, Stat } from '../../components/ui';
import { ensureDemoData } from '../../data/demo';
import type { ObservationThresholds } from '../../data/models';
import { setPrefs, usePrefs } from '../../data/prefs';
import { adherence, fmtDateTime, measurementSeries } from '../../data/queries';
import { purgeDemo, updateSettings, useDb } from '../../data/store';
import type { FilterKind } from '../../engine/filters';
import type { PoseProviderId } from '../../engine/pose/provider';

/** Clinic-level analytics: interpretable aggregates and data-quality indicators. */
export function Analytics() {
  const db = useDb((d) => d);
  const withProgram = db.patients.filter((p) => db.programs.some((pr) => pr.patientId === p.id && pr.status === 'active'));
  const adh = withProgram.map((p) => adherence(db, p.id, 28).pct ?? 0);
  const meanAdh = adh.length ? adh.reduce((a, b) => a + b, 0) / adh.length : null;
  const gains = ['knee_flexion', 'hip_flexion_slr', 'shoulder_flexion'].map((type) => {
    const g = db.patients
      .map((p) => measurementSeries(db, p.id, type).camera)
      .filter((s) => s.length >= 2)
      .map((s) => s[s.length - 1].value - s[0].value);
    return { type, n: g.length, mean: g.length ? g.reduce((a, b) => a + b, 0) / g.length : null };
  });
  const results = db.sessions.flatMap((s) => s.results);
  const coverage = results.length ? results.reduce((a, r) => a + r.trackingCoverage, 0) / results.length : null;
  const cam = db.measurements.filter((m) => m.category === 'camera_estimate');
  const reviewed = cam.filter((m) => m.reviewStatus !== 'pending');
  const rejected = cam.filter((m) => m.reviewStatus === 'rejected').length;
  const confBuckets = [
    ['High (≥0.85)', cam.filter((m) => m.confidence >= 0.85).length],
    ['Moderate', cam.filter((m) => m.confidence >= 0.7 && m.confidence < 0.85).length],
    ['Low (<0.7)', cam.filter((m) => m.confidence < 0.7).length],
  ] as const;
  const maxBucket = Math.max(1, ...confBuckets.map(([, n]) => n));

  return (
    <div className="content stack loose">
      <h1>Analytics</h1>
      <div className="grid cols-4">
        <div className="panel">
          <Stat label="Patients on a program" value={withProgram.length} />
        </div>
        <div className="panel">
          <Stat label="Mean adherence (28 d)" value={meanAdh === null ? '–' : `${Math.round(meanAdh * 100)}%`} />
        </div>
        <div className="panel">
          <Stat label="Sessions recorded" value={db.sessions.length} />
        </div>
        <div className="panel">
          <Stat label="Mean tracking coverage" value={coverage === null ? '–' : `${Math.round(coverage * 100)}%`} sub="share of exercise time with a valid measurement" />
        </div>
      </div>
      <section className="panel stack">
        <div className="row between wrap">
          <h2>Mean change in camera-estimated ROM (first → latest session)</h2>
          <CategoryBadge kind="camera" />
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Measure</th>
                <th>Patients</th>
                <th>Mean change</th>
              </tr>
            </thead>
            <tbody>
              {gains.map((g) => (
                <tr key={g.type}>
                  <td>{g.type.replace(/_/g, ' ')}</td>
                  <td className="num">{g.n}</td>
                  <td className="num">{g.mean === null ? '–' : `${g.mean >= 0 ? '+' : ''}${g.mean.toFixed(1)}°`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xs muted">Descriptive only. Camera estimates are not interchangeable with goniometer measurements until validated for this setting.</p>
      </section>
      <section className="panel stack">
        <h2>Measurement quality</h2>
        <div className="grid cols-2">
          <div className="stack tight">
            {confBuckets.map(([label, n]) => (
              <div key={label} className="row">
                <span className="small" style={{ width: 120 }}>
                  {label}
                </span>
                <div className="meter grow" aria-hidden="true">
                  <span style={{ width: `${(n / maxBucket) * 100}%` }} />
                </div>
                <span className="num small" style={{ width: 40, textAlign: 'right' }}>
                  {n}
                </span>
              </div>
            ))}
          </div>
          <dl className="kv">
            <dt>Camera estimates</dt>
            <dd className="num">{cam.length}</dd>
            <dt>Reviewed by clinician</dt>
            <dd className="num">{reviewed.length}</dd>
            <dt>Rejected at review</dt>
            <dd className="num">
              {rejected} {reviewed.length ? `(${Math.round((rejected / reviewed.length) * 100)}%)` : ''}
            </dd>
          </dl>
        </div>
      </section>
    </div>
  );
}

const THRESHOLD_LABELS: Record<keyof ObservationThresholds, string> = {
  shoulder_level: 'Shoulder level difference (°)',
  pelvic_level: 'Pelvic level difference (°)',
  head_tilt: 'Head tilt (°)',
  trunk_lateral_lean: 'Trunk side lean (°)',
  knee_frontal: 'Knee frontal-plane angle (°)',
  ear_shoulder_line: 'Ear–shoulder line angle (°)',
  trunk_sagittal: 'Trunk forward/back lean (°)',
  asymmetry: 'Left/right ROM asymmetry (°)',
};

export function ClinicSettingsPage() {
  const user = useCurrentUser();
  const settings = useDb((d) => d.settings);
  const audit = useDb((d) => [...d.audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40));
  const users = useDb((d) => d.users);
  const hasDemo = useDb((d) => d.users.some((u) => u.isDemo));
  const prefs = usePrefs();
  const [thr, setThr] = useState(settings.thresholds);
  if (!user) return null;

  return (
    <div className="content narrow stack loose">
      <h1>Settings</h1>
      <section className="panel stack">
        <h2>Clinic</h2>
        <label className="field">
          <span>Clinic name</span>
          <input className="input" defaultValue={settings.clinicName} onBlur={(e) => updateSettings({ clinicName: e.target.value }, user.id)} />
        </label>
        <label className="field">
          <span>Emergency number shown to patients</span>
          <input className="input" defaultValue={settings.emergencyNumber} onBlur={(e) => updateSettings({ emergencyNumber: e.target.value }, user.id)} />
        </label>
      </section>

      <section className="panel stack">
        <div className="row between wrap">
          <h2>Observation thresholds</h2>
          <CategoryBadge kind="observation" />
        </div>
        <p className="small muted">A camera estimate above a threshold creates a movement observation for your review. Defaults are placeholders — set them to your clinical protocol.</p>
        <div className="grid cols-2">
          {(Object.keys(THRESHOLD_LABELS) as (keyof ObservationThresholds)[]).map((k) => (
            <label key={k} className="field">
              <span>{THRESHOLD_LABELS[k]}</span>
              <input className="input num" type="number" step="0.5" value={thr[k]} onChange={(e) => setThr((x) => ({ ...x, [k]: Number(e.target.value) }))} />
            </label>
          ))}
        </div>
        <button className="btn primary" onClick={() => updateSettings({ thresholds: thr }, user.id)}>
          Save thresholds
        </button>
      </section>

      <section className="panel stack">
        <h2>Motion engine (this device)</h2>
        <div className="field">
          <span>Pose model</span>
          <Segmented<PoseProviderId>
            label="Pose model"
            value={prefs.poseProvider}
            onChange={(v) => setPrefs({ poseProvider: v })}
            options={[
              { id: 'mediapipe-lite', label: 'BlazePose Lite (fast)' },
              { id: 'mediapipe-full', label: 'BlazePose Full' },
              { id: 'simulated', label: 'Simulated (demo)' },
            ]}
          />
        </div>
        <div className="field">
          <span>Temporal filter</span>
          <Segmented<FilterKind>
            label="Filter"
            value={prefs.filter}
            onChange={(v) => setPrefs({ filter: v })}
            options={[
              { id: 'one_euro', label: 'One Euro' },
              { id: 'ema', label: 'EMA' },
              { id: 'kalman', label: 'Kalman' },
              { id: 'none', label: 'None' },
            ]}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.validationModeEnabled} onChange={(e) => updateSettings({ validationModeEnabled: e.target.checked }, user.id)} />
          <span>
            Enable Validation Mode for clinicians/engineers
            <br />
            <span className="xs muted">Never visible to patients.</span>
          </span>
        </label>
        {settings.validationModeEnabled && (
          <Link className="btn secondary" to="/validation">
            Open Validation Mode
          </Link>
        )}
      </section>

      <section className="panel stack">
        <h2>Demonstration data</h2>
        {hasDemo ? (
          <>
            <Notice>Demo patients and measurements are flagged and labelled throughout the app.</Notice>
            <button className="btn danger" onClick={() => purgeDemo(user.id)} disabled={!!users.find((u) => u.id === user.id)?.isDemo}>
              Remove all demo data
            </button>
            {users.find((u) => u.id === user.id)?.isDemo && <p className="xs muted">Sign in with a real account to remove demo data.</p>}
          </>
        ) : (
          <button className="btn secondary" onClick={() => ensureDemoData()}>
            Load demo data
          </button>
        )}
      </section>

      <section className="panel stack tight">
        <h2>Audit log (latest 40)</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id}>
                  <td className="xs">{fmtDateTime(e.at)}</td>
                  <td className="xs">{users.find((u) => u.id === e.actorId)?.displayName ?? e.actorId.slice(0, 8)}</td>
                  <td className="xs">
                    {e.action}
                    {e.detail ? ` · ${e.detail}` : ''}
                  </td>
                  <td className="xs mono">
                    {e.entity}/{e.entityId.slice(0, 8)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
