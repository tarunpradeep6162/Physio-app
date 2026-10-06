import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';
import { BodyMap } from '../bodymap/BodyMap';
import { regionLabel, viewsFor, VIEWS } from '../bodymap/regions';

/** An anatomical navigation aid. A selected region is a location, never a diagnosis. */
const REGIONS = [...new Set(Object.values(VIEWS).flatMap((view) => view.map((region) => region.id)))]
  .sort((a, b) => regionLabel(a).localeCompare(regionLabel(b)));

export function AnatomyAtlas() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const matches = useMemo(() => REGIONS.filter((id) => regionLabel(id).toLowerCase().includes(query.trim().toLowerCase())), [query]);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);

  return (
    <div className="content stack loose">
      <div>
        <p className="eyebrow">Clinical desk</p>
        <h1>Anatomy explorer</h1>
        <p className="muted">Explore body locations in 3D or 2D. The map uses the same region IDs as the symptom intake.</p>
      </div>
      <Notice>
        This is a reference illustration. A selected location does not establish the painful tissue or a condition.
        The 3D asset is credited in the model panel; the accessible 2D map and region list remain available.
      </Notice>
      <div className="grid cols-2">
        <section className="panel stack" aria-label="Anatomical reference map">
          <BodyMap selected={selected} onToggle={toggle} />
          {selected.length > 0 && (
            <div aria-live="polite" className="stack tight">
              <h2>Selected locations</h2>
              <ul>
                {selected.map((id) => (
                  <li key={id}>
                    <button type="button" className="chip" onClick={() => toggle(id)}>
                      {regionLabel(id)} · remove
                    </button>
                    <span className="xs muted"> Visible from {viewsFor(id).join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="panel stack" aria-labelledby="region-list-heading">
          <h2 id="region-list-heading">Region index</h2>
          <label className="field">
            <span>Find a body location</span>
            <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. left knee, shoulder blade" />
          </label>
          <p className="xs muted">{matches.length} of {REGIONS.length} mapped locations</p>
          <div className="row wrap" style={{ maxHeight: '28rem', overflowY: 'auto', alignContent: 'flex-start' }} role="group" aria-label="Body locations">
            {matches.map((id) => (
              <button key={id} type="button" className="chip" aria-pressed={selected.includes(id)} onClick={() => toggle(id)}>
                {regionLabel(id)}
              </button>
            ))}
            {matches.length === 0 && <p className="small muted">No mapped location matches that search.</p>}
          </div>
          <div className="row wrap">
            <Link className="btn secondary sm" to="/c/library">Exercise library</Link>
            <Link className="btn secondary sm" to="/c/library/rom-guide">ROM measurement guide</Link>
            <Link className="btn secondary sm" to="/c/research">Research</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
