import { useState } from 'react';
import { hasFinalEvaluationData, SUBGROUP_KEYS, summariseValidation, validationPairs, type MetricSummary, type SubgroupKey } from '../../clinical/validationData';
import { Notice } from '../../components/ui';
import { updateSettings, useDb } from '../../data/store';
import { REQUIRED_VALIDATION_METRICS, validateReleaseThresholds } from '../../release/validationThresholds';

/**
 * Validation study panel (clinician Settings). Release thresholds are the clinical lead's decision:
 * they start EMPTY, are entered here and locked before the final evaluation set is analysed.
 * Agreement figures are shown per split and are descriptive until the study protocol is complete.
 */
const METRICS = REQUIRED_VALIDATION_METRICS;

const EMPTY_ROW = { loaWithin: '', maxFailureRate: '', minIcc: '', minN: '' };

export function ValidationStudyPanel({ actorId, isDemo }: { actorId: string; isDemo: boolean }) {
  const db = useDb((d) => d);
  const rt = db.settings.releaseThresholds ?? null;
  const rows = summariseValidation(db);
  const pairs = validationPairs(db);
  const [draft, setDraft] = useState<Record<string, { loaWithin: string; maxFailureRate: string; minIcc: string; minN: string }>>({});
  const [thresholdError, setThresholdError] = useState('');
  const f = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '–' : v.toFixed(d));

  const lock = () => {
    if (hasFinalEvaluationData(db)) {
      setThresholdError('Final-evaluation camera captures or references already exist. Thresholds must be locked before either is collected. Ask the study team to document a new prospective protocol.');
      return;
    }
    const values: NonNullable<typeof rt>['values'] = {};
    for (const metric of METRICS) {
      const row = draft[metric] ?? EMPTY_ROW;
      if (Object.values(row).some((value) => value.trim() === '')) {
        setThresholdError(`Complete every field before locking; ${metric.replace(/_/g, ' ')} is incomplete.`);
        return;
      }
      values[metric] = {
        loaWithin: Number(row.loaWithin),
        maxFailureRate: Number(row.maxFailureRate) / 100,
        minIcc: Number(row.minIcc),
        minN: Number(row.minN),
      };
    }
    const errors = validateReleaseThresholds({ values, lockedBy: actorId, lockedAt: new Date().toISOString() });
    if (errors.length) {
      setThresholdError(errors[0]);
      return;
    }
    setThresholdError('');
    if (!confirm('Lock all release thresholds? They cannot be changed once evaluation data is analysed.')) return;
    updateSettings({ releaseThresholds: { values, lockedBy: actorId, lockedAt: new Date().toISOString() } }, actorId);
  };

  const exportJson = () => {
    const doc = { kind: 'physiovision-validation-export', version: 1, exportedAt: new Date().toISOString(), privacy: 'Pseudonymous participant ids only; no names, images or video.', releaseThresholds: rt, summary: rows, pairs: pairs.map((p) => ({ ...p, patientId: `P-${p.patientId.slice(0, 8)}` })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' }));
    a.download = `physiovision-validation-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="panel stack">
      <h2>Validation study</h2>
      <p className="small muted">
        Pairs camera metrics with clinician reference measurements (entered under each capture). Participants are assigned to a <strong>tuning</strong> or <strong>final evaluation</strong> split, never both. Demo and simulated data are excluded. See docs/validation/STUDY_PROTOCOL.md.
      </p>
      <h3>Release thresholds {rt ? `(locked ${new Date(rt.lockedAt).toLocaleDateString()})` : '(not set)'}</h3>
      {rt ? (
        <table className="data">
          <thead>
            <tr>
              <th>Metric</th>
              <th>LoA within ±</th>
              <th>Max failure</th>
              <th>Min ICC</th>
              <th>Min n</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(rt.values).map(([k, v]) => (
              <tr key={k}>
                <td>{k.replace(/_/g, ' ')}</td>
                <td>{v.loaWithin}</td>
                <td>{Math.round(v.maxFailureRate * 100)}%</td>
                <td>{v.minIcc}</td>
                <td>{v.minN}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <Notice tone="info">The clinical lead sets these before any final-evaluation data is analysed. They are not pre-filled: there is no evidence-based default to offer.</Notice>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="data">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>LoA within ± (units)</th>
                  <th>Max failure %</th>
                  <th>Min ICC</th>
                  <th>Min n</th>
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => (
                  <tr key={m}>
                    <td>{m.replace(/_/g, ' ')}</td>
                    {(['loaWithin', 'maxFailureRate', 'minIcc', 'minN'] as const).map((k) => (
                      <td key={k}>
                        <input
                          className="input"
                          inputMode="decimal"
                          style={{ width: '5.5rem' }}
                          aria-label={`${m} ${k}`}
                          value={draft[m]?.[k] ?? ''}
                          onChange={(e) => setDraft((d) => ({ ...d, [m]: { ...(d[m] ?? EMPTY_ROW), [k]: e.target.value } }))}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {thresholdError && <Notice tone="warn">{thresholdError}</Notice>}
          <button className="btn secondary sm" disabled={isDemo} onClick={lock} title={isDemo ? 'Demo accounts cannot lock thresholds' : undefined}>
            Lock thresholds
          </button>
        </>
      )}
      <h3>Results so far</h3>
      {!rows.length ? (
        <p className="small muted">No eligible camera captures or reference measurements yet.</p>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="data">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Split</th>
                <th>Participants</th>
                <th>Pairs (valid)</th>
                <th>Bias</th>
                <th>95% LoA</th>
                <th>MAE</th>
                <th>Capture failure</th>
                <th>Test–retest ICC (n)</th>
                <th>Missing</th>
                <th>Release check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.metricId}${r.split}`}>
                  <td>{r.metricId.replace(/_/g, ' ')}</td>
                  <td>{r.split}</td>
                  <td>{r.participants}</td>
                  <td>
                    {r.failure.n} ({r.agreement?.n ?? 0})
                  </td>
                  <td>{f(r.agreement?.bias)}</td>
                  <td>{r.agreement ? `${f(r.agreement.loaLower)} to ${f(r.agreement.loaUpper)}` : '–'}</td>
                  <td>{f(r.agreement?.mae)}</td>
                  <td>{r.failure.rate === null ? '–' : `${Math.round(r.failure.rate * 100)}%`}</td>
                  <td>
                    {f(r.repeatability.icc, 2)} ({r.repeatability.n})
                  </td>
                  <td className="xs">
                    {r.missing.validCaptureNoReference} without reference · {r.missing.referenceCameraInvalid} reference with no valid camera value
                  </td>
                  <td className="xs">{r.release ? (r.release.pass ? 'meets locked thresholds' : r.release.reasons.join('; ')) : 'tuning split — not a release test'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <StudyDetail rows={rows} />}
      <div className="row">
        <button className="btn secondary sm" onClick={exportJson} disabled={!pairs.length}>
          Export validation data (JSON)
        </button>
      </div>
    </section>
  );
}

