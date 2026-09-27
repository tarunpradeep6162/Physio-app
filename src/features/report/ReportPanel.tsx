import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCurrentClinician, useCurrentUser } from '../../app/hooks';
import { buildReport, REPORT_TEMPLATE_VERSION, reportStatus } from '../../clinical/report';
import { Notice } from '../../components/ui';
import { fmtDateTime } from '../../data/queries';
import { getDb, insert, useDb, uuid } from '../../data/store';
import { renderPdf } from './pdf';
import { ReportBody } from './ReportView';

/** Clinician report controls: preview, PDF downloads, approval and version history. */

export function downloadReport(assessmentId: string, audience: 'clinician' | 'patient', actorId: string) {
  const db = getDb();
  const model = buildReport(db, assessmentId, audience);
  // Every generated document is recorded (document version + state) for the audit trail.
  if (model.state !== 'clinician_reviewed') {
    insert('reports', { id: uuid(), assessmentId, version: model.documentVersion, status: 'preliminary', generatedAt: model.generatedAt, generatedBy: actorId, templateVersion: REPORT_TEMPLATE_VERSION }, actorId, `pdf:${audience}`);
  }
  const doc = renderPdf(model);
  doc.save(`physiovision-knee-${audience}-${assessmentId.slice(0, 8)}-v${model.documentVersion}.pdf`);
  return doc;
}

export function ReportPanel({ assessmentId }: { assessmentId: string }) {
  const user = useCurrentUser();
  const clinician = useCurrentClinician();
  const db = useDb((d) => d);
  const st = reportStatus(db, assessmentId);
  const model = useMemo(() => buildReport(db, assessmentId, 'clinician'), [db, assessmentId]);
  const hasImpression = db.impressions.some((i) => i.assessmentId === assessmentId);
  const history = db.reports.filter((r) => r.assessmentId === assessmentId).sort((a, b) => b.version - a.version);
  if (!user) return null;
  return (
    <div className="stack">
      <section className="panel stack">
        <div className="row between wrap">
          <h2>Report</h2>
          <span className={`badge ${st.state === 'clinician_reviewed' ? 'clinical' : 'warn'}`}>{st.state === 'clinician_reviewed' ? `✓ Clinician-reviewed v${st.approved?.version}` : st.stale ? 'Approval stale — data changed' : 'AI preliminary — requires clinician review'}</span>
        </div>
        {!hasImpression && <Notice tone="warn">Record a clinician impression (Evidence & reasoning tab) before approving. Until then the report can only be a preliminary draft.</Notice>}
        <div className="row wrap">
          <button className="btn primary" onClick={() => downloadReport(assessmentId, 'clinician', user.id)}>
            Download clinician PDF
          </button>
          <button className="btn secondary" onClick={() => downloadReport(assessmentId, 'patient', user.id)}>
            Download patient summary PDF
          </button>
          <Link className="btn secondary" to={`/report/${assessmentId}?audience=clinician`} target="_blank">
            Print view
          </Link>
          <button
            className="btn dark"
            disabled={!hasImpression || !clinician || st.state === 'clinician_reviewed'}
            onClick={() => {
              const now = new Date().toISOString();
              insert('reports', { id: uuid(), assessmentId, version: st.nextVersion, status: 'clinician_reviewed', generatedAt: now, generatedBy: user.id, approvedBy: clinician!.id, approvedAt: now, templateVersion: REPORT_TEMPLATE_VERSION }, user.id, 'report_approve');
            }}
          >
            Approve as clinician-reviewed
          </button>
        </div>
        {history.length > 0 && (
          <p className="xs muted">
            Versions: {history.map((r) => `v${r.version} ${r.status === 'clinician_reviewed' ? 'approved' : 'preliminary'} ${fmtDateTime(r.approvedAt ?? r.generatedAt)}`).join(' · ')}
          </p>
        )}
      </section>
      <div className="panel" style={{ padding: 0 }}>
        <ReportBody model={model} />
      </div>
    </div>
  );
}
