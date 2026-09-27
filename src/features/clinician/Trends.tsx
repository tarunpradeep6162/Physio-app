import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isPathwayRegion, PATHWAYS } from '../../clinical/pathways';
import { activityTrend, adherenceTrend, DEFAULT_EXCEPTION_RULES, exceptionQueue, metricTrend, reviewRule, symptomTrend, updateRule, type ExceptionRule, type MetricTrend } from '../../clinical/trends';
import { Notice } from '../../components/ui';
import type { DB, ID, Patient } from '../../data/models';
import { fmtDate } from '../../data/queries';
import { updateSettings } from '../../data/store';

/** Metric rows to trend for a patient: every pathway they have been assessed in. */
export function trendRowsFor(db: DB, patientId: ID) {
  const regions = new Set(db.assessments.filter((a) => a.patientId === patientId).map((a) => a.region).filter(isPathwayRegion));
  const rows: { protocolId: string; metricId: string; side: 'left' | 'right' | null; label: string }[] = [];
  for (const r of regions) {
    const p = PATHWAYS[r];
    for (const row of p.sidedRows) if (!row.metricId.includes('trunk') && !row.metricId.includes('heel_rise')) for (const side of ['left', 'right'] as const) rows.push({ ...row, side, label: `${p.label} · ${row.label} (${side})` });
  }
  return rows;
}

const unitText = (u: string) => (u === 'deg' ? '°' : u === 's' ? ' s' : u === 'pct_leg' ? '% leg' : '');

