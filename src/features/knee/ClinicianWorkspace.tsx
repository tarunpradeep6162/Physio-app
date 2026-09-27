import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { buildEvidence, capturesFor, type EvidenceItem } from '../../clinical/evidence';
import { currentAnswers, formatAnswer, organiseHistory } from '../../clinical/intake';
import { evaluate, RULE_SET, STATE_LABEL, type EvaluatedConsideration } from '../../clinical/reasoning';
import { levelFromResponses, SAFETY_ACTION_TEXT, SAFETY_QUESTIONNAIRE } from '../../clinical/safety';
import { IconClose } from '../../components/icons';
import { CategoryBadge, DemoBadge, Loader, Notice, Segmented } from '../../components/ui';
import type { Assessment, DB, Measurement, ReasoningAction, ReviewStatus, TestPlanItem } from '../../data/models';
import { age, fmtDate, fmtDateTime } from '../../data/queries';
import { insert, update, useDb, uuid } from '../../data/store';
import { getProtocol, PROTOCOLS } from '../../engine/protocols/knee';
import type { Side } from '../../engine/types';
import { BodyMap } from '../bodymap/BodyMap';
import { regionLabel } from '../bodymap/regions';
import { currentPlan, itemKey, savePlan } from './persist';
import { Replay } from './Replay';
import { BilateralTable, CaptureCard, ComparisonTable } from './Results';

const ReportPanel = lazy(() => import('../report/ReportPanel').then((m) => ({ default: m.ReportPanel })));

type Tab = 'summary' | 'plan' | 'captures' | 'compare' | 'reasoning' | 'report';
const CAT_BADGE = { patient_reported: 'pro', camera_estimated: 'camera', algorithmic: 'observation', clinician: 'clinician' } as const;
const CAT_TITLE = { patient_reported: 'Patient-reported', camera_estimated: 'Camera-estimated', algorithmic: 'Algorithmic observations', clinician: 'Clinician-entered' } as const;
const PATH_COLORS: Record<string, string> = { pain: '#e65a5a', stiffness: '#0d9488', weakness: '#8a5a00', numbness: '#7c5cd6', tingling: '#2563eb' };

export function KneeWorkspace({ a }: { a: Assessment }) {
  const user = useCurrentUser();
  const db = useDb((d) => d);
  const [tab, setTab] = useState<Tab>((new URLSearchParams(location.search).get('tab') as Tab) ?? 'summary');
  const patient = db.patients.find((p) => p.id === a.patientId)!;
  const safety = db.safetyResponses.filter((r) => r.assessmentId === a.id);
  const level = safety.length ? levelFromResponses(safety) : a.safetyLevel;
  if (!user) return null;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'summary', label: 'History & safety' },
    { id: 'plan', label: 'Test plan' },
    { id: 'captures', label: 'Captures & replay' },
    { id: 'compare', label: a.type === 'reassessment' ? 'Baseline → current' : 'Left / right' },
    { id: 'reasoning', label: 'Evidence & reasoning' },
    { id: 'report', label: 'Report' },
  ];
  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Knee {a.type === 'reassessment' ? 'reassessment' : 'assessment'} · {a.status.replace('_', ' ')}</p>
          <h1>
            <Link to={`/c/patients/${patient.id}`} style={{ color: 'inherit' }}>
              {patient.name}
            </Link>{' '}
            <DemoBadge show={!!a.isDemo} />
          </h1>
          <p className="small muted">
            {age(patient.dob) ?? '–'} y · started {fmtDateTime(a.createdAt)} {a.submittedAt && `· submitted ${fmtDateTime(a.submittedAt)}`}
            {a.baselineAssessmentId && ' · matched to baseline'}
          </p>
        </div>
      </div>
      {level && level !== 'clear' && (
        <Notice tone={level === 'clinician_review' ? 'warn' : 'danger'}>
          <strong>Safety pathway: {SAFETY_ACTION_TEXT[level].title}</strong> — routine automated conclusions are withheld. Triggered: {safety.filter((s) => s.answer).map((s) => s.questionText).join(' · ')}
        </Notice>
      )}
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab db={db} a={a} actorId={user.id} />}
      {tab === 'plan' && <PlanTab db={db} a={a} actorId={user.id} />}
      {tab === 'captures' && <CapturesTab db={db} a={a} actorId={user.id} />}
      {tab === 'compare' && (
        <div className="stack">
          <BilateralTable db={db} assessmentId={a.id} />
          {a.type === 'reassessment' && <ComparisonTable db={db} current={a} />}
        </div>
      )}
      {tab === 'reasoning' && <ReasoningTab db={db} a={a} actorId={user.id} />}
      {tab === 'report' && (
        <Suspense fallback={<Loader />}>
          <ReportPanel assessmentId={a.id} />
        </Suspense>
      )}
    </div>
  );
}

