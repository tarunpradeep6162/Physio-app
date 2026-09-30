import { DraftReview } from './DraftReview';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentUser } from '../../app/hooks';
import { buildEvidence, capturesFor, type EvidenceItem } from '../../clinical/evidence';
import { currentAnswers, formatAnswer, organiseHistory } from '../../clinical/intake';
import { evaluate, RULE_SET, STATE_LABEL, type EvaluatedConsideration } from '../../clinical/reasoning';
import { pathwayFor } from '../../clinical/pathways';
import { levelFromResponses, SAFETY_ACTION_TEXT } from '../../clinical/safety';
import { IconClose } from '../../components/icons';
import { CategoryBadge, DemoBadge, Loader, Notice, Segmented } from '../../components/ui';
import type { Assessment, DB, Measurement, ReasoningAction, ReviewStatus, TestPlanItem } from '../../data/models';
import { age, fmtDate, fmtDateTime } from '../../data/queries';
import { insert, update, useDb, uuid } from '../../data/store';
import { getProtocol, protocolsForRegion } from '../../engine/protocols/registry';
import type { Side } from '../../engine/types';
import { jointList } from '../../engine/landmarks';
import { capturedStatuses, POSTURE_METRICS, type PostureMetricId } from '../../engine/posture';
import type { ViewOrientation } from '../../engine/types';
import { BodyMap } from '../bodymap/BodyMap';
import { PostureBoard } from '../scan/PostureGrid';
import { regionLabel } from '../bodymap/regions';
import { currentPlan, itemKey, savePlan } from './persist';
import { Replay } from './Replay';
import { ReferenceMeasure } from './ReferenceMeasure';
import { BilateralTable, CaptureCard, ComparisonTable } from './Results';

const ReportPanel = lazy(() => import('../report/ReportPanel').then((m) => ({ default: m.ReportPanel })));

