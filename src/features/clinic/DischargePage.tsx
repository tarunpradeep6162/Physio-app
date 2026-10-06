import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCurrentClinician, useCurrentUser } from '../../app/hooks';
import { DemoBadge, Notice } from '../../components/ui';
import { buildDischarge, dischargeFingerprint, dischargeStatus, type DischargeDraft } from '../../clinical/discharge';
import { patientCode } from '../../clinical/directory';
import { fmtDateTime } from '../../data/queries';
import { getDb, insert, recordAudit, useDb, uuid } from '../../data/store';
import { renderPdf } from '../report/pdf';
import { ReportBody } from '../report/ReportView';

/** Discharge summary: physiotherapist's text + recorded data; preliminary until signed. */
export function DischargePage() {
  const { id = '' } = useParams();
  const user = useCurrentUser();
  const clinician = useCurrentClinician();
  const db = useDb((d) => d);
  const patient = db.patients.find((p) => p.id === id);
  const st = dischargeStatus(db, id);
  const [draft, setDraft] = useState<DischargeDraft>(() => ({ summary: st.latest?.summary ?? '', advice: st.latest?.advice ?? '', followUp: st.latest?.followUp ?? '' }));
  const changed = !st.latest || draft.summary !== st.latest.summary || draft.advice !== st.latest.advice || draft.followUp !== st.latest.followUp;
  const model = useMemo(() => (patient ? buildDischarge(db, id, changed ? draft : undefined) : null), [db, id, draft, changed, patient]);
  if (!user || !patient || !model) return <div className="content"><p className="muted">Patient not found.</p></div>;
  const history = (db.discharges ?? []).filter((d) => d.patientId === id).sort((a, b) => b.version - a.version);
  const set = (k: keyof DischargeDraft) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const canSign = !!clinician && draft.summary.trim().length > 0 && (changed || st.stale);

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Discharge</p>
          <h1>
            {patient.name} <DemoBadge show={!!patient.isDemo} />
          </h1>
          <p className="muted small mono">{patientCode(patient.id)}</p>
        </div>
        <Link className="btn secondary" to={`/c/patients/${id}`}>
          Back to patient
        </Link>
      </div>
      <section className="panel stack tight">
        <div className="row between wrap">
          <h2>Discharge summary</h2>
          <span className={`badge ${model.state === 'clinician_reviewed' ? 'clinical' : 'warn'}`}>
            {model.state === 'clinician_reviewed' ? `✓ Signed v${st.latest?.version}` : st.stale ? 'Signed version out of date — data changed' : 'Preliminary — not signed'}
          </span>
        </div>
        <p className="xs muted">Attendance, pain scores and measurements are filled in from the record. Write the summary in your own words; nothing here is generated.</p>
        <label className="field">
          <span>Summary of treatment and outcome</span>
          <textarea className="input" rows={4} value={draft.summary} onChange={set('summary')} />
        </label>
        <label className="field">
          <span>Home advice</span>
          <textarea className="input" rows={3} value={draft.advice} onChange={set('advice')} />
        </label>
        <label className="field">
          <span>Follow-up</span>
          <textarea className="input" rows={2} value={draft.followUp} onChange={set('followUp')} />
        </label>
        {!clinician && <Notice tone="warn">Only a physiotherapist account can sign a discharge summary.</Notice>}
        <div className="row wrap">
          <button
            className="btn dark"
            disabled={!canSign}
            onClick={() => {
              const now = new Date().toISOString();
              insert('discharges', { id: uuid(), patientId: id, version: st.nextVersion, summary: draft.summary.trim(), advice: draft.advice.trim(), followUp: draft.followUp.trim(), signedBy: clinician!.id, signedAt: now, fingerprint: dischargeFingerprint(getDb(), id), isDemo: patient.isDemo }, user.id, 'discharge_sign');
            }}
          >
            Sign discharge summary
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              const doc = renderPdf(buildDischarge(getDb(), id, changed ? draft : undefined));
              doc.save(`dheepika-lab-discharge-${patientCode(id)}-v${model.documentVersion}${model.state === 'clinician_reviewed' ? '' : '-preliminary'}.pdf`);
              recordAudit(user.id, 'export', 'discharges', id, model.state);
            }}
          >
            Download PDF
          </button>
        </div>
        {history.length > 0 && <p className="xs muted">Signed versions: {history.map((d) => `v${d.version} ${fmtDateTime(d.signedAt)}`).join(' · ')}</p>}
      </section>
      <div className="panel" style={{ padding: 0 }}>
        <ReportBody model={model} />
      </div>
    </div>
  );
}
