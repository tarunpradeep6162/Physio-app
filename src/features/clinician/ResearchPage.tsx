import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';
import { PubMedError, searchPubMed, type PubMedRef } from '../../evidence/pubmed';

/**
 * Clinician research desk. Searches public PubMed metadata; a result count or keyword match is
 * not evidence of efficacy. No patient identifiers or assessment text are sent to NCBI.
 */
export function ResearchPage() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ query: string; count: number; refs: PubMedRef[] } | null>(null);
  const request = useRef(0);

  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const term = query.trim();
    if (!term) return;
    const id = ++request.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const found = await searchPubMed(term);
      if (request.current === id) setResult({ query: term, ...found });
    } catch (cause) {
      if (request.current === id) setError(cause instanceof PubMedError ? cause.message : 'PubMed search failed.');
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Clinical desk</p>
          <h1>Research</h1>
          <p className="muted">Find publication records and appraise them before using them in a treatment plan.</p>
        </div>
        <Link className="btn secondary sm" to="/c/programs/new">Open treatment planner</Link>
      </div>
      <Notice>
        This is a live PubMed metadata search. A search match does not establish that a treatment
        works for a particular patient. Check the study design, population, outcomes and full text.
        The app sends only the terms entered below to NCBI. Never enter names or patient details.
      </Notice>
      <form className="panel stack" onSubmit={search} role="search">
        <label className="field">
          <span>Condition or intervention</span>
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. exercise therapy knee osteoarthritis randomized trial" />
        </label>
        <div className="row wrap">
          <button className="btn primary" disabled={busy || !query.trim()} type="submit">
            {busy ? 'Searching PubMed…' : 'Search PubMed'}
          </button>
          <span className="small muted">No patient record is linked to this search.</span>
        </div>
      </form>
      {error && <Notice tone="warn">{error} No references are shown until PubMed responds.</Notice>}
      {result && (
        <section className="panel stack" aria-live="polite" aria-label="PubMed search results">
          <div>
            <h2>Publications</h2>
            <p className="small muted">
              {result.count.toLocaleString('en-IN')} records match “{result.query}”.
              Showing {result.refs.length} returned by PubMed relevance. This count is not a clinical consensus.
            </p>
          </div>
          {result.refs.length === 0 && <p className="muted">No publication records returned.</p>}
          <ol className="evidence-list">
            {result.refs.map((ref) => (
              <li key={ref.pmid}>
                <a href={ref.url} target="_blank" rel="noopener noreferrer" className="small">
                  <strong>{ref.title}</strong>
                </a>
                <p className="xs muted">
                  {[ref.journal, ref.year].filter(Boolean).join(' · ')} · PMID {ref.pmid}
                  {ref.doi ? ` · DOI ${ref.doi}` : ''}
                  {' · '}Retrieved {new Date(ref.retrievedAt).toLocaleDateString('en-IN')}
                </p>
              </li>
            ))}
          </ol>
          <p className="xs muted">To attach an appraised paper to a specific treatment plan, open its Evidence section in the planner.</p>
        </section>
      )}
    </div>
  );
}