type Tab = 'summary' | 'plan' | 'captures' | 'compare' | 'draft' | 'reasoning' | 'report';
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
    { id: 'draft', label: 'AI draft' },
    { id: 'reasoning', label: 'Evidence & reasoning' },
    { id: 'report', label: 'Report' },
  ];
  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">
            {pathwayFor(a).label} {a.type === 'reassessment' ? 'reassessment' : 'assessment'} · {a.status.replace('_', ' ')}
          </p>
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
      {tab === 'draft' && <DraftReview db={db} a={a} actorId={user.id} />}
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
  const pathway = pathwayFor(a);
  const lines = organiseHistory(answers, regions, pathway.history);
  const SAFETY_QUESTIONNAIRE = pathway.safety;
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
                              “{r.questionText}” → <strong>{formatAnswer(s, r.answer, pathway.history)}</strong> ({fmtDateTime(r.answeredAt)}, {r.questionnaireId}@{r.questionnaireVersion})
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
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
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
                  <td className="small">{formatAnswer(r.questionId, r.answer, pathway.history)}</td>
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
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
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
  const [add, setAdd] = useState<{ protocolId: string; side: Side | null }>(() => ({ protocolId: pathwayFor(a).defaultPlan[0].protocolId, side: 'left' }));
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
          <select className="input" style={{ width: 'auto', maxWidth: '100%' }} value={add.protocolId} onChange={(e) => setAdd({ protocolId: e.target.value, side: getProtocol(e.target.value).sided ? 'left' : null })} aria-label="Protocol">
            {protocolsForRegion(pathwayFor(a).region).map((p) => (
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
  const patient = db.patients.find((p) => p.id === a.patientId);
  const decide = (m: Measurement, status: ReviewStatus) => update('measurements', m.id, { reviewStatus: status, reviewedBy: actorId, reviewedAt: new Date().toISOString() }, actorId, `review:${status}`);
  const scansByView = new Map<string, (typeof db.scans)[number]>();
  for (const scan of db.scans.filter((s) => s.assessmentId === a.id && s.kind === 'static_posture').sort((x, y) => x.createdAt.localeCompare(y.createdAt))) scansByView.set(scan.view, scan);
  if (!caps.length && !scansByView.size) return <p className="muted">No captures yet.</p>;
  return (
    <div className="stack">
      {!!caps.length && <p className="small muted">
        Showing the latest capture per test ({all.length} captures in total, earlier attempts retained). Accepting a camera estimate records that you reviewed it; it remains labelled camera-estimated.
      </p>}
      {caps.map((c) => {
        const ms = db.measurements.filter((m) => m.captureId === c.id && m.category === 'camera_estimate');
        return (
          <div key={c.id} className="stack tight">
            <CaptureCard cap={c} />
            {patient && <ReferenceMeasure cap={c} patient={patient} db={db} actorId={actorId} />}
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
      {!!scansByView.size && (
        <section className="panel stack">
          <div className="row between wrap"><h2>Static camera scan</h2><CategoryBadge kind="camera" /></div>
          <p className="small muted">Latest capture for each view. These are 2D alignment estimates and threshold observations, not diagnoses. Review the original camera source and quality before accepting a measure.</p>
          {[...scansByView.values()].map((scan) => {
            const ms = db.measurements.filter((m) => m.scanId === scan.id && m.type.startsWith('posture.'));
            return (
              <div key={scan.id} className="stack tight">
                <h3>{scan.view.replace(/_/g, ' ')} · {fmtDateTime(scan.createdAt)}</h3>
                <p className="xs muted mono">{scan.provenance.poseModel} {scan.provenance.poseModelVersion} · {scan.provenance.algorithmVersion} · {scan.provenance.source}</p>
                {!ms.length && <Notice tone="warn">No reliable measures were recorded for this view. Recapture is needed.</Notice>}
                <PostureBoard
                  view={scan.view as ViewOrientation}
                  landmarks={scan.landmarks}
                  frameWidth={scan.frameWidth}
                  frameHeight={scan.frameHeight}
                  image={scan.imageDataUrl}
                  statuses={capturedStatuses(
                    scan.view as ViewOrientation,
                    ms.filter((m) => m.unit === 'deg' || m.unit === 'pct_height').map((m) => ({ id: m.type.slice(8) as PostureMetricId, value: m.value, unit: m.unit as 'deg' | 'pct_height', direction: m.direction, confidence: m.confidence, sd: m.sd })),
                    scan.landmarks,
                    scan.frameWidth,
                    scan.frameHeight,
                  )}
                />
                {ms.map((m) => {
                  const metricId = m.type.slice(8) as PostureMetricId;
                  const def = POSTURE_METRICS.find((d) => d.id === metricId);
                  const obs = db.observations.filter((o) => o.measurementId === m.id);
                  return (
                  <div key={m.id} className="row between wrap" style={{ gap: '0.6rem' }}>
                    <span className="small grow">
                      {metricId.replace(/_/g, ' ')} estimated in this capture{m.direction ? ` · ${m.direction.replace(/_/g, ' ')}` : ''}
                      <span className="xs muted" style={{ display: 'block' }}>
                        from {def ? jointList(def.landmarks((scan.view as ViewOrientation) ?? 'anterior')) : 'landmarks'} · 2D image-plane estimate
                        {obs.map((o) => ` · observation: crossed configured threshold ${o.threshold}° (rule ${o.rule}, ${o.status})`).join('')}
                      </span>
                    </span>
                    <strong className="num">{m.value}{m.unit === 'deg' ? '°' : '% body height'}</strong>
                    <span className="xs muted">confidence {m.confidence.toFixed(2)} · ±{m.sd ?? '—'} · {m.reviewStatus}</span>
                    <div className="row wrap">
                      <button className="btn sm primary" onClick={() => decide(m, 'accepted')}>Accept</button>
                      <button className="btn sm danger" onClick={() => decide(m, 'rejected')}>Reject</button>
                      <button className="btn sm secondary" onClick={() => decide(m, 'repeat_requested')}>Repeat</button>
                    </div>
                  </div>
                );
                })}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

function ReasoningTab({ db, a, actorId }: { db: DB; a: Assessment; actorId: string }) {
  const evidence = useMemo(() => buildEvidence(db, a.id), [db, a.id]);
  const level = a.safetyLevel;
  const pathway = pathwayFor(a);
  const results = useMemo(() => (pathway.hasConsiderationRules ? evaluate(evidence, level) : []), [evidence, level, pathway.hasConsiderationRules]);
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
        {pathway.hasConsiderationRules ? (
          <>
            Evidence-linked considerations for clinician review — not diagnoses, and no probabilities are computed. Rule set {RULE_SET.id}@{RULE_SET.version}: {approved ? `approved ${fmtDate(approved.approvedAt)}` : RULE_SET.status}.
          </>
        ) : (
          <>Evidence for clinician review. The {pathway.label.toLowerCase()} pathway has no automated consideration rules: nothing is inferred, and the impression is yours alone.</>
        )}
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
        {!pathway.hasConsiderationRules && (
          <div className="stack tight">
            <p className="small muted">No draft consideration rules exist for this pathway. Record examination findings and your impression below.</p>
            <ul className="small">
              {pathway.scopeLimits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
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

/** Views in which a sagittal/frontal 2D angle is meaningful, in plain words. */
const VIEW_TEXT: Record<string, string> = { anterior: 'front view', posterior: 'back view', lateral_left: 'left side toward camera', lateral_right: 'right side toward camera', unknown: 'view not determined' };

/**
 * Exactly how a capture number was produced: which landmarks, which view, what processing — and
 * when the view makes the measure invalid, say "not measurable in this view" rather than a number.
 */
function CaptureCalculation({ cap, metricId }: { cap: DB['captures'][number]; metricId: string }) {
  const def = getProtocol(cap.protocolId, cap.protocolVersion);
  const m = cap.result.metrics.find((x) => x.id === metricId);
  const required = def.requiredLandmarks(cap.side);
  const views = def.views(cap.side);
  const issues = cap.result.quality.issues ?? {};
  const wrongView = (issues.wrong_orientation ?? 0) + (issues.orientation_uncertain ?? 0);
  const total = Object.values(issues).reduce((a, b) => a + b, 0);
  const viewBlocked = !views.includes(cap.result.view) || (total > 0 && wrongView / total > 0.5 && m?.validity !== 'valid');
  const proc = cap.result.processing;
  return (
    <section className="stack tight">
      <h3>Calculation</h3>
      {viewBlocked && m?.validity !== 'valid' && <Notice tone="warn">Not measurable in this view: this test needs the {views.map((v) => VIEW_TEXT[v]).join(' or ')}; the capture was mostly {VIEW_TEXT[cap.result.view] ?? cap.result.view}.</Notice>}
      <dl className="small calc-list">
        <dt>Landmarks used</dt>
        <dd>{jointList(required)} (BlazePose indices {required.join(', ')})</dd>
        <dt>Required view</dt>
        <dd>
          {views.map((v) => VIEW_TEXT[v]).join(' or ')} · recorded: {VIEW_TEXT[cap.result.view] ?? cap.result.view}
        </dd>
        {m && (
          <>
            <dt>Formula</dt>
            <dd>{m.method}</dd>
          </>
        )}
        <dt>Geometry</dt>
        <dd>2D image-plane estimate in pixel coordinates (aspect-corrected). It is not a 3D joint rotation or a force.</dd>
        <dt>Signal processing</dt>
        <dd>
          {proc
            ? `No landmark smoothing; plausibility guard ≤ ${proc.guard.maxRatePerSec}/s with ${proc.guard.recoverMs} ms recovery; stored values: ${proc.stored}; live display: ${proc.liveAngleFilter}.`
            : 'Recorded with pv-knee-1.0.0 processing (landmark and angle One Euro filters; live values stored).'}
        </dd>
        <dt>Algorithm</dt>
        <dd className="mono">
          {cap.result.algorithmVersion} · protocol {def.id}@{def.version}
        </dd>
      </dl>
    </section>
  );
}

function WhyPanel({ item, evidence, results, db, onClose, onOpen }: { item: EvidenceItem; evidence: EvidenceItem[]; results: EvaluatedConsideration[]; db: DB; onClose: () => void; onOpen: (id: string) => void }) {
  const supports = results.filter((r) => r.supporting.some((s) => s.evidence.some((e) => e.id === item.id)));
  const conflicts = results.filter((r) => r.conflicting.some((s) => s.evidence.some((e) => e.id === item.id)));
  const src = item.source;
  const cap = src.kind === 'capture_metric' ? db.captures.find((c) => c.id === src.captureId) : undefined;
  const scan = src.kind === 'scan_metric' ? db.scans.find((s) => s.id === src.scanId) : undefined;
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
        {scan && <p className="small">Static camera scan · {src.kind === 'scan_metric' && src.view} view · {fmtDateTime(scan.createdAt)}. Recorded landmarks are retained for clinician review; an image is stored only with separate consent.</p>}
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
      {cap && src.kind === 'capture_metric' && <CaptureCalculation cap={cap} metricId={src.metricId} />}
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