const SUBGROUP_LABEL: Record<SubgroupKey, string> = {
  device: 'Device',
  model: 'Pose model',
  view: 'Camera view',
  lighting: 'Lighting',
  clothing: 'Clothing',
  skinToneBand: 'Skin-tone band (consented only)',
  sex: 'Sex',
  ageBand: 'Age band',
};

/** Per-metric detail: subgroups, test–retest and failure reasons (STUDY_PROTOCOL steps 4 and 6). */
function StudyDetail({ rows }: { rows: MetricSummary[] }) {
  const [key, setKey] = useState(`${rows[0].metricId}|${rows[0].split}`);
  const r = rows.find((x) => `${x.metricId}|${x.split}` === key) ?? rows[0];
  const f = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '–' : v.toFixed(d));
  return (
    <div className="stack tight">
      <label className="field" style={{ maxWidth: '28rem' }}>
        <span>Detail for</span>
        <select className="input" value={key} onChange={(e) => setKey(e.target.value)}>
          {rows.map((x) => (
            <option key={`${x.metricId}|${x.split}`} value={`${x.metricId}|${x.split}`}>
              {x.metricId.replace(/_/g, ' ')} · {x.split}
            </option>
          ))}
        </select>
      </label>
      <p className="xs muted" style={{ margin: 0 }}>
        Test–retest: ICC(2,1) {f(r.repeatability.icc, 2)}, SEM {f(r.repeatability.sem)}, MDC95 {f(r.repeatability.mdc95)} from {r.repeatability.n} participant(s) with a second session on a later day (same protocol version, view and device).
        {r.repeatability.excluded.map((e) => ` ${e.count} without a pair: ${e.reason}.`).join('')}
      </p>
      {r.failureReasons.length > 0 && (
        <p className="xs" style={{ margin: 0 }}>
          Failure reasons: {r.failureReasons.map((x) => `${x.reason} (${x.count})`).join(' · ')}
        </p>
      )}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Agreement by subgroup">
        <table className="data compact">
          <thead>
            <tr>
              <th>Subgroup</th>
              <th>Group</th>
              <th className="num">n</th>
              <th className="num">Bias</th>
              <th>95% LoA</th>
            </tr>
          </thead>
          <tbody>
            {SUBGROUP_KEYS.flatMap((k) =>
              r.subgroups[k].map((g, i) => (
                <tr key={`${k}-${g.group}`}>
                  <td>{i === 0 ? SUBGROUP_LABEL[k] : ''}</td>
                  <td>{g.group}</td>
                  <td className="num">{g.n}</td>
                  <td className="num">{f(g.agreement?.bias)}</td>
                  <td>{g.agreement ? `${f(g.agreement.loaLower)} to ${f(g.agreement.loaUpper)}` : g.n < 2 ? 'n too small' : '–'}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="xs muted" style={{ margin: 0 }}>Small groups are shown with their n, not pooled away. These figures describe the records entered; they are evidence only within the locked study protocol.</p>
    </div>
  );
}