function SummaryTab({ db, a, actorId }: { db: DB; a: Assessment; actorId: string }) {
  const rows = db.intakeAnswers.filter((r) => r.assessmentId === a.id);
  const answers = currentAnswers(rows);
  const regions = db.painRegions.filter((r) => r.assessmentId === a.id);
  const paths = db.radiationPaths.filter((p) => p.assessmentId === a.id);
  const lines = organiseHistory(answers, regions);
  const amendments = db.amendments.filter((m) => m.assessmentId === a.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showSrc, setShowSrc] = useState<string | null>(null);
  const safety = db.safetyResponses.filter((r) => r.assessmentId === a.id);
  return (
    <div className="stack">
      <div className="grid cols-2">
        <section className="panel stack">
          <div className="row between">
            <h2>Symptom map</h2>
            <CategoryBadge kind="pro" />
          </div>
          <BodyMap selected={regions.map((r) => r.regionId)} onToggle={() => undefined} readOnly compact paths={paths.map((p) => ({ id: p.id, view: p.view, points: p.points, color: PATH_COLORS[p.symptomType], label: p.symptomType }))} />
          <table className="data">
            <tbody>
              {regions.map((r) => (
                <tr key={r.id}>
                  <td className="small">{regionLabel(r.regionId)}</td>
                  <td className="small">{(r.symptomTypes ?? []).join(', ')}</td>
                  <td className="small muted">{r.subLocations?.join(', ')}</td>
                </tr>
              ))}
              {paths.map((p) => (
                <tr key={p.id}>
                  <td className="small">Radiation path ({p.view})</td>
                  <td className="small">{p.symptomType}</td>
                  <td className="small muted">{p.points.length} points</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel stack">
          <div className="row between wrap">
            <h2>History</h2>
            <CategoryBadge kind="pro" />
          </div>
          <p className="xs muted">Auto-organised from the patient’s own answers (rule-based, no AI inference). Each line links to its source answers. Amendments are stored separately; the originals are preserved.</p>
          {lines.map((l) => {
            const amended = amendments.filter((m) => m.target === l.key).sort((x, y) => y.at.localeCompare(x.at))[0];
            return (
              <div key={l.key} className="stack tight" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.5rem' }}>
                {amended ? (
                  <>
                    <p>
                      {amended.amended} <span className="badge clinician">✎ clinician amended</span>
                    </p>
                    <p className="xs muted">
                      <s>{l.text}</s>
                    </p>
                  </>
                ) : (
                  <p>{l.text}</p>
                )}
                <div className="row wrap">
                  <button className="btn ghost sm" onClick={() => setShowSrc(showSrc === l.key ? null : l.key)}>
                    Sources ({l.sources.length})
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setEditing(l.key);
                      setDraft(amended?.amended ?? l.text);
                    }}
                  >
                    Amend
                  </button>
                </div>
                {showSrc === l.key && (
                  <ul className="xs" style={{ margin: 0 }}>
                    {l.sources.map((s) => {
                      const r = rows.filter((x) => x.questionId === s).sort((x, y) => y.answeredAt.localeCompare(x.answeredAt))[0];
                      return (
                        <li key={s}>
                          {r ? (
                            <>
                              “{r.questionText}” → <strong>{formatAnswer(s, r.answer)}</strong> ({fmtDateTime(r.answeredAt)}, {r.questionnaireId}@{r.questionnaireVersion})
                            </>
                          ) : (
                            s === 'symptom_map' ? 'Symptom map' : s
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {editing === l.key && (
                  <div className="stack tight">
                    <textarea className="input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Amended text" />
                    <div className="row">
                      <button
                        className="btn primary sm"
                        onClick={() => {
                          insert('amendments', { id: uuid(), assessmentId: a.id, target: l.key, original: l.text, amended: draft, by: actorId, at: new Date().toISOString() }, actorId, 'history_amend');
                          setEditing(null);
                        }}
                      >
                        Save amendment
                      </button>
                      <button className="btn ghost sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
      <section className="panel stack tight">
        <h2>Original answers (verbatim, including superseded)</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Question (as asked)</th>
                <th>Answer</th>
                <th>When</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].sort((x, y) => x.answeredAt.localeCompare(y.answeredAt)).map((r) => (
                <tr key={r.id}>
                  <td className="small">{r.questionText}</td>
                  <td className="small">{formatAnswer(r.questionId, r.answer)}</td>
                  <td className="xs">{fmtDateTime(r.answeredAt)}</td>
                  <td className="xs">{r.supersededBy ? 'superseded' : 'current'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stack tight">
        <div className="row between wrap">
          <h2>Safety screen</h2>
          <span className="xs muted">
            {SAFETY_QUESTIONNAIRE.id}@{SAFETY_QUESTIONNAIRE.version} · {db.settings.ruleApprovals[`${SAFETY_QUESTIONNAIRE.id}@${SAFETY_QUESTIONNAIRE.version}`] ? 'approved' : 'DRAFT'}
          </span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Question</th>
                <th>Answer</th>
                <th>Trigger → action</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {safety.map((s) => (
                <tr key={s.id}>
                  <td className="small">{s.questionText}</td>
                  <td className="small">{s.answer ? 'YES' : 'No'}</td>
                  <td className="small">{s.triggered ? `⚠ ${s.action}` : '—'}</td>
                  <td className="xs">{fmtDateTime(s.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {safety.length === 0 && <p className="small muted">Not answered yet.</p>}
        </div>
      </section>
    </div>
  );
}

function PlanTab({ db, a, actorId }: { db: DB; a: Assessment; actorId: string }) {
  const plan = currentPlan(db, a.id);
  const history = db.testPlans.filter((p) => p.assessmentId === a.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const [items, setItems] = useState<TestPlanItem[]>(plan?.items ?? []);
  const [note, setNote] = useState('');
  const [add, setAdd] = useState<{ protocolId: string; side: Side | null }>({ protocolId: 'knee_supported_flexion', side: 'left' });
  const def = getProtocol(add.protocolId);
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row between wrap">
          <h2>Clinician-editable test plan</h2>
          <span className="small muted">{plan ? `current: ${plan.source.replace('_', ' ')} · ${fmtDateTime(plan.createdAt)}` : 'no plan yet — patient will receive the default plan'}</span>
        </div>
        <div className="list">
          {items.map((i, k) => {
            const d = getProtocol(i.protocolId, i.protocolVersion);
            return (
              <div key={itemKey(i) + k} className="list-item">
                <span className="grow">
                  {d.title}
                  {i.side && d.sided ? ` — ${i.side}` : ''} <span className="xs muted">v{i.protocolVersion}</span>
                </span>
                <button className="btn ghost sm" onClick={() => setItems(items.filter((_, j) => j !== k))}>
                  Remove
                </button>
              </div>
            );
          })}
        </div>
        <div className="row wrap">
          <select className="input" style={{ width: 'auto' }} value={add.protocolId} onChange={(e) => setAdd({ protocolId: e.target.value, side: getProtocol(e.target.value).sided ? 'left' : null })} aria-label="Protocol">
            {Object.values(PROTOCOLS).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} (v{p.version})
              </option>
            ))}
          </select>
          {def.sided && <Segmented label="Side" value={add.side ?? 'left'} onChange={(v) => setAdd({ ...add, side: v })} options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />}
          <button
            className="btn secondary"
            disabled={items.some((i) => itemKey(i) === itemKey(add))}
            onClick={() => setItems([...items, { protocolId: add.protocolId, protocolVersion: def.version, side: def.sided ? add.side : null }])}
          >
            Add test
          </button>
        </div>
        <input className="input" placeholder="Reason for change (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary" disabled={!items.length} onClick={() => savePlan(a.id, actorId, items, note || undefined)}>
          Save plan revision
        </button>
      </section>
      <section className="panel stack tight">
        <h3>Plan revisions</h3>
        {history.map((p) => (
          <p key={p.id} className="small">
            {fmtDateTime(p.createdAt)} · {p.source.replace('_', ' ')} · {p.items.map((i) => `${getProtocol(i.protocolId).shortTitle}${i.side ? ` (${i.side[0].toUpperCase()})` : ''}`).join(', ')}
            {p.note && ` — “${p.note}”`}
          </p>
        ))}
      </section>
    </div>
  );
}

function CapturesTab({ db, a, actorId }: { db: DB; a: Assessment; actorId: string }) {
  const caps = capturesFor(db, a.id);
  const all = db.captures.filter((c) => c.assessmentId === a.id);
  const decide = (m: Measurement, status: ReviewStatus) => update('measurements', m.id, { reviewStatus: status, reviewedBy: actorId, reviewedAt: new Date().toISOString() }, actorId, `review:${status}`);
  if (!caps.length) return <p className="muted">No captures yet.</p>;
  return (
    <div className="stack">
      <p className="small muted">
        Showing the latest capture per test ({all.length} captures in total, earlier attempts retained). Accepting a camera estimate records that you reviewed it; it remains labelled camera-estimated.
      </p>
      {caps.map((c) => {
        const ms = db.measurements.filter((m) => m.captureId === c.id);
        return (
          <div key={c.id} className="stack tight">
            <CaptureCard cap={c} />
            {ms.length > 0 && (
              <div className="panel row wrap" style={{ padding: '0.6rem' }}>
                {ms.map((m) => (
                  <div key={m.id} className="row" style={{ gap: '0.35rem' }}>
                    <span className="xs">{m.metricId?.replace(/_/g, ' ')}</span>
                    <span className={`badge ${m.reviewStatus === 'accepted' ? 'clinical' : m.reviewStatus === 'rejected' ? 'danger' : 'review'}`}>{m.reviewStatus.replace('_', ' ')}</span>
                    {m.validity === 'valid' ? (
                      <>
                        <button className="btn sm primary" onClick={() => decide(m, 'accepted')}>
                          Accept
                        </button>
                        <button className="btn sm danger" onClick={() => decide(m, 'rejected')}>
                          Reject
                        </button>
                        <button className="btn sm secondary" onClick={() => decide(m, 'repeat_requested')}>
                          Repeat
                        </button>
                      </>
                    ) : (
                      <span className="xs muted">invalid — not reviewable</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReasoningTab({ db, a, actorId }: { db: DB; a: Assessment; actorId: string }) {
  const evidence = useMemo(() => buildEvidence(db, a.id), [db, a.id]);
  const level = a.safetyLevel;
  const results = useMemo(() => evaluate(evidence, level), [evidence, level]);
  const [focus, setFocus] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [impression, setImpression] = useState('');
  const decisions = db.reasoningDecisions.filter((d) => d.assessmentId === a.id);
  const impressions = db.impressions.filter((i) => i.assessmentId === a.id).sort((x, y) => y.at.localeCompare(x.at));
  const approved = db.settings.ruleApprovals[`${RULE_SET.id}@${RULE_SET.version}`];
  const focused = results.find((r) => r.rule.id === focus);
  const linked = new Set(focused ? [...focused.supporting, ...focused.conflicting].flatMap((s) => s.evidence.map((e) => e.id)) : []);
  const whyItem = evidence.find((e) => e.id === why);

  const act = (r: EvaluatedConsideration, action: ReasoningAction) => {
    insert(
      'reasoningDecisions',
      {
        id: uuid(),
        assessmentId: a.id,
        ruleSetId: RULE_SET.id,
        ruleSetVersion: RULE_SET.version,
        considerationId: r.rule.id,
        suggestion: { state: r.state, supporting: r.supporting.map((s) => s.label), conflicting: r.conflicting.map((s) => s.label), missing: r.missing },
        action,
        note: notes[r.rule.id] || undefined,
        by: actorId,
        at: new Date().toISOString(),
        isDemo: a.isDemo,
      },
      actorId,
      `reasoning:${action}`,
    );
    setNotes((n) => ({ ...n, [r.rule.id]: '' }));
  };

  return (
    <div className="stack loose">
      <Notice tone="warn">
        Evidence-linked considerations for clinician review — not diagnoses, and no probabilities are computed. Rule set {RULE_SET.id}@{RULE_SET.version}: {approved ? `approved ${fmtDate(approved.approvedAt)}` : RULE_SET.status}.
      </Notice>

      <section className="stack">
        <div className="row between wrap">
          <h2>Evidence map</h2>
          <span className="small muted">Select a consideration to highlight its evidence · select an item for “Why?”</span>
        </div>
        <div className="evidence-grid">
          {(['patient_reported', 'camera_estimated', 'algorithmic', 'clinician'] as const).map((cat) => (
            <div key={cat} className="stack tight">
              <div className="row">
                <CategoryBadge kind={CAT_BADGE[cat]} />
                <span className="xs muted">{evidence.filter((e) => e.category === cat).length}</span>
              </div>
              {evidence
                .filter((e) => e.category === cat)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`ev-item ${cat} ${e.validity === 'invalid' ? 'invalid' : ''} ${focus ? (linked.has(e.id) ? 'linked' : 'dim') : ''}`}
                    aria-pressed={why === e.id}
                    onClick={() => setWhy(e.id)}
                    title={`${CAT_TITLE[cat]} — open Why?`}
                  >
                    <div style={{ fontWeight: 650 }}>{e.label}</div>
                    <div className="muted">{e.value}</div>
                    {e.validity === 'invalid' && <div className="xs" style={{ color: 'var(--red-ink)' }}>✗ invalid — excluded from reasoning</div>}
                  </button>
                ))}
              {evidence.filter((e) => e.category === cat).length === 0 && <p className="xs muted">None</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2>Differential considerations</h2>
        {results.map((r) => {
          const hist = decisions.filter((d) => d.considerationId === r.rule.id).sort((x, y) => y.at.localeCompare(x.at));
          return (
            <article key={r.rule.id} className={`consideration stack tight ${focus === r.rule.id ? 'active' : ''}`} onMouseEnter={() => setFocus(r.rule.id)} onFocus={() => setFocus(r.rule.id)}>
              <div className="row between wrap">
                <div>
                  <h3>{r.rule.title}</h3>
                  <p className="small muted">{r.rule.summary}</p>
                </div>
                <span className={`state-pill ${r.state}`}>{STATE_LABEL[r.state]}</span>
              </div>
              {r.state !== 'safety_hold' && (
                <div className="grid cols-2">
                  <div>
                    <strong className="small">Supporting ({r.supporting.length})</strong>
                    <ul className="small" style={{ margin: '0.25rem 0', paddingLeft: '1.1rem' }}>
                      {r.supporting.map((s) => (
                        <li key={s.label}>
                          {s.label}{' '}
                          {s.evidence.map((e) => (
                            <button key={e.id} className="btn ghost sm" style={{ minHeight: 28, padding: '0 0.4rem' }} onClick={() => setWhy(e.id)}>
                              why?
                            </button>
                          ))}
                        </li>
                      ))}
                      {!r.supporting.length && <li className="muted">none</li>}
                    </ul>
                    <strong className="small">Conflicting ({r.conflicting.length})</strong>
                    <ul className="small" style={{ margin: '0.25rem 0', paddingLeft: '1.1rem' }}>
                      {r.conflicting.map((s) => (
                        <li key={s.label}>
                          {s.label}{' '}
                          {s.evidence.map((e) => (
                            <button key={e.id} className="btn ghost sm" style={{ minHeight: 28, padding: '0 0.4rem' }} onClick={() => setWhy(e.id)}>
                              why?
                            </button>
                          ))}
                        </li>
                      ))}
                      {!r.conflicting.length && <li className="muted">none</li>}
                    </ul>
                  </div>
                  <div>
                    <strong className="small">Missing information</strong>
                    <ul className="small" style={{ margin: '0.25rem 0', paddingLeft: '1.1rem' }}>
                      {r.missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                      {!r.missing.length && <li className="muted">none</li>}
                    </ul>
                    <strong className="small">Further questions / tests (clinician)</strong>
                    <ul className="small" style={{ margin: '0.25rem 0', paddingLeft: '1.1rem' }}>
                      {r.rule.furtherExamination.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                    <strong className="small">What would change this assessment?</strong>
                    <ul className="small" style={{ margin: '0.25rem 0', paddingLeft: '1.1rem' }}>
                      {r.rule.whatWouldChange.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              <div className="row wrap">
                <input className="input grow" style={{ minHeight: 38, minWidth: 180 }} placeholder="Annotation (optional)" value={notes[r.rule.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.rule.id]: e.target.value }))} aria-label={`Annotation for ${r.rule.title}`} />
                <button className="btn sm primary" onClick={() => act(r, 'accept')}>
                  Accept
                </button>
                <button className="btn sm danger" onClick={() => act(r, 'reject')}>
                  Reject
                </button>
                <button className="btn sm secondary" onClick={() => act(r, 'defer')}>
                  Defer
                </button>
                <button className="btn sm ghost" disabled={!notes[r.rule.id]} onClick={() => act(r, 'annotate')}>
                  Annotate
                </button>
              </div>
              {hist.length > 0 && (
                <p className="xs muted">
                  Clinician actions:{' '}
                  {hist.map((d) => `${d.action}${d.note ? ` (“${d.note}”)` : ''} ${fmtDateTime(d.at)} [suggestion then: ${d.suggestion.state}]`).join(' · ')}
                </p>
              )}
            </article>
          );
        })}
      </section>

      <section className="panel stack">
        <div className="row between wrap">
          <h2>Clinician impression</h2>
          <CategoryBadge kind="clinical" />
        </div>
        {impressions[0] ? (
          <p>
            <strong>Recorded {fmtDateTime(impressions[0].at)}:</strong> {impressions[0].text}
          </p>
        ) : (
          <p className="small muted">No clinician impression yet. Reports stay “AI preliminary” until one is recorded and the report is approved.</p>
        )}
        <textarea className="input" value={impression} onChange={(e) => setImpression(e.target.value)} placeholder="Your clinical impression, informed by examination findings…" />
        <div className="row wrap">
          <button
            className="btn primary"
            disabled={!impression.trim()}
            onClick={() => {
              insert('impressions', { id: uuid(), assessmentId: a.id, text: impression.trim(), by: actorId, at: new Date().toISOString(), isDemo: a.isDemo }, actorId, 'impression');
              update('assessments', a.id, { status: 'reviewed', reviewedAt: new Date().toISOString(), reviewedBy: actorId }, actorId, 'review_complete');
              setImpression('');
            }}
          >
            Record impression & complete review
          </button>
          <Link className="btn secondary" to={`/c/programs/new?patient=${a.patientId}`}>
            Prescribe rehabilitation
          </Link>
        </div>
      </section>

      {whyItem && <WhyPanel item={whyItem} evidence={evidence} results={results} db={db} onClose={() => setWhy(null)} onOpen={setWhy} />}
    </div>
  );
}

function WhyPanel({ item, evidence, results, db, onClose, onOpen }: { item: EvidenceItem; evidence: EvidenceItem[]; results: EvaluatedConsideration[]; db: DB; onClose: () => void; onOpen: (id: string) => void }) {
  const supports = results.filter((r) => r.supporting.some((s) => s.evidence.some((e) => e.id === item.id)));
  const conflicts = results.filter((r) => r.conflicting.some((s) => s.evidence.some((e) => e.id === item.id)));
  const src = item.source;
  const cap = src.kind === 'capture_metric' ? db.captures.find((c) => c.id === src.captureId) : undefined;
  return (
    <aside className="drawer stack" role="dialog" aria-label={`Why? ${item.label}`}>
      <div className="row between">
        <h2>Why?</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <IconClose width={18} />
        </button>
      </div>
      <div className="row wrap">
        <CategoryBadge kind={CAT_BADGE[item.category]} />
        <span className={`badge ${item.validity === 'invalid' ? 'danger' : item.validity === 'valid' ? 'ok' : ''}`}>validity: {item.validity}</span>
      </div>
      <div>
        <strong>{item.label}</strong>
        <p style={{ fontSize: '1.2rem', fontWeight: 700 }}>{item.value}</p>
      </div>
      <section className="stack tight">
        <h3>Source</h3>
        {src.kind === 'intake_answer' && (
          <p className="small">
            Patient answer to “{src.questionText}” ({src.questionnaire}) on {fmtDateTime(src.answeredAt)}. Stored verbatim.
          </p>
        )}
        {src.kind === 'symptom_map' && <p className="small">Patient symptom map entry.</p>}
        {src.kind === 'profile' && <p className="small">Patient profile field: {src.field}.</p>}
        {src.kind === 'safety' && <p className="small">{src.responseIds.length} safety questionnaire responses.</p>}
        {src.kind === 'clinician_measure' && <p className="small">Clinician-entered measurement.</p>}
        {src.kind === 'rule' && (
          <div className="small">
            Algorithmic observation <span className="mono">{src.rule}</span> based on:
            <ul>
              {src.basedOn.map((id) => (
                <li key={id}>
                  <button className="btn ghost sm" onClick={() => onOpen(id)}>
                    {evidence.find((e) => e.id === id)?.label ?? id}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {cap && (
          <>
            <p className="small">
              Camera capture {src.kind === 'capture_metric' && src.protocol} · {fmtDateTime(cap.createdAt)} · quality {cap.result.quality.verdict}
            </p>
            <Replay result={cap.result} focus={getProtocol(cap.protocolId).requiredLandmarks(cap.side)} height={200} label={getProtocol(cap.protocolId).signalLabel} unit={getProtocol(cap.protocolId).signalUnit === 'deg' ? '°' : '%'} />
          </>
        )}
      </section>
      {(item.method || item.version) && (
        <section className="stack tight">
          <h3>Method & version</h3>
          {item.method && <p className="small">{item.method}</p>}
          {item.version && <p className="xs mono">{item.version}</p>}
          {item.validityNote && <p className="xs muted">{item.validityNote}</p>}
        </section>
      )}
      <section className="stack tight">
        <h3>Used in reasoning</h3>
        {supports.map((r) => (
          <p key={r.rule.id} className="small">
            ✓ supports: {r.rule.title}
          </p>
        ))}
        {conflicts.map((r) => (
          <p key={r.rule.id} className="small">
            ✗ conflicts with: {r.rule.title}
          </p>
        ))}
        {!supports.length && !conflicts.length && <p className="small muted">Not used by any consideration rule.</p>}
      </section>
      {item.limitations.length > 0 && (
        <section className="stack tight">
          <h3>Limits</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {item.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
