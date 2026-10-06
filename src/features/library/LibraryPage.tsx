import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useCurrentClinician, useCurrentUser } from '../../app/hooks';
import { Notice } from '../../components/ui';
import { approve, ContentWorkflowError, importLibrary, latestItems, newVersion, requestChanges, retire, submitForReview } from '../../content/contentStore';
import { ACCESS_TAGS, cameraLabel, EQUIPMENT, GOALS, LibraryIndex, POSITIONS, REGIONS, validateItem, type ContentItem, type LibraryQuery, type ReviewStatus } from '../../content/library';
import { fmtDateTime } from '../../data/queries';
import { useDb } from '../../data/store';

/**
 * Exercise library (Phase 16) — clinician view. Faceted search over the latest version of every
 * item; content review status and camera status are shown as separate badges. Nothing reaches a
 * patient until a clinician approves that exact version; imported items always start unreviewed.
 */

const STATUS_TEXT: Record<ReviewStatus, string> = { imported_unreviewed: 'Imported — unreviewed', draft: 'Draft', in_review: 'In review', approved: 'Approved (published)', retired: 'Retired' };
const STATUS_TONE: Record<ReviewStatus, string> = { imported_unreviewed: 'warn', draft: '', in_review: 'review', approved: 'clinical', retired: '' };
const words = (s: string) => s.replace(/_/g, ' ');

