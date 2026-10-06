import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';
import { buildQuery, fetchAbstract, PubMedError, RESEARCH_FILTERS, searchPubMed, type AbstractSection, type PubMedRef, type ResearchFilter } from '../../evidence/pubmed';

/**
 * Research: live PubMed search for the physiotherapist. Records and abstracts are shown exactly as
 * PubMed returns them. There is deliberately no AI "synthesis": a generated summary can misstate a
 * paper, so the clinician reads and appraises the sources themselves. Only search terms leave the
 * device — never patient details.
 */

// Starting points only: plain search terms the physiotherapist can edit. Not recommendations.
const QUICK_TOPICS = [
  'knee osteoarthritis exercise therapy',
  'patellofemoral pain exercise',
  'anterior cruciate ligament reconstruction rehabilitation',
  'chronic low back pain exercise',
  'neck pain exercise therapy',
  'rotator cuff related shoulder pain exercise',
  'frozen shoulder physiotherapy',
  'lateral elbow tendinopathy',
  'plantar heel pain',
  'ankle sprain rehabilitation',
  'falls prevention exercise older adults',
  'office workers neck pain ergonomics',
];

export function ResearchPage() {
  const [terms, setTerms] = useState('');
  const [filters, setFilters] = useState<ResearchFilter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ query: string; count: number; refs: PubMedRef[] } | null>(null);
  // Only the latest search may update the page (a slow earlier response must not overwrite it).
  const request = useRef(0);

  const run = async (t: string, f: ResearchFilter[]) => {
    const q = buildQuery(t, f);
    if (!q) return;
    const id = ++request.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await searchPubMed(q, { retmax: 20 });
      if (request.current === id) setResult({ query: q, ...r });
    } catch (x) {
      if (request.current === id) setError(x instanceof PubMedError ? x.message : 'PubMed search failed.');
    } finally {
      if (request.current === id) setBusy(false);
    }
  };
  const toggle = (f: ResearchFilter) => setFilters((xs) => (xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f]));

  return (
    <div className="content stack loose">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">Evidence</p>
          <h1>Research</h1>
          <p className="muted">Search PubMed live. Titles, journals and abstracts are shown exactly as PubMed returns them; the app does not summarise, grade or rank them. Appraise each paper yourself.</p>
        </div>
        <Link className="btn secondary sm" to="/c/programs/new">
          Open treatment planner
        </Link>
      </div>
      <Notice>
        A search match does not establish that a treatment works for a particular patient — check the study design, population, outcomes and full text. Only the terms you enter are sent to NCBI. Never enter names or patient details.
      </Notice>
      <form
        role="search"
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(terms, filters);
        }}
      >
        <div className="row wrap">
          <label className="field grow" style={{ minWidth: 220 }}>
            <span>Search terms</span>
            <input className="input" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. knee osteoarthritis exercise therapy" />
          </label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy || !terms.trim()}>
            {busy ? 'Searching…' : 'Search PubMed'}
          </button>
        </div>
        <fieldset className="row wrap" style={{ border: 0, padding: 0, margin: 0, gap: '0.5rem 1rem' }}>
          <legend className="small" style={{ marginBottom: '0.3rem' }}>
            PubMed filters
          </legend>
          {(Object.keys(RESEARCH_FILTERS) as ResearchFilter[]).map((f) => (
            <label key={f} className="row small" style={{ gap: '0.35rem' }}>
              <input type="checkbox" checked={filters.includes(f)} onChange={() => toggle(f)} />
              {RESEARCH_FILTERS[f].label}
            </label>
          ))}
        </fieldset>
        <div className="stack tight">
          <span className="small muted">Quick topics (editable starting points)</span>
          <div className="row wrap" style={{ gap: '0.4rem' }}>
            {QUICK_TOPICS.map((q) => (
              <button
                key={q}
                type="button"
                className="btn ghost sm chip-btn"
                onClick={() => {
                  setTerms(q);
                  void run(q, filters);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </form>
      {error && <Notice tone="warn">{error} No references are shown until PubMed responds.</Notice>}
      {result && (
        <section className="stack" aria-live="polite" aria-labelledby="res-h">
          <p className="xs muted" style={{ margin: 0 }}>To attach an appraised paper to a treatment plan, open the Evidence section in the planner. The record count is not a clinical consensus.</p>
          <h2 id="res-h" className="h3">
            {result.count.toLocaleString('en-IN')} records · first {result.refs.length} by PubMed relevance
          </h2>
          <p className="xs muted mono" style={{ wordBreak: 'break-word' }}>
            Query sent: {result.query}
          </p>
          {result.refs.length === 0 && <p className="muted">No records returned.</p>}
          <ol className="stack" style={{ paddingLeft: '1.2rem' }}>
            {result.refs.map((r) => (
              <ResearchItem key={r.pmid} r={r} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function ResearchItem({ r }: { r: PubMedRef }) {
  const [abs, setAbs] = useState<{ state: 'idle' | 'loading' | 'error' | 'done'; sections: AbstractSection[]; msg?: string }>({ state: 'idle', sections: [] });
  const load = async () => {
    if (abs.state === 'done') return setAbs({ state: 'idle', sections: [] });
    setAbs({ state: 'loading', sections: [] });
    try {
      setAbs({ state: 'done', sections: await fetchAbstract(r.pmid) });
    } catch (x) {
      setAbs({ state: 'error', sections: [], msg: x instanceof PubMedError ? x.message : 'Could not load the abstract.' });
    }
  };
  return (
    <li className="panel stack tight">
      <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 650 }}>
        {r.title}
      </a>
      <div className="xs muted">
        {[r.journal, r.year].filter(Boolean).join(' · ')} · PMID {r.pmid}
        {r.pubTypes?.length ? ` · ${r.pubTypes.join(', ')}` : ''}
      </div>
      <div className="row wrap small" style={{ gap: '0.75rem' }}>
        <button type="button" className="btn secondary sm" aria-expanded={abs.state === 'done'} onClick={() => void load()}>
          {abs.state === 'loading' ? 'Loading…' : abs.state === 'done' ? 'Hide abstract' : 'Show abstract'}
        </button>
        {r.pmcid && (
          <a href={`https://pmc.ncbi.nlm.nih.gov/articles/${r.pmcid}/`} target="_blank" rel="noopener noreferrer">
            Free full text (PubMed Central)
          </a>
        )}
        {r.doi && (
          <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noopener noreferrer">
            DOI {r.doi}
          </a>
        )}
      </div>
      {abs.state === 'error' && <p className="small" role="alert">{abs.msg}</p>}
      {abs.state === 'done' && (
        <div className="abstract stack tight">
          {abs.sections.length === 0 ? (
            <p className="small muted">PubMed lists no abstract for this record.</p>
          ) : (
            abs.sections.map((s, i) => (
              <p key={i} className="small" style={{ margin: 0 }}>
                {s.label && <strong>{s.label}: </strong>}
                {s.text}
              </p>
            ))
          )}
          <p className="xs muted" style={{ margin: 0 }}>
            Abstract as published in PubMed, unedited.
          </p>
        </div>
      )}
    </li>
  );
}