function TrendTable({ t, label }: { t: MetricTrend; label: string }) {
  if (!t.points.length) return null;
  return (
    <div className="stack tight">
      <strong className="small">{label}</strong>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={`${label} trend`}>
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Value (absolute)</th>
              <th>Change from previous</th>
              <th>Protocol / algorithm</th>
              <th>View</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {t.points.map((p, i) => {
              const link = i > 0 ? t.links[i - 1] : null;
              return (
                <tr key={p.assessmentId}>
                  <td className="small">{fmtDate(p.at)}</td>
                  <td className="num">{p.value === null ? <span className="muted">{p.validity} — {p.reason}</span> : `${p.value}${unitText(p.unit)}`}</td>
                  <td className="small">{!link ? 'baseline' : link.comparable ? `${link.change! >= 0 ? '+' : ''}${link.change}${unitText(p.unit)}` : <span className="badge warn">trend broken: {link.breakReason}</span>}</td>
                  <td className="xs">
                    {p.protocol} · {p.algorithm}
                  </td>
                  <td className="xs">{p.view}</td>
                  <td className="xs">camera estimate{p.simulated ? ' (simulated)' : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TrendsTab({ db, patient }: { db: DB; patient: Patient }) {
  const now = new Date().toISOString();
  const rows = trendRowsFor(db, patient.id);
  const trends = rows.map((r) => ({ r, t: metricTrend(db, patient.id, r.protocolId, r.metricId, r.side) })).filter((x) => x.t.points.length);
  const pain = symptomTrend(db, patient.id).slice(-12);
  const adh = adherenceTrend(db, patient.id, now);
  const act = activityTrend(db, patient.id, now);
  return (
    <div className="stack">
      <Notice>
        Absolute values are shown with their protocol, algorithm, view and source. A change is only calculated between comparable captures; anything else breaks the trend with the reason. Values from different sources are never merged.
      </Notice>
      <section className="panel stack">
        <h2>Camera measurements</h2>
        {trends.length === 0 ? <p className="small muted">No submitted assessment with captures yet.</p> : trends.map(({ r, t }) => <TrendTable key={`${r.protocolId}:${r.metricId}:${r.side}`} t={t} label={r.label} />)}
      </section>
      <section className="grid cols-2">
        <div className="panel stack tight">
          <h2>Pain (patient-reported)</h2>
          {pain.length === 0 ? (
            <p className="small muted">No reports.</p>
          ) : (
            pain.map((p, i) => (
              <div key={i} className="row between small">
                <span>{fmtDate(p.at)}</span>
                <span>
                  {p.nprs}/10 <span className="xs muted">· {p.source === 'daily_checkin' ? 'daily check-in' : p.source === 'intake_now' ? 'assessment intake' : 'before a session'}</span>
                </span>
              </div>
            ))
          )}
        </div>
        <div className="panel stack tight">
          <h2>Adherence (sessions per week)</h2>
          {adh.map((w) => (
            <div key={w.weekEnding} className="row between small">
              <span>week to {w.weekEnding}</span>
              <span>{w.planned === null ? <span className="muted">no plan yet</span> : `${w.done} / ${w.planned} planned`}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel stack tight">
        <h2>Activity (device-imported steps)</h2>
        {act.length === 0 ? (
          <p className="small muted">Not shared by the patient.</p>
        ) : (
          act.map((w) => (
            <div key={w.weekEnding} className="row between small">
              <span>week to {w.weekEnding}</span>
              <span>{w.medianSteps === null ? <span className="muted">not enough data ({w.daysWithData} day(s))</span> : `median ${w.medianSteps.toLocaleString()} steps/day (${w.daysWithData} days)`}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

export function ExceptionQueuePanel({ db }: { db: DB }) {
  const rules = db.settings.exceptionRules ?? DEFAULT_EXCEPTION_RULES;
  const items = exceptionQueue(db, rules, new Date().toISOString(), (pid) => trendRowsFor(db, pid));
  const name = (id: string) => db.patients.find((p) => p.id === id)?.name ?? id;
  const unreviewed = rules.filter((r) => r.enabled && !r.reviewedBy).length;
  return (
    <section className="panel stack tight">
      <div className="row between wrap">
        <h2>Exception queue</h2>
        <Link className="btn ghost sm" to="/c/settings#exception-rules">
          Rules{unreviewed ? ` (${unreviewed} unreviewed)` : ''}
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="small muted">Nothing needs attention under the current rules.</p>
      ) : (
        items.slice(0, 20).map((x, i) => (
          <Link key={i} to={`/c/patients/${x.patientId}?tab=trends`} className="list-item" style={{ display: 'block' }}>
            <div className="row between wrap">
              <strong className="small">{name(x.patientId)}</strong>
              {!x.ruleReviewed && <span className="badge warn">rule threshold unreviewed</span>}
            </div>
            <div className="small">{x.summary}</div>
            <div className="xs muted">{x.evidence.join(' · ')}</div>
          </Link>
        ))
      )}
    </section>
  );
}

export function ExceptionRulesEditor({ rules, actorId, reviewerName }: { rules: ExceptionRule[] | undefined; actorId: string; reviewerName: string }) {
  const current = rules ?? DEFAULT_EXCEPTION_RULES;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = (next: ExceptionRule[]) => updateSettings({ exceptionRules: next }, actorId);
  return (
    <section className="panel stack" id="exception-rules">
      <h2>Exception-queue rules</h2>
      <p className="small muted">Operational thresholds that decide what appears in the exception queue — not clinical norms. Each starts unreviewed; changing a threshold clears its review.</p>
      {current.map((r) => (
        <div key={r.id} className="stack tight" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.5rem' }}>
          <div className="row between wrap">
            <label className="check">
              <input type="checkbox" checked={r.enabled} onChange={(e) => save(updateRule(current, r.id, { enabled: e.target.checked }))} />
              <span className="small">{r.label}</span>
            </label>
            <span className={`badge ${r.reviewedBy ? 'clinical' : 'warn'}`}>{r.reviewedBy ? `reviewed by ${r.reviewedBy} ${fmtDate(r.reviewedAt!)}` : 'unreviewed'}</span>
          </div>
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ width: '9rem' }}>
              <span>Threshold ({r.unit})</span>
              <input className="input num" type="number" value={draft[r.id] ?? String(r.threshold)} onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))} onBlur={() => {
                const v = Number(draft[r.id]);
                if (draft[r.id] !== undefined && Number.isFinite(v) && v >= 0) save(updateRule(current, r.id, { threshold: v }));
              }} />
            </label>
            {!r.reviewedBy && (
              <button className="btn secondary sm" onClick={() => save(reviewRule(current, r.id, reviewerName, new Date().toISOString()))}>
                Mark reviewed at this threshold
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
