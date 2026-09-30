import { useState } from 'react';
import type { EvidenceRef } from '../../data/models';
import { attachRef, PubMedError, searchPubMed, type PubMedRef } from '../../evidence/pubmed';
import { Notice } from '../../components/ui';

/**
 * Evidence panel for the treatment planner. Searches PubMed live and lists records exactly as
 * returned (PMID, title, journal, year, link). The clinician chooses which to attach to the plan.
 * Nothing here is generated: no summaries, no strength-of-evidence labels, no "supports" claims.
 */
export function EvidencePanel({ value, onChange, actorId, suggestedQuery }: { value: EvidenceRef[]; onChange: (v: EvidenceRef[]) => void; actorId: string; suggestedQuery: string }) {
  const [query, setQuery] = useState(suggestedQuery);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ count: number; refs: PubMedRef[] } | null>(null);
  const attached = new Set(value.map((v) => v.pmid));

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await searchPubMed(query));
    } catch (x) {
      setResult(null);
      setError(x instanceof PubMedError ? x.message : 'PubMed search failed.');
    } finally {
      setBusy(false);
    }
  };
  const toggle = (r: PubMedRef) => (attached.has(r.pmid) ? onChange(value.filter((v) => v.pmid !== r.pmid)) : onChange([...value, attachRef(r, actorId, new Date().toISOString())]));

  return (
    <section className="panel stack" aria-labelledby="evidence-h">
      <div className="row between wrap">
        <h2 id="evidence-h">Evidence (PubMed)</h2>
        <span className="badge">Live from NCBI PubMed</span>
      </div>
      <p className="small muted">
        Records are retrieved from PubMed (NCBI E-utilities) and shown exactly as returned. The app does not judge relevance or quality — appraise each source before relying on it. Only your search terms are sent; no patient details.
      </p>
      <form className="row wrap" onSubmit={search}>
        <label className="field grow" style={{ minWidth: 220 }}>
          <span>Search terms</span>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. knee pain exercise therapy" />
        </label>
        <button className="btn secondary" style={{ alignSelf: 'flex-end' }} disabled={busy || !query.trim()}>
          {busy ? 'Searching…' : 'Search PubMed'}
        </button>
      </form>
      {error && (
        <Notice tone="warn">
          {error} No references are shown until PubMed responds.
        </Notice>
      )}
      {result && (
        <div className="stack tight" aria-live="polite">
          <p className="xs muted">
            {result.count.toLocaleString('en-IN')} PubMed records match “{query.trim()}”; showing the first {result.refs.length} by PubMed relevance.
          </p>
          {result.refs.length === 0 && <p className="small muted">No records returned.</p>}
          <ul className="evidence-list">
            {result.refs.map((r) => (
              <li key={r.pmid}>
                <RefLine r={r} />
                <button type="button" className={`btn sm ${attached.has(r.pmid) ? 'secondary' : 'primary'}`} aria-pressed={attached.has(r.pmid)} onClick={() => toggle(r)}>
                  {attached.has(r.pmid) ? 'Attached ✓ — remove' : 'Attach to plan'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="stack tight">
        <h3>Attached to this plan ({value.length})</h3>
        {value.length === 0 ? (
          <p className="small muted">None attached.</p>
        ) : (
          <ul className="evidence-list">
            {value.map((r) => (
              <li key={r.pmid}>
                <RefLine r={r} />
                <button type="button" className="btn sm ghost" onClick={() => onChange(value.filter((v) => v.pmid !== r.pmid))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function RefLine({ r }: { r: PubMedRef }) {
  return (
    <div className="grow" style={{ minWidth: 0 }}>
      <a href={r.url} target="_blank" rel="noopener noreferrer" className="small" style={{ fontWeight: 650 }}>
        {r.title}
      </a>
      <div className="xs muted">
        {[r.journal, r.year].filter(Boolean).join(' · ')} · PMID {r.pmid} · retrieved {new Date(r.retrievedAt).toLocaleDateString('en-IN')}
      </div>
    </div>
  );
}