export function LibraryPage() {
  const user = useCurrentUser();
  const clinician = useCurrentClinician();
  const items = useDb((d) => latestItems(d), []);
  const trail = useDb((d) => d.contentReviews ?? [], []);
  const index = useMemo(() => new LibraryIndex(items), [items]);
  const [q, setQ] = useState<LibraryQuery>({});
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  if (!user || !clinician) return null;
  const hits = index.search(q);
  const known = new Set(items.map((i) => i.id));
  const toggle = <K extends keyof LibraryQuery>(k: K, v: string) =>
    setQ((x) => {
      const cur = (x[k] as string[] | undefined) ?? [];
      return { ...x, [k]: cur.includes(v) ? cur.filter((y) => y !== v) : [...cur, v] };
    });
  const act = (f: () => void, ok: string) => {
    try {
      f();
      setMsg({ tone: 'ok', text: ok });
      setNote('');
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof ContentWorkflowError ? e.message : String(e) });
    }
  };

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <h1>Exercise library</h1>
        <span className="small muted">
          {items.length} items · {items.filter((i) => i.review.status === 'approved').length} published · {items.filter((i) => i.camera.status === 'camera_guided').length} camera-guided
        </span>
        <Link className="btn secondary sm" to="/c/library/rom-guide">
          ROM measurement guide
        </Link>
      </div>
      <Notice>
        Content review and camera status are separate. <strong>Camera-guided</strong> appears only on items with a per-exercise camera definition and a QA record, and it states the QA level. Imported or templated items stay unpublished until a clinician approves the exact version. The starter items are drafts awaiting clinical review.
      </Notice>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <section className="panel stack tight" aria-label="Filters">
        <input className="input" placeholder="Search title and instructions" value={q.text ?? ''} onChange={(e) => setQ((x) => ({ ...x, text: e.target.value }))} aria-label="Search" />
        {(
          [
            ['goals', GOALS],
            ['regions', REGIONS],
            ['positions', POSITIONS],
            ['equipment', EQUIPMENT],
            ['accessibility', ACCESS_TAGS],
            ['statuses', ['imported_unreviewed', 'draft', 'in_review', 'approved', 'retired']],
          ] as const
        ).map(([k, vals]) => (
          <div key={k} className="row wrap" style={{ gap: '0.3rem' }} role="group" aria-label={words(k)}>
            <span className="xs muted" style={{ minWidth: '6rem' }}>
              {words(k)}
            </span>
            {vals.map((v) => (
              <button key={v} className="chip" aria-pressed={((q[k] as string[] | undefined) ?? []).includes(v)} onClick={() => toggle(k, v)}>
                {words(v)}
              </button>
            ))}
          </div>
        ))}
        <div className="row wrap">
          <label className="check">
            <input type="checkbox" checked={!!q.cameraGuidedOnly} onChange={(e) => setQ((x) => ({ ...x, cameraGuidedOnly: e.target.checked }))} />
            <span>Camera-guided only</span>
          </label>
          <label className="field" style={{ width: '10rem' }}>
            <span>Max difficulty</span>
            <select className="input" value={q.maxDifficulty ?? ''} onChange={(e) => setQ((x) => ({ ...x, maxDifficulty: e.target.value ? Number(e.target.value) : undefined }))}>
              <option value="">Any</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <p className="small muted" aria-live="polite">
        {hits.length} result(s)
      </p>
      <div className="stack tight">
        {hits.slice(0, 100).map((it) => {
          const problems = validateItem(it, known);
          const cam = cameraLabel(it);
          const isOpen = open === it.id;
          return (
            <article key={it.id} className="panel stack tight">
              <button className="row between wrap" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.id)}>
                <strong>
                  {it.title} <span className="xs muted">v{it.version}</span>
                </strong>
                <span className="row wrap" style={{ gap: '0.3rem' }}>
                  <span className={`badge ${STATUS_TONE[it.review.status]}`}>{STATUS_TEXT[it.review.status]}</span>
                  {cam && <span className="badge review">{cam}</span>}
                  <span className={`badge ${it.supervision === 'in_clinic' ? 'warn' : ''}`}>{it.supervision === 'in_clinic' ? 'In clinic only' : 'Home after prescription'}</span>
                  {problems.length > 0 && <span className="badge warn">{problems.length} to complete</span>}
                </span>
              </button>
              <span className="xs muted">
                {it.regions.map(words).join(', ')} · {words(it.position)} · difficulty {it.difficulty} · {it.equipment.map(words).join(', ')}
                {it.accessibility.length ? ` · ${it.accessibility.map(words).join(', ')}` : ''}
              </span>
              {isOpen && <ItemDetail item={it} problems={problems} trail={trail.filter((r) => r.itemId === it.id)} note={note} setNote={setNote} onAction={(kind) => {
                if (kind === 'submit') act(() => submitForReview(it, user.id), 'Submitted for review.');
                if (kind === 'approve') act(() => approve(it, user.id, clinician.name, note || undefined), `Approved v${it.version} — now available to prescribe.`);
                if (kind === 'changes') act(() => requestChanges(it, user.id, note || 'Changes requested'), 'Returned to draft.');
                if (kind === 'retire') act(() => retire(it, user.id, note || 'Retired'), 'Retired.');
                if (kind === 'version') act(() => void newVersion(it, {}, user.id), 'New draft version created.');
                if (kind === 'supervision') act(() => void newVersion(it, { supervision: it.supervision === 'in_clinic' ? 'home' : 'in_clinic' }, user.id), 'New draft version with the supervision level changed — review and approve it to use it.');
              }} />}
            </article>
          );
        })}
        {hits.length > 100 && <p className="small muted">Showing the first 100 — refine the filters.</p>}
      </div>

      <ImportPanel onImport={(json, name) => act(() => {
        const r = importLibrary(json, user.id, name);
        setMsg({ tone: r.errors.length ? 'danger' : 'ok', text: `Imported ${r.added} item(s) as unreviewed.${r.errors.length ? ` ${r.errors.join('; ')}` : ''}` });
      }, 'Imported.')} />
    </div>
  );
}

