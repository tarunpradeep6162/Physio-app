import { useState } from 'react';
import { currentAnswers, formatAnswer, HISTORY_QUESTIONNAIRE } from '../../clinical/intake';
import { CategoryBadge, DemoBadge, Notice } from '../../components/ui';
import type { Assessment, CaptureSession, DB } from '../../data/models';
import { fmtDate, fmtDateTime } from '../../data/queries';
import { getProtocol } from '../../engine/protocols/knee';
import type { ProtocolMetric } from '../../engine/protocols/types';
import { capturesFor } from '../../clinical/evidence';
import { Replay } from './Replay';

/** Display of knee-pathway captures, bilateral comparison and baseline/current comparison. */

export function unitText(u: ProtocolMetric['unit']): string {
  return u === 'deg' ? '°' : u === 's' ? ' s' : u === 'pct_leg' ? '% leg' : '';
}

export function metricValue(m: ProtocolMetric | undefined, cap?: CaptureSession): string {
  if (!m) return '—';
  if (cap && cap.result.quality.verdict !== 'valid') return 'invalid capture';
  if (m.validity !== 'valid' || m.value === null) return `not reported${m.reason ? ` (${m.reason})` : ''}`;
  return `${m.value}${unitText(m.unit)}`;
}

export function CaptureCard({ cap, showReplay = false }: { cap: CaptureSession; showReplay?: boolean }) {
  const [open, setOpen] = useState(showReplay);
  const def = getProtocol(cap.protocolId, cap.protocolVersion);
  const q = cap.result.quality;
  const simulated = cap.provenance.source === 'simulated_demo';
  return (
    <section className="panel stack tight">
      <div className="row between wrap">
        <div>
          <h3>
            {def.title}
            {cap.side && def.sided ? ` — ${cap.side}` : ''}
          </h3>
          <p className="xs muted mono">
            {def.id}@{def.version} · {cap.result.algorithmVersion} · {cap.provenance.poseModel} {cap.provenance.poseModelVersion} · view {cap.result.view} · {fmtDateTime(cap.createdAt)}
          </p>
        </div>
        <div className="row wrap">
          <CategoryBadge kind="camera" />
          <DemoBadge show={simulated} simulated />
          <span className={`badge ${q.verdict === 'valid' ? 'ok' : 'danger'}`}>{q.verdict === 'valid' ? '✓ valid capture' : '✗ invalid capture'}</span>
        </div>
      </div>
      {q.verdict === 'invalid' && <Notice tone="warn">{q.reasons.join('. ')}. Values are withheld; recapture required.</Notice>}
      <div className="table-wrap">
        <table className="data">
          <tbody>
            {cap.result.metrics.map((m) => (
              <tr key={m.id}>
                <td className="small">
                  {m.label}
                  {m.interpretation && <div className="xs muted">{m.interpretation}</div>}
                </td>
                <td className="num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {metricValue(m, cap)}
                </td>
                <td className="xs muted">{m.perCycle.length ? `per rep: ${m.perCycle.join(', ')}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="xs muted">
        Quality: coverage {Math.round(q.coverage * 100)}% · mean landmark confidence {q.meanConfidence ?? '—'} · {q.validCycles} valid of {q.attemptedCycles} attempts · {q.meanFps ?? '—'} fps
        {Object.keys(q.issues).length > 0 && ` · paused frames: ${Object.entries(q.issues).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}`}
        {cap.setupNotes && ` · setup: ${cap.setupNotes}`}
        {cap.conditionMatch && ` · setup match with baseline ${Math.round(cap.conditionMatch.score * 100)}%`}
      </p>
      <button type="button" className="btn ghost sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide replay' : 'Show synchronized replay'}
      </button>
      {open && <Replay result={cap.result} focus={def.requiredLandmarks(cap.side)} label={def.signalLabel} unit={def.signalUnit === 'deg' ? '°' : '%'} />}
    </section>
  );
}

const find = (caps: CaptureSession[], protocolId: string, side: 'left' | 'right' | null) => caps.find((c) => c.protocolId === protocolId && (c.side ?? null) === side);
const mOf = (c: CaptureSession | undefined, id: string) => c?.result.metrics.find((m) => m.id === id);
const validNum = (c: CaptureSession | undefined, id: string) => {
  const m = mOf(c, id);
  return c && c.result.quality.verdict === 'valid' && m?.validity === 'valid' && m.value !== null ? m.value : null;
};

export function BilateralTable({ db, assessmentId }: { db: DB; assessmentId: string }) {
  const caps = capturesFor(db, assessmentId);
  const rows: { label: string; left: string; right: string; diff: string }[] = [];
  const fl = find(caps, 'knee_supported_flexion', 'left');
  const fr = find(caps, 'knee_supported_flexion', 'right');
  for (const [id, label] of [
    ['knee_flexion_peak', 'Knee flexion (peak)'],
    ['knee_extension_position', 'Most-extended position (0° = straight)'],
  ] as const) {
    const l = validNum(fl, id);
    const r = validNum(fr, id);
    rows.push({ label, left: metricValue(mOf(fl, id), fl), right: metricValue(mOf(fr, id), fr), diff: l !== null && r !== null ? `${Math.round(Math.abs(l - r) * 10) / 10}°` : '—' });
  }
  const sq = find(caps, 'knee_squat', null);
  const sl = validNum(sq, 'squat_fppa_left');
  const sr = validNum(sq, 'squat_fppa_right');
  rows.push({ label: 'Squat FPPA (+ toward midline)', left: metricValue(mOf(sq, 'squat_fppa_left'), sq), right: metricValue(mOf(sq, 'squat_fppa_right'), sq), diff: sl !== null && sr !== null ? `${Math.round(Math.abs(sl - sr) * 10) / 10}°` : '—' });
  return (
    <section className="panel stack tight">
      <div className="row between wrap">
        <h2>Left / right comparison</h2>
        <CategoryBadge kind="camera" />
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Measure</th>
              <th>Left</th>
              <th>Right</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="small">{r.label}</td>
                <td className="num">{r.left}</td>
                <td className="num">{r.right}</td>
                <td className="num">{r.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="xs muted">Descriptive only. A left/right difference is not, by itself, evidence of pathology. “—” = not captured or not valid.</p>
    </section>
  );
}

/** Baseline vs current, with conditions, quality and missing-data reasons. */
export function ComparisonTable({ db, current }: { db: DB; current: Assessment }) {
  const baseline = db.assessments.find((a) => a.id === current.baselineAssessmentId);
  if (!baseline) return null;
  const bCaps = capturesFor(db, baseline.id);
  const cCaps = capturesFor(db, current.id);
  const keys = new Set([...bCaps, ...cCaps].map((c) => `${c.protocolId}|${c.side ?? ''}`));
  const rows: { label: string; base: string; cur: string; change: string; cond: string }[] = [];
  for (const k of keys) {
    const [pid, sideS] = k.split('|');
    const side = (sideS || null) as 'left' | 'right' | null;
    const b = find(bCaps, pid, side);
    const c = find(cCaps, pid, side);
    const def = getProtocol(pid);
    for (const m of (c ?? b)!.result.metrics) {
      const bv = validNum(b, m.id);
      const cv = validNum(c, m.id);
      const reason = !b ? 'no baseline capture' : !c ? 'not yet captured' : bv === null ? 'baseline not valid' : cv === null ? 'current not valid' : '';
      rows.push({
        label: `${def.shortTitle}${side ? ` (${side})` : ''} — ${m.label}`,
        base: b ? `${metricValue(mOf(b, m.id), b)} · ${fmtDate(b.createdAt)}` : '—',
        cur: c ? `${metricValue(mOf(c, m.id), c)} · ${fmtDate(c.createdAt)}` : '—',
        change: bv !== null && cv !== null ? `${cv - bv >= 0 ? '+' : ''}${Math.round((cv - bv) * 10) / 10}${unitText(m.unit)}` : reason,
        cond: c?.conditionMatch ? `${Math.round(c.conditionMatch.score * 100)}% match${c.conditionMatch.checks.filter((x) => !x.match).length ? ` (differs: ${c.conditionMatch.checks.filter((x) => !x.match).map((x) => x.label.toLowerCase()).join(', ')})` : ''}` : c ? 'no baseline config' : '—',
      });
    }
  }
  const ba = currentAnswers(db.intakeAnswers.filter((r) => r.assessmentId === baseline.id));
  const ca = currentAnswers(db.intakeAnswers.filter((r) => r.assessmentId === current.id));
  const pro = ['nprs_now', 'nprs_worst', 'func_stairs', 'func_squat', 'func_walk', 'func_chair'].filter((q) => ba[q] !== undefined || ca[q] !== undefined);
  return (
    <section className="panel stack">
      <div className="row between wrap">
        <h2>Baseline → current</h2>
        <span className="small muted">
          Baseline {fmtDate(baseline.createdAt)} · current {fmtDate(current.createdAt)}
        </span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Camera-estimated measure</th>
              <th>Baseline</th>
              <th>Current</th>
              <th>Change / missing reason</th>
              <th>Capture conditions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="small">{r.label}</td>
                <td className="small num">{r.base}</td>
                <td className="small num">{r.cur}</td>
                <td className="small num" style={{ fontWeight: 700 }}>
                  {r.change}
                </td>
                <td className="xs">{r.cond}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pro.length > 0 && (
        <>
          <div className="row">
            <strong>Symptoms & function</strong>
            <CategoryBadge kind="pro" />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Patient-reported</th>
                  <th>Baseline</th>
                  <th>Current</th>
                </tr>
              </thead>
              <tbody>
                {pro.map((q) => (
                  <tr key={q}>
                    <td className="small">{HISTORY_QUESTIONNAIRE.questions.find((x) => x.id === q)?.text}</td>
                    <td className="small">{formatAnswer(q, ba[q] ?? null)}</td>
                    <td className="small">{formatAnswer(q, ca[q] ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="xs muted">The patient’s own baseline is the comparison. Changes smaller than the method’s measurement error (not yet established — see validation plan) should not be interpreted as real change.</p>
    </section>
  );
}
