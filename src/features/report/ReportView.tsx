import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { buildReport, type Block, type ReportModel } from '../../clinical/report';
import { drawSkeleton } from '../../camera/overlay';
import { LineChart } from '../../components/LineChart';
import { useDb } from '../../data/store';
import { BodyMap } from '../bodymap/BodyMap';
import { downloadReport } from './ReportPanel';

/** Print view of the same report model used for the PDF. */

function SkeletonThumb({ frame, width, height }: { frame: { label: string; landmarks: Parameters<typeof drawSkeleton>[1] }; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    c.width = width;
    c.height = height;
    ctx.fillStyle = '#0d1a1d';
    ctx.fillRect(0, 0, width, height);
    drawSkeleton(ctx, frame.landmarks, width, height, { mirrored: false });
  }, [frame, width, height]);
  return (
    <figure style={{ margin: 0, flex: 1, minWidth: 70 }}>
      <canvas ref={ref} style={{ width: '100%', borderRadius: 6, background: '#0d1a1d' }} aria-label={`Skeleton at ${frame.label}`} role="img" />
      <figcaption className="xs muted" style={{ textAlign: 'center' }}>
        {frame.label}
      </figcaption>
    </figure>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case 'para':
      return <p style={{ fontWeight: b.tone === 'strong' ? 700 : undefined, color: b.tone === 'warn' ? 'var(--amber-ink)' : b.tone === 'muted' ? 'var(--ink-3)' : undefined, fontStyle: b.tone === 'muted' ? 'italic' : undefined }}>{b.text}</p>;
    case 'missing':
      return <p className="muted" style={{ fontStyle: 'italic' }}>Not available: {b.text}</p>;
    case 'kv':
      return (
        <dl className="kv">
          {b.rows.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      );
    case 'table':
      return (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="data">
            <thead>
              <tr>
                {b.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="small">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'regions':
      return b.ids.length ? (
        <div style={{ maxWidth: 260 }}>
          <BodyMap selected={b.ids} onToggle={() => undefined} readOnly compact />
        </div>
      ) : null;
    case 'skeletons':
      return (
        <figure style={{ margin: 0 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            {b.frames.map((f) => (
              <SkeletonThumb key={f.label} frame={f} width={b.width} height={b.height} />
            ))}
          </div>
          <figcaption className="xs muted">{b.caption}</figcaption>
        </figure>
      );
    case 'chart':
      return (
        <LineChart
          title={b.title}
          yUnit={b.unit}
          xLabel={b.xLabel}
          height={170}
          formatX={(x) => (b.xFormat === 'date' ? new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : `${x.toFixed(0)} s`)}
          series={b.series.map((s, i) => ({ id: s.label, label: s.label, color: i === 0 ? '#0D9488' : '#7C5CD6', marker: b.xFormat === 'date' ? (i === 0 ? 'circle' : 'square') : 'none', dashed: s.dashed, points: s.points }))}
        />
      );
  }
}

export function ReportBody({ model }: { model: ReportModel }) {
  return (
    <article className="report-page stack">
      {model.state !== 'clinician_reviewed' && <div className="report-watermark">{model.staleApproval ? 'AI PRELIMINARY — DATA CHANGED SINCE APPROVAL — REQUIRES RE-REVIEW' : 'AI PRELIMINARY — REQUIRES CLINICIAN REVIEW'}</div>}
      <h1>{model.title}</h1>
      {model.sections.map((s) => (
        <section key={`${s.n}-${s.title}`} className="report-section stack tight" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.8rem' }}>
          <h2>
            {s.n}. {s.title} {s.label && <span className="xs muted">· {s.label}</span>}
          </h2>
          {s.blocks.map((b, i) => (
            <BlockView key={i} b={b} />
          ))}
        </section>
      ))}
      <section className="report-section stack tight" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.8rem' }}>
        <h2>Sign-off</h2>
        {model.state === 'clinician_reviewed' ? (
          <p>
            Reviewed and approved by {model.approvedBy} on {model.approvedAt ? new Date(model.approvedAt).toLocaleString() : '—'} (document v{model.documentVersion}). Electronic approval recorded in the audit log; no cryptographic signature.
          </p>
        ) : (
          <p style={{ color: 'var(--amber-ink)', fontWeight: 700 }}>Not signed off — preliminary draft.</p>
        )}
        <p className="xs muted">
          Generated {new Date(model.generatedAt).toLocaleString()} · document v{model.documentVersion}
        </p>
      </section>
    </article>
  );
}

/** Route: /report/:id?audience=clinician|patient. Patients only see their own, clinician-reviewed report. */
export function ReportRoute() {
  const { id } = useParams();
  const user = useCurrentUser();
  const patient = useCurrentPatient();
  const db = useDb((d) => d);
  const audience = (new URLSearchParams(location.search).get('audience') === 'patient' || user?.role === 'patient' ? 'patient' : 'clinician') as 'clinician' | 'patient';
  const a = db.assessments.find((x) => x.id === id);
  if (!user || !a) return <div className="content">Report not found.</div>;
  if (user.role === 'patient' && a.patientId !== patient?.id) return <div className="content">Not authorised.</div>;
  const model = buildReport(db, a.id, audience);
  if (user.role === 'patient' && model.state !== 'clinician_reviewed') return <div className="content">Your physiotherapist has not approved this report yet.</div>;
  return (
    <div>
      <div className="no-print row wrap" style={{ padding: '0.75rem 1rem', gap: '0.5rem' }}>
        <button className="btn primary" onClick={() => window.print()}>
          Print
        </button>
        <button className="btn secondary" onClick={() => downloadReport(a.id, audience, user.id)}>
          Download PDF
        </button>
        <Link className="btn ghost" to={user.role === 'patient' ? '/p/home' : `/c/assessments/${a.id}`}>
          Back
        </Link>
      </div>
      <ReportBody model={model} />
    </div>
  );
}