function ItemDetail({ item, problems, trail, note, setNote, onAction }: { item: ContentItem; problems: string[]; trail: { action: string; version: string; at: string; note?: string }[]; note: string; setNote: (s: string) => void; onAction: (k: 'submit' | 'approve' | 'changes' | 'retire' | 'version' | 'supervision') => void }) {
  const s = item.review.status;
  return (
    <div className="stack tight">
      <p className="small">{item.summary}</p>
      <ol className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
        {item.instructions.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ol>
      <div className="small">
        <strong>Precautions:</strong> {item.precautions.join(' ') || '—'}
      </div>
      <div className="small row wrap" style={{ gap: '0.5rem' }}>
        <span>
          <strong>Where it may be done:</strong> {item.supervision === 'in_clinic' ? 'in clinic only, supervised — cannot be added to a home plan' : 'at home once a physiotherapist prescribes it'}
        </span>
        <button className="btn ghost sm" onClick={() => onAction('supervision')}>
          {item.supervision === 'in_clinic' ? 'Allow at home (new version)' : 'Make in-clinic only (new version)'}
        </button>
      </div>
      <div className="small">
        <strong>Default dosage:</strong> {item.defaultDosage.sets} set(s){item.defaultDosage.reps ? ` × ${item.defaultDosage.reps}` : ''}
        {item.defaultDosage.holdSeconds ? `, hold ${item.defaultDosage.holdSeconds} s` : ''}
        {item.defaultDosage.durationSeconds ? `, ${item.defaultDosage.durationSeconds} s` : ''}, {item.defaultDosage.frequencyPerWeek}/week
      </div>
      <div className="small">
        <strong>Media:</strong> {item.media.length ? item.media.map((m) => `${m.kind} — ${m.rights.owner}, ${m.rights.licence}`).join('; ') : 'none (licensed media not yet added)'}
      </div>
      {item.alternatives.length > 0 && (
        <div className="small">
          <strong>Alternatives:</strong> {item.alternatives.map((a) => `${a.itemId} (${a.reason})`).join('; ')}
        </div>
      )}
      <div className="small">
        <strong>Review owner:</strong> {item.review.owner}
        {item.review.reviewedBy ? ` · approved by ${item.review.reviewedBy} ${fmtDateTime(item.review.reviewedAt!)}` : ''} · source {item.source.kind}
        {item.source.ref ? ` (${item.source.ref})` : ''} · {item.schema}
      </div>
      {item.camera.status === 'camera_guided' && (
        <div className="small">
          <strong>Camera:</strong> definition {item.camera.definitionId}@{item.camera.definitionVersion} · QA {words(item.camera.qa)} — {item.camera.qaEvidence}
        </div>
      )}
      {problems.length > 0 && <Notice tone="warn">Before approval: {problems.join('; ')}.</Notice>}
      <label className="field">
        <span>Review note</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row wrap">
        {(s === 'draft' || s === 'imported_unreviewed') && (
          <button className="btn secondary sm" onClick={() => onAction('submit')}>
            Submit for review
          </button>
        )}
        {s === 'in_review' && (
          <>
            <button className="btn primary sm" disabled={problems.length > 0} onClick={() => onAction('approve')}>
              Approve this version
            </button>
            <button className="btn secondary sm" onClick={() => onAction('changes')}>
              Request changes
            </button>
          </>
        )}
        {(s === 'approved' || s === 'retired') && (
          <button className="btn secondary sm" onClick={() => onAction('version')}>
            New draft version
          </button>
        )}
        {s !== 'retired' && (
          <button className="btn ghost sm" onClick={() => onAction('retire')}>
            Retire
          </button>
        )}
      </div>
      {trail.length > 0 && (
        <details className="xs">
          <summary>Review history ({trail.length})</summary>
          {trail.map((r, i) => (
            <div key={i}>
              {fmtDateTime(r.at)} · v{r.version} · {r.action}
              {r.note ? ` — ${r.note}` : ''}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function ImportPanel({ onImport }: { onImport: (json: string, name: string) => void }) {
  return (
    <section className="panel stack tight">
      <h2>Import content</h2>
      <p className="small muted">A JSON array of items (schema dl-content-1.0.0). Imported items are always unreviewed and never camera-guided, whatever the file says.</p>
      <input
        type="file"
        accept=".json,application/json"
        aria-label="Import library JSON"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onImport(await f.text(), f.name);
        }}
      />
    </section>
  );
}
