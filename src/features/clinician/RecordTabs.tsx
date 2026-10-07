import { useMemo, useState } from 'react';
import { CategoryBadge, Notice, Segmented } from '../../components/ui';
import { goalViews, validateGoalText } from '../../clinical/goals';
import { canEditLetter, letterText, newVersion, signLetter } from '../../clinical/letters';
import { formatQuote, noteChains, quoteMeasurement, quoteObservation, quotePro, SOAP_HEADINGS, soapBody, soapEmpty, SOURCE_LABEL, type Soap } from '../../clinical/notes';
import type { DB, Letter, NoteMeasurement, Patient } from '../../data/models';
import { fmtDate, fmtDateTime } from '../../data/queries';
import { insert, update, uuid } from '../../data/store';
import { useT } from '../../i18n';

/** Quotable values for a patient, newest first, each labelled with its source (Phases 48 and 52). */
function useQuotes(db: DB, patient: Patient): NoteMeasurement[] {
  const { t } = useT();
  return useMemo(() => {
    // Protocol metrics carry their own label on the capture; other types use the UI dictionary,
    // and an unknown type is shown readably rather than as a raw key.
    const metricLabel = (captureId?: string, metricId?: string) => db.captures.find((c) => c.id === captureId)?.result.metrics.find((x) => x.id === metricId)?.label;
    const readable = (type: string) => type.replace(/^(posture|desk)\./, '').replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
    const mLabel = (type: string, captureId?: string, metricId?: string) => {
      const fromCapture = metricLabel(captureId, metricId);
      if (fromCapture) return fromCapture;
      const key = type.startsWith('posture.') || type.startsWith('desk.') ? type : `measure.${type}`;
      const text = t(key);
      return text === key ? readable(type) : text;
    };
    const measurements = db.measurements.filter((m) => m.patientId === patient.id).map((m) => quoteMeasurement(m, mLabel(m.type, m.captureId, m.metricId)));
    const observations = db.observations.filter((o) => o.patientId === patient.id).map((o) => {
      const m = db.measurements.find((x) => x.id === o.measurementId);
      return quoteObservation(o, m ? mLabel(m.type, m.captureId, m.metricId) : 'Observation');
    });
    const pros = db.pros.filter((p) => p.patientId === patient.id && (p.type === 'nprs_now' || p.type === 'nprs_worst_24h' || p.type === 'daily_checkin'))
      .map((p) => quotePro(p, p.type === 'nprs_now' ? 'Pain now (0–10)' : p.type === 'nprs_worst_24h' ? 'Worst pain, last 24 h (0–10)' : 'Daily check-in'));
    return [...measurements, ...observations, ...pros].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 60);
  }, [db, patient.id, t]);
}

