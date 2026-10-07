import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from '../../components/ui';
import { BodyMap } from '../bodymap/BodyMap';
import type { AtlasStats, Summary } from '../bodymap/atlasProbe';
import { MODEL_DOWNLOAD_MB } from '../bodymap/BodyMap';
import { keepModelOffline, offlineModelState, removeOfflineModels, storageEstimate, type OfflineModelState } from '../bodymap/offlineModel';
import { usePrefs, type AnatomyDetail } from '../../data/prefs';
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
          <OfflineModel />
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

const mb = (b: number) => `${Math.round(b / 1048576)} MB`;

/**
 * Phase 45: keep the 3D model on this device for clinics with weak connections. Opt-in only; shows
 * what it stores and lets the person remove it. The 2D map always works offline.
 */
function OfflineModel() {
  const prefs = usePrefs();
  const [state, setState] = useState<OfflineModelState | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof caches !== 'undefined';
  const refresh = () => {
    offlineModelState().then(setState).catch(() => setState({ stored: [], bytes: 0 }));
    storageEstimate().then(setUsage).catch(() => setUsage(null));
  };
  useEffect(refresh, []);
  const detail: AnatomyDetail = prefs.anatomyDetail ?? 'lite';
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch {
      setError('The model could not be stored. Check the connection and the free space on this device, then try again.');
    } finally {
      setBusy(false);
      refresh();
    }
  };
  return (
    <details className="panel">
      <summary style={{ cursor: 'pointer', minHeight: 44 }}>
        <strong>Offline use</strong> <span className="xs muted">keep the 3D model on this device</span>
      </summary>
      <div className="stack tight" style={{ marginTop: '0.5rem' }}>
        {!supported ? (
          <p className="small muted">This browser cannot store the model for offline use. The 2D map works without a connection.</p>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }} role="status">
              {state === null ? 'Checking…' : state.stored.length === 0 ? 'Not stored. The 3D model downloads each time it is opened.' : `Stored: ${state.stored.map((d) => (d === 'lite' ? 'light model' : 'full detail')).join(' and ')} (${mb(state.bytes)}).`}
              {usage && <> This site uses {mb(usage.usage)} of about {mb(usage.quota)} available to it.</>}
            </p>
            <div className="row wrap">
              <button type="button" className="btn secondary sm" disabled={busy || state?.stored.includes(detail)} onClick={() => run(() => keepModelOffline(detail))}>
                {busy ? 'Storing…' : `Keep ${detail === 'lite' ? 'light model' : 'full detail'} (about ${MODEL_DOWNLOAD_MB[detail]} MB download)`}
              </button>
              {state && state.stored.length > 0 && (
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(removeOfflineModels)}>Remove stored model</button>
              )}
            </div>
            {error && <p className="small" role="alert" style={{ margin: 0 }}>{error}</p>}
            <p className="xs muted" style={{ margin: 0 }}>The model is a reference illustration with no patient information. The model you keep is the one selected in the 3D view.</p>
          </>
        )}
      </div>
    </details>
  );
}
