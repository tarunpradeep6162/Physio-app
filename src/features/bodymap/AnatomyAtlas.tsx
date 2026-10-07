import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';
import { BodyMap } from '../bodymap/BodyMap';
import type { AtlasStats, Summary } from '../bodymap/atlasProbe';
import { regionLabel, viewsFor, VIEWS } from '../bodymap/regions';

/** An anatomical navigation aid. A selected region is a location, never a diagnosis. */
const REGIONS = [...new Set(Object.values(VIEWS).flatMap((view) => view.map((region) => region.id)))]
  .sort((a, b) => regionLabel(a).localeCompare(regionLabel(b)));

export function AnatomyAtlas() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [stats, setStats] = useState<AtlasStats | null>(null);
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
          <BodyMap selected={selected} onToggle={toggle} onAtlasStats={setStats} />
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
          <DeviceCheck stats={stats} />
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

const ms = (v: number | null) => (v === null ? '–' : `${v} ms`);
const sum = (x: Summary) => (x.n ? `p50 ${ms(x.p50)} · p95 ${ms(x.p95)} · ${Math.round((x.over50ms ?? 0) * 100)}% over 50 ms (n ${x.n})` : 'not measured yet');

/**
 * Phase 24 tester panel: what the 3D atlas costs on THIS device. Values are measurements, not
 * targets; record runs on target phones in docs/ANATOMY_PHONE_QA.md.
 */
function DeviceCheck({ stats }: { stats: AtlasStats | null }) {
  const download = () => {
    if (!stats) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(stats, null, 1)], { type: 'application/json' }));
    a.download = `atlas-device-qa-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <details className="panel">
      <summary style={{ cursor: 'pointer', minHeight: 44 }}>
        <strong>Device check (3D performance)</strong> <span className="xs muted">for testing on target phones</span>
      </summary>
      {!stats ? (
        <p className="small muted">Open the 3D body to measure this device.</p>
      ) : (
        <div className="stack tight" style={{ marginTop: '0.5rem' }}>
          <dl className="small" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.25rem 0.75rem' }}>
            <dt>Graphics</dt>
            <dd style={{ margin: 0 }}>{stats.device.webglRenderer ?? 'not reported'} · DPR {stats.device.devicePixelRatio}</dd>
            <dt>Model</dt>
            <dd style={{ margin: 0 }}>{stats.load.detail === 'lite' ? 'Light (simplified for phones)' : 'Full detail'}</dd>
            <dt>Model ready</dt>
            <dd style={{ margin: 0 }}>{ms(stats.load.modelMs)} (region tagging {ms(stats.load.tagMs)}) · skeleton {ms(stats.load.skeletonMs)}</dd>
            <dt>Geometry</dt>
            <dd style={{ margin: 0 }}>{stats.load.meshes} meshes · {Math.round(stats.load.triangles / 1000)}k triangles · {Math.round(stats.load.geometryBytes / 1048576)} MB buffers</dd>
            <dt>Turning</dt>
            <dd style={{ margin: 0 }}>{sum(stats.interaction.frameInterval)}</dd>
            <dt>Tap → highlight</dt>
            <dd style={{ margin: 0 }}>{sum(stats.interaction.tapToHighlight)}</dd>
            <dt>Memory</dt>
            <dd style={{ margin: 0 }}>{stats.memory.jsHeapUsedMB === null ? 'not reported by this browser' : `${stats.memory.jsHeapUsedMB} MB JS heap of ${stats.memory.jsHeapLimitMB} MB`}</dd>
            <dt>Context lost</dt>
            <dd style={{ margin: 0 }}>{stats.contextLost}</dd>
          </dl>
          <p className="xs muted" style={{ margin: 0 }}>Turn the model and tap a few regions, then download. No patient data is included. These are measurements on this device, not pass/fail targets.</p>
          <button className="btn secondary sm" style={{ alignSelf: 'flex-start' }} onClick={download}>
            Download device record (JSON)
          </button>
        </div>
      )}
    </details>
  );
}