/** Pick values to quote; the source label is always shown with the value. */
function QuotePicker({ quotes, picked, onChange }: { quotes: NoteMeasurement[]; picked: string[]; onChange: (ids: string[]) => void }) {
  const [source, setSource] = useState<'all' | NoteMeasurement['source']>('all');
  const shown = quotes.filter((q) => source === 'all' || q.source === source);
  const key = (q: NoteMeasurement) => `${q.source}:${q.measurementId}`;
  return (
    <details className="panel">
      <summary style={{ cursor: 'pointer', minHeight: 44 }}><strong>Quote measurements</strong> <span className="xs muted">{picked.length} selected</span></summary>
      <div className="stack tight" style={{ marginTop: '0.5rem' }}>
        <div className="chips" role="group" aria-label="Source">
          {(['all', ...Object.keys(SOURCE_LABEL)] as ('all' | NoteMeasurement['source'])[]).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={source === s} onClick={() => setSource(s)}>{s === 'all' ? 'All' : SOURCE_LABEL[s]}</button>
          ))}
        </div>
        {shown.length === 0 && <p className="small muted">Nothing recorded from this source yet.</p>}
        <ul className="stack tight" style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '18rem', overflowY: 'auto' }}>
          {shown.map((q) => (
            <li key={key(q)}>
              <label className="row" style={{ alignItems: 'flex-start', gap: '0.5rem' }}>
                <input type="checkbox" checked={picked.includes(key(q))} onChange={(e) => onChange(e.target.checked ? [...picked, key(q)] : picked.filter((x) => x !== key(q)))} />
                <span className="small">{formatQuote(q)}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

const qKey = (q: NoteMeasurement) => `${q.source}:${q.measurementId}`;
/** Selected quotes: fresh from the current list, plus earlier quotes kept that have left the list. */
function pickedQuotes(quotes: NoteMeasurement[], picked: string[], earlier: NoteMeasurement[] = []): NoteMeasurement[] {
  const fresh = quotes.filter((q) => picked.includes(qKey(q)));
  const kept = earlier.filter((q) => picked.includes(qKey(q)) && !fresh.some((f) => qKey(f) === qKey(q)));
  return [...fresh, ...kept];
}
const EMPTY_SOAP: Soap = { subjective: '', objective: '', assessment: '', plan: '' };

/** Phase 48: SOAP notes with quoted, source-labelled measurements. Notes are corrected, never edited. */
export function NotesTab({ db, patient, actorId }: { db: DB; patient: Patient; actorId: string }) {
  const quotes = useQuotes(db, patient);
  const [soap, setSoap] = useState<Soap>(EMPTY_SOAP);
  const [picked, setPicked] = useState<string[]>([]);
  const [amending, setAmending] = useState<string | null>(null);
  const chains = useMemo(() => noteChains(db.notes.filter((n) => n.patientId === patient.id)), [db, patient.id]);
  const author = (id: string) => db.clinicians.find((c) => c.id === id || c.userId === id)?.name ?? '—';
  const save = () => {
    const inserted = pickedQuotes(quotes, picked, (amending && db.notes.find((x) => x.id === amending)?.inserted) || []);
    insert('notes', { id: uuid(), patientId: patient.id, authorId: actorId, soap, inserted, body: soapBody(soap, inserted), createdAt: new Date().toISOString(), amends: amending ?? undefined }, actorId, amending ? 'correction' : undefined);
    setSoap(EMPTY_SOAP);
    setPicked([]);
    setAmending(null);
  };
  const startCorrection = (id: string) => {
    const n = db.notes.find((x) => x.id === id);
    if (!n) return;
    setSoap(n.soap ?? { ...EMPTY_SOAP, assessment: n.body });
    setPicked((n.inserted ?? []).map((q) => `${q.source}:${q.measurementId}`));
    setAmending(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <div className="stack">
      <div className="panel stack tight">
        <div className="row between">
          <strong>{amending ? 'Correct a note' : 'New clinical note'}</strong>
          <CategoryBadge kind="clinical" />
        </div>
        {amending && <Notice tone="warn">The original note stays in the record. This correction is saved as a new note that replaces it in the list.</Notice>}
        {(Object.keys(SOAP_HEADINGS) as (keyof Soap)[]).map((k) => (
          <label key={k} className="field">
            <span>{SOAP_HEADINGS[k]}</span>
            <textarea className="input" rows={k === 'subjective' || k === 'assessment' ? 3 : 2} value={soap[k]} onChange={(e) => setSoap({ ...soap, [k]: e.target.value })} />
          </label>
        ))}
        <QuotePicker quotes={quotes} picked={picked} onChange={setPicked} />
        <p className="xs muted" style={{ margin: 0 }}>Quoted values keep their source (patient-reported, camera estimate, algorithmic observation or clinician finding) and are frozen as they were when quoted. Withheld camera values are quoted as withheld.</p>
        <div className="row wrap">
          <button className="btn primary" disabled={soapEmpty(soap)} onClick={save}>{amending ? 'Save correction' : 'Save note'}</button>
          {amending && <button className="btn ghost" onClick={() => { setAmending(null); setSoap(EMPTY_SOAP); setPicked([]); }}>Cancel correction</button>}
        </div>
      </div>
      {chains.map(({ current: n, history }) => (
        <article key={n.id} className="panel stack tight">
          <div className="row between small muted wrap">
            <span>{author(n.authorId)}{n.amends && ' · corrected'}</span>
            <span>{fmtDateTime(n.createdAt)}</span>
          </div>
          {n.soap ? (
            <div className="stack tight">
              {(Object.keys(SOAP_HEADINGS) as (keyof Soap)[]).filter((k) => n.soap![k].trim()).map((k) => (
                <div key={k}><strong className="small">{SOAP_HEADINGS[k]}</strong><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.soap![k]}</p></div>
              ))}
              {!!n.inserted?.length && (
                <div><strong className="small">Quoted measurements</strong><ul className="small" style={{ margin: 0 }}>{n.inserted.map((q) => <li key={`${q.source}:${q.measurementId}`}>{formatQuote(q)}</li>)}</ul></div>
              )}
            </div>
          ) : <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
          <div className="row wrap">
            <button className="btn ghost sm" onClick={() => startCorrection(n.id)}>Correct this note</button>
          </div>
          {history.length > 0 && (
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>Earlier versions ({history.length})</summary>
              {history.map((h) => <p key={h.id} className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{fmtDateTime(h.createdAt)} — {h.body}</p>)}
            </details>
          )}
        </article>
      ))}
    </div>
  );
}

/** Phase 47 (clinician side): goals in the patient's words and the patient's own ratings. */
export function GoalsTab({ db, patient, actorId }: { db: DB; patient: Patient; actorId: string }) {
  const [text, setText] = useState('');
  const views = useMemo(() => goalViews(patient.id, db.goals, db.goalRatings), [db, patient.id]);
  const err = text.trim() ? validateGoalText(text) : null;
  const now = () => new Date().toISOString();
  return (
    <div className="stack">
      <Notice>Goals are written in the patient’s own words and agreed together. Progress ratings are the patient’s own 0–10 answers; they are not calculated from camera measurements.</Notice>
      <div className="panel stack tight">
        <label className="field">
          <span>Record a goal in the patient’s words</span>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Climb the stairs at home without stopping" />
        </label>
        {err && <p className="small" role="alert" style={{ margin: 0 }}>{err}</p>}
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!text.trim() || !!err} onClick={() => {
          insert('goals', { id: uuid(), patientId: patient.id, text: text.trim(), createdBy: actorId, createdAt: now(), agreedBy: actorId, agreedAt: now(), status: 'active' }, actorId);
          setText('');
        }}>Save goal</button>
      </div>
      {views.length === 0 && <p className="muted small">No goals recorded yet.</p>}
      {views.map(({ goal, ratings, latest, change }) => (
        <article key={goal.id} className="panel stack tight">
          <div className="row between wrap">
            <strong>“{goal.text}”</strong>
            <span className={`badge ${goal.status === 'achieved' ? 'ok' : goal.status === 'withdrawn' ? 'warn' : ''}`}>{goal.status}</span>
          </div>
          <p className="xs muted" style={{ margin: 0 }}>
            Set {fmtDate(goal.createdAt)}{goal.agreedAt ? ` · agreed ${fmtDate(goal.agreedAt)}` : ' · not yet agreed with a physiotherapist'}
          </p>
          <p className="small" style={{ margin: 0 }}>
            <CategoryBadge kind="pro" /> {latest ? `Latest rating ${latest.rating}/10 on ${fmtDate(latest.ratedAt)}${change !== null ? ` (${change >= 0 ? '+' : ''}${change} since first rating)` : ''}` : 'Not rated yet'}
            {latest?.note && <> — “{latest.note}”</>}
          </p>
          {ratings.length > 1 && <p className="xs muted" style={{ margin: 0 }}>All ratings: {ratings.map((r) => `${r.rating} (${fmtDate(r.ratedAt)})`).join(' · ')}</p>}
          {goal.status === 'active' && (
            <div className="row wrap">
              {!goal.agreedBy && <button className="btn secondary sm" onClick={() => update('goals', goal.id, { agreedBy: actorId, agreedAt: now() }, actorId, 'agree')}>Mark agreed</button>}
              <button className="btn secondary sm" onClick={() => update('goals', goal.id, { status: 'achieved', closedAt: now() }, actorId, 'achieved')}>Mark achieved</button>
              <button className="btn ghost sm" onClick={() => update('goals', goal.id, { status: 'withdrawn', closedAt: now() }, actorId, 'withdrawn')}>Withdraw</button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

/** Phase 52: clinician-written referral and update letters. */
export function LettersTab({ db, patient, actorId }: { db: DB; patient: Patient; actorId: string }) {
  const quotes = useQuotes(db, patient);
  const letters = useMemo(() => db.letters.filter((l) => l.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [db, patient.id]);
  const [editing, setEditing] = useState<Letter | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const clinicianName = (id?: string) => db.clinicians.find((c) => c.id === id || c.userId === id)?.name ?? 'the physiotherapist';
  const now = () => new Date().toISOString();
  const start = (base?: Letter) => {
    setError(null);
    const l = base ? newVersion(base, uuid(), actorId, now()) : { id: uuid(), patientId: patient.id, kind: 'update' as const, to: '', body: '', inserted: [], status: 'draft' as const, createdBy: actorId, createdAt: now() };
    setEditing(l);
    setPicked(l.inserted.map((q) => `${q.source}:${q.measurementId}`));
  };
  const saveDraft = (l: Letter) => {
    const row = { ...l, inserted: pickedQuotes(quotes, picked, l.inserted) };
    if (db.letters.some((x) => x.id === row.id)) update('letters', row.id, row, actorId, 'draft');
    else insert('letters', row, actorId);
    return row;
  };
  const download = (l: Letter) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([letterText(l, patient.name, clinicianName(l.signedBy))], { type: 'text/plain;charset=utf-8' }));
    a.download = `${l.kind}-letter-${(l.signedAt ?? l.createdAt).slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="stack">
      <Notice>You write the letter. The app adds the quoted values with their source labels and a fixed paragraph on the limits of camera estimates. A draft can be changed; a signed letter is final, and changing it creates a new version.</Notice>
      {!editing && <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => start()}>New letter</button>}
      {editing && (
        <div className="panel stack tight">
          <Segmented label="Letter type" value={editing.kind} onChange={(kind) => setEditing({ ...editing, kind })} options={[{ id: 'update', label: 'Progress update' }, { id: 'referral', label: 'Referral' }]} />
          <label className="field"><span>To</span><input className="input" value={editing.to} onChange={(e) => setEditing({ ...editing, to: e.target.value })} placeholder="Recipient and service" /></label>
          <label className="field"><span>Letter</span><textarea className="input" rows={8} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></label>
          <QuotePicker quotes={quotes} picked={picked} onChange={setPicked} />
          {error && <p className="small" role="alert" style={{ margin: 0 }}>{error}</p>}
          <div className="row wrap">
            <button className="btn secondary" onClick={() => { saveDraft(editing); setEditing(null); }}>Save draft</button>
            <button className="btn primary" onClick={() => {
              try {
                const signed = signLetter({ ...editing, inserted: pickedQuotes(quotes, picked, editing.inserted) }, actorId, now());
                if (db.letters.some((x) => x.id === signed.id)) update('letters', signed.id, signed, actorId, 'sign');
                else insert('letters', signed, actorId, 'sign');
                setEditing(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}>Sign letter</button>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {letters.length === 0 && !editing && <p className="muted small">No letters yet.</p>}
      {letters.map((l) => (
        <article key={l.id} className="panel stack tight">
          <div className="row between wrap">
            <strong>{l.kind === 'referral' ? 'Referral' : 'Progress update'} to {l.to || '—'}</strong>
            <span className={`badge ${l.status === 'signed' ? 'ok' : 'warn'}`}>{l.status === 'signed' ? `Signed ${fmtDate(l.signedAt!)}` : 'Draft'}</span>
          </div>
          {l.supersedes && <p className="xs muted" style={{ margin: 0 }}>New version of a letter signed earlier.</p>}
          <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{l.body}</p>
          {l.inserted.length > 0 && <ul className="small" style={{ margin: 0 }}>{l.inserted.map((q) => <li key={`${q.source}:${q.measurementId}`}>{formatQuote(q)}</li>)}</ul>}
          <div className="row wrap">
            {canEditLetter(l) && <button className="btn secondary sm" onClick={() => { setEditing(l); setPicked(l.inserted.map((q) => `${q.source}:${q.measurementId}`)); }}>Edit draft</button>}
            {!canEditLetter(l) && <button className="btn secondary sm" onClick={() => start(l)}>New version</button>}
            <button className="btn ghost sm" onClick={() => download(l)}>Download text</button>
          </div>
        </article>
      ))}
    </div>
  );
}
