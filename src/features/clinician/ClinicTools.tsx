import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';
import { captureQuality } from '../../clinical/captureQuality';
import { canEnable, editInstrument, enableBlockers, LICENCE_LABEL } from '../../clinical/outcomes';
import type { OutcomeInstrument } from '../../data/models';
import { fmtDate } from '../../data/queries';
import { insert, update, useDb, uuid } from '../../data/store';

/**
 * Phase 49: outcome-questionnaire registry. Records what the clinic would need to use a
 * questionnaire; no questionnaire text or scoring lives here. Enabling is blocked until licence,
 * holder, terms, official scoring source and a clinical approval of this exact version are recorded.
 */
export function OutcomeRegistryPanel({ actorId }: { actorId: string }) {
  const items = useDb((d) => d.outcomeInstruments);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const now = () => new Date().toISOString();
  const save = (i: OutcomeInstrument, patch: Partial<OutcomeInstrument>, detail: string) => update('outcomeInstruments', i.id, editInstrument(i, patch, now()), actorId, detail);
  return (
    <section className="panel stack" aria-labelledby="outcomes-h">
      <h2 id="outcomes-h">Outcome questionnaires</h2>
      <Notice>
        Standard questionnaires are usually copyrighted. Their wording and scoring must come from the licensed official materials, not be typed in from memory. Record the licence position here. A questionnaire can be switched on only when the licence, the official scoring source and a clinical approval of this version are all recorded. Changing the version or licence withdraws the approval.
      </Notice>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field grow" style={{ minWidth: "12rem" }}><span>Questionnaire name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Version</span><input className="input" value={version} onChange={(e) => setVersion(e.target.value)} style={{ maxWidth: 120 }} /></label>
        <button className="btn secondary" disabled={!name.trim() || !version.trim()} onClick={() => {
          insert('outcomeInstruments', { id: uuid(), name: name.trim(), version: version.trim(), licenceStatus: 'not_checked', enabled: false, createdBy: actorId, createdAt: now() }, actorId);
          setName('');
          setVersion('');
        }}>Add to registry</button>
      </div>
      {items.length === 0 && <p className="small muted">No questionnaires registered. None can be used with patients.</p>}
      {items.map((i) => {
        const blockers = enableBlockers(i);
        return (
          <details key={i.id} className="panel">
            <summary style={{ cursor: 'pointer', minHeight: 44 }}>
              <strong>{i.name}</strong> <span className="small muted">v{i.version}</span>{' '}
              <span className={`badge ${i.enabled ? 'ok' : 'warn'}`}>{i.enabled ? 'In use' : 'Not in use'}</span>
            </summary>
            <div className="stack tight" style={{ marginTop: '0.5rem' }}>
              <label className="field"><span>Licence position</span>
                <select className="input" value={i.licenceStatus} onChange={(e) => save(i, { licenceStatus: e.target.value as OutcomeInstrument['licenceStatus'] }, 'licence')}>
                  {Object.entries(LICENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {(['licenceHolder', 'licenceRef', 'scoringSource'] as const).map((k) => (
                <label key={k} className="field">
                  <span>{k === 'licenceHolder' ? 'Licence holder' : k === 'licenceRef' ? 'Licence document, agreement number or terms URL' : 'Official scoring manual (title, edition)'}</span>
                  <input className="input" defaultValue={i[k] ?? ''} onBlur={(e) => e.target.value.trim() !== (i[k] ?? '') && save(i, { [k]: e.target.value.trim() || undefined }, k)} />
                </label>
              ))}
              <p className="small" style={{ margin: 0 }}>
                Clinical approval: {i.clinicalApprovedAt ? `recorded ${fmtDate(i.clinicalApprovedAt)} for v${i.version}` : 'not recorded'}
              </p>
              {blockers.length > 0 && <ul className="small" style={{ margin: 0 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
              <div className="row wrap">
                {!i.clinicalApprovedAt && (
                  <button className="btn secondary sm" onClick={() => update('outcomeInstruments', i.id, { clinicalApprovedBy: actorId, clinicalApprovedAt: now(), updatedAt: now() }, actorId, 'clinical_approval')}>
                    Record my clinical approval of v{i.version}
                  </button>
                )}
                <button className="btn primary sm" disabled={!i.enabled && !canEnable(i)} onClick={() => save(i, { enabled: !i.enabled }, i.enabled ? 'disable' : 'enable')}>
                  {i.enabled ? 'Stop using' : 'Start using'}
                </button>
              </div>
              <p className="xs muted" style={{ margin: 0 }}>Questionnaire content and scoring are added as a separate, reviewed release once the official materials are in hand.</p>
            </div>
          </details>
        );
      })}
    </section>
  );
}

/**
 * Phase 50: where capture fails in this clinic. Counts of withheld captures and values, by protocol
 * version, view and device class, and why. Demo data is excluded. Counts only; nothing here
 * describes the accuracy of values that passed.
 */
export function CaptureQualityPanel() {
  const db = useDb((d) => d);
  const [range, setRange] = useState<'90' | 'all'>('90');
  const q = useMemo(() => captureQuality(db, range === '90' ? { since: new Date(Date.now() - 90 * 864e5).toISOString() } : {}), [db, range]);
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');
  return (
    <section className="panel stack" aria-labelledby="capture-quality-h">
      <div className="row between wrap">
        <h2 id="capture-quality-h">Where capture fails</h2>
        <div className="row" role="group" aria-label="Period">
          <button type="button" className="chip" aria-pressed={range === '90'} onClick={() => setRange('90')}>Last 90 days</button>
          <button type="button" className="chip" aria-pressed={range === 'all'} onClick={() => setRange('all')}>All time</button>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Counts of camera captures and values that were withheld, and the reasons. Use them to improve set-up, lighting and phone placement. They do not show how accurate the values that passed are. {q.excludedDemo > 0 && `${q.excludedDemo} demo records are excluded.`}
      </p>
      {q.totals.captures === 0 && q.staticWithheld.length === 0 ? (
        <p className="small">No real (non-demo) camera captures in this period yet. Controlled tests with volunteers can be recorded with the <Link to="/c/challenge">occlusion challenge recorder</Link>.</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Captures</dt><dd className="num">{q.totals.captures}</dd>
            <dt>Captures that failed the quality check</dt><dd className="num">{q.totals.invalidCaptures} ({pct(q.totals.invalidCaptures, q.totals.captures)})</dd>
            <dt>Values withheld</dt><dd className="num">{q.totals.withheldMetrics} of {q.totals.metrics} ({pct(q.totals.withheldMetrics, q.totals.metrics)})</dd>
          </dl>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Capture failures by set-up">
            <table className="data">
              <thead><tr><th>Protocol</th><th>View</th><th>Device</th><th>Captures</th><th>Failed</th><th>Values withheld</th></tr></thead>
              <tbody>
                {q.rows.map((r) => (
                  <tr key={r.key}><td className="mono small">{r.protocol}</td><td>{r.view}</td><td>{r.device}</td><td className="num">{r.captures}</td><td className="num">{r.invalidCaptures}</td><td className="num">{r.withheldMetrics}/{r.metrics}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.reasons.length > 0 && (
            <div><h3 className="small">Most common reasons</h3><ul className="small">{q.reasons.slice(0, 8).map((r) => <li key={r.reason}>{r.reason} — {r.count}</li>)}</ul></div>
          )}
          <p className="small" style={{ margin: 0 }}>To test occlusion on real people under controlled conditions, use the <Link to="/c/challenge">occlusion challenge recorder</Link> (volunteers only).</p>
          {q.staticWithheld.length > 0 && (
            <div><h3 className="small">Posture and desk checks withheld</h3><ul className="small">{q.staticWithheld.slice(0, 6).map((r) => <li key={r.reason}>{r.reason} — {r.count}</li>)}</ul></div>
          )}
        </>
      )}
    </section>
  );
}
